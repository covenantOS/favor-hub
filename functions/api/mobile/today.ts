import { mobile } from '../../_lib/mobile/route';
import { todayFor } from '../../_lib/mobile/today';

// Thank-yous owed and follow-ups due today or overdue for the signed-in person (mobile-v1.yaml, today).
export const onRequestGet = mobile(async ({ ctx, fid }) => ({ items: await todayFor(ctx, fid) }));
