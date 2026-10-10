import { HttpError } from '../../_lib/http';
import { logContact, parseContact } from '../../_lib/mobile/contact';
import { claimWrite, clientIdOf, dropWrite, finishWrite, jsonBody, mobile } from '../../_lib/mobile/route';

// Record a call, visit or text (mobile-v1.yaml, logContact). Goes through the Work Center's entry path; a repeat client_id returns the stored answer.
export const onRequestPost = mobile(
  async ({ request, ctx, fid, user, waitUntil }) => {
    const b = await jsonBody(request);
    const clientId = clientIdOf(b.client_id);
    const input = parseContact(b);
    const claim = await claimWrite(ctx.env, user.email, clientId, 'contact');
    if ('stored' in claim) return claim.stored as Record<string, unknown>;
    try {
      const result = await logContact(ctx, fid, input, `m:${clientId}`, waitUntil);
      await finishWrite(ctx.env, user.email, clientId, result);
      return result;
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) await finishWrite(ctx.env, user.email, clientId, { recorded: true, repeat: true }).catch(() => undefined);
      else await dropWrite(ctx.env, user.email, clientId);
      throw err;
    }
  },
  { write: true }
);
