// The top bar as it is drawn before the menu answer arrives. It has the markup shape of TopBar (menu button, the area's tile, the
// head, the tab slot, the right-hand cluster), so the real bar takes its place without moving the page under it. What the menu answer
// decides (the tabs, the buttons) holds its space and shows nothing: no page names, nothing a person could tap.
import { Icon } from '@/shell/Icon';
import { RelBadge } from '@/shell/RelBadge';
import { topHead } from '@/shell/TopBar';
import { tabRowHeld, tabRowCount } from '@/shell/model';

export function TopWait({ navId, title }: { navId: string; title: string }) {
  const { found, area, sameAsArea, headTitle, headKey, crumb } = topHead(navId, title);
  return (
    <header className="h-top h-top--wait">
      <span className="h-top__menu" aria-hidden="true">
        <Icon name="menu" />
      </span>
      {area && (
        <span className="h-tile" aria-hidden="true">
          <Icon name={area.icon} />
        </span>
      )}
      <div className="h-top__head">
        <div className="h-top__crumb" hidden={found && !sameAsArea ? undefined : true}>
          {found ? found.area.label : crumb}
        </div>
        <div className="h-top__title">
          {headTitle}
          {found && <RelBadge k={headKey} areaId={found.area.id} className="h-rel--head" />}
          {found && found.page.note && <span className="h-top__note">{found.page.note}</span>}
        </div>
      </div>
      <div className="h-top__tabs">
        {tabRowHeld(navId) && (
          <nav className="h-tabs h-tabs--wait" aria-hidden="true" inert>
            <div className="h-tabs__row">
              {Array.from({ length: tabRowCount(navId) }, (_, i) => (
                <span key={i} className={'h-tab' + (i === 0 ? ' is-on is-job' : '')}>
                  <span className="h-tab__t">&nbsp;</span>
                </span>
              ))}
            </div>
          </nav>
        )}
      </div>
      <div className="h-top__right" aria-hidden="true">
        <span className="h-top__hold" />
      </div>
    </header>
  );
}
