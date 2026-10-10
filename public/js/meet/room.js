// Meetings: the lobby and the room. The SFU work is in rtc.js. This file draws the room, runs the sync loop (roster, chat,
// host commands), keeps the subscriptions the layout needs, and handles a dropped connection.
import { $, $$, esc, ic, av, hashColor, initials, toast, api, copy, roomLink, whoami, pump } from './ui.js';
import { Rtc, linkLevel } from './rtc.js';
import { Recorder } from './rec.js';

const params = new URLSearchParams(location.search);
const MID = params.get('m') || '';
const root = $('#meet-root');
const isPhone = () => matchMedia('(max-width: 860px)').matches;
const FEATURES = { brain: false, captions: false, docs: false };
const OFFSET = Number(localStorage.getItem('meet.clockOffset') || 0);

const S = {
  meeting: null, me: { pid: sessionStorage.getItem('meet.pid.' + MID) || '', name: '', role: 'staff' }, people: [], events: 0, chat: [], panel: 'people',
  mic: true, cam: true, hand: false, sharing: false, cc: false, conn: 'ok', page: 0, pin: '', spot: '', locked: false, sharePolicy: 'all', menu: null,
  recording: null, joined: false, left: false, started: 0, lvl: 0, lastSync: 0, unread: 0, devices: { mic: true, cam: true }, removed: false, level: 'good', speakers: new Map(),
};
let rtc = null, local = { mic: null, cam: null, screen: null, screenAudio: null }, joinInfo = null, syncTimer = null, statTimer = null, reconcileTimer = null, levelTimer = null, rejoining = false, silentSince = 0, wantRid = new Map();
let recorder = null;
const tiles = new Map(); // pid or 'share:pid' -> { el, video, audio }

// ---------------------------------------------------------------- boot
if (!MID) root.innerHTML = '<div class="h-card mt-card"><p>That link is missing the meeting. Open it from Meetings.</p></div>';
else boot();

async function boot() {
  try {
    const r = await api('meetings/' + MID);
    S.meeting = r.meeting;
    document.title = S.meeting.title + ' - Favor Hub';
    const t = $('.h-top__title'); if (t) t.textContent = S.meeting.title;
    if (S.meeting.status === 'ended' && S.meeting.endedAt && Date.now() - Date.parse(S.meeting.endedAt) > 6 * 3600_000) return ended();
    lobby();
  } catch (e) {
    root.innerHTML = `<div class="h-card mt-card" style="max-width:560px;margin:20px auto"><h2 class="mt-h2">${e.status === 404 ? 'That meeting is not available' : 'Could not open the meeting'}</h2><p class="mt-sub" style="font-size:14px">${esc(e.message)}</p><a class="h-btn h-btn--primary" href="/meet/">Back to meetings</a></div>`;
  }
}

function ended(msg) {
  root.innerHTML = `<div class="h-card mt-card" style="max-width:560px;margin:20px auto;display:grid;gap:12px"><h2 class="mt-h2">${esc(msg || 'This meeting has ended')}</h2><p class="mt-sub" style="font-size:14px;margin:0">${S.meeting && S.meeting.notesStatus !== 'none' ? 'The notes are in Meeting notes.' : ''}</p><div style="display:flex;gap:10px;flex-wrap:wrap"><a class="h-btn h-btn--primary" href="/meet/">Back to meetings</a>${S.meeting && S.meeting.notesStatus !== 'none' ? `<a class="h-btn h-btn--ghost" href="/meet/notes/?m=${S.meeting.id}">Open the notes</a>` : ''}</div></div>`;
}

// ---------------------------------------------------------------- lobby
let preview = null;
async function lobby() {
  const m = S.meeting;
  const recLine = m.rec === 'video' ? 'This meeting records video and makes notes. Everyone sees a recording notice.' : m.rec === 'notes' ? 'This meeting records sound for notes. Everyone sees a notice.' : 'This meeting is not recorded.';
  const name = (await whoami()).name || '';
  root.innerHTML = `<div class="h-card mt-card lobby" style="max-width:980px;margin:6px auto"><div class="prev" id="lb-prev"><video id="lb-video" muted playsinline autoplay></video><span class="face" id="lb-face">${esc(initials(name))}</span><div class="cl"><button class="cb is-on" id="lb-mic" aria-label="Microphone"><span class="k">${ic('mic')}</span></button><button class="cb is-on" id="lb-cam" aria-label="Camera"><span class="k">${ic('video')}</span></button></div></div>
    <div style="display:grid;gap:12px"><div class="h-label">${esc(m.hostName || 'Meeting')}</div><h2 class="mt-h2" style="font-size:28px">${esc(m.title)}</h2>
      <p class="mt-sub" style="font-size:14px;margin:0" id="lb-who">${esc(recLine)}</p>
      <div class="mt-f"><label for="lb-name">Your name in the room</label><input id="lb-name" value="${esc(name)}" maxlength="60" /></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="h-btn h-btn--primary" id="lb-join">${ic('video')}Join now</button><a class="h-btn h-btn--ghost" href="/meet/">Not yet</a></div>
      <p class="mt-sub" style="margin:0" id="lb-dev">Checking your camera and microphone.</p></div></div>`;
  $('#lb-join').addEventListener('click', enter);
  $('#lb-mic').addEventListener('click', () => { S.mic = !S.mic; lobbyButtons(); });
  $('#lb-cam').addEventListener('click', () => { S.cam = !S.cam; lobbyButtons(); lobbyVideo(); });
  try {
    preview = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 1280, height: 720 } });
    $('#lb-dev').textContent = 'Camera and microphone ready.';
  } catch {
    try { preview = await navigator.mediaDevices.getUserMedia({ audio: true }); S.devices.cam = false; S.cam = false; $('#lb-dev').textContent = 'No camera found or allowed. You can still join with sound.'; }
    catch { preview = null; S.devices = { mic: false, cam: false }; S.mic = false; S.cam = false; $('#lb-dev').textContent = 'No camera or microphone is available. You can join to watch and listen, and chat.'; }
  }
  lobbyButtons(); lobbyVideo();
}
function lobbyButtons() {
  const mic = $('#lb-mic'), cam = $('#lb-cam'); if (!mic) return;
  mic.className = 'cb ' + (S.mic ? 'is-on' : 'is-off'); mic.innerHTML = `<span class="k">${ic(S.mic ? 'mic' : 'micOff')}</span>`;
  cam.className = 'cb ' + (S.cam ? 'is-on' : 'is-off'); cam.innerHTML = `<span class="k">${ic(S.cam ? 'video' : 'videoOff')}</span>`;
}
function lobbyVideo() {
  const v = $('#lb-video'); if (!v) return;
  const has = preview && preview.getVideoTracks().length && S.cam;
  v.style.display = has ? 'block' : 'none';
  if (has) v.srcObject = preview;
}

