import { HttpError } from '../../../../_lib/http';
import { claimWrite, clientIdOf, dropWrite, finishWrite, jsonBody, mobile, param } from '../../../../_lib/mobile/route';
import { markDone } from '../../../../_lib/mobile/today';

// Mark a thank-you or follow-up done (mobile-v1.yaml, markDone). A repeat client_id returns the stored answer.
export const onRequestPost = mobile(
  async ({ request, ctx, fid, user, params, waitUntil }) => {
    const clientId = clientIdOf((await jsonBody(request)).client_id);
    const claim = await claimWrite(ctx.env, user.email, clientId, 'done');
    if ('stored' in claim) return claim.stored as Record<string, unknown>;
    try {
      const result = { done: true, ...(await markDone(ctx, fid, param(params, 'id'), `m:${clientId}`, waitUntil)) };
      await finishWrite(ctx.env, user.email, clientId, result);
      return result;
    } catch (err) {
      // A 409 (already done) is an answer, not a failure to retry; keep it so the repeat gets the same one.
      if (!(err instanceof HttpError && err.status === 409)) await dropWrite(ctx.env, user.email, clientId);
      else await finishWrite(ctx.env, user.email, clientId, { done: true, repeat: true }).catch(() => undefined);
      throw err;
    }
  },
  { write: true }
);
