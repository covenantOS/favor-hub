// Help search: every article's title, summary, headings and text. The index (/help/search.json, built with the Astro site) is read the
// first time the box is focused or typed in. Nothing here touches the browser while drawing.
import { Fragment, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { NavLink } from '@/shell/NavLink';
import { useGo } from './nav';

interface Item {
  kind: string;
  url: string;
  title: string;
  summary: string;
  topic: string;
  heads: string[];
  text: string;
  _t: string;
  _s: string;
  _h: string;
  _x: string;
}

const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'on', 'how', 'do', 'i', 'my', 'is', 'and', 'or', 'for', 'what', 'can', 'it', 'with', 'where']);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9$.' ]+/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));

let index: Promise<Item[]> | null = null;
function loadIndex(): Promise<Item[]> {
  return (index ??= fetch('/help/search.json', { credentials: 'same-origin' })
    .then((r) => r.json())
    .then((d: Array<Omit<Item, '_t' | '_s' | '_h' | '_x'>>) =>
      // The training videos are being retired, so only articles are searched.
      d.filter((x) => x.kind === 'doc').map((x) => ({ ...x, _t: x.title.toLowerCase(), _s: x.summary.toLowerCase(), _h: x.heads.join(' ').toLowerCase(), _x: x.text.toLowerCase() })),
    )
    .catch(() => [] as Item[]));
}

function score(item: Item, ws: string[]): number {
  let total = 0;
  for (const w of ws) {
    let s = 0;
    if (item._t.includes(w)) s += item._t.split(/\W+/).some((t) => t.startsWith(w)) ? 12 : 8;
    if (item._h.includes(w)) s += 5;
    if (item._s.includes(w)) s += 4;
    const n = item._x.split(w).length - 1;
    if (n) s += Math.min(6, 1 + n * 0.6);
    if (!s) return 0;
    total += s;
  }
  return total + 0.5;
}

function snippet(item: Item, ws: string[]): ReactNode {
  const t = item.text;
  let at = -1;
  for (const w of ws) {
    at = item._x.indexOf(w);
    if (at >= 0) break;
  }
  if (at < 0) return item.summary;
  const start = Math.max(0, at - 60);
  const s = (start ? '...' : '') + t.slice(start, at + 140) + (at + 140 < t.length ? '...' : '');
  const re = new RegExp('(' + ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig');
  return s.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>));
}

export function SearchBox() {
  const [value, setValue] = useState('');
  const [hits, setHits] = useState<Array<{ item: Item; ws: string[] }> | null>(null);
  const [picked, setPicked] = useState(0);
  const [miss, setMiss] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef(0);
  const go = useGo();

  const run = useCallback(async (text: string) => {
    const q = text.trim();
    if (q.length < 2) {
      setHits(null);
      return;
    }
    const idx = await loadIndex();
    const ws = words(q);
    if (!ws.length) return;
    const found = idx
      .map((item) => [item, score(item, ws)] as const)
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([item]) => ({ item, ws }));
    setPicked(0);
    setMiss(q);
    setHits(found);
  }, []);

  useEffect(() => {
    // The hub's own / search is replaced by this box on the help page.
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === '/' && !(e.target as HTMLElement | null)?.closest?.('input,textarea,select,[contenteditable]')) {
        e.preventDefault();
        e.stopPropagation();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', key, true);
    const pre = new URLSearchParams(location.search).get('q');
    if (pre) {
      setValue(pre);
      void run(pre);
    }
    return () => window.removeEventListener('keydown', key, true);
  }, [run]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setValue('');
      void run('');
      return;
    }
    if (!hits || !hits.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = (picked + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
      setPicked(n);
      document.querySelectorAll('#hd-results .hd-hit')[n]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(hits[picked].item.url);
    }
  };

  return (
    <>
      <div className="hd-search" role="search">
        <svg className="h-i" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={input}
          id="hd-q"
          type="search"
          placeholder="Search articles"
          autoComplete="off"
          aria-label="Search the help docs"
          aria-controls="hd-results"
          value={value}
          onFocus={() => void loadIndex()}
          onChange={(e) => {
            const v = e.target.value;
            setValue(v);
            clearTimeout(timer.current);
            timer.current = window.setTimeout(() => void run(v), 90);
          }}
          onKeyDown={onKey}
        />
        <kbd>/</kbd>
      </div>
      <div className="hd-results" id="hd-results" role="region" aria-live="polite" hidden={hits === null}>
        {hits && hits.length > 0
          ? hits.map(({ item, ws }, i) => (
              <NavLink key={item.url} className={`hd-hit${i === picked ? ' is-on' : ''}`} href={item.url}>
                <span className="hd-hit__kind hd-hit__kind--doc">Article</span>
                <b>{item.title}</b>
                <small>{item.topic}</small>
                <span className="hd-hit__snip">{snippet(item, ws)}</span>
              </NavLink>
            ))
          : hits && (
              <div className="hd-nohit">
                <b>Nothing matches "{miss}".</b>
                <span>
                  Try another word, or{' '}
                  <button type="button" className="hd-linkbtn" data-feedback="help" data-title="What were you looking for?">
                    tell us what you were looking for
                  </button>
                  .
                </span>
              </div>
            )}
      </div>
    </>
  );
}
