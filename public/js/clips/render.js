// Clips: "Download edited version". The edits are only JSON, so the file has to be made: the original plays through a canvas
// and a MediaRecorder writes what it sees, jumping over every cut. It runs in real time (a five minute clip takes about five
// minutes) and needs the tab open. The sound is kept by routing the video's audio into the recording through Web Audio.
import { pickVideoType } from './recorder.js';

export async function renderEdited(url, ranges, opts) {
  if (!ranges.length) throw new Error('Nothing to render.');
  const total = ranges.reduce((s, [a, b]) => s + (b - a), 0);
  const v = document.createElement('video');
  v.src = url;
  v.playsInline = true;
  v.preload = 'auto';
  v.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.appendChild(v);
  const cleanup = [() => v.remove()];
  try {
    await new Promise((ok, fail) => {
      v.onloadedmetadata = () => ok();
      v.onerror = () => fail(new Error('Could not open the video.'));
    });
    const seek = (t) =>
      new Promise((ok) => {
        v.onseeked = () => ok();
        v.currentTime = t;
      });
    await seek(ranges[0][0]);

    const scale = Math.min(1, 1920 / (v.videoWidth || 1280), 1080 / (v.videoHeight || 720));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((v.videoWidth || 1280) * scale) & ~1;
    canvas.height = Math.round((v.videoHeight || 720) * scale) & ~1;
    const g = canvas.getContext('2d');
    const draw = () => g.drawImage(v, 0, 0, canvas.width, canvas.height);
    draw();

    const AC = window.AudioContext || window.webkitAudioContext;
    const actx = new AC();
    cleanup.push(() => actx.close().catch(() => undefined));
    const dest = actx.createMediaStreamDestination();
    // Not connected to the speakers: the render is silent to the person doing it.
    actx.createMediaElementSource(v).connect(dest);
    await actx.resume().catch(() => undefined);

    // A worker timer keeps drawing when the tab is in the background.
    const wurl = URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),33)'], { type: 'text/javascript' }));
    const worker = new Worker(wurl);
    worker.onmessage = draw;
    cleanup.push(() => {
      worker.terminate();
      URL.revokeObjectURL(wurl);
    });

    const stream = new MediaStream([canvas.captureStream(30).getVideoTracks()[0], ...dest.stream.getAudioTracks()]);
    const mime = pickVideoType();
    const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 2500000, audioBitsPerSecond: 128000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise((ok) => (rec.onstop = () => ok()));
    rec.start(1000);
    await v.play();

    let done = 0;
    for (let i = 0; i < ranges.length; i++) {
      const [a, b] = ranges[i];
      if (i > 0) await seek(a);
      if (v.paused) await v.play();
      await new Promise((ok, fail) => {
        const tick = window.setInterval(() => {
          if (opts.signal.cancelled) {
            window.clearInterval(tick);
            fail(new Error('cancelled'));
            return;
          }
          const t = v.currentTime;
          opts.onProgress(Math.min(1, (done + Math.max(0, t - a)) / total));
          if (t >= b - 0.04 || v.ended) {
            window.clearInterval(tick);
            ok();
          }
        }, 80);
      });
      done += b - a;
    }
    v.pause();
    opts.onProgress(1);
    rec.stop();
    await stopped;
    const type = rec.mimeType || mime || 'video/webm';
    return { blob: new Blob(chunks, { type }), ext: /mp4/.test(type) ? 'mp4' : 'webm' };
  } finally {
    for (const c of cleanup) c();
  }
}
