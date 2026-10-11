import { DurableObject } from 'cloudflare:workers';
import { isStale, pickTargets, presenceChanges, presenceOf, STALE_MS } from './room.js';

// ChatRoom: every signed-in browser holds one WebSocket here. The hub (a Pages Function) checks who the person is, sets X-Chat-User,
// and forwards the upgrade. Events arrive as POST /event {audience, event} from the hub after it has saved a message to D1.
// WebSocket Hibernation: the object sleeps between events and wakes for each one, so an idle room costs nothing.
export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Browsers send the text "ping" every 30 seconds to keep the socket open; the platform answers without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  // The newest sign of life from a socket: its last auto-answered ping, its last message, or when it connected.
  lastSeen(ws, a) {
    let auto = null;
    try { auto = this.ctx.getWebSocketAutoResponseTimestamp(ws); } catch (_) { auto = null; }
    return [auto ? auto.getTime() : NaN, Number(a.seen), Number(a.at)];
  }

  sockets(except) {
    const out = [];
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except || ws.readyState !== 1) continue;
      const a = ws.deserializeAttachment() || {};
      // A phone that lost its signal or was locked leaves a socket that never closes. Without pings it stops counting.
      if (isStale(this.lastSeen(ws, a), now)) continue;
      out.push({ ws, email: a.email || '', state: a.state || 'online' });
    }
    return out;
  }

  presence(except) {
    return presenceOf(this.sockets(except));
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const email = (request.headers.get('X-Chat-User') || '').toLowerCase();
      if (!email) return new Response('No user', { status: 401 });
      const before = this.presence();
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server, [email]);
      server.serializeAttachment({ email, state: 'online', at: Date.now() });
      this.announce(before, this.presence());
      await this.watch();
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname === '/event' && request.method === 'POST') {
      const { audience, event } = await request.json();
      const text = JSON.stringify(event);
      for (const s of pickTargets(this.sockets(), audience)) {
        try { s.ws.send(text); } catch (_) { /* a socket that closed under us */ }
      }
      return new Response('ok');
    }
    if (url.pathname === '/presence') return Response.json(this.presence());
    return new Response('Not found', { status: 404 });
  }

  announce(before, after) {
    const changes = presenceChanges(before, after);
    if (!changes.length) return;
    const all = this.sockets();
    for (const c of changes) {
      const text = JSON.stringify({ type: 'presence', ...c });
      for (const s of all) { try { s.ws.send(text); } catch (_) { /* gone */ } }
    }
  }

  // The page tells the room when its tab is hidden or visible again: {"t":"p","s":"away"|"online"}.
  async webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > 200) return;
    let m;
    try { m = JSON.parse(message); } catch (_) { return; }
    if (m && m.t === 'p') {
      const a = ws.deserializeAttachment() || {};
      const before = this.presence();
      ws.serializeAttachment({ ...a, state: m.s === 'away' ? 'away' : 'online', seen: Date.now() });
      this.announce(before, this.presence());
    }
  }

  // While anyone is connected, a check every 30 seconds closes stale sockets and tells everyone who went offline.
  async watch() {
    if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now() + 30_000);
  }

  async alarm() {
    const now = Date.now();
    const all = this.ctx.getWebSockets().filter((ws) => ws.readyState === 1);
    const before = presenceOf(all.map((ws) => { const a = ws.deserializeAttachment() || {}; return { email: a.email || '', state: a.state || 'online' }; }));
    for (const ws of all) {
      const a = ws.deserializeAttachment() || {};
      if (isStale(this.lastSeen(ws, a), now)) { try { ws.close(1001, 'stale'); } catch (_) { /* already gone */ } }
    }
    this.announce(before, this.presence());
    if (this.ctx.getWebSockets().some((ws) => ws.readyState === 1)) await this.ctx.storage.setAlarm(Date.now() + 30_000);
  }

  async webSocketClose(ws) {
    // The platform may still list the closing socket until this handler returns, so presence is computed with and without it.
    const prior = this.priorPresence(ws);
    try { ws.close(1000, 'closed'); } catch (_) { /* already closed */ }
    this.announce(prior, presenceOf(this.sockets(ws)));
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }

  priorPresence(closing) {
    const list = this.sockets();
    if (!list.some((s) => s.ws === closing)) {
      const a = closing.deserializeAttachment() || {};
      list.push({ ws: closing, email: a.email || '', state: a.state || 'online' });
    }
    return presenceOf(list);
  }
}

export default {
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};
