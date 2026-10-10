// Clips: a video file picked from disk (a phone's own screen recording, an old download) goes through the same path as a
// live recording: R2 multipart parts, the sound read for a transcript, a poster, then /complete.
import { api, putWithRetry } from './core.js';

export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_DECODE_BYTES = 250 * 1024 * 1024; // decoding the sound needs the whole file in memory
const SLICE_SECONDS = 240;

export function mimeOfFile(file) {
  const t = file.type.split(';')[0].toLowerCase();
  if (t === 'video/mp4' || t === 'video/webm' || t === 'video/quicktime') return t;
  const m = /\.([a-z0-9]+)$/i.exec(file.name);
  const ext = m ? m[1].toLowerCase() : '';
  return ext === 'mov' ? 'video/quicktime' : ext === 'webm' ? 'video/webm' : ext === 'mp4' || ext === 'm4v' ? 'video/mp4' : '';
}

export function wav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([buf], { type: 'audio/wav' });
}

/** Duration and a poster frame, read by playing the file in a hidden element. */
async function probe(file) {
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'metadata';
    v.src = url;
    await new Promise((ok, fail) => {
      v.onloadedmetadata = () => ok();
      v.onerror = () => fail(new Error('Could not read that video.'));
    });
    const duration = Number.isFinite(v.duration) ? v.duration : 0;
    let poster = null;
    try {
      v.currentTime = Math.min(2, Math.max(duration / 2, 0));
      await new Promise((ok) => {
        v.onseeked = () => ok();
        setTimeout(ok, 4000);
      });
      if (v.videoWidth) {
        const c = document.createElement('canvas');
        c.width = 1280;
        c.height = Math.round((1280 * v.videoHeight) / v.videoWidth);
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        poster = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.8));
      }
    } catch (e) {
      poster = null;
    }
    return { duration, poster };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Pictures of the screen from an uploaded file: one early, then one every few seconds, at most 60 and about a minute of work. */
async function sendFrames(file, id, duration, onProgress) {
  if (!duration || duration < 1) return;
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = url;
    await new Promise((ok, fail) => {
      v.onloadeddata = () => ok();
      v.onerror = () => fail(new Error('unreadable'));
      setTimeout(ok, 8000);
    });
    if (!v.videoWidth) return;
    const step = Math.max(6, duration / 60);
    const c = document.createElement('canvas');
    c.width = Math.min(1024, v.videoWidth);
    c.height = Math.round((c.width * v.videoHeight) / v.videoWidth);
    const g = c.getContext('2d');
    const started = Date.now();
    for (let t = Math.min(1.5, duration / 2); t < duration && Date.now() - started < 70000; t += step) {
      v.currentTime = t;
      await new Promise((ok) => {
        v.onseeked = () => ok();
        setTimeout(ok, 3000);
      });
      g.drawImage(v, 0, 0, c.width, c.height);
      const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.7));
      if (blob) await fetch(`/api/clips/${id}/frame?t=${Math.round(t * 1000)}`, { method: 'PUT', body: blob, credentials: 'same-origin', headers: { 'content-type': 'image/jpeg' } }).catch(() => undefined);
      onProgress(0.9 + Math.min(0.06, (t / duration) * 0.06), 'Reading the screen');
    }
  } catch (e) {
    // pictures are a bonus
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The file's sound as 16 kHz mono WAV slices of four minutes. Empty when the browser cannot decode it. */
async function audioSlices(file) {
  if (file.size > MAX_DECODE_BYTES) return [];
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ sampleRate: 16000 });
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    ctx.close();
    const rate = buf.sampleRate;
    const mono = new Float32Array(buf.length);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels;
    }
    const out = [];
    const step = SLICE_SECONDS * rate;
    for (let at = 0; at < mono.length; at += step) out.push({ start: at / rate, blob: wav(mono.subarray(at, Math.min(at + step, mono.length)), rate) });
    return out;
  } catch (e) {
    return [];
  }
}

/** Uploads a video file as a clip. Resolves with { id, durationMs }. `onProgress(fraction, label)`. */
export async function uploadVideoFile(file, onProgress) {
  const mime = mimeOfFile(file);
  if (!mime) throw new Error('Pick an MP4, MOV or WebM video.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('That video is over 1 GB. Trim it first.');
  const stop = { cancelled: false };
  const title = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 120);
  const { id, partBytes } = await api('/api/clips', { method: 'POST', json: { mime, kind: 'upload', title: '' } });
  try {
    const meta = await probe(file).catch(() => ({ duration: 0, poster: null }));
    const total = Math.max(1, Math.ceil(file.size / partBytes));
    for (let n = 1; n <= total; n++) {
      const part = file.slice((n - 1) * partBytes, Math.min(n * partBytes, file.size), mime);
      await putWithRetry(`/api/clips/${id}/part?n=${n}`, part, { 'x-elapsed': String(meta.duration), 'content-type': 'application/octet-stream' }, stop);
      onProgress((n / total) * 0.85, 'Uploading');
    }
    if (meta.poster) await fetch(`/api/clips/${id}/poster`, { method: 'PUT', body: meta.poster, credentials: 'same-origin', headers: { 'content-type': 'image/jpeg' } }).catch(() => undefined);
    onProgress(0.88, 'Preparing the transcript');
    const slices = await audioSlices(file);
    for (let i = 0; i < slices.length; i++) {
      try {
        await putWithRetry(`/api/clips/${id}/audio?n=${i}&start=${slices[i].start.toFixed(2)}`, slices[i].blob, { 'content-type': 'audio/wav' }, stop);
      } catch (e) {
        break; // the transcript is a bonus
      }
    }
    await sendFrames(file, id, meta.duration, onProgress);
    onProgress(0.97, 'Finishing');
    const durationMs = Math.round(meta.duration * 1000);
    await api(`/api/clips/${id}/complete`, { method: 'POST', json: { durationMs, titleHint: title } });
    onProgress(1, 'Saved');
    return { id, durationMs };
  } catch (e) {
    await api(`/api/clips/${id}`, { method: 'DELETE' }).catch(() => undefined);
    throw e;
  }
}
