// The partner as a slide-over drawer (port of open() and close() in public/js/partner.js). One drawer for the whole web app, drawn by
// PartnerLinks; openPartner(id) from drawerStore (or the useOpenPartner hook) opens it.
import { useEffect, useRef, useState } from 'react';
import { BodyPortal } from '@/shell/BodyPortal';
import { NavLink } from '@/shell/NavLink';
import { hubOv } from '@/lib/hubOv';
import { Ic } from './Ic';
import { closePartner, runEscGuard } from './drawerStore';
import { asParam, href, type Partner } from './lib';
import { PartnerView } from './PartnerView';
// partner.css, partner-crm.css, comm-picture.css and records.css come with the frame (layout.css); only the page-level sheets load here.
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import '@hub/styles/break-ui.css';

export function PartnerDrawer({ id, compose, open }: { id: string; compose?: string | null; open: boolean }) {
  const [on, setOn] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [name, setName] = useState('');
  const [as, setAs] = useState('');
  const scroll = useRef<HTMLDivElement>(null);
  const drawer = useRef<HTMLElement>(null);
  useEffect(() => {
    setAs(asParam());
  }, []);
  useEffect(() => {
    if (!open) {
      setOn(false);
      return;
    }
    const f = requestAnimationFrame(() => setOn(true));
    document.documentElement.classList.add('pp-locked');
    const tok = hubOv.on(() => closePartner());
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!drawer.current?.classList.contains('is-on')) return;
      // A hover card or a tool above the drawer takes the key first.
      if (document.querySelector('.wg-layer, .wg-pop, .ad-drawer')) return;
      e.stopPropagation();
      if (!runEscGuard()) closePartner();
    };
    document.addEventListener('keydown', key, true);
    return () => {
      cancelAnimationFrame(f);
      document.documentElement.classList.remove('pp-locked');
      hubOv.off(tok);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);
  useEffect(() => {
    setName('');
    setStuck(false);
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [id]);
  return BodyPortal(
    <div className="pp-layer">
      <div className={'pp-scrim' + (on ? ' is-on' : '')} onClick={() => closePartner()} />
      <aside ref={drawer} className={'pp-drawer' + (on ? ' is-on' : '')} role="dialog" aria-modal="true" aria-label={name || 'Partner'}>
        <div className={'pp-bar' + (stuck ? ' is-stuck' : '')}>
          <span className="pp-bar__name">{name}</span>
          <span className="pp-bar__acts">
            <NavLink className="h-btn h-btn--ghost h-btn--sm" href={href(id)} data-pp-full="" onClick={() => closePartner()}>
              <Ic n="expand" />
              Open full page
            </NavLink>
            <button type="button" className="pp-iconbtn" aria-label="Close (Esc)" onClick={() => closePartner()}>
              <Ic n="x" />
            </button>
          </span>
        </div>
        <div className="pp-scroll" ref={scroll} onScroll={(e) => setStuck((e.currentTarget as HTMLElement).scrollTop > 60)}>
          <PartnerView
            key={id}
            id={id}
            mode="drawer"
            as={as}
            compose={compose}
            onLoaded={(p: Partner) => {
              setName(p.name);
              scroll.current?.querySelector<HTMLElement>('.pp-h1link')?.focus({ preventScroll: true });
            }}
          />
        </div>
      </aside>
    </div>
  );
}
