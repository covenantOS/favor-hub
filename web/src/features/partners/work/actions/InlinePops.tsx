// The small pop-overs on a row of the Open actions list: change the due date, the status or who it belongs to (public/js/work-edit.js
// inline). Each saves as one batch through sendChange, and shows the change at once on the row (the overlay) until Blackbaud has it.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { sendChange, toast } from './engine';
import { openNext } from './EditDialogs';
import { addDays } from './model';
import type { Work } from './model';
import { dropOverlay, setGone, setOverlay } from './store';
import { Ic } from './ui';

export interface PopState {
  kind: 'due' | 'status' | 'who';
  id: string;
  rect: { left: number; top: number; bottom: number };
}

const nextMonday = (today: string) => {
  let d = addDays(today, 1);
  while (new Date(d + 'T12:00:00Z').getUTCDay() !== 1) d = addDays(d, 1);
  return d;
};

/** A small box under a button (class ep-pop): placed under the anchor or above it when there is no room. Esc and a press outside close it. */
export function AnchoredPop({ rect, onClose, children, className, keep }: { rect: PopState['rect']; onClose: () => void; children: ReactNode; className?: string; keep?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -999, top: 0 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const width = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({
      left: Math.max(8, Math.min(window.innerWidth - width - 8, rect.left)),
      top: rect.bottom + h + 8 > window.innerHeight ? Math.max(8, rect.top - h - 6) : rect.bottom + 6,
    });
    const first = el.querySelector<HTMLElement>('input, button');
    if (first && !window.matchMedia('(pointer: coarse)').matches) first.focus();
    const off = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!el.contains(t) && !(keep && t.closest(keep))) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', off);
      document.removeEventListener('keydown', key, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rect.left, rect.top, rect.bottom]);
  return createPortal(
    <div ref={box} className={'ep-pop' + (className ? ' ' + className : '')} style={{ left: pos.left, top: pos.top }}>
      {children}
    </div>,
    document.body
  );
}

export function InlinePop({ pop, w, onClose }: { pop: PopState; w: Work; onClose: () => void }) {
  const a = w.byId[pop.id];
  if (!a) return null;
  const c = w.cur(a);
  const today = w.today;
  const body =
    pop.kind === 'due' ? (
      <DuePop w={w} id={pop.id} today={today} cur={c.due} onClose={onClose} />
    ) : pop.kind === 'status' ? (
      <StatusPop id={pop.id} onClose={onClose} />
    ) : (
      <WhoPop w={w} id={pop.id} cur={c.f} onClose={onClose} />
    );
  return (
    <AnchoredPop rect={pop.rect} onClose={onClose} keep="[data-inl]">
      {body}
    </AnchoredPop>
  );
}

function DuePop({ w, id, today, cur, onClose }: { w: Work; id: string; today: string; cur: string; onClose: () => void }) {
  const a = w.byId[id];
  const go = (v: string) => {
    onClose();
    if (!v || v === cur) return;
    setOverlay(id, { due: v });
    void sendChange(
      { op: 'edit', ids: [id], set: { date: v }, seen: { date: a.due } },
      {
        label: `Moved to ${w.fd(v)}`,
        revert: () => dropOverlay(id, 'due'),
        say: (_s, _t, cf) => {
          if (cf) toast('Someone changed that date in Blackbaud. Open the action to see it.');
        },
      }
    );
  };
  const chips: [string, string][] = [
    ['Today', today],
    ['Tomorrow', addDays(today, 1)],
    ['+1 week', addDays(today, 7)],
    ['+2 weeks', addDays(today, 14)],
    ['Next Monday', nextMonday(today)],
    ['+1 month', addDays(today, 30)],
  ];
  return (
    <>
      <b className="lab">Due</b>
      <div className="ep-pop__chips">
        {chips.map(([l, v]) => (
          <button key={l} type="button" onClick={() => go(v)}>
            {l}
          </button>
        ))}
      </div>
      <input type="date" defaultValue={cur} aria-label="Due date" onChange={(e) => go(e.target.value)} />
    </>
  );
}

function StatusPop({ id, onClose }: { id: string; onClose: () => void }) {
  const finish = (st: 'Completed' | 'Canceled') => {
    onClose();
    setGone([id], true);
    void sendChange({ op: 'edit', ids: [id], set: { status: st } }, { label: st === 'Completed' ? 'Marked complete' : 'Canceled', revert: () => setGone([id], false) });
  };
  return (
    <>
      <b className="lab">Status</b>
      <div className="ep-pop__list">
        <button type="button" onClick={() => finish('Completed')}>
          <Ic n="check" />
          Completed today
        </button>
        <button
          type="button"
          onClick={() => {
            onClose();
            openNext(id);
          }}
        >
          <Ic n="cal" />
          Completed, schedule the next
        </button>
        <button type="button" onClick={() => finish('Canceled')}>
          <Ic n="x" />
          Canceled
        </button>
        <button type="button" onClick={onClose}>
          Keep it open
        </button>
      </div>
    </>
  );
}

function WhoPop({ w, id, cur, onClose }: { w: Work; id: string; cur: string[]; onClose: () => void }) {
  const a = w.byId[id];
  const [q, setQ] = useState('');
  const list = Object.keys(w.idx.people).filter(w.live).filter(w.mayAssign).sort((x, y) => w.P(x).n.localeCompare(w.P(y).n));
  const pick = (f: string, shift: boolean) => {
    onClose();
    const next = shift ? (cur.includes(f) ? cur.filter((x) => x !== f) : cur.concat([f])) : [f];
    const prev = cur;
    setOverlay(id, { f: next });
    void sendChange(
      { op: 'edit', ids: [id], set: { fundraisers: next }, seen: { fundraisers: a.f } },
      { label: `Given to ${next.map((x) => w.P(x).n).join(', ')}`, revert: () => setOverlay(id, { f: prev }) }
    );
  };
  return (
    <>
      <b className="lab">Who it belongs to</b>
      <input type="search" placeholder="Find a person" aria-label="Find a person" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="ep-pop__list ep-pop__people">
        {list
          .filter((f) => (w.P(f).n + ' ' + (w.P(f).team || '')).toLowerCase().includes(q.toLowerCase()))
          .map((f) => (
            <button key={f} type="button" className={cur.includes(f) ? 'is-on' : ''} onClick={(e) => pick(f, e.shiftKey)}>
              {w.P(f).n}
              <span>{w.P(f).team || ''}</span>
            </button>
          ))}
      </div>
      <small>Shift-click adds a person alongside.</small>
    </>
  );
}
