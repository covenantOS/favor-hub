// The "Find the partner" box on a row that matched no record. Typing two letters or more lists partners under the box (Blackbaud's names,
// narrowed to this fundraiser's portfolio first); pressing one picks that record for the row. Ports the data-ta handlers in work.js.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { norm } from '../model';
import { searchPartners, type PartnerHit } from '../PartnerPicker';
import { rememberHits } from './edits';
import { nameGuess } from './logic';

let closeActive: (() => void) | null = null;

interface Pop {
  hits: PartnerHit[];
  left: number;
  top: number;
  width: number;
}

export function FindBox({ rowId, name, owner, nameOf, onPick }: { rowId: string; name: string; owner: string; nameOf: (fid: string) => string; onPick: (cid: string) => void }) {
  const [val, setVal] = useState(() => nameGuess(name));
  const [pop, setPop] = useState<Pop | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const seq = useRef(0);
  const close = () => setPop(null);

  useEffect(() => {
    if (!pop) return;
    const click = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.wc-ta, #wc-pop')) close();
    };
    const scroll = (e: Event) => {
      if (!(e.target instanceof Element && e.target.closest('#wc-pop'))) close();
    };
    document.addEventListener('click', click, true);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('click', click, true);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [pop]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const run = (v: string) => {
    clearTimeout(timer.current);
    if (norm(v).length < 2) {
      close();
      return;
    }
    timer.current = setTimeout(async () => {
      const mine = ++seq.current;
      let hits: PartnerHit[] = [];
      try {
        hits = await searchPartners(v, { owner, wide: false });
        rememberHits(hits);
      } catch {
        // no list
      }
      const el = input.current;
      if (!el || mine !== seq.current) return;
      const r = el.getBoundingClientRect();
      if (closeActive && closeActive !== close) closeActive();
      closeActive = close;
      setPop({ hits, left: Math.round(r.left), top: Math.round(r.bottom + 4), width: Math.max(280, Math.round(r.width)) });
    }, 220);
  };

  return (
    <div className="wc-ta">
      <input
        ref={input}
        type="search"
        placeholder="Find the partner"
        data-ta={rowId}
        value={val}
        aria-label={'Find the partner for ' + name}
        autoComplete="off"
        onChange={(e) => {
          setVal(e.target.value);
          run(e.target.value);
        }}
        onFocus={() => {
          if (val.length > 1) run(val);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && pop) {
            e.stopPropagation();
            close();
          }
        }}
      />
      {pop
        ? createPortal(
            <div id="wc-pop" className="wc-ta__list wc-pop" style={{ position: 'fixed', left: pop.left, top: pop.top, width: pop.width, zIndex: 120 }}>
              {pop.hits.length ? (
                pop.hits.map((h) => (
                  <button
                    key={h.cid}
                    type="button"
                    data-tapick={rowId}
                    data-cid={h.cid}
                    onClick={() => {
                      close();
                      onPick(h.cid);
                    }}
                  >
                    {h.name}
                    <span>
                      {h.place || 'no city'} · {h.lookup}
                      {h.holders.length ? ' · ' + h.holders.map(nameOf).join(', ') : ''}
                    </span>
                  </button>
                ))
              ) : (
                <button type="button" disabled>
                  No partner by that name. Add the record in Blackbaud, then find it here.
                </button>
              )}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
