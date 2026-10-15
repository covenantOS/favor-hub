// Drive answers. Documents are rows (type icon, owner, dates, Open in Drive, then the passage or the number that matched).
// Photos are a justified grid and videos a grid of 16:9 tiles with the length and the matched moment; a filter row (place,
// year, quality, folder, order) and Show more ask /api/brain/drive/media again. A press opens the large view: one photo or
// video over the page, arrows and swipes for the others, Download, Open in Drive, Send to email and Drag.
// Only files the person's own Google account opens come back (the thumb and stream routes check it).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import { BodyPortal } from '@/shell/BodyPortal';
import { hubOv } from '@/lib/hubOv';
import { dlong, dshort, int, safeHref } from '../fmt';
import { Ic } from '../icons';
import type { BlockProps, BlockCtx } from './ctx';

const THUMB = (id: string, s: number) => `/api/brain/drive/thumb?id=${encodeURIComponent(id)}&s=${s}`;
const STREAM = (id: string) => `/api/brain/drive/stream?id=${encodeURIComponent(id)}`;
const dlUrl = (id: string) => `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
const mb = (b: number) => (b >= 10485760 ? Math.round(b / 1048576) + ' MB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
const GRADE: Record<string, string> = { high: 'High quality', medium: 'Medium quality', low: 'Low quality' };
const photoDetail = (im: any) => {
  if (!im) return '';
  const parts: string[] = [];
  if (im.width && im.height) parts.push(`${im.width} × ${im.height}`);
  if (im.bytes) parts.push(mb(im.bytes));
  return parts.join(', ');
};
const clock = (s: unknown) => {
  const t = Math.max(0, Math.floor(Number(s) || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};
const secs = (c: unknown) => String(c || '').split(':').reduce((a, x) => a * 60 + (Number(x) || 0), 0);
const ratioOf = (f: any) => (f.image && f.image.width && f.image.height ? Math.min(2.6, Math.max(0.45, f.image.width / f.image.height)) : 1.4);
const SCENE = /^\s*\[Scene at ([\d:]+)\]\s*/i;
/** A video answer stored before the grid carries only the raw scene text: the time and a short line are read from it. */
function videoOf(f: any): { at?: number; line?: string; duration?: number } {
  if (f.video) return f.video;
  const p = (f.passages || [])[0];
  const m = p && String(p.text || '').match(SCENE);
  if (!m) return {};
  let s = String(p.text).replace(SCENE, '').replace(/^(the|this) (image|photo|picture|frame) (shows|is|depicts|features)\s+/i, '');
  s = (s.split(/(?<=[.!?])\s+/)[0] || s).replace(/[.!?]+$/, '').replace(/\s+(?:in|with) (?:his|her|their) hands?\b/i, '');
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (s.length > 72) s = s.slice(0, 72).replace(/\s+\S*$/, '') + '...';
  return { at: secs(m[1]), line: s };
}
const sceneText = (f: any) => (f.passages || []).map((p: any) => String(p.text || '').replace(SCENE, '')).filter(Boolean).join(' ');
const itemOf = (f: any) => {
  const v = f.kind === 'video' ? videoOf(f) : null;
  const sub = f.kind === 'video' ? ['Video', v && v.duration ? clock(v.duration) : '', f.folder || ''].filter(Boolean).join(', ') : ['Photo', photoDetail(f.image), f.folder || ''].filter(Boolean).join(', ');
  return { kind: 'drive', title: f.title, url: f.link, sub };
};
const drag = (f: any) => (e: React.DragEvent) => {
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData('text/plain', f.title + ' ' + f.link);
  e.dataTransfer.setData('text/uri-list', f.link);
  try {
    e.dataTransfer.setData('application/x-favoros-item', JSON.stringify(itemOf(f)));
  } catch {
    /* text only */
  }
};

/** A picture that says when it loaded (and shows the photo icon if it never does). */
function Thumb({ id, s = 400 }: { id: string; s?: number }) {
  return (
    <img
      src={THUMB(id, s)}
      alt=""
      loading="lazy"
      decoding="async"
      onLoad={(e) => (e.currentTarget.parentNode as HTMLElement)?.classList.add('is-ready')}
      onError={(e) => (e.currentTarget.parentNode as HTMLElement)?.classList.add('is-broken')}
    />
  );
}

// ---- Document rows --------------------------------------------------------------------------------------------------------
const FILE_ICON: Record<string, string> = { doc: 'fdoc', pdf: 'fdoc', office: 'fdoc', text: 'fdoc', sheet: 'fgrid', slides: 'fslides', image: 'fimage', video: 'play', audio: 'volume' };
const NUMBERISH = /^[-(]?\$?\d[\d,]*(\.\d+)?\s?(%|[KMB])?\)?$/i;
const namedColumn = (h: unknown) => (/^col [A-Z]{1,3}$/i.test(String(h || '').trim()) ? '' : String(h || '').trim());
const tidy = (t: unknown) =>
  String(t == null ? '' : t)
    .replace(/\*{2,3}([^*]+)\*{2,3}/g, '$1')
    .replace(/\*{2,}/g, '')
    .replace(/(^|\s)#{1,6}(?=\s)/g, '$1')
    .replace(/(^|\s)\*(?=\s)/g, '$1·')
    .replace(/\s{2,}/g, ' ')
    .trim();
function Passage({ p }: { p: any }) {
  if (!p.cell)
    return (
      <blockquote className="fq">
        {tidy(p.text)}
        {p.loc && <em>{p.loc}</em>}
      </blockquote>
    );
  const v = String(p.cell.value == null ? '' : p.cell.value).trim();
  const col = namedColumn(p.cell.header);
  const where = `${p.sheet ? `Sheet ${p.sheet}, cell` : 'Cell'} ${p.cell.ref}`;
  if (NUMBERISH.test(v))
    return (
      <div className="fnum">
        <b>{v}</b>
        {col && <span>{col}</span>}
        <em>{where}</em>
      </div>
    );
  return (
    <blockquote className="fq">
      {v}
      <em>
        {col ? col + ' · ' : ''}
        {where}
      </em>
    </blockquote>
  );
}
function FileRow({ f }: { f: any }) {
  const kind = FILE_ICON[f.kind] ? f.kind : 'other';
  const meta = [f.owner || '', f.modified ? dlong(f.modified) : ''].filter(Boolean).join(' · ');
  const idx = f.indexed ? dshort(f.indexed) : '';
  return (
    <div className={'frow frow--' + kind} role="listitem">
      <span className="ftile">
        <Ic n={FILE_ICON[kind] || 'fdoc'} />
      </span>
      <div className="frow__t">
        <b className="frow__n">{f.title}</b>
        <div className="frow__m">
          <span className="tag ftag">{f.kind_label || 'File'}</span>
          {meta}
        </div>
        {f.folder && <div className="frow__f">{f.folder}</div>}
      </div>
      <div className="frow__side">
        <a className="h-btn h-btn--ghost h-btn--xs" href={safeHref(f.link)} target="_blank" rel="noopener" aria-label={'Open ' + f.title + ' in Drive'}>
          <Ic n="ext" />
          Open in Drive
        </a>
        {idx && (
          <span className="fidx">
            Indexed <time dateTime={String(f.indexed).slice(0, 10)}>{idx}</time>
          </span>
        )}
      </div>
      {((f.passages || []).length > 0 || f.hint) && (
        <div className="frow__b">
          {(f.passages || []).map((p: any, i: number) => (
            <Passage key={i} p={p} />
          ))}
          {f.hint && <span className="tag">Matched by picture description</span>}
        </div>
      )}
    </div>
  );
}

// ---- Photos and videos -----------------------------------------------------------------------------------------------------
const NOUN_M: Record<string, [string, string]> = { image: ['photo', 'photos'], video: ['video', 'videos'] };
const mediaTitle = (m: any) => (m.total === 1 ? `I found this ${NOUN_M[m.kind][0]}` : `I found ${int(m.total)}${m.exact ? '' : '+'} ${NOUN_M[m.kind][1]}`);
async function mediaFetch(query: unknown, offset: number) {
  const res = await fetch('/api/brain/drive/media', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' }, body: JSON.stringify({ query, offset }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.ok) throw new Error(d.message || 'That did not load. Try again.');
  return d;
}
const Skeletons = ({ kind, n }: { kind: string; n: number }) => (
  <>
    {Array.from({ length: n }, (_, i) =>
      kind === 'video' ? (
        <div className="vg__c is-sk" aria-hidden="true" key={'s' + i}>
          <span className="vg__t" />
          <div className="vg__b">
            <i />
            <i />
          </div>
        </div>
      ) : (
        <span className="mg__t is-sk" aria-hidden="true" key={'s' + i} style={{ ['--r' as string]: [1.5, 0.75, 1.33, 1.5, 1, 1.78][i % 6] }} />
      ),
    )}
  </>
);

function MediaBlock({ b, ctx }: BlockProps) {
  const [, redraw] = useState(0);
  const [loading, setLoading] = useState<'' | 'filter' | 'more'>('');
  const [lb, setLb] = useState<number | null>(null);
  const files = (b.files || []).concat(b.more || []) as any[];
  const m = b.media;
  const kind = (m && m.kind) || (files.every((f) => f.kind === 'image') ? 'image' : 'video');
  const q = (m && m.query) || {};
  const fc = (m && m.facets) || {};
  const setFilter = async (key: string, value: string) => {
    const query = { ...m.query, [key]: value || undefined };
    setLoading('filter');
    try {
      const d = await mediaFetch(query, 0);
      b.files = d.files || [];
      b.more = [];
      b.media = { ...m, total: d.total, exact: d.exact, next: d.next, query: d.query || query, facets: d.facets || m.facets };
      b.title = mediaTitle(b.media);
    } catch (err) {
      ctx.engine.toast((err as Error).message);
    }
    setLoading('');
    redraw((n) => n + 1);
  };
  const more = async () => {
    if (!m || m.next == null) return;
    setLoading('more');
    try {
      const d = await mediaFetch(m.query, m.next);
      const add = (d.files || []).filter((f: any) => !(b.files || []).some((x: any) => x.id === f.id));
      b.files = (b.files || []).concat(add);
      b.media = { ...m, total: d.total, exact: d.exact, next: d.next };
      b.title = mediaTitle(b.media);
    } catch (err) {
      ctx.engine.toast((err as Error).message);
    }
    setLoading('');
    redraw((n) => n + 1);
  };
  const sel = (key: string, label: string, opts: { value: string; label: string; n?: number }[]) =>
    opts.length ? (
      <label className="mf__s" key={key}>
        <span>{label}</span>
        <select value={String(q[key] || '')} disabled={!!loading} onChange={(e) => void setFilter(key, e.target.value)}>
          <option value="">{key === 'sort' ? 'Best match' : 'Any'}</option>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
              {o.n != null ? ` (${int(o.n)})` : ''}
            </option>
          ))}
        </select>
      </label>
    ) : null;
  const keep = (key: string, list: any[] | undefined) => (q[key] && !(list || []).some((o) => o.value === q[key]) ? [{ value: q[key], label: q[key] }].concat(list || []) : list || []);
  const shown = (b.files || []).length;
  const countLine = m ? `Showing ${int(shown)} of ${int(Math.max(m.total, shown))}${m.exact ? '' : '+'}` : '';
  return (
    <div className="card fcards fcards--media">
      <div className="card__h">
        <div>
          <div className="card__t">{b.title}</div>
          <div className="card__s">
            <Ic n="lock" /> Only files your Google account can open
          </div>
        </div>
      </div>
      {m && (
        // The filter row wraps onto a second line when it is wider than the card, so Folder is never cut off.
        <div className="mf mf--wrap" role="group" aria-label="Filter">
          {sel('place', 'Place', keep('place', fc.place))}
          {sel('year', 'Year', keep('year', fc.year))}
          {kind === 'image' &&
            sel('grade', 'Quality', [
              { value: 'high', label: 'High quality' },
              { value: 'medium', label: 'Medium or better' },
            ])}
          {sel('folder', 'Folder', keep('folder', fc.folder))}
          {sel(
            'sort',
            'Order',
            kind === 'image'
              ? [
                  { value: 'newest', label: 'Newest' },
                  { value: 'largest', label: 'Largest' },
                ]
              : [{ value: 'newest', label: 'Newest' }],
          )}
        </div>
      )}
      <div className={kind === 'image' ? 'mg' : 'vg'} role="list" aria-busy={loading === 'filter'}>
        {loading === 'filter' ? (
          <Skeletons kind={kind} n={Math.min(12, Math.max(6, shown))} />
        ) : (
          files.map((f, i) =>
            kind === 'image' ? (
              <PhotoTile key={f.id} f={f} open={() => setLb(i)} />
            ) : (
              <VideoTile key={f.id} f={f} open={() => setLb(i)} ctx={ctx} />
            ),
          )
        )}
        {loading === 'more' && <Skeletons kind={kind} n={12} />}
      </div>
      {!files.length && loading !== 'filter' && <p className="mempty">Nothing here with these filters. Clear one to see more.</p>}
      {m && m.next != null ? (
        <div className="mmore">
          <button type="button" className="h-btn h-btn--ghost" disabled={loading === 'more'} onClick={() => void more()}>
            {loading === 'more' ? 'Loading' : 'Show more'}
          </button>
          <span>{countLine}</span>
        </div>
      ) : m && shown > 12 ? (
        <div className="mmore">
          <span>{countLine}</span>
        </div>
      ) : null}
      {lb != null && <Lightbox all={files} start={lb} onClose={() => setLb(null)} ctx={ctx} />}
    </div>
  );
}
function PhotoTile({ f, open }: { f: any; open: () => void }) {
  const g = f.image && f.image.grade;
  const meta = [g ? GRADE[g] : '', photoDetail(f.image)].filter(Boolean).join(', ');
  return (
    <button type="button" className={'mg__t' + (g === 'high' ? ' is-hq' : '')} role="listitem" style={{ ['--r' as string]: ratioOf(f).toFixed(3) }} aria-label={`${f.title}${meta ? ', ' + meta : ''}. Open large`} draggable onDragStart={drag(f)} onClick={open}>
      <Thumb id={f.id} />
      <span className="mg__ov">
        <b>{f.title}</b>
        {f.folder && <em>{f.folder}</em>}
      </span>
      {g === 'high' && <span className="mg__q">HQ</span>}
    </button>
  );
}
function VideoTile({ f, open, ctx }: { f: any; open: () => void; ctx: BlockCtx }) {
  const v = videoOf(f);
  const at = v.line && v.at != null ? clock(v.at) : '';
  const det = sceneText(f);
  return (
    <div className="vg__c" role="listitem">
      <button type="button" className="vg__t" aria-label={`Play ${f.title}${at ? ' from ' + at : ''}`} draggable onDragStart={drag(f)} onClick={open}>
        <Thumb id={f.id} />
        <span className="vg__play">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8.5 5.5v13l10.5-6.5z" fill="currentColor" />
          </svg>
        </span>
        {v.duration ? <span className="vg__dur">{clock(v.duration)}</span> : null}
      </button>
      <div className="vg__b">
        <b className="vg__n" title={f.title}>
          {f.title}
        </b>
        {v.line && (
          <button type="button" className="vg__l" onClick={open}>
            {v.line}
            {at && (
              <>
                , <time>{at}</time>
              </>
            )}
          </button>
        )}
        <div className="vg__m">{[f.modified ? dlong(f.modified) : '', f.folder || ''].filter(Boolean).join(' · ')}</div>
        <div className="vg__a">
          {f.like && (
            <button type="button" className="vg__x" onClick={() => ctx.ask(f.like, 'find_file')}>
              More like this
            </button>
          )}
          {det && (
            <details className="vg__d">
              <summary>Details</summary>
              <p>{det}</p>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

const ico = (d: React.ReactNode) => <svg viewBox="0 0 24 24" aria-hidden="true">{d}</svg>;
function Lightbox({ all, start, onClose, ctx }: { all: any[]; start: number; onClose: () => void; ctx: BlockCtx }) {
  const [k, setK] = useState(start);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const from = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);
  const n = all.length;
  const go = (d: number) => {
    setReady(false);
    setErr(false);
    setK((x) => (x + d + n) % n);
  };
  const f = all[k];
  const isVid = f.kind === 'video';
  const v = isVid ? videoOf(f) : null;
  useEffect(() => {
    document.documentElement.classList.add('plb-on');
    const tok = hubOv.on(onClose);
    box.current?.querySelector<HTMLElement>('.plb__x')?.focus();
    return () => {
      document.documentElement.classList.remove('plb-on');
      hubOv.off(tok);
      (from.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);
  const sx = useRef<number | null>(null);
  const FC = typeof window !== 'undefined' ? (window as any).FavorCompose : null;
  return BodyPortal(
    <div className="bc-root bc-portal--page">
      <div
        className={'plb is-open' + (isVid ? ' is-video' : '')}
        role="dialog"
        aria-modal="true"
        aria-label="Photo or video"
        ref={box}
        onKeyDown={(e) => {
          if ((e.target as HTMLElement).tagName === 'VIDEO' && e.key !== 'Escape') return;
          if (e.key === 'Escape') onClose();
          else if (e.key === 'ArrowLeft') go(-1);
          else if (e.key === 'ArrowRight') go(1);
        }}
        onTouchStart={(e) => {
          sx.current = e.touches.length === 1 && !(e.target as Element).closest('video, .plb__side') ? e.touches[0].clientX : null;
        }}
        onTouchEnd={(e) => {
          if (sx.current == null) return;
          const dx = e.changedTouches[0].clientX - sx.current;
          sx.current = null;
          if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        }}
      >
        <div className="plb__bg" onClick={onClose} />
        <div className="plb__box">
          <div className={'plb__pic' + (ready ? ' is-ready' : '')}>
            <span className="spin" />
            {isVid ? (
              <video
                key={f.id}
                ref={vid}
                controls
                playsInline
                preload="metadata"
                poster={THUMB(f.id, 1600)}
                src={STREAM(f.id) + (v && v.at ? '#t=' + v.at : '')}
                onLoadedMetadata={(e) => {
                  const el = e.currentTarget;
                  const at = v && v.at ? v.at : 0;
                  if (at && Math.abs(el.currentTime - at) > 1.5) {
                    try {
                      el.currentTime = at;
                    } catch {
                      /* seek later */
                    }
                  }
                  setReady(true);
                  el.play().catch(() => undefined);
                }}
                onError={() => {
                  setReady(true);
                  setErr(true);
                }}
              />
            ) : (
              <img
                key={f.id}
                alt={f.description || f.title}
                src={THUMB(f.id, 1600)}
                style={err ? { display: 'none' } : undefined}
                onLoad={() => setReady(true)}
                onError={() => {
                  setReady(true);
                  setErr(true);
                }}
              />
            )}
            {err && (
              <p className="plb__err">
                This {isVid ? 'video will not play' : 'picture will not load'} here.{' '}
                <a href={safeHref(f.link)} target="_blank" rel="noopener">
                  Open it in Drive
                </a>
              </p>
            )}
          </div>
          <div className="plb__side">
            <button type="button" className="plb__x" aria-label="Close" onClick={onClose}>
              {'×'}
            </button>
            <span className="plb__n">{n > 1 ? `${k + 1} of ${n}` : ''}</span>
            <b className="plb__t">{f.title}</b>
            <div className="plb__m">
              {isVid
                ? [v && v.duration ? clock(v.duration) : '', f.modified ? dlong(f.modified) : ''].filter(Boolean).join(' · ')
                : [f.image && f.image.grade ? GRADE[f.image.grade] : '', photoDetail(f.image)].filter(Boolean).join(' · ')}
            </div>
            <div className="plb__f">{f.folder || ''}</div>
            <div className="plb__d">
              {isVid ? (
                v && v.line ? (
                  <>
                    <button
                      type="button"
                      className="plb__jump"
                      onClick={() => {
                        const el = vid.current;
                        if (!el) return;
                        try {
                          el.currentTime = v.at || 0;
                          el.play().catch(() => undefined);
                        } catch {
                          /* not ready */
                        }
                      }}
                    >
                      <Ic n="play" />
                      {v.line}, {clock(v.at || 0)}
                    </button>
                    {sceneText(f) && (
                      <details className="plb__det">
                        <summary>Details</summary>
                        <p>{sceneText(f)}</p>
                      </details>
                    )}
                  </>
                ) : null
              ) : (
                f.description || 'No description yet'
              )}
            </div>
            <div className="plb__a">
              <a className="h-btn h-btn--primary h-btn--sm" href={dlUrl(f.id)} target="_blank" rel="noopener">
                {ico(<path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" />)}Download original
              </a>
              <a className="h-btn h-btn--ghost h-btn--sm" href={safeHref(f.link)} target="_blank" rel="noopener">
                <Ic n="ext" />
                Open in Drive
              </a>
              {FC && FC.add && (
                <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => FC.add(itemOf(f))}>
                  {ico(
                    <>
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <path d="m3 7 9 6 9-6" />
                    </>,
                  )}
                  Send to email
                </button>
              )}
              <span className="h-btn h-btn--ghost h-btn--sm plb__drag" draggable onDragStart={drag(f)} title="Drag into a message, a task or an email">
                {ico(
                  <>
                    <circle cx="9" cy="6" r="1.2" />
                    <circle cx="15" cy="6" r="1.2" />
                    <circle cx="9" cy="12" r="1.2" />
                    <circle cx="15" cy="12" r="1.2" />
                    <circle cx="9" cy="18" r="1.2" />
                    <circle cx="15" cy="18" r="1.2" />
                  </>,
                )}
                Drag
              </span>
              {f.like && (
                <button
                  type="button"
                  className="h-btn h-btn--ghost h-btn--sm"
                  onClick={() => {
                    onClose();
                    ctx.ask(f.like, 'find_file');
                  }}
                >
                  More like this
                </button>
              )}
            </div>
          </div>
          <button type="button" className="plb__nav plb__nav--p" aria-label="Previous" hidden={n < 2} onClick={() => go(-1)}>
            {'‹'}
          </button>
          <button type="button" className="plb__nav plb__nav--n" aria-label="Next" hidden={n < 2} onClick={() => go(1)}>
            {'›'}
          </button>
        </div>
      </div>
    </div>,
  );
}

/** Drive files: a media grid when every file is a photo or every one a video (or the Brain sent media paging), else rows. */
export function FilesBlock({ b, ctx }: BlockProps) {
  const more = (b.more || []) as any[];
  const all = (b.files || []).concat(more) as any[];
  if (b.media || (all.length && (all.every((f) => f.kind === 'image') || all.every((f) => f.kind === 'video')))) return <MediaBlock b={b} ctx={ctx} />;
  return (
    <div className="card fcards">
      <div className="card__h">
        <div>
          <div className="card__t">{b.title}</div>
          <div className="card__s">
            <Ic n="lock" /> Only files your Google account can open
          </div>
        </div>
      </div>
      <div className="frows" role="list">
        {(b.files || []).map((f: any, i: number) => (
          <FileRow key={f.id || i} f={f} />
        ))}
      </div>
      {more.length > 0 && (
        <details className="fmore">
          <summary>
            {more.length} more {more.length === 1 ? 'match' : 'matches'}
            <Ic n="caret" />
          </summary>
          <div className="frows" role="list">
            {more.map((f, i) => (
              <FileRow key={f.id || i} f={f} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
