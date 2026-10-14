import { work } from '../../_lib/work/route';
import { run } from '../../_lib/chat/mail';
import { runScheduled } from '../../_lib/chat/plus';

// Chat email: the welcome, the "started a conversation with you" email and the unread follow-up. The small drain Worker calls POST
// every 5 minutes with the agent key; everything is decided in _lib/chat/mail.ts and the result is written to act_settings chatmail:last.
// The same pass posts scheduled Chat messages and channel reminders that are due (chat/plus.ts).
export const onRequestPost = work(async ({ env }) => {
  const scheduled = await runScheduled(env as any).catch((err) => ({ error: String(err).slice(0, 160) }));
  return { ...((await run(env)) as any), scheduled };
}, { adminOnly: true });
