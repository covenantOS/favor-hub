// The routes of Chat's smarter side (see smart.ts). route.ts hands every request here first; a request that is not one of these
// returns null and the main router carries on.
//   GET|POST prefs                       { lang }  the language this person reads Chat in
//   POST translate                       { ids, lang?, force? }
//   POST channels/:id/catchup            { from, thread? }
//   POST messages/:id/remind             { when: { code | date, time } }
//   GET  entities?q=                     partners and funds for the composer (Work Center access only)
//   GET  owners                     whose contacts this person may log in Blackbaud
import { HttpError, json } from '../http';
import type { HubUser } from '../session';
import type { Ctx } from './route';
import { LANGS } from './translate';
import { catchUp, getLang, remindAbout, searchEntities, setLang, translateMessages } from './smart';
import { langOk } from './translate';

const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const body = async (request: Request): Promise<Record<string, any>> => {
  const b = await request.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, any>) : {};
};
const num = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'bad_id', 'That message id is not valid.');
  return n;
};

export async function smartRoute(ctx: Ctx, user: HubUser, method: string, url: URL): Promise<Response | null> {
  const { request, env, path } = ctx;
  const me = lower(user.email);
  const [a, b, c] = path;
  const ai = (ctx.ai || env.AI) as any;

  if (a === 'prefs' && !b) {
    if (method === 'GET') return json({ ok: true, lang: await getLang(env, me), langs: LANGS });
    if (method === 'POST' || method === 'PUT') {
      const lang = await setLang(env, me, (await body(request)).lang);
      return json({ ok: true, lang });
    }
  }

  if (a === 'translate' && !b && method === 'POST') {
    const input = await body(request);
    const lang = langOk(input.lang) ? input.lang : await getLang(env, me);
    if (!lang) throw new HttpError(400, 'no_lang', 'Pick the language you read Chat in first.');
    const ids = (Array.isArray(input.ids) ? input.ids : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0);
    return json({ ok: true, lang, items: await translateMessages(env, me, { lang, ids, force: input.force === true, membersOnly: user.role === 'field' }, ai) });
  }

  if (a === 'channels' && b && c === 'catchup' && method === 'POST') {
    const input = await body(request);
    return json({ ok: true, ...(await catchUp(env, user, b, { from: Number(input.from) || 0, thread: Number(input.thread) || 0 }, ai)) });
  }

  if (a === 'messages' && b && c === 'remind' && method === 'POST') {
    const r = await remindAbout(env, user, num(b), await body(request));
    return json({ ok: true, ...r });
  }

  if ((a === 'entities' || a === 'owners') && method === 'GET') {
    const { requireWork } = await import('../work/gate');
    const wu = await requireWork(env, request).catch(() => null);
    // A person without Work Center access sees a plain name where a card would be, and no partner list.
    if (!wu) return a === 'entities' ? json({ ok: true, items: [] }) : json({ ok: true, owners: [], mine: '' });
    const { mirrorQ } = await import('../work/partner');
    const q = mirrorQ(env);
    if (a === 'entities') {
      const { blackbaudRepo } = await import('../work/repo');
      const repo = blackbaudRepo(env);
      const items = await searchEntities(q, (t) => repo.partners(t, undefined, 6), url.searchParams.get('q') || '').catch(() => []);
      return json({ ok: true, items });
    }
    if (a === 'owners') {
      const { entryOwners, mayEnter } = await import('../work/entry');
      const { blackbaudRepo } = await import('../work/repo');
      const w: any = { env, repo: blackbaudRepo(env), actor: wu.actor, email: wu.email, scope: wu.scope, testCid: wu.testCid };
      const owners = (await entryOwners(env)).filter((o) => mayEnter(w, String(o.bb_fundraiser_id)));
      const mine = owners.find((o) => lower(o.email) === me);
      return json({ ok: true, owners: owners.map((o) => ({ fid: String(o.bb_fundraiser_id), name: o.name })), mine: mine ? String(mine.bb_fundraiser_id) : '' });
    }
  }
  return null;
}
