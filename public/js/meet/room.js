// Meetings: the lobby and the room. The SFU work is in rtc.js. This file draws the room, runs the sync loop (roster, chat,
// host commands), keeps the subscriptions the layout needs, and handles a dropped connection.
import { $, $$, esc, ic, av, hashColor, initials, toast, api, copy, roomLink, whoami, pump, MODE, confirmCard, fmtDay, fmtTime } from './ui.js';
import { Rtc, linkLevel } from './rtc.js';
import { Recorder, confirmStopRecording } from './rec.js';
import { loadPrefs, savePrefs, acquire, acquireBoth, trackDevice } from './devices.js';
import { VoiceFx, CamFx, BACKGROUNDS, FaceCount, lowEnd } from './effects.js';
import './stage.js';

const params = new URLSearchParams(location.search);
// ?audio=1: an audio-only call for a weak or expensive connection. No camera is asked for or sent, and no one's video or screen share is pulled.
// Lite mode (public/js/lite.js, the Data saver setting): the room opens as an audio call unless the link says ?audio=0 (the
// Video button below), sound goes out at 16 kbit/s, a camera sends small pictures, and everyone else's video comes at the smallest layer.
const LITE = !!(window.FavorLite && window.FavorLite.on);
const AUDIO_ONLY = params.get('audio') === '1' || (LITE && params.get('audio') !== '0');
const MID = params.get('m') || '';
const root = $('#meet-root');
const isPhone = () => matchMedia('(max-width: 860px)').matches;
const FEATURES = { brain: true, captions: true, docs: false, notes: true };
const GUEST = MODE.guest;
const GKEY = params.get('k') || '';
if (GUEST) { FEATURES.brain = false; FEATURES.captions = false; FEATURES.notes = false; MODE.token = sessionStorage.getItem('meet.gtoken.' + MID) || ''; }
const nav = (staff, guest) => (GUEST ? guest : staff);
// The page the person came from (a Chat channel, Meetings), so Leave takes them back there. Only a path on this site.
const BACK = (() => { const b = params.get('back') || ''; return /^\/(?!\/)[^\s]*$/.test(b) && !b.startsWith('/meet/room') ? b : ''; })();
const backLabel = () => (BACK.startsWith('/chat') ? 'Back to Chat' : BACK.startsWith('/meet') ? 'Back to Meetings' : 'Go back');
// Choices from the pre-join sheet (public/js/meet/prejoin.js): used once, within two minutes, for this meeting only.
const PRE = (() => {
  if (!GUEST && /^[0-9a-f]{24}$/.test(params.get('ring') || '')) return { mid: MID, at: Date.now(), mic: true, cam: false };
  if (GUEST || params.get('pj') !== '1') return null;
  try {
    const p = JSON.parse(sessionStorage.getItem('meet.prejoin') || 'null');
    sessionStorage.removeItem('meet.prejoin');
    return p && p.mid === MID && Date.now() - p.at < 120_000 ? p : null;
  } catch { return null; }
})();
// iPhone and iPad Safari stop the microphone when the page goes to the background; there the person steps out of the count at once.
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const S = {
  meeting: null, me: { pid: sessionStorage.getItem('meet.pid.' + MID) || '', name: '', role: 'staff' }, people: [], events: 0, chat: [], panel: 'people',
  mic: true, cam: !AUDIO_ONLY && !LITE, hand: false, sharing: false, cc: false, conn: 'ok', page: 0, pin: '', spot: '', locked: false, sharePolicy: 'all', menu: null,
  recording: null, lines: [], tx: 0, brainQ: [], show: null, dropRel: null, joined: false, left: false, started: 0, lvl: 0, lastSync: 0, unread: 0, devices: { mic: true, cam: !AUDIO_ONLY }, removed: false, level: 'good', speakers: new Map(),
  ah: new Map(), soundBlocked: false, micIssue: '', noConnect: 0,
  inv: { text: '', busy: false, rows: [], sugg: [], dir: null, matches: [] }, live: [], liveSig: '', liveKind: 'action', liveText: '', layout: 'grid', pop: '', more: false, moreDev: false, syncFails: 0, camId: '', micId: '', spkId: '', seenWait: new Set(), present: [], rtcDown: false,
  myWith: [], withPick: null, faceAsk: { off: false, until: 0, streak: 0 },
};
let rtc = null, local = { mic: null, cam: null, screen: null, screenAudio: null }, joinInfo = null, syncTimer = null, statTimer = null, reconcileTimer = null, levelTimer = null, rejoining = false, silentSince = 0, wantRid = new Map();
let recorder = null, barTimer = null, capTimer = null;
// The devices this person picked (devices.js). WHO is their email, or 'guest' on a guest link.
let WHO = GUEST ? 'guest' : 'me', P = loadPrefs(WHO);
// The sent tracks: local.mic and local.cam may be the processed versions (effects.js); local.micRaw and local.camRaw are the devices.
let vfx = null, cfx = null;
async function setMic(raw) {
  if (vfx) { vfx.stop(); vfx = null; }
  local.micRaw = raw; if (raw) watchMic(raw);
  let out = raw;
  if (raw && P.voice !== false) {
    // The clean-up gets a quarter second. On a slow phone it can take longer to load: the raw microphone goes out at once and the
    // clean sound replaces it on the same sender when it is ready, so joining never waits for it.
    const v = new VoiceFx({ gate: !!P.gate }); const ready = v.start(raw).catch(() => null);
    const t = await Promise.race([ready, new Promise((r) => setTimeout(() => r(undefined), 250))]);
    if (t === undefined) {
      ready.then(async (t2) => {
        if (!t2 || vfx || local.micRaw !== raw || S.left) { v.stop(); if (!t2 && local.micRaw === raw) voiceOnTap(); return; }
        vfx = v; t2.enabled = S.mic; local.mic = t2; resetLevel();
        if (rtc) await rtc.replace('a', t2).catch(() => {});
      });
    } else if (t) { vfx = v; out = t; } else voiceOnTap();
  }
  if (out) out.enabled = S.mic;
  local.mic = out; resetLevel();
  return out;
}
// The sound engine waits for a tap when the page opened without one. The raw microphone goes out meanwhile, then the clean-up joins in.
function voiceOnTap() {
  if (voiceOnTap.armed) return; voiceOnTap.armed = true;
  document.addEventListener('pointerdown', async () => {
    voiceOnTap.armed = false;
    if (!local.micRaw || vfx || P.voice === false || S.left) return;
    const t = await setMic(local.micRaw); if (rtc && t) await rtc.replace('a', t).catch(() => {});
  }, { once: true, capture: true });
}
async function setCam(raw) {
  if (cfx) { cfx.stop(); cfx = null; }
  local.camRaw = raw; let out = raw;
  if (raw && !AUDIO_ONLY && CamFx.wanted(P)) {
    const c = new CamFx({ bg: P.bg, image: P.bgImg, light: P.light, onSlow: camSlow });
    try { out = await c.start(raw); cfx = c; } catch { toast('The background effect did not load. Your camera is on without it.'); }
  }
  local.cam = out; return out;
}
function stopCam() { if (cfx) { cfx.stop(); cfx = null; } if (local.camRaw) local.camRaw.stop(); local.camRaw = null; local.cam = null; }
function stopFx() { if (vfx) { vfx.stop(); vfx = null; } if (cfx) { cfx.stop(); cfx = null; } if (prevFx) { prevFx.stop(); prevFx = null; } [local.micRaw, local.camRaw].forEach((t) => t && t.stop()); }
function camSlow() { remember({ bg: 'none', light: false }); toast('Background effects are off. This device could not keep up.'); diag('fx-slow'); reapplyCam(); }
async function reapplyCam() {
  if (!(S.cam && local.camRaw)) { await devPreview(); paintDevSheet(); return; }
  const t = await setCam(local.camRaw); if (rtc) await rtc.replace('v', t).catch(() => {});
  paintGrid(); paintDevSheet();
}

function remember(patch) { P = savePrefs(WHO, patch); if ('micId' in patch) S.micId = P.micId; if ('camId' in patch) S.camId = P.camId; if ('spkId' in patch) S.spkId = P.spkId; }
// The line shown when a saved device is missing and the default opened in its place.
function fallbackLine(fb, tracks) {
  const lab = (t) => (t && t.label ? t.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, '') : 'the default');
  const out = [];
  if (fb.cam) out.push('Your saved camera is not connected. Using ' + lab(tracks.cam) + '.');
  if (fb.mic) out.push('Your saved microphone is not connected. Using ' + lab(tracks.mic) + '.');
  return out.join(' ');
}
const tiles = new Map(); // pid or 'share:pid' -> { el, video, audio }

// ---------------------------------------------------------------- boot
if (!MID) root.innerHTML = '<div class="h-card mt-card"><p>That link is missing the meeting. Open it from Meetings.</p></div>';
else boot();

// A FavorOS user who opens the guest link joins as themselves: the staff room opens when their session may enter this meeting.
async function staffInstead() {
  try {
    const r = await fetch('/api/meet/meetings/' + MID, { credentials: 'same-origin' });
    if (!r.ok) return false;
    location.replace('/meet/room/?m=' + encodeURIComponent(MID));
    return true;
  } catch { return false; }
}
async function boot() {
  if (GUEST && (await staffInstead())) return;
  try {
    const whoP = GUEST ? null : whoami();
    const r = GUEST ? await api('meetings/' + MID + '/guestinfo?k=' + encodeURIComponent(GKEY)) : await api('meetings/' + MID);
    S.meeting = GUEST ? { id: MID, title: r.title, hostName: r.host, rec: r.rec, status: r.status, startsAt: r.startsAt, backupLink: '', notesStatus: 'none', locked: r.locked } : r.meeting;
    S.guestsEnabled = !!r.guestsEnabled;
    S.present = r.present || [];
    S.here = r.people || null;
    document.title = S.meeting.title + ' - FavorOS';
    const t = $('.h-top__title'); if (t) t.textContent = S.meeting.title;
    if (!GUEST) { WHO = String((await whoP).email || 'me').toLowerCase(); P = loadPrefs(WHO); S.myEmail = WHO; }
    S.micId = P.micId; S.camId = P.camId; S.spkId = P.spkId;
    if (GUEST && S.meeting.status === 'ended' && !r.reopen && !(S.meeting.startsAt && Date.parse(S.meeting.startsAt) > Date.now())) return ended('This meeting has ended');
    if (S.meeting.status === 'ended' && S.meeting.endedAt && Date.now() - Date.parse(S.meeting.endedAt) > 6 * 3600_000) return ended();
    if (PRE && S.meeting.status !== 'cancelled') return quickEnter(PRE);
    lobby();
  } catch (e) {
    // Signed out: go through login and come back to this room.
    if (!GUEST && e.status === 401) { location.href = '/login/?next=' + encodeURIComponent(location.pathname + location.search); return; }
    if (!GUEST && e.code === 'not_invited') return notInvited(e);
    root.innerHTML = `<div class="h-card mt-card" style="max-width:560px;margin:20px auto"><h2 class="mt-h2">${e.status === 404 ? 'That meeting is not available' : 'Could not open the meeting'}</h2><p class="mt-sub" style="font-size:14px">${esc(e.message)}</p><a class="h-btn h-btn--primary" href="/meet/">Back to meetings</a></div>`;
  }
}

// A signed-in person who is not on the list: one tap tells the host.
function notInvited(e) {
  root.innerHTML = `<div class="h-card mt-card" style="max-width:560px;margin:20px auto;display:grid;gap:12px"><h2 class="mt-h2">You are not on the invite list</h2><p class="mt-sub" style="font-size:14px;margin:0">${esc(e.message)}</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="h-btn h-btn--primary" id="ask-in">Ask to be added</button><a class="h-btn h-btn--ghost" href="/meet/">Back to meetings</a></div></div>`;
  const b = $('#ask-in');
  b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = 'Asking';
    try { await api('meetings/' + MID + '/request-access', { method: 'POST', body: JSON.stringify({}) }); b.textContent = 'Host notified'; }
    catch (x) { b.disabled = false; b.textContent = 'Ask to be added'; toast(x.message); }
  });
}

function ended(msg, sub, opts = {}) {
  const notes = () => S.meeting && S.meeting.notesStatus && S.meeting.notesStatus !== 'none';
  const canRejoin = !opts.noRejoin && !(S.meeting && S.meeting.status === 'ended' && S.meeting.endedAt && Date.now() - Date.parse(S.meeting.endedAt) > 6 * 3600_000);
  const links = () => (GUEST || opts.saving ? '' : `${BACK ? `<a class="h-btn h-btn--ghost" href="${esc(BACK)}">${esc(backLabel())}</a>` : `<a class="h-btn ${canRejoin ? 'h-btn--ghost' : 'h-btn--primary'}" href="/meet/">Back to meetings</a>`}${notes() ? `<a class="h-btn h-btn--ghost" href="/meet/notes/?m=${S.meeting.id}">Open the notes</a>` : ''}`);
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
  resetLevel(); closeDevSheet(); stopFx(); local = { mic: null, cam: null, screen: null, screenAudio: null }; rtc = null; recorder = null; rejoining = false; syncing = false;
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
  const inRoom = GUEST ? '' : `<div class="lb-in" id="lb-in">${hereLine()}</div>`;
  root.innerHTML = `<div class="h-card mt-card lobby" style="max-width:980px;margin:6px auto"><div class="prev" id="lb-prev"><video id="lb-video" muted playsinline autoplay></video><span class="face" id="lb-face">${esc(initials(name))}</span><div class="cl"><button class="cb is-on" id="lb-mic" aria-label="Microphone" aria-pressed="true"><span class="k">${ic('mic')}</span></button><button class="cb is-on" id="lb-cam" aria-label="Camera" aria-pressed="true"><span class="k">${ic('video')}</span></button></div></div>
    <div style="display:grid;gap:12px"><div class="h-label">Ready to join?</div><h2 class="mt-h2" style="font-size:28px">${esc(m.title)}</h2>
      <p class="lb-line"><span>${esc(m.hostName ? 'Host: ' + m.hostName : '')}</span>${when ? `<span>${esc(when)}</span>` : ''}</p>${inRoom}
      <p class="mt-sub" style="font-size:14px;margin:0" id="lb-who">${esc(recLine)}</p>
      ${GUEST ? `<div class="mt-f"><label for="lb-name">Your name in the room</label><input id="lb-name" value="${esc(name)}" maxlength="60" placeholder="First and last name" /></div>` : `<input type="hidden" id="lb-name" value="${esc(name)}" />`}${consent}
      <div class="lb-dev" id="lb-devs" hidden></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="h-btn h-btn--primary" id="lb-join">${ic('video')}Join now</button>${GUEST ? `<a class="h-btn h-btn--ghost" href="/login/?next=${encodeURIComponent('/meet/room/?m=' + MID)}">Sign in to join as yourself</a>` : '<a class="h-btn h-btn--ghost" href="/meet/prep/?m=' + encodeURIComponent(MID) + '" target="_blank" rel="noopener">Prep sheet</a>'}</div>
      <p class="mt-sub" style="margin:0" id="lb-dev">Checking your camera and microphone.</p><p class="lb-help" id="lb-help" hidden></p></div></div>`;
  $('#lb-join').addEventListener('click', enter);
  $('#lb-mic').addEventListener('click', () => { S.mic = !S.mic; lobbyButtons(); });
  $('#lb-cam').addEventListener('click', () => { S.cam = !S.cam; lobbyButtons(); lobbyVideo(); });
  let denied = null;
  // Join waits for this: a tap on Join while the devices were still opening used to enter with no microphone, and nobody heard them.
  let ready; S.devReady = new Promise((r) => { ready = r; });
  try {
    // The saved camera and microphone, exactly; the default only when a saved one is missing.
    const r = await acquireBoth(P, !AUDIO_ONLY);
    preview = r.stream;
    if (r.camError) { denied = r.camError; S.devices.cam = false; S.cam = false; $('#lb-dev').textContent = 'No camera found or allowed. You can still join with sound.'; }
    else $('#lb-dev').textContent = AUDIO_ONLY ? 'Audio call. Your microphone is ready and no video is sent or received.' : 'Camera and microphone ready.';
    const fb = fallbackLine(r.fellBack, { mic: preview.getAudioTracks()[0], cam: preview.getVideoTracks()[0] });
    if (fb) $('#lb-dev').textContent = fb;
  } catch (e2) { denied = e2; S.micDenied = !!permHelp(e2); preview = null; S.devices = { mic: false, cam: false }; S.mic = false; S.cam = false; $('#lb-dev').textContent = 'No camera or microphone is available. You can join to watch and listen, and chat.'; }
  ready();
  const help = permHelp(denied); if (help) { const h = $('#lb-help'); if (h) { h.textContent = help; h.hidden = false; } }
  lobbyButtons(); lobbyVideo(); lobbyDevices(); lobbyMeter();
  watchHere();
}
// The names in the room now. A row with this tab's own pid is a visit from before a reload, not a person.
function hereNames() {
  if (S.here) return S.here.filter((p) => p.pid !== S.me.pid).map((p) => p.name);
  return S.present || [];
}
function hereLine() {
  const n = hereNames();
  if (!n.length) return '<span>Nobody is in the room yet.</span>';
  return `${n.slice(0, 4).map((x) => av(x)).join('')}<span>${esc(n.slice(0, 3).join(', '))}${n.length > 3 ? ' and ' + (n.length - 3) + ' more' : ''} ${n.length === 1 ? 'is' : 'are'} in the room.</span>`;
}
let hereTimer = null;
function watchHere() {
  if (GUEST || hereTimer) return;
  hereTimer = setInterval(async () => {
    const el = $('#lb-in');
    if (!el || S.joined) { clearInterval(hereTimer); hereTimer = null; return; }
    if (document.hidden) return;
    try { const r = await api('meetings/' + MID); S.here = r.people || null; S.present = r.present || []; if (r.meeting) S.meeting.status = r.meeting.status; el.innerHTML = hereLine(); } catch {}
  }, 4000);
}
// From the pre-join sheet: the choices are made, so the room opens with them and no second preview.
async function quickEnter(pre) {
  S.mic = pre.mic !== false; S.cam = !!pre.cam && !AUDIO_ONLY;
  // The sheet's picks become this person's saved devices.
  const pick = {}; if (pre.micId) pick.micId = pre.micId; if (pre.camId) pick.camId = pre.camId; if (Object.keys(pick).length) remember(pick);
  const name = (await whoami()).name || '';
  // Drawn in the room's own layout, so the page does not jump when the room appears.
  document.getElementById('h-app').classList.add('is-room');
  root.innerHTML = `<div class="rm" id="rm"><section class="rm-stage rm-joining" aria-label="Meeting" role="status"><div class="rm-joining__in"><span class="spin"></span><b>Joining ${esc(S.meeting.title)}</b><span id="lb-dev">Connecting to the room.</span></div><input type="hidden" id="lb-name" value="${esc(name)}" /><button class="h-btn h-btn--primary" id="lb-join" hidden>Join now</button></section>${isPhone() ? '' : '<aside class="rm-side" aria-hidden="true"></aside>'}</div>`;
  // The join (a seat, an SFU session and the relay servers) runs while the camera and microphone open.
  S.me.name = name;
  S.joinP = joinCall(false); S.joinP.catch(() => {});
  try {
    const r = await acquireBoth(P, S.cam);
    preview = r.stream; if (r.camError) S.cam = false;
    const fb = fallbackLine(r.fellBack, { mic: preview.getAudioTracks()[0], cam: preview.getVideoTracks()[0] });
    if (fb) setTimeout(() => toast(fb), 1500);
  } catch (e) { S.micDenied = !!permHelp(e); preview = null; S.devices = { mic: false, cam: false }; S.mic = false; S.cam = false; }
  enter();
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
      const old = kind === 'audio' ? preview.getAudioTracks()[0] : preview.getVideoTracks()[0];
      // A camera can be open in one place at a time on some machines: let go of the old one first.
      if (old && kind === 'video') { preview.removeTrack(old); old.stop(); }
      const { track } = await acquire(kind, { ...P, [kind === 'audio' ? 'micId' : 'camId']: id });
      if (old && kind === 'audio') { preview.removeTrack(old); old.stop(); }
      preview.addTrack(track);
      remember(kind === 'audio' ? { micId: id } : { camId: id });
      if (kind === 'audio') { lbCtx = null; lobbyMeter(true); } else lobbyVideo(true);
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
  if (S.devReady) await Promise.race([S.devReady, new Promise((r) => setTimeout(r, 10000))]);
  const slow = setTimeout(() => { const d = $('#lb-dev'); if (d) d.textContent = 'Still connecting. This can take up to 20 seconds.'; }, 6000);
  S.me.name = name;
  if (preview) {
    await setMic(preview.getAudioTracks()[0] || null);
    const vt = preview.getVideoTracks()[0] || null;
    if (vt && !S.cam) { vt.stop(); preview.removeTrack(vt); }
    await setCam(S.cam ? vt : null);
  }
  if (local.mic) local.mic.enabled = S.mic;
  S.micIssue = local.mic ? '' : S.micDenied ? 'denied' : 'nodev'; watchMic(local.mic);
  try {
    const early = S.joinP; S.joinP = null;
    const j = await withTimeout(early || joinCall(false), 20000);
    if (j.waiting) await waitAdmit();
    await withTimeout(openRtc(j, false), 20000);
    clearTimeout(slow);
  } catch (e) {
    clearTimeout(slow);
    if (e.leftWait) { ended('You left the waiting room'); return; }
    document.getElementById('h-app').classList.remove('is-room');
    if (e.status === 403 || e.status === 404 || e.status === 410 || e.status === 429 || e.status === 400) { root.innerHTML = `<div class="h-card mt-card" style="max-width:560px;margin:20px auto;display:grid;gap:12px"><h2 class="mt-h2">You cannot join this meeting</h2><p class="mt-sub" style="font-size:14px;margin:0">${esc(e.message)}</p>${GUEST ? '' : '<a class="h-btn h-btn--primary" href="/meet/">Back to meetings</a>'}</div>`; return; }
    failScreen(e); return;
  }
  S.joined = true; S.started = Date.now(); S.joinedAt = Date.now();
  // The people already in the room get their tiles at once (from the meeting read before joining), so the grid is drawn at its
  // final size and nothing jumps when the first sync and their video arrive. The first sync replaces these with the real rows.
  if (!S.people.length && Array.isArray(S.here) && !GUEST) S.people = S.here.filter((p) => p.pid && p.pid !== S.me.pid).map((p) => ({ pid: p.pid, name: p.name, role: 'staff', tracks: [], cam: true, mic: true, hand: false, sharing: false, joinedAt: 0, with: [], seed: true }));
  buildRoom();
  startLoops();
  api('meetings/' + MID + '/playing').then((r) => { if (r.now) S.skew = r.now - Date.now(); if (r.play) onPlay(r.play, r.media); }).catch(() => {});
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('The room did not load in time.')), ms))]);

