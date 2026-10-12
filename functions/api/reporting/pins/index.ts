import { addPin, listPins, MAX_PINS } from '../../../_lib/hub/pins';
import { errorJson, handleError, json, type Env } from '../../../_lib/http';
import { hubUserOf } from '../../../_lib/session';

// My dashboard: the answers a person pinned from Favor Brain. Private to the person; the Brain keeps its own access
// rules, and a pin only keeps what that person was shown.
const MAX_BODY = 400_000;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    let pins: Awaited<ReturnType<typeof listPins>> = [];
    try {
      pins = await listPins(env, user.email);
    } catch {
      pins = [];
    }
    return json({ ok: true, pins, max: MAX_PINS });
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const raw = await request.text();
    if (raw.length > MAX_BODY) return errorJson('too_big', 'That answer is too large to pin.', 413);
    let body: { question?: unknown; title?: unknown; answer?: unknown } = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      return errorJson('bad_body', 'Send the pin as JSON.', 400);
    }
    const pin = await addPin(env, user.email, { question: body.question, title: body.title, answer: body.answer });
    return json({ ok: true, pin });
  } catch (err) {
    return handleError(err);
  }
};
