// Meetings: the lobby and the room. The SFU work is in rtc.js. This file draws the room, runs the sync loop (roster, chat,
// host commands), keeps the subscriptions the layout needs, and handles a dropped connection.
import { $, $$, esc, ic, av, hashColor, initials, toast, api, copy, roomLink, whoami, pump, MODE, confirmCard, fmtDay, fmtTime } from './ui.js';
import { Rtc, linkLevel } from './rtc.js';
import { Recorder, confirmStopRecording } from './rec.js';

const params = new URLSearchParams(location.search);
const MID = params.get('m') || '';
const root = $('#meet-root');
const isPhone = () => matchMedia('(max-width: 860px)').matches;
const FEATURES = { brain: true, captions: true, docs: false };
const GUEST = MODE.guest;
const GKEY = params.get('k') || '';
if (GUEST) { FEATURES.brain = false; FEATURES.captions = false; MODE.token = sessionStorage.getItem('meet.gtoken.' + MID) || ''; }
const nav = (staff, guest) => (GUEST ? guest : staff);

const S = {
  meeting: null, me: { pid: sessionStorage.getItem('meet.pid.' + MID) || '', name: '', role: 'staff' }, people: [], events: 0, chat: [], panel: 'people',
  mic: true, cam: true, hand: false, sharing: false, cc: false, conn: 'ok', page: 0, pin: '', spot: '', locked: false, sharePolicy: 'all', menu: null,
  recording: null, lines: [], tx: 0, brainQ: [], show: null, dropRel: null, joined: false, left: false, started: 0, lvl: 0, lastSync: 0, unread: 0, devices: { mic: true, cam: true }, removed: false, level: 'good', speakers: new Map(),
  inv: { text: '', busy: false, rows: [], sugg: [], dir: null, matches: [] }, layout: 'grid', pop: '', syncFails: 0, camId: '', micId: '', spkId: '', seenWait: new Set(), present: [], rtcDown: false,
};
let rtc = null, local = { mic: null, cam: null, screen: null, screenAudio: null }, joinInfo = null, syncTimer = null, statTimer = null, reconcileTimer = null, levelTimer = null, rejoining = false, silentSince = 0, wantRid = new Map();
let recorder = null, barTimer = null, capTimer = null;
const tiles = new Map(); // pid or 'share:pid' -> { el, video, audio }

// ---------------------------------------------------------------- boot
if (!MID) root.innerHTML = '<div class="h-card mt-card"><p>That link is missing the meeting. Open it from Meetings.</p></div>';
else boot();

async function boot() {
  try {
    const r = GUEST ? await api('meetings/' + MID + '/guestinfo?k=' + encodeURIComponent(GKEY)) : await api('meetings/' + MID);
    S.meeting = GUEST ? { id: MID, title: r.title, hostName: r.host, rec: r.rec, status: r.status, startsAt: r.startsAt, backupLink: '', notesStatus: 'none', locked: r.locked } : r.meeting;
    S.guestsEnabled = !!r.guestsEnabled;
    S.present = r.present || [];
    document.title = S.meeting.title + ' - Favor Hub';
    const t = $('.h-top__title'); if (t) t.textContent = S.meeting.title;
    if (GUEST && S.meeting.status === 'ended' && !(S.meeting.startsAt && Date.parse(S.meeting.startsAt) > Date.now())) return ended('This meeting has ended');
    if (S.meeting.status === 'ended' && S.meeting.endedAt && Date.now() - Date.parse(S.meeting.endedAt) > 6 * 3600_000) return ended();
    lobby();
  } catch (e) {
    root.innerHTML = `<div class="h-card mt-card" style="max-width:560px;margin:20px auto"><h2 class="mt-h2">${e.status === 404 ? 'That meeting is not available' : 'Could not open the meeting'}</h2><p class="mt-sub" style="font-size:14px">${esc(e.message)}</p><a class="h-btn h-btn--primary" href="/meet/">Back to meetings</a></div>`;
  }
}

function ended(msg, sub, opts = {}) {
  const notes = () => S.meeting && S.meeting.notesStatus && S.meeting.notesStatus !== 'none';
  const canRejoin = !opts.noRejoin && !(S.meeting && S.meeting.status === 'ended' && S.meeting.endedAt && Date.now() - Date.parse(S.meeting.endedAt) > 6 * 3600_000);
  const links = () => (GUEST || opts.saving ? '' : `<a class="h-btn ${canRejoin ? 'h-btn--ghost' : 'h-btn--primary'}" href="/meet/">Back to meetings</a>${notes() ? `<a class="h-btn h-btn--ghost" href="/meet/notes/?m=${S.meeting.id}">Open the notes</a>` : ''}`);
  root.innerHTML = `<div class="h-card mt-card mt-ended" style="max-width:560px;margin:12vh auto 20px;display:grid;gap:12px"><h2 class="mt-h2">${esc(msg || 'This meeting has ended')}</h2><p class="mt-sub" style="font-size:14px;margin:0">${sub ? esc(sub) : !GUEST && notes() ? 'The notes are in Meeting notes.' : ''}</p><div style="display:flex;gap:10px;flex-wrap:wrap" id="end-acts">${canRejoin ? '<button class="h-btn h-btn--primary" id="rejoin-btn">Rejoin</button>' : ''}<span id="end-links" style="display:contents">${links()}</span></div></div>`;
  const rj = $('#rejoin-btn'); if (rj) { rj.addEventListener('click', rejoinAfterLeave); rj.focus(); }
  const ask = document.getElementById('nudge-ask'); const card = root.querySelector('.mt-ended'); if (ask && card) card.appendChild(ask);
  // The meeting row from join time is stale by now. Read it again so the notes link shows when notes exist.
  if (!GUEST && MID) api('meetings/' + MID).then((r) => {
    if (!r.meeting) return; S.meeting = r.meeting;
    const l = $('#end-links'); if (l) l.innerHTML = links();
    const p = $('#meet-root .mt-sub'); if (p && !sub && notes()) p.textContent = 'The notes are in Meeting notes.';
  }).catch(() => {});
}
// Back to the lobby after leaving or after the meeting ended, with the room state cleared.
function rejoinAfterLeave() {
  Object.assign(S, { left: false, joined: false, removed: false, conn: 'ok', gridSig: null, ctlSig: null, sideSig: null, spot: '', pin: '', page: 0, sharing: false, hand: false, show: null, recording: null, pop: '', menu: null, syncFails: 0, unread: 0, level: 'good', levelVotes: 0, levelCand: '', autoRec: false, people: [] });
  local = { mic: null, cam: null, screen: null, screenAudio: null }; rtc = null; recorder = null; rejoining = false; syncing = false; analyser = null;
  remote.clear(); tiles.clear();
  S.devices = { mic: true, cam: true }; S.mic = true; S.cam = true;
  lobby();
}

