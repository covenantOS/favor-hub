import { useEffect, useRef, useState } from 'react';
import type { HubUser } from '@shared/schemas';
import { Icon } from './Icon';
import { NavLink } from './NavLink';
import { RelBadge } from './RelBadge';
import { railCount, type AreaView, type NavView } from './model';
import type { useRail } from './useRail';

type Rail = ReturnType<typeof useRail>;

interface Props {
  view: NavView;
  user: HubUser;
  rail: Rail;
  tours: number;
  onSignOut: () => void;
}

const Count = ({ n, warn, keyName }: { n: number; warn?: boolean; keyName?: string }) => (
  <span className={'h-nav__count' + (warn ? ' h-nav__count--warn' : '')} data-count={keyName} hidden={!n}>
    {railCount(n)}
  </span>
);

function Area({ v, rail, tours }: { v: AreaView; rail: Rail; tours: number }) {
  const { area } = v;
  const first = area.pages[0];
  const pop = !!area.pop;
  const popped = rail.pop === area.id;
  const open = rail.isOpen(area.id) || (popped && (rail.full || rail.phone));
  const cls = ['h-area', v.cur && 'is-cur', open && 'is-open', pop && 'h-area--pop', area.foot && 'h-area--foot', v.single && 'is-single', v.inBar && 'in-bar', popped && 'is-pop'].filter(Boolean).join(' ');
  return (
    <div className={cls} data-area={area.id} data-key={area.key} hidden={!v.visible}>
      <NavLink
        className="h-nav__item h-area__link"
        href={pop ? '#' : v.href}
        data-area-link={area.id}
        data-default={first.href}
        aria-current={v.cur ? 'true' : undefined}
        aria-haspopup={pop ? 'true' : undefined}
        title={area.label}
        onClick={(e) => {
          if (pop) {
            e.preventDefault();
            e.stopPropagation();
            rail.setPop(popped ? null : area.id);
            return;
          }
          if (rail.peek) rail.setPeek(false);
          if (rail.phone) rail.closeNav();
        }}
      >
        <Icon name={area.icon} />
        <span className="h-area__label">{area.short || area.label}</span>
        <RelBadge k={area.id} />
        <span className={'h-nav__count h-area__sum' + (v.warn ? ' h-nav__count--warn' : '')} data-sum={area.id} hidden={!v.sum}>
          {railCount(v.sum)}
        </span>
      </NavLink>
      <button type="button" className="h-area__tog" aria-expanded={open} aria-label={`Show the ${area.label} pages`} onClick={() => rail.toggleGroup(area.id, open)}>
        <Icon name="chev" />
      </button>
      <div className="h-area__pages" role="group" aria-label={`${area.label} pages`}>
        {v.pages.map(({ page: p, count, warn, on }) => (
          <div className="h-pg" data-pg={p.id} key={p.id}>
            {p.ext ? (
              <a className="h-nav__item h-pg__a" href={p.href} target="_blank" rel="noopener noreferrer">
                <span>{p.label}</span>
                <Icon name="ext" className="h-i h-nav__ext" />
              </a>
            ) : (
              <>
                <NavLink
                  className={'h-nav__item h-pg__a' + (on ? ' is-on' : '')}
                  href={p.href}
                  data-nav-id={p.id}
                  data-label={p.label}
                  data-kpi-page={p.kpiPage}
                  aria-current={on ? 'page' : undefined}
                  onClick={() => {
                    if (v.pages.length > 1) rail.remember(area.id, p.id);
                    if (rail.peek && !p.kpiPage) rail.setPeek(false);
                    if (rail.phone) rail.closeNav();
                  }}
                >
                  <span>{p.label}</span>
                  <RelBadge k={'page:' + p.id} areaId={area.id} skipSameAsArea />
                  {p.count && <Count n={count} warn={warn} keyName={p.count} />}
                </NavLink>
                <button
                  type="button"
                  className="h-pin"
                  data-pin={p.id}
                  aria-pressed={rail.pins.includes(p.id)}
                  aria-label={(rail.pins.includes(p.id) ? 'Unpin ' : 'Pin ') + p.label}
                  title="Pin to the top"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    rail.togglePin(p.id);
                  }}
                >
                  <Icon name="star" />
                </button>
              </>
            )}
          </div>
        ))}
        {area.id === 'help' && (
          <div className="h-pg h-pg--tour">
            <button type="button" className="h-nav__item h-pg__a h-nav__help" id="h-help" data-tour-start title="The tour of FavorOS and the walkthroughs of what is new">
              <span>What&apos;s new and tour</span>
              <span className="h-nav__count" data-count="tours" hidden={!tours}>
                {railCount(tours)}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Avatar({ user }: { user: HubUser }) {
  const name = user.name || user.email || '';
  const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return (
    <span className="h-avatar" id="h-avatar">
      {user.picture ? <img alt="" referrerPolicy="no-referrer" src={user.picture} /> : ini}
    </span>
  );
}

function Account({ user, onSignOut }: { user: HubUser; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [connect, setConnect] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!(e.target as Element).closest('#h-acctmenu') && !(e.target as Element).closest('#h-acct')) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // The Connect item shows only to a person who has not authorized the Favor Brain connector.
  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch('/api/brain/connector', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => live && setConnect(!!(d && d.ok && d.connected === false)))
      .catch(() => live && setConnect(false));
    return () => {
      live = false;
    };
  }, [open]);

  if (user.via !== 'google') return null;
  return (
    <div className="h-side__foot" id="h-foot">
      <button type="button" className="h-acct" id="h-acct" ref={btn} aria-haspopup="menu" aria-expanded={open} aria-controls="h-acctmenu" title="Your account" onClick={() => setOpen((v) => !v)}>
        <Avatar user={user} />
        <span className="h-who">
          <b id="h-name">{user.name || user.email}</b>
          <span id="h-email">{user.email}</span>
        </span>
      </button>
      <div className="h-acctmenu" id="h-acctmenu" role="menu" hidden={!open} onClick={(e) => {
        const rec = (e.target as Element).closest('[data-clip-record]');
        setOpen(false);
        if (rec) document.getElementById('clip-cam')?.click();
      }}>
        <a role="menuitem" href="/clips/">
          <Icon name="clips" />
          My clips
        </a>
        <button type="button" role="menuitem" data-clip-record>
          <Icon name="camera" />
          Record a clip
        </button>
        <button type="button" role="menuitem" data-feedback="hub">
          <Icon name="chat" />
          Feedback
        </button>
        <a role="menuitem" href="/brain/?connect=1" data-connect-item hidden={!connect}>
          <Icon name="clips" />
          Connect Favor Brain to Claude
        </a>
        <button type="button" role="menuitem" className="h-sound" data-sound-switch aria-pressed="true">
          <Icon name="sound" className="h-i h-sound__on" />
          <Icon name="mute" className="h-i h-sound__off" />
          Sounds
        </button>
        <a role="menuitem" href="/?app2=0" data-fe-off="1">
          <Icon name="panel" />
          Use classic FavorOS
        </a>
        <button type="button" role="menuitem" id="h-out" onClick={onSignOut}>
          <Icon name="out" />
          Sign out
        </button>
      </div>
    </div>
  );
}

