// A small menu under a button (table filter values, reading options, chat actions, the page's More menu), shared by every
// Brain view. One open at a time; Esc, a press outside or the back gesture closes it.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { BodyPortal } from '@/shell/BodyPortal';
import { hubOv } from '@/lib/hubOv';

export interface PopItem {
  v: string;
  label: ReactNode;
  on?: boolean;
  danger?: boolean;
  sep?: boolean;
  aside?: ReactNode;
  icon?: ReactNode;
}
interface PopState {
  anchor: HTMLElement;
  title?: string;
  items: PopItem[];
  pick: (v: string) => void;
}

let cur: PopState | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const pop = {
  open(anchor: HTMLElement, items: PopItem[], pick: (v: string) => void, title?: string) {
    cur = { anchor, items, pick, title };
    anchor.setAttribute('aria-expanded', 'true');
    emit();
  },
  close(refocus?: boolean) {
    if (!cur) return false;
    const a = cur.anchor;
    a.setAttribute('aria-expanded', 'false');
    cur = null;
    emit();
    if (refocus) a.focus();
    return true;
  },
  isOpen: () => !!cur,
};
const sub = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

export function PopLayer() {
  const s = useSyncExternalStore(sub, () => cur, () => null);
  const el = useRef<HTMLDivElement>(null);
  const [xy, setXy] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    if (!s || !el.current) return setXy(null);
    const r = s.anchor.getBoundingClientRect();
    const pw = el.current.offsetWidth;
    const ph = el.current.offsetHeight;
    const x = Math.max(10, Math.min(r.left, innerWidth - pw - 10));
    let y = r.bottom + 6;
    if (y + ph > innerHeight - 10) y = r.top - ph - 6 >= 10 ? r.top - ph - 6 : Math.max(10, innerHeight - ph - 10);
    setXy({ x, y: Math.max(10, y) });
    const first = el.current.querySelector<HTMLElement>('button.is-on') || el.current.querySelector<HTMLElement>('button');
    first?.focus();
  }, [s]);
  useEffect(() => {
    if (!s) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (el.current?.contains(t) || s.anchor.contains(t)) return;
      pop.close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        pop.close(true);
      }
    };
    addEventListener('pointerdown', down, true);
    addEventListener('keydown', key, true);
    const tok = hubOv.on(() => pop.close());
    return () => {
      removeEventListener('pointerdown', down, true);
      removeEventListener('keydown', key, true);
      hubOv.off(tok);
    };
  }, [s]);
  if (!s) return null;
  return BodyPortal(
    <div className="bc-root bc-portal--page">
      <div
        ref={el}
        className="pop"
        role="menu"
        style={{ left: xy ? xy.x : -9999, top: xy ? xy.y : -9999 }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          const bs = [...(el.current?.querySelectorAll('button') || [])];
          const i = bs.indexOf(document.activeElement as HTMLButtonElement);
          bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length]?.focus();
        }}
      >
        {s.title && <div className="pop__h">{s.title}</div>}
        {s.items.map((it, k) =>
          it.sep ? (
            <hr key={k} />
          ) : (
            <button
              key={k}
              type="button"
              role="menuitem"
              className={(it.on ? 'is-on' : '') + (it.danger ? ' danger' : '')}
              onClick={() => {
                const p = s.pick;
                pop.close();
                p(it.v);
              }}
            >
              {it.icon}
              {it.label}
              {it.aside != null && <span style={{ marginLeft: 'auto', color: 'var(--h-ink-3)', fontSize: 13 }}>{it.aside}</span>}
            </button>
          ),
        )}
      </div>
    </div>,
  );
}
