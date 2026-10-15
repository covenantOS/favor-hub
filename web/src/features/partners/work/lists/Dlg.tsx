// The two dialogs the Work Center tabs open: the Work Center's own (wc-scrim and wc-dlg, from work.js) and the thank-you form's (wg-layer and
// wg-dlg, from thank.js). Both sit on the body, close with Escape or a press on the shade, and give focus back to what opened them.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BodyPortal } from '@/shell/BodyPortal';

function useDialogKeys(onClose: () => void, box: React.RefObject<HTMLElement | null>) {
  const back = useRef<Element | null>(null);
  useEffect(() => {
    back.current = document.activeElement;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', k, true);
    const f = box.current?.querySelector<HTMLElement>('[autofocus], input[type=text], textarea') || box.current?.querySelector<HTMLElement>('button.h-btn--primary');
    f?.focus();
    return () => {
      document.removeEventListener('keydown', k, true);
      if (back.current instanceof HTMLElement) {
        try {
          back.current.focus();
        } catch {
          // the opener is gone
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** The Work Center dialog: a centred card on a phone-width sheet from the bottom (work.css). */
export function WcDialog({ onClose, children, label, className }: { onClose: () => void; children: ReactNode; label: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  useDialogKeys(onClose, box);
  return BodyPortal(
    <div id="layer">
      <div className={'wc-scrim' + (on ? ' is-on' : '')} onClick={onClose} />
      <div ref={box} className={'wc-dlg' + (on ? ' is-on' : '') + (className ? ' ' + className : '')} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

/** The thank-you form's dialog (gifts.css): a card, or a sheet from the bottom on a phone. */
export function WgDialog({ onClose, children, label, wide, className }: { onClose: () => void; children: ReactNode; label: string; wide?: boolean; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useDialogKeys(onClose, box);
  return BodyPortal(
    <div className={'wg-layer' + (className ? ' ' + className : '')}>
      <div className="wg-scrim" onClick={onClose} />
      <div ref={box} className={'wg-dlg' + (wide ? ' wg-dlg--wide' : '')} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}