export function Rail({ view, user, rail, tours, onSignOut }: Props) {
  const pinned = rail.pins
    .map((id) => {
      for (const a of view.areas) {
        const p = a.visible ? a.pages.find((x) => x.page.id === id) : undefined;
        if (p && !p.page.ext) return { a, p };
      }
      return null;
    })
    .filter((x): x is { a: AreaView; p: AreaView['pages'][number] } => !!x);
  return (
    <aside className="h-side" id="h-side" aria-label="FavorOS">
      <button type="button" className="h-side__x" id="h-side-x" aria-label="Close the menu" onClick={rail.closeNav}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
      <button
        type="button"
        className="h-side__tog"
        id="h-wide"
        aria-pressed={rail.full}
        aria-label={rail.full ? 'Collapse the menu' : 'Expand the menu'}
        data-tip={(rail.full ? 'Collapse the menu' : 'Expand the menu') + ' (press the backslash key)'}
        onClick={(e) => {
          e.preventDefault();
          rail.toggleWide();
        }}
      >
        <Icon name="chev" />
      </button>
      <div className="h-side__in">
        <NavLink className="h-brand" href="/" aria-label="FavorOS home">
          <img className="h-brand__full" src="/images/favor-logo-color.png" alt="Favor International" />
          <img className="h-brand__mark" src="/images/favor-icon.png" alt="Favor International" />
          <span>OS</span>
        </NavLink>
        <div className="h-pins" id="h-pins" hidden={!pinned.length}>
          <div className="h-nav__label">Pinned</div>
          <div className="h-pins__list" id="h-pins-list">
            {pinned.map(({ a, p }) => (
              <NavLink key={p.page.id} className={'h-nav__item h-pinrow' + (p.on ? ' is-on' : '')} href={p.page.href} data-pinned={p.page.id} data-kpi-page={p.page.kpiPage} onClick={() => rail.peek && rail.setPeek(false)}>
                <span>{p.page.label}</span>
                <em>{a.area.short || a.area.label}</em>
              </NavLink>
            ))}
          </div>
        </div>
        <nav className="h-areas" aria-label="Areas">
          {view.main.map((v) => (
            <Area key={v.area.id} v={v} rail={rail} tours={0} />
          ))}
        </nav>
        <div className="h-areas h-areas--foot">
          {view.foot.map((v) => (
            <Area key={v.area.id} v={v} rail={rail} tours={tours} />
          ))}
        </div>
        <button type="button" className="h-side__fb" data-feedback="hub" title="Tell Will what's wrong, confusing or worth adding">
          <Icon name="chat" />
          Feedback
        </button>
        <Account user={user} onSignOut={onSignOut} />
        <button type="button" className="h-search" data-cmdk-open>
          <Icon name="search" />
          <span className="h-search__t">Search</span>
          <kbd>Ctrl K</kbd>
        </button>
      </div>
    </aside>
  );
}
