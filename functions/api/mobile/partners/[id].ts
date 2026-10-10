import { mobile, param } from '../../../_lib/mobile/route';
import { partnerCard } from '../../../_lib/mobile/partners';

// One partner (mobile-v1.yaml, partnerDetail). Read from the same module as the Work Center's partner page.
export const onRequestGet = mobile(async ({ ctx, params }) => ({ ...(await partnerCard(ctx, param(params, 'id'))) }));
