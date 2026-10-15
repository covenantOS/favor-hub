// The head every Admin settings page shares (React twin of src/components/AdminHead.astro): the title for screen readers, one fact staff need,
// and the row of settings pages. The pages above them (Overview, People and roles, Audit log) sit in the menu's own tab row.
import { useEffect, useRef } from 'react';
import { ADMIN_PAGES } from '@hub/data/admin-pages';
import '@hub/styles/crit-reportadmin.css';
import { NavLink } from '@/shell/NavLink';

const TABS = ADMIN_PAGES.filter((p) => p.live && p.tab);

export function AdminHead({ on, title, fact }: { on: string; title: string; fact?: string }) {
  const row = useRef<HTMLDivElement>(null);
  const showTabs = TABS.some((p) => p.id === on);
  useEffect(() => {
    // The tab for this page can sit off screen in the scrolling row; bring it into view without moving the page.
    const el = row.current;
    const cur = el && el.querySelector<HTMLElement>('.ad-tab.is-on');
    if (el && cur && el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, cur.offsetLeft - (el.clientWidth - cur.offsetWidth) / 2);
  }, [on]);
  return (
    <>
      <h1 className="sr-only">{title}</h1>
      {fact ? <p className="h-lede">{fact}</p> : null}
      {showTabs ? (
        <nav className="ad-tabs" aria-label="Settings pages">
          <div className="ad-tabs__row" ref={row}>
            {TABS.map((p) => (
              <NavLink key={p.id} className={'ad-tab' + (p.id === on ? ' is-on' : '')} href={p.href} aria-current={p.id === on ? 'page' : undefined}>
                {p.label}
              </NavLink>
            ))}
          </div>
        </nav>
      ) : null}
    </>
  );
}