async function joinCall(isRejoin) {
  const body = { pid: S.me.pid || undefined, name: S.me.name, mic: S.mic, cam: S.cam, rejoin: !!isRejoin };
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
  root.innerHTML = `<div class="h-card mt-card" style="max-width:560px;margin:20px auto;display:grid;gap:12px" role="status"><h2 class="mt-h2"><span class="spin"></span>Waiting for the host</h2><p class="mt-sub" style="font-size:14px;margin:0">${esc(S.meeting.hostName || 'The host')} will let you in to ${esc(S.meeting.title)} shortly. Keep this page open.</p>${local.cam ? '<video id="wait-me" class="wait-me" muted playsinline autoplay></video>' : ''}<div><button class="h-btn h-btn--ghost" id="wait-leave">Leave</button></div></div>`;
  const wv = $('#wait-me'); if (wv) { wv.srcObject = new MediaStream([local.cam]); wv.play().catch(() => {}); }
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
  // After two connections that never came up, the next one goes through Cloudflare's TURN relay only (TCP and TLS on 443 get
  // through networks that block the direct UDP path).
  const relay = new URLSearchParams(location.search).get('relay') === '1' || S.noConnect >= 2;
  fieldCap = LITE; // a Lite phone publishes its sound already capped
  rtc = new Rtc({ call: (op, body) => api('meetings/' + MID + '/sfu/' + op, { method: 'POST', body: { pid: S.me.pid, ...body } }), iceServers: j.iceServers, relay });
  rtc.onTrack = onTrack;
  rtc.onState = onRtcState;
  rtc.open();
  S.rtcAt = Date.now(); S.everUp = false; rtc.stats.pathAt = Date.now();
  if (!(j.iceServers || []).some((x) => [].concat(x.urls || []).some((u) => /^turns?:/.test(u)))) diag('no-turn');
  const items = [];
  if (S.devices.mic || local.mic) items.push({ name: 'a', kind: 'audio', track: local.mic, enc: LITE ? [{ maxBitrate: 16000 }] : null, label: LITE ? 'lite' : '' });
  items.push({
    name: 'v', kind: 'video', track: S.cam ? local.cam : null,
    simulcast: LITE ? [
      { rid: 'f', scaleResolutionDownBy: 3, maxBitrate: 200000, maxFramerate: 15 },
      { rid: 'h', scaleResolutionDownBy: 4, maxBitrate: 120000, maxFramerate: 15 },
      { rid: 'q', scaleResolutionDownBy: 6, maxBitrate: 60000, maxFramerate: 10 },
    ] : [
      // 720p30 on top (Will, 2026-10-14). A weak link still steps down to h or q on the receiving side.
      { rid: 'f', maxBitrate: 2500000, maxFramerate: 30 },
      { rid: 'h', scaleResolutionDownBy: 2, maxBitrate: 600000, maxFramerate: 30 },
      { rid: 'q', scaleResolutionDownBy: 4, maxBitrate: 150000, maxFramerate: 30 },
    ],
  });
  const pub = await rtc.publish(items);
  // The room's first sync and pulls start now; telling the server what this person sends runs beside them (one retry).
  const say = () => api('meetings/' + MID + '/tracks', { method: 'POST', body: { pid: S.me.pid, tracks: pub } });
  say().catch(() => new Promise((r) => setTimeout(r, 1000)).then(say)).catch((e) => diag('tracks-fail ' + (e && e.message)));
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
  root.innerHTML = `<div class="rm" id="rm"><section class="rm-stage" aria-label="Meeting"><div class="rm-top"><div class="rm-bar" id="rm-bar"></div><div class="rm-tools" id="rm-tools"></div></div><div id="rm-banner"></div><div id="rm-priv"></div><div id="rm-wait"></div><div class="rm-grid" id="rm-grid"></div><div class="rm-hint" id="rm-hint" hidden></div><div class="rm-cap" id="rm-cap" hidden aria-live="off"></div><div id="rm-pop-wrap"></div><div class="rm-ctl" id="rm-ctl" role="toolbar" aria-label="Meeting controls"></div></section><aside class="rm-side" id="rm-side" aria-label="Meeting panel"></aside><div id="rm-more-wrap"></div></div>`;
  S.panel = isPhone() ? '' : 'people';
  paintAll();
  dragToClose($('#rm-side'));
  window.addEventListener('resize', onResizeMode);
  window.addEventListener('keydown', onKey);
  document.addEventListener('input', onInvInput);
  document.addEventListener('focusin', (e) => { if (e.target && e.target.id === 'invin') loadDirectory(); });
  window.addEventListener('beforeunload', onUnload);
  document.addEventListener('click', onDocClick);
  // The room's single-letter shortcuts win over the hub's (G then a letter opens another page); hub-nav.js skips a key whose
  // default is already prevented.
  document.addEventListener('keydown', (e) => {
    if (S.left || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.cf')) return;
    if (e.target && e.target.matches && e.target.matches('input, textarea, select, [contenteditable="true"]')) return;
    if (/^[asglwhxyfpbmv?[\]]$/i.test(e.key)) e.preventDefault();
  }, true);
  watchStage();
  if (!GUEST && S.me.role !== 'guest') maybeStartRecording();
}

const mePerson = () => ({ joinedAt: (S.people.find((p) => p.pid === S.me.pid) || {}).joinedAt || S.joinedAt || 0, pid: S.me.pid, name: S.me.name, role: S.me.role, mic: S.mic, cam: S.cam && !!local.cam, hand: S.hand, sharing: S.sharing, speaking: S.lvl > 12 && S.mic, me: true, with: S.myWith });
const hostish = () => S.me.role === 'host' || S.me.role === 'cohost';
const others = () => S.people.filter((p) => p.pid !== S.me.pid && !p.waiting);
const nameOf = (pid) => (pid === S.me.pid ? S.me.name : (S.people.find((p) => p.pid === pid) || {}).name || 'Someone');

function paintAll() { paintBar(); paintTools(); paintGrid(); paintCtl(); paintSide(); paintMore(); }
// The phone layout has five controls and a More sheet. Turning the phone or resizing the window can switch layouts.
let lastMode = null;
function onResizeMode() {
  const m = sheetMode();
  if (lastMode !== null && m !== lastMode) { S.more = false; S.moreDev = false; paintTools(); paintCtl(); paintMore(); }
  lastMode = m; fitCtl();
}

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
// The control bar's height, for the stage and for toasts, which must sit above it (a toast covered the phone controls).
function fitCtl() { const el = $('#rm-ctl'), st = $('#rm'); if (el && st) { st.style.setProperty('--ctl-h', el.offsetHeight + 'px'); document.documentElement.style.setProperty('--room-ctl', Math.max(0, innerHeight - el.getBoundingClientRect().top) + 'px'); document.documentElement.classList.toggle('in-room', !S.left); } }
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
  lastMode = sheetMode();
  if (lastMode) { keepFocus(el, () => { el.innerHTML = `<button class="rt rt-leave" data-a="leave" aria-label="Leave the meeting">${ic('leave')}<span>Leave</span></button>`; }); return; }
  keepFocus(el, () => {
    el.innerHTML = `<button class="rt${S.pop === 'react' ? ' is-on' : ''}" data-a="pop" data-p="react" aria-label="Reactions" aria-haspopup="dialog" aria-expanded="${S.pop === 'react'}">${ic('smile')}</button>
      <button class="rt${S.pop === 'view' ? ' is-on' : ''}" data-a="pop" data-p="view" aria-label="Your view: ${MODE_NAME[V.mode]}" title="Your view" aria-haspopup="dialog" aria-expanded="${S.pop === 'view'}">${ic(V.mode === 'gallery' ? 'grid' : V.mode === 'auto' ? 'auto' : V.mode === 'spotlight' ? 'spot' : 'speaker')}<span class="lb-t">View</span></button>
      ${document.fullscreenEnabled ? `<button class="rt" data-a="fullscreen" aria-label="Full screen" title="Full screen">${ic('expand')}</button>` : ''}
      ${GUEST ? '' : `<button class="rt" data-a="copylink" aria-label="Copy meeting link">${ic('link')}<span class="lb-t">Copy link</span></button>`}
      <button class="rt" data-a="devmenu" aria-label="Settings: camera, microphone and speaker" title="Settings" aria-haspopup="dialog">${ic('gear')}</button>`;
  });
}

const EMOJI = ['\u{1F44D}', '\u{1F44F}', '\u2764\uFE0F', '\u{1F602}', '\u{1F62E}', '\u{1F389}'];
async function paintPop() {
  const el = $('#rm-pop-wrap'); if (!el) return;
  if (!S.pop) { el.innerHTML = ''; return; }
  if (S.pop === 'view' || S.pop === 'keys') { const sig = S.pop === 'view' ? viewPopHTML() : keysPopHTML(); const had = el.firstElementChild && el.firstElementChild.classList.contains('rm-view') && el.dataset.pop === S.pop; keepFocus(el, () => { el.innerHTML = sig; }); el.dataset.pop = S.pop; if (!had) { const f = el.querySelector('[aria-checked="true"], button'); f && f.focus({ preventScroll: true }); el.firstElementChild.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches && el.firstElementChild.animate([{ opacity: 0, transform: 'translateY(-6px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' }); } return; }
  if (S.pop === 'react') { el.innerHTML = `<div class="rm-pop" role="dialog" aria-label="Reactions"><div class="emo">${EMOJI.map((e) => `<button data-a="emoji" data-e="${e}" aria-label="React ${e}">${e}</button>`).join('')}</div></div>`; const b = el.querySelector('button'); b && b.focus(); return; }
}
// A new camera, microphone or speaker in the call. The new track goes onto the same sender (replaceTrack), so nobody else
// notices anything but the picture or sound changing. The pick is saved for this person.
async function switchDevice(kind, id) {
  try {
    if (kind === 'spk') { remember({ spkId: id }); $$('audio[id^="a-"]').forEach((a) => a.setSinkId && a.setSinkId(id).catch(() => {})); return true; }
    if (kind === 'mic') {
      const { track: t } = await acquire('audio', { ...P, micId: id });
      t.enabled = S.mic;
      const oldRaw = local.micRaw; const out = await setMic(t); if (S.micIssue) { S.micIssue = ''; paintBar(); }
      if (rtc) await rtc.replace('a', out);
      if (oldRaw && oldRaw !== t) oldRaw.stop();
      if (id) remember({ micId: id });
      paintDevSheet(); return true;
    }
    remember({ camId: id });
    if (S.cam && !AUDIO_ONLY) {
      // Some cameras open in one place at a time: stop the old one first, then put the new one on the sender.
      stopCam();
      const { track: t } = await acquire('video', P);
      await setCam(t); if (rtc) await rtc.replace('v', local.cam); paintGrid();
    } else await devPreview();
    paintDevSheet(); return true;
  } catch { toast('That device did not open.'); paintDevSheet(); return false; }
}

// ---- Settings: camera, microphone and speaker in the call, with a live preview, a level meter and a speaker test.
// A dialog on a desktop, a bottom sheet on a phone. Opened from the gear in the top bar, the chevrons beside Mute and Camera,
// and the More sheet on a phone.
let devOpen = '', devPrev = null, devFocus = null, prevFx = null, prevOut = null;
async function openDevSheet(section) {
  devFocus = document.activeElement;
  devOpen = section || 'all';
  S.pop = ''; paintTools(); paintPop();
  if (S.more) closeMore();
  let wrap = $('#rm-dev-wrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'rm-dev-wrap'; ($('#rm') || document.body).appendChild(wrap); }
  wrap.innerHTML = `<div class="rd-scrim" data-a="dev-close"></div><section class="rd" role="dialog" aria-modal="true" aria-labelledby="rd-t" tabindex="-1">
    <div class="rm-grab" aria-hidden="true"></div>
    <header class="rd-h"><h2 id="rd-t">Settings</h2><button class="icon-b" data-a="dev-close" aria-label="Close settings">${ic('x')}</button></header>
    <div class="rd-b"><div class="rd-prev" id="rd-prev"><video id="rd-video" muted playsinline autoplay></video><span class="rd-off" id="rd-off">${AUDIO_ONLY ? 'Audio call' : 'Camera off'}</span></div><div class="rd-f" id="rd-f"></div></div>
    <footer class="rd-foot"><button class="h-btn h-btn--primary" data-a="dev-close">Done</button></footer></section>`;
  const sh = wrap.querySelector('.rd');
  wrap.addEventListener('change', onDevChange);
  dragSheet(sh, closeDevSheet);
  await paintDevSheet();
  if (!(S.cam && local.cam)) await devPreview();
  const target = section === 'mic' ? '#rd-mic' : section === 'cam' ? '#rd-cam' : section === 'spk' ? '#rd-spk' : null;
  const f = (target && $(target)) || sh; f.focus({ preventScroll: true });
}
function closeDevSheet() {
  if (!devOpen) return;
  devOpen = ''; stopDevPreview();
  const w = $('#rm-dev-wrap'); if (w) w.remove();
  if (devFocus && devFocus.isConnected) try { devFocus.focus({ preventScroll: true }); } catch {}
}
function stopDevPreview() { if (prevFx) { prevFx.stop(); prevFx = null; } prevOut = null; if (devPrev) { devPrev.stop(); devPrev = null; } }
// With the camera off, the preview opens the saved camera on its own and closes it with the sheet. Nothing is sent.
async function devPreview() {
  if (!devOpen || AUDIO_ONLY || (S.cam && local.cam)) { stopDevPreview(); paintDevVideo(); return; }
  stopDevPreview();
  try {
    const { track } = await acquire('video', P); if (!devOpen || (S.cam && local.cam)) { track.stop(); return; } devPrev = track;
    if (CamFx.wanted(P)) { const c = new CamFx({ bg: P.bg, image: P.bgImg, light: P.light }); try { prevOut = await c.start(track); prevFx = c; } catch { prevOut = null; } }
  } catch { devPrev = null; }
  paintDevVideo();
}
function paintDevVideo() {
  const v = $('#rd-video'), off = $('#rd-off'), box = $('#rd-prev'); if (!v) return;
  const t = S.cam && local.cam ? local.cam : prevOut || devPrev;
  box.classList.toggle('has-video', !!t);
  if (off) off.textContent = AUDIO_ONLY ? 'Audio call' : t ? '' : 'Camera off';
  box.classList.toggle('is-preview', !!t && !(S.cam && local.cam));
  const cur = v.srcObject && v.srcObject.getVideoTracks()[0];
  if (t && cur !== t) { v.srcObject = new MediaStream([t]); v.play().catch(() => {}); } else if (!t) v.srcObject = null;
}
async function paintDevSheet() {
  const box = $('#rd-f'); if (!box || !devOpen) return;
  const { mics, cams, spks } = await deviceList();
  if (!devOpen) return;
  const curMic = trackDevice(local.micRaw) || P.micId, curCam = trackDevice(S.cam && local.camRaw) || trackDevice(devPrev) || P.camId;
  const canSink = 'setSinkId' in HTMLMediaElement.prototype;
  const sel = (id, kind, list, cur, lab) => `<select id="${id}" data-dev="${kind}">${list.length ? optList(list, cur, lab) : `<option value="">No ${lab.toLowerCase()} found</option>`}</select>`;
  const spkCur = spks.some((d) => d.deviceId === P.spkId) ? P.spkId : 'default';
  const html = `${AUDIO_ONLY ? '' : `<div class="rd-s"><label for="rd-cam">Camera</label>${sel('rd-cam', 'cam', cams, curCam, 'Camera')}</div>`}
    <div class="rd-s"><label for="rd-mic">Microphone</label>${sel('rd-mic', 'mic', mics, curMic, 'Microphone')}<div class="rd-meter" aria-hidden="true"><i id="rd-lvl"></i></div></div>
    <div class="rd-s"><label for="rd-spk">Speaker</label><div class="rd-row">${canSink && spks.length ? sel('rd-spk', 'spk', spks, spkCur, 'Speaker') : '<span class="rd-sys">System speaker</span>'}<button class="h-btn h-btn--ghost h-btn--sm" data-a="dev-test">${ic('play')}Test</button></div></div>
    ${AUDIO_ONLY ? '' : `<div class="rd-s"><span class="rd-lab">Background</span><div class="rd-bgs" role="group" aria-label="Background">${bgChips()}</div><label class="rd-tg"><span>Brighten a dark room</span><input type="checkbox" role="switch" data-pref="light" ${P.light ? 'checked' : ''} /></label><label class="rd-tg"><span>Ask who is with me when the camera sees two faces</span><input type="checkbox" role="switch" data-pref="faces" ${P.faces !== false ? 'checked' : ''} /></label></div>`}
    <div class="rd-s rd-tgs"><label class="rd-tg"><span>Voice clarity</span><input type="checkbox" role="switch" data-pref="voice" ${P.voice !== false ? 'checked' : ''} /></label><label class="rd-tg"><span>Strong noise reduction</span><input type="checkbox" role="switch" data-pref="gate" ${P.gate ? 'checked' : ''} ${P.voice === false ? 'disabled' : ''} /></label><label class="rd-tg"><span>Noise suppression</span><input type="checkbox" role="switch" data-pref="ns" ${P.ns !== false ? 'checked' : ''} /></label><label class="rd-tg"><span>Echo cancellation</span><input type="checkbox" role="switch" data-pref="ec" ${P.ec !== false ? 'checked' : ''} /></label></div>`;
  if (box.dataset.h !== html) {
    const ae = document.activeElement, keep = ae && box.contains(ae) ? ae.id || (ae.dataset && ae.dataset.pref) : '';
    box.innerHTML = html; box.dataset.h = html;
    if (keep) { const n = $('#' + keep) || box.querySelector('[data-pref="' + keep + '"]'); n && n.focus({ preventScroll: true }); }
  }
  paintDevVideo();
}
async function onDevChange(e) {
  const t = e.target;
  if (t.dataset.bgup !== undefined) { uploadBg(t.files && t.files[0]); return; }
  if (t.dataset.dev) { t.disabled = true; await switchDevice(t.dataset.dev, t.value); t.disabled = false; return; }
  if (t.dataset.pref) {
    remember({ [t.dataset.pref]: t.checked });
    // Noise suppression and echo cancellation are set when the microphone opens: open it again on the same device.
    if (t.dataset.pref === 'light') { await reapplyCam(); return; }
    if (t.dataset.pref === 'faces') { S.faceAsk.streak = 0; return; }
    if (t.dataset.pref === 'voice' || t.dataset.pref === 'gate') { if (local.micRaw) { const out = await setMic(local.micRaw); if (rtc && out) await rtc.replace('a', out); } paintDevSheet(); return; }
    if (local.micRaw) await switchDevice('mic', trackDevice(local.micRaw) || P.micId);
  }
}
function bgChips() {
  const cur = !P.bg || P.bg === 'none' ? 'none' : P.bg === 'blur' ? 'blur' : P.bgImg && P.bgImg.startsWith('data:') ? 'custom' : P.bgImg || BACKGROUNDS[0].id;
  const chip = (v, label, style = '') => `<button type="button" class="rd-bg${cur === v ? ' is-on' : ''}" data-a="dev-bg" data-v="${v}" aria-pressed="${cur === v}"${style}><span>${label}</span></button>`;
  const sw = { leaf: 'linear-gradient(135deg,#2f4a2a,#6f8a5a)', ivory: 'radial-gradient(#fbf8f0,#d9d1bd)', gold: 'linear-gradient(45deg,#7a5a22,#d6b46a)', office: 'linear-gradient(#e9e4d8 70%,#d4ccb9 70%)' };
  return chip('none', 'None') + chip('blur', 'Blur') + BACKGROUNDS.map((b) => chip(b.id, b.label, ` style="--sw:${sw[b.id]}"`)).join('') +
    (P.bgCustom ? chip('custom', 'Yours', ` style="--sw:url('${P.bgCustom}') center/cover"`) : '') +
    `<label class="rd-bg rd-up"><span>Upload</span><input type="file" accept="image/*" data-bgup hidden /></label>`;
}
function pickBg(v) {
  if (v === 'none' || v === 'blur') remember({ bg: v });
  else if (v === 'custom') remember({ bg: 'image', bgImg: P.bgCustom });
  else remember({ bg: 'image', bgImg: v });
  reapplyCam();
}
// An uploaded picture is scaled to 1280 by 720 and kept on this device only.
function uploadBg(file) {
  if (!file || !/^image\//.test(file.type)) return;
  const im = new Image(); const url = URL.createObjectURL(file);
  im.onload = () => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d');
    const s = Math.max(1280 / im.width, 720 / im.height); x.drawImage(im, (1280 - im.width * s) / 2, (720 - im.height * s) / 2, im.width * s, im.height * s);
    URL.revokeObjectURL(url);
    const data = c.toDataURL('image/jpeg', 0.8);
    remember({ bg: 'image', bgImg: data, bgCustom: data }); reapplyCam();
  };
  im.onerror = () => toast('That picture did not open.');
  im.src = url;
}

// A short three-note chime through the chosen speaker.
function testSpeaker(btn) {
  try {
    const c = new (window.AudioContext || window.webkitAudioContext)();
    const dest = c.createMediaStreamDestination();
    [523.25, 659.25, 783.99].forEach((fq, i) => { const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + i * 0.22; o.frequency.value = fq; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4); o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.42); });
    const a = new Audio(); a.srcObject = dest.stream;
    const go = () => a.play().catch(() => {});
    if (P.spkId && a.setSinkId) a.setSinkId(P.spkId).then(go, go); else go();
    if (btn) { btn.disabled = true; btn.lastChild.textContent = 'Playing'; }
    setTimeout(() => { a.pause(); c.close(); if (btn && btn.isConnected) { btn.disabled = false; btn.lastChild.textContent = 'Test'; } }, 1300);
  } catch { toast('The test sound did not play.'); }
}
function dragSheet(sheet, onClose) {
  if (!sheet) return;
  let d = null;
  sheet.addEventListener('touchstart', (e) => { if (!e.target.closest('.rm-grab, .rd-h')) return; d = { y: e.touches[0].clientY, dy: 0 }; }, { passive: true });
  sheet.addEventListener('touchmove', (e) => { if (!d) return; d.dy = Math.max(0, e.touches[0].clientY - d.y); sheet.style.transform = 'translateY(' + d.dy + 'px)'; }, { passive: true });
  const end = () => { if (!d) return; const close = d.dy > 80; d = null; sheet.style.transform = ''; if (close) onClose(); };
  sheet.addEventListener('touchend', end); sheet.addEventListener('touchcancel', end);
}
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', () => { if (devOpen) paintDevSheet(); });

