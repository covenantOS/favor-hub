import { og } from '../../_lib/other-gifts/route';
import { recommenders } from '../../_lib/other-gifts/read';
import { searchPartners } from '../../_lib/work/partner';

// Who recommended gifts from this sponsor before, with a partner search folded in when the person types.
export const onRequestGet = og(async ({ q, repo, url }) => {
  const sponsor = url.searchParams.get('sponsor') || '';
  const term = (url.searchParams.get('q') || '').trim();
  const hits = term.length >= 2 ? (await searchPartners(repo, q, term, undefined, 8)).map((h) => ({ cid: h.cid, lookup: h.lookup, name: h.name, place: h.place })) : [];
  const rows = /^\d{1,12}$/.test(sponsor)
    ? await recommenders(q, repo, sponsor, term, hits)
    : hits.map((h) => ({ id: h.cid, lookup: h.lookup, name: h.name, place: h.place, usedBefore: 0, lastDate: '' }));
  return { rows };
});
