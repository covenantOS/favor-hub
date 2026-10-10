import { mobile } from '../../_lib/mobile/route';
import { searchCards } from '../../_lib/mobile/partners';

// Partner lookup by name, email, phone or city. An empty q returns the person's own portfolio, first 25 (mobile-v1.yaml, searchPartners).
export const onRequestGet = mobile(async ({ ctx, fid, url }) => ({ items: await searchCards(ctx, fid, url.searchParams.get('q') || '') }));
