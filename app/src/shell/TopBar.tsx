import type { Access } from '@shared/schemas';
import { Bell } from './Bell';
import { HelpPanel } from './HelpPanel';
import { Icon } from './Icon';
import { NavLink } from './NavLink';
import { RelBadge } from './RelBadge';
import type { NavView } from './model';
import { resolveNav } from '@hub/data/areas';
import { TabRow } from './TabRow';
import { Account } from './Rail';
import type { HubUser } from '@shared/schemas';

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
  /** This person's jobs from /api/hub/nav: which tabs come first. */
  jobs?: readonly string[] | null;
  /** The signed-in person, for the account button at the right end. */
  user?: HubUser;
  onSignOut?: () => void;
  /** Where Use classic FavorOS goes: ?app2=0 in the app2 frame, ?web=0 in the web app. */
  classicHref?: string;
  menuOpen: boolean;
  onMenu: () => void;
  onRemember: (areaId: string, pageId: string) => void;
}

/** What the top bar's head says for a nav id: the area, the page and the title shown. Shared with the frame drawn before the menu answers. */
export function topHead(navId: string, title: string, crumb = 'FavorOS') {
  const found = resolveNav(navId);
  const sameAsArea = !!found && (found.page.label === found.area.label || found.page.label === found.area.short);
  return {
    found,
    area: found?.area,
    sameAsArea,
    headTitle: found ? (sameAsArea ? found.area.label : found.page.label) : title,
    headKey: found ? (sameAsArea ? found.area.id : 'page:' + found.page.id) : '',
    crumbHref: found ? (found.area.pages.find((p) => p.menu !== false) || found.area.pages[0]).href : '',
  };
}

/** The top bar, the React twin of the header in src/layouts/App.astro: menu button (phone), the area's tile, the area as a breadcrumb over
 * the page's name and badge, the tab row, then search, bell, Clips, help, Feedback and Make a request. */
export function TopBar({ actions = '', view, navId, title, crumb = 'FavorOS', access, kpiTeams, jobs = null, user, onSignOut, classicHref, menuOpen, onMenu, onRemember }: Props) {
  const { found, area, sameAsArea, headTitle, headKey, crumbHref } = topHead(navId, title, crumb);
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
        <div className="h-top__crumb" hidden={found && !sameAsArea ? undefined : true}>
          {found && !sameAsArea ? <NavLink href={crumbHref}>{found.area.label}</NavLink> : found ? found.area.label : crumb}
          <span className="h-top__crumb2" id="h-crumb2" />
        </div>
        <div className="h-top__title">
          {headTitle}
          {found && <RelBadge k={headKey} areaId={found.area.id} className="h-rel--head" />}
          {found && found.page.note && <span className="h-top__note">{found.page.note}</span>}
        </div>
      </div>
      <div className="h-top__tabs" id="h-tabs-slot">
        {area && <TabRow area={area} navId={navId} view={view} access={access} kpiTeams={kpiTeams} jobs={jobs} onRemember={onRemember} />}
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
        <button type="button" className="h-top__cam" id="clip-cam" hidden={!clipsRecord} aria-haspopup="dialog" aria-expanded="false" aria-label="Record a clip" title="Record a clip">
          <Icon name="camera" />
        </button>
        <HelpPanel navId={navId} />
        {user && onSignOut && <Account user={user} onSignOut={onSignOut} access={access} classicHref={classicHref} />}
      </div>
    </header>
  );
}
