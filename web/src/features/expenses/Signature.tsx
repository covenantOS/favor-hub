// The signature box shared by the request form and the review page: type a name (drawn in the Caveat script) or draw with a finger or
// pen. The page asks it has() and value(), where value() is a PNG data URL, as the Astro widget (public/js/expense-sign.js) answered.
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';

export interface SigHandle {
  has(): boolean;
  value(): string | null;
}

function typedToDataUrl(text: string): string {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 160;
  const x = c.getContext('2d')!;
  x.font = '600 72px Caveat, cursive';
  x.fillStyle = '#0d0f0c';
  x.textBaseline = 'middle';
  x.fillText(text, 16, 84);
  return c.toDataURL('image/png');
}

export function Signature({ prefill = '', handle }: { prefill?: string; handle: Ref<SigHandle | null> }) {
  const [mode, setMode] = useState<'type' | 'draw'>('type');
  const [typed, setTyped] = useState(prefill);
  const [drawn, setDrawn] = useState(false);
  const drawnRef = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sized = useRef(false);
  const pen = useRef(false);
  const modeRef = useRef(mode);
  const typedRef = useRef(typed);
  modeRef.current = mode;
  typedRef.current = typed;

  // The script font loads before a typed signature is drawn into an image.
  useEffect(() => {
    // expenses.css pulled this stylesheet in with an @import, which held every page that uses expenses.css back for a font only this box
    // needs; the web build drops the @import (vite.config.ts) and the box asks for the font itself.
    if (!document.getElementById('exp-caveat')) {
      const l = document.createElement('link');
      l.id = 'exp-caveat';
      l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Caveat:wght@500;600&display=swap';
      document.head.appendChild(l);
    }
    if (document.fonts && document.fonts.load) document.fonts.load('600 72px Caveat').catch(() => undefined);
  }, []);

  function size() {
    const cv = canvas.current;
    const bx = box.current;
    if (sized.current || !cv || !bx || bx.style.display === 'none') return;
    const r = bx.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cv.width = r.width * dpr;
    cv.height = r.height * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0d0f0c';
    sized.current = true;
  }

  useImperativeHandle(
    handle,
    () => ({
      has: () => (modeRef.current === 'draw' ? drawnRef.current : typedRef.current.trim().length > 0),
      value: () => {
        if (modeRef.current === 'draw') return drawnRef.current && canvas.current ? canvas.current.toDataURL('image/png') : null;
        const t = typedRef.current.trim();
        return t ? typedToDataUrl(t) : null;
      },
    }),
    [],
  );

  // The box is hidden until Draw is chosen, so it is measured once it shows.
  useEffect(() => {
    if (mode === 'draw') size();
  }, [mode]);

  return (
    <>
      <div className="exp-sig-tabs">
        <button type="button" data-m="type" className={mode === 'type' ? 'on' : undefined} onClick={() => setMode('type')}>
          Type
        </button>
        <button type="button" data-m="draw" className={mode === 'draw' ? 'on' : undefined} onClick={() => setMode('draw')}>
          Draw
        </button>
      </div>
      <div className="exp-sig-typed" style={mode === 'type' ? undefined : { display: 'none' }}>
        <input placeholder="Type your full name" maxLength={80} autoComplete="name" autoCapitalize="words" enterKeyHint="done" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type your full name" />
        <div className="preview">{typed || ' '}</div>
      </div>
      <div className="exp-sig-box" ref={box} style={mode === 'draw' ? undefined : { display: 'none' }}>
        <canvas
          ref={canvas}
          onPointerDown={(e) => {
            size();
            const cv = canvas.current!;
            pen.current = true;
            drawnRef.current = true;
            setDrawn(true);
            const ctx = cv.getContext('2d')!;
            ctx.beginPath();
            ctx.moveTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
            cv.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!pen.current) return;
            const ctx = canvas.current!.getContext('2d')!;
            ctx.lineTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
            ctx.stroke();
          }}
          onPointerUp={() => {
            pen.current = false;
          }}
        />
        <span className="hint" style={drawn ? { display: 'none' } : undefined}>
          Sign here
        </span>
        <button
          type="button"
          className="clear"
          onClick={() => {
            const cv = canvas.current!;
            cv.getContext('2d')!.clearRect(0, 0, cv.width, cv.height);
            drawnRef.current = false;
            setDrawn(false);
          }}
        >
          Clear
        </button>
      </div>
    </>
  );
}
