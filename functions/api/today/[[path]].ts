// Today's cross-app lists and the hand-off.
//   GET  /api/today/inbox?part=fast|mail       the Inbox (fast: this hub's tables; mail: Gmail, drawn when it lands)
//   POST /api/today/inbox/clear   { id, undo? } clears one item at its source (Undo puts it back where the source allows)
//   GET  /api/today/waiting?part=fast|mail     the Waiting on list
//   POST /api/today/waiting/nudge { id, text }  one nudge in the line's own channel
//   POST /api/today/waiting/stop  { id, undo? } stop waiting on a line (its source is untouched)
//   GET  /api/today/people                     who something can be handed to
//   POST /api/today/handoff       { kind, id, to, note, title?, forward? }
//   GET  /api/today/handoff/<id>               one hand-off with its context (giver or receiver only)
//   POST /api/today/handoff/<id>/pick          the receiver picked it up
//   GET  /api/today/handoffs                   hand-offs this person gave in the last 30 days
//   GET  /api/today/partner-mail?cid=          the partner page: this person's own email with the partner and emails naming them
//   POST /api/today/mention-logged { cid, source }  a prefilled contact from the partner timeline was saved
// Signed in staff only; field accounts are turned away by the middleware's field list.
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { sameSite } from '../../_lib/work/route';
import { clearItem, fastItems, mailItems, unclearItem } from '../../_lib/integrations/inbox';
import { fastWaiting, mailWaiting, nudge, stopWaiting } from '../../_lib/integrations/waiting';
import { givenBy, handOff, handoffFor, pickUp, syncPickups } from '../../_lib/integrations/handoff';
import { peopleFor } from '../../_lib/integrations/ping';
import { mailEvents, noteLogged } from '../../_lib/integrations/mentions';

const body = async (request: Request): Promise<Record<string, unknown>> => ((await request.json().catch(() => ({}))) || {}) as Record<string, unknown>;
const NO_STORE = { 'Cache-Control': 'private, no-store' };
/** Gmail answers in under a second most of the time; a slow answer gives an empty Mail part and Today tries again on the next load. */
const capped = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> => Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

export const onRequest: PagesFunction<Env> = async ({ request, env, params, waitUntil }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    if (user.role === 'field') return errorJson('forbidden', 'That is not part of the field staff app.', 403);
    if (user.via === 'agent') return errorJson('forbidden', 'Today lists belong to a person.', 403);
    if (!sameSite(request)) return errorJson('cross_site', 'That change did not come from FavorOS. Reload the page and try again.', 403);
    const path = ([] as string[]).concat((params.path as string[] | string) || []);
    const [a = '', b = '', c = ''] = path;
    const method = request.method.toUpperCase();
    const part = new URL(request.url).searchParams.get('part') || 'fast';

    if (a === 'inbox' && !b && method === 'GET') {
      if (part === 'mail') {
        const r = await capped(mailItems(env, user), 6000, { items: [], connected: true, slow: true } as { items: never[]; connected: boolean; slow?: boolean });
        return json({ ok: true, part, ...r }, 200, NO_STORE);
      }
      waitUntil(syncPickups(env, user.email).catch(() => undefined));
      return json({ ok: true, part, items: await fastItems(env, request, user) }, 200, NO_STORE);
    }
    if (a === 'inbox' && b === 'clear' && method === 'POST') {
      const x = await body(request);
      if (x.undo) await unclearItem(env, user, String(x.id || ''));
      else await clearItem(env, user, String(x.id || ''));
      return json({ ok: true });
    }
    if (a === 'waiting' && !b && method === 'GET') {
      if (part === 'mail') {
        const r = await capped(mailWaiting(env, user), 6000, { items: [], connected: true, slow: true } as { items: never[]; connected: boolean; slow?: boolean });
        return json({ ok: true, part, ...r }, 200, NO_STORE);
      }
      return json({ ok: true, part, items: await fastWaiting(env, request, user) }, 200, NO_STORE);
    }
    if (a === 'waiting' && b === 'nudge' && method === 'POST') {
      const x = await body(request);
      return json({ ok: true, ...(await nudge(env, request, user, x.id, x.text)) });
    }
    if (a === 'waiting' && b === 'stop' && method === 'POST') {
      const x = await body(request);
      await stopWaiting(env, user, x.id, !!x.undo);
      return json({ ok: true });
    }
    if (a === 'people' && method === 'GET') return json({ ok: true, people: await peopleFor(env, user.email) }, 200, NO_STORE);
    if (a === 'handoff' && !b && method === 'POST') {
      const x = await body(request);
      const row = await handOff(env, request, user, { kind: x.kind, id: x.id, to: x.to, note: x.note, title: x.title, forward: x.forward });
      return json({ ok: true, handoff: { id: row.id, to: row.to_email, name: row.to_name, channel: row.channel, moved: row.moved, href: row.href } });
    }
    if (a === 'handoff' && b && !c && method === 'GET') {
      const row = await handoffFor(env, user, b);
      return json({ ok: true, handoff: row, mine: row.to_email === user.email.toLowerCase() }, 200, NO_STORE);
    }
    if (a === 'handoff' && b && c === 'pick' && method === 'POST') {
      const row = await pickUp(env, user, b);
      if (!row) return errorJson('not_found', 'That hand-off is not yours.', 404);
      return json({ ok: true, picked_at: row.picked_at, href: row.href });
    }
    if (a === 'handoffs' && method === 'GET') return json({ ok: true, handoffs: await givenBy(env, user.email) }, 200, NO_STORE);
    // The partner page's timeline: this person's own email with the partner (contacts to offer for the log) and emails naming them.
    if (a === 'partner-mail' && method === 'GET') {
      const { requireWork } = await import('../../_lib/work/gate');
      await requireWork(env, request);
      const cid = new URL(request.url).searchParams.get('cid') || '';
      const r = await capped(mailEvents(env, user, cid), 6000, { events: [], connected: true });
      return json({ ok: true, ...r }, 200, NO_STORE);
    }
    // A prefilled contact from the timeline was saved: the line shows as added to the contact log.
    if (a === 'mention-logged' && method === 'POST') {
      const { requireWork } = await import('../../_lib/work/gate');
      await requireWork(env, request);
      const x = await body(request);
      await noteLogged(env, user.email, String(x.cid || ''), String(x.source || ''));
      return json({ ok: true });
    }
    return errorJson('not_found', 'No such route.', 404);
  } catch (err) {
    return handleError(err);
  }
};