// ---------------------------------------------------------------- lobby
let preview = null, lbTimer = null, lbCtx = null;
const rel = (ms) => { const m = Math.round(ms / 60000); if (m < 1) return 'less than a minute'; if (m < 60) return m + (m === 1 ? ' minute' : ' minutes'); const h = Math.floor(m / 60); if (h < 24) return h + (h === 1 ? ' hour' : ' hours') + (m % 60 ? ' ' + (m % 60) + ' min' : ''); const d = Math.round(h / 24); return d + (d === 1 ? ' day' : ' days'); };
function whenLine(m) {
  if (m.status === 'live') return 'This meeting is live now.';
  if (!m.startsAt) return '';
  const t = Date.parse(m.startsAt); if (!t) return '';
  const at = fmtDay(m.startsAt) + ' at ' + fmtTime(m.startsAt);
  return t > Date.now() ? 'Scheduled for ' + at + '. Starts in ' + rel(t - Date.now()) + '.' : 'Scheduled for ' + at + '. It started ' + rel(Date.now() - t) + ' ago.';
}
const permHelp = (e) => (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'Your browser blocked the camera and microphone. Click the lock icon at the left of the address bar, set Camera and Microphone to Allow, then reload this page.' : '');
async function lobby() {
  const m = S.meeting;
  if (lbTimer) { clearInterval(lbTimer); lbTimer = null; }
  const recLine = m.rec === 'video' ? 'This meeting records video and makes notes. Everyone sees a recording notice.' : m.rec === 'notes' ? 'This meeting records sound for notes. Everyone sees a notice.' : 'This meeting is not recorded.';
  const name = GUEST ? '' : (await whoami()).name || '';
  const consent = GUEST && m.rec !== 'off' ? `<label class="lb-consent"><input type="checkbox" id="lb-consent" /><div><b>I agree to be recorded</b><span>${m.rec === 'video' ? 'Video and sound are recorded and written up.' : 'The sound is recorded to make notes.'} Florida law asks every person for consent.</span></div></label>` : '';
  const when = whenLine(m);
  const inRoom = !GUEST && S.present && S.present.length ? `<div class="lb-in">${S.present.slice(0, 4).map((n) => av(n)).join('')}<span>${esc(S.present.slice(0, 3).join(', '))}${S.present.length > 3 ? ' and ' + (S.present.length - 3) + ' more' : ''} ${S.present.length === 1 ? 'is' : 'are'} in the room.</span></div>` : '';
  root.innerHTML = `<div class="h-card mt-card lobby" style="max-width:980px;margin:6px auto"><div class="prev" id="lb-prev"><video id="lb-video" muted playsinline autoplay></video><span class="face" id="lb-face">${esc(initials(name))}</span><div class="cl"><button class="cb is-on" id="lb-mic" aria-label="Microphone" aria-pressed="true"><span class="k">${ic('mic')}</span></button><button class="cb is-on" id="lb-cam" aria-label="Camera" aria-pressed="true"><span class="k">${ic('video')}</span></button></div></div>
    <div style="display:grid;gap:12px"><div class="h-label">Ready to join?</div><h2 class="mt-h2" style="font-size:28px">${esc(m.title)}</h2>
      <p class="lb-line"><span>${esc(m.hostName ? 'Host: ' + m.hostName : '')}</span>${when ? `<span>${esc(when)}</span>` : ''}</p>${inRoom}
      <p class="mt-sub" style="font-size:14px;margin:0" id="lb-who">${esc(recLine)}</p>
      <div class="mt-f"><label for="lb-name">Your name in the room</label><input id="lb-name" value="${esc(name)}" maxlength="60" ${GUEST ? 'placeholder="First and last name"' : ''} /></div>${consent}
      <div class="lb-dev" id="lb-devs" hidden></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="h-btn h-btn--primary" id="lb-join">${ic('video')}Join now</button>${GUEST ? '' : '<a class="h-btn h-btn--ghost" href="/meet/">Not yet</a>'}</div>
      <p class="mt-sub" style="margin:0" id="lb-dev">Checking your camera and microphone.</p><p class="lb-help" id="lb-help" hidden></p></div></div>`;
  $('#lb-join').addEventListener('click', enter);
  $('#lb-mic').addEventListener('click', () => { S.mic = !S.mic; lobbyButtons(); });
  $('#lb-cam').addEventListener('click', () => { S.cam = !S.cam; lobbyButtons(); lobbyVideo(); });
  let denied = null;
  try {
    preview = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 1280, height: 720 } });
    $('#lb-dev').textContent = 'Camera and microphone ready.';
  } catch (e1) {
    denied = e1;
    try { preview = await navigator.mediaDevices.getUserMedia({ audio: true }); S.devices.cam = false; S.cam = false; $('#lb-dev').textContent = 'No camera found or allowed. You can still join with sound.'; }
    catch (e2) { denied = e2; preview = null; S.devices = { mic: false, cam: false }; S.mic = false; S.cam = false; $('#lb-dev').textContent = 'No camera or microphone is available. You can join to watch and listen, and chat.'; }
  }
  const help = permHelp(denied); if (help) { const h = $('#lb-help'); if (h) { h.textContent = help; h.hidden = false; } }
  lobbyButtons(); lobbyVideo(); lobbyDevices(); lobbyMeter();
}
async function deviceList() {
  try { const all = await navigator.mediaDevices.enumerateDevices(); return { mics: all.filter((d) => d.kind === 'audioinput' && d.deviceId), cams: all.filter((d) => d.kind === 'videoinput' && d.deviceId), spks: all.filter((d) => d.kind === 'audiooutput' && d.deviceId) }; }
  catch { return { mics: [], cams: [], spks: [] }; }
}
const optList = (list, cur, fallback) => list.map((d, i) => `<option value="${esc(d.deviceId)}" ${d.deviceId === cur ? 'selected' : ''}>${esc(d.label || fallback + ' ' + (i + 1))}</option>`).join('');
async function lobbyDevices() {
  const box = $('#lb-devs'); if (!box || !preview) return;
  const { mics, cams } = await deviceList();
  if (!mics.length && !cams.length) return;
  const curMic = preview.getAudioTracks()[0] && preview.getAudioTracks()[0].getSettings().deviceId;
  const curCam = preview.getVideoTracks()[0] && preview.getVideoTracks()[0].getSettings().deviceId;
  box.innerHTML = (mics.length ? `<label>Microphone<select id="lb-micsel" aria-label="Change microphone">${optList(mics, curMic, 'Microphone')}</select></label>` : '') + (cams.length ? `<label>Camera<select id="lb-camsel" aria-label="Change camera">${optList(cams, curCam, 'Camera')}</select></label>` : '') + '<div class="lb-meter" aria-hidden="true"><i id="lb-lvl"></i></div>';
  box.hidden = false;
  const swap = async (kind, id) => {
    try {
      const ns = await navigator.mediaDevices.getUserMedia(kind === 'audio' ? { audio: { deviceId: { exact: id } } } : { video: { deviceId: { exact: id }, width: 1280, height: 720 } });
      const old = kind === 'audio' ? preview.getAudioTracks()[0] : preview.getVideoTracks()[0];
      if (old) { preview.removeTrack(old); old.stop(); }
      preview.addTrack(ns.getTracks()[0]);
      if (kind === 'audio') { S.micId = id; lbCtx = null; lobbyMeter(true); } else { S.camId = id; lobbyVideo(true); }
    } catch { toast('That device did not open.'); }
  };
  $('#lb-micsel') && $('#lb-micsel').addEventListener('change', (e) => swap('audio', e.target.value));
  $('#lb-camsel') && $('#lb-camsel').addEventListener('change', (e) => swap('video', e.target.value));
}
function lobbyMeter(reset) {
  if (lbTimer && !reset) return;
  if (lbTimer) clearInterval(lbTimer);
  const track = preview && preview.getAudioTracks()[0]; if (!track) return;
  let an, buf;
  try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); lbCtx = ctx; const src = ctx.createMediaStreamSource(new MediaStream([track])); an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an); buf = new Uint8Array(an.fftSize); } catch { return; }
  lbTimer = setInterval(() => {
    const i = $('#lb-lvl'); if (!i) { clearInterval(lbTimer); lbTimer = null; try { lbCtx && lbCtx.close(); } catch {} return; }
    an.getByteTimeDomainData(buf); let sum = 0; for (const v of buf) { const d = (v - 128) / 128; sum += d * d; }
    i.style.width = (S.mic ? Math.min(100, Math.round(Math.sqrt(sum / buf.length) * 400)) : 0) + '%';
  }, 120);
}
function lobbyButtons() {
  const mic = $('#lb-mic'), cam = $('#lb-cam'); if (!mic) return;
  mic.className = 'cb ' + (S.mic ? 'is-on' : 'is-off'); mic.innerHTML = `<span class="k">${ic(S.mic ? 'mic' : 'micOff')}</span>`; mic.setAttribute('aria-pressed', String(S.mic));
  cam.className = 'cb ' + (S.cam ? 'is-on' : 'is-off'); cam.innerHTML = `<span class="k">${ic(S.cam ? 'video' : 'videoOff')}</span>`; cam.setAttribute('aria-pressed', String(S.cam));
}
function lobbyVideo() {
  const v = $('#lb-video'); if (!v) return;
  const has = preview && preview.getVideoTracks().length && S.cam;
  v.style.display = has ? 'block' : 'none';
  if (has) { v.srcObject = preview; v.play().catch(() => {}); }
}

// ---------------------------------------------------------------- joining
async function enter() {
  const name = ($('#lb-name').value || '').trim() || (GUEST ? '' : 'Guest');
  if (GUEST) { if (name.length < 2) { toast('Type your name so the host knows who you are.'); return; } if ($('#lb-consent') && !$('#lb-consent').checked) { toast('Tick the box to accept the recording notice.'); return; } }
  if (lbTimer) { clearInterval(lbTimer); lbTimer = null; }
  $('#lb-join').disabled = true; $('#lb-join').innerHTML = '<span class="spin"></span>Connecting to the room';
  const slow = setTimeout(() => { const d = $('#lb-dev'); if (d) d.textContent = 'Still connecting. This can take up to 20 seconds.'; }, 6000);
  S.me.name = name;
  if (preview) { local.mic = preview.getAudioTracks()[0] || null; local.cam = preview.getVideoTracks()[0] || null; }
  if (local.mic) local.mic.enabled = S.mic;
  try {
    const j = await withTimeout(joinCall(false), 20000);
    if (j.waiting) await waitAdmit();
    await withTimeout(openRtc(j, false), 20000);
    clearTimeout(slow);
  } catch (e) {
    clearTimeout(slow);
    if (e.leftWait) { ended('You left the waiting room'); return; }
    if (e.status === 403 || e.status === 404 || e.status === 410 || e.status === 429 || e.status === 400) { root.innerHTML = `<div class="h-card mt-card" style="max-width:560px;margin:20px auto;display:grid;gap:12px"><h2 class="mt-h2">You cannot join this meeting</h2><p class="mt-sub" style="font-size:14px;margin:0">${esc(e.message)}</p>${GUEST ? '' : '<a class="h-btn h-btn--primary" href="/meet/">Back to meetings</a>'}</div>`; return; }
    failScreen(e); return;
  }
  S.joined = true; S.started = Date.now(); S.joinedAt = Date.now();
  buildRoom();
  startLoops();
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('The room did not load in time.')), ms))]);

