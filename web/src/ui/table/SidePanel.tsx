// The side panel beside a list (src/styles/ptable.css .pt-side): one record's details without leaving the list. Esc and the scrim close it;
// the up and down buttons (and j and k inside it) step through the list's rows.
import { useEffect, useRef, type ReactNode } from 'react';
import { BodyPortal } from '@/shell/BodyPortal';

export function SidePanel(p: { open: boolean; title: ReactNode; sub?: ReactNode; kicker?: ReactNode; onClose: () => void; onPrev?: () => void; onNext?: () => void; foot?: ReactNode; children: ReactNode; label: string }) {
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!p.open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') p.onClose();
      const typing = /^(input|textarea|select)$/i.test((e.target as HTMLElement).tagName);
      if (typing) return;
      if ((e.key === 'j' || e.key === 'ArrowDown') && p.onNext) { e.preventDefault(); p.onNext(); }
      if ((e.key === 'k' || e.key === 'ArrowUp') && p.onPrev) { e.preventDefault(); p.onPrev(); }
    };
    document.addEventListener('keydown', k);
    box.current?.focus();
    return () => document.removeEventListener('keydown', k);
  }, [p.open, p.onClose, p.onNext, p.onPrev]);
  return BodyPortal(
    <>
      <div className={'pt-scrim' + (p.open ? ' is-on' : '')} onClick={p.onClose} aria-hidden="true" />
      <aside ref={box} tabIndex={-1} className={'pt-side' + (p.open ? ' is-on' : '')} role="dialog" aria-modal="true" aria-label={p.label} aria-hidden={!p.open}>
        {p.open ? (
          <>
            <div className="pt-side__head">
              <div>
                {p.kicker ? <span className="h-label">{p.kicker}</span> : null}
                <h2>{p.title}</h2>
                {p.sub ? <div className="pt-sub">{p.sub}</div> : null}
              </div>
              <span className="pt-side__nav">
                {p.onPrev ? <button type="button" className="pt-icon" aria-label="Previous" onClick={p.onPrev}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg></button> : null}
                {p.onNext ? <button type="button" className="pt-icon" aria-label="Next" onClick={p.onNext}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></button> : null}
                <button type="button" className="pt-icon" aria-label="Close" onClick={p.onClose}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
              </span>
            </div>
            <div className="pt-side__body">{p.children}</div>
            {p.foot ? <div className="pt-side__foot">{p.foot}</div> : null}
          </>
        ) : null}
      </aside>
    </>
  );
}
