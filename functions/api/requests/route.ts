// "Make a request": one box for every ask. The hub suggests where it goes, the person confirms.
//   board      Will's request board (website, portal, hub, KPI dashboard, Blackbaud data, anything technical)
//   marketing  the Marketing team's Asana form (design, print, social, video, newsletter content)
//   expense    an expense request (purchases, travel, reimbursements)
// Workers AI reads the request; keyword rules decide when it does not answer. Every suggestion and the
// person's choice are kept in request_routes.
import { hitRateLimit } from '../../_lib/auth';
import { aiFor } from '../../_lib/ai/guard';
import { HttpError, asTrimmed, clientIp, errorJson, handleError, json, newId, nowIso, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { easternDay, routeByWords, suggestFill, suggestOwner, type Fill, type OwnerGuess } from '../../_lib/requests/suggest';

type Route = 'board' | 'marketing' | 'expense';
const ROUTES: Route[] = ['board', 'marketing', 'expense'];
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const PROMPT = `You sort requests from the staff of Favor International, a Christian missions nonprofit, to the team that does the work.
Answer with exactly one word: board, marketing, or expense.

board: work for Will Hamilton, the Lead Developer. The website favorintl.org (pages, words on a page, forms, giving pages, job postings, broken links, errors), the partner portal my.favorintl.org, FavorOS and its tools, the KPI dashboard, Blackbaud and Raiser's Edge (records, lists, queries, reports pulled from Blackbaud), GoHighLevel and email automation setup, logins, integrations, spreadsheets of data, anything technical or broken.
marketing: work for the Marketing team. Graphic design, printed pieces, flyers, brochures, banners, mailers, appeal letters, thank-you packets, newsletter articles and layout, social media posts, videos, photos, slide decks, event and campaign materials, merchandise.
expense: buying something or spending money: purchases, travel costs, hotels, flights, mileage, reimbursements, payment approvals.

Putting finished marketing content onto the website (for example adding a new video to a web page) is board. When unsure, answer board.`;

function byWords(text: string): Route | null {
  return routeByWords(text);
}

async function byAi(env: Env, text: string): Promise<Route | null> {
  if (!env.AI) return null;
  const run = aiFor(env.AI, 'request-route')!.run(MODEL, {
    messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: text.slice(0, 2000) },
    ],
    max_tokens: 5,
    temperature: 0,
  }) as Promise<{ response?: string }>;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
  try {
    const out = await Promise.race([run, timeout]);
    const word = String((out as { response?: string } | null)?.response || '').toLowerCase().match(/board|marketing|expense/);
    return word ? (word[0] as Route) : null;
  } catch (err) {
    console.error('[route] ai', err);
    return null;
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (await hitRateLimit(env, `route:${clientIp(request)}`, 40, 600)) {
      return errorJson('slow_down', 'Too many requests at once. Wait a minute and try again.', 429);
    }
    const body = (await request.json().catch(() => ({}))) as { text?: unknown };
    const text = asTrimmed(body.text, 'text', 4000);
    if (text.length < 2) throw new HttpError(400, 'too_short', 'Say a little about what you need.');
    // Keyword rules answer at once when they are sure; the model is asked only when the words say nothing.
    let route = byWords(text);
    let how = 'words';
    if (!route) {
      route = await byAi(env, text);
      how = route ? 'ai' : 'default';
    }
    route = route || 'board';
    const user = hubUserOf(request);
    const id = newId('rte');
    // The board's form fills itself out from the words: kind, where, summary, who sees it, timing, plus an owner and a due date.
    const today = easternDay();
    let fill: (Fill & { owner: OwnerGuess | null }) | null = null;
    {
      const f = suggestFill(text, today);
      fill = { ...f, owner: await suggestOwner(env, f.surface, today, route).catch(() => null) };
    }
    const stamp = nowIso();
    try {
      await env.DB.prepare('INSERT INTO request_routes (id, at, email, name, text, suggested, how, fill) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, stamp, user?.email || '', user?.name || '', text, route, how, fill ? JSON.stringify(fill) : '')
        .run();
    } catch {
      // db/requests-fill.sql has not run yet: keep the route without the stored suggestion.
      await env.DB.prepare('INSERT INTO request_routes (id, at, email, name, text, suggested, how) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, stamp, user?.email || '', user?.name || '', text, route, how)
        .run();
    }
    return json({ ok: true, id, route, how, fill });
  } catch (err) {
    return handleError(err);
  }
};

/** The person's choice, which may differ from the suggestion. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as { id?: unknown; chosen?: unknown; request_id?: unknown };
    const id = asTrimmed(body.id, 'id', 40);
    const chosen = asTrimmed(body.chosen, 'chosen', 20) as Route;
    if (!ROUTES.includes(chosen)) throw new HttpError(400, 'bad_route', 'Unknown route.');
    const requestId = asTrimmed(body.request_id, 'request_id', 60, false) || null;
    await env.DB.prepare('UPDATE request_routes SET chosen = ?, chosen_at = ?, request_id = COALESCE(?, request_id) WHERE id = ?')
      .bind(chosen, nowIso(), requestId, id)
      .run();
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
};