async function joinCall(isRejoin) {
  const body = { pid: S.me.pid || undefined, name: S.me.name, mic: S.mic, cam: S.cam };
  if (GUEST) { body.k = GKEY; body.accepted = !!($('#lb-consent') ? $('#lb-consent').checked : true) || isRejoin; }
  const j = await api('meetings/' + MID + '/join', { method: 'POST', body });
  if (GUEST && j.token) { MODE.token = j.token; sessionStorage.setItem('meet.gtoken.' + MID, j.token); }
  joinInfo = j; S.me.pid = j.pid; S.me.role = j.role; S.events = isRejoin ? S.events : j.since;
  sessionStorage.setItem('meet.pid.' + MID, j.pid);
  S.meeting = j.meeting;
  S.guestsEnabled = !!j.guestsEnabled;
  return j;
}

// A guest stays on this screen until a host lets them in. Nothing is published or pulled before that.
async function waitAdmit() {
  root.innerHTML = `<div class="h-card mt-card" style="max-width:560px;margin:20px auto;display:grid;gap:12px" role="status"><h2 class="mt-h2"><span class="spin"></span>Waiting for the host</h2><p class="mt-sub" style="font-size:14px;margin:0">${esc(S.meeting.hostName || 'The host')} will let you in to ${esc(S.meeting.title)} shortly. Keep this page open.</p><div><button class="h-btn h-btn--ghost" id="wait-leave">Leave</button></div></div>`;
  let cancel = false;
  $('#wait-leave').addEventListener('click', () => { cancel = true; api('meetings/' + MID + '/leave', { method: 'POST', body: { pid: S.me.pid } }).catch(() => {}); });
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    if (cancel) throw Object.assign(new Error('You left the waiting room.'), { leftWait: true });
    let r;
    try { r = await api('meetings/' + MID + '/sync', { method: 'POST', body: { pid: S.me.pid, since: S.events, me: { mic: S.mic, cam: S.cam, lvl: 0 } } }); }
    catch (e) { if (e.code === 'removed') throw Object.assign(new Error('The host did not let you in.'), { status: 403 }); continue; }
    if (r.meeting.status === 'ended') throw Object.assign(new Error('This meeting has ended.'), { status: 410 });
    if (!r.me.waiting) { S.me.role = r.role; return; }
  }
}

async function connect(isRejoin) {
  const j = await joinCall(isRejoin);
  if (j.waiting) await waitAdmit();
  await openRtc(j, isRejoin);
}

async function openRtc(j, isRejoin) {
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
  $('#retry').addEventListener('click', () => (GUEST ? location.reload() : lobby()));
}

// ---------------------------------------------------------------- the room
function buildRoom() {
  document.getElementById('h-app').classList.add('is-room');
  root.innerHTML = `<div class="rm" id="rm"><section class="rm-stage" aria-label="Meeting"><div class="rm-top"><div class="rm-bar" id="rm-bar"></div><div class="rm-tools" id="rm-tools"></div></div><div id="rm-banner"></div><div id="rm-wait"></div><div class="rm-grid" id="rm-grid"></div><div class="rm-hint" id="rm-hint" hidden></div><div class="rm-cap" id="rm-cap" hidden aria-live="off"></div><div id="rm-pop-wrap"></div><div class="rm-ctl" id="rm-ctl" role="toolbar" aria-label="Meeting controls"></div></section><aside class="rm-side" id="rm-side" aria-label="Meeting panel"></aside></div>`;
  S.panel = isPhone() ? '' : 'people';
  paintAll();
  dragToClose($('#rm-side'));
  window.addEventListener('resize', fitCtl);
  window.addEventListener('keydown', onKey);
  document.addEventListener('input', onInvInput);
  document.addEventListener('focusin', (e) => { if (e.target && e.target.id === 'invin') loadDirectory(); });
  window.addEventListener('beforeunload', onUnload);
  document.addEventListener('click', onDocClick);
  if (!GUEST && S.me.role !== 'guest') maybeStartRecording();
}

const mePerson = () => ({ pid: S.me.pid, name: S.me.name, role: S.me.role, mic: S.mic, cam: S.cam && !!local.cam, hand: S.hand, sharing: S.sharing, speaking: S.lvl > 12 && S.mic, me: true });
const hostish = () => S.me.role === 'host' || S.me.role === 'cohost';
const others = () => S.people.filter((p) => p.pid !== S.me.pid && !p.waiting);
const nameOf = (pid) => (pid === S.me.pid ? S.me.name : (S.people.find((p) => p.pid === pid) || {}).name || 'Someone');

function paintAll() { paintBar(); paintTools(); paintGrid(); paintCtl(); paintSide(); }

// Keep keyboard focus on the same control when a bar is repainted (R4).
function keepFocus(container, fn) {
  const ae = document.activeElement;
  const inside = container && ae && ae !== document.body && container.contains(ae);
  const k = inside ? { a: ae.dataset && ae.dataset.a, p: ae.dataset && ae.dataset.p, pid: ae.dataset && ae.dataset.pid, id: ae.id } : null;
  fn();
  if (!k) return;
  const sel = k.a ? '[data-a="' + k.a + '"]' + (k.p ? '[data-p="' + k.p + '"]' : '') + (k.pid ? '[data-pid="' + k.pid + '"]' : '') : k.id ? '#' + k.id : '';
  const n = sel && container.querySelector(sel); if (n && n !== document.activeElement) n.focus({ preventScroll: true });
}
function fitCtl() { const el = $('#rm-ctl'), st = $('#rm'); if (el && st) st.style.setProperty('--ctl-h', el.offsetHeight + 'px'); }
const sheetMode = () => isPhone() && !matchMedia('(max-height: 500px)').matches;
// Drag the phone sheet down to close it (R9).
function dragToClose(side) {
  if (!side) return;
  let d = null;
  side.addEventListener('touchstart', (e) => { if (!sheetMode() || !e.target.closest('.rm-grab, .rm-tabs')) return; d = { y: e.touches[0].clientY, dy: 0 }; side.classList.add('is-drag'); }, { passive: true });
  side.addEventListener('touchmove', (e) => { if (!d) return; d.dy = Math.max(0, e.touches[0].clientY - d.y); side.style.transform = 'translateY(' + d.dy + 'px)'; }, { passive: true });
  const end = () => { if (!d) return; const close = d.dy > 90; d = null; side.classList.remove('is-drag'); side.style.transform = ''; if (close) { S.panel = ''; paintCtl(); paintSide(); } };
  side.addEventListener('touchend', end); side.addEventListener('touchcancel', end);
}

// The tools beside the title: reactions, layout, full screen, copy link, devices (R8, R25).
function paintTools() {
  const el = $('#rm-tools'); if (!el) return;
  keepFocus(el, () => {
    el.innerHTML = `<button class="rt${S.pop === 'react' ? ' is-on' : ''}" data-a="pop" data-p="react" aria-label="Reactions" aria-haspopup="dialog" aria-expanded="${S.pop === 'react'}">${ic('smile')}</button>
      <button class="rt" data-a="layout" aria-label="${S.layout === 'grid' ? 'Switch to speaker view' : 'Switch to gallery view'}" title="${S.layout === 'grid' ? 'Speaker view' : 'Gallery view'}">${ic(S.layout === 'grid' ? 'speaker' : 'grid')}</button>
      ${document.fullscreenEnabled ? `<button class="rt" data-a="fullscreen" aria-label="Full screen" title="Full screen">${ic('expand')}</button>` : ''}
      ${GUEST ? '' : `<button class="rt" data-a="copylink" aria-label="Copy meeting link">${ic('link')}<span class="lb-t">Copy link</span></button>`}
      <button class="rt${S.pop === 'dev' ? ' is-on' : ''}" data-a="pop" data-p="dev" aria-label="Camera, microphone and speaker" aria-haspopup="dialog" aria-expanded="${S.pop === 'dev'}">${ic('gear')}</button>`;
  });
}

const EMOJI = ['\u{1F44D}', '\u{1F44F}', '\u2764\uFE0F', '\u{1F602}', '\u{1F62E}', '\u{1F389}'];
async function paintPop() {
  const el = $('#rm-pop-wrap'); if (!el) return;
  if (!S.pop) { el.innerHTML = ''; return; }
  if (S.pop === 'react') { el.innerHTML = `<div class="rm-pop" role="dialog" aria-label="Reactions"><div class="emo">${EMOJI.map((e) => `<button data-a="emoji" data-e="${e}" aria-label="React ${e}">${e}</button>`).join('')}</div></div>`; const b = el.querySelector('button'); b && b.focus(); return; }
  const { mics, cams, spks } = await deviceList();
  if (S.pop !== 'dev') return;
  const curMic = local.mic && local.mic.getSettings().deviceId, curCam = (local.cam && local.cam.getSettings().deviceId) || S.camId;
  el.innerHTML = `<div class="rm-pop" role="dialog" aria-label="Devices">
    ${mics.length ? `<label>Microphone<select data-dev="mic">${optList(mics, curMic, 'Microphone')}</select></label>` : ''}
    ${cams.length ? `<label>Camera<select data-dev="cam">${optList(cams, curCam, 'Camera')}</select></label>` : ''}
    ${spks.length && 'setSinkId' in HTMLMediaElement.prototype ? `<label>Speaker<select data-dev="spk">${optList(spks, S.spkId, 'Speaker')}</select></label>` : ''}
    ${!mics.length && !cams.length ? '<p class="mt-sub" style="margin:0">No devices were found. Check that the browser may use the camera and microphone.</p>' : ''}</div>`;
  const s = el.querySelector('select'); s && s.focus();
  el.querySelectorAll('select[data-dev]').forEach((sel) => sel.addEventListener('change', () => switchDevice(sel.dataset.dev, sel.value)));
}
async function switchDevice(kind, id) {
  try {
    if (kind === 'spk') { S.spkId = id; $$('audio[id^="a-"]').forEach((a) => a.setSinkId && a.setSinkId(id).catch(() => {})); return; }
    if (kind === 'mic') {
      const ns = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: id } } }); const t = ns.getAudioTracks()[0]; t.enabled = S.mic;
      if (local.mic) local.mic.stop(); local.mic = t; S.micId = id; analyser = null; try { actx && actx.close(); } catch {} actx = null;
      await rtc.replace('a', t); return;
    }
    S.camId = id;
    if (S.cam) {
      const ns = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: id }, width: 1280, height: 720 } }); const t = ns.getVideoTracks()[0];
      if (local.cam) local.cam.stop(); local.cam = t; await rtc.replace('v', t); paintGrid();
    }
  } catch { toast('That device did not open.'); }
}

