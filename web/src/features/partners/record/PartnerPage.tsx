// The partner's full page (/work/partner/<id>): the Overview with Gifts, Actions, Relationships, Contact, Codes and Record tabs, in two
// columns from 1200 px. ?gift=<id> opens on that gift, ?opp=<id> on that opportunity, ?as=<person> views it as a teammate.
import type { QueryClient } from '@tanstack/react-query';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import '@hub/styles/break-ui.css';
import { PartnerLinks } from './PartnerLinks';
import { PartnerView } from './PartnerView';
import { prefetchPartnerReads } from './queries';
import type { Partner } from './lib';

import type { PartnerSearch } from './search';
export { validatePartnerSearch, type PartnerSearch } from './search';

export function prefetchPartner(qc: QueryClient, id: string, as = ''): void {
  prefetchPartnerReads(qc, id, as);
}

/** The page title and the top bar name follow the partner. */
function setTitle(p: Partner) {
  const nm = String(p.name || '').trim() || 'Partner';
  document.title = nm + ' - FavorOS';
  const t = document.querySelector<HTMLElement>('.h-top__title');
  if (t) {
    t.textContent = nm;
    t.title = nm;
  }
}

export function PartnerPage({ id, search = {} }: { id: string; search?: PartnerSearch }) {
  return (
    <>
      <section className="h-card pp-full" data-id={id}>
        <div id="pv-root" className="pp-scroll" aria-live="polite">
          <PartnerView key={id} id={id} mode="full" as={search.as || ''} focusGift={search.gift || ''} focusOpp={search.opp || ''} onLoaded={setTitle} />
        </div>
      </section>
      <PartnerLinks />
    </>
  );
}