// ---------------------------------------------------------------- joining
async function enter() {
  const name = ($('#lb-name').value || '').trim() || 'Guest';
  $('#lb-join').disabled = true; $('#lb-join').textContent = 'Joining';
  S.me.name = name;
  if (preview) { local.mic = preview.getAudioTracks()[0] || null; local.cam = preview.getVideoTracks()[0] || null; }
  if (local.mic) local.mic.enabled = S.mic;
  try {
    await withTimeout(connect(false), 20000);
  } catch (e) {
    if (e.status === 403 || e.status === 404) { root.innerHTML = `<div class="h-card mt-card" style="max-width:560px;margin:20px auto;display:grid;gap:12px"><h2 class="mt-h2">You cannot join this meeting</h2><p class="mt-sub" style="font-size:14px;margin:0">${esc(e.message)}</p><a class="h-btn h-btn--primary" href="/meet/">Back to meetings</a></div>`; return; }
    failScreen(e); return;
  }
  S.joined = true; S.started = Date.now();
  buildRoom();
  startLoops();
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('The room did not load in time.')), ms))]);

async function connect(isRejoin) {
  const j = await api('meetings/' + MID + '/join', { method: 'POST', body: { pid: S.me.pid || undefined, name: S.me.name, mic: S.mic, cam: S.cam } });
  joinInfo = j; S.me.pid = j.pid; S.me.role = j.role; S.events = isRejoin ? S.events : j.since;
  sessionStorage.setItem('meet.pid.' + MID, j.pid);
  S.meeting = j.meeting;
  if (rtc) rtc.close();
  rtc = new Rtc({ call: (op, body) => api('meetings/' + MID + '/sfu/' + op, { method: 'POST', body: { pid: S.me.pid, ...body } }), iceServers: j.iceServers, relay: new URLSearchParams(location.search).get('relay') === '1' });
  rtc.onTrack = onTrack;
  rtc.onState = onRtcState;
  rtc.open();
  const items = [];
  if (S.devices.mic || local.mic) items.push({ name: 'a', kind: 'audio', track: local.mic });
  items.push({
    name: 'v', kind: 'video', track: S.cam ? local.cam : null,
    simulcast: [
      { rid: 'f', maxBitrate: 900000, maxFramerate: 24 },
      { rid: 'h', scaleResolutionDownBy: 2, maxBitrate: 350000, maxFramerate: 24 },
      { rid: 'q', scaleResolutionDownBy: 4, maxBitrate: 120000, maxFramerate: 24 },
    ],
  });
  const pub = await rtc.publish(items);
  await api('meetings/' + MID + '/tracks', { method: 'POST', body: { pid: S.me.pid, tracks: pub } });
  if (isRejoin && S.sharing && local.screen) { /* the share restarts below */ }
}

function failScreen(err) {
  const back = S.meeting && S.meeting.backupLink;
  root.innerHTML = `<div class="rm-stage" style="min-height:420px"><div class="fail" style="position:static;min-height:420px"><div><h3>The room did not load</h3><p>${esc(err && err.message ? err.message : 'Tried for 20 seconds.')} ${back ? 'Everyone can move to the backup Google Meet link from the invite.' : 'Try again, or ask the host for another way to meet.'}</p>${back ? `<a class="h-btn h-btn--gold" href="${esc(back)}" target="_blank" rel="noopener">${ic('link')}Join the backup Meet</a>` : ''}<button class="h-btn h-btn--ghost" id="retry">Try the room again</button></div></div></div>`;
  $('#retry').addEventListener('click', () => lobby());
}

// ---------------------------------------------------------------- the room
function buildRoom() {
  document.getElementById('h-app').classList.add('is-room');
  root.innerHTML = `<div class="rm" id="rm"><section class="rm-stage" aria-label="Meeting"><div class="rm-bar" id="rm-bar"></div><div id="rm-banner"></div><div class="rm-grid" id="rm-grid"></div><div class="rm-cap" id="rm-cap" hidden></div><div class="rm-ctl" id="rm-ctl"></div></section><aside class="rm-side" id="rm-side" aria-label="Meeting panel"></aside></div>`;
  S.panel = isPhone() ? '' : 'people';
  paintAll();
  window.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', onUnload);
  document.addEventListener('click', onDocClick);
  if (S.me.role !== 'guest') maybeStartRecording();
}

const mePerson = () => ({ pid: S.me.pid, name: S.me.name, role: S.me.role, mic: S.mic, cam: S.cam && !!local.cam, hand: S.hand, sharing: S.sharing, speaking: S.lvl > 12 && S.mic, me: true });
const hostish = () => S.me.role === 'host' || S.me.role === 'cohost';
const others = () => S.people.filter((p) => p.pid !== S.me.pid && !p.waiting);
const nameOf = (pid) => (pid === S.me.pid ? S.me.name : (S.people.find((p) => p.pid === pid) || {}).name || 'Someone');

function paintAll() { paintBar(); paintGrid(); paintCtl(); paintSide(); }

