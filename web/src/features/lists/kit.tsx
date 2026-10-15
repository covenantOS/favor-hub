// Small pieces the three Lists pages share: the message at the bottom of the page, a number that rolls to its new value, the one open
// popover, and the registration of the "Open in Google Sheets" button. The popover and the roll read the browser only after the page has
// drawn, so what the server sends and what the browser first draws are the same.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { BodyPortal } from '@/shell/BodyPortal';
import { loadScript } from '@/lib/legacy';

// ---- the message at the bottom (.rp-toast) ----
export function useToast(ms = 3800) {
  const [msg, setMsg] = useState('');
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const toast = useCallback(
    (m: string) => {
      setMsg(m);
      setOn(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setOn(false), ms);
    },
    [ms]
  );
  return { toast, msg, on };
}

export function Toast({ id, msg, on }: { id: string; msg: string; on: boolean }) {
  return (
    <div className={'rp-toast' + (on ? ' is-on' : '')} id={id} role="status">
      {msg}
    </div>
  );
}

// ---- a number that rolls to its new value (public/js/hub-flow.js does this on classic pages) ----
// Only the digits that changed move, up when the number grows and down when it shrinks. The text stays the plain number the whole time.
const plainNum = (t: string): number | null => {
  const s = t.trim();
  if (!/\d/.test(s) || !/^[^\d]{0,2}[\d,.]+[^\d]{0,2}$/.test(s)) return null;
  const n = Number(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
};

export function RollNumber({ text }: { text: string }) {
  const last = useRef(text);
  const [roll, setRoll] = useState<{ from: string; to: string } | null>(null);
  useEffect(() => {
    const from = last.current;
    last.current = text;
    if (from === text) return;
    const a = plainNum(from);
    const b = plainNum(text);
    if (a == null || b == null || a === b || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setRoll({ from, to: text });
    const t = setTimeout(() => setRoll(null), 420);
    return () => clearTimeout(t);
  }, [text]);
  if (!roll || roll.to !== text) return <>{text}</>;
  const up = (plainNum(roll.to) as number) > (plainNum(roll.from) as number);
  // Line the two up from the right, so 99 to 100 rolls every place and 1,204 to 1,205 rolls only the last digit.
  const pad = Math.max(0, roll.to.length - roll.from.length);
  const old = ' '.repeat(pad) + roll.from.slice(Math.max(0, roll.from.length - roll.to.length));
  return (
    <span className="hf">
      {Array.from(roll.to).map((c, i) =>
        c !== old[i] && /\d/.test(c) ? (
          <span className="hf-d" key={i}>
            <span className={'hf-i ' + (up ? 'hf-up' : 'hf-dn')} data-was={old[i] && /\d/.test(old[i]) ? old[i] : ''}>
              {c}
            </span>
          </span>
        ) : (
          c
        )
      )}
    </span>
  );
}

// ---- the one open popover ----
// A popover is a small box under the button that opened it (a sheet on a phone). One is open at a time; pressing outside it or Escape
// closes it, and pressing its button again closes it too.
const PopCtx = createContext<{ id: string | null; set: (id: string | null) => void }>({ id: null, set: () => {} });

export function PopProvider({ children }: { children: ReactNode }) {
  const [id, set] = useState<string | null>(null);
  return <PopCtx.Provider value={{ id, set }}>{children}</PopCtx.Provider>;
}

/** Open state and the toggle for the popover named `id`. */
export function usePop(id: string) {
  const c = useContext(PopCtx);
  return { open: c.id === id, toggle: () => c.set(c.id === id ? null : id), close: () => c.set(null) };
}

interface PopProps {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}

/** The box mounts after the page has hydrated (BodyPortal), then places itself next to its button. */
export const Popover = (props: PopProps) => BodyPortal(<PopBox {...props} />);

function PopBox({ anchor, onClose, children }: PopProps) {
  const box = useRef<HTMLDivElement>(null);
  const closer = useRef(onClose);
  closer.current = onClose;
  useLayoutEffect(() => {
    const a = anchor.current;
    const p = box.current;
    if (!a || !p) return;
    const r = a.getBoundingClientRect();
    if (window.innerWidth <= 860) {
      p.classList.add('is-sheet');
      return;
    }
    const w = Math.min(340, window.innerWidth - 16);
    p.style.width = w + 'px';
    p.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
    const below = window.innerHeight - r.bottom;
    p.style.top = (below > 300 || below > r.top ? r.bottom + 6 : Math.max(8, r.top - 6 - p.offsetHeight)) + 'px';
  }, [anchor]);
  useEffect(() => {
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (box.current && !box.current.contains(t) && !(anchor.current && anchor.current.contains(t))) closer.current();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const a = anchor.current;
        closer.current();
        a?.focus();
      }
    };
    // Attached a tick later so the press that opened the box does not close it.
    const t = setTimeout(() => {
      document.addEventListener('mousedown', outside, true);
      document.addEventListener('keydown', esc, true);
      box.current?.querySelector('input')?.focus();
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('keydown', esc, true);
    };
  }, [anchor]);
  return (
    <div className="ls-pop" role="dialog" ref={box}>
      {children}
    </div>
  );
}

// ---- Open in Google Sheets ----
// public/js/sheets.js runs the export for any button marked data-sheets="<name>"; this registers what the button sends.
export function useSheets(name: string, build: () => Promise<unknown>) {
  const latest = useRef(build);
  latest.current = build;
  useEffect(() => {
    let live = true;
    loadScript('/js/sheets.js?v=2')
      .then(() => {
        const fs = (window as unknown as { FavorSheets?: { register: (n: string, f: () => unknown) => void } }).FavorSheets;
        if (live && fs) fs.register(name, () => latest.current());
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [name]);
}
