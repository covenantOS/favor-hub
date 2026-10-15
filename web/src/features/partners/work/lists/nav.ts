// Opening a partner from a row press: inside the app when its route is served for this person, as a page load otherwise (the same rule
// NavLink uses for a link).
import { useRouter } from '@tanstack/react-router';
import { hubOv } from '@/lib/hubOv';
import { isInApp, useServedRoutes } from '@/shell/NavLink';

export const partnerHref = (cid: string) => '/work/partner/' + encodeURIComponent(cid);

export function usePartnerOpen(): (cid: string) => void {
  const served = useServedRoutes();
  const router = useRouter();
  return (cid: string) => {
    const href = partnerHref(cid);
    if (isInApp(href, served)) hubOv.unwind(() => router.history.push(href));
    else location.href = href;
  };
}