function paintBar() {
  const m = S.meeting; const r = S.recording;
  const el = $('#rm-bar'); if (!el) return;
  const mins = Math.floor((Date.now() - S.started) / 60000);
  const secs = Math.floor(((Date.now() - S.started) / 1000) % 60);
  const rec = r && r.active ? (r.mode === 'video' ? `<span class="rm-rec"><i></i>Recording</span>` : `<span class="rm-rec is-notes"><i></i>Notes on</span>`) : (m.rec !== 'off' ? `<span class="rm-rec is-notes"><i></i>${m.rec === 'video' ? 'Recording off' : 'Notes off'}</span>` : '');
  const lv = S.level === 'good' ? 'Connection good' : S.level === 'fair' ? 'Connection fair' : 'Connection weak';
  el.innerHTML = `<b>${esc(m.title)}</b>${rec}<span id="rm-clock">${mins}:${String(secs).padStart(2, '0')}</span>${S.locked ? `<span class="mt-pill mt-pill--gold" style="height:22px">${ic('lock')}Locked</span>` : ''}<span class="rm-net" style="margin-left:auto">${ic('wifi')}${lv}${rtc && rtc.stats.relay ? ' (relay)' : ''}</span>`;
  const b = $('#rm-banner');
  if (b) b.innerHTML = S.conn === 'drop' ? `<div class="banner">${ic('wifi')}Your connection dropped. Reconnecting.${S.recording && S.recording.active ? ' The recording keeps going.' : ''}</div>` : S.conn === 'back' ? `<div class="banner ok">${ic('check')}You are back.${S.missedSec > 3 ? ` You missed ${Math.round(S.missedSec)} seconds.` : ''}</div>` : '';
}

// ---- tiles
function makeTile(key, p, share) {
  const el = document.createElement('div'); el.className = 'mt-tile'; el.dataset.key = key;
  el.innerHTML = `<video muted playsinline autoplay></video><span class="face"></span><span class="tag" hidden></span><button class="pin" hidden></button><span class="nm"><span class="mi"></span><span class="nt"></span></span>`;
  const t = { el, video: el.querySelector('video'), key, share, pid: p.pid, audio: null };
  el.querySelector('.pin').addEventListener('click', (e) => { e.stopPropagation(); const pid = key; hostish() ? send('cmd', { a: S.spot === pid ? 'unspot' : 'spot' }, pid) : (S.pin = S.pin === pid ? '' : pid, paintGrid(), reconcile()); });
  el.addEventListener('dblclick', () => { S.pin = S.pin === p.pid ? '' : p.pid; paintGrid(); reconcile(); });
  tiles.set(key, t);
  return t;
}

function order() {
  // Who is on screen: the share first, then the spotlight or pin, then the host, then whoever spoke last, then the rest.
  const me = mePerson();
  const everyone = [me, ...others()];
  const sharer = everyone.find((p) => p.sharing && (p.me ? !!local.screen : true));
  const big = S.pin || S.spot;
  const rank = (p) => (p.pid === big ? -1 : p.role === 'host' ? 0 : 1);
  const sorted = everyone.slice().sort((a, b) => rank(a) - rank(b) || (b.speakAt || 0) - (a.speakAt || 0) || (a.joinedAt || 0) - (b.joinedAt || 0));
  return { sharer, big, sorted };
}

const perPage = () => (isPhone() ? 4 : S.level === 'weak' ? 4 : 9);

function layoutModel() {
  const { sharer, big, sorted } = order();
  const model = []; // { key, p, kind: 'big' | 'tile' | 'strip' }
  const spotMode = sharer || (big && sorted.find((p) => p.pid === big));
  if (spotMode) {
    if (sharer) model.push({ key: 'share:' + sharer.pid, p: sharer, kind: 'big', share: true });
    else model.push({ key: big, p: sorted.find((p) => p.pid === big), kind: 'big' });
    const rest = sorted.filter((p) => !(model[0].key === p.pid));
    rest.slice(0, isPhone() ? 3 : 4).forEach((p) => model.push({ key: p.pid, p, kind: 'strip' }));
    S.pages = 1;
    return { model, spot: true };
  }
  const pp = perPage();
  S.pages = Math.max(1, Math.ceil(sorted.length / pp));
  if (S.page >= S.pages) S.page = S.pages - 1;
  sorted.slice(S.page * pp, S.page * pp + pp).forEach((p) => model.push({ key: p.pid, p, kind: 'tile' }));
  return { model, spot: false };
}

function paintGrid() {
  const grid = $('#rm-grid'); if (!grid) return;
  const { model, spot } = layoutModel();
  const n = model.length;
  grid.className = 'rm-grid' + (spot ? ' is-spot' : '');
  grid.style.gridTemplateColumns = spot ? '' : `repeat(${n <= 1 ? 1 : n <= 4 ? 2 : 3}, minmax(0, 1fr))`;
  if (spot) grid.style.gridTemplateRows = `repeat(${Math.max(1, Math.min(4, n - 1))}, minmax(0, 1fr))`; else grid.style.gridTemplateRows = '';
  const keep = new Set(model.map((x) => x.key));
  for (const [k, t] of tiles) if (!keep.has(k)) { t.el.remove(); if (!t.share || true) { /* video stays attached to its track */ } }
  model.forEach(({ key, p, kind, share }, i) => {
    let t = tiles.get(key) || makeTile(key, p, !!share);
    if (!t.el.isConnected || t.el.parentNode !== grid) grid.appendChild(t.el);
    if (grid.children[i] !== t.el) grid.insertBefore(t.el, grid.children[i] || null);
    t.pid = p.pid; t.kind = kind;
    t.el.classList.toggle('is-big', kind === 'big');
    t.el.classList.toggle('mt-tile--share', !!share);
    t.el.classList.toggle('is-talk', !!p.speaking && !share);
    t.el.style.background = share ? '' : `linear-gradient(145deg, ${hashColor(p.name)}, #1f261d 130%)`;
    const camOn = share ? true : p.me ? S.cam && !!local.cam : p.cam && haveVideo(p.pid);
    const face = t.el.querySelector('.face'); face.textContent = initials(p.name); face.style.display = share || camOn ? 'none' : '';
    t.video.style.display = camOn ? 'block' : 'none';
    t.video.classList.toggle('is-me', !!p.me && !share);
    t.video.classList.toggle('is-contain', !!share);
    if (p.me && !share) { if (t.video.srcObject !== (local.cam && new MediaStream([local.cam]))) {} attachLocal(t); }
    if (p.me && share) attachLocalShare(t);
    const tag = t.el.querySelector('.tag');
    const label = share ? '' : S.spot === p.pid ? 'Spotlight' : p.hand ? 'Hand raised' : p.role === 'guest' ? 'Guest' : '';
    tag.hidden = !label; tag.textContent = label;
    const pin = t.el.querySelector('.pin');
    pin.hidden = share || !!p.me;
    pin.innerHTML = ic('pin'); pin.setAttribute('aria-label', hostish() ? 'Spotlight for everyone' : 'Pin');
    t.el.querySelector('.mi').innerHTML = share ? ic('screen') : p.mic ? '' : `<span class="off">${ic('micOff')}</span>`;
    t.el.querySelector('.nt').textContent = share ? `${p.me ? 'You are' : p.name + ' is'} presenting` : p.me ? `You${p.role === 'host' ? ' (host)' : ''}` : p.name;
  });
  paintPager();
}