function floatEmoji(e, name) {
  const st = $('.rm-stage'); if (!st || !e) return;
  const n = document.createElement('div'); n.className = 'rx'; n.style.left = (12 + Math.random() * 70) + '%';
  n.innerHTML = '<i></i><span></span>'; n.firstChild.textContent = e; n.lastChild.textContent = name || '';
  st.appendChild(n); setTimeout(() => n.remove(), 2700);
}
function chime() {
  try {
    const c = new (window.AudioContext || window.webkitAudioContext)();
    [660, 880].forEach((fq, i) => { const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + i * 0.16; o.frequency.value = fq; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.15, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15); o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.16); });
    setTimeout(() => c.close(), 800);
  } catch { /* no sound is fine */ }
}
// A person waiting to be let in: a bar with the button, a toast and a chime for the hosts (R16).
function paintWait(waiting) {
  const el = $('#rm-wait'); if (!el) return;
  if (!waiting.length) { el.innerHTML = ''; return; }
  const p = waiting[0];
  el.innerHTML = `<div class="rm-wait" role="status"><span><b>${esc(p.name)}</b> is waiting to join${waiting.length > 1 ? ' (and ' + (waiting.length - 1) + ' more)' : ''}.</span><button class="h-btn h-btn--primary h-btn--sm" data-a="cmd" data-c="letin" data-pid="${p.pid}">Let in</button></div>`;
}

function paintBar() {
  const m = S.meeting; const r = S.recording;
  const el = $('#rm-bar'); if (!el) return;
  const mins = Math.floor((Date.now() - S.started) / 60000);
  const secs = Math.floor(((Date.now() - S.started) / 1000) % 60);
  const rec = r && r.active ? (r.mode === 'video' ? `<span class="rm-rec"><i></i>Recording</span>` : `<span class="rm-rec is-notes"><i></i>Notes on</span>`) : (m.rec !== 'off' ? `<span class="rm-rec is-notes"><i></i>${!r && Date.now() - S.started < 10000 ? 'Starting' : m.rec === 'video' ? 'Recording off' : 'Notes off'}</span>` : '');
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
  ['playing', 'loadeddata'].forEach((ev) => t.video.addEventListener(ev, () => el.classList.add('is-live')));
  ['emptied', 'abort'].forEach((ev) => t.video.addEventListener(ev, () => el.classList.remove('is-live')));
  if (share) { el.addEventListener('click', () => el.classList.toggle('is-zoom')); el.addEventListener('mousemove', (e) => { if (!el.classList.contains('is-zoom')) return; const r = el.getBoundingClientRect(); t.video.style.transformOrigin = ((e.clientX - r.left) / r.width * 100) + '% ' + ((e.clientY - r.top) / r.height * 100) + '%'; }); }
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
  let big = S.pin || S.spot;
  if (!big && S.layout === 'speaker' && everyone.length > 1) big = speakerPid(everyone);
  const rank = (p) => (p.pid === big ? -1 : p.role === 'host' ? 0 : 1);
  const sorted = everyone.slice().sort((a, b) => rank(a) - rank(b) || (b.speakAt || 0) - (a.speakAt || 0) || (a.joinedAt || 0) - (b.joinedAt || 0));
  return { sharer, big, sorted };
}

// Speaker view follows whoever spoke last, and holds a pick for three seconds so the layout does not jump.
function speakerPid(everyone) {
  const cand = everyone.filter((p) => !p.me).sort((a, b) => (b.speakAt || 0) - (a.speakAt || 0) || (a.role === 'host' ? -1 : 1))[0] || everyone[0];
  const h = S.spkHold;
  if (h && h.pid !== cand.pid && Date.now() - h.at < 3000 && everyone.some((p) => p.pid === h.pid)) return h.pid;
  if (!h || h.pid !== cand.pid) S.spkHold = { pid: cand.pid, at: Date.now() };
  return cand.pid;
}
const perPage = () => (isPhone() ? 4 : S.level === 'weak' ? 4 : 9);

