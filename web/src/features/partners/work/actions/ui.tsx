// Small pieces every Work Center view shares: icons, the dialog and drawer frames, the toast, the selection bar and the skeleton.
// They draw the classic classes (src/styles/work.css and work-edit.css), so they look the way the classic page does.
import { useEffect, useRef, type ReactNode, type MouseEvent } from 'react';
import { BodyPortal } from '@/shell/BodyPortal';
import { hideToast, undoBatch } from './engine';
import { closeDialog, useWc } from './store';

// Inner path data of the 24x24 line icons (public/js/work.js I).
export const IC: Record<string, string> = {
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  letter: '<path d="M4 4h16v16H4z"/><path d="M8 9h8"/><path d="M8 13h8"/><path d="M8 17h5"/>',
  meet: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c.8-3.5 3.2-5.5 6-5.5s5.2 2 6 5.5"/><path d="M15.5 14.5c2.6 0 4.6 1.6 5.5 4.5"/>',
  task: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  clip: '<path d="M8 4h8v3H8z"/><path d="M6 6h12v15H6z"/><path d="M9 11h6"/><path d="M9 15h4"/>',
  paste: '<path d="M9 4h6v3H9z"/><path d="M7 5H5v16h14V5h-2"/><path d="M9 12h6"/><path d="M9 16h4"/>',
  many: '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M2.5 20c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5"/><path d="M13 16c.9-.4 1.9-.5 3-.5 2.5 0 4.7 1.5 5.5 4.5"/>',
  filter: '<path d="M4 6h16"/><path d="M7 12h10"/><path d="M10 18h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  ext: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  swap: '<path d="M4 8h13l-3-3"/><path d="M20 16H7l3 3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  send: '<path d="M21 3 3 11l7 3 3 7z"/><path d="m10 14 4-4"/>',
};
export const CAT_IC: Record<string, string> = { 'Phone call': 'phone', Email: 'mail', Mailing: 'letter', Meeting: 'meet', 'Task/Other': 'task' };

export function Ic({ n, cls }: { n: string; cls?: string }) {
  return <svg className={'h-i' + (cls ? ' ' + cls : '')} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: IC[n] || '' }} />;
}

/** A grey card shaped like the rows it stands for (public/js/work-tabs.js WCSkel), so a view never opens on a blank box. */
export function Skel({ rows = 6, id }: { rows?: number; id?: string }) {
  return (
    <section className="h-card wc-sheet wc-skelrows" aria-busy="true" id={id}>
      <div className="wc-skelbar">
        <i />
        <i />
        <i />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="wc-skelrow">
          <i className="a" />
          <i className="b" />
          <i className="c" />
        </div>
      ))}
    </section>
  );
}

function useReturnFocus() {
  useEffect(() => {
    const was = document.activeElement as HTMLElement | null;
    return () => {
      try {
        was?.focus?.();
      } catch {
        // the control is gone
      }
    };
  }, []);
}

/** The scrim and the box of a dialog. Esc and a press on the scrim close it. Children draw the head, body and foot (.wc-dlg__head ...). */
export function Dialog({ children, label, cls, onClose }: { children: ReactNode; label?: string; cls?: string; onClose?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const close = onClose || closeDialog;
  useReturnFocus();
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      el.classList.add('is-on');
      el.previousElementSibling?.classList.add('is-on');
      const f = el.querySelector<HTMLElement>('[autofocus]') || el.querySelector<HTMLElement>('button.h-btn--primary');
      f?.focus();
    });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.stopPropagation();
        close();
      }
      if (e.key === 'Tab' && box.current) {
        const f = Array.from(box.current.querySelectorAll<HTMLElement>('button, input, a[href], select, textarea')).filter((x) => !(x as HTMLButtonElement).disabled && x.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f[f.length - 1].focus();
        } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
          e.preventDefault();
          f[0].focus();
        }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', key, true);
    };
  }, [close]);
  return (
    <>
      <div className="wc-scrim" onClick={close} />
      <div ref={box} className={'wc-dlg' + (cls ? ' ' + cls : '')} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </>
  );
}