function paintPager() {
  let el = $('#rm-pager');
  if (S.pages > 1) {
    if (!el) { el = document.createElement('div'); el.id = 'rm-pager'; el.className = 'rm-pager'; $('.rm-stage').insertBefore(el, $('#rm-cap')); el.addEventListener('click', (e) => { const b = e.target.closest('[data-pg]'); if (!b) return; S.page = Math.max(0, Math.min(S.pages - 1, S.page + Number(b.dataset.pg))); paintGrid(); reconcile(); }); }
    el.innerHTML = `<button data-pg="-1" aria-label="Previous page" ${S.page === 0 ? 'disabled' : ''}>${ic('chevl')}</button><span>${S.page + 1} of ${S.pages}</span><button data-pg="1" aria-label="Next page" ${S.page >= S.pages - 1 ? 'disabled' : ''}>${ic('chev')}</button>`;
  } else if (el) el.remove();
}

function attachLocal(t) {
  const want = local.cam;
  const cur = t.video.srcObject && t.video.srcObject.getVideoTracks()[0];
  if (want && cur !== want) { t.video.srcObject = new MediaStream([want]); t.video.play().catch(() => {}); }
}
function attachLocalShare(t) {
  const want = local.screen;
  const cur = t.video.srcObject && t.video.srcObject.getVideoTracks()[0];
  if (want && cur !== want) { t.video.srcObject = new MediaStream([want]); t.video.play().catch(() => {}); }
}

// remote media arrives by mid; find which subscription it is
const remote = new Map(); // `${pid}|${trackName}` -> { video?: MediaStream, audioEl? }
function onTrack(mid, track) {
  const entry = [...rtc.subs.entries()].find(([, s]) => s.mid === mid);
  const attach = (key, s) => {
    const stream = new MediaStream([track]);
    if (s.kind === 'video') {
      const tkey = s.trackName.startsWith('s') ? 'share:' + s.pid : s.pid;
      remote.set(key, { stream, tkey });
      const t = tiles.get(tkey);
      if (t) { t.video.srcObject = stream; t.video.play().catch(() => {}); }
    } else {
      let el = document.getElementById('a-' + mid);
      if (!el) { el = document.createElement('audio'); el.id = 'a-' + mid; el.autoplay = true; document.body.appendChild(el); }
      el.srcObject = stream; el.play().catch(() => {});
      remote.set(key, { stream, el, mid });
    }
  };
  if (entry) attach(entry[0], entry[1]);
  else setTimeout(() => { const e2 = [...rtc.subs.entries()].find(([, s]) => s.mid === mid); if (e2) attach(e2[0], e2[1]); }, 300);
}

function haveVideo(pid) { return !!remote.get(pid + '|v') || true; }

// ---- control bar
function paintCtl() {
  const el = $('#rm-ctl'); if (!el) return;
  const h = hostish(); const rec = S.recording && S.recording.active && S.recording.owner === S.me.pid;
  const recOn = S.recording && S.recording.active;
  const canShare = S.sharePolicy === 'all' || h || (S.people.find((p) => p.pid === S.me.pid) || {}).canShare;
  const waiting = h ? S.people.filter((p) => p.waiting).length : 0;
  el.innerHTML = `
    <button class="cb${S.mic ? '' : ' is-off'}" data-a="mic"><span class="k">${ic(S.mic ? 'mic' : 'micOff')}</span>${S.mic ? 'Mute' : 'Unmute'}</button>
    <button class="cb${S.cam ? '' : ' is-off'}" data-a="cam"><span class="k">${ic(S.cam ? 'video' : 'videoOff')}</span>Camera</button>
    ${navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && !isPhone() ? `<button class="cb${S.sharing ? ' is-on' : ''}" data-a="share" ${canShare ? '' : 'disabled title="The host limited sharing"'}><span class="k">${ic('screen')}</span>${S.sharing ? 'Stop share' : 'Share'}</button>` : ''}
    ${FEATURES.captions ? `<button class="cb${S.cc ? ' is-on' : ''}" data-a="cc"><span class="k">${ic('cc')}</span>Captions</button>` : ''}
    ${h && S.meeting.rec !== 'off' ? `<button class="cb${recOn ? ' is-off' : ''}" data-a="rec"><span class="k">${ic('rec')}</span>${recOn ? 'Stop rec' : 'Record'}</button>` : ''}
    <button class="cb${S.hand ? ' is-on' : ''}" data-a="hand"><span class="k">${ic('hand')}</span>${S.hand ? 'Lower hand' : 'Raise hand'}</button>
    <span class="rm-sep"></span>
    <button class="cb${S.panel === 'chat' ? ' is-on' : ''}" data-a="panel" data-p="chat"><span class="k badge">${ic('chat')}${S.unread ? `<span class="dotc">${S.unread}</span>` : ''}</span>Chat</button>
    <button class="cb${S.panel === 'people' ? ' is-on' : ''}" data-a="panel" data-p="people"><span class="k badge">${ic('users')}${waiting ? `<span class="dotc">${waiting}</span>` : ''}</span>People</button>
    ${FEATURES.brain ? `<button class="cb${S.panel === 'brain' ? ' is-on' : ''}" data-a="panel" data-p="brain"><span class="k">${ic('brain')}</span>Favor Brain</button>` : ''}
    <button class="cb leave" data-a="leave"><span class="k">${ic('leave')}</span>Leave</button>`;
}

