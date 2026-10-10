import { connection } from '../../_lib/foundations/blackbaud';
import { work } from '../../_lib/work/route';
import { healthView } from '../../_lib/work/service';

// Can the hub reach Blackbaud's two doors right now? Makes no Blackbaud call.
export const onRequestGet = work(async ({ ctx, env }) => {
  const c = await connection(env).catch(() => ({ blackbaud: false, mirror: false }));
  return healthView(ctx, c.mirror, c.blackbaud) as any;
});
