import { Icon } from './Icon';
import { NavLink } from './NavLink';
import { barCount, type NavView } from './model';

interface Props {
  view: NavView;
  navOpen: boolean;
  onMore: () => void;
}

/** The phone's bottom bar: up to four areas and More, which opens the full menu. */
export function PhoneBar({ view, navOpen, onMore }: Props) {
  const moreOn = !!view.curArea && !view.bar.some((a) => a.area.id === view.curArea);
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
      <button type="button" className={'h-bar__a h-bar__more' + (moreOn ? ' is-on' : '')} id="h-bar-more" aria-controls="h-side" aria-expanded={navOpen} onClick={(e) => { e.stopPropagation(); onMore(); }}>
        <span className="h-bar__i">
          <Icon name="more" />
          <i className="h-bar__n" data-sum="more" hidden={!view.more}>
            {barCount(view.more)}
          </i>
        </span>
        <span className="h-bar__l">More</span>
      </button>
    </nav>
  );
}
