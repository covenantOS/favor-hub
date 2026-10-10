import { storeCapture } from '../../_lib/mobile/capture';
import { mobile } from '../../_lib/mobile/route';

// One check or reply-slip photo (mobile-v1.yaml, uploadCapture). Private bucket; see _lib/mobile/capture.ts for the stand-in note.
export const onRequestPost = mobile(async ({ request, env, user }) => storeCapture(env, user.email, request), { write: true });
