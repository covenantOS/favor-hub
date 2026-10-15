// The full-screen camera: one check or slip in the frame, a shutter, a strip of what was saved, and a count against the tape. Follows
// openCamera(), shutter() and camCount() in public/js/gift-entry.js. The stream is opened by the deposit screen when the person presses
// Take photos (a press is the only place a camera may be asked for) and handed in here.
import { useEffect, useRef, useState } from 'react';
import { toJpeg } from './image';
import { BLUR_MIN } from './logic';

export function Camera({ stream, count, total, onShot, onClose }: { stream: MediaStream; count: number; total: number; onShot: (blob: Blob) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [msg, setMsg] = useState('One check or slip in the frame');
  const [strip, setStrip] = useState<string[]>([]);
  const stripRef = useRef<HTMLDivElement>(null);
  const urls = useRef<string[]>([]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.srcObject = stream;
    void v.play().catch(() => undefined);
    return () => {
      v.srcObject = null;
    };
  }, [stream]);
  useEffect(
    () => () => {
      stream.getTracks().forEach((t) => t.stop());
      urls.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [stream]
  );
  useEffect(() => {
    const s = stripRef.current;
    if (s) s.scrollLeft = s.scrollWidth;
  }, [strip]);

  const shutter = async () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const shot = await toJpeg(v, v.videoWidth, v.videoHeight);
    if (shot.blur < BLUR_MIN) {
      URL.revokeObjectURL(shot.url);
      setMsg('Blurry. Hold still and take it again');
      return;
    }
    urls.current.push(shot.url);
    setStrip((s) => [...s, shot.url]);
    onShot(shot.blob);
    setMsg('Saved');
  };

  return (
    <div className="ge-cam">
      <div className="ge-cam__top">
        <button type="button" data-camclose="" onClick={onClose}>
          Done
        </button>
        <span id="ge-camcount">
          {count} of {total} items
        </span>
        <span style={{ width: 60 }}></span>
      </div>
      <div className="ge-cam__view">
        <video ref={video} autoPlay playsInline muted></video>
        <div className="ge-cam__guide"></div>
        <div className="ge-cam__msg" id="ge-cammsg">
          {msg}
        </div>
      </div>
      <div className="ge-cam__bar">
        <div className="ge-cam__strip" id="ge-camstrip" ref={stripRef}>
          {strip.map((u) => (
            <img key={u} src={u} alt="" />
          ))}
        </div>
        <button type="button" className="ge-shutter" data-shutter="" aria-label="Take the photo" onClick={() => void shutter()}></button>
        <span style={{ width: 60 }}></span>
      </div>
    </div>
  );
}
