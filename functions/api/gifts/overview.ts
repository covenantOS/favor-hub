import { gift } from '../../_lib/gifts/route';
import { giftsOverview } from '../../_lib/gifts/overview';
import { isTester } from '../../_lib/testuser';

// The gift day on one screen for Gifts > Overview. Same gate as the other gift routes (admins and the people given gift entry access).
// Reads the hub's tables and the Blackbaud copy only, so it answers fast. A part that fails comes back null and the rest still answer.
export const onRequestGet = gift(async ({ env, q, user }) => ({ ...(await giftsOverview(env, q, { tester: isTester(user.email) })) }));
