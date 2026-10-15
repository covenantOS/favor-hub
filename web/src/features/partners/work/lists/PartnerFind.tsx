// A partner finder: a search box with a list under it (name, email, phone or lookup id). The Work Center's own finder
// (FavorPartner.search in partner.js) reads the same route, GET /api/work/partners?wide=1&q=.
import { useEffect, useRef, useState } from 'react';
import { Ic } from './icons';
import { workApi } from './core';

export interface PartnerHit {
  cid: string;
  name: string;
  place?: string;
  lookup?: string;
  deceased?: boolean;
}

// The last eight partners opened in this browser (localStorage, written by the partner page and drawer), shown when the box is focused.
const RECENT_KEY = 'favor.hub.recent.v1';
function recent(): PartnerHit[] {
  try {
    const a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(a) ? a.filter((x) => x && x.cid).slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function PartnerFind({ placeholder, onPick, autoFocus }: { placeholder: string; onPick: (h: PartnerHit) => void; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  const [hits, setHits] = useState<PartnerHit[]>([]);
  const [hi, setHi] = useState(-1);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const [head, setHead] = useState('');
  const seq = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = text.trim();
    if (t.length < 2) {
      // A short text shows the recent partners while the box has the focus (the list is empty until then).
      seq.current++;
      const r = recent();
      if (r.length && box.current?.contains(document.activeElement)) {
        setHits(r);
        setHi(-1);
        setErr('');
        setHead('Recent partners');
        setOpen(true);
      } else {
        setHead('');
        setOpen(false);
      }
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const d = await workApi('/api/work/partners?wide=1&q=' + encodeURIComponent(t));
        if (mine !== seq.current) return;
        setHits(d.rows || []);
        setHi(d.rows && d.rows.length ? 0 : -1);
        setHead('');
        setErr('');
        setOpen(true);
      } catch (e) {
        if (mine !== seq.current) return;
        setErr((e as Error).message);
        setOpen(true);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [text]);
  useEffect(() => {
    const off = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', off);
    return () => document.removeEventListener('click', off);
  }, []);
  const pick = (h: PartnerHit) => {
    setOpen(false);
    setText('');
    onPick(h);
  };
  return (
    <div className="pv-find" ref={box}>
      <label className="pv-find__box">
        <Ic n="search" />
        <input
          type="search"
          placeholder={placeholder}
          autoComplete="off"
          aria-label="Find a partner"
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => {
            if (text.trim().length >= 2) return;
            const r = recent();
            if (!r.length) {
              setOpen(false);
              return;
            }
            seq.current++;
            setHits(r);
            setHi(-1);
            setErr('');
            setHead('Recent partners');
            setOpen(true);
          }}
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
            } else if (e.key === 'Escape') setOpen(false);
          }}
        />
      </label>
      <ul className="pv-find__list" role="listbox" hidden={!open}>
        {head ? (
          <li className="pv-find__head" role="presentation">
            {head}
          </li>
        ) : null}
        {err ? (
          <li className="is-none">{err}</li>
        ) : hits.length ? (
          hits.map((h, i) => (
            <li key={h.cid} role="option" aria-selected={i === hi} className={i === hi ? 'is-hi' : ''}>
              <a
                href={'/work/partner/' + h.cid}
                data-i={i}
                onClick={(e) => {
                  e.preventDefault();
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