function floatEmoji(e, name) {
  const st = $('.rm-stage'); if (!st || !e) return;
  const n = document.createElement('div'); n.className = 'rx'; n.style.left = (12 + Math.random() * 70) + '%';
  n.innerHTML = '<i></i><span></span>'; n.firstChild.textContent = e; n.lastChild.textContent = name || '';
  st.appendChild(n); setTimeout(() => n.remove(), 2700);
}
// The meeting's sounds come from the FavorOS family (hub-sound.js): knock, notify, mention, join, leave, rec-start, rec-stop.
function chime(name) {
  if (window.hubSound) { window.hubSound.play(name || 'notify'); return; }
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
  const recLab = r && r.active ? (r.mode === 'video' ? 'Recording' : 'Transcribing') : m.rec === 'off' ? 'Not recorded' : !r && Date.now() - S.started < 10000 ? 'Starting' : m.rec === 'video' ? 'Recording off' : 'Notes off';
  const recCls = r && r.active ? (r.mode === 'video' ? '' : ' is-notes') : m.rec === 'off' ? ' is-none' : ' is-notes';
  const rec = hostish() && !GUEST
    ? `<button type="button" class="rm-rec rm-rec--btn${recCls}" data-a="recmenu" aria-haspopup="menu" aria-expanded="${!!S.recMenu}" title="Change what this meeting records"><i></i>${recLab}${ic('chev')}</button>`
    : `<span class="rm-rec${recCls}" role="status"><i></i>${recLab}</span>`;
  const lv = S.level === 'good' ? 'Connection good' : S.level === 'fair' ? 'Connection fair' : 'Connection weak';
  // Pause recording (it was called Private moment): everyone sees Recording paused; a host or cohost pauses and resumes from here.
  const paused = !!S.private && m.rec !== 'off';
  const pill = paused ? `<span class="rm-rec is-paused" role="status">${ic('pause')}Recording paused</span>` : rec;
  const pauseBtn = hostish() && m.rec !== 'off' && (paused || (r && r.active)) ? `<button class="rm-pause" data-a="private" aria-pressed="${paused}">${ic(paused ? 'rec' : 'pause')}${paused ? 'Resume recording' : 'Pause recording'}</button>` : '';
  // The bar is drawn again only when something other than the clock changed, so a tap on Pause recording is never lost to the
  // once a second repaint.
  const clockText = `${mins}:${String(secs).padStart(2, '0')}`;
  const html = `<b>${esc(m.title)}</b>${pill}${pauseBtn}<span id="rm-clock"></span>${S.locked ? `<span class="mt-pill mt-pill--gold" style="height:22px">${ic('lock')}Locked</span>` : ''}<span class="rm-net is-${S.level}" style="margin-left:auto">${ic('wifi')}${lv}${rtc && rtc.stats.relay ? ' (relay)' : ''}</span>`;
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
  const ck = el.querySelector('#rm-clock'); if (ck) ck.textContent = clockText;
  const nt = el.querySelector('.rm-net'); if (nt) nt.title = netDetail();
  const b = $('#rm-banner');
  // Drawn only when it changed, so a press on Retry or Ring again is never lost to the once a second repaint.
  const bh = (S.soundBlocked ? `<div class="banner warn">${ic('speaker')}<span>The browser paused the sound of this call.</span><button class="h-btn h-btn--primary h-btn--sm" data-a="sound-on">Turn on sound</button></div>` : '') + micIssueHTML() + (S.conn === 'drop' ? `<div class="banner">${ic('wifi')}Your connection dropped. Reconnecting.${S.recording && S.recording.active ? ' The recording keeps going.' : ''}</div>` : S.conn === 'back' ? `<div class="banner ok">${ic('check')}You are back.${S.missedSec > 3 ? ` You missed ${Math.round(S.missedSec)} seconds.` : ''}</div>` : '') + recMissHTML() + ringsHTML();
  if (b && b._html !== bh) { b.innerHTML = bh; b._html = bh; }
  paintRecMenu();
}
function recMissHTML() {
  if (!S.recMiss) return '';
  return hostish() ? `<div class="banner warn" role="alert">${ic('rec')}<span>Recording did not start. Nothing is being recorded or written down.</span><button class="h-btn h-btn--primary h-btn--sm" data-a="rec-retry">Retry</button></div>`
    : `<div class="banner warn" role="status">${ic('rec')}<span>Recording did not start. A host can retry from the recording button.</span></div>`;
}
// Who this room is ringing (a huddle call or Ring in People): ringing, declined with their message, or missed.
function ringsHTML() {
  const now = Date.now();
  // Never your own ring, and nothing about someone who is in the room now.
  const here = new Set(others().map((p) => p.name));
  return (S.rings || []).filter((x) => x.to !== S.myEmail && !(x.state !== 'ringing' && here.has(x.name))).filter((x) => x.state === 'ringing' || ((x.state === 'declined' || x.state === 'missed') && now - (x.seenAt || now) < 60000)).map((x) => {
    const first = esc(String(x.name || x.to).split(' ')[0]);
    if (x.state === 'ringing') return `<div class="banner rm-ring" role="status"><span class="rm-ring__dot" aria-hidden="true"></span><span>Ringing ${esc(x.name || x.to)}</span>${x.from === S.myEmail ? `<button class="h-btn h-btn--ghost h-btn--sm" data-a="ring-cancel" data-id="${esc(x.id)}">Stop ringing</button>` : ''}</div>`;
    const why = x.state === 'declined' ? (x.note ? `${first} cannot join: "${esc(x.note)}"` : `${first} declined`) : x.why === 'quiet' ? `${first} is in quiet hours. FavorOS left a missed huddle note in Chat.` : `${first} did not answer. FavorOS left a missed huddle note in Chat.`;
    return `<div class="banner" role="status">${ic('users')}<span>${why}</span>${x.why !== 'quiet' && x.from === S.myEmail ? `<button class="h-btn h-btn--ghost h-btn--sm" data-a="ring-again" data-v="${esc(x.to)}">Ring again</button>` : ''}</div>`;
  }).join('');
}
function paintRecMenu() {
  const top = $('.rm-top'); if (!top) return;
  let el = $('#rm-recmenu');
  if (!S.recMenu || !hostish()) { if (el) el.remove(); return; }
  const cur = S.meeting.rec;
  const opt = (v, t, sub) => `<button type="button" role="menuitemradio" aria-checked="${cur === v}" data-a="recmode" data-p="${v}"><span><b>${t}</b><small>${sub}</small></span>${cur === v ? ic('check') : ''}</button>`;
  const html = `${opt('video', 'Record video', 'Video, sound and notes')}${opt('notes', 'Transcribe only', 'Notes from the sound. No video is kept.')}${opt('off', 'Neither', 'Nothing is recorded or written down')}<p>Everyone in the meeting sees what is recorded.</p>`;
  if (!el) { el = document.createElement('div'); el.id = 'rm-recmenu'; el.className = 'rm-recmenu'; el.setAttribute('role', 'menu'); el.setAttribute('aria-label', 'What this meeting records'); top.appendChild(el); }
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
}
async function setRecMode(mode) {
  S.recMenu = false; paintBar();
  if (mode === S.meeting.rec) return;
  const before = S.meeting.rec;
  if (mode === 'off' && S.recording && S.recording.active && !(await confirmStopRecording(S.recording.mode))) return;
  try {
    await api('meetings/' + MID + '/recmode', { method: 'POST', body: { rec: mode, pid: S.me.pid } });
    S.meeting.rec = mode; S.recStopped = mode === 'off'; S.autoRec = true; S.ctlSig = null;
    if (!recorder) maybeStartRecording();
    await recorder.stopIfOwner(true);
    if (mode !== 'off') await recorder.start();
    paintBar(); paintCtl();
  } catch (e) { S.meeting.rec = before; toast(e.message); paintBar(); }
}
async function ringPeople(emails) {
  try {
    const r = await fetch('/api/chat/ring', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' }, body: JSON.stringify({ to: emails, meeting: MID }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.ok === false) throw new Error(d.message || 'Ringing did not work.');
    S.rings = (S.rings || []).concat((d.rings || []).map((x) => ({ ...x, from: S.myEmail, left: 30000, seenAt: Date.now(), note: '' })));
    paintBar();
    return d;
  } catch (e) { toast(e.message); return null; }
}

function netDetail() {
  const st = rtc && rtc.stats; if (!st || !st.t) return '';
  return [st.rtt ? 'Round trip ' + Math.round(st.rtt * 1000) + ' ms' : '', 'Packet loss ' + (st.loss * 100).toFixed(1) + '%', st.bps ? 'Receiving ' + (st.bps / 1e6).toFixed(1) + ' Mbps' : ''].filter(Boolean).join(' · ');
}

// ---- tiles
function makeTile(key, p, share) {
  const el = document.createElement('div'); el.className = 'mt-tile'; el.dataset.key = key;
  el.innerHTML = `<video muted playsinline autoplay></video><span class="face"></span><span class="tag" hidden></span><span class="hb" hidden></span><button class="pin" hidden></button><span class="nm"><span class="mi"></span><span class="nt"></span></span>`;
  const t = { el, video: el.querySelector('video'), key, share, pid: p.pid, audio: null };
  ['playing', 'loadeddata'].forEach((ev) => t.video.addEventListener(ev, () => el.classList.add('is-live')));
  ['emptied', 'abort'].forEach((ev) => t.video.addEventListener(ev, () => el.classList.remove('is-live')));
  if (share) { el.addEventListener('click', (e) => { if (el.classList.contains('is-float') || e.target.closest('button')) return; el.classList.toggle('is-zoom'); }); el.addEventListener('mousemove', (e) => { if (!el.classList.contains('is-zoom')) return; const r = el.getBoundingClientRect(); t.video.style.transformOrigin = ((e.clientX - r.left) / r.width * 100) + '% ' + ((e.clientY - r.top) / r.height * 100) + '%'; }); }
  // Double-click: a share goes full screen; a face is pinned for me (or unpinned).
  el.addEventListener('dblclick', (e) => { if (e.target.closest('button')) return; if (share) { fullStage(key); return; } viewAct(S.pin === t.pid ? 'unpin' : 'pin', t.pid); });
  tiles.set(key, t);
  return t;
}

function order() {
  // Who is on screen: the share first, then the spotlight or pin, then the host, then whoever spoke last, then the rest.
  const me = mePerson();
  const everyone = [me, ...others()];
  const sharer = everyone.find((p) => p.sharing && (p.me ? !!local.screen : true));
  // A pin is this person's own choice and beats the host's spotlight on their screen only.
  let big = (S.pin && everyone.some((p) => p.pid === S.pin) ? S.pin : '') || S.spot;
  const hasContent = !!sharer || !!S.show || !!document.getElementById('rm-play');
  if (!big && (V.mode === 'speaker' || V.mode === 'spotlight' || (hasContent && R.swap)) && everyone.length > 1) big = speakerPid(everyone);
  // Gallery order never changes while people talk: the pinned or spotlit person, then the host, then everyone by the time they
  // joined. Only speaker view and the strip beside a share follow whoever spoke last.
  const rank = (p) => (p.pid === big ? -1 : p.role === 'host' ? 0 : 1);
  const bySpeech = V.mode === 'speaker' || V.mode === 'spotlight' || hasContent;
  const sorted = everyone.slice().sort((a, b) => rank(a) - rank(b) || (bySpeech ? (b.speakAt || 0) - (a.speakAt || 0) : 0) || (a.joinedAt || 0) - (b.joinedAt || 0) || String(a.pid).localeCompare(String(b.pid)));
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
// A weak link gets lower layers (wanted() below), never fewer people: paging someone off the screen also stopped their video.
const perPage = () => (isPhone() ? 6 : 9);

// ---- views: each person's own layout (stage.js). Nothing here is sent to the room.
// V is saved in this browser (mode, strip side and size, hide self view, the small window's place); R is this meeting only.
const MS = window.MeetStage;
let V = MS.load();
const R = { stage: 'normal', swap: false, ckey: '', pip: '', phPage: 0, drag: false };
function setView(patch) { V = MS.clean(Object.assign({}, V, patch)); MS.save(V); }
const stripSide = () => (isPhone() ? 'bottom' : V.strip);
function stripCapNow() {
  if (isPhone()) return 4;
  const g = $('#rm-grid'); if (!g || !g.clientWidth) return 4;
  return MS.stripCap(V.strip, V.strip === 'bottom' ? V.bottom : V.side, g.clientWidth - 24, g.clientHeight, 8);
}
// The shared things that can hold the stage: a clip played for everyone, a screen share, a Favor Brain answer.
function contents(sharer) {
  const list = [];
  if (document.getElementById('rm-play')) list.push({ key: 'play', kind: 'play', p: { pid: 'play', name: (S.play && S.play.title) || 'Video' } });
  if (sharer) list.push({ key: 'share:' + sharer.pid, kind: 'share', p: sharer });
  if (S.show) list.push({ key: 'brain', kind: 'brain', p: { pid: 'brain', name: 'Favor Brain' } });
  return list;
}
let lastLayout = null;
function layoutModel() {
  const { sharer, big, sorted } = order();
  const cs = contents(sharer);
  // A new share or clip comes back to the stage, even if the last one was hidden or shrunk.
  const ck = cs.length ? cs[0].key : '';
  if (ck !== R.ckey) { if (R.ckey && ck) { R.stage = 'normal'; R.swap = false; } if (!ck) { R.stage = 'normal'; R.swap = false; } R.ckey = ck; R.phPage = 0; }
  const r = MS.arrange({ faces: sorted, content: cs[0] || null, extra: cs[1] || null, big: (S.pin && sorted.some((p) => p.pid === S.pin) ? S.pin : '') || S.spot || big || '', view: V, room: R, cap: stripCapNow(), perPage: perPage(), page: S.page });
  S.pages = r.pages; S.page = r.page;
  const model = r.model.map((x) => (x.content ? { ...x, share: x.content === 'share', brain: x.content === 'brain', play: x.content === 'play' } : x));
  lastLayout = { ...r, model };
  return lastLayout;
}

function paintGrid() {
  const grid = $('#rm-grid'); if (!grid) return;
  const L = layoutModel(); const { model, spot } = L;
  const n = model.filter((x) => x.kind !== 'float').length;
  const side = stripSide();
  // Layout changes glide (FLIP): the tiles' places are read before a change of who is shown or how, and each tile slides from
  // its old place to its new one. Only when the set or the mode changes, so talking never moves anything.
  const keySig = (spot ? 's' + side + ':' : 'g:') + model.map((x) => x.key + x.kind).join(',');
  const flip = !R.drag && grid.dataset.keys !== undefined && grid.dataset.keys !== keySig && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const before = new Map();
  if (flip) {
    for (const [k, t] of tiles) if (t.el.parentNode === grid) before.set(k, t.el.getBoundingClientRect());
    ['rm-play', 'rm-brain-tile'].forEach((id) => { const e = document.getElementById(id); if (e && e.offsetWidth) before.set('#' + id, e.getBoundingClientRect()); });
  }
  const fresh = [];
  grid.dataset.keys = keySig;
  grid.className = 'rm-grid' + (spot ? ' is-spot is-' + side : ' is-fit') + (spot && n === 1 ? ' is-alone' : '');
  const keep = new Set(model.map((x) => x.key));
  for (const [k, t] of tiles) if (!keep.has(k)) t.el.remove();
  if (!model.some((x) => x.brain)) { const bt = document.getElementById('rm-brain-tile'); if (bt) bt.remove(); }
  if (!model.some((x) => x.play)) { const ps = document.getElementById('rm-play-slot'); if (ps) ps.remove(); }
  const mt0 = document.getElementById('rm-more-tile'); if (mt0 && !model.some((x) => x.kind === 'more')) mt0.remove();
  model.forEach(({ key, p, kind, share, brain, play, n: moreN }, i) => {
    if (brain) { paintBrainTile(grid, i); const be = document.getElementById('rm-brain-tile'); if (be) be.classList.toggle('is-big', kind === 'big'); return; }
    if (play) {
      // The clip's player lives outside the grid (moving an iframe reloads it); this empty tile holds its place, and syncPlay()
      // lays the player over it.
      let el = document.getElementById('rm-play-slot');
      if (!el) { el = document.createElement('div'); el.id = 'rm-play-slot'; el.className = 'mt-tile mt-slot'; el.setAttribute('aria-hidden', 'true'); fresh.push(el); }
      el.classList.toggle('is-big', kind === 'big');
      if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] || null);
      return;
    }
    if (kind === 'more') {
      let el = document.getElementById('rm-more-tile');
      if (!el) { el = document.createElement('div'); el.id = 'rm-more-tile'; el.className = 'mt-tile mt-more'; el.setAttribute('role', 'button'); el.tabIndex = 0; el.dataset.a = 'panel'; el.dataset.p = 'people'; }
      el.innerHTML = `<span>+${moreN}<small>more in the meeting</small></span>`;
      if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] || null);
      return;
    }
    let t = tiles.get(key); if (!t) { t = makeTile(key, p, !!share); fresh.push(t.el); }
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
    const ss = !share && !p.me ? soundState(p.pid) : '';
    const label = share ? '' : ss === 'nosound' ? 'No sound' : ss === 'connecting' && p.mic ? 'Connecting' : S.spot === p.pid ? 'Spotlight' : p.role === 'guest' ? 'Guest' : '';
    const hn = !share && (p.me ? S.hand : p.hand) ? handNo(p.pid) || 1 : 0;
    const hb = t.el.querySelector('.hb'); hb.hidden = !hn; t.el.classList.toggle('is-hand', !!hn);
    if (hn) { hb.innerHTML = `${ic('hand')}<b>${hn}</b>`; hb.setAttribute('aria-label', `Hand raised, number ${hn}`); }
    tag.classList.toggle('is-warn', ss === 'nosound');
    tag.hidden = !label; tag.textContent = label;
    // The tile's options button: pin for me, spotlight for everyone (hosts), swap, picture in picture, full screen, hide self view.
    const pin = t.el.querySelector('.pin');
    pin.hidden = false; pin.dataset.a = 'tmenu'; pin.dataset.k = key;
    const pinned = !share && S.pin === p.pid;
    t.el.classList.toggle('is-pinned', pinned);
    if (pin.dataset.ic !== (pinned ? 'pin' : 'more')) { pin.dataset.ic = pinned ? 'pin' : 'more'; pin.innerHTML = ic(pinned ? 'pin' : 'more'); }
    pin.setAttribute('aria-label', (share ? 'Options for the shared screen' : 'Options for ' + (p.me ? 'your video' : p.name)) + (pinned ? ', pinned for you' : ''));
    pin.setAttribute('aria-haspopup', 'menu'); pin.setAttribute('aria-expanded', String(R.menu === key));
    t.el.querySelector('.mi').innerHTML = share ? ic('screen') : p.mic ? '' : `<span class="off">${ic('micOff')}</span>`;
    t.el.querySelector('.nt').textContent = share ? `${p.me ? 'You are' : p.name + ' is'} presenting` : p.me ? 'You' + paren([p.role === 'host' ? 'host' : '', withWords(p.with)]) : p.name + paren([withWords(p.with)]);
  });
  placeTiles(grid, model, spot, side);
  if (!spot) fitGrid(grid, n);
  paintPager();
  syncPlay();
  paintViewUi(L);
  // The player and stage buttons follow the slot again once the glide and any page slide have finished.
  clearTimeout(R.settle); requestAnimationFrame(syncPlay); R.settle = setTimeout(() => { syncPlay(); placeFui(); positionSui(L.model.find((x) => x.kind === 'big')); }, 360);
  if (flip) {
    for (const [k, r0] of before) {
      const el = k[0] === '#' ? document.getElementById(k.slice(1)) : (tiles.get(k) || {}).el;
      if (!el || !el.isConnected || !el.offsetWidth) continue;
      const t = { el };
      const r1 = t.el.getBoundingClientRect(); if (!r1.width || !r0.width) continue;
      const dx = r0.left - r1.left, dy = r0.top - r1.top, sx = r0.width / r1.width, sy = r0.height / r1.height;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
      t.el.animate([{ transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transformOrigin: '0 0', transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    for (const el of fresh) el.animate([{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 280, delay: 60, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
  }
}

const elOf = (x) => (x.play ? document.getElementById('rm-play-slot') : x.brain ? document.getElementById('rm-brain-tile') : x.kind === 'more' ? document.getElementById('rm-more-tile') : (tiles.get(x.key) || {}).el);
// Desktop stage and strip: the strip's tiles keep a 16:9 shape and sit in the middle of the strip; the split is draggable,
// and its size sets how many faces fit. The phone keeps its stage over a row of faces (meet.css).
function placeTiles(grid, model, spot, side) {
  const flow = model.filter((x) => x.kind !== 'float');
  const desk = spot && !isPhone();
  const k = flow.length - 1;
  let lanes = 1, off = 0;
  if (desk && k > 0) { lanes = Math.max(k, stripCapNow()); off = Math.floor((lanes - k) / 2); }
  if (!desk) {
    grid.style.gridTemplateColumns = spot && isPhone() && flow.length > 1 ? `repeat(${flow.length - 1}, minmax(0, 1fr))` : '';
    grid.style.gridTemplateRows = '';
  } else if (k <= 0) { grid.style.gridTemplateColumns = 'minmax(0, 1fr)'; grid.style.gridTemplateRows = 'minmax(0, 1fr)'; }
  else if (side === 'bottom') { grid.style.gridTemplateColumns = `repeat(${lanes}, minmax(0, 1fr))`; grid.style.gridTemplateRows = `minmax(0, 1fr) ${V.bottom}px`; }
  else { grid.style.gridTemplateColumns = `minmax(0, 1fr) ${V.side}px`; grid.style.gridTemplateRows = `repeat(${lanes}, minmax(0, 1fr))`; }
  flow.forEach((x, j) => {
    const el = elOf(x); if (!el) return;
    if (!desk) { el.style.gridColumn = ''; el.style.gridRow = ''; return; }
    if (j === 0) { el.style.gridColumn = side === 'bottom' && k > 0 ? `1 / span ${lanes}` : '1'; el.style.gridRow = side === 'bottom' || k <= 0 ? '1' : `1 / span ${lanes}`; }
    else if (side === 'bottom') { el.style.gridRow = '2'; el.style.gridColumn = String(off + j); }
    else { el.style.gridColumn = '2'; el.style.gridRow = String(off + j); }
  });
  // The small window floats over the faces, inside the grid's box.
  const fl = model.find((x) => x.kind === 'float');
  for (const el of grid.querySelectorAll(':scope > .is-float')) if (!fl || el !== elOf(fl)) { el.classList.remove('is-float'); ['left', 'top', 'width', 'height'].forEach((p) => (el.style[p] = '')); }
  if (fl) {
    const el = elOf(fl); if (!el) return;
    el.classList.add('is-float'); el.style.gridColumn = ''; el.style.gridRow = '';
    const b = floatRect(grid);
    el.style.left = b.x + 'px'; el.style.top = b.y + 'px'; el.style.width = b.w + 'px'; el.style.height = b.h + 'px';
  }
}
// The small window's box in stage coordinates.
function floatRect(grid) {
  grid = grid || $('#rm-grid');
  const st = grid.parentNode.getBoundingClientRect(), g = grid.getBoundingClientRect();
  const pad = 10, W = g.width - pad * 2, H = g.height - pad * 2;
  const b = MS.floatBox(V.float, W, H, 16 / 9);
  return { x: b.x + g.left - st.left + pad, y: b.y + g.top - st.top + pad, w: b.w, h: b.h, W, H, gx: g.left - st.left + pad, gy: g.top - st.top + pad };
}
// The clip player sits on top of its slot, wherever the slot is: the stage, the strip, a gallery tile or the small window.
// Hidden, it keeps playing (sound and sync) out of sight.
function syncPlay() {
  const pl = document.getElementById('rm-play'), slot = document.getElementById('rm-play-slot');
  if (!pl) return;
  if (!slot || !slot.isConnected || !slot.offsetWidth) { pl.classList.add('is-away'); return; }
  const st = pl.parentNode.getBoundingClientRect(), r = slot.getBoundingClientRect();
  pl.classList.remove('is-away');
  pl.classList.toggle('is-small', r.width < 420);
  pl.classList.toggle('is-float', slot.classList.contains('is-float'));
  Object.assign(pl.style, { inset: 'auto', left: r.left - st.left + 'px', top: r.top - st.top + 'px', width: r.width + 'px', height: r.height + 'px' });
}

// ---- the view controls drawn over the stage: stage buttons, the small window's frame, the hidden-share chip, the split
// handle and, on a phone, the page dots.
const CONTENT_NAME = (c) => (!c ? '' : c.kind === 'play' ? 'The video' : c.kind === 'brain' ? 'The Favor Brain answer' : c.p && c.p.me ? 'Your screen' : (c.p ? c.p.name + '’s screen' : 'The shared screen'));
const pipOK = () => !!(document.pictureInPictureEnabled && HTMLVideoElement.prototype.requestPictureInPicture);
function vbtn(k, icon, label, extra = '') { return `<button type="button" class="vb" data-a="v" data-k="${k}"${extra} title="${label}"><span class="vb-i">${ic(icon)}</span><span class="vb-l">${label}</span></button>`; }
function uiEl(id, cls) {
  let el = document.getElementById(id);
  if (!el) { el = document.createElement('div'); el.id = id; el.className = cls; const st = $('.rm-stage'); st && st.insertBefore(el, $('#rm-pop-wrap')); }
  return el;
}
function setHTML(el, html) { if (el.dataset.sig !== html) { el.dataset.sig = html; el.innerHTML = html; } }
function paintViewUi(L) {
  const st = $('.rm-stage'); if (!st) return;
  const big = L.model.find((x) => x.kind === 'big');
  const content = L.content || (L.float && { key: L.float.key, kind: L.float.content, p: L.float.p }) || L.hidden;
  // Stage buttons
  const sui = uiEl('rm-sui', 'rm-sui');
  let html = '';
  if (big && big.content) {
    html = vbtn('mini', 'mini', 'Small window') + vbtn('hide', 'eyeOff', 'Hide') + (V.mode !== 'spotlight' && L.model.some((x) => x.kind === 'strip' && !x.content) ? vbtn('swap', 'swap', 'Swap') : '') + (pipOK() && big.content !== 'brain' ? vbtn('pip', 'pip', 'Pop out', ` data-v="${esc(big.key)}"`) : '') + (document.fullscreenEnabled ? vbtn('full', 'expand', 'Full screen') : '');
  } else if (big) {
    html = (R.swap && content ? vbtn('swap', 'swap', 'Swap back') : '') + (S.pin === big.key ? vbtn('unpin', 'pin', 'Unpin') : '') + (pipOK() && !big.p.me ? vbtn('pip', 'pip', 'Pop out', ` data-v="${esc(big.key)}"`) : '') + (document.fullscreenEnabled ? vbtn('full', 'expand', 'Full screen') : '');
  }
  setHTML(sui, html ? `<div class="vbar" role="toolbar" aria-label="Stage">${html}</div>` : '');
  sui.hidden = !html;
  // The small window's frame: drag it by its bar, resize it from the corner.
  const fui = uiEl('rm-fui', 'rm-fui');
  fui.hidden = !L.float;
  if (L.float) {
    setHTML(fui, `<div class="fui-bar" data-drag="float"><span class="fui-t">${esc(CONTENT_NAME(content))}</span>${vbtn('stage', 'expand', 'Back to the stage')}${vbtn('hide', 'eyeOff', 'Hide')}</div><span class="fui-rs" data-drag="resize" aria-hidden="true"></span>`);
    placeFui();
  }
  // Hidden share chip
  const hid = uiEl('rm-hid', 'rm-hid');
  hid.hidden = !L.hidden;
  if (L.hidden) setHTML(hid, `<span>${esc(CONTENT_NAME(L.hidden))} is hidden for you</span><button type="button" class="h-btn h-btn--sm" data-a="v" data-k="stage">Show</button><button type="button" class="h-btn h-btn--sm h-btn--ghost" data-a="v" data-k="mini">Small window</button>`);
  // Split handle between the stage and the strip (desktop)
  const sp = uiEl('rm-split', 'rm-split');
  const strip = L.spot && !isPhone() && L.model.some((x) => x.kind === 'strip' || x.kind === 'more');
  sp.hidden = !strip;
  if (strip) {
    const be = big && (big.play ? document.getElementById('rm-play-slot') : elOf(big));
    const g = $('#rm-grid');
    if (be && g) {
      const s = st.getBoundingClientRect(), b = be.getBoundingClientRect(), gr = g.getBoundingClientRect();
      sp.classList.toggle('is-bottom', stripSide() === 'bottom');
      sp.setAttribute('role', 'separator'); sp.setAttribute('aria-orientation', stripSide() === 'bottom' ? 'horizontal' : 'vertical'); sp.setAttribute('aria-label', 'Drag to resize the faces'); sp.tabIndex = 0;
      if (stripSide() === 'bottom') Object.assign(sp.style, { left: b.left - s.left + 'px', width: b.width + 'px', top: b.bottom - s.top + 'px', height: '8px' });
      else Object.assign(sp.style, { left: b.right - s.left + 'px', width: '8px', top: gr.top - s.top + 'px', height: gr.height + 'px' });
    }
  }
  // Phone: two pages when something is shared, the stage and the faces; swipe or tap a dot.
  const dots = uiEl('rm-dots', 'rm-dots');
  const two = isPhone() && !!content && !L.float;
  dots.hidden = !two;
  if (two) { const pg = L.hidden ? 1 : 0; setHTML(dots, `<button type="button" data-a="v" data-k="stage" aria-label="Show ${esc(CONTENT_NAME(content))}" aria-current="${pg === 0}" class="${pg === 0 ? 'is-on' : ''}"></button><button type="button" data-a="v" data-k="hide" aria-label="Show everyone's faces" aria-current="${pg === 1}" class="${pg === 1 ? 'is-on' : ''}"></button>`); }
  positionSui(big);
  updatePip();
}
function positionSui(big) {
  const sui = document.getElementById('rm-sui'); if (!sui || sui.hidden || !big) return;
  const el = big.play ? document.getElementById('rm-play') : elOf(big); const st = $('.rm-stage');
  if (!el || !st) return;
  const s = st.getBoundingClientRect(), r = el.getBoundingClientRect();
  Object.assign(sui.style, { left: r.left - s.left + r.width / 2 + 'px', top: r.top - s.top + 10 + 'px', maxWidth: Math.max(160, r.width - 20) + 'px' });
}
function placeFui() {
  const fui = document.getElementById('rm-fui'), g = $('#rm-grid'); if (!fui || fui.hidden || !g) return;
  const b = floatRect(g);
  Object.assign(fui.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
}

// Dragging: the small window (move and resize), the split, and the phone swipe between the stage and the faces.
function floatEl() { const fl = lastLayout && lastLayout.float; return fl ? elOf(fl) : null; }
function onViewPointer(e) {
  const h = e.target.closest('[data-drag], #rm-split');
  if (!h || e.button > 0 || e.target.closest('button')) return;
  const g = $('#rm-grid'); if (!g) return;
  e.preventDefault();
  const kind = h.id === 'rm-split' ? 'split' : h.dataset.drag;
  const b0 = floatRect(g), x0 = e.clientX, y0 = e.clientY, gr = g.getBoundingClientRect();
  R.drag = true; document.documentElement.classList.add('is-vdrag');
  let raf = 0, last = null;
  const move = (ev) => {
    last = ev; if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0; const dx = last.clientX - x0, dy = last.clientY - y0;
      if (kind === 'split') {
        if (stripSide() === 'bottom') setView({ bottom: Math.round(Math.min(gr.height * 0.45, gr.bottom - last.clientY - 4)) });
        else setView({ side: Math.round(Math.min(gr.width * 0.55, gr.right - 12 - last.clientX - 4)) });
        paintGrid(); return;
      }
      let x = b0.x - b0.gx, y = b0.y - b0.gy, w = b0.w;
      if (kind === 'float') { x += dx; y += dy; }
      else { const right = x + w, bottom = y + w * 9 / 16; w = Math.max(160, Math.min(b0.W * 0.7, w - dx)); x = right - w; y = bottom - w * 9 / 16; }
      x = Math.max(0, Math.min(b0.W - w, x)); y = Math.max(0, Math.min(b0.H - w * 9 / 16, y));
      V.float = MS.floatFrac(x, y, w, b0.W, b0.H);
      const fe = floatEl(); if (fe) { const b = floatRect(g); Object.assign(fe.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' }); }
      placeFui(); syncPlay();
    });
  };
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    cancelAnimationFrame(raf); R.drag = false; document.documentElement.classList.remove('is-vdrag');
    if (kind !== 'split') {
      // Near an edge, the window settles against it.
      const f = { ...V.float }; if (f.x < 0.06) f.x = 0; if (f.x > 0.94) f.x = 1; if (f.y < 0.06) f.y = 0; if (f.y > 0.94) f.y = 1;
      const fe = floatEl(), r0 = fe && fe.getBoundingClientRect();
      setView({ float: f });
      if (fe) { const b = floatRect(g); Object.assign(fe.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' }); const r1 = fe.getBoundingClientRect(); if (r0 && (Math.abs(r0.left - r1.left) > 1 || Math.abs(r0.top - r1.top) > 1)) glide(fe, r0, r1); }
      placeFui(); syncPlay(); const pl = document.getElementById('rm-play'); if (pl && fe && fe.id === 'rm-play-slot' && r0) glide(pl, r0, fe.getBoundingClientRect());
    } else { setView({}); paintGrid(); scheduleReconcile(); }
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
}
function glide(el, r0, r1) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.animate([{ transform: `translate(${r0.left - r1.left}px, ${r0.top - r1.top}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
}
let swipe = null;
function onSwipeStart(e) { if (!isPhone() || e.touches.length !== 1 || e.target.closest('button, [data-drag], .rm-play-bar, iframe')) { swipe = null; return; } swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }; }
function onSwipeEnd(e) {
  if (!swipe) return; const t = e.changedTouches[0]; const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y; const quick = Date.now() - swipe.t < 700; swipe = null;
  if (!quick || Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx) * 0.7) return;
  const L = lastLayout || {};
  const has = L.content || L.hidden;
  if (has) { const toFaces = dx < 0; if (toFaces === !!L.hidden) return; R.stage = toFaces ? 'hidden' : 'normal'; slide(dx < 0 ? 1 : -1); return; }
  if ((S.pages || 1) > 1) { const np = Math.max(0, Math.min(S.pages - 1, S.page + (dx < 0 ? 1 : -1))); if (np !== S.page) { S.page = np; slide(dx < 0 ? 1 : -1); } }
}
// A page turn: the new view slides in from the side the finger went.
function slide(dir) {
  const g = $('#rm-grid');
  paintGrid(); scheduleReconcile();
  if (g && !matchMedia('(prefers-reduced-motion: reduce)').matches) g.animate([{ transform: `translateX(${dir * 18}%)`, opacity: 0.2 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
}

// The clip player comes and goes outside this file's paint calls; the stage repaints when it does, and when the stage resizes.
function watchStage() {
  const st = $('.rm-stage'); if (!st) return;
  let had = !!document.getElementById('rm-play'), raf = 0;
  new MutationObserver(() => { const has = !!document.getElementById('rm-play'); if (has !== had) { had = has; paintGrid(); scheduleReconcile(); } }).observe(st, { childList: true });
  if (window.ResizeObserver) new ResizeObserver(() => { if (raf || R.drag) return; raf = requestAnimationFrame(() => { raf = 0; paintGrid(); }); }).observe(st);
  st.addEventListener('pointerdown', onViewPointer);
  st.addEventListener('touchstart', onSwipeStart, { passive: true });
  st.addEventListener('touchend', onSwipeEnd, { passive: true });
  st.addEventListener('keydown', (e) => {
    if (e.target.id !== 'rm-split' || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const grow = stripSide() === 'bottom' ? e.key === 'ArrowUp' : e.key === 'ArrowLeft';
    viewAct('stripsize', grow ? '+' : '-'); const sp = document.getElementById('rm-split'); sp && sp.focus();
  });
  document.addEventListener('fullscreenchange', () => requestAnimationFrame(() => paintGrid()));
}

// ---- the options menu on a tile
function tmenuItems(key) {
  const L = lastLayout || { model: [] };
  const x = L.model.find((m) => m.key === key); if (!x) return [];
  const it = (k, icon, label) => ({ k, icon, label });
  const out = [];
  if (x.content) {
    if (x.kind !== 'big') out.push(it('stage', 'expand', 'Put it on the stage'));
    if (x.kind !== 'float') out.push(it('mini', 'mini', 'Small window'));
    out.push(it('hide', 'eyeOff', 'Hide it for me'));
    if (pipOK() && x.content !== 'brain') out.push(it('pip', 'pip', 'Picture in picture'));
  } else {
    const p = x.p, pinned = S.pin === p.pid;
    out.push(it(pinned ? 'unpin' : 'pin', 'pin', pinned ? 'Unpin' : 'Pin for me'));
    if (hostish() && !p.me) out.push(it('spot', 'spot', S.spot === p.pid ? 'End spotlight' : 'Spotlight for everyone'));
    if (L.content && x.kind !== 'big') out.push(it('faceup', 'swap', 'Put on the stage'));
    if (!p.me && pipOK() && p.cam) out.push(it('pip', 'pip', 'Picture in picture'));
    if (p.me) out.push(it('hideself', 'eyeOff', 'Hide my video for me'));
  }
  if (document.fullscreenEnabled) out.push(it('full', 'expand', 'Full screen'));
  return out;
}
function openTmenu(btn) {
  const key = btn.dataset.k;
  if (R.menu === key) { closeTmenu(); return; }
  closeTmenu(); R.menu = key;
  const items = tmenuItems(key); if (!items.length) return;
  const st = $('.rm-stage'); const m = document.createElement('div'); m.id = 'rm-tmenu'; m.className = 'rm-tmenu'; m.setAttribute('role', 'menu');
  m.innerHTML = items.map((i) => `<button type="button" role="menuitem" data-a="v" data-k="${i.k}" data-v="${esc(key)}">${ic(i.icon)}${i.label}</button>`).join('');
  st.appendChild(m);
  const s = st.getBoundingClientRect(), b = btn.getBoundingClientRect();
  const left = Math.min(Math.max(8, b.right - s.left - m.offsetWidth), s.width - m.offsetWidth - 8);
  const top = b.bottom - s.top + 6 + m.offsetHeight > s.height - 8 ? Math.max(8, b.top - s.top - m.offsetHeight - 6) : b.bottom - s.top + 6;
  Object.assign(m.style, { left: left + 'px', top: top + 'px' });
  btn.setAttribute('aria-expanded', 'true');
  const f = m.querySelector('button'); f && f.focus({ preventScroll: true });
}
function closeTmenu(refocus) {
  const m = document.getElementById('rm-tmenu'); if (m) m.remove();
  const key = R.menu; R.menu = null;
  const b = key && document.querySelector(`.mt-tile [data-a="tmenu"][data-k="${CSS.escape(key)}"]`);
  if (b) { b.setAttribute('aria-expanded', 'false'); if (refocus) b.focus({ preventScroll: true }); }
}

// ---- one place for every view change: the View menu, the stage buttons, tile menus, keyboard shortcuts, phone dots.
const MODE_NAME = { auto: 'Auto', gallery: 'Gallery', speaker: 'Speaker', spotlight: 'Spotlight' };
function viewAct(k, v, from) {
  const L = lastLayout || { model: [] };
  const content = L.content || (L.float && { key: L.float.key, kind: L.float.content }) || L.hidden;
  const say = (t) => { if (from === 'key') toast(t); };
  const was = { stage: R.stage, swap: R.swap };
  switch (k) {
    case 'mode': if (MS.MODES.includes(v)) { setView({ mode: v }); if (v === 'gallery') R.swap = false; say(MODE_NAME[v] + ' view'); } break;
    case 'strip': setView({ strip: v === 'bottom' ? 'bottom' : 'side' }); say(v === 'bottom' ? 'Faces below' : 'Faces beside'); break;
    case 'stripsize': { if (stripSide() === 'bottom') setView({ bottom: V.bottom + (v === '+' ? 30 : -30) }); else setView({ side: V.side + (v === '+' ? 40 : -40) }); break; }
    case 'stage': if (!content) return say('Nothing is shared'); R.stage = 'normal'; if (V.mode === 'gallery') setView({ mode: 'auto' }); say('Back on the stage'); break;
    case 'mini': if (!content) return say('Nothing is shared'); R.stage = R.stage === 'mini' && from === 'key' ? 'normal' : 'mini'; R.swap = false; say(R.stage === 'mini' ? 'Small window' : 'Back on the stage'); break;
    case 'hide': if (!content) return say('Nothing is shared'); R.stage = R.stage === 'hidden' && from === 'key' ? 'normal' : 'hidden'; say(R.stage === 'hidden' ? 'Shared screen hidden for you' : 'Shared screen shown'); break;
    case 'swap': if (!content) return say('Nothing is shared'); R.stage = 'normal'; R.swap = !R.swap; if (!R.swap && S.pin) S.pin = ''; if (V.mode === 'gallery') setView({ mode: 'auto' }); say(R.swap ? 'A face on the stage' : 'Shared screen on the stage'); break;
    case 'faceup': S.pin = v; R.swap = true; R.stage = 'normal'; if (V.mode === 'gallery') setView({ mode: 'auto' }); break;
    case 'pin': S.pin = v; if (content && R.stage === 'normal') R.swap = true; break;
    case 'unpin': S.pin = ''; if (R.swap) R.swap = false; break;
    case 'spot': send('cmd', { a: S.spot === v ? 'unspot' : 'spot' }, v); break;
    case 'hideself': setView({ hideSelf: !V.hideSelf }); say(V.hideSelf ? 'Your video is hidden for you. Others still see it.' : 'Your video is shown'); if (V.hideSelf && from !== 'key') toast('Your video is hidden for you. Others still see it.'); break;
    case 'pip': startPip(v || (content ? content.key : 'speaker')); break;
    case 'full': fullStage(v); break;
    case 'keys': S.pop = 'keys'; paintTools(); paintPop(); return;
    case 'open': S.pop = 'view'; paintTools(); paintPop(); return;
    default: return;
  }
  closeTmenu();
  paintGrid(); scheduleReconcile();
  if (S.pop === 'view') paintPop();
  if (was.stage !== R.stage && isPhone() && content) { const g = $('#rm-grid'); if (g && !matchMedia('(prefers-reduced-motion: reduce)').matches && (was.stage === 'hidden' || R.stage === 'hidden')) g.animate([{ transform: `translateX(${R.stage === 'hidden' ? 18 : -18}%)`, opacity: 0.2 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' }); }
}

// Full screen of one thing: the stage, a tile, the clip, or the whole stage when nothing is big.
function fullStage(key) {
  if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
  const L = lastLayout || { model: [] };
  const x = key ? L.model.find((m) => m.key === key) : L.model.find((m) => m.kind === 'big') || L.float;
  const el = !x ? $('.rm-stage') : x.play ? document.getElementById('rm-play') : elOf(x);
  if (!el || !el.requestFullscreen) return;
  el.requestFullscreen().catch(() => toast('Full screen is not available here.'));
}

// Picture in picture: a share, a person, or "speaker", which follows whoever is talking. Uses one hidden video element so the
// window survives layout changes; the clip pops out its own player.
let pipVid = null;
function pipStream(target) {
  if (!target) return null;
  if (target === 'speaker') { const ev = [mePerson(), ...others()]; if (ev.length < 2) return null; target = speakerPid(ev); }
  if (target.startsWith('share:')) { const pid = target.slice(6); if (pid === S.me.pid) return local.screen ? new MediaStream([local.screen]) : null; const r = remote.get(pid + '|s'); return r && r.stream; }
  const r = remote.get(target + '|v'); return r && r.stream;
}
async function startPip(target) {
  if (!pipOK()) { toast('Picture in picture is not available in this browser.'); return; }
  if (document.pictureInPictureElement && R.pip === target) { document.exitPictureInPicture().catch(() => {}); return; }
  if (target === 'play') {
    const v = document.querySelector('#rm-play video');
    if (!v) { toast('A YouTube video cannot pop out. Use Small window instead.'); return; }
    try { await v.requestPictureInPicture(); R.pip = 'play'; v.addEventListener('leavepictureinpicture', () => { R.pip = ''; }, { once: true }); } catch { toast('Picture in picture did not open.'); }
    return;
  }
  if (!pipVid) {
    pipVid = document.createElement('video'); pipVid.id = 'rm-pipv'; pipVid.muted = true; pipVid.playsInline = true; pipVid.autoplay = true; pipVid.className = 'rm-pipv';
    document.body.appendChild(pipVid);
    pipVid.addEventListener('leavepictureinpicture', () => { R.pip = ''; scheduleReconcile(); });
  }
  R.pip = target; scheduleReconcile();
  // The stream may need a moment to be pulled (a person who is not on screen).
  for (let i = 0; i < 20 && !pipStream(target); i++) { await reconcile(); await new Promise((r) => setTimeout(r, 150)); }
  const s = pipStream(target);
  if (!s) { R.pip = ''; toast('That video is not available yet.'); return; }
  if (pipVid.srcObject !== s) pipVid.srcObject = s;
  try { await pipVid.play(); await pipVid.requestPictureInPicture(); }
  catch { R.pip = ''; toast('Picture in picture did not open. Try again.'); }
}
function updatePip() {
  if (!pipVid || !R.pip || R.pip === 'play' || document.pictureInPictureElement !== pipVid) return;
  const s = pipStream(R.pip);
  if (s && pipVid.srcObject !== s) { pipVid.srcObject = s; pipVid.play().catch(() => {}); }
}
// Chrome opens picture in picture by itself when this tab is left during a call, if the person allowed it.
try { navigator.mediaSession && navigator.mediaSession.setActionHandler('enterpictureinpicture', () => { const L = lastLayout || {}; const c = L.content || L.float && { key: L.float.key } || L.hidden; startPip(c && c.key !== 'brain' ? c.key : 'speaker'); }); } catch {}

// The View menu and the keyboard shortcut list (drawn in the pop-over spot by paintPop()).
function viewPopHTML() {
  const L = lastLayout || { model: [] };
  const content = L.content || (L.float && { key: L.float.key, kind: L.float.content, p: L.float.p }) || L.hidden;
  const seg = (k, opts, cur, label) => `<div class="vw-seg" role="radiogroup" aria-label="${label}">${opts.map(([v, icon, t]) => `<button type="button" role="radio" aria-checked="${cur === v}" class="${cur === v ? 'is-on' : ''}" data-a="v" data-k="${k}" data-v="${v}">${icon ? ic(icon) : ''}<span>${t}</span></button>`).join('')}</div>`;
  const tog = (k, on, t) => `<button type="button" class="vw-tog" role="switch" aria-checked="${on}" data-a="v" data-k="${k}"><span>${t}</span><i class="${on ? 'is-on' : ''}"></i></button>`;
  const stageNow = R.stage === 'mini' ? 'mini' : R.stage === 'hidden' ? 'hide' : 'stage';
  return `<div class="rm-pop rm-view" role="dialog" aria-label="Your view">
    <div class="vw-h"><b>Your view</b><small>Only you see these changes.</small></div>
    <div class="vw-l">Layout</div>
    ${seg('mode', [['auto', 'auto', 'Auto'], ['gallery', 'grid', 'Gallery'], ['speaker', 'speaker', 'Speaker'], ['spotlight', 'spot', 'Spotlight']], V.mode, 'Layout')}
    ${isPhone() ? '' : `<div class="vw-l">Faces</div>${seg('strip', [['side', 'side', 'Beside'], ['bottom', 'below', 'Below']], V.strip, 'Faces')}`}
    ${content ? `<div class="vw-l">${esc(CONTENT_NAME(content))}</div>${seg('stagepick', [['stage', 'expand', 'On the stage'], ['mini', 'mini', 'Small window'], ['hide', 'eyeOff', 'Hidden']], stageNow, 'Shared screen or video')}
      ${R.stage === 'normal' && V.mode !== 'gallery' ? tog('swap', R.swap, 'A face on the stage, the share beside it') : ''}` : ''}
    ${tog('hideself', V.hideSelf, 'Hide my video for me')}
    <div class="vw-acts">${pipOK() ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-a="v" data-k="pip" data-v="speaker">${ic('pip')}Pop out the speaker</button>` : ''}${pipOK() && content && content.kind !== 'brain' ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-a="v" data-k="pip" data-v="${esc(content.key)}">${ic('pip')}Pop out the share</button>` : ''}${document.fullscreenEnabled ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-a="v" data-k="full">${ic('expand')}Full screen</button>` : ''}</div>
    ${isPhone() ? '' : `<button type="button" class="vw-keys" data-a="v" data-k="keys">${ic('kbd')}Keyboard shortcuts <kbd>?</kbd></button>`}
  </div>`;
}
const KEYS = [['M', 'Mute or unmute'], ['V', 'Camera on or off'], ['A', 'Auto view'], ['G', 'Gallery view'], ['S', 'Speaker view'], ['L', 'Spotlight view'], ['W', 'Small window for the share'], ['H', 'Hide or show the share'], ['X', 'Swap the stage and a face'], ['B', 'Faces beside or below'], ['[ ]', 'Narrower or wider faces'], ['Y', 'Hide or show my video'], ['F', 'Full screen of the stage'], ['P', 'Picture in picture'], ['← →', 'Gallery pages'], ['?', 'This list']];
const keysPopHTML = () => `<div class="rm-pop rm-view rm-keys" role="dialog" aria-label="Keyboard shortcuts"><div class="vw-h"><b>Keyboard shortcuts</b><small>View changes are yours alone.</small></div><dl>${KEYS.map(([k, t]) => `<div><dt><kbd>${k}</kbd></dt><dd>${t}</dd></div>`).join('')}</dl></div>`;
function viewKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const k = e.key;
  const map = { a: ['mode', 'auto'], g: ['mode', 'gallery'], s: ['mode', 'speaker'], l: ['mode', 'spotlight'], w: ['mini'], h: ['hide'], x: ['swap'], y: ['hideself'], f: ['full'], p: ['pip'], '[': ['stripsize', '-'], ']': ['stripsize', '+'] };
  if (k === '?') { S.pop = S.pop === 'keys' ? '' : 'keys'; paintTools(); paintPop(); return true; }
  if (k === 'b' || k === 'B') { if (!isPhone()) viewAct('strip', V.strip === 'side' ? 'bottom' : 'side', 'key'); return true; }
  if ((k === 'ArrowLeft' || k === 'ArrowRight') && (S.pages || 1) > 1) { S.page = Math.max(0, Math.min(S.pages - 1, S.page + (k === 'ArrowRight' ? 1 : -1))); paintGrid(); scheduleReconcile(); return true; }
  const m = map[k.toLowerCase()]; if (!m) return false;
  if (m[0] === 'pip') { const L = lastLayout || {}; const c = L.content || (L.float && { key: L.float.key }); viewAct('pip', c && c.key !== 'brain' ? c.key : 'speaker', 'key'); return true; }
  viewAct(m[0], m[1], 'key');
  return true;
}

// Gallery sizing: the column count that gives the biggest tiles for this many people in this space, every tile the same size,
// the last row centred. Recomputed only when the count or the space changes, so nothing moves while people talk.
export function bestFit(n, W, H, gap, aspect) {
  let best = { cols: 1, w: 0, h: 0 };
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (W - gap * (cols - 1)) / cols, ch = (H - gap * (rows - 1)) / rows;
    const w = Math.min(cw, ch * aspect), h = w / aspect;
    if (w * h > best.w * best.h + 1) best = { cols, w, h };
  }
  return { cols: best.cols, w: Math.floor(best.w), h: Math.floor(best.h) };
}
let fitObs = null;
function fitGrid(grid, n) {
  const cs = getComputedStyle(grid);
  const W = grid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const H = grid.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  if (W <= 0 || H <= 0) return;
  const gap = parseFloat(cs.columnGap) || 8;
  const aspect = isPhone() && W / H < 0.9 && n > 1 ? 4 / 5 : 16 / 9;
  const f = bestFit(Math.max(1, n), W, H, gap, aspect);
  const sig = [n, f.cols, f.w, f.h].join(',');
  if (grid.dataset.fit !== sig) { grid.dataset.fit = sig; grid.style.setProperty('--tw', f.w + 'px'); grid.style.setProperty('--th', f.h + 'px'); }
  if (!fitObs && window.ResizeObserver) { fitObs = new ResizeObserver(() => { const g = $('#rm-grid'); if (g && g.classList.contains('is-fit')) fitGrid(g, g.querySelectorAll(':scope > .mt-tile:not(.is-float)').length); }); fitObs.observe(grid); }
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
    // The same track can arrive twice (ontrack and the direct hand-off after a pull): keep what is already playing.
    const had = remote.get(key);
    if (had && had.stream && had.stream.getTracks()[0] === track && (s.kind === 'video' || (had.el && had.el.isConnected))) return;
    const stream = new MediaStream([track]);
    if (s.kind === 'video') {
      const tkey = s.trackName.startsWith('s') ? 'share:' + s.pid : s.pid;
      remote.set(key, { stream, tkey });
      const t = tiles.get(tkey);
      if (t) { t.video.srcObject = stream; t.video.play().catch(() => {}); }
      updatePip();
    } else {
      let el = document.getElementById('a-' + mid);
      if (!el) { el = document.createElement('audio'); el.id = 'a-' + mid; el.autoplay = true; document.body.appendChild(el); }
      if (S.spkId && el.setSinkId) el.setSinkId(S.spkId).catch(() => { if (!S.spkGone) { S.spkGone = true; toast('Your saved speaker is not connected. Sound plays on the default speaker.'); diag('speaker-missing'); } });
      el.srcObject = stream; playAudio(el);
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
  if (sheetMode()) {
    keepFocus(el, () => {
      el.innerHTML = `
      <span class="cb-g"><button class="cb${S.mic ? '' : ' is-off'}" data-a="mic" aria-pressed="${!S.mic}"><span class="k">${ic(S.mic ? 'mic' : 'micOff')}</span>${S.mic ? 'Mute' : 'Unmute'}</button><button class="cb-chev" data-a="devmenu" data-p="mic" aria-label="Microphone and speaker" title="Microphone and speaker">${ic('chevu')}</button></span>
      <span class="cb-g"><button class="cb${S.cam ? '' : ' is-off'}" data-a="cam" aria-pressed="${S.cam}"><span class="k">${ic(S.cam ? 'video' : 'videoOff')}</span>${AUDIO_ONLY ? 'Video' : 'Camera'}</button><button class="cb-chev" data-a="devmenu" data-p="cam" aria-label="Camera settings" title="Camera settings">${ic('chevu')}</button></span>
      <button class="cb${S.panel === 'chat' ? ' is-on' : ''}" data-a="panel" data-p="chat" aria-pressed="${S.panel === 'chat'}"><span class="k badge">${ic('chat')}${S.unread ? `<span class="dotc${S.mentioned ? ' is-at' : ''}">${S.mentioned ? '@' : S.unread}</span>` : ''}</span>Chat</button>
      <button class="cb${S.panel === 'people' ? ' is-on' : ''}" data-a="panel" data-p="people" aria-pressed="${S.panel === 'people'}"><span class="k badge">${ic('users')}${waiting ? `<span class="dotc">${waiting}</span>` : handCount() ? `<span class="dotc dotc--hand" aria-label="${handCount()} raised">${handCount()}</span>` : ''}</span>People</button>
      <button class="cb${S.more ? ' is-on' : ''}" data-a="more" aria-expanded="${S.more}" aria-haspopup="dialog"><span class="k badge">${ic('more')}${S.hand || S.cc ? '<span class="dotc dotc--s"></span>' : ''}</span>More</button>`;
    });
    const hint0 = $('#rm-hint'); if (hint0) hint0.hidden = true;
    fitCtl(); return;
  }
  keepFocus(el, () => {
    el.innerHTML = `
    <span class="cb-g"><button class="cb${S.mic ? '' : ' is-off'}" data-a="mic" aria-pressed="${!S.mic}"><span class="k">${ic(S.mic ? 'mic' : 'micOff')}</span>${S.mic ? 'Mute' : 'Unmute'}</button><button class="cb-chev" data-a="devmenu" data-p="mic" aria-label="Microphone and speaker" title="Microphone and speaker">${ic('chevu')}</button></span>
    <span class="cb-g"><button class="cb${S.cam ? '' : ' is-off'}" data-a="cam" aria-pressed="${S.cam}"><span class="k">${ic(S.cam ? 'video' : 'videoOff')}</span>${AUDIO_ONLY ? 'Video' : 'Camera'}</button><button class="cb-chev" data-a="devmenu" data-p="cam" aria-label="Camera settings" title="Camera settings">${ic('chevu')}</button></span>
    ${canDisplay ? `<button class="cb${S.sharing ? ' is-on' : ''}" data-a="share" aria-pressed="${S.sharing}" ${canShare ? '' : 'disabled title="The host limited sharing"'}><span class="k">${ic('screen')}</span>${S.sharing ? 'Stop share' : 'Share'}</button>${S.sharing && local.screen ? `<button class="cb${local.screen.contentHint === 'motion' ? ' is-on' : ''}" data-a="sharemotion" aria-pressed="${local.screen.contentHint === 'motion'}" title="Smooth motion for a video you are sharing"><span class="k">${ic('video')}</span>${lab('Video mode', 'Video')}</button>` : ''}` : ''}
    ${canShare ? `<button class="cb cb-play${S.play ? ' is-on' : ''}" data-a="playclip"><span class="k">${ic('screen')}</span>${lab('Play a clip', 'Clip')}</button>` : ''}
    ${FEATURES.captions ? `<button class="cb${S.cc ? ' is-on' : ''}" data-a="cc" aria-pressed="${S.cc}"><span class="k">${ic('cc')}</span>${lab('Captions', 'CC')}</button>` : ''}
    ${h && S.meeting.rec !== 'off' ? `<button class="cb${recOn ? ' is-off' : ''}" data-a="rec"><span class="k">${ic('rec')}</span>${recOn ? lab('Stop rec', 'Stop') : lab('Record', 'Rec')}</button>` : ''}
    <button class="cb${S.hand ? ' is-on' : ''}" data-a="hand"><span class="k">${ic('hand')}</span><span class="l-full">${S.hand ? 'Lower hand' : 'Raise hand'}</span><span class="l-short">${S.hand ? 'Lower' : 'Hand'}</span></button>
    <span class="rm-sep"></span>
    <button class="cb${S.panel === 'chat' ? ' is-on' : ''}" data-a="panel" data-p="chat" aria-pressed="${S.panel === 'chat'}"><span class="k badge">${ic('chat')}${S.unread ? `<span class="dotc${S.mentioned ? ' is-at' : ''}">${S.mentioned ? '@' : S.unread}</span>` : ''}</span>Chat</button>
    <button class="cb${S.panel === 'people' ? ' is-on' : ''}" data-a="panel" data-p="people" aria-pressed="${S.panel === 'people'}"><span class="k badge">${ic('users')}${waiting ? `<span class="dotc">${waiting}</span>` : handCount() ? `<span class="dotc dotc--hand" aria-label="${handCount()} raised">${handCount()}</span>` : ''}</span>People</button>
    ${FEATURES.brain ? `<button class="cb${S.panel === 'brain' ? ' is-on' : ''}" data-a="panel" data-p="brain" aria-pressed="${S.panel === 'brain'}"><span class="k">${ic('brain')}</span>Brain</button>` : ''}
    ${FEATURES.notes ? `<button class="cb${S.panel === 'notes' ? ' is-on' : ''}" data-a="panel" data-p="notes" aria-pressed="${S.panel === 'notes'}"><span class="k badge">${ic('notes')}${liveCount() ? `<span class="dotc">${liveCount()}</span>` : ''}</span>Notes</button>` : ''}
    <button class="cb leave" data-a="leave"><span class="k">${ic('leave')}</span>Leave</button>`;
  });
  const hint = $('#rm-hint');
  if (hint) { const no = canDisplay && !canShare; hint.hidden = !no; if (no) hint.textContent = 'The host limited screen sharing.'; }
  fitCtl();
}

// ---- More sheet (phone): everything that does not need to be one tap away during a call
async function paintMore() {
  const wrap = $('#rm-more-wrap'); if (!wrap) return;
  if (!S.more || !sheetMode()) { wrap.innerHTML = ''; return; }
  const h = hostish(), recOn = S.recording && S.recording.active;
  const row = (a, icon, label, state, extra = '') => `<button class="mr" data-a="${a}"${extra}><span class="mr-i">${ic(icon)}</span><span class="mr-l">${label}</span>${state ? `<span class="mr-s">${state}</span>` : ''}</button>`;
  const rows = [
    row('hand', 'hand', S.hand ? 'Lower hand' : 'Raise hand', S.hand ? 'Raised' : ''),
    FEATURES.captions ? row('cc', 'cc', 'Captions', S.cc ? 'On' : 'Off') : '',
    h && S.meeting.rec !== 'off' ? row('rec', 'rec', recOn ? 'Stop recording' : 'Start recording', recOn ? 'On' : '') : '',
    FEATURES.brain ? row('panel', 'brain', 'Ask Favor Brain', '', ' data-p="brain"') : '',
    FEATURES.notes ? row('panel', 'notes', 'Live notes', liveCount() ? String(liveCount()) : '', ' data-p="notes"') : '',
    row('v', 'grid', 'Your view', MODE_NAME[V.mode] + (V.hideSelf ? ', my video hidden' : ''), ' data-k="open"'),
    document.fullscreenEnabled ? row('fullscreen', 'expand', 'Full screen', '') : '',
    GUEST ? '' : row('copylink', 'link', 'Copy meeting link', ''),
    mayPlay() ? row('playclip', 'screen', 'Play a video for everyone', S.play ? 'On' : '') : '',
    h && S.meeting.rec !== 'off' ? row('private', S.private ? 'rec' : 'pause', S.private ? 'Resume recording' : 'Pause recording', S.private ? 'Paused' : '') : '',
    row('withme', 'users', "Someone's with me", S.myWith.length ? String(S.myWith.length) : ''),
    row('devmenu', 'gear', 'Camera, microphone and speaker', ''),
  ].join('');
  wrap.innerHTML = `<div class="mr-scrim" data-a="more-close"></div><div class="mr-sheet" id="rm-more" role="dialog" aria-label="More"><div class="rm-grab" aria-hidden="true"></div><div class="mr-emo">${EMOJI.map((e) => `<button data-a="emoji" data-e="${e}" aria-label="React ${e}">${e}</button>`).join('')}</div><div class="mr-list">${rows}</div></div>`;
  dragToCloseMore($('#rm-more'));
}
function closeMore() { if (!S.more) return; S.more = false; S.moreDev = false; paintMore(); paintCtl(); }
function dragToCloseMore(sheet) {
  if (!sheet) return;
  let d = null;
  sheet.addEventListener('touchstart', (e) => { if (!e.target.closest('.rm-grab')) return; d = { y: e.touches[0].clientY, dy: 0 }; }, { passive: true });
  sheet.addEventListener('touchmove', (e) => { if (!d) return; d.dy = Math.max(0, e.touches[0].clientY - d.y); sheet.style.transform = 'translateY(' + d.dy + 'px)'; }, { passive: true });
  const end = () => { if (!d) return; const close = d.dy > 70; d = null; sheet.style.transform = ''; if (close) closeMore(); };
  sheet.addEventListener('touchend', end); sheet.addEventListener('touchcancel', end);
}

// ---- side panel
function paintSide() {
  const el = $('#rm-side'); if (!el) return;
  const rm = $('#rm'); rm.classList.toggle('is-solo', !S.panel);
  el.style.display = S.panel ? '' : 'none';
  if (!S.panel) return;
  const tab = (p, l, i) => `<button role="tab" aria-selected="${S.panel === p}" data-a="panel" data-p="${p}" class="${S.panel === p ? 'is-on' : ''}">${ic(i)}${l}</button>`;
  keepFocus(el, () => { el.innerHTML = `<div class="rm-grab" aria-hidden="true"></div><div class="rm-tabs" role="tablist" aria-label="Meeting panel">${tab('chat', 'Chat', 'chat')}${tab('people', 'People', 'users')}${FEATURES.brain ? tab('brain', 'Brain', 'brain') : ''}${FEATURES.notes ? tab('notes', 'Notes', 'notes') : ''}<button class="x icon-b" data-a="panel-close" aria-label="Close the panel">${ic('x')}</button></div><div class="rm-body" id="rm-body" role="tabpanel"></div><div id="rm-input"></div>`; });
  paintSideBody(true);
}

function chatHTML(m) {
  const f = m.file;
  const you = m.from === S.me.pid;
  const at = (m.mentions || []).includes(S.me.pid) && !you;
  return `<div class="msg${at ? ' is-mention' : ''}">${m.ai ? `<span class="mt-av" style="background:var(--h-brand)">${ic('brain')}</span>` : av(m.name)}<div><b>${m.ai ? 'Favor Brain, posted by ' + esc(you ? 'you' : m.name) : esc(you ? 'You' : m.name)}${m.to ? ' <i class="mt-sub">(private)</i>' : ''}</b><time>${new Date(m.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</time>${m.text ? `<p>${linkify(m.text)}</p>` : ''}${f ? `<div class="file"><span class="fi ${esc(f.type || 'doc')}">${esc((f.type || 'doc').slice(0, 3).toUpperCase())}</span><div style="min-width:0"><b>${esc(f.name)}</b><span>${esc(f.by || '')}</span></div><div class="acts"><a class="h-btn h-btn--ghost h-btn--sm" href="${/^https:\/\/(drive|docs)\.google\.com\//.test(f.url || '') ? esc(f.url) : '#'}" target="_blank" rel="noopener">${ic('drive')}Open in Drive</a></div></div>` : ''}</div></div>`;
}
const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:var(--h-brand-ink)">$1</a>');

const invRow = (r) => `<div class="rm-inv__r is-${r.status}"><span>${esc(r.to)}</span><b>${r.status === 'failed' ? 'Failed' : r.status === 'dry' ? 'Checked' : 'Sent'}</b>${r.detail && r.status !== 'sent' ? `<i>${esc(r.detail)}</i>` : ''}</div>`;
// The box and its input are drawn once; only the suggestions and results under it change, so typing is never interrupted.
const invShell = () => (!hostish() ? '' : `<div class="rm-inv"><div class="rm-inv__t">Add people</div><div class="rm-input rm-inv__row"><input id="invin" placeholder="Name to ring, or an email or phone to invite" maxlength="200" autocomplete="off" autocapitalize="off" enterkeyhint="send" /><button class="icb send" id="invgo" data-a="invite" aria-label="Send invitation">${ic('send')}</button></div><div id="inv-extra"></div></div>
    <div class="rm-foot"><button class="h-btn h-btn--ghost h-btn--sm" data-favor-send="${MID}">${ic('send')}Send the link</button><button class="h-btn h-btn--ghost h-btn--sm" data-a="copylink">${ic('link')}Copy meeting link</button>${S.guestsEnabled ? `<button class="h-btn h-btn--ghost h-btn--sm" data-a="guestlink">${ic('link')}Copy guest link</button>` : ''}${S.meeting.rec !== 'off' ? `<button class="h-btn h-btn--ghost h-btn--sm" data-a="private">${ic(S.private ? 'rec' : 'pause')}${S.private ? 'Resume recording' : 'Pause recording'}</button>` : ''}<button class="h-btn h-btn--ghost h-btn--sm" data-a="endall" style="color:#8a3f24">End for everyone</button></div>`);
const invExtra = () => {
  const v = S.inv; const pick = v.matches.length ? v.matches : v.sugg;
  const chat = document.documentElement.classList.contains('has-chat');
  return (pick.length ? `<div class="rm-inv__s">${pick.map((p) => `<button data-a="${chat ? 'ring-pick' : 'invite-pick'}" data-v="${esc(p.email)}" title="${chat ? 'Ring ' + esc(p.name) + ' into this meeting' : 'Invite ' + esc(p.name)}">${chat ? ic('users') : ''}${esc(p.name)}</button>`).join('')}</div>` : '') + v.rows.slice(0, 6).map(invRow).join('');
};
function paintFoot() {
  const inp = $('#rm-input'); if (!inp || S.panel !== 'people') return;
  const shell = invShell();
  if (inp.dataset.k !== 'people' || S.footSig !== shell) { inp.innerHTML = shell; inp.dataset.k = 'people'; S.footSig = shell; const i = $('#invin'); if (i) i.value = S.inv.text; }
  const ex = $('#inv-extra'); if (ex) { const h = invExtra(); if (ex.dataset.h !== h) { ex.innerHTML = h; ex.dataset.h = h; } }
  const go = $('#invgo'); if (go) go.disabled = !!S.inv.busy;
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
  const i = $('#invin'); if (i && !v.text) { i.value = ''; i.focus({ preventScroll: true }); }
}

function paintSideBody(full) {
  const body = $('#rm-body'); if (!body) return;
  if (S.panel === 'chat') {
    const stick = body.scrollTop + body.clientHeight >= body.scrollHeight - 40;
    body.innerHTML = S.chat.length ? S.chat.map(chatHTML).join('') : `<p class="mt-sub" style="margin:0">No messages yet. Messages go to everyone in the meeting.</p>`;
    if (full) $('#rm-input').dataset.k = 'chat';
    if (full) $('#rm-input').innerHTML = `<div class="rm-input"><div class="rm-at" id="rm-at" role="listbox" aria-label="People to mention" hidden></div><input id="chatin" placeholder="Message everyone. Type @ to mention someone" maxlength="2000" autocomplete="off" aria-autocomplete="list" aria-controls="rm-at" /><button class="icb send" data-a="chat-send" aria-label="Send">${ic('send')}</button></div>`;
    if (full || stick) body.scrollTop = body.scrollHeight;
  } else if (S.panel === 'brain') {
    const stick = body.scrollTop + body.clientHeight >= body.scrollHeight - 40;
    body.innerHTML = `<div class="priv">${ic('lock')}Only you see these answers until you post one.</div>
      ${S.brainQ.length ? '' : `<p style="margin:0;font-size:14px;color:var(--h-ink-2)">Ask about this meeting, a partner, a number or a document. Favor Brain reads the meeting as it happens and knows FavorOS's data.</p>`}
      ${S.brainQ.map((q, i) => `<div class="ask">${esc(q.q)}</div>${brainAnswerHTML(q, i)}`).join('')}
      <div class="bq">${[['missed', 'What did I miss?'], ['agreed', 'What have we agreed so far?'], ['open', 'What is still open?'], ['owners', 'Who owns what?']].map(([k, l]) => `<button data-a="ask" data-k="${k}">${l}</button>`).join('')}</div>`;
    if (full) $('#rm-input').dataset.k = 'brain';
    if (full) $('#rm-input').innerHTML = `<div class="rm-input"><input id="brainin" placeholder="Ask Favor Brain" maxlength="400" autocomplete="off" /><button class="icb send" data-a="ask-typed" aria-label="Ask">${ic('send')}</button></div>`;
    if (full || stick) body.scrollTop = body.scrollHeight;
  } else if (S.panel === 'notes') {
    const h = hostish();
    const live = S.live.filter((i) => !i.dismissed || h);
    const acts = live.filter((i) => i.kind === 'action'), decs = live.filter((i) => i.kind === 'decision');
    const row = (i) => `<div class="ln${i.dismissed ? ' is-off' : ''}"><div><b>${esc(i.text)}</b><span>${[i.owner ? esc(i.owner) : 'No owner yet', i.due ? 'due ' + esc(i.due) : '', stampOf(i.t)].filter(Boolean).join(' · ')}</span></div>${h ? `<div class="ln-a">${i.kind === 'action' ? `<select data-a="live-owner" data-idx="${i.idx}" aria-label="Owner">${ownerOptions(i.owner)}</select>` : ''}<button class="icon-b" data-a="live-dismiss" data-idx="${i.idx}" data-v="${i.dismissed ? 'false' : 'true'}" aria-label="${i.dismissed ? 'Keep this one' : 'Dismiss this one'}" title="${i.dismissed ? 'Keep' : 'Dismiss'}">${ic(i.dismissed ? 'plus' : 'x')}</button></div>` : ''}</div>`;
    const rec = S.recording && S.recording.active;
    const last = S.lines.length ? S.lines[S.lines.length - 1] : null;
    const heard = S.lines.slice(-6).reverse();
    const held = S.notesHeldAt && Date.now() - S.notesHeldAt < 90000;
    const status = rec && held ? `<div class="ln-st is-held"><i></i><span>Notes paused</span><span class="ln-sub">The missed part is written up after the call</span></div>` : rec ? `<div class="ln-st is-on"><i></i><span>Taking notes</span><span class="ln-sub">${S.lines.length ? S.lines.length + ' lines heard' + (last && last.at ? ' · last ' + Math.max(1, Math.round((Date.now() - last.at) / 1000)) + 's ago' : '') : 'Listening'}</span></div>`
      : `<div class="ln-st"><i></i><span>${S.meeting.rec === 'off' ? 'Notes are off for this meeting' : 'Notes start when the recording starts'}</span></div>`;
    body.innerHTML = `${status}
      <div class="h-label">Action items, ${acts.length}</div>${acts.map(row).join('') || '<p class="mt-sub" style="margin:0 0 10px">None yet.</p>'}
      <div class="h-label" style="margin-top:12px">Decisions, ${decs.length}</div>${decs.map(row).join('') || '<p class="mt-sub" style="margin:0 0 10px">None yet.</p>'}
      ${heard.length ? `<div class="h-label" style="margin-top:12px">Heard just now</div>${heard.map((l) => `<div class="ln-tx">${l.who ? `<b>${esc(l.who)}</b> ` : ''}${esc(l.text)}</div>`).join('')}` : ''}`;
    if (full) $('#rm-input').dataset.k = 'notes';
    if (full) $('#rm-input').innerHTML = `<div class="ln-add"><div class="ln-kind" role="group" aria-label="Kind"><button data-a="live-kind" data-k="action" aria-pressed="${S.liveKind === 'action'}" class="${S.liveKind === 'action' ? 'is-on' : ''}">Action item</button><button data-a="live-kind" data-k="decision" aria-pressed="${S.liveKind === 'decision'}" class="${S.liveKind === 'decision' ? 'is-on' : ''}">Decision</button></div><div class="rm-input"><input id="livein" placeholder="Add one by hand" maxlength="300" autocomplete="off" value="${esc(S.liveText)}" /><button class="icb send" data-a="live-add" aria-label="Add">${ic('send')}</button></div></div>`;
  } else if (S.panel === 'people') {
    const h = hostish();
    const all = [mePerson(), ...others()].map((p, i) => ({ p, i, n: handNo(p.pid) })).sort((a, b) => (a.n ? a.n : 1e9) - (b.n ? b.n : 1e9) || a.i - b.i).map((x) => x.p);
    const wait = h ? S.people.filter((p) => p.waiting) : [];
    paintFoot();
    body.innerHTML = `${wait.map((p) => `<div class="wait"><b>Waiting to join</b><div class="pp" style="padding:0">${av(p.name)}<div><b>${esc(p.name)}</b><span>Guest</span></div><div class="ctl"><button class="h-btn h-btn--primary h-btn--sm" data-a="cmd" data-c="letin" data-pid="${p.pid}">Let in</button></div></div></div>`).join('')}
      ${h ? `<div class="hostbar"><button class="h-btn h-btn--ghost h-btn--sm" data-a="cmd" data-c="muteall">${ic('micOff')}Mute everyone</button><button class="h-btn h-btn--ghost h-btn--sm" data-a="cmd" data-c="${S.locked ? 'unlock' : 'lock'}">${ic('lock')}${S.locked ? 'Unlock room' : 'Lock room'}</button><button class="h-btn h-btn--ghost h-btn--sm" data-a="sharepolicy">${ic('screen')}${S.sharePolicy === 'hosts' ? 'Anyone can share' : 'Only hosts share'}</button></div>` : ''}
      <div class="rm-pphead"><div class="h-label">In the meeting, ${all.length + all.reduce((n, p) => n + (p.with || []).length, 0)}</div><button class="h-btn h-btn--ghost h-btn--sm" data-a="withme">${ic('users')}Someone's with me</button></div>
      ${all.map((p) => `<div class="pp${handNo(p.pid) ? ' is-hand' : ''}" style="position:relative">${av(p.name)}<div><b>${esc(p.name + paren([p.me ? 'you' : '', withWords(p.with)]))}</b>${p.me && S.myWith.length ? `<span class="pp-with">${S.myWith.map((w) => `<button class="pp-chip" data-a="with-remove" data-pid="${esc(w.pid)}" aria-label="Take ${esc(w.name)} off this device">${esc(w.name)}${ic('x')}</button>`).join('')}</span>` : ''}<span>${p.role === 'host' || p.role === 'cohost' ? 'Host' + (p.title || p.team ? ' · ' : '') : ''}${p.role === 'guest' ? 'Guest' : esc(p.title || p.team || (p.role === 'host' || p.role === 'cohost' ? '' : 'Staff'))}${p.sharing ? ' · sharing' : ''}${!p.me && soundState(p.pid) === 'nosound' ? ' · <b class="pp-warn">no sound arriving</b>' : ''}</span></div>
        <div class="ctl">${handNo(p.pid) ? `<span class="pp-hand">${ic('hand')}${handNo(p.pid)}</span>${h && !p.me ? `<button class="h-btn h-btn--ghost h-btn--sm" data-a="cmd" data-c="lowerhand" data-pid="${p.pid}">Lower</button>` : ''}` : ''}<span class="icon-b ${p.mic ? 'is-on' : 'is-off'}" title="${p.mic ? 'Mic on' : 'Muted'}">${ic(p.mic ? 'mic' : 'micOff')}</span>${h && !p.me ? `<button class="icon-b" data-a="pmenu" data-pid="${p.pid}" aria-label="Host controls for ${esc(p.name)}" aria-haspopup="menu" aria-expanded="${S.menu === p.pid}">${ic('more')}</button>` : ''}</div>
        ${S.menu === p.pid ? `<div class="menu" role="menu"><button role="menuitem" data-a="cmd" data-c="mute" data-pid="${p.pid}">${ic('micOff')}Mute</button><button role="menuitem" data-a="cmd" data-c="${S.spot === p.pid ? 'unspot' : 'spot'}" data-pid="${p.pid}">${ic('pin')}${S.spot === p.pid ? 'End spotlight' : 'Spotlight for everyone'}</button><button role="menuitem" data-a="cmd" data-c="camoff" data-pid="${p.pid}">${ic('videoOff')}Turn camera off</button>${p.hand ? `<button role="menuitem" data-a="cmd" data-c="lowerhand" data-pid="${p.pid}">${ic('hand')}Lower hand</button>` : ''}<button role="menuitem" data-a="cmd" data-c="allowshare" data-v="${p.canShare === false ? 'true' : 'false'}" data-pid="${p.pid}">${ic('screen')}${p.canShare === false ? 'Allow screen sharing' : 'Block screen sharing'}</button>${p.role === 'cohost' ? `<button role="menuitem" data-a="cmd" data-c="unhost" data-pid="${p.pid}">${ic('users')}Remove host rights</button>` : `<button role="menuitem" data-a="cmd" data-c="makehost" data-pid="${p.pid}">${ic('users')}Make a host</button>`}<button role="menuitem" class="danger" data-a="cmd" data-c="remove" data-pid="${p.pid}">${ic('remove')}Remove from meeting</button></div>` : ''}</div>`).join('')}`;
  }
}

// ---------------------------------------------------------------- someone's with me
// People sharing this device. Each counts as present (the server gives them a presence row tied to this pid), shows on this
// device's tile and in People as "Ann Example (with Bob)", and the notes read this device's voice as any of them.
const firstName = (n) => String(n || '').trim().split(/\s+/)[0];
const andList = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
function withWords(list) { return list && list.length ? 'with ' + andList(list.map((w) => firstName(w.name))) : ''; }
const paren = (xs) => { const v = xs.filter(Boolean); return v.length ? ' (' + v.join(', ') + ')' : ''; };
// Choices: the invitees who are not here, then the staff list, matched on every word typed. Nobody already in the room.
function withChoices(q) {
  const here = new Set([S.me.name, ...S.people.map((p) => p.name), ...S.people.flatMap((p) => (p.with || []).map((w) => w.name)), ...S.myWith.map((w) => w.name)].map((n) => String(n).toLowerCase()));
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (p) => !here.has(String(p.name).toLowerCase()) && words.every((w) => (p.name + ' ' + (p.email || '')).toLowerCase().includes(w));
  const inv = ((S.meeting && S.meeting.invitees) || []).filter((i) => i.name && !String(i.email || '').startsWith('guest:')).map((i) => ({ name: i.name, email: i.email || '', invited: true }));
  const out = [], seen = new Set();
  for (const p of [...inv, ...(words.length ? S.inv.dir || [] : [])]) { const k = String(p.name).toLowerCase(); if (!seen.has(k) && hit(p)) { seen.add(k); out.push(p); } }
  return out.slice(0, 6);
}
function openWith(mode) {
  if (!GUEST) loadDirectory().then(() => { if (S.withPick) paintWithList(); });
  S.withPick = { mode, q: '', busy: false };
  let wrap = $('#rm-with-wrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'rm-with-wrap'; ($('#rm') || document.body).appendChild(wrap); wrap.addEventListener('input', (e) => { if (e.target.id === 'within' && S.withPick) { S.withPick.q = e.target.value; paintWithList(); } }); }
  paintWith();
  const i = $('#within'); if (i) i.focus({ preventScroll: true });
}
function paintWith() {
  const wrap = $('#rm-with-wrap'); if (!wrap || !S.withPick) return;
  const prompt = S.withPick.mode === 'prompt';
  const title = prompt ? "Looks like someone's with you. Who's there?" : "Who's with you?";
  const keepQ = S.withPick.q;
  wrap.innerHTML = `<div class="rd-scrim" data-a="with-close"></div><section class="rd rw" role="dialog" aria-modal="true" aria-labelledby="rw-t" tabindex="-1">
    <div class="rm-grab" aria-hidden="true"></div>
    <header class="rd-h"><h2 id="rw-t">${title}</h2><button class="icon-b" data-a="with-close" aria-label="Close">${ic('x')}</button></header>
    <div class="rw-b"><p class="rw-sub">They count as here, and the notes know this device's voice may be any of you.</p>
      <div class="rw-cur" id="rw-cur"></div>
      <div class="rm-input rw-in"><input id="within" placeholder="${GUEST ? 'Type a name' : 'Name of someone invited, on staff, or a guest'}" maxlength="80" autocomplete="off" enterkeyhint="done" /></div>
      <div class="rw-list" id="rw-list" role="list"></div></div>
    <footer class="rd-foot rw-foot">${prompt ? `<button class="h-btn h-btn--ghost" data-a="with-never">Don't ask again this meeting</button><button class="h-btn h-btn--ghost" data-a="with-justme">Just me</button>` : ''}<button class="h-btn h-btn--primary" data-a="with-close">Done</button></footer></section>`;
  const i = $('#within'); if (i) i.value = keepQ;
  paintWithList();
}
function paintWithList() {
  const cur = $('#rw-cur'), list = $('#rw-list'); if (!cur || !list || !S.withPick) return;
  cur.innerHTML = S.myWith.length ? `<span class="rw-lab">On this device with you</span>${S.myWith.map((w) => `<button class="pp-chip" data-a="with-remove" data-pid="${esc(w.pid)}" aria-label="Take ${esc(w.name)} off this device">${esc(w.name)}${ic('x')}</button>`).join('')}` : '';
  const q = S.withPick.q.trim();
  const hits = withChoices(q);
  const exact = hits.some((h) => h.name.toLowerCase() === q.toLowerCase());
  list.innerHTML = hits.map((p) => `<button class="rw-r" role="listitem" data-a="with-pick" data-name="${esc(p.name)}" data-email="${esc(p.email || '')}" ${S.withPick.busy ? 'disabled' : ''}>${av(p.name)}<span><b>${esc(p.name)}</b><i>${p.invited ? 'Invited' : 'Staff'}</i></span>${ic('plus')}</button>`).join('')
    + (q && !exact ? `<button class="rw-r" role="listitem" data-a="with-typed" ${S.withPick.busy ? 'disabled' : ''}>${av(q)}<span><b>Add ${esc(q)}</b><i>Guest</i></span>${ic('plus')}</button>` : '')
    + (!hits.length && !q ? `<p class="mt-sub" style="margin:4px 0 0">Type a name.</p>` : '');
}
function closeWith() { if (!S.withPick) return; S.withPick = null; const w = $('#rm-with-wrap'); if (w) w.remove(); }
async function withCall(body) {
  const r = await api('meetings/' + MID + '/with', { method: 'POST', body: { pid: S.me.pid, ...body } });
  S.myWith = r.with || [];
  paintGrid(); if (S.panel === 'people') paintSideBody(false); if (S.more) paintMore();
}
async function addWith(p) {
  const name = String(p.name || '').trim();
  if (!name || !S.withPick || S.withPick.busy) return;
  S.withPick.busy = true; paintWithList();
  try { await withCall({ op: 'add', name, email: p.email || '' }); if (S.withPick) { S.withPick.q = ''; const i = $('#within'); if (i) { i.value = ''; i.focus({ preventScroll: true }); } } }
  catch (e) { toast(e.message); }
  if (S.withPick) { S.withPick.busy = false; paintWithList(); }
}
async function removeWith(pid) { try { await withCall({ op: 'remove', who: pid }); if (S.withPick) paintWithList(); } catch (e) { toast(e.message); } }

// The face count: every 30 seconds this browser counts the faces its own camera sees (effects.js, on this device, frames never
// sent). Two looks in a row with two or more faces, on a device with nobody added, ask who is there. A setting, on by default.
const FACE_MS = Math.max(2000, Number(localStorage.getItem('meet.faceMs')) || 30_000);
const faces = new FaceCount();
let faceTimer = null, faceBusy = false;
async function faceTick() {
  const F = S.faceAsk;
  if (P.faces === false || AUDIO_ONLY || S.left || F.off || S.withPick || S.myWith.length || !S.cam || !local.camRaw || document.hidden || lowEnd()) { F.streak = 0; window.__meetFaces = null; return; }
  if (Date.now() < F.until || faceBusy) return;
  faceBusy = true;
  let n = -1;
  try { n = await faces.count(local.camRaw); } catch { n = -1; }
  faceBusy = false;
  window.__meetFaces = n;
  F.streak = n >= 2 ? F.streak + 1 : 0;
  if (F.streak >= 2 && !S.withPick && !S.myWith.length && !S.left) { F.streak = 0; diag('faces-ask'); openWith('prompt'); }
}

// ---------------------------------------------------------------- actions
function onDocClick(e) {
  if (S.recMenu && !e.target.closest('#rm-recmenu') && !e.target.closest('[data-a="recmenu"]')) { S.recMenu = false; paintBar(); }
  if (S.pop && !e.target.closest('.rm-pop') && !e.target.closest('[data-a="pop"]')) { S.pop = ''; paintTools(); paintPop(); }
  if (R.menu && !e.target.closest('#rm-tmenu') && !e.target.closest('[data-a="tmenu"]')) closeTmenu();
  const a = e.target.closest('[data-a]');
  if (!a) { if (S.menu && !e.target.closest('.menu')) { S.menu = null; paintSideBody(false); } return; }
  const act = a.dataset.a;
  switch (act) {
    case 'mic': toggleMic(); break;
    case 'cam': toggleCam(); break;
    case 'share': toggleShare(); break;
    case 'sharemotion': shareMotion(); break;
    case 'at-pick': atPick(Number(a.dataset.n)); break;
    case 'playclip': closeMore(); pickClip(); break;
    case 'play-yt': { const id = ytId(($('#rm-yt') || {}).value || ''); if (!id) { toast('Paste a YouTube link.'); break; } closePick(); sendPlay({ st: 'play', yt: id, title: 'YouTube video', pos: 0 }); break; }
    case 'play-pick': closePick(); sendPlay({ st: 'play', clip: a.dataset.id, title: a.dataset.t, pos: 0 }); break;
    case 'play-close': closePick(); break;
    case 'play-toggle': if (S.play && PL) sendPlay({ ...playBase(), st: S.play.st === 'play' ? 'pause' : 'play', pos: PL.time() }); break;
    case 'play-back': if (S.play && PL) sendPlay({ ...playBase(), st: S.play.st, pos: Math.max(0, PL.time() - 10) }); break;
    case 'play-fwd': if (S.play && PL) sendPlay({ ...playBase(), st: S.play.st, pos: PL.time() + 10 }); break;
    case 'play-stop': if (S.play) sendPlay({ st: 'stop' }); break;
    case 'play-mute': { S.playMuted = !S.playMuted; if (PL) PL.mute(S.playMuted); duck(S.play && S.play.st === 'play' && !S.playMuted); paintPlay(); break; }
    case 'cc': S.cc = !S.cc; paintCtl(); paintCap(); break;
    case 'rec': toggleRecording(); break;
    case 'recmenu': S.recMenu = !S.recMenu; paintBar(); break;
    case 'recmode': setRecMode(a.dataset.p); break;
    case 'rec-retry': retryRecording(); break;
    case 'ring-cancel': fetch('/api/chat/ring/' + encodeURIComponent(a.dataset.id), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' }, body: JSON.stringify({ action: 'cancel' }) }).catch(() => {}); break;
    case 'ring-again': ringPeople([a.dataset.v]); break;
    case 'ring-pick': ringPeople([a.dataset.v]).then((d) => { if (d) { S.inv.text = ''; S.inv.sugg = []; const i = $('#invin'); if (i) i.value = ''; paintFoot(); } }); break;
    case 'hand': S.hand = !S.hand; if (!S.handAt) S.handAt = new Map(); if (S.hand) S.handAt.set(S.me.pid, Date.now()); else S.handAt.delete(S.me.pid); paintCtl(); paintGrid(); if (S.panel === 'people') paintSideBody(false); syncNow(); break;
    case 'panel': S.more = false; S.moreDev = false; S.panel = S.panel === a.dataset.p && isPhone() ? '' : a.dataset.p; if (S.panel === 'chat') { S.unread = 0; S.mentioned = false; } paintCtl(); paintSide(); paintMore(); break;
    case 'more': S.more = !S.more; S.moreDev = false; if (S.more && S.panel && sheetMode()) { S.panel = ''; paintSide(); } paintCtl(); paintMore(); break;
    case 'devmenu': openDevSheet(a.dataset.p || ''); return;
    case 'withme': closeMore(); openWith('add'); return;
    case 'with-pick': addWith({ name: a.dataset.name, email: a.dataset.email || '' }); return;
    case 'with-typed': addWith({ name: (S.withPick && S.withPick.q) || '' }); return;
    case 'with-remove': removeWith(a.dataset.pid); return;
    case 'with-close': closeWith(); return;
    case 'with-justme': S.faceAsk.until = Date.now() + 10 * 60_000; closeWith(); return;
    case 'with-never': S.faceAsk.off = true; closeWith(); return;
    case 'sound-on': soundOn(); return;
    case 'mic-help': confirmCard({ title: 'Allow the microphone', body: permHelp({ name: 'NotAllowedError' }), ok: 'OK' }); return;
    case 'dev-close': closeDevSheet(); return;
    case 'dev-test': testSpeaker(a); return;
    case 'dev-bg': pickBg(a.dataset.v); return;
    case 'panel-close': S.panel = ''; paintCtl(); paintSide(); break;
    case 'leave': leaveClick(); break;
    case 'pop': S.pop = S.pop === a.dataset.p ? '' : a.dataset.p; paintTools(); paintPop(); break;
    case 'emoji': S.pop = ''; paintTools(); paintPop(); send('react', { e: a.dataset.e }); break;
    case 'layout': viewAct('mode', V.mode === 'gallery' ? 'speaker' : 'gallery'); paintTools(); break;
    case 'v': { const k = a.dataset.k; if (k === 'stagepick') viewAct(a.dataset.v); else viewAct(k, a.dataset.v); if (k === 'mode') paintTools(); break; }
    case 'tmenu': openTmenu(a); break;
    case 'fullscreen': if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else (document.getElementById('h-app') || document.documentElement).requestFullscreen().catch(() => toast('Full screen is not available here.')); break;
    case 'chat-send': sendChat(); break;
    case 'live-add': addLive(); break;
    case 'live-kind': S.liveKind = a.dataset.k === 'decision' ? 'decision' : 'action'; paintSideBody(true); break;
    case 'live-dismiss': changeLive({ idx: Number(a.dataset.idx), dismissed: a.dataset.v === 'true' }); break;
    case 'pmenu': S.menu = S.menu === a.dataset.pid ? null : a.dataset.pid; paintSideBody(false); if (S.menu) { const mi = $('.menu button'); mi && mi.focus(); } break;
    case 'cmd': {
      const c = a.dataset.c, pid = a.dataset.pid || '', v = a.dataset.v === undefined ? undefined : a.dataset.v === 'true';
      S.menu = null; paintSideBody(false);
      if (c === 'remove') { confirmCard({ title: 'Remove ' + nameOf(pid) + '?', body: 'They leave the meeting and cannot come back in.', ok: 'Remove', danger: true }).then((ok) => { if (ok) send('cmd', { a: c }, pid); }); break; }
      send('cmd', { a: c, v }, pid); break;
    }
    case 'sharepolicy': send('cmd', { a: 'sharepolicy', v: S.sharePolicy === 'hosts' ? 'all' : 'hosts' }); break;
    case 'copylink': copy(roomLink(MID)); break;
    case 'private': togglePrivate(); break;
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
  // A choice in the More sheet closes it, except the one that opens the device list.
  if (S.more && act !== 'more' && a.closest('#rm-more-wrap')) closeMore();
}
function onKey(e) {
  if (document.querySelector('.cf')) return;
  if (e.key === 'Escape') {
    if (S.withPick) { closeWith(); e.preventDefault(); return; }
    if (R.menu) { closeTmenu(true); e.preventDefault(); return; }
    if (devOpen) { closeDevSheet(); e.preventDefault(); return; }
    if (S.more) { closeMore(); const o = $('#rm-ctl [data-a="more"]'); o && o.focus(); e.preventDefault(); return; }
    if (S.pop) { const p = S.pop; S.pop = ''; paintTools(); paintPop(); const o = $('[data-a="pop"][data-p="' + p + '"]'); o && o.focus(); e.preventDefault(); return; }
    if (S.menu) { const pid = S.menu; S.menu = null; paintSideBody(false); const o = $('[data-a="pmenu"][data-pid="' + pid + '"]'); o && o.focus(); e.preventDefault(); return; }
    if (sheetMode() && S.panel) { const p = S.panel; S.panel = ''; paintCtl(); paintSide(); const o = $('#rm-ctl [data-a="panel"][data-p="' + p + '"]'); o && o.focus(); e.preventDefault(); return; }
    return;
  }
  if (R.menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    const items = $$('#rm-tmenu button'); if (items.length) { const i = items.indexOf(document.activeElement); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); e.preventDefault(); }
    return;
  }
  if (S.menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    const items = $$('.menu button'); if (items.length) { const i = items.indexOf(document.activeElement); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); e.preventDefault(); }
    return;
  }
  if (e.target.id === 'invin' && e.key === 'Enter') { e.preventDefault(); sendInvite(); return; }
  if (e.target.id === 'within' && e.key === 'Enter') { e.preventDefault(); const q = e.target.value.trim(); const hit = withChoices(q)[0]; if (hit && hit.name.toLowerCase() === q.toLowerCase()) addWith(hit); else addWith({ name: q }); return; }
  if (e.target.id === 'chatin' && atKey(e)) return;
  if (e.target.id === 'chatin' && e.key === 'Enter') { e.preventDefault(); sendChat(); return; }
  if (e.target.id === 'livein' && e.key === 'Enter') { e.preventDefault(); addLive(); return; }
  if (e.target.id === 'brainin' && e.key === 'Enter') { e.preventDefault(); const i = e.target; const q = i.value.trim(); if (q) { i.value = ''; askBrain(q, brainKindOf(q)); } return; }
  // Ctrl+D and Ctrl+E, as in Google Meet, work from anywhere in the room.
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'd' || e.key === 'e')) { e.preventDefault(); if (e.key === 'd') toggleMic(); else toggleCam(); return; }
  if (devOpen && e.key === 'Tab') { const f = $$('#rm-dev-wrap .rd button:not([disabled]), #rm-dev-wrap .rd select, #rm-dev-wrap .rd input'); if (f.length) { const first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } } return; }
  if (e.target.matches && e.target.matches('input, textarea, select')) return;
  if (e.key === 'm' || e.key === 'M') { toggleMic(); }
  else if (e.key === 'v' || e.key === 'V') { toggleCam(); }
  else if (viewKey(e)) e.preventDefault();
}
// ---- live notes: action items and decisions caught as they are said, plus the ones people add by hand
const liveCount = () => S.live.filter((i) => !i.dismissed && i.kind === 'action').length;
const stampOf = (t) => (t ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : '');
const ownerOptions = (cur) => {
  const names = [...new Set((S.people || []).filter((p) => p.role !== 'guest').map((p) => p.name).filter(Boolean))];
  return `<option value="">No owner</option>${names.map((n) => `<option value="${esc(n)}"${n === cur ? ' selected' : ''}>${esc(n)}</option>`).join('')}`;
};
async function loadLive() {
  if (!FEATURES.notes || !S.joined || S.left) return;
  try {
    const r = await api('meetings/' + MID + '/live');
    const sig = JSON.stringify(r.items);
    if (sig === S.liveSig) return;
    S.liveSig = sig; S.live = r.items;
    paintCtl();
    const a = document.activeElement;
    if (S.panel === 'notes' && !(a && a.matches && a.matches('#livein, select[data-a="live-owner"]'))) paintSideBody(false);
  } catch { /* the next poll tries again */ }
}
async function addLive() {
  const i = $('#livein'); const text = (i ? i.value : S.liveText).trim(); if (!text) return;
  try {
    const r = await api('meetings/' + MID + '/live', { method: 'POST', body: { add: { text, kind: S.liveKind } } });
    S.live = r.items; S.liveSig = JSON.stringify(r.items); S.liveText = ''; if (i) i.value = '';
    paintCtl(); paintSideBody(false);
  } catch (e) { toast(e.message); }
}
async function changeLive(body) {
  try {
    const r = await api('meetings/' + MID + '/live', { method: 'POST', body });
    S.live = r.items; S.liveSig = JSON.stringify(r.items); paintCtl(); paintSideBody(false);
  } catch (e) { toast(e.message); }
}
document.addEventListener('change', (e) => { const sel = e.target.closest && e.target.closest('select[data-a="live-owner"]'); if (sel) changeLive({ idx: Number(sel.dataset.idx), owner: sel.value }); });
document.addEventListener('input', (e) => { if (e.target && e.target.id === 'livein') S.liveText = e.target.value; if (e.target && e.target.id === 'chatin') atSuggest(); });
setInterval(loadLive, 10000);

async function leaveClick() {
  if (hostish() && others().length) {
    const r = await confirmCard({ title: 'Leave the meeting?', body: 'Other people are still in the room. You can leave and let them carry on, or end it for everyone.', ok: 'Leave meeting', cancel: 'Stay', extra: 'End for everyone' });
    if (r === 'extra') { send('cmd', { a: 'end' }); return; }
    if (r !== true) return;
  }
  leaveRoom();
}
// Closing the tab, going Back, or the phone discarding the page: tell the server now, so the room's count drops at once instead of
// after the 20 second heartbeat timeout. sendBeacon survives the page closing; guests need their token header, so they use fetch.
function beaconLeave(extra) {
  if (!S.me.pid) return;
  const url = (GUEST ? '/api/meet-guest/' : '/api/meet/') + 'meetings/' + MID + '/leave';
  const body = JSON.stringify({ pid: S.me.pid, ...(extra || {}) });
  try {
    if (!GUEST && navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))) return;
    fetch(url, { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(GUEST ? { 'X-Guest-Token': MODE.token } : {}) }, body });
  } catch {}
}
function onUnload() { if (!S.joined || S.left || S.beaconed) return; S.beaconed = true; beaconLeave(); }
window.addEventListener('pagehide', onUnload);
// A page brought back from the back-forward cache already left the room: show that, with Rejoin.
window.addEventListener('pageshow', (e) => {
  if (!e.persisted || !S.beaconed || S.left) return;
  S.left = true; clearIntervals();
  stopFx(); [local.mic, local.cam, local.screen].forEach((t) => t && t.stop());
  if (rtc) rtc.close();
  document.getElementById('h-app').classList.remove('is-room'); document.documentElement.classList.remove('in-room');
  ended('You left the meeting');
});
// iPhone: hidden means the microphone stopped. Step out of the count now, stop the heartbeat, and come back on return.
document.addEventListener('visibilitychange', () => {
  if (!IOS || !S.joined || S.left) return;
  if (document.visibilityState === 'hidden') { S.away = true; beaconLeave({ away: true }); }
  else if (S.away) { S.away = false; syncNow(); }
});

async function send(kind, body, to) {
  try { await api('meetings/' + MID + '/event', { method: 'POST', body: { pid: S.me.pid, kind, body, to: to || '' } }); syncNow(); }
  catch (e) { toast(e.message); }
}
async function sendChatWith(body) {
  try {
    const r = await api('meetings/' + MID + '/event', { method: 'POST', body: { pid: S.me.pid, kind: 'chat', body, to: '' } });
    if (r.away && r.away.length) toast(r.away.join(', ') + (r.away.length === 1 ? ' is' : ' are') + ' not in the meeting. They got a notice.');
    syncNow();
  } catch (e) { toast(e.message || 'That did not send.'); }
}
// @mentions: typing @ lists the people in the room and, for staff, the invitees who are not here yet.
function atCands() {
  const here = S.people.filter((p) => p.pid !== S.me.pid && !p.waiting).map((p) => ({ pid: p.pid, name: p.name, sub: 'In the meeting' }));
  const names = new Set(here.map((x) => x.name.toLowerCase())); names.add(String(S.me.name || '').toLowerCase());
  const inv = GUEST ? [] : ((S.meeting && S.meeting.invitees) || []).filter((i) => i.email && !String(i.email).startsWith('guest:') && !names.has(String(i.name || '').toLowerCase()))
    .map((i) => ({ email: String(i.email).toLowerCase(), name: i.name || String(i.email).split('@')[0], sub: 'Invited, not here' }));
  return [...here, ...inv];
}
function atQuery() { const i = $('#chatin'); if (!i) return null; const m = /(?:^|\s)@([^@\s]{0,30})$/.exec(i.value.slice(0, i.selectionStart)); return m ? m[1].toLowerCase() : null; }
function atClose() { const el = $('#rm-at'); if (el) { el.hidden = true; el.innerHTML = ''; } S.atList = []; }
function atSuggest() {
  const q = atQuery(), el = $('#rm-at'); if (!el) return;
  if (q === null) return atClose();
  S.atList = atCands().filter((c) => c.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || c.name.toLowerCase().startsWith(q)).slice(0, 8); S.atIdx = 0;
  if (!S.atList.length) return atClose();
  el.hidden = false;
  el.innerHTML = S.atList.map((c, n) => `<button type="button" role="option" class="rm-at-i${n === S.atIdx ? ' is-on' : ''}" aria-selected="${n === S.atIdx}" data-a="at-pick" data-n="${n}">${av(c.name)}<span><b>${esc(c.name)}</b><small>${esc(c.sub)}</small></span></button>`).join('');
}
function atPick(n) {
  const c = S.atList[n], i = $('#chatin'); if (!c || !i) return;
  const pos = i.selectionStart, before = i.value.slice(0, pos).replace(/@([^@\s]{0,30})$/, '@' + c.name + ' ');
  i.value = before + i.value.slice(pos); i.focus(); i.setSelectionRange(before.length, before.length);
  S.atPicked = [...(S.atPicked || []).filter((m) => m.name !== c.name), c]; atClose();
}
function atKey(e) {
  const el = $('#rm-at'); if (!el || el.hidden || !S.atList.length) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); S.atIdx = (S.atIdx + (e.key === 'ArrowDown' ? 1 : S.atList.length - 1)) % S.atList.length; $$('.rm-at-i', el).forEach((b, n) => { b.classList.toggle('is-on', n === S.atIdx); b.setAttribute('aria-selected', String(n === S.atIdx)); }); return true; }
  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); atPick(S.atIdx); return true; }
  if (e.key === 'Escape') { e.preventDefault(); atClose(); return true; }
  return false;
}
function sendChat() {
  const i = $('#chatin'); if (!i) return; const text = i.value.trim(); if (!text) return; i.value = '';
  const mentions = (S.atPicked || []).filter((m) => text.includes('@' + m.name)).map((m) => (m.pid ? { pid: m.pid } : { email: m.email }));
  S.atPicked = []; atClose();
  sendChatWith({ text, ...(mentions.length ? { mentions } : {}) });
}

function toggleMic() {
  if (!local.mic) { toast('No microphone is available.'); return; }
  S.mic = !S.mic; local.mic.enabled = S.mic; paintCtl(); paintGrid(); syncNow();
}
async function toggleCam() {
  if (AUDIO_ONLY) {
    // Video is one tap away: the room opens again with video, through the lobby.
    if (LITE || params.get('audio') === '1') { const u = new URL(location.href); u.searchParams.set('audio', '0'); toast('Opening the room with video'); setTimeout(() => location.replace(u.toString()), 300); return; }
    toast('This is an audio call. Leave and join again for video.'); return;
  }
  if (S.cam) {
    S.cam = false;
    if (local.cam) { try { await rtc.replace('v', null); } catch {} stopCam(); }
  } else {
    try {
      // The settings preview holds the camera: hand it over rather than opening it twice.
      stopDevPreview();
      const { track, fellBack } = await acquire('video', P);
      await setCam(track); S.cam = true;
      await rtc.replace('v', local.cam);
      if (fellBack) toast(fallbackLine({ cam: true }, { cam: track }));
    } catch { toast('The camera is not available.'); S.cam = false; }
  }
  paintCtl(); paintGrid(); paintDevSheet(); syncNow();
}
// A screen share: one layer, up to 1080p30 at about 2.8 Mbps. Slides keep their sharpness ('detail'); the presenter switches
// to smooth motion when they show a video.
const SHARE_ENC = [{ maxBitrate: 2800000, maxFramerate: 30 }];
function shareMotion() {
  if (!local.screen) return;
  local.screen.contentHint = local.screen.contentHint === 'motion' ? 'detail' : 'motion';
  const sn = rtc && rtc.pc && rtc.pc.getSenders().find((x) => x.track === local.screen);
  if (sn) { const ps = sn.getParameters(); if (ps.encodings && ps.encodings[0]) { ps.degradationPreference = local.screen.contentHint === 'motion' ? 'maintain-framerate' : 'maintain-resolution'; sn.setParameters(ps).catch(() => {}); } }
  toast(local.screen.contentHint === 'motion' ? 'Sharing tuned for video' : 'Sharing tuned for slides and text'); paintCtl();
}
async function toggleShare() {
  if (S.sharing) return stopShare();
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 }, width: { max: 1920 }, height: { max: 1080 } }, audio: true });
    local.screen = s.getVideoTracks()[0]; local.screenAudio = s.getAudioTracks()[0] || null;
    local.screen.contentHint = 'detail';
    local.screen.addEventListener('ended', stopShare);
    const items = [{ name: 's', kind: 'video', track: local.screen, simulcast: SHARE_ENC }];
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
  if (!S.left) chime('leave');
  S.left = true; clearIntervals();
  // The person who owns the recording sees the left screen at once while the last pieces upload.
  if (recorder && recorder.mr) { document.getElementById('h-app').classList.remove('is-room'); document.documentElement.classList.remove('in-room'); ended(msg || 'You left the meeting', 'Saving the recording. Keep this page open for a few seconds.', { noRejoin: true, saving: true }); }
  try { if (recorder) await recorder.stopIfOwner(); } catch {}
  try { await api('meetings/' + MID + '/leave', { method: 'POST', body: { pid: S.me.pid } }); } catch {}
  closeDevSheet(); hideMutedHint(); resetLevel(); stopFx();
  [local.mic, local.cam, local.screen].forEach((t) => t && t.stop());
  if (rtc) rtc.close();
  for (const [, t] of tiles) t.el.remove(); tiles.clear();
  $$('audio[id^="a-"]').forEach((a) => a.remove());
  document.getElementById('h-app').classList.remove('is-room'); document.documentElement.classList.remove('in-room');
  window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload); document.removeEventListener('click', onDocClick); document.removeEventListener('input', onInvInput);
  // Leave pressed from a huddle or a meeting opened from another page: back to that page. The server starts the notes.
  if (!msg && BACK && !GUEST) { location.replace(BACK); return; }
  ended(msg || 'You left the meeting');
  // The last person out saves the recording and starts the notes. Anyone invited can finish the work later from Meetings.
  if (!GUEST) pump(MID, (st) => { const p = root.querySelector('.mt-sub'); if (p && st) p.textContent = st; });
}

// ---------------------------------------------------------------- loops
function clearIntervals() { [syncTimer, statTimer, reconcileTimer, levelTimer, barTimer, faceTimer].forEach((t) => t && clearInterval(t)); faces.stop(); closeWith(); }
function startLoops() {
  // One sync per person every two seconds (three above 15 people, four in a hidden tab) so a big room stays light on the database.
  const tick = async () => { if (!S.away) await syncNow(); if (!S.left) syncTimer = setTimeout(tick, document.hidden ? 4000 : S.people.length > 15 ? 3000 : 2000); };
  syncTimer = setTimeout(tick, 0);
  statTimer = setInterval(onStats, 1500);
  levelTimer = setInterval(measureLevel, 250);
  barTimer = setInterval(paintBar, 1000);
  faceTimer = setInterval(faceTick, FACE_MS);
}

let syncing = false;
// A field room: while anyone in the meeting is in Lite mode (their sound track is labeled 'lite'), everyone sends sound at 16 kbit/s,
// so the phone on the weak link also receives less. The cap lifts when the last Lite person leaves.
let fieldCap = false;
function fieldRoom() {
  const on = LITE || (S.people || []).some((p) => !p.me && p.pid !== (S.me && S.me.pid) && (p.tracks || []).some((t) => t.name === 'a' && t.label === 'lite'));
  // Nothing is touched in a room with no Lite person in it.
  if (on === fieldCap || !rtc || !rtc.out) return;
  const o = rtc.out.get('a'); const sender = o && o.transceiver && o.transceiver.sender;
  if (!sender || !sender.getParameters) return;
  fieldCap = on;
  try {
    const prm = sender.getParameters();
    if (!prm.encodings || !prm.encodings.length) prm.encodings = [{}];
    if (on) prm.encodings[0].maxBitrate = 16000; else delete prm.encodings[0].maxBitrate;
    sender.setParameters(prm).catch(() => { fieldCap = !on; });
  } catch { fieldCap = !on; }
}
async function syncNow() {
  if (syncing || S.left || rejoining || S.away) return;
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
  if (r.now) S.skew = r.now - Date.now();
  S.people = r.people; S.me.role = r.role; fieldRoom();
  { const mine = r.people.find((p) => p.pid === S.me.pid); if (mine && Array.isArray(mine.with) && JSON.stringify(mine.with) !== JSON.stringify(S.myWith)) { S.myWith = mine.with; if (S.withPick) paintWith(); if (S.more) paintMore(); } }
  S.spot = r.meeting.spot; S.locked = r.meeting.locked; S.sharePolicy = r.meeting.sharePolicy;
  S.meeting.status = r.meeting.status;
  if (!!r.meeting.private !== !!S.private) { S.private = !!r.meeting.private; paintPriv(); paintBar(); if (S.more) paintMore(); paintFoot(); }
  S.recording = r.recording;
  // A recording that starts or stops while you are in the room plays the family's recording sounds (not on the first sync).
  { const recOn = !!(r.recording && r.recording.active) && !S.private; if (S.recPrimed && recOn !== S.recOn) chime(recOn ? 'rec-start' : 'rec-stop'); S.recOn = recOn; S.recPrimed = true; }
  // Lines are stamped when they arrive. The first sync brings the transcript so far, which is history, not a caption.
  for (const l of r.lines || []) { l.at = S.capPrimed ? Date.now() : 0; S.lines.push(l); S.tx = l.n; if (S.capPrimed) S.notesHeldAt = 0; }
  S.capPrimed = true;
  if ((r.lines || []).length) { paintCap(); const a = document.activeElement; if (S.panel === 'notes' && !(a && a.matches && a.matches('#livein, select[data-a="live-owner"]'))) paintSideBody(false); }
  for (const e of r.events) handleEvent(e);
  if (r.events.length) S.events = r.events[r.events.length - 1].seq;
  if (r.meeting.status === 'ended') return leaveRoom('The meeting ended');
  // Repaint only what changed, so a button is never replaced under a click.
  const base = (p) => [p.pid, p.name, p.sessionId, p.mic, p.cam, p.hand, p.sharing, p.role, p.waiting, p.canShare];
  const gridSig = JSON.stringify([S.people.map((p) => [...base(p), p.speaking]), S.spot, S.pin]);
  const ctlSig = JSON.stringify([handCount(), S.people.filter((p) => p.waiting).length, (S.people.find((p) => p.pid === S.me.pid) || {}).canShare, S.locked, S.sharePolicy, S.recording && [S.recording.active, S.recording.owner], S.me.role]);
  const sideSig = JSON.stringify([S.people.map(base), S.spot, S.locked, S.sharePolicy]);
  if (hostish()) {
    const waiting = S.people.filter((p) => p.waiting); const wsig = waiting.map((p) => p.pid).join(',');
    if (wsig !== S.waitSig) { S.waitSig = wsig; paintWait(waiting); for (const p of waiting) if (!S.seenWait.has(p.pid)) { S.seenWait.add(p.pid); toast(p.name + ' is waiting to join.'); chime('knock'); } }
  } else if (S.waitSig) { S.waitSig = ''; paintWait([]); }
  // Someone joining or leaving plays a soft sound, as Meet does, in meetings of up to twelve people (larger ones would chatter).
  { const inRoom = new Set(S.people.filter((p) => !p.waiting && p.pid !== S.me.pid).map((p) => p.pid));
    if (S.roomSeen && inRoom.size + 1 <= 12) { let j = 0, l = 0; for (const pid of inRoom) if (!S.roomSeen.has(pid)) j++; for (const pid of S.roomSeen) if (!inRoom.has(pid)) l++; if (j) chime('join'); else if (l) chime('leave'); }
    else if (!S.roomSeen) chime('join');
    S.roomSeen = inRoom; }
  // Raise order: the time this browser first saw each hand go up. Hosts get a toast and a soft chime for each new one.
  if (!S.handAt) S.handAt = new Map();
  const up = new Set(S.people.filter((p) => p.hand && !p.waiting).map((p) => p.pid));
  if (S.hand) up.add(S.me.pid);
  const fresh = [];
  for (const pid of up) if (!S.handAt.has(pid)) { S.handAt.set(pid, Date.now()); if (pid !== S.me.pid) fresh.push(pid); }
  for (const pid of [...S.handAt.keys()]) if (!up.has(pid)) S.handAt.delete(pid);
  if (S.handsPrimed && hostish() && fresh.length) { toast(fresh.map(nameOf).join(', ') + (fresh.length > 1 ? ' raised hands' : ' raised a hand')); chime('notify'); }
  S.handsPrimed = true;
  const handSig = [...S.handAt.keys()].join(',');
  if (handSig !== S.handSig) { S.handSig = handSig; S.ctlSig = null; S.sideSig = null; S.gridSig = null; }
  if (gridSig !== S.gridSig) { S.gridSig = gridSig; paintGrid(); }
  if (ctlSig !== S.ctlSig) { S.ctlSig = ctlSig; paintCtl(); }
  if (sideSig !== S.sideSig) { S.sideSig = sideSig; if (S.panel === 'people' && !S.menu) paintSideBody(false); }
  paintBar();
  scheduleReconcile();
  if (recorder) recorder.onSync(r.recording, S.people);
  // Ring times come from the server's clock; each is kept as a time on this one.
  S.rings = (r.rings || []).map((x) => ({ ...x, seenAt: Date.now() - Math.max(0, (r.now || Date.now()) - (x.at || 0)) }));
  if (r.meeting && r.meeting.rec && r.meeting.rec !== S.meeting.rec) { S.meeting.rec = r.meeting.rec; S.ctlSig = null; paintCtl(); }
  // The booked recording starts once, when none exists yet, from one browser: the host's, or when the host is not in the room the
  // longest-present made or acting host. Until 2026-10-14 only the host started it, so a meeting the host missed recorded nothing.
  if (recorder && !S.autoRec && !r.recording && S.meeting.rec !== 'off' && !S.private && leadPid() === S.me.pid) {
    S.autoRec = true;
    recorder.start().catch((e) => { toast(e.message); setTimeout(() => { S.autoRec = false; }, 5000); });
  }
  watchRecording(r);
}
// The person who starts the recording: the host if present, else the made or acting host who has been here longest, else the
// staff member who has been here longest (the server allows that only while no host is in the room).
function leadPid() {
  const here = [mePerson(), ...others()].filter((p) => p.role !== 'guest' && !p.waiting);
  const rank = (p) => (p.role === 'host' ? 0 : p.role === 'cohost' ? 1 : 2);
  here.sort((a, b) => rank(a) - rank(b) || (a.joinedAt || 0) - (b.joinedAt || 0));
  return here.length ? here[0].pid : '';
}
// The guard: a meeting set to record, two or more people here for 20 seconds, and no recording running. The hosts see
// "Recording did not start" with Retry, and the server is asked to check, which writes the morning email's alert.
function watchRecording(r) {
  const want = S.meeting.rec !== 'off' && !S.private && !S.recStopped;
  const n = others().filter((p) => p.role !== 'guest').length + 1;
  if (!want || n < 2 || (r.recording && r.recording.active && !r.recording.stale)) { S.pairAt = n >= 2 ? S.pairAt || Date.now() : 0; if (S.recMiss) { S.recMiss = false; paintBar(); } return; }
  if (!S.pairAt) S.pairAt = Date.now();
  if (Date.now() - S.pairAt < 20000 || S.recMiss) return;
  S.recMiss = true; paintBar();
  if (!S.recMissSent) { S.recMissSent = true; api('meetings/' + MID + '/recmiss', { method: 'POST', body: {} }).catch(() => {}); }
}
async function retryRecording() {
  if (!recorder) maybeStartRecording();
  S.recMiss = false; S.pairAt = Date.now(); paintBar();
  try { await recorder.start(); toast('Recording started'); } catch (e) { toast(e.message); }
}

function handleEvent(e) {
  if (e.kind === 'chat') {
    if (e.body.ai && e.from !== S.me.pid && false) return;
    S.chat.push({ ...e.body, from: e.from, to: e.to, ts: e.ts });
    if ((e.body.mentions || []).includes(S.me.pid) && e.from !== S.me.pid && Date.now() - (S.joinedAt || 0) > 4000) {
      chime('mention'); toast((e.body.name || nameOf(e.from)) + ' mentioned you: ' + String(e.body.text || '').slice(0, 80));
      if (S.panel !== 'chat') { S.mentioned = true; paintCtl(); }
    }
    if (S.panel !== 'chat' && e.from !== S.me.pid) { S.unread++; paintCtl(); if (e.body.text && Date.now() - (S.joinedAt || 0) > 4000) toast((e.body.name || nameOf(e.from)) + ': ' + String(e.body.text).slice(0, 80)); }
    if (S.panel === 'chat') paintSideBody(false);
  } else if (e.kind === 'cmd') {
    const b = e.body; const toMe = e.to === S.me.pid || e.to === '';
    if (b.a === 'mute' && toMe && e.from !== S.me.pid) { if (local.mic) { S.mic = false; local.mic.enabled = false; } toast('The host muted you'); paintCtl(); }
    else if (b.a === 'muteall' && !hostish()) { if (local.mic) { S.mic = false; local.mic.enabled = false; } toast('The host muted everyone'); paintCtl(); }
    else if (b.a === 'camoff' && toMe && e.from !== S.me.pid) { if (S.cam) toggleCam(); toast('The host turned your camera off'); }
    else if (b.a === 'remove' && e.to === S.me.pid) { S.removed = true; leaveRoom('The host removed you from this meeting'); }
    else if (b.a === 'lowerhand' && e.to === S.me.pid) { S.hand = false; paintCtl(); }
    else if (b.a === 'makehost' && e.to === S.me.pid) { toast('You are now a host'); }
    else if (b.a === 'play') { onPlay(b.v && b.v.st !== 'stop' ? b.v : null); }
    else if (b.a === 'end') { /* the sync's meeting.status ends the room */ }
  } else if (e.kind === 'ack') {
    if (e.to === S.me.pid) { const set = S.acks.get(e.body.at) || new Set(); set.add(e.from); S.acks.set(e.body.at, set); paintPlay(); }
  } else if (e.kind === 'brain') {
    S.show = e.body.stop ? null : { ...e.body, from: e.from };
    if (S.show && e.from !== S.me.pid) toast(S.show.by + ' put a Favor Brain answer on screen');
    paintGrid(); scheduleReconcile();
  } else if (e.kind === 'react') {
    floatEmoji(e.body.e, e.body.name);
  } else if (e.kind === 'notice') {
    const b = e.body;
    if (b.a === 'rec-start') { toast(b.mode === 'video' ? 'Video recording started' : 'Recording for notes started'); }
    else if (b.a === 'rec-stop') { toast('Recording stopped'); S.recStopped = true; }
    else if (b.a === 'rec-mode') { S.meeting.rec = b.mode; S.recStopped = b.mode === 'off'; S.ctlSig = null; paintCtl(); paintBar(); toast((b.name ? b.name + ': ' : '') + (b.mode === 'video' ? 'this meeting now records video and notes' : b.mode === 'notes' ? 'this meeting is now transcribed for notes, no video' : 'recording and notes are off')); }
    else if (b.a === 'rec-takeover') toast(b.name + ' took over the recording');
    else if (b.a === 'joined' && e.from !== S.me.pid && S.people.length < 12) toast(b.name + ' joined');
    else if (b.a === 'with' && e.from !== S.me.pid && S.people.length < 12) toast(b.name + ' is with ' + b.host);
    else if (b.a === 'acting' && b.pid === S.me.pid) toast('You are now a host because no host is in the room');
    else if (b.a === 'private-on') { S.private = true; paintPriv(); paintBar(); if (S.more) paintMore(); toast('Recording paused. Nothing is recorded, transcribed or written down.'); }
    else if (b.a === 'private-off') { S.private = false; paintPriv(); paintBar(); if (S.more) paintMore(); toast('Recording resumed'); }
    else if (b.a === 'notes-held') { S.notesHeldAt = e.ts || Date.now(); paintCap(); if (S.panel === 'notes') paintSideBody(false); }
  }
}

// ---------------------------------------------------------------- subscriptions
// Changes are gathered for a quarter second, except the first pulls after joining, which go at once.
function scheduleReconcile() { clearTimeout(reconcileTimer); reconcileTimer = setTimeout(reconcile, rtc && rtc.subs && rtc.subs.size ? 250 : 0); }

function wanted() {
  const w = new Map();
  const { model } = layoutModel();
  const level = S.level;
  // A wide strip (dragged wider, or faces below at a tall size) gets the middle layer instead of the smallest.
  const bigStrip = !isPhone() && (V.strip === 'bottom' ? V.bottom > 170 : V.side > 300);
  // Someone with no heartbeat for 7 seconds has most likely closed or crashed: pulling from their dead session made the SFU hold the
  // whole request for about 8 seconds, so a person joining then heard nobody until it gave up. They are pulled again when they
  // come back. A pull already running is kept through a short gap.
  const live = (p, name) => !(p.seenAgo > 7000) || !!(rtc && rtc.subs && rtc.subs.has(p.pid + '|' + (name || 'a')));
  model.forEach(({ key, p, kind, share, play, brain }) => {
    if (!p || play || brain || kind === 'more' || p.me || AUDIO_ONLY || !live(p, share ? 's' : 'v')) return;
    const tr = (p.tracks || []).find((t) => (share ? t.name === 's' : t.name === 'v'));
    if (!tr) return;
    if (!share && !p.cam) return;
    let rid = LITE ? (share ? 'h' : 'q') : share ? (level === 'weak' || kind === 'strip' || kind === 'float' ? 'h' : 'f') : kind === 'big' ? (level === 'weak' ? 'h' : 'f') : kind === 'strip' ? (bigStrip && level !== 'weak' ? 'h' : 'q') : level === 'weak' ? 'q' : level === 'fair' ? (model.length > 4 ? 'q' : 'h') : model.length <= 2 ? 'f' : 'h';
    w.set(p.pid + '|' + tr.name, { pid: p.pid, sessionId: p.sessionId, trackName: tr.name, kind: 'video', rid });
  });
  // Picture in picture: the person or share in the window is pulled even when it is not on screen.
  if (R.pip && R.pip !== 'play' && !AUDIO_ONLY) {
    let pid = R.pip, name = 'v';
    if (pid === 'speaker') { const ev = [mePerson(), ...others()]; pid = ev.length > 1 ? speakerPid(ev) : ''; }
    else if (pid.startsWith('share:')) { pid = pid.slice(6); name = 's'; }
    const p = others().find((x) => x.pid === pid);
    const tr = p && (p.tracks || []).find((t) => t.name === name);
    if (tr && !w.has(pid + '|' + name)) w.set(pid + '|' + name, { pid, sessionId: p.sessionId, trackName: name, kind: 'video', rid: 'h' });
  }
  // Sound: everyone while the link is good (a muted person sends almost nothing); only the last few speakers on a weak link.
  const audible = others().filter((p) => live(p) && (p.tracks || []).some((t) => t.name === 'a'));
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
    // Each step stands alone: a close that fails or one batch the server refuses no longer stops the other pulls and layer changes.
    if (drop.length) {
      try { await rtc.drop(drop); } catch (e) { console.warn('[meet] drop', e.message); }
      drop.forEach((k) => { const r = remote.get(k); if (r && r.el) r.el.remove(); remote.delete(k); });
    }
    let failed = false;
    // Sound first, and people with a fresh heartbeat in their own requests ahead of anyone gone quiet for a few seconds: a pull
    // that names a closed browser's session makes the SFU hold that whole request for about 8 seconds.
    const ageOf = (pid) => { const p = S.people.find((x) => x.pid === pid); return p && p.seenAgo != null ? p.seenAgo : 0; };
    const first = (a) => a.slice().sort((x, y) => (x.kind === 'audio' ? 0 : 1) - (y.kind === 'audio' ? 0 : 1));
    const batches = [];
    const fresh = first(add.filter((x) => ageOf(x.pid) < 4500)), late = first(add.filter((x) => ageOf(x.pid) >= 4500));
    for (let i = 0; i < fresh.length; i += 16) batches.push(fresh.slice(i, i + 16));
    for (let i = 0; i < late.length; i += 16) batches.push(late.slice(i, i + 16));
    for (const batch of batches) {
      try { await rtc.pull(batch); } catch (e) { failed = true; diag('pull', { tracks: (rtc.lastPull || batch.map((w) => ({ pid: w.pid, name: w.trackName, ok: false }))), err: String(e.message || e).slice(0, 120) }); continue; }
      // Every audio subscription is reported once, so a person who heard nobody can be read afterwards.
      const audio = (rtc.lastPull || []).filter((x) => x.name === 'a' || !x.ok);
      if (audio.length) diag('pull', { tracks: audio });
      if ((rtc.lastPull || []).some((x) => !x.ok)) failed = true;
    }
    for (const [k, rid] of retune) await rtc.setLayer(k, rid).catch(() => {});
    // Videos whose element was rebuilt need their stream again.
    for (const [k, r] of remote) if (r.tkey) { const t = tiles.get(r.tkey); if (t && t.video.srcObject !== r.stream) { t.video.srcObject = r.stream; t.video.play().catch(() => {}); } }
    // A track that did not come is asked for again in a second, without waiting for the roster to change.
    if (failed && !S.left) setTimeout(scheduleReconcile, 1000);
  } catch (e) { console.warn('[meet] reconcile', e.message); }
  finally { reconciling = false; }
}

// ---------------------------------------------------------------- link health and rejoin
async function onStats() {
  if (!rtc || S.left || rejoining) return;
  // A connection the browser closed under us never reports a state again: reconnect at once.
  if (rtc.pc && rtc.pc.connectionState === 'closed' && !rtc.closed) { rejoinSoon('connection closed'); return; }
  const st = await rtc.sample();
  // The level changes only after three readings in a row agree, and not in the first ten seconds, when the estimate is still climbing.
  const lvl = Date.now() - S.started < 10000 ? 'good' : linkLevel(st);
  S.levelVotes = lvl === S.levelCand ? (S.levelVotes || 0) + 1 : 1; S.levelCand = lvl;
  const worse = ['good', 'fair', 'weak'].indexOf(lvl) > ['good', 'fair', 'weak'].indexOf(S.level);
  if (lvl !== S.level && S.levelVotes >= (worse ? 6 : 3)) { S.level = lvl; paintAll(); scheduleReconcile(); }
  // Reconnect only when the connection itself is gone. One person sending nothing (a dead microphone, a blocked network on their
  // side) is shown on their tile and retried on its own; it used to make everyone else reconnect every 13 seconds.
  const now = Date.now();
  if (st.state === 'connected') { if (!S.everUp) { S.everUp = true; S.noConnect = 0; diag('connected'); } S.downSince = 0; }
  const down = st.state === 'disconnected' || st.state === 'failed';
  if (down) S.downSince = S.downSince || now; else S.downSince = 0;
  if (down && now - S.downSince > (st.state === 'failed' ? 0 : 5000)) rejoinSoon('connection down');
  else if (!S.everUp && now - (S.rtcAt || now) > 20000) { S.noConnect = (S.noConnect || 0) + 1; diag('never-connected'); rejoinSoon('never connected'); }
  else if (st.state === 'connected' && st.pathAt && now - st.pathAt > 12000) rejoinSoon('nothing on the path for 12 seconds');
  if (st.state === 'connected') audioHealth();
  if (S.conn === 'back' && Date.now() - (S.backAt || 0) > 5000) { S.conn = 'ok'; paintBar(); }
  // Speaking rings from the sound the SFU delivers, for people the sync has not flagged yet.
}
function onRtcState(s) {
  S.rtcDown = s === 'disconnected' || s === 'failed';
  if (s === 'disconnected' && S.conn === 'ok') { S.conn = 'drop'; S.dropAt = Date.now(); S.dropRel = Math.max(0, Math.round((Date.now() - (Date.parse(S.meeting.startedAt || '') || S.started)) / 1000)); paintBar(); }
  if (s === 'connected' && S.conn === 'drop') { S.conn = 'back'; S.backAt = Date.now(); S.missedSec = (Date.now() - S.dropAt) / 1000; paintBar(); scheduleReconcile(); }
  if (s === 'failed' && !S.left) rejoinSoon('connection failed');
}
// Reconnects back off (2, 4, 8 up to 30 seconds apart) so a bad network does not hammer the room.
function rejoinSoon(why) {
  if (rejoining || S.left) return;
  const now = Date.now();
  if (now < (S.nextRejoinAt || 0)) return;
  S.rejoinN = now - (S.lastRejoinAt || 0) < 120000 ? (S.rejoinN || 0) + 1 : 0;
  S.lastRejoinAt = now; S.nextRejoinAt = now + Math.min(30000, 2000 * 2 ** S.rejoinN);
  rejoin(why);
}
async function rejoin(why) {
  if (rejoining || S.left) return;
  diag('rejoin', { why });
  rejoining = true; S.conn = 'drop'; S.dropAt = S.dropAt || Date.now(); paintBar();
  console.warn('[meet] rejoin:', why);
  for (let i = 0; i < 30 && !S.left; i++) {
    try {
      remote.clear(); $$('audio[id^="a-"]').forEach((a) => a.remove()); S.ah.clear();
      await connect(true);
      if (S.sharing && local.screen) { await rtc.publish([{ name: 's', kind: 'video', track: local.screen, simulcast: SHARE_ENC }]); const all = [...rtc.out.entries()].map(([name, o]) => ({ name, kind: o.kind, mid: o.mid })); await api('meetings/' + MID + '/tracks', { method: 'POST', body: { pid: S.me.pid, tracks: all } }); }
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

// ---------------------------------------------------------------- audio health
// Playback the browser refused (autoplay rules): a bar with one button, since a click is what the browser waits for.
function playAudio(el) {
  el.play().then(() => { if (S.soundBlocked && !$$('audio[id^="a-"]').some((a) => a.paused && a.srcObject)) { S.soundBlocked = false; paintBar(); } }).catch((e) => {
    if (e && e.name === 'NotAllowedError' && !S.soundBlocked) { S.soundBlocked = true; paintBar(); diag('autoplay-blocked'); }
  });
}
function soundOn() {
  try { if (actx && actx.state === 'suspended') actx.resume(); } catch {}
  const els = $$('audio[id^="a-"]').filter((a) => a.srcObject);
  Promise.all(els.map((a) => a.play())).then(() => { S.soundBlocked = false; paintBar(); }).catch(() => toast('The browser still blocks sound. Click anywhere on the page, then try again.'));
}

// Per person: is their sound reaching this browser? Packets for their audio track are counted every 1.5 seconds. A person whose
// microphone is on but whose packets stop gets "No sound" on their tile and their subscription is pulled again, at most every 15 seconds.
function audioHealth() {
  if (!rtc) return;
  const now = Date.now(); let changed = false;
  const seen = new Set();
  for (const p of others()) {
    if (!(p.tracks || []).some((t) => t.name === 'a')) continue;
    seen.add(p.pid);
    const key = p.pid + '|a', sub = rtc.subs.get(key);
    let h = S.ah.get(p.pid);
    if (!h || h.sid !== p.sessionId) { h = { sid: p.sessionId, pk: 0, at: now, state: 'connecting', retryAt: 0, tries: 0 }; S.ah.set(p.pid, h); changed = true; }
    const pk = sub ? rtc.audioPackets(sub.mid) : 0;
    if (pk > h.pk) { h.pk = pk; h.at = now; }
    const quiet = now - h.at;
    const next = !p.mic ? (sub ? 'ok' : 'connecting') : sub && pk && quiet < 6000 ? 'ok' : quiet > 6000 ? 'nosound' : 'connecting';
    let st = next;
    // Packets arriving is half of it: the sound also needs its audio element, playing, on a speaker that exists.
    if (st === 'ok' && sub && p.mic) {
      const r = remote.get(key);
      if (!r || !r.el) { if (now - h.at < 4000 && now - (h.elAt || (h.elAt = now)) > 4000) st = 'nosound'; }
      else { h.elAt = 0; if (r.el.paused) playAudio(r.el); }
    }
    if (st !== h.state) { h.state = st; changed = true; if (st === 'nosound') diag('no-sound-from', { from: p.pid, sub: !!sub, pk, el: !!(remote.get(key) || {}).el }); }
    const next2 = st;
    if (next2 === 'nosound' && now - h.retryAt > 15000) {
      h.retryAt = now; h.tries++;
      (sub ? rtc.drop([key]).then(() => { const r = remote.get(key); if (r && r.el) r.el.remove(); remote.delete(key); }) : Promise.resolve()).catch(() => {}).then(() => reconcile());
    }
  }
  for (const pid of [...S.ah.keys()]) if (!seen.has(pid)) { S.ah.delete(pid); changed = true; }
  if (changed) { S.gridSig = null; paintGrid(); if (S.panel === 'people' && !S.menu) paintSideBody(false); }
}
const handNo = (pid) => { if (!S.handAt || !S.handAt.has(pid)) return 0; return [...S.handAt.entries()].sort((a, b) => a[1] - b[1]).findIndex(([k]) => k === pid) + 1; };
const handCount = () => (S.handAt ? S.handAt.size : 0);
const soundState = (pid) => { const h = S.ah.get(pid); return h ? h.state : ''; };

// This person's own microphone: blocked, missing, or open but silenced by the system (another app took it).
function watchMic(t) {
  if (!t || t._watched) return; t._watched = true;
  t.addEventListener('mute', () => { if (local.mic === t) { S.micIssue = 'silent'; paintBar(); diag('mic-muted-by-system'); } });
  t.addEventListener('unmute', () => { if (local.mic === t && S.micIssue === 'silent') { S.micIssue = ''; paintBar(); } });
}
function micIssueHTML() {
  if (S.micIssue === 'denied') return `<div class="banner warn">${ic('micOff')}<span>Your microphone is blocked, so nobody can hear you.</span><button class="h-btn h-btn--ghost h-btn--sm" data-a="mic-help">How to fix</button></div>`;
  if (S.micIssue === 'nodev') return `<div class="banner warn">${ic('micOff')}<span>No microphone found. Nobody can hear you.</span><button class="h-btn h-btn--ghost h-btn--sm" data-a="devmenu" data-p="mic">Settings</button></div>`;
  if (S.micIssue === 'silent') return `<div class="banner warn">${ic('micOff')}<span>Your microphone stopped sending sound. Another app may be using it.</span><button class="h-btn h-btn--ghost h-btn--sm" data-a="devmenu" data-p="mic">Settings</button></div>`;
  return '';
}

// A short connection report to the server, for reading a call that went wrong. At most one of each kind every 20 seconds.
const diagAt = new Map();
function diag(ev, extra) {
  if (!S.me.pid || S.left) return;
  const k = ev + (extra && extra.from ? ':' + extra.from : '') + (extra && extra.tracks ? ':' + extra.tracks.map((x) => x.pid + x.name + x.ok).join(',') : '');
  if (Date.now() - (diagAt.get(k) || 0) < 20000) return; diagAt.set(k, Date.now());
  const st = (rtc && rtc.stats) || {};
  const ua = navigator.userAgent; const br = /Edg\//.test(ua) ? 'edge' : /CriOS|Chrome\//.test(ua) ? 'chrome' : /Firefox|FxiOS/.test(ua) ? 'firefox' : /Safari\//.test(ua) ? 'safari' : 'other';
  const body = { ev, ...(extra || {}), state: st.state || '', ice: st.ice || '', pair: st.pair || '', relay: !!st.relay, rtt: st.rtt ? Math.round(st.rtt * 1000) : 0, loss: st.loss ? Math.round(st.loss * 1000) / 10 : 0, br, ios: IOS, mic: !!local.mic, micOn: S.mic, people: others().length };
  api('meetings/' + MID + '/event', { method: 'POST', body: { pid: S.me.pid, kind: 'diag', body, to: S.me.pid } }).catch(() => {});
}

// ---------------------------------------------------------------- sound level (speaking ring, sent in the sync)
// The meter reads a copy of the microphone that stays on while the person is muted, so the settings meter moves and a person
// talking while muted is told so. The copy never leaves this browser; what is sent is the muted original.
let analyser = null, analyserBuf = null, actx = null, levelTrack = null, mutedTalk = 0, mutedHintAt = 0;
function resetLevel() { analyser = null; try { actx && actx.close(); } catch {} actx = null; if (levelTrack) { levelTrack.stop(); levelTrack = null; } }
function measureLevel() {
  if (!local.mic || local.mic.readyState === 'ended') { S.lvl = 0; S.rawLvl = 0; return; }
  try {
    if (!analyser) {
      levelTrack = local.mic.clone(); levelTrack.enabled = true;
      actx = new (window.AudioContext || window.webkitAudioContext)(); const src = actx.createMediaStreamSource(new MediaStream([levelTrack]));
      analyser = actx.createAnalyser(); analyser.fftSize = 512; src.connect(analyser); analyserBuf = new Uint8Array(analyser.fftSize);
    }
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    analyser.getByteTimeDomainData(analyserBuf);
    let sum = 0; for (const v of analyserBuf) { const d = (v - 128) / 128; sum += d * d; }
    S.rawLvl = Math.min(100, Math.round(Math.sqrt(sum / analyserBuf.length) * 400));
    S.lvl = S.mic ? S.rawLvl : 0;
    const i = $('#rd-lvl'); if (i) i.style.width = S.rawLvl + '%';
    // Four readings in a row (one second) of speech while muted: a note above the controls, at most every 20 seconds.
    mutedTalk = !S.mic && S.rawLvl > 22 ? mutedTalk + 1 : 0;
    if (mutedTalk >= 4 && Date.now() - mutedHintAt > 20000 && !devOpen) { mutedHintAt = Date.now(); showMutedHint(); }
    if (S.mic) hideMutedHint();
  } catch { S.lvl = 0; S.rawLvl = 0; }
}
function showMutedHint() {
  const st = $('.rm-stage'); if (!st) return;
  let el = $('#rm-muted');
  if (!el) { el = document.createElement('div'); el.id = 'rm-muted'; el.className = 'rm-muted'; el.setAttribute('role', 'status'); st.appendChild(el); }
  el.innerHTML = `${ic('micOff')}<span>You are muted</span><button class="h-btn h-btn--primary h-btn--sm" data-a="mic">Unmute</button>`;
  clearTimeout(showMutedHint.t); showMutedHint.t = setTimeout(hideMutedHint, 5000);
}
function hideMutedHint() { const el = $('#rm-muted'); if (el) el.remove(); }

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

window.__meet = { S, tiles, get view() { return { V, R, L: lastLayout }; }, get rtc() { return rtc; }, get fx() { return cfx; }, get vfx() { return vfx; }, reconcile, rejoin };

// ---------------------------------------------------------------- captions
// ---- pause recording (first called private moment): a host or cohost pauses the recording, transcript, captions and notes, for
// prayer or anything personal. The server keeps nothing said while it is on; this banner tells everyone in the room.
function paintPriv() {
  const el = $('#rm-priv'); if (!el) return;
  if (!S.private) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="rm-priv" role="status">${ic('pause')}<span><b>Recording paused.</b> Nothing is recorded, transcribed or written down.</span>${hostish() ? '<button class="h-btn h-btn--ghost h-btn--sm" data-a="private">Resume recording</button>' : ''}</div>`;
}
async function togglePrivate() {
  const on = !S.private;
  try {
    await api('meetings/' + MID + '/private', { method: 'POST', body: { pid: S.me.pid, on } });
    S.private = on; paintPriv(); paintBar(); if (S.more) paintMore(); paintFoot();
  } catch (e) { toast(e.message || 'That did not go through'); }
}

function paintCap() {
  const el = $('#rm-cap'); if (!el) return;
  if (!S.cc) { el.hidden = true; return; }
  // Fresh means arrived in the last 20 seconds by this browser's own clock, so a slow transcript or a skewed clock still shows.
  const fresh = S.lines.filter((l) => l.at && Date.now() - l.at < 20000).slice(-3);
  const listening = S.recording && S.recording.active;
  const held = S.notesHeldAt && Date.now() - S.notesHeldAt < 90000;
  el.hidden = false; el.classList.toggle('is-quiet', !fresh.length);
  el.innerHTML = fresh.length ? fresh.map((l, i) => `<span class="cl${i < fresh.length - 1 ? ' old' : ''}">${l.who ? `<b>${esc(l.who)}:</b> ` : ''}${esc(l.text)}</span>`).join('')
    : held ? 'Captions paused. The notes catch up after the call.' : listening ? 'Captions on. They run about 15 seconds behind.' : S.meeting.rec === 'off' ? 'Captions need recording or notes, and this meeting has both off.' : 'Captions start when the recording starts.';
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
    $$('audio[id^="a-"]').forEach((a) => { if (a.paused && a.srcObject) playAudio(a); });
    $$('#rm-grid video').forEach((v) => { if (v.paused && v.srcObject) v.play().catch(() => {}); });
    if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
    // A microphone or camera that ended (unplugged, or the phone took it back): the saved device again, or the default and a note.
    if (local.micRaw && local.micRaw.readyState === 'ended') {
      const { track: t, fellBack } = await acquire('audio', P);
      await setMic(t);
      await rtc.replace('a', local.mic);
      if (fellBack) toast(fallbackLine({ mic: true }, { mic: t }));
    }
    if (S.cam && local.camRaw && local.camRaw.readyState === 'ended' && !AUDIO_ONLY) {
      const { track: t, fellBack } = await acquire('video', P);
      await setCam(t); await rtc.replace('v', local.cam); paintGrid();
      toast(fellBack ? fallbackLine({ cam: true }, { cam: t }) : 'Your camera is back.');
    }
  } catch {} finally { reviving = false; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') revive(); });
window.addEventListener('pageshow', revive);
window.addEventListener('focus', revive);
document.addEventListener('touchend', revive, { passive: true });
document.addEventListener('click', revive);
setInterval(revive, 3000);

// ---- a video played for everyone (a clip from Clips or a YouTube link). Each browser plays it itself; the play, pause, seek
// and stop of whoever started it come as cmd events stamped with the server's time, so everyone (and anyone who joins late)
// lands on the same spot. Each browser tells the person playing it that it started, so they see who is on an old page.
let PL = null; // the player: { ready, time, dur, seek, paused, play, pause, mute, kill }
S.acks = new Map();
const mayPlay = () => hostish() || (S.sharePolicy === 'all' && (S.people.find((p) => p.pid === S.me.pid) || {}).canShare !== false);
const playBase = () => ({ clip: S.play.clip || '', yt: S.play.yt || '', title: S.play.title });
function ytId(u) { const m = /(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/.exec(u) || /^([\w-]{11})$/.exec(u.trim()); return m ? m[1] : ''; }
function playPos(p) { return p.st === 'play' ? p.pos + Math.max(0, (Date.now() + (S.skew || 0) - p.at) / 1000) : p.pos; }
async function sendPlay(v) { try { await api('meetings/' + MID + '/event', { method: 'POST', body: { pid: S.me.pid, kind: 'cmd', body: { a: 'play', v } } }); syncNow(); } catch (e) { toast(e.message || 'That did not work.'); } }
// Voices drop to 30% while the video plays with sound, and come back when it pauses, stops or is muted here.
function duck(on) { S.ducked = !!on; $$('audio[id^="a-"]').forEach((a) => { a.volume = on ? 0.3 : 1; }); }
function stopPlay() { if (PL) PL.kill(); PL = null; const el = $('#rm-play'); if (el) el.remove(); clearInterval(S.playTimer); S.playTimer = null; duck(false); }
let ytApi = null;
function loadYt() {
  if (!ytApi) ytApi = new Promise((ok) => { if (window.YT && window.YT.Player) return ok(window.YT); window.onYouTubeIframeAPIReady = () => ok(window.YT); const sc = document.createElement('script'); sc.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(sc); });
  return ytApi;
}
async function onPlay(p, media) {
  const was = S.play; S.play = p;
  if (!p) { stopPlay(); paintCtl(); paintMore(); return; }
  if (p.pid && p.pid !== S.me.pid && S.ackAt !== p.at) { S.ackAt = p.at; api('meetings/' + MID + '/event', { method: 'POST', body: { pid: S.me.pid, kind: 'ack', body: { at: p.at }, to: p.pid } }).catch(() => {}); }
  const same = was && $('#rm-play') && (was.clip || '') === (p.clip || '') && (was.yt || '') === (p.yt || '');
  if (!same) {
    stopPlay();
    const el = document.createElement('div'); el.id = 'rm-play'; el.className = 'rm-play';
    el.innerHTML = '<div class="rm-play-v"></div><div class="rm-play-bar"><span class="rm-play-l"></span><span class="rm-play-n"></span><span class="rm-play-c"></span></div>';
    (($('#rm-grid') || {}).parentNode || document.body).appendChild(el);
    const box = el.querySelector('.rm-play-v');
    if (p.clip) {
      if (media === undefined) { try { const r = await api('meetings/' + MID + '/playing'); media = r.media; if (r.now) S.skew = r.now - Date.now(); } catch { media = ''; } }
      if (S.play !== p && !(S.play && S.play.clip === p.clip)) return;
      if (!media) box.innerHTML = '<p class="rm-play-x">This video could not be loaded.</p>';
      else {
        box.innerHTML = `<video playsinline preload="auto" src="${(GUEST ? '/api/meet-guest/' : '/api/meet/') + 'meetings/' + MID + '/' + media}"></video>`;
        const v = box.querySelector('video'); v.muted = !!S.playMuted;
        PL = {
          ready: () => v.readyState >= 1, time: () => v.currentTime, dur: () => v.duration || 1e9, seek: (t) => { v.currentTime = t; }, paused: () => v.paused, pause: () => v.pause(), mute: (m) => { v.muted = m; },
          play: () => v.play().catch(() => { v.muted = true; S.playMuted = true; paintPlay(); toast('Tap Unmute video to hear it.'); v.play().catch(() => {}); }),
          kill: () => { v.pause(); v.removeAttribute('src'); v.load(); },
        };
        v.addEventListener('loadedmetadata', () => playAlign(true));
      }
    } else if (p.yt) {
      box.innerHTML = '<div id="rm-yt-p"></div>';
      const YT = await loadYt(); if (!$('#rm-yt-p') || !S.play || S.play.yt !== p.yt) return;
      let ok = false;
      const yp = new YT.Player('rm-yt-p', { videoId: p.yt, width: '100%', height: '100%', playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0 }, events: { onReady: () => { ok = true; if (S.playMuted) yp.mute(); playAlign(true); }, onAutoplayBlocked: () => { yp.mute(); S.playMuted = true; paintPlay(); toast('Tap Unmute video to hear it.'); yp.playVideo(); } } });
      PL = {
        ready: () => ok, time: () => yp.getCurrentTime() || 0, dur: () => yp.getDuration() || 1e9, seek: (t) => yp.seekTo(t, true),
        paused: () => { const st = yp.getPlayerState(); return st !== 1 && st !== 3; }, pause: () => yp.pauseVideo(), play: () => yp.playVideo(),
        mute: (m) => (m ? yp.mute() : yp.unMute()), kill: () => { try { yp.destroy(); } catch {} },
      };
    }
  }
  if (!S.playTimer) S.playTimer = setInterval(() => playAlign(false), 1000);
  playAlign(true); paintPlay(); paintCtl(); paintMore();
}
function playAlign(force) {
  const p = S.play; if (!p) return;
  if (p.pid === S.me.pid || hostish()) paintPlay();
  if (!PL || !PL.ready()) return;
  const want = Math.min(playPos(p), PL.dur() - 0.05);
  if (force || Math.abs(PL.time() - want) > 0.35) PL.seek(want);
  if (p.st === 'play' && PL.paused() && want < PL.dur() - 0.1) PL.play();
  if (p.st !== 'play' && !PL.paused()) PL.pause();
  duck(p.st === 'play' && !S.playMuted);
}
function paintPlay() {
  const el = $('#rm-play'); if (!el || !S.play) return;
  const p = S.play, mine = p.pid === S.me.pid, ctl = mine || hostish();
  const l = 'Playing for everyone: ' + (p.title || 'Video') + (p.by ? ' (' + p.by + ')' : '');
  if (el.querySelector('.rm-play-l').textContent !== l) el.querySelector('.rm-play-l').textContent = l;
  // Six seconds after it was played, anyone here before it started who has not said they started it is on an older page.
  let n = 0;
  if (mine && Date.now() + (S.skew || 0) - p.at > 6000) { const got = S.acks.get(p.at) || new Set(); n = S.people.filter((x) => x.pid !== S.me.pid && !x.waiting && x.joinedAt < p.at && !got.has(x.pid)).length; }
  const nt = n ? `${n} ${n === 1 ? 'person needs' : 'people need'} to reload to see this` : '';
  const ne = el.querySelector('.rm-play-n'); if (ne.textContent !== nt) ne.textContent = nt;
  const c = `${ctl ? `<button class="h-btn h-btn--ghost h-btn--sm" data-a="play-back" aria-label="Back 10 seconds">-10 s</button><button class="h-btn h-btn--ghost h-btn--sm" data-a="play-toggle">${p.st === 'play' ? 'Pause' : 'Play'}</button><button class="h-btn h-btn--ghost h-btn--sm" data-a="play-fwd" aria-label="Forward 10 seconds">+10 s</button><button class="h-btn h-btn--ghost h-btn--sm" data-a="play-stop">Stop</button>` : ''}<button class="h-btn h-btn--ghost h-btn--sm" data-a="play-mute">${S.playMuted ? 'Unmute video' : 'Mute video'}</button>`;
  const cc = el.querySelector('.rm-play-c'); if (cc.dataset.sig !== c) { cc.dataset.sig = c; cc.innerHTML = c; }
}
function closePick() { const el = $('#rm-pick'); if (el) el.remove(); }
async function pickClip() {
  closePick();
  const el = document.createElement('div'); el.id = 'rm-pick'; el.className = 'rm-pick';
  el.innerHTML = `<div class="rm-pick-in" role="dialog" aria-label="Play a video for everyone"><div class="rm-pick-h"><b>Play a video for everyone</b><button class="h-btn h-btn--ghost h-btn--sm" data-a="play-close">Close</button></div><div class="rm-pick-yt"><input id="rm-yt" placeholder="Paste a YouTube link" autocomplete="off" /><button class="h-btn h-btn--primary h-btn--sm" data-a="play-yt">Play</button></div>${GUEST ? '' : '<div class="rm-pick-l">Loading clips</div>'}</div>`;
  document.body.appendChild(el);
  if (GUEST) return;
  try {
    // An admin picks from every clip in FavorOS, everyone else from their own.
    let res = await fetch('/api/clips?scope=all', { credentials: 'same-origin' });
    if (!res.ok) res = await fetch('/api/clips', { credentials: 'same-origin' });
    const r = await res.json();
    const list = (r.clips || []).filter((c) => c.status === 'ready' || c.status === 'processing');
    el.querySelector('.rm-pick-l').innerHTML = list.length ? list.slice(0, 80).map((c) => `<button class="rm-pick-i" data-a="play-pick" data-id="${esc(c.id)}" data-t="${esc(c.title || 'Clip')}">${c.has_poster ? `<img src="/api/clips/${esc(c.id)}/media?poster=1" alt="">` : ''}<span>${esc(c.title || 'Clip')}</span><small>${Math.round((c.duration_ms || 0) / 1000)} s</small></button>`).join('') : 'You have no clips yet.';
  } catch { el.querySelector('.rm-pick-l').textContent = 'Clips did not load.'; }
}
