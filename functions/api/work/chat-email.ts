import { work } from '../../_lib/work/route';
import { run } from '../../_lib/chat/mail';

// Chat email: the welcome, the "started a conversation with you" email and the unread follow-up. The small drain Worker calls POST
// every 5 minutes with the agent key; everything is decided in _lib/chat/mail.ts and the result is written to act_settings chatmail:last.
export const onRequestPost = work(async ({ env }) => (await run(env)) as any, { adminOnly: true });