function layoutModel() {
  const { sharer, big, sorted } = order();
  const model = []; // { key, p, kind: 'big' | 'tile' | 'strip' }
  const spotMode = sharer || S.show || (big && sorted.find((p) => p.pid === big));
  if (spotMode) {
    if (sharer) model.push({ key: 'share:' + sharer.pid, p: sharer, kind: 'big', share: true });
    else if (S.show) model.push({ key: 'brain', p: { pid: 'brain', name: 'Favor Brain' }, kind: 'big', brain: true });
    else model.push({ key: big, p: sorted.find((p) => p.pid === big), kind: 'big' });
    const rest = sorted.filter((p) => !(model[0].key === p.pid));
    const cap = isPhone() ? 3 : 4;
    if (rest.length > cap) { rest.slice(0, cap - 1).forEach((p) => model.push({ key: p.pid, p, kind: 'strip' })); model.push({ key: 'more', kind: 'more', n: rest.length - (cap - 1) }); }
    else rest.forEach((p) => model.push({ key: p.pid, p, kind: 'strip' }));
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
  grid.className = 'rm-grid' + (spot ? ' is-spot' : '') + (spot && n === 1 ? ' is-alone' : '') + (!spot && n === 1 ? ' is-one' : '');
  grid.style.gridTemplateColumns = spot ? (isPhone() && n > 1 ? `repeat(${n - 1}, minmax(0, 1fr))` : '') : `repeat(${n <= 1 ? 1 : n <= 4 ? 2 : 3}, minmax(0, 1fr))`;
  if (spot && !isPhone()) grid.style.gridTemplateRows = `repeat(${Math.max(1, Math.min(4, n - 1))}, minmax(0, 1fr))`; else grid.style.gridTemplateRows = '';
  const keep = new Set(model.map((x) => x.key));
  for (const [k, t] of tiles) if (!keep.has(k)) t.el.remove();
  if (!model.some((x) => x.brain)) { const bt = document.getElementById('rm-brain-tile'); if (bt) bt.remove(); }
  const mt0 = document.getElementById('rm-more-tile'); if (mt0 && !model.some((x) => x.kind === 'more')) mt0.remove();
  model.forEach(({ key, p, kind, share, brain, n: moreN }, i) => {
    if (brain) { paintBrainTile(grid, i); return; }
    if (kind === 'more') {
      let el = document.getElementById('rm-more-tile');
      if (!el) { el = document.createElement('div'); el.id = 'rm-more-tile'; el.className = 'mt-tile mt-more'; el.setAttribute('role', 'button'); el.tabIndex = 0; el.dataset.a = 'panel'; el.dataset.p = 'people'; }
      el.innerHTML = `<span>+${moreN}<small>more in the meeting</small></span>`;
      if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] || null);
      return;
    }
    let t = tiles.get(key) || makeTile(key, p, !!share);
    if (!t.el.isConnected || t.el.parentNode !== grid) grid.appendChild(t.el);
    if (grid.children[i] !== t.el) grid.insertBefore(t.el, grid.children[i] || null);
    t.pid = p.pid; t.kind = kind;
    t.el.classList.toggle('is-big', kind === 'big');
    t.el.classList.toggle('mt-tile--share', !!share);
    t.el.classList.toggle('is-talk', !!p.speaking && !share);
    t.el.style.background = share ? '' : `linear-gradient(145deg, ${hashColor(p.name)}, #1f261d 130%)`;
    const camOn = share ? true : p.me ? S.cam && !!local.cam : p.cam && haveVideo(p.pid);
    const face = t.el.querySelector('.face'); face.textContent = initials(p.name); face.style.display = share ? 'none' : '';
    t.el.classList.toggle('has-cam', !!camOn && !share);
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
      if (S.spkId && el.setSinkId) el.setSinkId(S.spkId).catch(() => {});
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
  const h = hostish();
  const recOn = S.recording && S.recording.active;
  const canShare = h || (S.sharePolicy === 'all' && (S.people.find((p) => p.pid === S.me.pid) || {}).canShare !== false);
  const waiting = h ? S.people.filter((p) => p.waiting).length : 0;
  const lab = (full, short) => `<span class="lb-f">${full}</span><span class="lb-s">${short}</span>`;
  const canDisplay = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !isPhone();
  keepFocus(el, () => {
    el.innerHTML = `
    <button class="cb${S.mic ? '' : ' is-off'}" data-a="mic"><span class="k">${ic(S.mic ? 'mic' : 'micOff')}</span>${S.mic ? 'Mute' : 'Unmute'}</button>
    <button class="cb${S.cam ? '' : ' is-off'}" data-a="cam" aria-pressed="${S.cam}"><span class="k">${ic(S.cam ? 'video' : 'videoOff')}</span>Camera</button>
    ${canDisplay ? `<button class="cb${S.sharing ? ' is-on' : ''}" data-a="share" aria-pressed="${S.sharing}" ${canShare ? '' : 'disabled title="The host limited sharing"'}><span class="k">${ic('screen')}</span>${S.sharing ? 'Stop share' : 'Share'}</button>` : ''}
    ${FEATURES.captions ? `<button class="cb${S.cc ? ' is-on' : ''}" data-a="cc" aria-pressed="${S.cc}"><span class="k">${ic('cc')}</span>${lab('Captions', 'CC')}</button>` : ''}
    ${h && S.meeting.rec !== 'off' ? `<button class="cb${recOn ? ' is-off' : ''}" data-a="rec"><span class="k">${ic('rec')}</span>${recOn ? lab('Stop rec', 'Stop') : lab('Record', 'Rec')}</button>` : ''}
    <button class="cb${S.hand ? ' is-on' : ''}" data-a="hand"><span class="k">${ic('hand')}</span><span class="l-full">${S.hand ? 'Lower hand' : 'Raise hand'}</span><span class="l-short">${S.hand ? 'Lower' : 'Hand'}</span></button>
    <span class="rm-sep"></span>
    <button class="cb${S.panel === 'chat' ? ' is-on' : ''}" data-a="panel" data-p="chat" aria-pressed="${S.panel === 'chat'}"><span class="k badge">${ic('chat')}${S.unread ? `<span class="dotc">${S.unread}</span>` : ''}</span>Chat</button>
    <button class="cb${S.panel === 'people' ? ' is-on' : ''}" data-a="panel" data-p="people" aria-pressed="${S.panel === 'people'}"><span class="k badge">${ic('users')}${waiting ? `<span class="dotc">${waiting}</span>` : ''}</span>People</button>
    ${FEATURES.brain ? `<button class="cb${S.panel === 'brain' ? ' is-on' : ''}" data-a="panel" data-p="brain" aria-pressed="${S.panel === 'brain'}"><span class="k">${ic('brain')}</span>Brain</button>` : ''}
    <button class="cb leave" data-a="leave"><span class="k">${ic('leave')}</span>Leave</button>`;
  });
  const hint = $('#rm-hint');
  if (hint) { const no = canDisplay && !canShare; hint.hidden = !no; if (no) hint.textContent = 'The host limited screen sharing.'; }
  fitCtl();
}

// ---- side panel
function paintSide() {
  const el = $('#rm-side'); if (!el) return;
  const rm = $('#rm'); rm.classList.toggle('is-solo', !S.panel);
  el.style.display = S.panel ? '' : 'none';
  if (!S.panel) return;
  const tab = (p, l, i) => `<button role="tab" aria-selected="${S.panel === p}" data-a="panel" data-p="${p}" class="${S.panel === p ? 'is-on' : ''}">${ic(i)}${l}</button>`;
  keepFocus(el, () => { el.innerHTML = `<div class="rm-grab" aria-hidden="true"></div><div class="rm-tabs" role="tablist" aria-label="Meeting panel">${tab('chat', 'Chat', 'chat')}${tab('people', 'People', 'users')}${FEATURES.brain ? tab('brain', 'Brain', 'brain') : ''}<button class="x icon-b" data-a="panel-close" aria-label="Close the panel">${ic('x')}</button></div><div class="rm-body" id="rm-body" role="tabpanel"></div><div id="rm-input"></div>`; });
  paintSideBody(true);
}

function chatHTML(m) {
  const f = m.file;
  const you = m.from === S.me.pid;
  return `<div class="msg">${m.ai ? `<span class="mt-av" style="background:var(--h-brand)">${ic('brain')}</span>` : av(m.name)}<div><b>${m.ai ? 'Favor Brain, posted by ' + esc(you ? 'you' : m.name) : esc(you ? 'You' : m.name)}${m.to ? ' <i class="mt-sub">(private)</i>' : ''}</b><time>${new Date(m.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</time>${m.text ? `<p>${linkify(m.text)}</p>` : ''}${f ? `<div class="file"><span class="fi ${esc(f.type || 'doc')}">${esc((f.type || 'doc').slice(0, 3).toUpperCase())}</span><div style="min-width:0"><b>${esc(f.name)}</b><span>${esc(f.by || '')}</span></div><div class="acts"><a class="h-btn h-btn--ghost h-btn--sm" href="${esc(f.url)}" target="_blank" rel="noopener">${ic('drive')}Open in Drive</a></div></div>` : ''}</div></div>`;
}
const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:var(--h-brand-ink)">$1</a>');

const invRow = (r) => `<div class="rm-inv__r is-${r.status}"><span>${esc(r.to)}</span><b>${r.status === 'failed' ? 'Failed' : r.status === 'dry' ? 'Checked' : 'Sent'}</b>${r.detail && r.status !== 'sent' ? `<i>${esc(r.detail)}</i>` : ''}</div>`;
function footHTML() {
  if (!hostish()) return '';
  const v = S.inv;
  return `<div class="rm-inv"><div class="rm-inv__t">Invite</div><div class="rm-input rm-inv__row"><input id="invin" placeholder="Name, email or phone" maxlength="200" autocomplete="off" autocapitalize="off" value="${esc(v.text)}" /><button class="icb send" data-a="invite" aria-label="Send invitation"${v.busy ? ' disabled' : ''}>${ic('send')}</button></div>${(v.matches.length ? v.matches : v.sugg).length ? `<div class="rm-inv__s">${(v.matches.length ? v.matches : v.sugg).map((p) => `<button data-a="invite-pick" data-v="${esc(p.email)}">${esc(p.name)}</button>`).join('')}</div>` : ''}${v.rows.slice(0, 6).map(invRow).join('')}</div>
    <div class="rm-foot"><button class="h-btn h-btn--ghost h-btn--sm" data-a="copylink">${ic('link')}Copy meeting link</button>${S.guestsEnabled ? `<button class="h-btn h-btn--ghost h-btn--sm" data-a="guestlink">${ic('link')}Copy guest link</button>` : ''}<button class="h-btn h-btn--ghost h-btn--sm" data-a="endall" style="color:#8a3f24">End for everyone</button></div>`;
}
function paintFoot() {
  const inp = $('#rm-input'); if (!inp || S.panel !== 'people') return;
  const html = footHTML();
  if (inp.dataset.k === 'people' && S.footSig === html) return;
  const ae = document.activeElement; const had = ae && ae.id === 'invin'; const pos = had ? ae.selectionStart : 0;
  inp.innerHTML = html; inp.dataset.k = 'people'; S.footSig = html;
  if (had) { const i = $('#invin'); if (i) { i.focus({ preventScroll: true }); try { i.setSelectionRange(pos, pos); } catch {} } }
}
async function loadDirectory() {
  if (S.inv.dir) return;
  S.inv.dir = [];
  try { S.inv.dir = (await api('meetings/directory')).people || []; } catch { S.inv.dir = null; }
}
function onInvInput(e) {
  if (!e.target || e.target.id !== 'invin') return;
  S.inv.text = e.target.value; S.inv.matches = [];
  const words = S.inv.text.toLowerCase().split(/\s+/).filter(Boolean);
  S.inv.sugg = words.length && !S.inv.text.includes('@') && !/^[+\d(]/.test(S.inv.text.trim()) && S.inv.dir ? S.inv.dir.filter((p) => words.every((w) => (p.name + ' ' + p.email).toLowerCase().includes(w))).slice(0, 5) : [];
  paintFoot();
}
async function sendInvite(to) {
  const v = S.inv; const target = (to || v.text).trim();
  if (!target || v.busy) return;
  v.busy = true; v.matches = []; paintFoot();
  try {
    const r = await api('meetings/' + MID + '/invite', { method: 'POST', body: { to: target } });
    if (r.matches) v.matches = r.matches;
    else if (r.result) { v.rows.unshift(r.result); v.text = ''; v.sugg = []; }
  } catch (e) { v.rows.unshift({ to: target, status: 'failed', detail: e.message }); }
  v.busy = false; paintFoot();
  const i = $('#invin'); if (i && !v.text) i.focus({ preventScroll: true });
}

function paintSideBody(full) {
  const body = $('#rm-body'); if (!body) return;
  if (S.panel === 'chat') {
    const stick = body.scrollTop + body.clientHeight >= body.scrollHeight - 40;
    body.innerHTML = S.chat.length ? S.chat.map(chatHTML).join('') : `<p class="mt-sub" style="margin:0">No messages yet. Messages go to everyone in the meeting.</p>`;
    if (full) $('#rm-input').dataset.k = 'chat';
    if (full) $('#rm-input').innerHTML = `<div class="rm-input"><input id="chatin" placeholder="Message everyone" maxlength="2000" autocomplete="off" /><button class="icb send" data-a="chat-send" aria-label="Send">${ic('send')}</button></div>`;
    if (full || stick) body.scrollTop = body.scrollHeight;
  } else if (S.panel === 'brain') {
    const stick = body.scrollTop + body.clientHeight >= body.scrollHeight - 40;
    body.innerHTML = `<div class="priv">${ic('lock')}Only you see these answers until you post one.</div>
      ${S.brainQ.length ? '' : `<p style="margin:0;font-size:13.5px;color:var(--h-ink-2)">Ask about this meeting, a partner, a number or a document. Favor Brain reads the meeting as it happens and knows the hub's data.</p>`}
      ${S.brainQ.map((q, i) => `<div class="ask">${esc(q.q)}</div>${brainAnswerHTML(q, i)}`).join('')}
      <div class="bq">${[['missed', 'What did I miss?'], ['agreed', 'What have we agreed so far?'], ['open', 'What is still open?'], ['owners', 'Who owns what?']].map(([k, l]) => `<button data-a="ask" data-k="${k}">${l}</button>`).join('')}</div>`;
    if (full) $('#rm-input').dataset.k = 'brain';
    if (full) $('#rm-input').innerHTML = `<div class="rm-input"><input id="brainin" placeholder="Ask Favor Brain" maxlength="400" autocomplete="off" /><button class="icb send" data-a="ask-typed" aria-label="Ask">${ic('send')}</button></div>`;
    if (full || stick) body.scrollTop = body.scrollHeight;
  } else if (S.panel === 'people') {
    const h = hostish();
    const all = [mePerson(), ...others()];
    const wait = h ? S.people.filter((p) => p.waiting) : [];
    paintFoot();
    body.innerHTML = `${wait.map((p) => `<div class="wait"><b>Waiting to join</b><div class="pp" style="padding:0">${av(p.name)}<div><b>${esc(p.name)}</b><span>Guest</span></div><div class="ctl"><button class="h-btn h-btn--primary h-btn--sm" data-a="cmd" data-c="letin" data-pid="${p.pid}">Let in</button></div></div></div>`).join('')}
      ${h ? `<div class="hostbar"><button class="h-btn h-btn--ghost h-btn--sm" data-a="cmd" data-c="muteall">${ic('micOff')}Mute everyone</button><button class="h-btn h-btn--ghost h-btn--sm" data-a="cmd" data-c="${S.locked ? 'unlock' : 'lock'}">${ic('lock')}${S.locked ? 'Unlock room' : 'Lock room'}</button><button class="h-btn h-btn--ghost h-btn--sm" data-a="sharepolicy">${ic('screen')}${S.sharePolicy === 'hosts' ? 'Anyone can share' : 'Only hosts share'}</button></div>` : ''}
      <div class="h-label">In the meeting, ${all.length}</div>
      ${all.map((p) => `<div class="pp" style="position:relative">${av(p.name)}<div><b>${esc(p.name)}${p.me ? ' (you)' : ''}</b><span>${p.role === 'host' || p.role === 'cohost' ? 'Host' + (p.title || p.team ? ' · ' : '') : ''}${p.role === 'guest' ? 'Guest' : esc(p.title || p.team || (p.role === 'host' || p.role === 'cohost' ? '' : 'Staff'))}${p.hand ? ' · hand raised' : ''}${p.sharing ? ' · sharing' : ''}</span></div>
        <div class="ctl"><span class="icon-b ${p.mic ? 'is-on' : 'is-off'}" title="${p.mic ? 'Mic on' : 'Muted'}">${ic(p.mic ? 'mic' : 'micOff')}</span>${h && !p.me ? `<button class="icon-b" data-a="pmenu" data-pid="${p.pid}" aria-label="Host controls for ${esc(p.name)}" aria-haspopup="menu" aria-expanded="${S.menu === p.pid}">${ic('more')}</button>` : ''}</div>
        ${S.menu === p.pid ? `<div class="menu" role="menu"><button role="menuitem" data-a="cmd" data-c="mute" data-pid="${p.pid}">${ic('micOff')}Mute</button><button role="menuitem" data-a="cmd" data-c="${S.spot === p.pid ? 'unspot' : 'spot'}" data-pid="${p.pid}">${ic('pin')}${S.spot === p.pid ? 'End spotlight' : 'Spotlight for everyone'}</button><button role="menuitem" data-a="cmd" data-c="camoff" data-pid="${p.pid}">${ic('videoOff')}Turn camera off</button>${p.hand ? `<button role="menuitem" data-a="cmd" data-c="lowerhand" data-pid="${p.pid}">${ic('hand')}Lower hand</button>` : ''}<button role="menuitem" data-a="cmd" data-c="allowshare" data-v="${p.canShare === false ? 'true' : 'false'}" data-pid="${p.pid}">${ic('screen')}${p.canShare === false ? 'Allow screen sharing' : 'Block screen sharing'}</button>${p.role === 'cohost' ? `<button role="menuitem" data-a="cmd" data-c="unhost" data-pid="${p.pid}">${ic('users')}Remove host rights</button>` : `<button role="menuitem" data-a="cmd" data-c="makehost" data-pid="${p.pid}">${ic('users')}Make a host</button>`}<button role="menuitem" class="danger" data-a="cmd" data-c="remove" data-pid="${p.pid}">${ic('remove')}Remove from meeting</button></div>` : ''}</div>`).join('')}`;
  }
}

// ---------------------------------------------------------------- actions
function onDocClick(e) {
  if (S.pop && !e.target.closest('.rm-pop') && !e.target.closest('[data-a="pop"]')) { S.pop = ''; paintTools(); paintPop(); }
  const a = e.target.closest('[data-a]');
  if (!a) { if (S.menu && !e.target.closest('.menu')) { S.menu = null; paintSideBody(false); } return; }
  const act = a.dataset.a;
  switch (act) {
    case 'mic': toggleMic(); break;
    case 'cam': toggleCam(); break;
    case 'share': toggleShare(); break;
    case 'cc': S.cc = !S.cc; paintCtl(); paintCap(); break;
    case 'rec': toggleRecording(); break;
    case 'hand': S.hand = !S.hand; paintCtl(); paintGrid(); syncNow(); break;
    case 'panel': S.panel = S.panel === a.dataset.p && isPhone() ? '' : a.dataset.p; if (S.panel === 'chat') S.unread = 0; paintCtl(); paintSide(); break;
    case 'panel-close': S.panel = ''; paintCtl(); paintSide(); break;
    case 'leave': leaveClick(); break;
    case 'pop': S.pop = S.pop === a.dataset.p ? '' : a.dataset.p; paintTools(); paintPop(); break;
    case 'emoji': S.pop = ''; paintTools(); paintPop(); send('react', { e: a.dataset.e }); break;
    case 'layout': S.layout = S.layout === 'grid' ? 'speaker' : 'grid'; paintTools(); paintGrid(); scheduleReconcile(); break;
    case 'fullscreen': if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else (document.getElementById('h-app') || document.documentElement).requestFullscreen().catch(() => toast('Full screen is not available here.')); break;
    case 'chat-send': sendChat(); break;
    case 'pmenu': S.menu = S.menu === a.dataset.pid ? null : a.dataset.pid; paintSideBody(false); if (S.menu) { const mi = $('.menu button'); mi && mi.focus(); } break;
    case 'cmd': {
      const c = a.dataset.c, pid = a.dataset.pid || '', v = a.dataset.v === undefined ? undefined : a.dataset.v === 'true';
      S.menu = null; paintSideBody(false);
      if (c === 'remove') { confirmCard({ title: 'Remove ' + nameOf(pid) + '?', body: 'They leave the meeting and cannot come back in.', ok: 'Remove', danger: true }).then((ok) => { if (ok) send('cmd', { a: c }, pid); }); break; }
      send('cmd', { a: c, v }, pid); break;
    }
    case 'sharepolicy': send('cmd', { a: 'sharepolicy', v: S.sharePolicy === 'hosts' ? 'all' : 'hosts' }); break;
    case 'copylink': copy(roomLink(MID)); break;
    case 'invite': sendInvite(); break;
    case 'invite-pick': sendInvite(a.dataset.v); break;
    case 'guestlink': api('meetings/' + MID + '/guestlink', { method: 'POST', body: {} }).then((r) => copy(r.url)).catch((e) => toast(e.message)); break;
    case 'ask': { const L = { missed: 'What did I miss?', agreed: 'What have we agreed so far?', open: 'What is still open?', owners: 'Who owns what?' }; askBrain(L[a.dataset.k] || 'What did I miss?', a.dataset.k); break; }
    case 'ask-typed': { const i = $('#brainin'); if (i && i.value.trim()) { const q = i.value.trim(); i.value = ''; askBrain(q, brainKindOf(q)); } break; }
    case 'brain-post': postBrain(Number(a.dataset.i), false); break;
    case 'brain-show': postBrain(Number(a.dataset.i), true); break;
    case 'brain-stop': send('brain', { stop: true }); break;
    case 'endall': confirmCard({ title: 'End the meeting for everyone?', body: 'Everyone in the room is disconnected.', ok: 'End for everyone', danger: true }).then((ok) => { if (ok) send('cmd', { a: 'end' }); }); break;
    default: break;
  }
}
function onKey(e) {
  if (document.querySelector('.cf')) return;
  if (e.key === 'Escape') {
    if (S.pop) { const p = S.pop; S.pop = ''; paintTools(); paintPop(); const o = $('[data-a="pop"][data-p="' + p + '"]'); o && o.focus(); e.preventDefault(); return; }
    if (S.menu) { const pid = S.menu; S.menu = null; paintSideBody(false); const o = $('[data-a="pmenu"][data-pid="' + pid + '"]'); o && o.focus(); e.preventDefault(); return; }
    if (sheetMode() && S.panel) { const p = S.panel; S.panel = ''; paintCtl(); paintSide(); const o = $('#rm-ctl [data-a="panel"][data-p="' + p + '"]'); o && o.focus(); e.preventDefault(); return; }
    return;
  }
  if (S.menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    const items = $$('.menu button'); if (items.length) { const i = items.indexOf(document.activeElement); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); e.preventDefault(); }
    return;
  }
  if (e.target.id === 'invin' && e.key === 'Enter') { e.preventDefault(); sendInvite(); return; }
  if (e.target.id === 'chatin' && e.key === 'Enter') { e.preventDefault(); sendChat(); return; }
  if (e.target.id === 'brainin' && e.key === 'Enter') { e.preventDefault(); const i = e.target; const q = i.value.trim(); if (q) { i.value = ''; askBrain(q, brainKindOf(q)); } return; }
  if (e.target.matches && e.target.matches('input, textarea')) return;
  if (e.key === 'm' || e.key === 'M') { toggleMic(); }
  else if (e.key === 'v' || e.key === 'V') { toggleCam(); }
}
async function leaveClick() {
  if (hostish() && others().length) {
    const r = await confirmCard({ title: 'Leave the meeting?', body: 'Other people are still in the room. You can leave and let them carry on, or end it for everyone.', ok: 'Leave meeting', cancel: 'Stay', extra: 'End for everyone' });
    if (r === 'extra') { send('cmd', { a: 'end' }); return; }
    if (r !== true) return;
  }
  leaveRoom();
}
function onUnload() { try { fetch((GUEST ? '/api/meet-guest/' : '/api/meet/') + 'meetings/' + MID + '/leave', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json', ...(GUEST ? { 'X-Guest-Token': MODE.token } : {}) }, body: JSON.stringify({ pid: S.me.pid }) }); } catch {} }

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
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, ...(S.camId ? { deviceId: { ideal: S.camId } } : {}) } });
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
    const rr = await api('meetings/' + MID + '/tracks', { method: 'POST', body: { pid: S.me.pid, tracks: all } });
    if (rr.shared === false) { toast('The host has not allowed you to share your screen.'); await stopShare(); return; }
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
  // The person who owns the recording sees the left screen at once while the last pieces upload.
  if (recorder && recorder.mr) { document.getElementById('h-app').classList.remove('is-room'); ended(msg || 'You left the meeting', 'Saving the recording. Keep this page open for a few seconds.', { noRejoin: true, saving: true }); }
  try { if (recorder) await recorder.stopIfOwner(); } catch {}
  try { await api('meetings/' + MID + '/leave', { method: 'POST', body: { pid: S.me.pid } }); } catch {}
  [local.mic, local.cam, local.screen].forEach((t) => t && t.stop());
  if (rtc) rtc.close();
  for (const [, t] of tiles) t.el.remove(); tiles.clear();
  $$('audio[id^="a-"]').forEach((a) => a.remove());
  document.getElementById('h-app').classList.remove('is-room');
  window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload); document.removeEventListener('click', onDocClick); document.removeEventListener('input', onInvInput);
  ended(msg || 'You left the meeting');
  // The last person out saves the recording and starts the notes. Anyone invited can finish the work later from Meetings.
  if (!GUEST) pump(MID, (st) => { const p = root.querySelector('.mt-sub'); if (p && st) p.textContent = st; });
}

// ---------------------------------------------------------------- loops
function clearIntervals() { [syncTimer, statTimer, reconcileTimer, levelTimer, barTimer].forEach((t) => t && clearInterval(t)); }
function startLoops() {
  // One sync per person every two seconds (three above 15 people, four in a hidden tab) so a big room stays light on the database.
  const tick = async () => { await syncNow(); if (!S.left) syncTimer = setTimeout(tick, document.hidden ? 4000 : S.people.length > 15 ? 3000 : 2000); };
  syncTimer = setTimeout(tick, 0);
  statTimer = setInterval(onStats, 1500);
  levelTimer = setInterval(measureLevel, 250);
  barTimer = setInterval(paintBar, 1000);
}

let syncing = false;
async function syncNow() {
  if (syncing || S.left || rejoining) return;
  syncing = true;
  try {
    const r = await api('meetings/' + MID + '/sync', { method: 'POST', body: { pid: S.me.pid, since: S.events, tx: S.tx, me: { mic: S.mic, cam: S.cam && !!local.cam, hand: S.hand, sharing: S.sharing, lvl: S.lvl } } });
    S.lastSync = Date.now(); S.syncFails = 0;
    if (S.syncDrop) { S.syncDrop = false; if (S.conn === 'drop' && !S.rtcDown && !rejoining) { S.conn = 'back'; S.backAt = Date.now(); S.missedSec = (Date.now() - (S.dropAt || Date.now())) / 1000; paintBar(); } }
    applySync(r);
  } catch (e) {
    if (e.code === 'removed') { S.removed = true; leaveRoom('The host removed you from this meeting'); }
    else if (e.code === 'not_in_meeting') rejoin('server lost me');
    else if (++S.syncFails >= 3 && S.conn === 'ok') { S.conn = 'drop'; S.syncDrop = true; S.dropAt = Date.now(); paintBar(); }
  } finally { syncing = false; }
}

function applySync(r) {
  S.people = r.people; S.me.role = r.role;
  S.spot = r.meeting.spot; S.locked = r.meeting.locked; S.sharePolicy = r.meeting.sharePolicy;
  S.meeting.status = r.meeting.status;
  S.recording = r.recording;
  for (const l of r.lines || []) { S.lines.push(l); S.tx = l.n; }
  if ((r.lines || []).length) paintCap();
  for (const e of r.events) handleEvent(e);
  if (r.events.length) S.events = r.events[r.events.length - 1].seq;
  if (r.meeting.status === 'ended') return leaveRoom('The meeting ended');
  // Repaint only what changed, so a button is never replaced under a click.
  const base = (p) => [p.pid, p.name, p.sessionId, p.mic, p.cam, p.hand, p.sharing, p.role, p.waiting, p.canShare];
  const gridSig = JSON.stringify([S.people.map((p) => [...base(p), p.speaking]), S.spot, S.pin]);
  const ctlSig = JSON.stringify([S.people.filter((p) => p.waiting).length, (S.people.find((p) => p.pid === S.me.pid) || {}).canShare, S.locked, S.sharePolicy, S.recording && [S.recording.active, S.recording.owner], S.me.role]);
  const sideSig = JSON.stringify([S.people.map(base), S.spot, S.locked, S.sharePolicy]);
  if (hostish()) {
    const waiting = S.people.filter((p) => p.waiting); const wsig = waiting.map((p) => p.pid).join(',');
    if (wsig !== S.waitSig) { S.waitSig = wsig; paintWait(waiting); for (const p of waiting) if (!S.seenWait.has(p.pid)) { S.seenWait.add(p.pid); toast(p.name + ' is waiting to join.'); chime(); } }
  } else if (S.waitSig) { S.waitSig = ''; paintWait([]); }
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
  } else if (e.kind === 'brain') {
    S.show = e.body.stop ? null : { ...e.body, from: e.from };
    if (S.show && e.from !== S.me.pid) toast(S.show.by + ' put a Favor Brain answer on screen');
    paintGrid(); scheduleReconcile();
  } else if (e.kind === 'react') {
    floatEmoji(e.body.e, e.body.name);
  } else if (e.kind === 'notice') {
    const b = e.body;
    if (b.a === 'rec-start') { toast(b.mode === 'video' ? 'Video recording started' : 'Recording for notes started'); }
    else if (b.a === 'rec-stop') toast('Recording stopped');
    else if (b.a === 'rec-takeover') toast(b.name + ' took over the recording');
    else if (b.a === 'joined' && e.from !== S.me.pid && S.people.length < 12) toast(b.name + ' joined');
    else if (b.a === 'acting' && b.pid === S.me.pid) toast('You are now a host because no host is in the room');
  }
}

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
  const worse = ['good', 'fair', 'weak'].indexOf(lvl) > ['good', 'fair', 'weak'].indexOf(S.level);
  if (lvl !== S.level && S.levelVotes >= (worse ? 6 : 3)) { S.level = lvl; paintAll(); scheduleReconcile(); }
  // Nothing arriving for a while while others are present: the path is dead.
  const anyone = others().length > 0 && rtc.subs.size > 0;
  if (anyone && st.t && st.bps < 1000) { if (!silentSince) silentSince = Date.now(); if (Date.now() - silentSince > 9000) { silentSince = 0; rejoin('no media for 9 seconds'); } } else silentSince = 0;
  if (S.conn === 'back' && Date.now() - (S.backAt || 0) > 5000) { S.conn = 'ok'; paintBar(); }
  // Speaking rings from the sound the SFU delivers, for people the sync has not flagged yet.
}
function onRtcState(s) {
  S.rtcDown = s === 'disconnected' || s === 'failed';
  if (s === 'disconnected' && S.conn === 'ok') { S.conn = 'drop'; S.dropAt = Date.now(); S.dropRel = Math.max(0, Math.round((Date.now() - (Date.parse(S.meeting.startedAt || '') || S.started)) / 1000)); paintBar(); }
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
  if (S.recording && S.recording.active) { if (await confirmStopRecording(S.recording.mode)) await recorder.stop(); }
  else await recorder.start();
}

window.__meet = { S, tiles, get rtc() { return rtc; }, reconcile, rejoin };

// ---------------------------------------------------------------- captions
function paintCap() {
  const el = $('#rm-cap'); if (!el) return;
  if (!S.cc) { el.hidden = true; return; }
  const meetingStart = Date.parse(S.meeting.startedAt || '') || S.started;
  const fresh = S.lines.filter((l) => Date.now() - (meetingStart + l.t * 1000) < 45000).slice(-3);
  el.hidden = false; el.classList.toggle('is-quiet', !fresh.length);
  el.innerHTML = fresh.length ? fresh.map((l, i) => `<span class="cl${i < fresh.length - 1 ? ' old' : ''}">${l.who ? `<b>${esc(l.who)}:</b> ` : ''}${esc(l.text)}</span>`).join('') : 'Captions on, waiting for speech.';
}
setInterval(() => { if (S.cc) paintCap(); }, 2000);

// ---------------------------------------------------------------- Favor Brain in the call
const stripMd = (t) => String(t || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/^#+\s*/gm, '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 $2');

function brainAnswerHTML(q, i) {
  if (q.state === 'working') return `<div class="ans"><div class="brain-wait" role="status" aria-label="Favor Brain is working on it"><span></span><span></span><span></span></div></div>`;
  if (q.state === 'error') return `<div class="ans"><div>${esc(q.error)}</div></div>`;
  const B = window.BrainBlocks;
  let html = '';
  if (q.blocks && q.blocks.length && B) { try { html = `<div class="bc-root bc-mini">${q.blocks.map((b, bi) => B.render(b, { ti: 900 + i, bi, canSheets: false, canRequest: () => false, expired: true })).join('')}</div>`; } catch { html = ''; } }
  if (!html) html = `<div class="ans"><div style="white-space:pre-wrap">${esc(stripMd(q.markdown || 'No answer.'))}</div></div>`;
  return `<div class="ans">${html}<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="h-btn h-btn--primary h-btn--sm" data-a="brain-post" data-i="${i}">${ic('chat')}Post to chat</button><button class="h-btn h-btn--ghost h-btn--sm" data-a="brain-show" data-i="${i}">${ic('screen')}Show on screen</button></div></div>`;
}

// Typed questions that ask for the meeting so far go to the transcript answers; everything else goes to the Brain page route.
function brainKindOf(q) {
  if (/\b(miss|catch me up|recap)\b/i.test(q)) return 'missed';
  if (/\b(still open|unanswered|open questions)\b/i.test(q)) return 'open';
  if (/\b(who owns|owners?|who has)\b/i.test(q)) return 'owners';
  if (/\b(agreed|decid|action items)\b/i.test(q) && /\b(so far|meeting|we)\b/i.test(q)) return 'agreed';
  return 'brain';
}

// Plain reasons for a failed answer, from the status code. The same words for a limit, a timeout and a permission problem were the bug.
const BRAIN_ERR = { 403: 'Favor Brain answers are for staff only.', 429: 'That is too many questions in a minute. Wait a moment, then ask again.', 503: 'Favor Brain is busy right now. Ask again in a moment.', 504: 'Favor Brain took too long to answer. Ask again.' };
function brainError(e) {
  if (!e || !e.status) return 'Favor Brain could not be reached. Check the connection and ask again.';
  if (BRAIN_ERR[e.status]) return BRAIN_ERR[e.status];
  if (e.status === 404) return 'This meeting is no longer open to you.';
  return e.message && !/^Something went wrong/.test(e.message) ? e.message : 'Favor Brain could not answer that. Ask again.';
}

async function askBrain(q, kind) {
  S.panel = 'brain'; paintCtl(); paintSide();
  const item = { q, state: 'working' };
  S.brainQ.push(item); paintSideBody(false);
  try {
    if (kind === 'missed' || kind === 'agreed' || kind === 'open' || kind === 'owners') {
      const start = Date.parse(S.meeting.startedAt || '') || S.started;
      const dropped = S.dropRel != null;
      const r = await api('meetings/' + MID + '/brain', { method: 'POST', body: { pid: S.me.pid, kind, dropped, sinceSec: kind === 'missed' ? (dropped ? S.dropRel : Math.max(0, Math.round((Date.now() - start) / 1000) - 300)) : 0 } });
      item.blocks = r.blocks; item.markdown = r.markdown || (r.blocks[0] && r.blocks[0].md) || '';
    } else {
      const res = await fetch('/api/brain/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ question: q }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.ok === false) { const err = new Error(d.message || ''); err.status = res.status; throw err; }
      item.blocks = d.blocks || []; item.markdown = d.markdown || d.text || '';
    }
    item.state = 'done';
  } catch (e) { item.state = 'error'; item.error = brainError(e); }
  paintSideBody(false);
  const body = $('#rm-body'); if (body) body.scrollTop = body.scrollHeight;
}

function postBrain(i, onScreen) {
  const q = S.brainQ[i]; if (!q) return;
  if (S.people.some((p) => p.role === 'guest')) { if (!confirm('A guest is in the room. Post this anyway?')) return; }
  if (onScreen) {
    const slim = (q.blocks || []).map((b) => (b && b.type === 'table' && Array.isArray(b.rows) ? { ...b, rows: b.rows.slice(0, 12), count: Math.min(b.count || b.rows.length, 12) } : b));
    send('brain', { q: q.q, md: q.markdown, blocks: slim });
  } else send('chat', { text: stripMd(q.markdown || '').slice(0, 1900), ai: true });
  toast(onScreen ? 'Showing on screen' : 'Posted to chat');
}

function paintBrainTile(grid, i) {
  let el = document.getElementById('rm-brain-tile');
  if (!el) { el = document.createElement('div'); el.id = 'rm-brain-tile'; el.className = 'mt-tile is-big mt-tile--brain'; }
  const key = JSON.stringify([S.show && S.show.q, S.show && S.show.md && S.show.md.length]);
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    const B = window.BrainBlocks; let html = '';
    if (S.show.blocks && S.show.blocks.length && B) { try { html = S.show.blocks.map((b, bi) => B.render(b, { ti: 950, bi, canSheets: false, canRequest: () => false, expired: true })).join(''); } catch { html = ''; } }
    if (!html) html = `<div class="ans"><div style="white-space:pre-wrap">${esc(stripMd(S.show.md))}</div></div>`;
    const mine = S.show.from === S.me.pid || hostish();
    el.innerHTML = `<div class="bc-root bc-show"><div class="bc-show__h"><span>${ic('brain')}<span><b>${esc(S.show.q || 'Favor Brain')}</b><small>Shown by ${esc(S.show.by)}</small></span></span>${mine ? `<button class="h-btn h-btn--ghost h-btn--sm" data-a="brain-stop">Stop showing</button>` : ''}</div><div class="bc-show__b">${html}</div></div>`;
    try { if (B) { B.countUp && B.countUp(el, true); B.drawCharts && B.drawCharts(el); } } catch {}
  }
  if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] || null);
}

// Phones pause call audio, and iOS can end the microphone, when someone takes a screenshot, gets a call or leaves the
// app for a moment. Coming back (or any tap) restarts playback and reopens the microphone on the same connection.
let reviving = false;
async function revive() {
  if (reviving || !rtc || !S.me || !S.me.pid) return;
  reviving = true;
  try {
    $$('audio[id^="a-"]').forEach((a) => { if (a.paused && a.srcObject) a.play().catch(() => {}); });
    $$('#rm-grid video').forEach((v) => { if (v.paused && v.srcObject) v.play().catch(() => {}); });
    if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
    if (local.mic && local.mic.readyState === 'ended') {
      const ns = await navigator.mediaDevices.getUserMedia({ audio: S.micId ? { deviceId: { ideal: S.micId } } : true });
      const t = ns.getAudioTracks()[0];
      t.enabled = S.mic; local.mic = t; analyser = null; try { actx && actx.close(); } catch {} actx = null;
      await rtc.replace('a', t);
    }
  } catch {} finally { reviving = false; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') revive(); });
window.addEventListener('pageshow', revive);
window.addEventListener('focus', revive);
document.addEventListener('touchend', revive, { passive: true });
setInterval(revive, 3000);
