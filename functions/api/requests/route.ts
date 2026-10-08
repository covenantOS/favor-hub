// "Make a request": one box for every ask. The hub suggests where it goes, the person confirms.
//   board      Will's request board (website, portal, hub, KPI dashboard, Blackbaud data, anything technical)
//   marketing  the Marketing team's Asana form (design, print, social, video, newsletter content)
//   expense    an expense request (purchases, travel, reimbursements)
// Workers AI reads the request; keyword rules decide when it does not answer. Every suggestion and the
// person's choice are kept in request_routes.
import { hitRateLimit } from '../../_lib/auth';
import { HttpError, asTrimmed, clientIp, errorJson, handleError, json, newId, nowIso, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

type Route = 'board' | 'marketing' | 'expense';
const ROUTES: Route[] = ['board', 'marketing', 'expense'];
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const PROMPT = `You sort requests from the staff of Favor International, a Christian missions nonprofit, to the team that does the work.
Answer with exactly one word: board, marketing, or expense.

board: work for Will Hamilton, the Lead Developer. The website favorintl.org (pages, words on a page, forms, giving pages, job postings, broken links, errors), the partner portal my.favorintl.org, the staff hub and its tools, the KPI dashboard, Blackbaud and Raiser's Edge (records, lists, queries, reports pulled from Blackbaud), GoHighLevel and email automation setup, logins, integrations, spreadsheets of data, anything technical or broken.
marketing: work for the Marketing team. Graphic design, printed pieces, flyers, brochures, banners, mailers, appeal letters, thank-you packets, newsletter articles and layout, social media posts, videos, photos, slide decks, event and campaign materials, merchandise.
expense: buying something or spending money: purchases, travel costs, hotels, flights, mileage, reimbursements, payment approvals.

Putting finished marketing content onto the website (for example adding a new video to a web page) is board. When unsure, answer board.`;

const WORDS: Record<Route, RegExp[]> = {
  board: [
    /\bweb ?site\b/i, /\bweb ?page\b/i, /favorintl\.org/i, /\bportal\b/i, /\bhub\b/i, /\bdashboard\b/i, /\bkpi\b/i,
    /\bblackbaud\b/i, /raiser'?s edge/i, /\bquer(y|ies)\b/i, /\blist of (partners|donors|churches|people)\b/i, /\bpull (a|the) (list|report)\b/i,
    /\blog ?in\b/i, /\bpassword\b/i, /\bbug\b/i, /\bbroken\b/i, /\berror\b/i, /\blink\b/i, /\bform\b/i, /\bgiving page\b/i, /\bdonat(e|ion) page\b/i,
    /\bjob post/i, /\bcareers?\b/i, /\bintegrat/i, /\bgohighlevel\b|\bghl\b/i, /\bautomation\b/i, /\bduplicate record/i, /\bmerge\b/i, /\bapp\b/i,
  ],
  marketing: [
    /\bflyers?\b/i, /\bbrochures?\b/i, /\bdesign\b/i, /\bgraphic/i, /\blogo\b/i, /\bbanners?\b/i, /\bposters?\b/i, /\bprint(ed|ing)?\b/i,
    /\bmailers?\b/i, /\bpostcards?\b/i, /\bnewsletter\b/i, /\bsocial\b/i, /\binstagram\b/i, /\bfacebook\b/i, /\bvideos?\b/i, /\bphotos?\b/i,
    /\bslides?\b|\bdeck\b|\bpowerpoint\b/i, /\bcanva\b/i, /\bmerch/i, /\bt-?shirts?\b/i, /\bbooth\b/i, /\bcampaign\b/i, /\bappeal letter/i,
    /\bthank-?you packets?\b/i, /\breels?\b/i, /\bemail blast\b|\be-?blast\b/i, /\binvitations?\b/i,
  ],
  expense: [
    /\breimburs/i, /\bexpense\b/i, /\bpurchase\b/i, /\bbuy\b|\bbought\b/i, /\bplane tickets?\b|\bflights?\b/i, /\bhotel\b/i, /\bmileage\b/i,
    /\bper diem\b/i, /\binvoice\b/i, /\bpay for\b/i, /\bcredit card\b/i, /\btravel (cost|expense)/i,
  ],
};

function byWords(text: string): Route | null {
  const score = (r: Route) => WORDS[r].filter((re) => re.test(text)).length;
  const scores = ROUTES.map((r) => [r, score(r)] as const).sort((a, b) => b[1] - a[1]);
  if (!scores[0][1]) return null;
  if (scores[1][1] === scores[0][1]) return scores.some(([r, s]) => r === 'board' && s === scores[0][1]) ? 'board' : scores[0][0];
  return scores[0][0];
}

async function byAi(env: Env, text: string): Promise<Route | null> {
  if (!env.AI) return null;
  const run = env.AI.run(MODEL, {
    messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: text.slice(0, 2000) },
    ],
    max_tokens: 5,
    temperature: 0,
  }) as Promise<{ response?: string }>;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000));
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
    let route = await byAi(env, text);
    let how = 'ai';
    if (!route) {
      route = byWords(text);
      how = route ? 'words' : 'default';
    }
    route = route || 'board';
    const user = hubUserOf(request);
    const id = newId('rte');
    await env.DB.prepare('INSERT INTO request_routes (id, at, email, name, text, suggested, how) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, nowIso(), user?.email || '', user?.name || '', text, route, how)
      .run();
    return json({ ok: true, id, route, how });
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
