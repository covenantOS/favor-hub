import { work } from '../../_lib/work/route';
import { runNotify } from '../../_lib/notify/run';

// Notifications: task tag emails held for a burst, feedback reply emails and the weekday morning nudges. The small drain Worker
// calls POST every 5 minutes with the agent key; the result is written to act_settings notify:last.
export const onRequestPost = work(async ({ env }) => (await runNotify(env)) as any, { adminOnly: true });