// ---- side panel
function paintSide() {
  const el = $('#rm-side'); if (!el) return;
  const rm = $('#rm'); rm.classList.toggle('is-solo', !S.panel);
  el.style.display = S.panel ? '' : 'none';
  if (!S.panel) return;
  const tab = (p, l, i) => `<button data-a="panel" data-p="${p}" class="${S.panel === p ? 'is-on' : ''}">${ic(i)}${l}</button>`;
  el.innerHTML = `<div class="rm-tabs">${tab('chat', 'Chat', 'chat')}${tab('people', 'People', 'users')}${FEATURES.brain ? tab('brain', 'Brain', 'brain') : ''}<button class="x icon-b" data-a="panel-close" aria-label="Close the panel">${ic('x')}</button></div><div class="rm-body" id="rm-body"></div><div id="rm-input"></div>`;
  paintSideBody(true);
}

function chatHTML(m) {
  const f = m.file;
  const you = m.from === S.me.pid;
  return `<div class="msg">${av(m.name)}<div><b>${esc(you ? 'You' : m.name)}${m.to ? ' <i class="mt-sub">(private)</i>' : ''}</b><time>${new Date(m.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</time>${m.text ? `<p>${linkify(m.text)}</p>` : ''}${f ? `<div class="file"><span class="fi ${esc(f.type || 'doc')}">${esc((f.type || 'doc').slice(0, 3).toUpperCase())}</span><div style="min-width:0"><b>${esc(f.name)}</b><span>${esc(f.by || '')}</span></div><div class="acts"><a class="h-btn h-btn--ghost h-btn--sm" href="${esc(f.url)}" target="_blank" rel="noopener">${ic('drive')}Open in Drive</a></div></div>` : ''}</div></div>`;
}
const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:var(--h-brand-ink)">$1</a>');

function paintSideBody(full) {
  const body = $('#rm-body'); if (!body) return;
  if (S.panel === 'chat') {
    const stick = body.scrollTop + body.clientHeight >= body.scrollHeight - 40;
    body.innerHTML = S.chat.length ? S.chat.map(chatHTML).join('') : `<p class="mt-sub" style="margin:0">No messages yet. Messages go to everyone in the meeting.</p>`;
    if (full) $('#rm-input').innerHTML = `<div class="rm-input"><input id="chatin" placeholder="Message everyone" maxlength="2000" autocomplete="off" /><button class="icb send" data-a="chat-send" aria-label="Send">${ic('send')}</button></div>`;
    if (full || stick) body.scrollTop = body.scrollHeight;
  } else if (S.panel === 'people') {
    const h = hostish();
    const all = [mePerson(), ...others()];
    const wait = h ? S.people.filter((p) => p.waiting) : [];
    $('#rm-input').innerHTML = '';
    body.innerHTML = `${wait.map((p) => `<div class="wait"><b>Waiting to join</b><div class="pp" style="padding:0">${av(p.name)}<div><b>${esc(p.name)}</b><span>Guest</span></div><div class="ctl"><button class="h-btn h-btn--primary h-btn--sm" data-a="cmd" data-c="letin" data-pid="${p.pid}">Let in</button></div></div></div>`).join('')}
      ${h ? `<div class="hostbar"><button class="h-btn h-btn--ghost h-btn--sm" data-a="cmd" data-c="muteall">${ic('micOff')}Mute everyone</button><button class="h-btn h-btn--ghost h-btn--sm" data-a="cmd" data-c="${S.locked ? 'unlock' : 'lock'}">${ic('lock')}${S.locked ? 'Unlock room' : 'Lock room'}</button><button class="h-btn h-btn--ghost h-btn--sm" data-a="sharepolicy">${ic('screen')}${S.sharePolicy === 'hosts' ? 'Anyone can share' : 'Only hosts share'}</button></div>` : ''}
      <div class="h-label">In the meeting, ${all.length}</div>
      ${all.map((p) => `<div class="pp" style="position:relative">${av(p.name)}<div><b>${esc(p.name)}${p.me ? ' (you)' : ''}</b><span>${p.role === 'host' ? 'Host' : p.role === 'cohost' ? 'Host' : p.role === 'guest' ? 'Guest' : 'Staff'}${p.hand ? ' · hand raised' : ''}${p.sharing ? ' · sharing' : ''}</span></div>
        <div class="ctl"><span class="icon-b ${p.mic ? 'is-on' : 'is-off'}" title="${p.mic ? 'Mic on' : 'Muted'}">${ic(p.mic ? 'mic' : 'micOff')}</span>${h && !p.me ? `<button class="icon-b" data-a="pmenu" data-pid="${p.pid}" aria-label="Host controls for ${esc(p.name)}">${ic('more')}</button>` : ''}</div>
        ${S.menu === p.pid ? `<div class="menu"><button data-a="cmd" data-c="mute" data-pid="${p.pid}">${ic('micOff')}Mute</button><button data-a="cmd" data-c="${S.spot === p.pid ? 'unspot' : 'spot'}" data-pid="${p.pid}">${ic('pin')}${S.spot === p.pid ? 'End spotlight' : 'Spotlight for everyone'}</button><button data-a="cmd" data-c="camoff" data-pid="${p.pid}">${ic('videoOff')}Turn camera off</button>${p.hand ? `<button data-a="cmd" data-c="lowerhand" data-pid="${p.pid}">${ic('hand')}Lower hand</button>` : ''}<button data-a="cmd" data-c="allowshare" data-v="${p.canShare === false ? 'true' : 'false'}" data-pid="${p.pid}">${ic('screen')}${p.canShare === false ? 'Allow sharing' : 'Stop sharing rights'}</button>${p.role === 'cohost' ? `<button data-a="cmd" data-c="unhost" data-pid="${p.pid}">${ic('users')}Remove host rights</button>` : `<button data-a="cmd" data-c="makehost" data-pid="${p.pid}">${ic('users')}Make a host</button>`}<button class="danger" data-a="cmd" data-c="remove" data-pid="${p.pid}">${ic('remove')}Remove from meeting</button></div>` : ''}</div>`).join('')}
      ${h ? `<div style="display:flex;gap:8px;margin-top:6px"><button class="h-btn h-btn--ghost h-btn--sm" data-a="copylink">${ic('link')}Copy meeting link</button><button class="h-btn h-btn--ghost h-btn--sm" data-a="endall" style="color:#8a3f24">End for everyone</button></div>` : ''}`;
  }
}

