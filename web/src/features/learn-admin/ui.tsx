// Small pieces both Learn admin pages use: icons, the status chip, the dialog the back gesture and Escape both close, the confirm box, the
// toast and the "could not load" panel. Same class names as the Astro page (src/styles/learn.css).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { BodyPortal } from '@/shell/BodyPortal';
import { hubOv } from '@/lib/hubOv';
import { STATUS } from './logic';

const IC: Record<string, string> = {
  video: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/>',
  article: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21a2 2 0 0 1 2-2h13v2"/><path d="M8 7h7"/><path d="M8 11h5"/>',
  doc: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  page: '<path d="M6 3h12v18H6z"/><path d="M9 8h6"/><path d="M9 12h6"/><path d="M9 16h4"/>',
  clip: '<rect x="3" y="8" width="14" height="11" rx="2"/><path d="M7 5h12a2 2 0 0 1 2 2v9"/><path d="m8.5 11.5 4 2-4 2z"/>',
  link: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>',
  quiz: '<path d="m9 11 3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h9"/>',
  course: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21a2 2 0 0 1 2-2h13v2"/><path d="M8 7h7"/><path d="M8 11h5"/>',
  path: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>',
  grip: '<path d="M9 6h.01"/><path d="M15 6h.01"/><path d="M9 12h.01"/><path d="M15 12h.01"/><path d="M9 18h.01"/><path d="M15 18h.01"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  cam: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
};

/** An icon from the fixed set above (static markup written in this file, never data from the server). */
export function Svg({ n, className, style }: { n: string; className?: string; style?: CSSProperties }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={className} style={style} dangerouslySetInnerHTML={{ __html: IC[n] || '' }} />;
}

export function ColorTile({ color, icon, sm }: { color?: string; icon: string; sm?: boolean }) {
  return (
    <span className={'ln-tile' + (sm ? ' ln-tile--sm' : '') + ' ln-c--' + (color || 'leaf')}>
      <Svg n={icon} />
    </span>
  );
}

export function StatusChip({ status }: { status: string }) {
  return <span className={'ln-chip' + (status === 'published' ? ' ln-chip--ok' : status === 'archived' ? '' : ' ln-chip--due')}>{STATUS[status] || status}</span>;
}

/** The skeleton the Astro page drew while it loaded: a title and two cards of the final height. */
export function PageSkeleton({ title }: { title: string }) {
  return (
    <>
      <div className="ln-head">
        <div>
          <h1>{title}</h1>
        </div>
      </div>
      <div className="ln-list">
        <div className="ln-card ln-skel h-skel" />
        <div className="ln-card ln-skel h-skel" />
      </div>
    </>
  );
}

/** The page frame: .ln with its view name. */
export function Frame({ view, busy, children }: { view: 'admin' | 'editor'; busy?: boolean; children: ReactNode }) {
  return (
    <div className="ln" id="ln" data-view={view} aria-busy={busy ? true : undefined}>
      {children}
    </div>
  );
}

/** What the page shows when its first read did not come back. */
export function FailView({ status, message }: { status: number; message: string }) {
  return (
    <div className="ln-empty" role="alert">
      <b>{status === 403 ? 'Managing learning is for admins and HR' : 'That did not load'}</b>
      <p>{message || 'Try again.'}</p>
      <div className="ln-chips">
        <button type="button" className="h-btn h-btn--primary" onClick={() => window.location.reload()}>
          Try again
        </button>
        <a className="h-btn h-btn--ghost" href="/learn/">
          My learning
        </a>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ toast */

let toastEl: HTMLDivElement | null = null;
let toastT: ReturnType<typeof setTimeout> | undefined;
/** The hub's own toast when it is loaded, otherwise a small one of ours. Browser only (call it from handlers). */
export function toast(msg: string): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { hubToast?: (m: string) => void };
  if (w.hubToast) {
    w.hubToast(msg);
    return;
  }
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'ln-toast';
    toastEl.setAttribute('role', 'status');
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => {
    if (toastEl) toastEl.hidden = true;
  }, 3400);
}

/* ------------------------------------------------------------------------------------------------ dialog */

function DialogInner({ cls, label, onClose, children }: { cls?: string; label?: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.open) el.showModal();
    const first = el.querySelector<HTMLElement>('[data-autofocus]');
    if (first) first.focus();
    // The back gesture closes the dialog; closing it any other way takes its history entry away again.
    const tok = hubOv.on(() => closeRef.current());
    return () => {
      hubOv.off(tok);
      try {
        el.close();
      } catch {
        // not open
      }
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={'ln-dlg' + (cls ? ' ' + cls : '')}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        closeRef.current();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeRef.current();
      }}
    >
      {children}
    </dialog>
  );
}

/** A modal dialog drawn into the page body after the first render, so the server and browser copies agree. */
export function Dialog(p: { cls?: string; label?: string; onClose: () => void; children: ReactNode }) {
  return BodyPortal(<DialogInner {...p} />);
}

export interface ConfirmAsk {
  title: string;
  text: string;
  ok: string;
  danger?: boolean;
}
/** confirm(...) resolves true on the button and false on Cancel, Escape or a click outside. `node` goes anywhere in the page. */
export function useConfirm(): { confirm: (a: ConfirmAsk) => Promise<boolean>; node: ReactNode } {
  const [ask, setAsk] = useState<(ConfirmAsk & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = (a: ConfirmAsk) => new Promise<boolean>((resolve) => setAsk({ ...a, resolve }));
  const done = (v: boolean) => {
    if (!ask) return;
    ask.resolve(v);
    setAsk(null);
  };
  const node = ask ? (
    <Dialog onClose={() => done(false)} label={ask.title}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          done(true);
        }}
      >
        <h2>{ask.title}</h2>
        <p>{ask.text}</p>
        <div className="ln-dlg__acts">
          <button type="button" className="h-btn h-btn--ghost" data-no="" onClick={() => done(false)}>
            Cancel
          </button>
          <button type="submit" className={'h-btn ' + (ask.danger ? 'h-btn--warn' : 'h-btn--primary')} data-yes="" data-autofocus="">
            {ask.ok}
          </button>
        </div>
      </form>
    </Dialog>
  ) : null;
  return { confirm, node };
}

/** A line of red text inside a dialog for the server's reason a save did not go through. */
export function DialogError({ id, text }: { id: string; text: string }) {
  return (
    <p className="ln-sum" id={id} role="alert" hidden={!text}>
      {text}
    </p>
  );
}
