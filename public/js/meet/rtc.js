// Meetings: one RTCPeerConnection on the raw Cloudflare Realtime SFU. Publishes this person's tracks, pulls other people's
// (with a simulcast layer per video), and measures the link. Every SFU call goes through the hub's checked pass-through.
// Written from the Phase 0 lab (Q:\work\favor-bb-audit\wave2\meetings-phase0-result.md).

export class Rtc {
  /** opts: { call(op, body) -> Promise<json>, iceServers, relay } */
  constructor(opts) {
    this.call = opts.call;
    this.iceServers = opts.iceServers || [];
    this.relay = !!opts.relay;
    this.pc = null;
    this.queue = Promise.resolve();
    this.subs = new Map(); // key -> { mid, rid, sessionId, trackName, kind, pid }
    this.out = new Map(); // name -> { transceiver, mid }
    this.onTrack = () => {};
    this.onState = () => {};
    this.closed = false;
    this.stats = { rx: 0, tx: 0, bps: 0, availIn: 0, loss: 0, rtt: 0, pair: '', relay: false, t: 0, lastMediaAt: 0 };
    this._lastRx = 0;
    this._lastAt = 0;
    this._audioLevels = new Map();
    this._audioPkts = new Map(); // mid -> packetsReceived
    this._pairRx = 0;
  }

