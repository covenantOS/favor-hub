import { gift } from '../../_lib/gifts/route';
import { searchPartners } from '../../_lib/work/partner';
import { lastGiftCoding } from '../../_lib/gifts/match';

// Search by hand: the same partner search the Work Center and the partner page use. With ?coding=<id> it also returns the appeal on that
// partner's last gift, the fallback the Admin Desk SOP uses when nothing came with the check.
export const onRequestGet = gift(async ({ url, repo, q }) => {
  const coding = url.searchParams.get('coding');
  if (coding && /^\d{1,12}$/.test(coding)) return { last: await lastGiftCoding(q, coding).catch(() => null) };
  const term = (url.searchParams.get('q') || '').trim();
  const hits = await searchPartners(repo, q, term, undefined, 8);
  return { hits: hits.map((h) => ({ cid: h.cid, lookup: h.lookup, name: h.name, place: h.place })) };
});
