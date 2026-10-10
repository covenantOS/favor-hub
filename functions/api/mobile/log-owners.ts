import { logOwners } from '../../_lib/mobile/contact';
import { mobile } from '../../_lib/mobile/route';

// Who the person may log a contact for (mobile-v1.yaml, logOwners). Same list the Work Center's Entry tab offers.
export const onRequestGet = mobile(async ({ ctx, fid }) => logOwners(ctx, fid));