  mutate(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  open() {
    const servers = this.relay ? this.iceServers.map((s) => ({ ...s, urls: (s.urls || []).filter((u) => /^turns?:/.test(u)) })).filter((s) => s.urls.length) : this.iceServers;
    this.pc = new RTCPeerConnection({ iceServers: servers, bundlePolicy: 'max-bundle', iceTransportPolicy: this.relay ? 'relay' : 'all' });
    this.pc.ontrack = (e) => this.onTrack(e.transceiver.mid, e.track);
    this.pc.onconnectionstatechange = () => this.onState(this.pc.connectionState);
    this.pc.oniceconnectionstatechange = () => this.onState('ice:' + this.pc.iceConnectionState);
  }

  /** Publish the first set of tracks in one offer. items: [{ name, kind, track, simulcast }] (track may be null for a camera that is off). */
  async publish(items) {
    return this.mutate(async () => {
      const added = [];
      for (const it of items) {
        const init = { direction: 'sendonly' };
        if (it.simulcast) init.sendEncodings = it.simulcast;
        const tr = it.track ? this.pc.addTransceiver(it.track, init) : this.pc.addTransceiver(it.kind, init);
        added.push({ it, tr });
      }
      await this.pc.setLocalDescription(await this.pc.createOffer());
      const r = await this.call('tracks/new', {
        sessionDescription: { sdp: this.pc.localDescription.sdp, type: 'offer' },
        tracks: added.map(({ it, tr }) => ({ location: 'local', mid: tr.mid, trackName: it.name })),
      });
      if (r.errorCode) throw new Error(r.errorDescription || 'publish failed');
      for (const t of r.tracks || []) if (t.errorCode) throw new Error(t.errorDescription || 'track failed');
      await this.pc.setRemoteDescription(r.sessionDescription);
      for (const { it, tr } of added) this.out.set(it.name, { transceiver: tr, mid: tr.mid, kind: it.kind });
      return added.map(({ it, tr }) => ({ name: it.name, kind: it.kind, mid: tr.mid }));
    });
  }

  async replace(name, track) {
    const o = this.out.get(name);
    if (o) await o.transceiver.sender.replaceTrack(track);
  }

  async unpublish(name) {
    const o = this.out.get(name);
    if (!o) return;
    await this.mutate(async () => {
      try {
        o.transceiver.sender.replaceTrack(null).catch(() => {});
        await this.call('tracks/close', { tracks: [{ mid: o.mid }], force: true });
      } finally {
        this.out.delete(name);
      }
    });
  }

  /** list: [{ pid, sessionId, trackName, kind, rid }] */
  async pull(list) {
    if (!list.length) return;
    await this.mutate(async () => {
      const r = await this.call('tracks/new', {
        tracks: list.map((t) => ({
          location: 'remote', sessionId: t.sessionId, trackName: t.trackName,
          ...(t.kind === 'video' && t.rid ? { simulcast: { preferredRid: t.rid } } : {}),
        })),
      });
      if (r.errorCode) { this.lastPull = list.map((w) => ({ pid: w.pid, name: w.trackName, ok: false, err: String(r.errorCode) })); throw new Error(r.errorDescription || 'pull failed'); }
      // Each track's own answer, kept for the room's connection report.
      this.lastPull = list.map((w, i) => { const t = (r.tracks || [])[i] || {}; return { pid: w.pid, name: w.trackName, ok: !t.errorCode && !!t.mid, err: t.errorCode ? String(t.errorCode) : '' }; });
      (r.tracks || []).forEach((t, i) => {
        if (t.errorCode) return;
        const w = list[i];
        this.subs.set(w.pid + '|' + w.trackName, { mid: t.mid, rid: w.rid, sessionId: w.sessionId, trackName: w.trackName, kind: w.kind, pid: w.pid });
      });
      if (r.requiresImmediateRenegotiation) {
        await this.pc.setRemoteDescription(r.sessionDescription);
        await this.pc.setLocalDescription(await this.pc.createAnswer());
        const rr = await this.call('renegotiate', { sessionDescription: { sdp: this.pc.localDescription.sdp, type: 'answer' } });
        if (rr.errorCode) throw new Error(rr.errorDescription || 'renegotiate failed');
      }
      // The SFU reuses a closed subscription's transceiver (same mid) for the next pull, and the browser does not always fire
      // ontrack again for a reused one. Hand every new subscription's receiver track to the room directly, so a person who
      // reconnected is heard again by everyone already in the call.
      const fresh = new Set((r.tracks || []).filter((t) => !t.errorCode && t.mid).map((t) => String(t.mid)));
      for (const tr of this.pc.getTransceivers()) if (tr.mid != null && fresh.has(String(tr.mid)) && tr.receiver && tr.receiver.track) this.onTrack(tr.mid, tr.receiver.track);
    });
  }

  async setLayer(key, rid) {
    const s = this.subs.get(key);
    if (!s || s.kind !== 'video' || s.rid === rid) return;
    await this.mutate(async () => {
      const r = await this.call('tracks/update', { tracks: [{ location: 'remote', sessionId: s.sessionId, trackName: s.trackName, mid: s.mid, simulcast: { preferredRid: rid } }] });
      if (!r.errorCode) s.rid = rid;
    });
  }

  async drop(keys) {
    const list = keys.map((k) => this.subs.get(k)).filter(Boolean);
    if (!list.length) return;
    // The subscription is forgotten even when the close call fails: a closed or vanished session answers with an error, and
    // keeping the entry made every later pass try the same close again and never pull anything new.
    await this.mutate(async () => {
      try { await this.call('tracks/close', { tracks: list.map((s) => ({ mid: s.mid })), force: true }); }
      finally { for (const k of keys) this.subs.delete(k); }
    });
  }

  async sample() {
    if (!this.pc || this.pc.connectionState === 'closed') return this.stats;
    let rep;
    try {
      rep = await this.pc.getStats();
    } catch {
      return this.stats;
    }
    let rx = 0, tx = 0, avail = 0, lost = 0, recv = 0, rtt = 0, pairRx = 0, local = '', remoteType = '';
    const widths = new Map();
    this._audioLevels = new Map();
    rep.forEach((s) => {
      if (s.type === 'inbound-rtp') {
        rx += s.bytesReceived || 0; lost += s.packetsLost || 0; recv += s.packetsReceived || 0;
        if (s.kind === 'video' && s.mid != null) widths.set(s.mid, { w: s.frameWidth || 0, h: s.frameHeight || 0, fps: s.framesPerSecond || 0 });
        if (s.kind === 'audio' && s.mid != null) { this._audioLevels.set(s.mid, s.audioLevel || 0); this._audioPkts.set(s.mid, s.packetsReceived || 0); }
      }
      if (s.type === 'outbound-rtp') tx += s.bytesSent || 0;
      if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated) {
        avail = s.availableIncomingBitrate || avail; rtt = s.currentRoundTripTime || rtt; pairRx += s.bytesReceived || 0;
        const lc = rep.get(s.localCandidateId);
        if (lc) { this.stats.pair = lc.candidateType + '/' + (lc.relayProtocol || lc.protocol || ''); this.stats.relay = lc.candidateType === 'relay'; local = lc.candidateType; }
        const rc = rep.get(s.remoteCandidateId); if (rc) remoteType = rc.candidateType;
      }
    });
    const now = Date.now();
    const dt = this._lastAt ? (now - this._lastAt) / 1000 : 0;
    const bps = dt ? ((rx - this._lastRx) * 8) / dt : 0;
    this._lastRx = rx; this._lastAt = now;
    // The selected path's own byte count includes the SFU's keepalives, so it climbs while the path is alive even when nobody
    // sends any media. Zero growth here means the path is dead; a quiet room does not.
    if (pairRx > this._pairRx) this.stats.pathAt = now;
    this._pairRx = pairRx;
    // Loss over the last reading only. The totals run from the start of the call, so one bad minute kept the link "weak" for
    // the rest of it. A dropped subscription takes its counts away, so a fall in the totals counts as no loss.
    const dLost = Math.max(0, lost - (this._lost || 0)), dRecv = Math.max(0, recv - (this._recv || 0));
    this._lost = lost; this._recv = recv;
    Object.assign(this.stats, { rx, tx, bps, availIn: avail, loss: dRecv + dLost > 50 ? dLost / (dLost + dRecv) : 0, rtt, t: now, widths, state: this.pc.connectionState, ice: this.pc.iceConnectionState, local, remoteType });
    if (bps > 2000) this.stats.lastMediaAt = now;
    return this.stats;
  }

  audioLevel(mid) { return this._audioLevels.get(mid) || 0; }
  audioPackets(mid) { return this._audioPkts.get(mid) || 0; }

  close() {
    this.closed = true;
    try { this.pc && this.pc.close(); } catch {}
    this.subs.clear();
    this.out.clear();
  }
}

// Layer choice for a gallery. Tiles default to the layer their size asks for; a weak link steps tiles down one layer at a time
// and a strong one steps them back up. Phase 0 measured a 1 Mbps link landing every tile on the lowest layer, so the room also
// shows fewer tiles when the estimate is low.
export const RATE = { f: 380e3, h: 150e3, q: 55e3 };
export const ORDER = ['f', 'h', 'q'];
export function linkLevel(stats) {
  // The receiver's bandwidth estimate only climbs while there is demand for it, so a low estimate alone says nothing. The link is
  // congested when packets are lost, or when what arrives already fills most of a low estimate.
  const est = stats.availIn || 0;
  const bps = stats.bps || 0;
  if (stats.loss > 0.15 || (est && est < 400e3 && bps > est * 0.9 && bps > 250e3)) return 'weak';
  if (stats.loss > 0.06 || (est && est < 900e3 && bps > est * 0.9 && bps > 500e3)) return 'fair';
  return 'good';
}
