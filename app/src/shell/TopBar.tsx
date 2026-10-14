import type { Access } from '@shared/schemas';
import { Bell } from './Bell';
import { HelpPanel } from './HelpPanel';
import { Icon } from './Icon';
import { NavLink } from './NavLink';
import { RelBadge } from './RelBadge';
import type { NavView } from './model';
import { pageVisible } from './model';
import { resolveNav } from '@hub/data/areas';
import { useEffect } from 'react';
import { loadScript } from '@/lib/legacy';

interface Props {
  /** Markup a classic page put in the actions slot. */
  actions?: string;
  view: NavView;
  navId: string;
  /** The page's own title, used when the page is not in the menu. */
  title: string;
  crumb?: string;
  access: Partial<Access> & Record<string, unknown>;
  kpiTeams: string[];
  menuOpen: boolean;
  onMenu: () => void;
  onRemember: (areaId: string, pageId: string) => void;
}

/** The top bar: menu button (phone), the area's tile and title, its tabs, then search, bell, Clips, help, Feedback and Make a request. */
export function TopBar({ actions = '', view, navId, title, crumb = 'FavorOS', access, kpiTeams, menuOpen, onMenu, onRemember }: Props) {
  // Groups the tabs and moves any that do not fit under More (public/js/tab-org.js).
  useEffect(() => {
    loadScript('/js/tab-org.js?v=1').catch(() => {});
  }, []);
  const found = resolveNav(navId);
  const area = found?.area;
  const tabs = area ? area.pages.filter((p) => !p.ext && pageVisible(p, access, kpiTeams)) : [];
  const showTabs = tabs.length > 1;
  const clipsRecord = !!access.clips && access.clipsRecord !== false;
  return (
    <header className="h-top">
      <button type="button" className="h-top__menu" id="h-menu" aria-label={menuOpen ? 'Close the menu' : 'Open the menu'} aria-controls="h-side" aria-expanded={menuOpen} onClick={(e) => { e.stopPropagation(); onMenu(); }}>
        <Icon name="menu" />
      </button>
      {area && (
        <span className="h-tile" id="h-tile" aria-hidden="true">
          <Icon name={area.icon} />
        </span>
      )}
      <div className="h-top__head">
        <div className="h-top__crumb">{area ? area.label : crumb}</div>
        <div className="h-top__title">
          {area ? area.label : title}
          {found && <RelBadge k={'page:' + found.page.id} areaId={found.area.id} className="h-rel--head" />}
          {found?.page.id === 'projects' && <span className="h-top__note">Synced with Asana</span>}
        </div>
      </div>
      <div className="h-top__tabs" id="h-tabs-slot">
        {area && (
          <nav className="h-tabs" id="h-tabs" data-area={area.id} aria-label={`${area.label} sections`} hidden={!showTabs}>
            <div className="h-tabs__row">
              {tabs.map((p) => {
                const on = p.id === navId || (p.also || []).includes(navId);
                const n = p.count ? view.areas.flatMap((a) => a.pages).find((x) => x.page.id === p.id)?.count || 0 : 0;
                return (
                  <NavLink key={p.id} className={'h-tab' + (on ? ' is-on' : '')} href={p.href} data-nav-id={p.id} data-kpi-page={p.kpiPage} aria-current={on ? 'page' : undefined} onClick={() => onRemember(area.id, p.id)}>
                    {p.label}
                    {p.count && (
                      <span className="h-nav__count" data-count={p.count} hidden={!n}>
                        {n.toLocaleString('en-US')}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </nav>
        )}
      </div>
      <div className="h-top__right" data-ui-actions>
        <div className="pp-headsearch pv-find" id="pp-headsearch" hidden>
          <label className="pv-find__box">
            <Icon name="search" />
            <input type="search" placeholder="Find a partner" autoComplete="off" aria-label="Find a partner" />
            <kbd>Ctrl K</kbd>
          </label>
          <ul className="pv-find__list" role="listbox" hidden />
        </div>
        <button type="button" className="h-top__search" data-cmdk-open aria-label="Search FavorOS">
          <Icon name="search" />
        </button>
        <span className="h-top__actions" id="h-actions" dangerouslySetInnerHTML={{ __html: actions }} />
        <Bell access={access} />
        <a className="h-top__cam h-top__lib" id="clip-lib" href="/clips/" hidden={!access.clips} aria-label="My clips" title="My clips">
          <Icon name="clips" />
        </a>
        <button type="button" className="h-top__cam" id="clip-cam" hidden={!clipsRecord} aria-haspopup="dialog" aria-expanded="false" aria-label="Record a clip" title="Record a clip">
          <Icon name="camera" />
        </button>
        <HelpPanel navId={navId} />
        <button type="button" className="h-btn h-btn--ghost h-fb" id="h-fb" data-feedback="hub" title="Tell Will what's wrong, confusing or worth adding">
          <Icon name="chat" />
          <span className="h-lbl">Feedback</span>
        </button>
        {navId !== 'new' && (
          <a className="h-btn h-btn--primary" href="/requests/new" aria-label="Make a request">
            <Icon name="plus" />
            <span className="h-lbl">Make a request</span>
          </a>
        )}
      </div>
    </header>
  );
}
