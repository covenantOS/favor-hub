import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MI, isPhone } from './util';

/** A menu or small form: a popover under its button on a desktop, a bottom sheet on a phone. */
export function Sheet({ title, anchor, wide, onClose, children }: { title: string; anchor?: HTMLElement | null; wide?: boolean; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const pop = !!anchor && !isPhone();
  useEffect(() => {
    const el = box.current?.parentElement;
    const id = requestAnimationFrame(() => {
      el?.classList.add('is-in');
      const f = box.current?.querySelector<HTMLElement>('[autofocus], input:not([type=hidden]):not([type=checkbox]), select, textarea, button:not([data-close])');
      if (f && !isPhone()) f.focus({ preventScroll: true });
      else box.current?.focus({ preventScroll: true });
    });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener('keydown', key, true);
    };
  }, [onClose]);
  let style: React.CSSProperties | undefined;
  if (pop && anchor) {
    const r = anchor.getBoundingClientRect();
    style = { top: Math.max(8, Math.min(r.bottom + 6, innerHeight - 360)), left: Math.max(8, Math.min(r.left, innerWidth - 388)) };
  }
  return createPortal(
    <div className={'ml-sheet' + (pop ? ' ml-sheet--pop' : '') + (wide ? ' ml-sheet--wide' : '')}>
      <div className="ml-sheet__scrim" onClick={onClose} />
      <div className="ml-sheet__box" ref={box} role="dialog" aria-modal="true" tabIndex={-1} aria-label={title} style={style}>
        <div className="ml-sheet__head">
          <b>{title}</b>
          <button type="button" className="ml-iconbtn" onClick={onClose} aria-label="Close">
            <MI n="x" />
          </button>
        </div>
        <div className="ml-sheet__body">{children}</div>
      </div>
    </div>,
    document.body
  );
}

export interface ToastState {
  msg: string;
  undo?: () => void;
  ms: number;
  key: number;
}

export function Toast({ t, onDone }: { t: ToastState | null; onDone: () => void }) {
  useEffect(() => {
    if (!t) return;
    const id = setTimeout(onDone, t.ms);
    return () => clearTimeout(id);
  }, [t, onDone]);
  if (!t) return <div className="ml-toast" role="status" aria-live="polite" hidden />;
  return (
    <div
      key={t.key}
      className="ml-toast is-in"
      role="status"
      aria-live="polite"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-undo]') && t.undo) {
          t.undo();
          onDone();
        }
      }}
    >
      <span>{t.msg}</span>
      {t.undo && (
        <button type="button" data-undo>
          Undo
        </button>
      )}
    </div>
  );
}
