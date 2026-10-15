import { Icon } from './Icon';
import { NavLink } from './NavLink';
import { barCount, type NavView } from './model';

interface Props {
  view: NavView;
}

/** The phone's bottom bar: every area the person can open, scrolling sideways when they do not fit. There is no More button. */
export function PhoneBar({ view }: Props) {
  return (
    <nav className="h-navbar" id="h-bar" aria-label="Areas">
      {view.main.map((v) => (
        <NavLink
          key={v.area.id}
          className={'h-bar__a' + (v.cur ? ' is-on' : '')}
          href={v.href}
          data-bar={v.area.id}
          data-rank={v.area.barRank}
          data-area-link={v.area.id}
          data-default={v.area.pages[0].href}
          aria-current={v.cur ? 'true' : undefined}
          hidden={!v.inBar}
        >
          <span className="h-bar__i">
            <Icon name={v.area.icon} />
            <i className={'h-bar__n' + (v.warn ? ' h-nav__count--warn' : '')} data-sum={v.area.id} hidden={!v.sum}>
              {barCount(v.sum)}
            </i>
          </span>
          <span className="h-bar__l">{v.area.short || v.area.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