/** The right-hand drawer frame (the edit panel, the action drawer). */
export function Drawer({ children, label, cls, onClose }: { children: ReactNode; label: string; cls?: string; onClose?: () => void }) {
  const box = useRef<HTMLElement>(null);
  const close = onClose || closeDialog;
  useReturnFocus();
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      el.classList.add('is-on');
      el.previousElementSibling?.classList.add('is-on');
      (el.querySelector<HTMLElement>('[autofocus]') || el.querySelector<HTMLElement>('.wc-dlg__x'))?.focus();
    });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', key, true);
    };
  }, [close]);
  return (
    <>
      <div className="wc-scrim" onClick={close} />
      <aside ref={box} className={'wc-drawer' + (cls ? ' ' + cls : '')} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </aside>
    </>
  );
}

export function DialogHead({ title, sub, onClose, kicker }: { title: ReactNode; sub?: ReactNode; onClose?: () => void; kicker?: ReactNode }) {
  return (
    <div className="wc-dlg__head">
      <div>
        {kicker ? <span className="h-label">{kicker}</span> : null}
        <h2>{title}</h2>
        {sub ? <p>{sub}</p> : null}
      </div>
      <button type="button" className="wc-dlg__x" aria-label="Close" onClick={onClose || closeDialog}>
        <Ic n="x" />
      </button>
    </div>
  );
}

/** Where the open dialog, the toast and the progress bar draw: on the body, outside the page's blurred frame. */
export function WorkLayers() {
  const dialog = useWc((s) => s.dialog);
  return (
    <>
      <Toast />
      {BodyPortal(<div id="layer">{dialog ? <div key={dialog.id} style={{ display: 'contents' }}>{dialog.node}</div> : null}</div>)}
    </>
  );
}

function Toast() {
  const t = useWc((s) => s.toast);
  const undoing = useWc((s) => s.undoing);
  useEffect(() => {
    if (!t) return;
    const id = setTimeout(hideToast, t.bid ? 10000 : 5200);
    return () => clearTimeout(id);
  }, [t]);
  return BodyPortal(
    <div id="toast" className={'wc-toast' + (t ? ' is-on' : '') + (t?.bid ? ' wc-toast--undo' : '')} role="status" aria-live="polite">
      {t ? (
        <>
          <span className="ok">
            <Ic n="check" />
          </span>
          <span>{t.msg}</span>
          {t.bid ? (
            <button type="button" className="h-btn h-btn--ghost wc-undo-btn" title="Undo (Z)" aria-keyshortcuts="Z" disabled={undoing.has(t.bid)} aria-busy={undoing.has(t.bid)} onClick={() => void undoBatch(t.bid!)}>
              <Ic n="undo" />
              {undoing.has(t.bid) ? 'Undoing…' : 'Undo'}
              {undoing.has(t.bid) ? null : <kbd>Z</kbd>}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * The bar at the foot of the window. While a batch is sending it shows the progress; otherwise it shows its children (the view's
 * selection buttons) when there are any. A view with nothing selected passes null.
 */
export function ActionBar({ children, label }: { children: ReactNode | null; label?: string }) {
  const busy = useWc((s) => s.busy);
  const on = !!busy || !!children;
  useEffect(() => {
    document.body.classList.toggle('has-bar', on);
    return () => document.body.classList.remove('has-bar');
  }, [on]);
  const pct = busy ? Math.max(4, Math.round((busy.done / Math.max(1, busy.total)) * 100)) : 4;
  return BodyPortal(
    <div id="bar" className={'wc-bar' + (on ? ' is-on' : '') + (busy ? ' is-busy' : '')} role="region" aria-label={label || 'Selected actions'}>
      {busy ? (
        <span className="wc-bar__prog">
          <span id="prog-l">{busy.text || (busy.done ? `${busy.done} of ${busy.total} sent to Blackbaud` : busy.label)}</span>
          <span className="wc-bar__track">
            <i id="prog-i" style={{ width: pct + '%' }} />
          </span>
        </span>
      ) : (
        children
      )}
    </div>
  );
}

export const stop = (e: MouseEvent) => e.stopPropagation();
