import { gift } from '../../_lib/gifts/route';
import { searchPartners } from '../../_lib/work/partner';
import { expectedFor, lastGiftCoding, loadCatalog, recentGiftCount } from '../../_lib/gifts/match';
import { proposeCoding } from '../../_lib/gifts/code';

// Search by hand: the same partner search the Work Center and the partner page use. With ?coding=<id> it also returns the appeal on that
// partner's last gift, the fallback the Admin Desk SOP uses when nothing came with the check. With ?purpose=<id>&amount=<cents>&date=
// it returns what a gift from that partner would be coded as from the record alone (no slip, no note): the fund and appeal a logged
// call or opportunity points to, each with its reason line. A read only; a person confirms the row.
export const onRequestGet = gift(async ({ url, repo, q }) => {
  const coding = url.searchParams.get('coding');
  if (coding && /^\d{1,12}$/.test(coding)) return { last: await lastGiftCoding(q, coding).catch(() => null) };
  const purpose = url.searchParams.get('purpose');
  if (purpose && /^\d{1,12}$/.test(purpose)) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') || '') ? String(url.searchParams.get('date')) : today;
    const cents = Math.max(0, Math.round(Number(url.searchParams.get('amount')) || 0)) || null;
    const [cat, last, recent, expected] = await Promise.all([
      loadCatalog(q),
      lastGiftCoding(q, purpose).catch(() => null),
      recentGiftCount(q, purpose, date).catch(() => 0),
      expectedFor(q, purpose, date, cents).catch(() => []),
    ]);
    const c = proposeCoding({
      slipAppeal: null, slipDesignation: null, letterAppeal: null, letterPurpose: null, memo: null,
      lastGift: last ? { fundId: last.fundId, appealId: last.appealId } : null, expected,
      funds: cat.funds, appeals: cat.appeals, partnerName: null, payer: null, amountCents: cents, recentGifts: recent,
    });
    return {
      purpose: {
        date, fund: c.fund, fundSource: c.fundSource, fundReason: c.fundReason,
        appeal: c.appeal, appealSource: c.appealSource, reason: c.reason, needsCoding: c.needsCoding, suggestions: c.suggestions,
        expected: expected.map((e) => ({ kind: e.kind, date: e.date, amountCents: e.amountCents })),
      },
    };
  }
  const term = (url.searchParams.get('q') || '').trim();
  const hits = await searchPartners(repo, q, term, undefined, 8);
  return { hits: hits.map((h) => ({ cid: h.cid, lookup: h.lookup, name: h.name, place: h.place })) };
});