// ---------------------------------------------------------------- actions
function onDocClick(e) {
  const a = e.target.closest('[data-a]');
  if (!a) { if (S.menu && !e.target.closest('.menu')) { S.menu = null; paintSideBody(false); } return; }
  const act = a.dataset.a;
  switch (act) {
    case 'mic': toggleMic(); break;
    case 'cam': toggleCam(); break;
    case 'share': toggleShare(); break;
    case 'cc': S.cc = !S.cc; paintCtl(); break;
    case 'rec': toggleRecording(); break;
    case 'hand': S.hand = !S.hand; paintCtl(); paintGrid(); syncNow(); break;
    case 'panel': S.panel = S.panel === a.dataset.p && isPhone() ? '' : a.dataset.p; if (S.panel === 'chat') S.unread = 0; paintCtl(); paintSide(); break;
    case 'panel-close': S.panel = ''; paintCtl(); paintSide(); break;
    case 'leave': leaveRoom(); break;
    case 'chat-send': sendChat(); break;
    case 'pmenu': S.menu = S.menu === a.dataset.pid ? null : a.dataset.pid; paintSideBody(false); break;
    case 'cmd': { const c = a.dataset.c; if (c === 'remove' && !confirm('Remove ' + nameOf(a.dataset.pid) + ' from the meeting?')) break; send('cmd', { a: c, v: a.dataset.v === undefined ? undefined : a.dataset.v === 'true' }, a.dataset.pid || ''); S.menu = null; paintSideBody(false); break; }
    case 'sharepolicy': send('cmd', { a: 'sharepolicy', v: S.sharePolicy === 'hosts' ? 'all' : 'hosts' }); break;
    case 'copylink': copy(roomLink(MID)); break;
    case 'endall': if (confirm('End the meeting for everyone?')) send('cmd', { a: 'end' }); break;
    default: break;
  }
}
function onKey(e) {
  if (e.target.id === 'chatin' && e.key === 'Enter') { e.preventDefault(); sendChat(); return; }
  if (e.target.matches && e.target.matches('input, textarea')) return;
  if (e.key === 'm' || e.key === 'M') { toggleMic(); }
  else if (e.key === 'v' || e.key === 'V') { toggleCam(); }
}
function onUnload() { try { navigator.sendBeacon('/api/meet/meetings/' + MID + '/leave', new Blob([JSON.stringify({ pid: S.me.pid })], { type: 'application/json' })); } catch {} }

async function send(kind, body, to) {
  try { await api('meetings/' + MID + '/event', { method: 'POST', body: { pid: S.me.pid, kind, body, to: to || '' } }); syncNow(); }
  catch (e) { toast(e.message); }
}
function sendChat() {
  const i = $('#chatin'); if (!i) return; const text = i.value.trim(); if (!text) return; i.value = '';
  send('chat', { text });
}

function toggleMic() {
  if (!local.mic) { toast('No microphone is available.'); return; }
  S.mic = !S.mic; local.mic.enabled = S.mic; paintCtl(); paintGrid(); syncNow();
}
async function toggleCam() {
  if (S.cam) {
    S.cam = false;
    if (local.cam) { try { await rtc.replace('v', null); } catch {} local.cam.stop(); local.cam = null; }
  } else {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
      local.cam = s.getVideoTracks()[0]; S.cam = true;
      await rtc.replace('v', local.cam);
    } catch { toast('The camera is not available.'); S.cam = false; }
  }
  paintCtl(); paintGrid(); syncNow();
}
async function toggleShare() {
  if (S.sharing) return stopShare();
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: true });
    local.screen = s.getVideoTracks()[0]; local.screenAudio = s.getAudioTracks()[0] || null;
    local.screen.contentHint = 'detail';
    local.screen.addEventListener('ended', stopShare);
    const items = [{ name: 's', kind: 'video', track: local.screen }];
    const pub = await rtc.publish(items);
    S.sharing = true;
    const all = [...rtc.out.entries()].map(([name, o]) => ({ name, kind: o.kind, mid: o.mid }));
    await api('meetings/' + MID + '/tracks', { method: 'POST', body: { pid: S.me.pid, tracks: all } });
    toast('You are sharing your screen');
    paintAll(); syncNow();
  } catch (e) { if (e && e.name !== 'NotAllowedError') toast('Sharing did not start.'); local.screen = null; S.sharing = false; }
}
async function stopShare() {
  if (!S.sharing) return;
  S.sharing = false;
  try { local.screen && local.screen.stop(); await rtc.unpublish('s'); } catch {}
  local.screen = null;
  const all = [...rtc.out.entries()].map(([name, o]) => ({ name, kind: o.kind, mid: o.mid }));
  api('meetings/' + MID + '/tracks', { method: 'POST', body: { pid: S.me.pid, tracks: all } }).catch(() => {});
  tiles.delete('share:' + S.me.pid);
  paintAll(); syncNow();
}

async function leaveRoom(msg) {
  S.left = true; clearIntervals();
  try { if (recorder) await recorder.stopIfOwner(); } catch {}
  try { await api('meetings/' + MID + '/leave', { method: 'POST', body: { pid: S.me.pid } }); } catch {}
  [local.mic, local.cam, local.screen].forEach((t) => t && t.stop());
  if (rtc) rtc.close();
  for (const [, t] of tiles) t.el.remove(); tiles.clear();
  $$('audio[id^="a-"]').forEach((a) => a.remove());
  document.getElementById('h-app').classList.remove('is-room');
  window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload); document.removeEventListener('click', onDocClick);
  ended(msg || 'You left the meeting');
  // The last person out saves the recording and starts the notes. Anyone invited can finish the work later from Meetings.
  pump(MID, (st) => { const p = root.querySelector('.mt-sub'); if (p && st) p.textContent = st; });
}

