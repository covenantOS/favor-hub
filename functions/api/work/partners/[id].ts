import { HttpError } from '../../../_lib/http';
import { loadPartner, mirrorQ, SYSTEM_ID } from '../../../_lib/work/partner';
import { can } from '../../../_lib/work/role';
import { param, work } from '../../../_lib/work/route';

// One partner, read only from the D1 mirror. The Work Center's partner page, its side panel and the iPhone route (mobile-v1.yaml,
// /api/mobile/partners/{id}) all read this one answer; `card` is the iPhone contract's Partner object.
export const onRequestGet = work(async ({ env, params, ctx }) => {
  const id = param(params, 'id');
  if (!SYSTEM_ID.test(id)) throw new HttpError(404, 'no_partner', 'No partner has that number.');
  const partner = await loadPartner(mirrorQ(env), id);
  if (!partner) throw new HttpError(404, 'no_partner', 'No partner has that number. The copy of Blackbaud refreshes at 5 AM and 5 PM, so a record added since then is not in it yet.');
  // Whether this role may change the partner's contact details here. Admins and Support always may; Partner Care and directors when their own team holds the partner.
  const sc = ctx.scope;
  let canEdit = true;
  if (sc && !sc.all && sc.role !== 'support') {
    const holders = (partner.assignments || []).filter((a: any) => a.current).map((a: any) => String(a.fid));
    canEdit = can(sc, 'partner_edit') && (!holders.length || holders.some((h: string) => sc.fids.has(h)));
  }
  return { partner: { ...partner, canEdit } };
});
