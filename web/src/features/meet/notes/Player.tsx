// The recording player on the notes page: one media element per file, kept while the page redraws so typing in the search box never stops
// playback. Port of playerNode in public/js/meet/notes.js (same classes, same keys).
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui';

const clock = (t: number) => (Number.isFinite(t) && t >= 0 ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : '0:00');
const BARS = Array.from({ length: 28 }, (_, i) => ({ h: 22 + ((i * 37) % 58), d: (i % 7) * 0.11 }));

export function Player({ src, kind, label, mins }: { src: string; kind: string; label: string; mins: number }) {
  const video = kind === 'video';
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [st, setSt] = useState({ playing: false, loading: false, error: false });
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const length = () => {
    const m = media.current;
    return m && Number.isFinite(m.duration) && m.duration > 0 ? m.duration : (mins || 0) * 60;
  };
  useEffect(() => {
    const m = media.current;
    if (!m) return;
    const paint = () => {
      setT(m.currentTime);
      setDur(length());
    };
    const on = (ev: string, fn: () => void) => m.addEventListener(ev, fn);
    for (const ev of ['timeupdate', 'durationchange', 'seeked']) on(ev, paint);
    on('playing', () => setSt({ playing: true, loading: false, error: false }));
    for (const ev of ['pause', 'ended']) on(ev, () => setSt((s) => ({ ...s, playing: false, loading: false })));
    for (const ev of ['waiting', 'seeking']) on(ev, () => !m.paused && setSt((s) => ({ ...s, loading: true })));
    on('canplay', () => setSt((s) => ({ ...s, loading: false })));
    on('error', () => setSt({ playing: false, loading: false, error: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);
  const toggle = () => {
    const m = media.current;
    if (!m) return;
    if (m.paused || m.ended) {
      setSt((s) => ({ ...s, loading: true, error: false }));
      m.play().catch(() => setSt({ playing: false, loading: false, error: true }));
    } else m.pause();
  };
  const seek = (x: number) => {
    const m = media.current;
    const r = bar.current?.getBoundingClientRect();
    const L = length();
    if (m && r && L && r.width) {
      m.currentTime = Math.max(0, Math.min(1, (x - r.left) / r.width)) * L;
      setT(m.currentTime);
    }
  };
  const L = dur || (mins || 0) * 60;
  const cls = 'player is-' + (video ? 'video' : 'sound') + (st.loading ? ' is-loading' : '') + (st.error ? ' is-error' : '') + (st.playing ? ' is-playing' : '');
  const mediaEl = video ? (
    <video ref={media as React.Ref<HTMLVideoElement>} preload="metadata" src={src} playsInline />
  ) : (
    <audio ref={media as React.Ref<HTMLAudioElement>} preload="metadata" src={src} />
  );
  return (
    <div
      className={cls}
      role="button"
      tabIndex={0}
      aria-label={(video ? 'Play the video recording' : 'Play the sound recording') + (label ? ', ' + label : '')}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('.pl-bar')) return;
        toggle();
      }}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === ' ' || e.key === 'Enter')) {
          e.preventDefault();
          toggle();
        }
      }}
    >
      {video ? mediaEl : null}
      {video ? null : (
        <>
          <div className="pl-top">
            <Icon n="mic" />
            <span>Sound only{label ? ', ' + label : ''}</span>
          </div>
          <div className="pl-bars" aria-hidden="true">
            {BARS.map((b, i) => (
              <i key={i} style={{ '--h': b.h + '%', '--d': b.d + 's' } as React.CSSProperties} />
            ))}
          </div>
        </>
      )}
      <span className="pl-btn" aria-hidden="true">
        {st.playing ? (
          <svg className="h-i" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 5h4v14H7z" />
            <path d="M13 5h4v14h-4z" />
          </svg>
        ) : (
          <Icon n="play" />
        )}
      </span>
      <span className="pl-spin" aria-hidden="true" />
      <p className="pl-err" hidden={!st.error}>
        The recording did not load.
      </p>
      <div
        className="pl-bar"
        ref={bar}
        role="slider"
        aria-label="Position"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          seek(e.clientX);
        }}
        onKeyDown={(e) => {
          const m = media.current;
          if (!m) return;
          if (e.key === 'ArrowRight') {
            m.currentTime += 10;
            e.preventDefault();
          } else if (e.key === 'ArrowLeft') {
            m.currentTime = Math.max(0, m.currentTime - 10);
            e.preventDefault();
          }
        }}
      >
        <i style={{ width: L ? Math.min(100, (t / L) * 100) + '%' : '0%' }} />
      </div>
      <div className="pl-time">
        <b>{clock(t)}</b>
        <span>{L ? clock(L) : mins ? clock(mins * 60) : ''}</span>
      </div>
      {video ? null : mediaEl}
    </div>
  );
}