// ---------------------------------------------------------------- loops
function clearIntervals() { [syncTimer, statTimer, reconcileTimer, levelTimer].forEach((t) => t && clearInterval(t)); }
function startLoops() {
  syncTimer = setInterval(syncNow, 1000);
  statTimer = setInterval(onStats, 1500);
  levelTimer = setInterval(measureLevel, 250);
  setInterval(paintBar, 1000);
  syncNow();
}

let syncing = false;
async function syncNow() {
  if (syncing || S.left || rejoining) return;
  syncing = true;
  try {
    const r = await api('meetings/' + MID + '/sync', { method: 'POST', body: { pid: S.me.pid, since: S.events, me: { mic: S.mic, cam: S.cam && !!local.cam, hand: S.hand, sharing: S.sharing, lvl: S.lvl } } });
    S.lastSync = Date.now();
    applySync(r);
  } catch (e) {
    if (e.code === 'removed') { S.removed = true; leaveRoom('The host removed you from this meeting'); }
    else if (e.code === 'not_in_meeting') rejoin('server lost me');
  } finally { syncing = false; }
}

function applySync(r) {
  S.people = r.people; S.me.role = r.role;
  S.spot = r.meeting.spot; S.locked = r.meeting.locked; S.sharePolicy = r.meeting.sharePolicy;
  S.meeting.status = r.meeting.status;
  S.recording = r.recording;
  for (const e of r.events) handleEvent(e);
  if (r.events.length) S.events = r.events[r.events.length - 1].seq;
  if (r.meeting.status === 'ended') return leaveRoom('The meeting ended');
  // Repaint only what changed, so a button is never replaced under a click.
  const base = (p) => [p.pid, p.name, p.sessionId, p.mic, p.cam, p.hand, p.sharing, p.role, p.waiting, p.canShare];
  const gridSig = JSON.stringify([S.people.map((p) => [...base(p), p.speaking]), S.spot, S.pin]);
  const ctlSig = JSON.stringify([S.people.filter((p) => p.waiting).length, (S.people.find((p) => p.pid === S.me.pid) || {}).canShare, S.locked, S.sharePolicy, S.recording && [S.recording.active, S.recording.owner], S.me.role]);
  const sideSig = JSON.stringify([S.people.map(base), S.spot, S.locked, S.sharePolicy]);
  if (gridSig !== S.gridSig) { S.gridSig = gridSig; paintGrid(); }
  if (ctlSig !== S.ctlSig) { S.ctlSig = ctlSig; paintCtl(); }
  if (sideSig !== S.sideSig) { S.sideSig = sideSig; if (S.panel === 'people' && !S.menu) paintSideBody(false); }
  paintBar();
  scheduleReconcile();
  if (recorder) recorder.onSync(r.recording, S.people);
  // The host's browser starts the recording the meeting was booked with, once, when no recording exists yet.
  if (hostish() && recorder && !S.autoRec && !r.recording && S.meeting.rec !== 'off' && S.me.role === 'host') { S.autoRec = true; recorder.start().catch((e) => toast(e.message)); }
}

function handleEvent(e) {
  if (e.kind === 'chat') {
    if (e.body.ai && e.from !== S.me.pid && false) return;
    S.chat.push({ ...e.body, from: e.from, to: e.to, ts: e.ts });
    if (S.panel !== 'chat' && e.from !== S.me.pid) { S.unread++; paintCtl(); }
    if (S.panel === 'chat') paintSideBody(false);
  } else if (e.kind === 'cmd') {
    const b = e.body; const toMe = e.to === S.me.pid || e.to === '';
    if (b.a === 'mute' && toMe && e.from !== S.me.pid) { if (local.mic) { S.mic = false; local.mic.enabled = false; } toast('The host muted you'); paintCtl(); }
    else if (b.a === 'muteall' && !hostish()) { if (local.mic) { S.mic = false; local.mic.enabled = false; } toast('The host muted everyone'); paintCtl(); }
    else if (b.a === 'camoff' && toMe && e.from !== S.me.pid) { if (S.cam) toggleCam(); toast('The host turned your camera off'); }
    else if (b.a === 'remove' && e.to === S.me.pid) { S.removed = true; leaveRoom('The host removed you from this meeting'); }
    else if (b.a === 'lowerhand' && e.to === S.me.pid) { S.hand = false; paintCtl(); }
    else if (b.a === 'makehost' && e.to === S.me.pid) { toast('You are now a host'); }
    else if (b.a === 'end') { /* the sync's meeting.status ends the room */ }
  } else if (e.kind === 'react') {
    floatEmoji(e.body.e);
  } else if (e.kind === 'notice') {
    const b = e.body;
    if (b.a === 'rec-start') { toast(b.mode === 'video' ? 'Video recording started' : 'Recording for notes started'); }
    else if (b.a === 'rec-stop') toast('Recording stopped');
    else if (b.a === 'rec-takeover') toast(b.name + ' took over the recording');
    else if (b.a === 'joined' && e.from !== S.me.pid && S.people.length < 12) toast(b.name + ' joined');
    else if (b.a === 'acting' && b.pid === S.me.pid) toast('You are now a host because no host is in the room');
  }
}
function floatEmoji() {}

// ---------------------------------------------------------------- subscriptions
function scheduleReconcile() { clearTimeout(reconcileTimer); reconcileTimer = setTimeout(reconcile, 250); }

function wanted() {
  const w = new Map();
  const { model } = layoutModel();
  const level = S.level;
  model.forEach(({ key, p, kind, share }) => {
    if (p.me) return;
    const tr = (p.tracks || []).find((t) => (share ? t.name === 's' : t.name === 'v'));
    if (!tr) return;
    if (!share && !p.cam) return;
    let rid = share ? (level === 'weak' ? 'h' : 'f') : kind === 'big' ? (level === 'weak' ? 'h' : 'f') : kind === 'strip' ? 'q' : level === 'weak' ? 'q' : level === 'fair' ? (model.length > 4 ? 'q' : 'h') : model.length <= 2 ? 'f' : 'h';
    w.set(p.pid + '|' + tr.name, { pid: p.pid, sessionId: p.sessionId, trackName: tr.name, kind: 'video', rid });
  });
  // Sound: everyone while the link is good (a muted person sends almost nothing); only the last few speakers on a weak link.
  const audible = others().filter((p) => (p.tracks || []).some((t) => t.name === 'a'));
  const picked = level === 'weak' ? audible.slice().sort((a, b) => (b.speakAt || 0) - (a.speakAt || 0)).slice(0, 4) : audible.slice(0, 40);
  picked.forEach((p) => w.set(p.pid + '|a', { pid: p.pid, sessionId: p.sessionId, trackName: 'a', kind: 'audio' }));
  return w;
}

