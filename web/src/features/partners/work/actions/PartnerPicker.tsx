// Find a partner by name, email, phone or lookup id (public/js/partner.js search): a box with a list under it. Reads
// GET /api/work/partners?wide=1&q=. Arrow keys move, Enter picks, Esc closes the list.
import { useEffect, useRef, useState } from 'react';
import { wcApi } from './api';

export interface PartnerHit {
  cid: string;
  name: string;
  place: string;
  lookup: string;
  holders: string[];
  deceased?: boolean;
}

/** Search partners. owner narrows the match to that fundraiser's portfolio first (Entry). */
export async function searchPartners(q: string, opts: { owner?: string; wide?: boolean } = {}): Promise<PartnerHit[]> {
  const out = await wcApi<{ rows: PartnerHit[] }>('/api/work/partners?' + (opts.wide === false ? '' : 'wide=1&') + 'q=' + encodeURIComponent(q) + (opts.owner ? '&owner=' + encodeURIComponent(opts.owner) : ''));
  return out.rows || [];
}

export function PartnerPicker(p: { onPick: (h: PartnerHit) => void; placeholder?: string; autoFocus?: boolean; clearOnPick?: boolean }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PartnerHit[]>([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const [err, setErr] = useState('');
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', off);
    return () => document.removeEventListener('click', off);
  }, []);
  const type = (v: string) => {
    setQ(v);
    clearTimeout(timer.current);
    const t = v.trim();
    if (t.length < 2) {
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      const mine = ++seq.current;
      try {
        const rows = await searchPartners(t);
        if (mine !== seq.current) return;
        setHits(rows);
        setHi(rows.length ? 0 : -1);
        setErr('');
      } catch (e) {
        if (mine !== seq.current) return;
        setHits([]);
        setErr((e as Error).message);
      }
      setOpen(true);
    }, 200);
  };
  const pick = (h: PartnerHit) => {
    setOpen(false);
    if (p.clearOnPick !== false) setQ('');
    p.onPick(h);
  };
  return (
    <div className="pv-find" ref={box}>
      <label className="pv-find__box">
        <svg className="h-i" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          placeholder={p.placeholder || 'Find a partner'}
          autoComplete="off"
          aria-label="Find a partner"
          autoFocus={p.autoFocus}
          value={q}
          onChange={(e) => type(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && hits.length) {
              e.preventDefault();
              setHi((hi + 1) % hits.length);
            } else if (e.key === 'ArrowUp' && hits.length) {
              e.preventDefault();
              setHi((hi - 1 + hits.length) % hits.length);
            } else if (e.key === 'Enter' && hits[hi]) {
              e.preventDefault();
              pick(hits[hi]);
            } else if (e.key === 'Escape' && open) {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
      </label>
      <ul className="pv-find__list" role="listbox" hidden={!open}>
        {err ? (
          <li className="is-none">{err}</li>
        ) : hits.length ? (
          hits.map((h, i) => (
            <li key={h.cid} role="option" aria-selected={i === hi} className={i === hi ? 'is-hi' : ''}>
              <a
                href={'/work/partner/' + h.cid}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  pick(h);
                }}
              >
                <b>{h.name}</b>
                <span>
                  {h.place || 'No city on file'} · {h.lookup}
                  {h.deceased ? ' · deceased' : ''}
                </span>
              </a>
            </li>
          ))
        ) : (
          <li className="is-none">No partner found.</li>
        )}
      </ul>
    </div>
  );
}
