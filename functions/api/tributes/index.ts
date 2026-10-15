import { og } from '../../_lib/other-gifts/route';
import { tributeView, tributesFor } from '../../_lib/tributes/store';

// Tributes kept in FavorOS. GET ?gift=123,456 returns the tribute on each Blackbaud gift; GET ?partner=789 returns every tribute on a
// partner's gifts. The gift rows and (once it moves to React) the partner page read this. Same audience as Other gifts.
export const onRequestGet = og(async ({ env, url }) => {
  const gift = (url.searchParams.get('gift') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const partner = (url.searchParams.get('partner') || '').replace(/\D/g, '');
  const rows = await tributesFor(env, partner ? { partner } : { gift });
  return { tributes: rows.map(tributeView) };
});