let reconciling = false;
async function reconcile() {
  if (reconciling || !rtc || rejoining || S.left) return;
  reconciling = true;
  try {
    const w = wanted();
    const drop = [], add = [], retune = [];
    for (const [k, s] of rtc.subs) {
      const want = w.get(k);
      if (!want || want.sessionId !== s.sessionId) drop.push(k);
      else if (s.kind === 'video' && want.rid !== s.rid) retune.push([k, want.rid]);
    }
    for (const [k, want] of w) { const s = rtc.subs.get(k); if (!s || s.sessionId !== want.sessionId) add.push(want); }
    if (drop.length) { await rtc.drop(drop); drop.forEach((k) => { const r = remote.get(k); if (r && r.el) r.el.remove(); remote.delete(k); }); }
    for (let i = 0; i < add.length; i += 16) await rtc.pull(add.slice(i, i + 16));
    for (const [k, rid] of retune) await rtc.setLayer(k, rid);
    // Videos whose element was rebuilt need their stream again.
    for (const [k, r] of remote) if (r.tkey) { const t = tiles.get(r.tkey); if (t && t.video.srcObject !== r.stream) { t.video.srcObject = r.stream; t.video.play().catch(() => {}); } }
  } catch (e) { console.warn('[meet] reconcile', e.message); }
  finally { reconciling = false; }
}

// ---------------------------------------------------------------- link health and rejoin
async function onStats() {
  if (!rtc || S.left || rejoining) return;
  const st = await rtc.sample();
  // The level changes only after three readings in a row agree, and not in the first ten seconds, when the estimate is still climbing.
  const lvl = Date.now() - S.started < 10000 ? 'good' : linkLevel(st);
  S.levelVotes = lvl === S.levelCand ? (S.levelVotes || 0) + 1 : 1; S.levelCand = lvl;
  if (lvl !== S.level && S.levelVotes >= 3) { S.level = lvl; paintAll(); scheduleReconcile(); }
  // Nothing arriving for a while while others are present: the path is dead.
  const anyone = others().length > 0 && rtc.subs.size > 0;
  if (anyone && st.t && st.bps < 1000) { if (!silentSince) silentSince = Date.now(); if (Date.now() - silentSince > 9000) { silentSince = 0; rejoin('no media for 9 seconds'); } } else silentSince = 0;
  if (S.conn === 'back' && Date.now() - (S.backAt || 0) > 5000) { S.conn = 'ok'; paintBar(); }
  // Speaking rings from the sound the SFU delivers, for people the sync has not flagged yet.
}
function onRtcState(s) {
  if (s === 'disconnected' && S.conn === 'ok') { S.conn = 'drop'; S.dropAt = Date.now(); paintBar(); }
  if (s === 'connected' && S.conn === 'drop') { S.conn = 'back'; S.backAt = Date.now(); S.missedSec = (Date.now() - S.dropAt) / 1000; paintBar(); scheduleReconcile(); }
  if (s === 'failed' && !S.left) rejoin('connection failed');
}
async function rejoin(why) {
  if (rejoining || S.left) return;
  rejoining = true; S.conn = 'drop'; S.dropAt = S.dropAt || Date.now(); paintBar();
  console.warn('[meet] rejoin:', why);
  for (let i = 0; i < 30 && !S.left; i++) {
    try {
      remote.clear(); $$('audio[id^="a-"]').forEach((a) => a.remove());
      await connect(true);
      if (S.sharing && local.screen) { await rtc.publish([{ name: 's', kind: 'video', track: local.screen }]); const all = [...rtc.out.entries()].map(([name, o]) => ({ name, kind: o.kind, mid: o.mid })); await api('meetings/' + MID + '/tracks', { method: 'POST', body: { pid: S.me.pid, tracks: all } }); }
      rejoining = false; S.conn = 'back'; S.backAt = Date.now(); S.missedSec = (Date.now() - S.dropAt) / 1000; paintBar(); scheduleReconcile();
      return;
    } catch (e) {
      if (e.code === 'removed') { rejoining = false; return leaveRoom('The host removed you from this meeting'); }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  rejoining = false;
  if (!S.left) failScreen(new Error('The connection did not come back.'));
}

// ---------------------------------------------------------------- sound level (speaking ring, sent in the sync)
let analyser = null, analyserBuf = null, actx = null;
function measureLevel() {
  if (!local.mic || !S.mic) { S.lvl = 0; return; }
  try {
    if (!analyser) {
      actx = new (window.AudioContext || window.webkitAudioContext)(); const src = actx.createMediaStreamSource(new MediaStream([local.mic]));
      analyser = actx.createAnalyser(); analyser.fftSize = 512; src.connect(analyser); analyserBuf = new Uint8Array(analyser.fftSize);
    }
    analyser.getByteTimeDomainData(analyserBuf);
    let sum = 0; for (const v of analyserBuf) { const d = (v - 128) / 128; sum += d * d; }
    S.lvl = Math.min(100, Math.round(Math.sqrt(sum / analyserBuf.length) * 400));
  } catch { S.lvl = 0; }
}

// ---------------------------------------------------------------- recording
function getRecInput() {
  return { tiles, remote, local, S };
}
function maybeStartRecording() {
  recorder = new Recorder({ MID, S, api, getInput: getRecInput, toast, hostish });
}
async function toggleRecording() {
  if (!recorder) maybeStartRecording();
  if (S.recording && S.recording.active) { if (confirm('Stop the recording?')) await recorder.stop(); }
  else await recorder.start();
}

window.__meet = { S, tiles, get rtc() { return rtc; }, reconcile, rejoin };
