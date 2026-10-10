import { storeCapture } from '../../_lib/mobile/capture';
import { mobile } from '../../_lib/mobile/route';

// One check or reply-slip photo (mobile-v1.yaml, uploadCapture). Gift entry's private bucket under mobile/; see _lib/mobile/capture.ts.
export const onRequestPost = mobile(async ({ request, env, user }) => storeCapture(env, user.email, request), { write: true });
