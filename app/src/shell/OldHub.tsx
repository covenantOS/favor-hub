import { useRef } from 'react';
import { BodyPortal } from './BodyPortal';
import { Icon } from './Icon';
import { OLD_HUB_TILES as TILES } from '@hub/data/oldHub';

/** The grid button in the top bar and the box it opens. */
export function OldHub() {
  const dlg = useRef<HTMLDialogElement>(null);
  let downOn: EventTarget | null = null;
  return (
    <>
      <button type="button" className="h-top__cam" id="oh-btn" aria-haspopup="dialog" aria-label="Old hub tools" title="Old hub tools" onClick={() => dlg.current?.showModal()}>
        <Icon name="tools" />
      </button>
      {BodyPortal(
      <dialog
        className="oh"
        ref={dlg}
        aria-labelledby="oh-title"
        onPointerDownCapture={(e) => { downOn = e.target; }}
        onClick={(e) => {
          if (e.target === dlg.current && (downOn === dlg.current || downOn === null)) dlg.current?.close();
          downOn = null;
        }}
      >
        <div className="oh__bar">
          <h2 id="oh-title">Old hub tools</h2>
          <button type="button" className="lp__x" aria-label="Close" onClick={() => dlg.current?.close()}>&times;</button>
        </div>
        <div className="oh__grid">
          {TILES.map((t) => {
            const ext = t.href.startsWith('http');
            return (
              <a key={t.title} className="oh__tile" href={t.href} target={ext ? '_blank' : undefined} rel={ext ? 'noopener' : undefined} onClick={() => { if (!ext) dlg.current?.close(); }}>
                <Icon name={t.icon} />
                <span className="oh__t">{t.title}{ext && <Icon name="ext" className="h-i oh__ext" />}</span>
                <span className="oh__d">{t.desc}</span>
              </a>
            );
          })}
        </div>
      </dialog>)}
    </>
  );
}
