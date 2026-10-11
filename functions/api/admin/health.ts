import { adminRoute } from '../../_lib/admin/route';
import { healthStrip } from '../../_lib/admin/health';

// The health strip: eight checks, each with its last run time and an ok, late or failed status. Reads only.
export const onRequestGet = adminRoute(async ({ env }) => ({ at: new Date().toISOString(), items: await healthStrip(env) }));
