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

export function PartnerFind({ placeholder, onPick, autoFocus }: { placeholder: string; onPick: (h: PartnerHit) => void; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  const [hits, setHits] = useState<PartnerHit[]>([]);
  const [hi, setHi] = useState(-1);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const seq = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = text.trim();
    if (t.length < 2) {
      setOpen(false);
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const d = await workApi('/api/work/partners?wide=1&q=' + encodeURIComponent(t));
        if (mine !== seq.current) return;
        setHits(d.rows || []);
        setHi(d.rows && d.rows.length ? 0 : -1);
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
        {err ? (
          <li className="is-none">{err}</li>
        ) : hits.length ? (
          hits.map((h, i) => (
            <li key={h.cid} role="option" aria-selected={i === hi} className={i === hi ? 'is-hi' : ''}>
              <a
                href={'/work/partner/' + h.cid}
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
