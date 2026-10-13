// Meetings: the camera, microphone and speaker each person picked, kept per person in localStorage so a choice survives
// camera off and on, mute, screen share, a reconnect and a reload. Every reacquire asks for the exact device; when that device
// is gone the browser default is used and the caller says so. The pre-join sheet (prejoin.js) reads and writes the same key.

export const PREF_KEY = 'favor.meet.devices';
const DEFAULTS = { micId: '', camId: '', spkId: '', ns: true, ec: true };

export const prefKey = (who) => PREF_KEY + '.' + (String(who || 'me').toLowerCase());

export function loadPrefs(who, store = globalThis.localStorage) {
  try { return { ...DEFAULTS, ...JSON.parse((store && store.getItem(prefKey(who))) || '{}') }; } catch { return { ...DEFAULTS }; }
}

export function savePrefs(who, patch, store = globalThis.localStorage) {
  const next = { ...loadPrefs(who, store), ...patch };
  try { store && store.setItem(prefKey(who), JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

export function audioConstraints(p, exact = true) {
  const c = { echoCancellation: p.ec !== false, noiseSuppression: p.ns !== false, autoGainControl: true };
  if (exact && p.micId) c.deviceId = { exact: p.micId };
  return c;
}

export function videoConstraints(p, exact = true) {
  const c = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } };
  if (exact && p.camId) c.deviceId = { exact: p.camId };
  return c;
}

// A missing or unplugged device. Permission errors are not a reason to fall back: the default would be refused too.
export const isGone = (e) => !!e && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError' || e.name === 'NotReadableError' || e.constraint === 'deviceId');

/** One track of the saved device. Returns { track, fellBack }. fellBack is true when the saved device was missing and the default opened. */
export async function acquire(kind, p, md = globalThis.navigator && navigator.mediaDevices) {
  const want = (exact) => (kind === 'audio' ? { audio: audioConstraints(p, exact) } : { video: videoConstraints(p, exact) });
  const saved = kind === 'audio' ? p.micId : p.camId;
  try {
    const s = await md.getUserMedia(want(true));
    return { track: kind === 'audio' ? s.getAudioTracks()[0] : s.getVideoTracks()[0], fellBack: false };
  } catch (e) {
    if (!saved || !isGone(e)) throw e;
    const s = await md.getUserMedia(want(false));
    return { track: kind === 'audio' ? s.getAudioTracks()[0] : s.getVideoTracks()[0], fellBack: true };
  }
}

/** Microphone then camera for the lobby, each with the exact-then-default rule. A camera that fails leaves the microphone open.
 *  Returns { stream, fellBack: { mic, cam }, camError }. Throws only when the microphone fails. */
export async function acquireBoth(p, wantVideo, md = globalThis.navigator && navigator.mediaDevices) {
  const fellBack = { mic: false, cam: false };
  const tracks = [];
  let camError = null;
  const a = await acquire('audio', p, md); tracks.push(a.track); fellBack.mic = a.fellBack;
  if (wantVideo) {
    try { const v = await acquire('video', p, md); tracks.push(v.track); fellBack.cam = v.fellBack; }
    catch (e) { camError = e; }
  }
  return { stream: new MediaStream(tracks), fellBack, camError };
}

export const trackDevice = (t) => { try { return (t && t.getSettings().deviceId) || ''; } catch { return ''; } };
