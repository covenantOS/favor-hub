import { work } from '../../_lib/work/route';
import { run } from '../../_lib/chat/mail';
import { runScheduled } from '../../_lib/chat/plus';
import { deliverHeld } from '../../_lib/quiet';
import { send } from '../../_lib/requests/mail';
import { pushToPeople, type PushEnv } from '../../_lib/push';
import { runGiftNotices } from '../../_lib/chat/gifts';

// Chat email: the welcome, the "started a conversation with you" email and the unread follow-up. The small drain Worker calls POST
// every 5 minutes with the agent key; everything is decided in _lib/chat/mail.ts and the result is written to act_settings chatmail:last.
// The same pass posts scheduled Chat messages and channel reminders that are due (chat/plus.ts), sends the quiet-hours summary to
// each person whose quiet hours just ended (quiet.ts), and posts new gifts of $5,000 or more to #leadership-gifts (chat/gifts.ts).
export const onRequestPost = work(async ({ env }) => {
  const scheduled = await runScheduled(env as any).catch((err) => ({ error: String(err).slice(0, 160) }));
  const mail = (await run(env)) as any;
  const quiet = await deliverHeld(env as any, {
    sendMail: (to, m) => send(env as any, { to, ...m, fromName: 'FavorOS' }),
    push: (to, p) => pushToPeople(env as PushEnv, [to], p, fetch, { loud: true }),
  }).catch((err) => ({ error: String(err).slice(0, 160) }));
  const gifts = await runGiftNotices(env as any).catch((err) => ({ error: String(err).slice(0, 160) }));
  return { ...mail, scheduled, quiet, gifts };
}, { adminOnly: true });
