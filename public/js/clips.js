/* Clips: record the screen and microphone, upload in parts to R2, and manage my clips.
   Recording: getDisplayMedia for the screen (plus tab or system sound when the browser offers it),
   getUserMedia for the microphone, both mixed with Web Audio into one track, MediaRecorder for the file. */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MAX_MS = 15 * 60 * 1000;
  const PART = 8 * 1024 * 1024;
  const STATES = ['idle', 'count', 'live', 'up', 'done'];

  const show = (name) => STATES.forEach((s) => { $('cl-' + s).hidden = s !== name; });
  const err = (msg) => { const e = $('cl-err'); e.textContent = msg || ''; e.hidden = !msg; };
  const toast = (msg) => {
    const t = document.createElement('div');
    t.className = 'cl-toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  };
  const clock = (ms) => {
    const s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  const et = (iso, o) => new Date(iso).toLocaleString('en-US', Object.assign({ timeZone: 'America/New_York' }, o));
  const linkFor = (id) => location.origin + '/c/' + id;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function api(path, opts) {
    const res = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts));
    let data = null;
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok || (data && data.ok === false)) {
      const e = new Error((data && data.message) || 'Something went wrong (' + res.status + ').');
      e.status = res.status;
      throw e;
    }
    return data;
  }

  function pickMime() {
    const list = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'];
    for (const m of list) if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
    return '';
  }

  /* ------------------------------------------------------------ recording */
  const rec = { display: null, mic: null, ctx: null, recorder: null, chunks: [], activeMs: 0, since: 0, timer: 0, meter: 0, poster: null, posterTimer: 0, stopping: false, discarded: false, mime: '', cap: 0 };

  function stopTracks() {
    [rec.display, rec.mic].forEach((s) => s && s.getTracks().forEach((t) => t.stop()));
    if (rec.ctx) rec.ctx.close().catch(() => {});
    clearInterval(rec.timer); cancelAnimationFrame(rec.meter); clearTimeout(rec.posterTimer); clearTimeout(rec.cap);
    rec.display = rec.mic = rec.ctx = null;
  }

  const elapsed = () => rec.activeMs + (rec.since ? performance.now() - rec.since : 0);

  async function begin() {
    err('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || !window.MediaRecorder) {
      err('This browser cannot record the screen. Use Chrome, Edge, Firefox or Safari on a computer.');
      return;
    }
    $('cl-start').disabled = true;
    try {
      // The mic first: if it is blocked, the person finds out before picking a screen.
      try {
        rec.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      } catch (e) {
        throw new Error('The microphone is blocked. Allow it in the address bar, then try again.');
      }
      try {
        rec.display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
      } catch (e) {
        if (e && e.name === 'NotAllowedError') throw new Error('No screen was picked, so nothing was recorded.');
        throw e;
      }

      // Mix the microphone and any tab or system sound into one audio track.
      rec.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const dest = rec.ctx.createMediaStreamDestination();
      const analyser = rec.ctx.createAnalyser();
      analyser.fftSize = 256;
      const micSrc = rec.ctx.createMediaStreamSource(rec.mic);
      micSrc.connect(dest); micSrc.connect(analyser);
      if (rec.display.getAudioTracks().length) {
        const sysSrc = rec.ctx.createMediaStreamSource(new MediaStream(rec.display.getAudioTracks()));
        sysSrc.connect(dest); sysSrc.connect(analyser);
      }
      const out = new MediaStream([...rec.display.getVideoTracks(), ...dest.stream.getAudioTracks()]);

      rec.display.getVideoTracks()[0].addEventListener('ended', () => { if (rec.recorder && rec.recorder.state !== 'inactive') finish(); });

      // A hidden video plays the screen so a poster frame can be captured a moment in.
      const pv = document.createElement('video');
      pv.muted = true; pv.playsInline = true; pv.srcObject = new MediaStream(rec.display.getVideoTracks());
      pv.play().catch(() => {});
      rec.poster = null;
      rec.posterTimer = setTimeout(() => grabPoster(pv), 1800);

      await countdown();
      if (!rec.display) return; // discarded during the countdown

      rec.mime = pickMime();
      rec.chunks = []; rec.activeMs = 0; rec.stopping = false; rec.discarded = false;
      rec.recorder = new MediaRecorder(out, Object.assign({ videoBitsPerSecond: 2500000, audioBitsPerSecond: 128000 }, rec.mime ? { mimeType: rec.mime } : {}));
      rec.mime = rec.recorder.mimeType || rec.mime || 'video/webm';
      rec.recorder.ondataavailable = (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); };
      rec.recorder.onstop = onStopped;
      rec.recorder.start(1000);
      rec.since = performance.now();
      rec.cap = setTimeout(finish, MAX_MS);
      show('live');
      $('cl-pause').textContent = 'Pause'; $('cl-paused').hidden = true; $('cl-rdot').classList.remove('is-paused');
      tick();
      rec.timer = setInterval(tick, 250);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const level = () => {
        if (!rec.ctx) return;
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
        $('cl-meter-i').style.width = Math.min(100, Math.round((peak / 128) * 160)) + '%';
        rec.meter = requestAnimationFrame(level);
      };
      level();
    } catch (e) {
      stopTracks();
      show('idle');
      err(e.message || 'Recording could not start.');
    } finally {
      $('cl-start').disabled = false;
    }
  }

  function grabPoster(video) {
    try {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) { rec.posterTimer = setTimeout(() => grabPoster(video), 600); return; }
      const scale = Math.min(1, 960 / w);
      const c = document.createElement('canvas');
      c.width = Math.round(w * scale); c.height = Math.round(h * scale);
      c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
      c.toBlob((b) => { rec.poster = b; video.srcObject = null; }, 'image/jpeg', 0.82);
    } catch (e) { /* the clip works without a poster */ }
  }

  async function countdown() {
    show('count');
    for (const n of [3, 2, 1]) {
      const el = $('cl-count-n');
      el.textContent = String(n);
      el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
      await sleep(1000);
      if (!rec.display) return;
    }
  }

  function tick() {
    const ms = elapsed();
    $('cl-time').textContent = clock(ms);
  }

  function pauseResume() {
    const r = rec.recorder;
    if (!r) return;
    if (r.state === 'recording') {
      r.pause(); rec.activeMs += performance.now() - rec.since; rec.since = 0;
      $('cl-pause').textContent = 'Resume'; $('cl-paused').hidden = false; $('cl-rdot').classList.add('is-paused');
      clearTimeout(rec.cap);
    } else if (r.state === 'paused') {
      r.resume(); rec.since = performance.now();
      rec.cap = setTimeout(finish, Math.max(0, MAX_MS - rec.activeMs));
      $('cl-pause').textContent = 'Pause'; $('cl-paused').hidden = true; $('cl-rdot').classList.remove('is-paused');
    }
  }

  function finish() {
    if (!rec.recorder || rec.stopping) return;
    rec.stopping = true;
    if (rec.since) { rec.activeMs += performance.now() - rec.since; rec.since = 0; }
    rec.recorder.state !== 'inactive' && rec.recorder.stop();
  }

  function discard() {
    if (!rec.recorder && !rec.display) return;
    if (rec.recorder && !confirm('Discard this recording? It will not be saved.')) return;
    rec.discarded = true; rec.stopping = true;
    const r = rec.recorder;
    rec.recorder = null;
    if (r && r.state !== 'inactive') { r.onstop = null; r.stop(); }
    stopTracks();
    rec.chunks = [];
    show('idle');
    toast('Recording discarded');
  }

  async function onStopped() {
    const duration = Math.min(MAX_MS, Math.round(rec.activeMs));
    const blob = new Blob(rec.chunks, { type: rec.mime });
    const poster = rec.poster;
    const mime = rec.mime;
    rec.recorder = null; rec.chunks = [];
    stopTracks();
    if (rec.discarded) return;
    if (!blob.size) { show('idle'); err('Nothing was recorded.'); return; }
    await upload(blob, duration, poster, mime);
  }

  /* ------------------------------------------------------------ upload */
  async function upload(blob, durationMs, poster, mime) {
    show('up');
    $('cl-up-h').textContent = 'Saving your clip';
    const setPct = (p) => {
      $('cl-bar-i').style.width = p + '%'; $('cl-bar').setAttribute('aria-valuenow', String(p));
      $('cl-up-note').textContent = p + '% saved. Keep this tab open until it finishes.';
    };
    setPct(0);
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    let clip = null;
    try {
      const title = $('cl-title').value.trim() || 'Clip, ' + et(new Date().toISOString(), { month: 'short', day: 'numeric' }) + ', ' + et(new Date().toISOString(), { hour: 'numeric', minute: '2-digit' });
      clip = await api('/api/clips', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, mime }) });
      const total = Math.max(1, Math.ceil(blob.size / PART));
      const parts = [];
      for (let n = 1; n <= total; n++) {
        const slice = blob.slice((n - 1) * PART, Math.min(blob.size, n * PART));
        let tries = 0;
        for (;;) {
          try {
            const r = await api('/api/clips/' + clip.id + '/part?n=' + n, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: slice });
            parts.push({ partNumber: r.partNumber, etag: r.etag });
            break;
          } catch (e) {
            tries++;
            if (e.status && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) throw e;
            if (tries >= 5) throw e;
            $('cl-up-note').textContent = 'Part ' + n + ' of ' + total + ' did not go through. Trying again (' + tries + ' of 4).';
            await sleep(800 * tries * tries);
          }
        }
        setPct(Math.round((n / total) * 96));
      }
      if (poster) {
        try { await api('/api/clips/' + clip.id + '/poster', { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: poster }); } catch (e) { /* no poster is fine */ }
      }
      await api('/api/clips/' + clip.id + '/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parts, durationMs, title }) });
      setPct(100);
      window.removeEventListener('beforeunload', warn);
      $('cl-link').value = linkFor(clip.id);
      $('cl-open').href = '/c/' + clip.id;
      $('cl-title').value = '';
      show('done');
      loadList();
    } catch (e) {
      window.removeEventListener('beforeunload', warn);
      if (clip) api('/api/clips/' + clip.id, { method: 'DELETE' }).catch(() => {});
      show('idle');
      err('The clip did not save: ' + (e.message || 'upload failed') + ' Record it again.');
    }
  }

  /* ------------------------------------------------------------ list */
  let rows = [];

  function rowHtml(c) {
    const when = et(c.created_at, { month: 'short', day: 'numeric', year: 'numeric' });
    const thumb = c.has_poster ? `<img src="/api/clips/${c.id}/media?poster=1" alt="" loading="lazy" />` : '';
    const views = Number(c.views) === 1 ? '1 view' : Number(c.views).toLocaleString('en-US') + ' views';
    return `<article class="h-card cl-row" data-id="${c.id}">
      <a class="cl-thumb" href="/c/${c.id}" aria-label="Open ${esc(c.title)}">${thumb}<b>${clock(c.duration_ms)}</b></a>
      <div class="cl-info">
        <div class="cl-name"><a href="/c/${c.id}">${esc(c.title)}</a></div>
        <div class="cl-meta"><span>${esc(when)}</span><span>${clock(c.duration_ms)} long</span><span data-views>${views}</span></div>
      </div>
      <div class="cl-acts">
        <label class="cl-switch"><input type="checkbox" data-act="share" ${c.share ? 'checked' : ''} /><i></i><span>Anyone with the link</span></label>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-act="copy">Copy link</button>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-act="rename">Rename</button>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm cl-danger" data-act="delete">Delete</button>
      </div>
    </article>`;
  }

  function paint() {
    const box = $('cl-rows');
    box.removeAttribute('aria-busy');
    $('cl-count-label').textContent = rows.length ? (rows.length === 1 ? '1 clip' : rows.length + ' clips') : '';
    box.innerHTML = rows.length ? rows.map(rowHtml).join('') : '<div class="h-card cl-empty">No clips yet. Record your first one above.</div>';
  }

  async function loadList() {
    try {
      const d = await api('/api/clips');
      rows = d.clips || [];
      paint();
    } catch (e) {
      $('cl-rows').removeAttribute('aria-busy');
      if (e.status === 403) {
        $('cl-rec').hidden = true;
        $('cl-rows').innerHTML = '<div class="h-card cl-empty">Clips is for hub admins for now.</div>';
      } else {
        $('cl-rows').innerHTML = '<div class="h-card cl-empty">Your clips did not load. Refresh the page to try again.</div>';
      }
    }
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Link copied'); }
    catch (e) { prompt('Copy this link', text); }
  }

  $('cl-rows').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn || btn.tagName === 'INPUT') return;
    const row = btn.closest('.cl-row');
    const clip = rows.find((c) => c.id === row.dataset.id);
    if (!clip) return;
    if (btn.dataset.act === 'copy') copy(linkFor(clip.id));
    if (btn.dataset.act === 'rename') {
      const slot = row.querySelector('.cl-name');
      slot.innerHTML = `<input class="cl-rename" type="text" maxlength="120" value="${esc(clip.title)}" aria-label="Clip title" /><button type="button" class="h-btn h-btn--primary h-btn--sm" data-act="save">Save</button>`;
      const input = slot.querySelector('input');
      input.focus(); input.select();
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') slot.querySelector('[data-act=save]').click(); if (e.key === 'Escape') paint(); });
    }
    if (btn.dataset.act === 'save') {
      const title = row.querySelector('.cl-rename').value.trim();
      if (!title) return;
      try { await api('/api/clips/' + clip.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) }); clip.title = title; paint(); toast('Renamed'); }
      catch (e) { toast(e.message); }
    }
    if (btn.dataset.act === 'delete') {
      if (!confirm('Delete "' + clip.title + '"? The link stops working and the video is removed for good.')) return;
      try { await api('/api/clips/' + clip.id, { method: 'DELETE' }); rows = rows.filter((c) => c.id !== clip.id); paint(); toast('Clip deleted'); }
      catch (e) { toast(e.message); }
    }
  });

  $('cl-rows').addEventListener('change', async (ev) => {
    const box = ev.target.closest('[data-act=share]');
    if (!box) return;
    const row = box.closest('.cl-row');
    const clip = rows.find((c) => c.id === row.dataset.id);
    const on = box.checked;
    try {
      await api('/api/clips/' + clip.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ share: on }) });
      clip.share = on ? 1 : 0;
      toast(on ? 'Anyone with the link can watch' : 'Only signed-in Favor staff can watch');
    } catch (e) { box.checked = !on; toast(e.message); }
  });

  /* ------------------------------------------------------------ wiring */
  $('cl-start').addEventListener('click', begin);
  $('cl-pause').addEventListener('click', pauseResume);
  $('cl-stop').addEventListener('click', finish);
  $('cl-discard').addEventListener('click', discard);
  $('cl-copy').addEventListener('click', () => copy($('cl-link').value));
  $('cl-again').addEventListener('click', () => { err(''); show('idle'); });
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || !window.MediaRecorder) {
    $('cl-unsupported').hidden = false; $('cl-start').disabled = true;
  }
  show('idle');
  loadList();
})();
