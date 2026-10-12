// Mail in FavorOS: the routes under /api/mail. Each signed-in person works in their own Gmail through their own Google grant
// (functions/_lib/hub/google.ts); FavorOS keeps no mail, only the snooze times (thread ids) in hub_mail_snooze.
//
//   GET    state                          connected, what the grant allows, whether changes are switched on, the signature
//   GET    count                          unread conversations in the inbox (the rail badge)
//   GET    labels                         system and own labels with unread counts
//   GET    threads?label=&q=&page=        one page of conversations (q is Gmail's search syntax)
//   GET    threads/:id                    the conversation: every message, its files, partner matches, draft ids
//   GET    messages/:mid/attachments/:aid one file (?name=&mime=, ?dl=1 to download)
//   POST   threads/:id/modify             {add:[label], remove:[label]}: archive, read, unread, star, labels
//   POST   threads/:id/trash | untrash
//   POST   threads/:id/snooze {until}     DELETE threads/:id/snooze puts it back now
//   POST   labels {name}                  a new label
//   POST   send                           {to,cc,bcc,subject,html,threadId?,replyTo?,files?,forward?,draftId?}
//   PUT    drafts                         {draftId?, to,cc,bcc,subject,html,threadId?,replyTo?} -> {draftId}
//   DELETE drafts/:id
//   GET    contacts?q=                    staff first, then the person's own Google contacts
//   GET    drive?q= | clips               the Drive library and the person's clips, to put a link in a message
//   GET    log-owners                     whose contacts this person may enter in the Work Center (Log as an action)
//
// Who may use it: hub setting mail.enabled (admins by default, staff, off). Changes and sending also need mail.write on (the
// default) and the person's gmail.modify grant; without it every change answers 403 mail_scope and the page asks for it.
import { effective } from '../admin/settings';
import { isTester } from '../testuser';
import { SAMPLE_TOKEN, sampleFetcher, samplePartners } from './sample';
import { HttpError, errorJson, handleError, json, nowIso, type Env } from '../http';
import { accessToken, mailLevel } from '../hub/google';
import { staffDirectory } from '../people';
import type { HubUser } from '../session';
import { GmailError, ROW_HEADERS, batchThreads, decodeEntities, gmail, parseAddrs, pool, shapeMessage, shapeThreadRow, type Addr, type Fetcher, type Gmail } from './gmail';
import { b64ToBytes, rawOf, validEmail, type OutFile } from './mime';
import { boxToken, listBoxes, removeBox } from './boxes';
import { partnerMap, type PartnerLookup } from './partners';
import { assign, assigned, defaultChat, defaultRequest, finishAssigned, mention, requestFrom, type Brief, type ChatPost, type MakeRequest } from './links';
import { applyLabels, bootstrap, catchUp, inboxFromCache, stateOf, FRESH_MS } from './sync';
import { idsFor, pruneRows, rowsFor, useRowStore } from './rows';
import { sanitizeHtml, textToHtml } from './sanitize';
import { amountsIn, askThread, freeSlots, briefing, commitments, entityCard, fileKind, fillTemplate, fundNames, giftMention, NEXT_STEP, readSearch, senderProfile, writingCheck } from './know';
import { freshText } from './smart';
import { assist, cardOf, classify, customsOf, decorate, forgetScan, isCat, isCustom, overview, saveSummary, savedSummary, smartView, tidy, TEXT_MODEL, waitingOn, type SmartCtx } from './smart';

export type MailMode = 'admins' | 'staff' | 'off';

export async function mailMode(env: Env): Promise<MailMode> {
  const v = (await effective(env, 'mail.enabled', undefined, 'admins').catch(() => 'admins')).toLowerCase();
  return v === 'staff' || v === 'off' ? v : 'admins';
}

export function mayUseMail(mode: MailMode, user: Pick<HubUser, 'role' | 'via'> | null): boolean {
  if (!user || mode === 'off' || user.via !== 'google') return false;
  return mode === 'staff' || user.role === 'admin';
}

export interface MailCtx {
  request: Request;
  env: Env;
  user: HubUser | null;
  path: string[];
  /** Answers for Google (Gmail, People, the token call); tests pass a stand-in. */
  fetcher?: Fetcher;
  /** Partners in the Blackbaud copy by email address; tests pass a stand-in. */
  partners?: PartnerLookup;
  /** Workers AI for the decision model and the text model; tests pass a stand-in. Defaults to the AI binding. */
  ai?: { run(model: string, input: unknown): Promise<unknown> };
  /** One partner's card (giving, holders); tests pass a stand-in. */
  partnerCard?: (id: string) => Promise<any>;
  /** The Blackbaud copy, read only; tests pass a stand-in. */
  mirror?: (sql: string, params?: unknown[]) => Promise<any[]>;
  giving?: SmartCtx['giving'];
  /** Work that may finish after the answer is sent (the history catch-up). Pages Functions pass waitUntil. */
  waitUntil?: (p: Promise<unknown>) => void;
  /** Chat notices and request cards; tests pass stand-ins so no real person is told. */
  chat?: ChatPost;
  makeRequest?: MakeRequest;
  /** Free and busy times by address; tests pass a stand-in. */
  freeBusy?: (emails: string[], from: string, to: string) => Promise<Record<string, any>>;
  /** Clip and Drive pickers; tests pass stand-ins. */
  drive?: (q: string) => Promise<unknown[]>;
  workOwners?: () => Promise<{ owners: Array<{ fid: string; name: string }>; mine: string }>;
}

const SYSTEM = ['INBOX', 'STARRED', 'SNOOZED', 'IMPORTANT', 'SENT', 'DRAFT', 'ALL', 'SPAM', 'TRASH'];
const SYSTEM_NAME: Record<string, string> = { INBOX: 'Inbox', STARRED: 'Starred', SNOOZED: 'Snoozed', IMPORTANT: 'Important', SENT: 'Sent', DRAFT: 'Drafts', ALL: 'All mail', SPAM: 'Spam', TRASH: 'Trash' };
const MAX_SEND = 24 * 1024 * 1024;
const PAGE = 20;

const scopeError = (need: 'read' | 'write') =>
  json({ ok: false, error: 'mail_scope', need, message: need === 'read' ? 'Allow FavorOS to read your mail first.' : 'Allow FavorOS to change and send your mail first.' }, 403);

async function readBody(request: Request): Promise<Record<string, any>> {
  const b = (await request.json().catch(() => ({}))) as unknown;
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, any>) : {};
}

function sameSite(request: Request): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return true;
  const origin = request.headers.get('origin');
  if (origin) return origin === new URL(request.url).origin;
  return request.headers.get('x-hub-request') === '1';
}

const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const ids = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => String(x)).filter((x) => /^[A-Za-z0-9_-]{1,80}$/.test(x)).slice(0, 10);
const tid = (v: string) => {
  if (!/^[A-Za-z0-9]{6,40}$/.test(v)) throw new HttpError(400, 'bad_id', 'That conversation was not found.');
  return v;
};
const addrs = (v: unknown): Addr[] =>
  (Array.isArray(v) ? v : [])
    .map((x: any) => (typeof x === 'string' ? { name: '', email: lower(x) } : { name: String(x?.name || '').slice(0, 120), email: lower(x?.email) }))
    .filter((a) => a.email)
    .slice(0, 100);

export async function handle(ctx: MailCtx): Promise<Response> {
  try {
    return await route(ctx);
  } catch (err) {
    if (err instanceof GmailError) {
      if (err.status === 403 && /insufficient|scope|metadata/i.test(err.reason + ' ' + err.message)) return scopeError(/metadata/i.test(err.message) ? 'read' : 'write');
      if (err.status === 404) return errorJson('not_found', 'That message is gone from Gmail.', 404);
      if (err.status === 429) return errorJson('busy', 'Gmail asked FavorOS to slow down. Try again in a minute.', 429);
      console.error('[mail] gmail', err.status, err.reason, err.message.slice(0, 160));
      return errorJson('gmail', 'Gmail did not answer. Try again. (' + err.status + (err.reason ? ' ' + err.reason : '') + ')', 502);
    }
    if (!(err instanceof HttpError)) console.error('[mail] failed', ctx.request.method, ctx.path.join('/'), String((err as any)?.message || err).slice(0, 200));
    return handleError(err);
  }
}

async function route(ctx: MailCtx): Promise<Response> {
  const { request, env, user, path } = ctx;
  const method = request.method.toUpperCase();
  const url = new URL(request.url);
  if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
  const mode = await mailMode(env);
  if (!mayUseMail(mode, user)) return errorJson('forbidden', mode === 'off' ? 'Mail is switched off.' : user.via !== 'google' ? 'Mail needs a Google sign-in.' : 'Mail is open to admins for now.', 403);
  if (!sameSite(request)) return errorJson('cross_site', 'That change did not come from FavorOS. Reload the page and try again.', 403);
  useRowStore(env.DB as any);
  void pruneRows();
  if (ctx.waitUntil && user) ctx.waitUntil(releaseDue(env, lower(user.email), ctx.fetcher || fetch).catch(() => undefined));
  const owner = lower(user.email);
  let me = owner;
  // The test users read a stored sample mailbox, never Gmail.
  const tester = isTester(owner);
  if (tester && !ctx.fetcher) ctx.fetcher = sampleFetcher(env, owner);
  if (tester && !ctx.partners) ctx.partners = (emails) => samplePartners(env, emails);
  // The test users have no Google Calendar: their busy times are their own FavorOS meetings.
  if (tester && !ctx.freeBusy) {
    ctx.freeBusy = async (emails, from, to) => {
      const out: Record<string, { busy: Array<{ start: string; end: string }> }> = {};
      const rows = await env.DB.prepare("SELECT host_email, invitees, starts_at, ends_at FROM hub_meetings WHERE starts_at >= ? AND starts_at <= ? AND status IN ('scheduled', 'live')").bind(from, to).all<{ host_email: string; invitees: string; starts_at: string; ends_at: string }>().catch(() => ({ results: [] as any[] }));
      for (const e of emails) out[e] = { busy: (rows.results || []).filter((r) => lower(r.host_email) === e || String(r.invitees).toLowerCase().includes(e)).map((r) => ({ start: r.starts_at, end: r.ends_at })) };
      return out;
    };
  }
  const fetcher = ctx.fetcher || fetch;
  const [a = '', b = '', c = '', d = ''] = path;

  const writeOn = (await effective(env, 'mail.write', undefined, 'on').catch(() => 'on')).toLowerCase() !== 'off';
  let tok = tester ? SAMPLE_TOKEN : await accessToken(env, owner);
  let level = tok ? mailLevel(tok.scopes) : { read: false, write: false, contacts: false, headers: false };
  // Another of the person's own mailboxes: the same routes answer for it, with its own token. Only its owner can ask.
  const mb = lower(url.searchParams.get('mb'));
  const onBox = !!mb && mb !== owner && !['state', 'boxes', 'from', 'contacts', 'drive', 'clips', 'log-owners'].includes(a);
  if (onBox) {
    const bt = await boxToken(env, owner, mb);
    if (!bt) return errorJson('no_mailbox', 'That mailbox is not connected.', 404);
    tok = bt;
    level = mailLevel(bt.scopes);
    me = mb;
  }

  if (a === 'state' && method === 'GET') {
    // The signature is read apart (GET signature), so the page does not wait for a second Gmail call before it draws.
    const signature = '';
    if (tok && level.headers && ctx.waitUntil) ctx.waitUntil(stateOf(env, me).then((st) => (st ? undefined : bootstrap(env, gmail(tok!.token, fetcher), me))).catch(() => undefined));
    return json({ ok: true, connected: !!tok, email: me, name: user.name || me, level, write: writeOn, signature, mailboxes: (await listBoxes(env, owner)).map((x) => ({ email: x.mailbox, name: x.name, color: x.color })) });
  }

  if (a === 'boxes' && !b && method === 'GET') {
    const list = await listBoxes(env, owner);
    const one = async (email: string, t: { token: string; scopes: string } | null) => {
      if (!t) return -1;
      const lv = mailLevel(t.scopes);
      try {
        return (await inboxCounts(gmail(t.token, fetcher), lv.read)).all;
      } catch {
        return -1;
      }
    };
    const own = await one(owner, tok);
    const others = await Promise.all(list.map(async (x) => ({ email: x.mailbox, name: x.name, color: x.color, unread: await one(x.mailbox, await boxToken(env, owner, x.mailbox).catch(() => null)) })));
    return json({ ok: true, boxes: [{ email: owner, name: user.name || owner, color: '', primary: true, unread: own }, ...others] });
  }
  if (a === 'boxes' && b && method === 'DELETE') {
    const gone = await removeBox(env, owner, decodeURIComponent(b));
    return gone ? json({ ok: true }) : errorJson('no_mailbox', 'That mailbox is not connected.', 404);
  }
  if (a === 'from' && method === 'GET') {
    // The addresses a message can go out from: each connected mailbox and the aliases Gmail lists for it.
    const list = await listBoxes(env, owner);
    const accounts: Array<{ mailbox: string; t: { token: string; scopes: string } | null }> = [{ mailbox: owner, t: tok }, ...(await Promise.all(list.map(async (x) => ({ mailbox: x.mailbox, t: await boxToken(env, owner, x.mailbox).catch(() => null) }))))];
    const out: Array<{ mailbox: string; email: string; name: string; default: boolean }> = [];
    for (const ac of accounts) {
      let rows: any[] = [];
      if (ac.t && mailLevel(ac.t.scopes).read) rows = ((await gmail(ac.t.token, fetcher).get('/settings/sendAs').catch(() => null))?.sendAs || []) as any[];
      if (!rows.length) rows = [{ sendAsEmail: ac.mailbox, displayName: ac.mailbox === owner ? user.name || '' : '', isDefault: true }];
      for (const r of rows) out.push({ mailbox: ac.mailbox, email: lower(r.sendAsEmail), name: String(r.displayName || (lower(r.sendAsEmail) === owner ? user.name || '' : '')), default: !!r.isDefault });
    }
    return json({ ok: true, from: out });
  }
  if (a === 'signature' && method === 'GET') {
    let signature = '';
    if (tok && level.read) {
      const s = await gmail(tok.token, fetcher).get('/settings/sendAs').catch(() => null);
      const main = (s?.sendAs || []).find((x: any) => x.isDefault) || (s?.sendAs || [])[0];
      signature = main?.signature ? sanitizeHtml(String(main.signature)) : '';
    }
    return json({ ok: true, signature }, 200, { 'Cache-Control': 'private, max-age=3600' });
  }
  if (a === 'contacts' && method === 'GET') return json({ ok: true, ...(await contacts(ctx, tok?.token || '', level.contacts, url.searchParams.get('q') || '')) });
  if (a === 'drive' && method === 'GET') {
    const q = url.searchParams.get('q') || '';
    if (ctx.drive) return json({ ok: true, files: await ctx.drive(q) });
    const { driveSearch } = await import('../chat/route');
    return json({ ok: true, files: await driveSearch(env as any, user, q) });
  }
  if (a === 'clips' && method === 'GET') {
    const r = await env.DB.prepare(`SELECT id, title, duration_ms, created_at FROM hub_clips WHERE owner_email = ? AND status IN ('ready', 'processing') ORDER BY created_at DESC LIMIT 30`).bind(me).all<{ id: string; title: string; duration_ms: number; created_at: string }>().catch(() => ({ results: [] as any[] }));
    const origin = url.origin;
    return json({ ok: true, clips: (r.results || []).map((x) => ({ id: x.id, title: x.title || 'Clip', duration: x.duration_ms ? `${Math.floor(x.duration_ms / 60000)}:${String(Math.round((x.duration_ms % 60000) / 1000)).padStart(2, '0')}` : '', when: String(x.created_at || '').slice(0, 10), url: `${origin}/clips/${encodeURIComponent(x.id)}` })) });
  }
  if (a === 'log-owners' && method === 'GET') {
    if (ctx.workOwners) return json({ ok: true, ...(await ctx.workOwners()) });
    const { requireWork } = await import('../work/gate');
    const { entryOwners, mayEnter } = await import('../work/entry');
    const wu = await requireWork(env, request).catch(() => null);
    if (!wu) return json({ ok: true, owners: [], mine: '' });
    const ctxw: any = { env, actor: wu.actor, email: wu.email, scope: wu.scope, testCid: wu.testCid };
    const owners = (await entryOwners(env)).filter((o) => mayEnter(ctxw, String(o.bb_fundraiser_id)));
    const mine = owners.find((o) => lower(o.email) === me);
    return json({ ok: true, owners: owners.map((o) => ({ fid: String(o.bb_fundraiser_id), name: o.name })), mine: mine ? String(mine.bb_fundraiser_id) : '' });
  }

  if (!tok) return json({ ok: false, error: 'mail_connect', need: 'read', message: 'Connect your Google account to see your mail here.' }, 403);
  const gm = gmail(tok.token, fetcher);
  const needRead = () => (level.read ? null : scopeError('read'));
  const needWrite = () => (!writeOn ? errorJson('mail_readonly', 'Changing and sending mail from FavorOS is switched off. Open the message in Gmail.', 403) : level.write ? null : scopeError('write'));

  const smartCtx: SmartCtx = { env, me, name: user.name || me, ai: ctx.ai || (env.AI as any), partners: ctx.partners, giving: ctx.giving };
  const runModel = async (system: string, userText: string, max: number): Promise<string> => {
    const ai = smartCtx.ai;
    if (!ai) return '';
    const out: any = await ai.run(TEXT_MODEL, { messages: [{ role: 'system', content: system }, { role: 'user', content: userText }], max_tokens: max, temperature: 0.3 });
    return String(out?.response ?? out?.result?.response ?? '').trim();
  };
  const mq = async (sql: string, params: unknown[] = []): Promise<any[]> => {
    if (ctx.mirror) return ctx.mirror(sql, params);
    const { mirror } = await import('../foundations/blackbaud');
    return mirror<any>(env, sql, params);
  };

  if (a === 'count' && method === 'GET') {
    if (level.write) await wakeDue(env, gm, me).catch(() => undefined);
    const c = await inboxCounts(gm, level.read);
    remember(me, c.all);
    return json({ ok: true, unread: c.all, all: c.all });
  }

  if (a === 'labels' && method === 'GET') {
    const hit = LABELS.get(me);
    if (hit && Date.now() - hit.at < 45000 && !url.searchParams.get('fresh')) return json({ ok: true, labels: hit.labels, cached: true });
    try {
      const list = await gm.get('/labels');
      const mine = (list.labels || []).filter((l: any) => l.type === 'user' && l.labelListVisibility !== 'labelHide');
      const want = ['INBOX', 'DRAFT', 'SPAM', ...mine.map((l: any) => l.id)].slice(0, 40);
      const [got, inbox] = await Promise.all([pool(want, 4, (id) => gm.get('/labels/' + encodeURIComponent(id)).catch(() => null)), inboxCounts(gm, level.read, true)]);
      remember(me, inbox.all);
      const by = new Map(got.filter(Boolean).map((l: any) => [l.id, l]));
      const sys = SYSTEM.map((id) => ({
        id,
        name: SYSTEM_NAME[id],
        type: 'system',
        unread: id === 'INBOX' ? inbox.all : id === 'SPAM' ? Number(by.get(id)?.threadsUnread) || 0 : 0,
        ...(id === 'INBOX' ? { unreadAll: inbox.all, unreadPrimary: inbox.primary } : {}),
        total: id === 'DRAFT' ? Number(by.get(id)?.threadsTotal) || 0 : 0,
      }));
      const own = mine
        .map((l: any) => ({ id: l.id, name: l.name, type: 'user', unread: Number(by.get(l.id)?.threadsUnread) || 0, total: Number(by.get(l.id)?.threadsTotal) || 0, color: l.color?.backgroundColor || '' }))
        .sort((x: any, y: any) => x.name.localeCompare(y.name));
      const labels = [...sys, ...own];
      if (LABELS.size > 200) LABELS.clear();
      LABELS.set(me, { at: Date.now(), labels });
      return json({ ok: true, labels });
    } catch (err) {
      if (!(err instanceof GmailError)) throw err;
      console.error('[mail] labels', err.status, err.reason);
      // Gmail did not answer: the saved inbox gives the unread count, and the labels it last knew stand.
      const saved = LABELS.get(me)?.labels;
      if (saved) return json({ ok: true, labels: saved, cached: true });
      const cache = await inboxFromCache(env, me, 0, 200).catch(() => ({ rows: [] as any[], total: 0 }));
      const unread = cache.rows.filter((r: any) => r.unread).length;
      return json({ ok: true, cached: true, labels: SYSTEM.map((id) => ({ id, name: SYSTEM_NAME[id], type: 'system', unread: id === 'INBOX' ? unread : 0, total: 0, ...(id === 'INBOX' ? { unreadAll: unread, unreadPrimary: unread } : {}) })) });
    }
  }

  if (a === 'smart' && b === 'overview' && method === 'GET') {
    const r = needRead();
    if (r) return r;
    const days = Math.max(1, Math.min(30, Number(url.searchParams.get('days')) || 3));
    return json({ ok: true, ...(await overview(smartCtx, gm, days)) });
  }

  if (a === 'smart' && b === 'move' && method === 'POST') {
    const body = await readBody(request);
    const senders = (Array.isArray(body.senders) ? body.senders : []).map(lower).filter((x: string) => /^[^@\s]+@[^@\s]+$/.test(x)).slice(0, 100);
    const cat = String(body.cat || '');
    if (!senders.length || !isCat(cat)) throw new HttpError(400, 'nothing', 'Pick a category.');
    await env.DB.batch(senders.map((x: string) => env.DB.prepare('INSERT INTO hub_mail_cat (email, sender, cat, at) VALUES (?, ?, ?, ?) ON CONFLICT(email, sender) DO UPDATE SET cat = excluded.cat, at = excluded.at').bind(me, x, cat, nowIso())));
    forgetScan(me);
    return json({ ok: true, moved: senders.length });
  }

  if (a === 'partner' && b && !c && method === 'GET') {
    if (!/^\d{1,12}$/.test(b)) throw new HttpError(404, 'no_partner', 'No partner has that number.');
    if (ctx.partnerCard) return json({ ok: true, partner: cardOf(await ctx.partnerCard(b)) });
    const { requireWork } = await import('../work/gate');
    const wu = await requireWork(env, request).catch(() => null);
    if (!wu) return errorJson('forbidden', 'The Work Center is not open to you.', 403);
    const { loadPartner, mirrorQ } = await import('../work/partner');
    const p = await loadPartner(mirrorQ(env), b);
    if (!p) throw new HttpError(404, 'no_partner', 'No partner has that number.');
    return json({ ok: true, partner: cardOf(p) });
  }

  if (a === 'entity' && b === 'names' && method === 'GET') return json({ ok: true, funds: await fundNames(mq).catch(() => []) });
  if (a === 'entity' && !b && method === 'GET') {
    const card = await entityCard(env, mq, String(url.searchParams.get('kind') || ''), String(url.searchParams.get('q') || '')).catch(() => null);
    return card ? json({ ok: true, card }) : errorJson('not_found', 'Nothing in Favor matches that.', 404);
  }

  if (a === 'smart' && b === 'sender' && method === 'GET') {
    const r = needRead();
    if (r) return r;
    const e = lower(url.searchParams.get('email'));
    if (!/^[^@\s]+@[^@\s]+$/.test(e)) throw new HttpError(400, 'bad_email', 'That is not an email address.');
    return json({ ok: true, profile: await senderProfile(smartCtx, gm, e, String(url.searchParams.get('name') || '').slice(0, 120)) });
  }

  if (a === 'smart' && b === 'briefing' && method === 'GET') {
    const r = needRead();
    if (r) return r;
    const w = await waitingOn(smartCtx, gm, 3).catch(() => []);
    return json({ ok: true, briefing: await briefing(smartCtx, gm, runModel, w.length, url.searchParams.get('fresh') === '1') });
  }

  if (a === 'smart' && b === 'categories') {
    if (method === 'GET') return json({ ok: true, categories: await customsOf(env, me) });
    if (method === 'POST') {
      const body = await readBody(request);
      const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      const description = String(body.description || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (name.length < 2 || description.length < 8) throw new HttpError(400, 'describe', 'Give the category a name and say in a sentence what belongs in it.');
      if ((await customsOf(env, me)).length >= 8) throw new HttpError(400, 'limit', 'Eight categories of your own is the most.');
      const id = 'c_' + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
      await env.DB.prepare('INSERT INTO hub_mail_custom (email, id, name, description, created_at) VALUES (?, ?, ?, ?, ?)').bind(me, id, name, description, nowIso()).run();
      // Answers saved before this category existed do not know it, so the next look reads the mail again.
      await env.DB.prepare("UPDATE hub_mail_class SET last_mid = '' WHERE email = ?").bind(me).run().catch(() => undefined);
      forgetScan(me);
      return json({ ok: true, category: { id, name, description } });
    }
    if (method === 'DELETE' && isCustom(c)) {
      const id = String(c);
      await env.DB.batch([env.DB.prepare('DELETE FROM hub_mail_custom WHERE email = ? AND id = ?').bind(me, id), env.DB.prepare('DELETE FROM hub_mail_cat WHERE email = ? AND cat = ?').bind(me, id)]);
      forgetScan(me);
      return json({ ok: true });
    }
  }

  if (a === 'smart' && b === 'logged' && method === 'POST') {
    const body = await readBody(request);
    const t = tid(String(body.threadId || ''));
    await env.DB.prepare('INSERT INTO hub_mail_logged (email, thread_id, partner_id, at) VALUES (?, ?, ?, ?) ON CONFLICT(email, thread_id) DO UPDATE SET at = excluded.at').bind(me, t, String(body.partnerId || '').slice(0, 20), nowIso()).run();
    forgetScan(me);
    return json({ ok: true });
  }

  if (a === 'smart' && b === 'search' && method === 'POST') {
    const r = needRead();
    if (r) return r;
    const question = String((await readBody(request)).q || '').slice(0, 300);
    const read = await readSearch(runModel, question);
    if (!read) return json({ ok: true, understood: false, threads: [] });
    const list = await idsFor(gm, { q: read.q }, 60);
    let rows: any[] = await rowsFor(gm, me, list.threads, 6);
    const cls = await classify(smartCtx, rows, false);
    rows = decorate(rows, cls.by);
    if (read.partners) rows = rows.filter((x: any) => x.partner);
    if (read.major) rows = rows.filter((x: any) => x.major);
    return json({ ok: true, understood: true, q: read.q, partners: read.partners, major: read.major, threads: rows.slice(0, 40) });
  }

  if (a === 'smart' && b === 'times' && method === 'POST') {
    const body = await readBody(request);
    const guests = addrs(body.guests).map((x) => x.email).filter((e) => e.endsWith('@favorintl.org')).slice(0, 8);
    const minutes = Math.max(15, Math.min(240, Number(body.minutes) || 30));
    const days = Math.max(1, Math.min(21, Number(body.days) || 7));
    const from = new Date();
    const to = new Date(from.getTime() + days * 864e5);
    const who = [...new Set([owner, ...guests])];
    let busy: Array<Array<{ start: string; end: string }>> = [];
    let note = '';
    try {
      const { freeBusy } = await import('../meetcal');
      const cals = ctx.freeBusy ? await ctx.freeBusy(who, from.toISOString(), to.toISOString()) : await freeBusy(env as any, owner, who, from.toISOString(), to.toISOString());
      busy = who.map((e) => (cals as any)[e]?.busy || []);
      const blind = who.filter((e) => (cals as any)[e]?.error);
      if (blind.length) note = 'Calendars not shared: ' + blind.join(', ');
    } catch (e) {
      return errorJson('calendar', e instanceof HttpError ? e.message : 'Google Calendar did not answer.', 502);
    }
    return json({ ok: true, slots: freeSlots(busy, from, days, minutes), minutes, guests, note });
  }

  if (a === 'assigned' && !b && method === 'GET') return json({ ok: true, assigned: await assigned(env, owner) });
  if (a === 'assigned' && b && c === 'done' && method === 'POST') return (await finishAssigned(env, owner, b)) ? json({ ok: true }) : errorJson('not_found', 'That one is not open.', 404);

  if (a === 'threads' && b && ['assign', 'mention', 'request'].includes(c) && method === 'POST') {
    const r = needRead();
    if (r) return r;
    const id = tid(b);
    const body = await readBody(request);
    const t = await gm.get('/threads/' + id, { format: 'metadata', metadataHeaders: ['From', 'Subject'] });
    const msgs = (t.messages || []).filter((m: any) => !(m.labelIds || []).includes('DRAFT'));
    const lastM = msgs[msgs.length - 1] || {};
    const hdrOf = (m: any, n: string) => String((m?.payload?.headers || []).find((h: any) => h.name.toLowerCase() === n)?.value || '');
    const from = parseAddrs(hdrOf(lastM, 'from'))[0];
    const brief: Brief = {
      threadId: id,
      subject: hdrOf(msgs[0], 'subject') || '(no subject)',
      from: from ? from.name || from.email : '',
      snippet: decodeEntities(String(lastM.snippet || '')),
      link: `${url.origin}/mail/#/INBOX/${id}`,
    };
    const chat = ctx.chat || (await defaultChat(env));
    const note = String(body.note || '');
    if (c === 'assign') return json({ ok: true, ...(await assign(env, chat, owner, user.name || '', String(body.to || ''), brief, note)) });
    if (c === 'mention') return json({ ok: true, told: await mention(env, chat, owner, user.name || '', (Array.isArray(body.to) ? body.to : [body.to]).map(String), brief, note) });
    const made = await requestFrom(ctx.makeRequest || (await defaultRequest(env)), owner, user.name || '', brief, note, String(body.surface || 'dashboard'));
    return json({ ok: true, ...made });
  }

  if (a === 'check' && method === 'POST') {
    const body = await readBody(request);
    const to = addrs(body.to);
    const pm = await partnerMap(env, to.map((x) => x.email), ctx.partners);
    const first = to.map((x) => pm[x.email]).find(Boolean) || null;
    let lastGift = 0;
    if (first) {
      const g = await (smartCtx.giving ? smartCtx.giving([first.id]) : Promise.resolve({} as Record<string, any>)).catch(() => ({}) as Record<string, any>);
      lastGift = Number((g as any)[first.id]?.lastAmount) || 0;
    }
    let quoted: number[] = [];
    let internal = false;
    if (/^[A-Za-z0-9]{6,40}$/.test(String(body.threadId || ''))) {
      const t = await gm.get('/threads/' + String(body.threadId), { format: 'metadata', metadataHeaders: ['From', 'To', 'Cc'] }).catch(() => null);
      quoted = amountsIn((t?.messages || []).map((m: any) => m.snippet || '').join(' '));
      const people = (t?.messages || []).flatMap((m: any) => ['from', 'to', 'cc'].flatMap((h) => parseAddrs(String((m.payload?.headers || []).find((x: any) => x.name.toLowerCase() === h)?.value || '')))).map((x: any) => x.email);
      internal = people.length > 0 && people.every((e: string) => e.endsWith('@favorintl.org'));
    }
    const everyone = [...to, ...addrs(body.cc), ...addrs(body.bcc)];
    const warnings = writingCheck({ html: String(body.html || '').slice(0, 200000), subject: String(body.subject || ''), files: Math.max(0, Number(body.files) || 0), to, partnerName: first?.name || '', lastGift, quotedAmounts: quoted, recipients: everyone.length, threadInternal: internal, external: everyone.map((x) => x.email).filter((e) => !e.endsWith('@favorintl.org')) });
    return json({ ok: true, warnings });
  }

  if (a === 'templates') {
    if (method === 'GET') {
      const r = await env.DB.prepare('SELECT id, name, body FROM hub_mail_tpl WHERE email = ? ORDER BY name').bind(owner).all<{ id: string; name: string; body: string }>().catch(() => ({ results: [] as any[] }));
      return json({ ok: true, templates: r.results || [] });
    }
    if (method === 'POST' && !b) {
      const body = await readBody(request);
      const name = String(body.name || '').trim().slice(0, 60);
      const text = String(body.body || '').slice(0, 8000);
      if (!name || !text.trim()) throw new HttpError(400, 'empty', 'Give the template a name and some text.');
      const id = String(body.id || '').match(/^t_[a-z0-9]{8}$/) ? String(body.id) : 't_' + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
      await env.DB.prepare('INSERT INTO hub_mail_tpl (email, id, name, body) VALUES (?, ?, ?, ?) ON CONFLICT(email, id) DO UPDATE SET name = excluded.name, body = excluded.body').bind(owner, id, name, text).run();
      return json({ ok: true, id });
    }
    if (method === 'POST' && b === 'fill') {
      const body = await readBody(request);
      const to = addrs(body.to);
      const pm = await partnerMap(env, to.map((x) => x.email), ctx.partners);
      const first = to.map((x) => pm[x.email]).find(Boolean) || null;
      let d: any = { name: first?.name || to[0]?.name || '', me: user.name || '' };
      if (first) {
        const g = await (smartCtx.giving ? smartCtx.giving([first.id]) : Promise.resolve({} as Record<string, any>)).catch(() => ({}) as Record<string, any>);
        const x = (g as any)[first.id];
        if (x) d = { ...d, lastGift: x.lastAmount || 0, lastGiftDate: x.last || '', total: x.total || 0 };
      }
      return json({ ok: true, text: fillTemplate(String(body.body || ''), d) });
    }
    if (method === 'DELETE' && b) {
      await env.DB.prepare('DELETE FROM hub_mail_tpl WHERE email = ? AND id = ?').bind(owner, b).run();
      return json({ ok: true });
    }
  }

  if (a === 'later') {
    if (method === 'GET') {
      const r = await env.DB.prepare("SELECT id, mailbox, send_at, remind_days, state, payload FROM hub_mail_later WHERE email = ? AND state = 'waiting' ORDER BY send_at LIMIT 50").bind(owner).all<any>().catch(() => ({ results: [] as any[] }));
      return json({ ok: true, later: (r.results || []).map((x: any) => { const p = safeJson(x.payload); return { id: x.id, mailbox: x.mailbox, sendAt: x.send_at, remindDays: x.remind_days, to: p.to || [], subject: p.subject || '' }; }) });
    }
    const w = needWrite();
    if (w) return w;
    if (method === 'POST') {
      const body = await readBody(request);
      const at = new Date(String(body.sendAt || ''));
      if (!Number.isFinite(at.getTime()) || at.getTime() < Date.now() + 60000 || at.getTime() > Date.now() + 90 * 864e5) throw new HttpError(400, 'bad_time', 'Pick a time later than now.');
      const to = addrs(body.to);
      const bad = [...to, ...addrs(body.cc), ...addrs(body.bcc)].find((x) => !validEmail(x.email));
      if (bad) throw new HttpError(400, 'bad_address', `${bad.email} is not an email address.`);
      if (!to.length && !addrs(body.cc).length && !addrs(body.bcc).length) throw new HttpError(400, 'no_one', 'Add who it goes to.');
      // Files are not kept for later; a message with files goes now or from Gmail.
      if ((Array.isArray(body.files) && body.files.length) || (Array.isArray(body.forward) && body.forward.length)) throw new HttpError(400, 'files', 'A message with files cannot wait. Send it now.');
      const id = 'l_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      const keep = { to: body.to, cc: body.cc, bcc: body.bcc, subject: String(body.subject || '').slice(0, 900), html: sanitizeHtml(String(body.html || '').slice(0, 400000)), threadId: body.threadId, replyTo: body.replyTo, from: body.from };
      await env.DB.prepare('INSERT INTO hub_mail_later (id, email, mailbox, send_at, payload, remind_days, thread_id, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, owner, me === owner ? '' : me, at.toISOString(), JSON.stringify(keep), Math.max(0, Math.min(14, Number(body.remindDays) || 0)), String(body.threadId || '').slice(0, 40), 'waiting', nowIso()).run();
      return json({ ok: true, id, sendAt: at.toISOString() });
    }
    if (method === 'DELETE' && b) {
      await env.DB.prepare("UPDATE hub_mail_later SET state = 'cancelled' WHERE id = ? AND email = ? AND state = 'waiting'").bind(b, owner).run();
      return json({ ok: true });
    }
  }

  if (a === 'partner' && b && c === 'timeline' && method === 'GET') {
    if (!/^\d{1,12}$/.test(b)) throw new HttpError(404, 'no_partner', 'No partner has that number.');
    const email = lower(url.searchParams.get('email'));
    let p: any = null;
    if (ctx.partnerCard) p = await ctx.partnerCard(b);
    else {
      const { requireWork } = await import('../work/gate');
      const wu = await requireWork(env, request).catch(() => null);
      if (!wu) return errorJson('forbidden', 'The Work Center is not open to you.', 403);
      const { loadPartner, mirrorQ } = await import('../work/partner');
      p = await loadPartner(mirrorQ(env), b);
    }
    if (!p) throw new HttpError(404, 'no_partner', 'No partner has that number.');
    const items: Array<{ at: string; kind: string; text: string; id?: string }> = [];
    for (const g of (p.giving?.recent || []).slice(0, 10)) items.push({ at: String(g.date), kind: 'gift', text: `Gift ${'$' + Math.round(g.amount).toLocaleString('en-US')}${g.fund ? ', ' + g.fund : ''}` });
    for (const x of [...(p.actions?.recent || []), ...(p.actions?.open || [])].slice(0, 12)) items.push({ at: String(x.done || x.due || x.added), kind: /meet/i.test(x.category) ? 'meeting' : /call|phone/i.test(x.category) ? 'call' : 'action', text: `${x.category || x.type}: ${x.summary || ''}`.slice(0, 140) });
    if (email && /^[^@\s]+@[^@\s]+$/.test(email)) {
      const list = await idsFor(gm, { q: `from:${email} OR to:${email}` }, 12).catch(() => ({ threads: [] as any[], more: false }));
      for (const r of await rowsFor(gm, me, list.threads, 6)) items.push({ at: r.date.slice(0, 10), kind: 'mail', text: r.subject || '(no subject)', id: r.id });
    }
    items.sort((x, y) => y.at.localeCompare(x.at));
    return json({ ok: true, items: items.slice(0, 30) });
  }

  if (a === 'messages' && b && c === 'attachments' && d && path[4] === 'read' && method === 'GET') {
    const r = needRead();
    if (r) return r;
    if (!/^[A-Za-z0-9]{6,40}$/.test(b) || !/^[A-Za-z0-9_-]{8,2000}$/.test(d)) return errorJson('bad_id', 'That file was not found.', 404);
    const name = (url.searchParams.get('name') || 'file').slice(0, 160);
    const mime = (url.searchParams.get('mime') || '').toLowerCase().slice(0, 100);
    const subject = (url.searchParams.get('subject') || '').slice(0, 200);
    let dataUrl = '';
    if (/^image\/(png|jpeg|webp)$/.test(mime) && Number(url.searchParams.get('size') || 0) < 3_000_000) {
      const at = await gm.get(`/messages/${b}/attachments/${d}`);
      dataUrl = `data:${mime};base64,${String(at.data || '').replace(/-/g, '+').replace(/_/g, '/')}`;
    }
    const k = await fileKind(smartCtx.ai, name, mime, subject, dataUrl);
    return json({ ok: true, kind: k.kind, confidence: k.p, next: NEXT_STEP[k.kind] || null });
  }

  if (a === 'bulk' && method === 'POST') {
    const w = needWrite();
    if (w) return w;
    const done = await bulk(env, gm, me, level.read, await readBody(request));
    forgetCount(owner);
    return json(done);
  }

  if (a === 'threads' && !b && method === 'GET') {
    const label = (url.searchParams.get('label') || 'INBOX').slice(0, 80);
    let q = (url.searchParams.get('q') || '').slice(0, 500);
    const page = (url.searchParams.get('page') || '').slice(0, 200);
    const view = (url.searchParams.get('view') || '').slice(0, 30);
    const flags = (url.searchParams.get('f') || '').split(',').filter((x) => ['unread', 'starred', 'files', 'partner'].includes(x));
    const sort = url.searchParams.get('sort') === 'old' ? 'old' : url.searchParams.get('sort') === 'new' ? 'new' : '';
    if (q && !level.read) return scopeError('read');
    if (!level.read && !level.headers) return scopeError('read');
    if (level.write) await wakeDue(env, gm, me).catch(() => undefined);
    const snoozed = await env.DB.prepare('SELECT thread_id, until FROM hub_mail_snooze WHERE email = ? AND woke_at IS NULL').bind(me).all<{ thread_id: string; until: string }>().catch(() => ({ results: [] as any[] }));
    const sz = new Map((snoozed.results || []).map((r: any) => [r.thread_id, r.until]));
    const mark = (rows: any[]) => rows.map((r: any) => (sz.has(r.id) ? { ...r, snoozed: sz.get(r.id) } : r));
    // The smart views read the newest hundred conversations of the inbox (or the sent mail waiting on a reply).
    const smart = (view === 'needs' || view === 'waiting' || view === 'unlogged' || /^cat:/.test(view) || flags.includes('partner')) && !q && (label === 'INBOX' || view === 'waiting');
    if (smart) {
      if (!level.read) return scopeError('read');
      const days = Math.max(1, Math.min(30, Number(url.searchParams.get('days')) || 3));
      const v = await smartView(smartCtx, gm, { view, flags, sort, days });
      return json({ ok: true, threads: mark(v.threads), next: '', estimate: v.threads.length, scanned: v.scanned, pending: v.pending, level });
    }
    if (label === 'SNOOZED' && !q) return json({ ok: true, ...(await snoozedList(env, gm, me)) });
    if (flags.includes('unread')) q = (q + ' is:unread').trim();
    if (flags.includes('starred') && label !== 'STARRED') q = (q + ' is:starred').trim();
    if (flags.includes('files')) q = (q + ' has:attachment').trim();
    if (q && !level.read) return scopeError('read');
    const params: Record<string, string | string[] | undefined> = {};
    if (q) params.q = q;
    // All mail is no label at all (Gmail leaves out spam and trash unless asked).
    if (label === 'ALL') {
      /* no label */
    } else if (label === 'SPAM' || label === 'TRASH') {
      params.labelIds = label;
      params.includeSpamTrash = 'true';
    } else if (/^[A-Za-z0-9_-]+$/.test(label)) params.labelIds = label;
    // The newest INBOX conversations come from the saved inbox in D1 (sync.ts): one read, no wait for Gmail. A saved inbox older than
    // 20 seconds is served as it is while Gmail's history catches it up, and the answer says so, so the page asks again a moment later.
    if (label === 'INBOX' && !q && sort !== 'old' && (!page || /^c:\d+$/.test(page)) && level.headers) {
      let st = await stateOf(env, me);
      let stale = false;
      if (!st) {
        await bootstrap(env, gm, me, ctx.waitUntil);
        st = await stateOf(env, me);
      } else if (Date.now() - st.syncedAt > FRESH_MS) {
        const job = catchUp(env, gm, me, st).catch(() => undefined);
        if (ctx.waitUntil) {
          ctx.waitUntil(job);
          stale = true;
        } else await job;
        if (!stale) st = await stateOf(env, me);
      }
      const offset = page ? Number(page.slice(2)) : 0;
      const hit = await inboxFromCache(env, me, offset, PAGE);
      if (hit.rows.length || offset > 0) {
        const cut = offset + PAGE;
        const marked = decorate(hit.rows, (await classify(smartCtx, hit.rows, false)).by);
        return json({ ok: true, threads: mark(marked), next: cut < hit.total ? 'c:' + cut : st?.nextToken ? 'g:' + st.nextToken : '', estimate: hit.total, level, ...(stale ? { stale: true } : {}) });
      }
    }
    try {
    let listed: Array<{ id: string; historyId?: string }>;
    let next = '';
    let estimate = 0;
    if (sort === 'old') {
      // Gmail lists newest first, so the oldest page is read from the far end: every id (cheap), then one page of rows.
      const all = await idsFor(gm, params, 2000);
      const from = Math.max(0, Number(page.replace(/^o:/, '')) || 0);
      const rev = [...all.threads].reverse();
      listed = rev.slice(from, from + PAGE);
      next = from + PAGE < rev.length ? 'o:' + (from + PAGE) : '';
      estimate = rev.length;
    } else {
      const list = await gm.get('/threads', { ...params, maxResults: String(PAGE), pageToken: page.startsWith('g:') ? page.slice(2) : page || undefined });
      listed = list.threads || [];
      next = list.nextPageToken || '';
      estimate = Number(list.resultSizeEstimate) || 0;
    }
    const rows = await rowsFor(gm, me, listed, 5);
    const marked = label === 'INBOX' ? decorate(rows, (await classify(smartCtx, rows, false)).by) : rows;
    return json({ ok: true, threads: mark(marked), next, estimate, level });
    } catch (err) {
      if (!(err instanceof GmailError) || label !== 'INBOX' || q) throw err;
      console.error('[mail] list', err.status, err.reason, err.message.slice(0, 120));
      const hit = await inboxFromCache(env, me, 0, PAGE).catch(() => ({ rows: [] as any[], total: 0 }));
      if (!hit.rows.length) throw err;
      return json({ ok: true, threads: mark(decorate(hit.rows, (await classify(smartCtx, hit.rows, false)).by)), next: '', estimate: hit.total, level, offline: true });
    }
  }

  if (a === 'threads' && b && c === 'ask' && method === 'POST') {
    const r = needRead();
    if (r) return r;
    const id = tid(b);
    const q = String((await readBody(request)).q || '');
    const t = await gm.get('/threads/' + id, { format: 'full' });
    const text = (t.messages || []).map((m: any) => shapeMessage(m)).filter((m: any) => !m.draft).slice(-8).map((m: any) => `From ${m.from.name || m.from.email}, ${m.date.slice(0, 10)}:\n${freshText(m).slice(0, 1800)}`).join('\n\n---\n\n');
    const answer = await askThread(runModel, text, q).catch(() => '');
    return json({ ok: true, answer: answer || 'The model did not answer. Try again.' });
  }

  if (a === 'threads' && b && c === 'assist' && method === 'GET') {
    const r = needRead();
    if (r) return r;
    const id = tid(b);
    const t = await gm.get('/threads/' + id, { format: 'full' });
    const msgs = (t.messages || []).map((m: any) => shapeMessage(m));
    const real = msgs.filter((m: any) => !m.draft);
    const lastMid = real.length ? real[real.length - 1].id : '';
    const emails = real.map((m: any) => m.from.email).filter((e: string) => e && e !== me);
    const pm = await partnerMap(env, emails, ctx.partners);
    const partner = real.length ? pm[real[real.length - 1].from.email] || null : null;
    const old = await savedSummary(env, me, id, lastMid);
    let facts = '';
    if (partner) {
      const g = await (smartCtx.giving ? smartCtx.giving([partner.id]) : Promise.resolve({} as Record<string, any>)).catch(() => ({}) as Record<string, any>);
      const x = (g as any)[partner.id];
      if (x) facts = `${partner.name} has given ${'$' + Math.round(x.total).toLocaleString('en-US')} in all, the largest gift ${'$' + Math.round(x.max).toLocaleString('en-US')}, last gift ${x.last || 'unknown'}${x.lastAmount ? ' of ' + '$' + Math.round(x.lastAmount).toLocaleString('en-US') : ''}.`;
    }
    const out = await assist(smartCtx, msgs, partner, facts);
    // A saved summary stands in for the model on a second look; replies are written fresh each time.
    const summary = old || out.summary;
    if (out.summary && !old) await saveSummary(env, me, id, lastMid, out.summary);
    const lastIn = [...real].reverse().find((m: any) => m.from.email !== me);
    const lastMine = [...real].reverse().find((m: any) => m.from.email === me);
    const gift = partner && lastIn ? giftMention(lastIn.text || lastIn.snippet || '') : null;
    const promises = lastMine ? commitments(lastMine.text || lastMine.snippet || '', lastMine.date) : [];
    return json({ ok: true, summary, replies: out.replies, ask: out.ask, partner, gift, commitments: promises, facts });
  }

  if (a === 'threads' && b && !c && method === 'GET') {
    const id = tid(b);
    if (!level.read) {
      // Headers only: the page can still show who wrote and when, with a button to allow reading.
      const meta = await gm.get('/threads/' + id, { format: 'metadata', metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date'] });
      const msgs = (meta.messages || []).map((m: any) => ({ ...shapeMessage(m), html: '', text: '' }));
      return json({ ok: true, headersOnly: true, thread: { id, subject: msgs[0]?.subject || '', messages: msgs }, partners: await partnersFor(ctx, msgs, me), drafts: {} });
    }
    return json({ ok: true, ...(await buildThread(ctx, gm, me, id, await gm.get('/threads/' + id, { format: 'full' }))) });
  }

  // Up to 20 conversations at once for the page's read-ahead: one batch call to Gmail, and any that fail are read the ordinary way.
  if (a === 'threads' && b === 'batch' && method === 'POST') {
    const r = needRead();
    if (r) return r;
    const want = ids20((await readBody(request)).ids);
    const got = await batchThreads(tok.token, want, 'full', fetcher);
    const out = await pool(want, 4, async (id) => {
      try {
        return { id, ...(await buildThread(ctx, gm, me, id, got.get(id) || (await gm.get('/threads/' + id, { format: 'full' })))) };
      } catch {
        return null;
      }
    });
    return json({ ok: true, threads: out.filter(Boolean) });
  }

  if (a === 'messages' && b && c === 'attachments' && d && method === 'GET') {
    const r = needRead();
    if (r) return r;
    if (!/^[A-Za-z0-9]{6,40}$/.test(b) || !/^[A-Za-z0-9_-]{8,2000}$/.test(d)) return errorJson('bad_id', 'That file was not found.', 404);
    const at = await gm.get(`/messages/${b}/attachments/${d}`);
    const bytes = b64ToBytes(String(at.data || '').replace(/-/g, '+').replace(/_/g, '/'));
    const name = (url.searchParams.get('name') || 'file').replace(/[\r\n"\\/]/g, '_').slice(0, 160);
    const mime = (url.searchParams.get('mime') || 'application/octet-stream').toLowerCase().slice(0, 100);
    const inline = SAFE_INLINE.test(mime) && url.searchParams.get('dl') !== '1';
    return new Response(bytes, {
      headers: {
        'Content-Type': inline ? mime : 'application/octet-stream',
        'X-File-Kind': mime,
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      },
    });
  }

  if (a === 'threads' && b && c === 'modify' && method === 'POST') {
    const w = needWrite();
    if (w) return w;
    const body = await readBody(request);
    const add = ids(body.add);
    const remove = ids(body.remove);
    if (!add.length && !remove.length) throw new HttpError(400, 'nothing', 'Nothing to change.');
    const t = await gm.send('POST', `/threads/${tid(b)}/modify`, { addLabelIds: add, removeLabelIds: remove });
    await applyLabels(env, me, b, add, remove);
    forgetCount(me);
    forgetCount(owner);
    // Putting a snoozed thread back in the inbox ends the snooze.
    if (add.includes('INBOX')) await env.DB.prepare('UPDATE hub_mail_snooze SET woke_at = ? WHERE email = ? AND thread_id = ? AND woke_at IS NULL').bind(nowIso(), me, b).run().catch(() => undefined);
    return json({ ok: true, labelIds: [...new Set((t.messages || []).flatMap((m: any) => m.labelIds || []))] });
  }
  if (a === 'threads' && b && (c === 'trash' || c === 'untrash') && method === 'POST') {
    const w = needWrite();
    if (w) return w;
    await gm.send('POST', `/threads/${tid(b)}/${c}`);
    await applyLabels(env, me, b, c === 'trash' ? ['TRASH'] : ['INBOX'], c === 'trash' ? ['INBOX', 'UNREAD'] : ['TRASH']);
    forgetCount(me);
    forgetCount(owner);
    return json({ ok: true });
  }
  if (a === 'threads' && b && c === 'snooze') {
    const w = needWrite();
    if (w) return w;
    const id = tid(b);
    if (method === 'DELETE') {
      await gm.send('POST', `/threads/${id}/modify`, { addLabelIds: ['INBOX'], removeLabelIds: [] });
      await env.DB.prepare('UPDATE hub_mail_snooze SET woke_at = ? WHERE email = ? AND thread_id = ? AND woke_at IS NULL').bind(nowIso(), me, id).run();
      return json({ ok: true });
    }
    if (method === 'POST') {
      const sb = await readBody(request);
      if (sb.until === 'reply' || sb.until === 'gift') {
        const t = await gm.get('/threads/' + id, { format: 'metadata', metadataHeaders: ['From'] });
        const last = (t.messages || []).slice(-1)[0];
        const far = new Date(Date.now() + 365 * 864e5).toISOString();
        await gm.send('POST', `/threads/${id}/modify`, { addLabelIds: [], removeLabelIds: ['INBOX'] });
        await env.DB.batch([
          env.DB.prepare(`INSERT INTO hub_mail_snooze (email, thread_id, until, created_at, woke_at) VALUES (?, ?, ?, ?, NULL) ON CONFLICT(email, thread_id) DO UPDATE SET until = excluded.until, created_at = excluded.created_at, woke_at = NULL`).bind(me, id, far, nowIso()),
          env.DB.prepare(`INSERT INTO hub_mail_waits (email, thread_id, kind, until, last_mid, created_at, woke_at) VALUES (?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(email, thread_id, kind) DO UPDATE SET last_mid = excluded.last_mid, created_at = excluded.created_at, woke_at = NULL`).bind(me, id, String(sb.until), String(sb.partnerId || '').slice(0, 20), String(last?.id || ''), nowIso()),
        ]);
        forgetCount(me);
        forgetCount(owner);
        return json({ ok: true, until: far, wait: sb.until });
      }
      const until = new Date(String(sb.until || ''));
      if (!Number.isFinite(until.getTime()) || until.getTime() < Date.now() + 60000 || until.getTime() > Date.now() + 400 * 864e5) throw new HttpError(400, 'bad_time', 'Pick a time later than now.');
      await gm.send('POST', `/threads/${id}/modify`, { addLabelIds: [], removeLabelIds: ['INBOX'] });
      await env.DB.prepare(
        `INSERT INTO hub_mail_snooze (email, thread_id, until, created_at, woke_at) VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT(email, thread_id) DO UPDATE SET until = excluded.until, created_at = excluded.created_at, woke_at = NULL`
      ).bind(me, id, until.toISOString(), nowIso()).run();
      return json({ ok: true, until: until.toISOString() });
    }
  }

  if (a === 'labels' && !b && method === 'POST') {
    const w = needWrite();
    if (w) return w;
    const name = String((await readBody(request)).name || '').trim().slice(0, 100);
    if (!name) throw new HttpError(400, 'name', 'Give the label a name.');
    const l = await gm.send('POST', '/labels', { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' });
    return json({ ok: true, label: { id: l.id, name: l.name, type: 'user', unread: 0, total: 0 } });
  }

  // Undo send: a message is held for 15 seconds. The page releases it at 15 s (or on leaving the page); any request from the person, and the
  // five-minute pass, release a held message that is a minute old, so a closed tab never loses or sends it twice (one atomic claim sends it).
  if (a === 'hold' && !b && method === 'POST') {
    const w = needWrite();
    if (w) return w;
    const body = await readBody(request);
    const bad = [...addrs(body.to), ...addrs(body.cc), ...addrs(body.bcc)].find((x) => !validEmail(x.email));
    if (bad) throw new HttpError(400, 'bad_address', `${bad.email} is not an email address.`);
    if (!addrs(body.to).length && !addrs(body.cc).length && !addrs(body.bcc).length) throw new HttpError(400, 'no_one', 'Add who it goes to.');
    const id = 'h_' + crypto.randomUUID().replace(/-/g, '').slice(0, 14);
    // Files wait in the uploads bucket under this message's own key, 24 MB at most together, and are deleted once it is sent or undone.
    const held: Array<{ name: string; mime: string; key: string }> = [];
    let bytes = 0;
    for (const [n, f] of (Array.isArray(body.files) ? body.files : []).slice(0, 20).entries()) {
      const data = b64ToBytes(String(f?.data || ''));
      bytes += data.length;
      if (bytes > MAX_SEND) throw new HttpError(413, 'too_big', 'Files can add up to 24 MB. Share a big file from Drive instead.');
      const key = `mail-hold/${id}/${n}`;
      await env.UPLOADS.put(key, data);
      held.push({ name: String(f?.name || 'file').slice(0, 160), mime: String(f?.mime || 'application/octet-stream').slice(0, 100), key });
    }
    const keep = { to: body.to, cc: body.cc, bcc: body.bcc, subject: String(body.subject || '').slice(0, 900), html: sanitizeHtml(String(body.html || '').slice(0, 400000)), threadId: body.threadId, replyTo: body.replyTo, from: body.from, draftId: body.draftId, heldFiles: held, forward: Array.isArray(body.forward) ? body.forward.slice(0, 20) : [] };
    await env.DB.prepare('INSERT INTO hub_mail_held (id, owner, mailbox, payload, release_at, state, thread_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, owner, me === owner ? '' : me, JSON.stringify(keep), new Date(Date.now() + 60000).toISOString(), 'held', String(body.threadId || '').slice(0, 40), nowIso()).run();
    return json({ ok: true, id, releaseAt: new Date(Date.now() + 15000).toISOString() });
  }
  if (a === 'hold' && b && c === 'release' && method === 'POST') {
    const out = await releaseHeld(env, owner, b, fetcher);
    return out === 'gone' ? errorJson('not_found', 'That message is not waiting.', 404) : json({ ok: true, ...out });
  }
  if (a === 'hold' && b && method === 'DELETE') {
    const r = await env.DB.prepare("UPDATE hub_mail_held SET state = 'cancelled', payload = '{}' WHERE id = ? AND owner = ? AND state = 'held'").bind(b, owner).run();
    const undone = Number((r.meta as any)?.changes) > 0;
    if (undone) await dropHeldFiles(env, b);
    return json({ ok: true, undone });
  }

  if (a === 'send' && method === 'POST') {
    const w = needWrite();
    if (w) return w;
    const body = await readBody(request);
    const mail = await outMail(gm, from(await fromOf(gm, me, user, body)), body, true);
    const sent = await gm.send('POST', '/messages/send', { raw: rawOf(mail), threadId: body.threadId && /^[A-Za-z0-9]{6,40}$/.test(String(body.threadId)) ? String(body.threadId) : undefined });
    if (body.draftId && /^[A-Za-z0-9_-]{4,80}$/.test(String(body.draftId))) await gm.send('DELETE', '/drafts/' + String(body.draftId)).catch(() => undefined);
    return json({ ok: true, id: sent.id, threadId: sent.threadId });
  }

  if (a === 'drafts' && !b && method === 'PUT') {
    const w = needWrite();
    if (w) return w;
    const body = await readBody(request);
    const mail = await outMail(gm, from(await fromOf(gm, me, user, body)), body, false);
    const message: Record<string, string> = { raw: rawOf(mail) };
    if (body.threadId && /^[A-Za-z0-9]{6,40}$/.test(String(body.threadId))) message.threadId = String(body.threadId);
    const draftId = /^[A-Za-z0-9_-]{4,80}$/.test(String(body.draftId || '')) ? String(body.draftId) : '';
    const out = draftId ? await gm.send('PUT', '/drafts/' + draftId, { id: draftId, message }).catch((e) => (e instanceof GmailError && e.status === 404 ? null : Promise.reject(e))) : null;
    const made = out || (await gm.send('POST', '/drafts', { message }));
    return json({ ok: true, draftId: made.id, messageId: made.message?.id || '', threadId: made.message?.threadId || '' });
  }
  if (a === 'drafts' && b && method === 'DELETE') {
    const w = needWrite();
    if (w) return w;
    if (!/^[A-Za-z0-9_-]{4,80}$/.test(b)) throw new HttpError(400, 'bad_id', 'That draft was not found.');
    await gm.send('DELETE', '/drafts/' + b).catch((e) => (e instanceof GmailError && e.status === 404 ? undefined : Promise.reject(e)));
    return json({ ok: true });
  }

  return errorJson('not_found', 'No such mail route.', 404);
}

const safeJson = (t: string): Record<string, any> => {
  try {
    return JSON.parse(t) as Record<string, any>;
  } catch {
    return {};
  }
};

const SAFE_INLINE = /^(image\/(png|jpeg|gif|webp)|application\/pdf|audio\/(mpeg|mp4|wav|webm|ogg)|video\/(mp4|webm))$/;

function fileUrl(mid: string, f: { id: string; name: string; mime: string }) {
  return `/api/mail/messages/${mid}/attachments/${f.id}?name=${encodeURIComponent(f.name)}&mime=${encodeURIComponent(f.mime)}`;
}

/** The message to send or save: addresses checked, the reply headers read from Gmail, uploaded and forwarded files gathered. */
const from = (f: { name: string; email: string }) => f;

/** Who a message goes out as: the mailbox's own address, or one of the aliases Gmail lists for it. */
async function fromOf(gm: Gmail, me: string, user: HubUser, body: Record<string, any>): Promise<{ name: string; email: string }> {
  const want = lower(body.from);
  const own = me === lower(user.email);
  const fallback = { name: own ? user.name || '' : '', email: me };
  if (!want || want === me) {
    if (!own) {
      const s = await gm.get('/settings/sendAs').catch(() => null);
      const row = (s?.sendAs || []).find((x: any) => lower(x.sendAsEmail) === me);
      if (row?.displayName) fallback.name = String(row.displayName);
    }
    return fallback;
  }
  const s = await gm.get('/settings/sendAs').catch(() => null);
  const row = (s?.sendAs || []).find((x: any) => lower(x.sendAsEmail) === want);
  if (!row) throw new HttpError(400, 'bad_from', 'That address is not one this mailbox can send as.');
  return { name: String(row.displayName || ''), email: want };
}

async function outMail(gm: Gmail, sender: { name: string; email: string }, body: Record<string, any>, sending: boolean) {
  const to = addrs(body.to);
  const cc = addrs(body.cc);
  const bcc = addrs(body.bcc);
  const bad = [...to, ...cc, ...bcc].find((x) => !validEmail(x.email));
  if (bad) throw new HttpError(400, 'bad_address', `${bad.email} is not an email address.`);
  if (sending && !to.length && !cc.length && !bcc.length) throw new HttpError(400, 'no_one', 'Add who it goes to.');
  let html = String(body.html || '').slice(0, 2_000_000);
  html = sanitizeHtml(html);
  let inReplyTo = '';
  let references = '';
  const replyTo = String(body.replyTo || '');
  if (/^[A-Za-z0-9]{6,40}$/.test(replyTo)) {
    const m = await gm.get('/messages/' + replyTo, { format: 'metadata', metadataHeaders: ['Message-ID', 'References'] }).catch(() => null);
    const h = (n: string) => (m?.payload?.headers || []).find((x: any) => x.name.toLowerCase() === n.toLowerCase())?.value || '';
    inReplyTo = h('Message-ID');
    references = [h('References'), inReplyTo].filter(Boolean).join(' ').trim();
  }
  const files: OutFile[] = [];
  let size = 0;
  for (const f of (Array.isArray(body.files) ? body.files : []).slice(0, 20)) {
    const data = b64ToBytes(String(f?.data || ''));
    size += data.length;
    files.push({ name: String(f?.name || 'file').slice(0, 160), mime: String(f?.mime || 'application/octet-stream').slice(0, 100), data });
  }
  for (const f of (Array.isArray(body.forward) ? body.forward : []).slice(0, 20)) {
    if (!/^[A-Za-z0-9]{6,40}$/.test(String(f?.messageId)) || !/^[A-Za-z0-9_-]{8,2000}$/.test(String(f?.attachmentId))) continue;
    const at = await gm.get(`/messages/${f.messageId}/attachments/${f.attachmentId}`);
    const data = b64ToBytes(String(at.data || '').replace(/-/g, '+').replace(/_/g, '/'));
    size += data.length;
    files.push({ name: String(f?.name || 'file').slice(0, 160), mime: String(f?.mime || 'application/octet-stream').slice(0, 100), data });
  }
  if (size > MAX_SEND) throw new HttpError(413, 'too_big', 'Files can add up to 24 MB. Share a big file from Drive instead.');
  return { from: { name: sender.name, email: sender.email }, to, cc, bcc, subject: String(body.subject || '').slice(0, 900), html, inReplyTo, references, files };
}

const ids20 = (v: unknown): string[] => (Array.isArray(v) ? v : []).map(String).filter((x) => /^[A-Za-z0-9]{6,40}$/.test(x)).slice(0, 20);

/** A conversation as the page shows it: bodies made safe, the partners matched, draft ids and the snooze time. Read from Gmail once. */
async function buildThread(ctx: MailCtx, gm: Gmail, me: string, id: string, t: any) {
  const msgs = (t.messages || []).map((m: any) => {
    const s = shapeMessage(m);
    const cid = (x: string) => {
      const f = s.attachments.find((y) => y.cid === x);
      return f ? fileUrl(s.id, f) : null;
    };
    const html = s.html ? sanitizeHtml(s.html, cid) : s.text ? textToHtml(s.text) : '';
    return { ...s, html, text: s.html ? '' : s.text };
  });
  let drafts: Record<string, string> = {};
  if (msgs.some((m: any) => m.draft)) {
    const dl = await gm.get('/drafts', { maxResults: '100' }).catch(() => ({ drafts: [] }));
    drafts = Object.fromEntries((dl.drafts || []).filter((x: any) => x.message?.threadId === id).map((x: any) => [x.message.id, x.id]));
  }
  const sz = await ctx.env.DB.prepare('SELECT until FROM hub_mail_snooze WHERE email = ? AND thread_id = ? AND woke_at IS NULL').bind(me, id).first<{ until: string }>().catch(() => null);
  return { thread: { id, subject: msgs[0]?.subject || '', messages: msgs, snoozed: sz?.until || '', hid: String(t.historyId || '') }, partners: await partnersFor(ctx, msgs, me), drafts };
}

async function partnersFor(ctx: MailCtx, msgs: Array<{ from: Addr; to: Addr[]; cc: Addr[] }>, me: string) {
  const emails = [...new Set(msgs.flatMap((m) => [m.from, ...m.to, ...m.cc]).map((x) => x.email))].filter((e) => e && e !== me && !e.endsWith('@favorintl.org')).slice(0, 40);
  return partnerMap(ctx.env, emails, ctx.partners);
}

async function contacts(ctx: MailCtx, token: string, google: boolean, qRaw: string) {
  const q = qRaw.trim().toLowerCase().slice(0, 80);
  const staff = (await staffDirectory(ctx.env).catch(() => []))
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.email.includes(q))
    .slice(0, 8)
    .map((p) => ({ name: p.name, email: p.email, title: p.title || p.team || '', picture: p.picture || '', kind: 'staff' }));
  const out = [...staff];
  if (google && token && q.length >= 2) {
    const f = ctx.fetcher || fetch;
    const ask = (u: string) =>
      f(u, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null) as Promise<any>;
    const qs = `query=${encodeURIComponent(q)}&readMask=names,emailAddresses&pageSize=10`;
    const [saved, other] = await Promise.all([ask(`https://people.googleapis.com/v1/people:searchContacts?${qs}`), ask(`https://people.googleapis.com/v1/otherContacts:search?${qs}`)]);
    for (const r of [...(saved?.results || []), ...(other?.results || [])]) {
      const p = r.person || {};
      const name = p.names?.[0]?.displayName || '';
      for (const e of p.emailAddresses || []) {
        const email = lower(e.value);
        if (email && !out.some((x) => x.email === email)) out.push({ name, email, title: '', picture: '', kind: 'contact' });
      }
    }
  }
  return { people: out.slice(0, 14), google };
}

/**
 * Snoozed threads whose time has come go back to the inbox, unread, as Gmail's own snooze does. A conversation snoozed until a
 * reply comes back when someone else writes in it; one snoozed until the next gift comes back when the partner gives again.
 */
export async function wakeDue(env: Env, gm: Gmail, me: string): Promise<number> {
  const due = await env.DB.prepare('SELECT thread_id FROM hub_mail_snooze WHERE email = ? AND woke_at IS NULL AND until <= ? LIMIT 20').bind(me, nowIso()).all<{ thread_id: string }>();
  let n = 0;
  for (const r of due.results || []) {
    await gm.send('POST', `/threads/${r.thread_id}/modify`, { addLabelIds: ['INBOX', 'UNREAD'], removeLabelIds: [] }).catch(() => undefined);
    await env.DB.prepare('UPDATE hub_mail_snooze SET woke_at = ? WHERE email = ? AND thread_id = ?').bind(nowIso(), me, r.thread_id).run();
    await env.DB.prepare('UPDATE hub_mail_waits SET woke_at = ? WHERE email = ? AND thread_id = ? AND woke_at IS NULL').bind(nowIso(), me, r.thread_id).run().catch(() => undefined);
    n++;
  }
  const waits = await env.DB.prepare('SELECT thread_id, kind, until, last_mid FROM hub_mail_waits WHERE email = ? AND woke_at IS NULL LIMIT 20').bind(me).all<{ thread_id: string; kind: string; until: string; last_mid: string }>().catch(() => ({ results: [] as any[] }));
  for (const w of waits.results || []) {
    let wake = false;
    if (w.kind === 'reply') {
      const t = await gm.get('/threads/' + w.thread_id, { format: 'metadata', metadataHeaders: ['From'] }).catch(() => null);
      const last = (t?.messages || []).slice(-1)[0];
      const from = String((last?.payload?.headers || []).find((h: any) => h.name.toLowerCase() === 'from')?.value || '').toLowerCase();
      wake = !!last && String(last.id) !== w.last_mid && !from.includes(me);
    }
    if (!wake) continue;
    await gm.send('POST', `/threads/${w.thread_id}/modify`, { addLabelIds: ['INBOX', 'UNREAD'], removeLabelIds: [] }).catch(() => undefined);
    await env.DB.batch([
      env.DB.prepare('UPDATE hub_mail_waits SET woke_at = ? WHERE email = ? AND thread_id = ? AND kind = ?').bind(nowIso(), me, w.thread_id, w.kind),
      env.DB.prepare('UPDATE hub_mail_snooze SET woke_at = ? WHERE email = ? AND thread_id = ? AND woke_at IS NULL').bind(nowIso(), me, w.thread_id),
    ]).catch(() => undefined);
    n++;
  }
  return n;
}

/**
 * Saved messages whose time has come go out from the mailbox they were written in. Called every few minutes by the meetings
 * pass the Cloudflare cron already runs. A message that fails stays and tries again; one that is a day late is marked missed.
 */
/** Sends one held message if it is still held. The claim is one UPDATE, so two callers never both send it. */
const bytesToB64 = (u: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Removes a held message's files from the uploads bucket. */
async function dropHeldFiles(env: Env, id: string): Promise<void> {
  try {
    const l = await env.UPLOADS.list({ prefix: `mail-hold/${id}/` });
    if (l.objects.length) await env.UPLOADS.delete(l.objects.map((o) => o.key));
  } catch {
    /* an old file is swept by the next release pass */
  }
}

export async function releaseHeld(env: Env, owner: string, id: string, fetcher: Fetcher = fetch): Promise<{ sent: boolean; threadId?: string; state?: string } | 'gone'> {
  const row = await env.DB.prepare('SELECT mailbox, payload, thread_id FROM hub_mail_held WHERE id = ? AND owner = ?').bind(id, owner).first<any>().catch(() => null);
  if (!row) return 'gone';
  const claim = await env.DB.prepare("UPDATE hub_mail_held SET state = 'sending' WHERE id = ? AND owner = ? AND state = 'held'").bind(id, owner).run();
  if (!Number((claim.meta as any)?.changes)) {
    const st = await env.DB.prepare('SELECT state, thread_id FROM hub_mail_held WHERE id = ?').bind(id).first<{ state: string; thread_id: string }>();
    return { sent: st?.state === 'sent', state: st?.state || 'gone', threadId: st?.thread_id || '' };
  }
  try {
    const tok = row.mailbox ? await boxToken(env, owner, row.mailbox) : await accessToken(env, owner);
    if (!tok || !mailLevel(tok.scopes).write) throw new Error('no token');
    const gm = gmail(tok.token, fetcher);
    const body = safeJson(row.payload);
    const files: Array<{ name: string; mime: string; data: string }> = [];
    for (const f of Array.isArray(body.heldFiles) ? body.heldFiles : []) {
      const o = await env.UPLOADS.get(String(f.key));
      if (o) files.push({ name: f.name, mime: f.mime, data: bytesToB64(new Uint8Array(await o.arrayBuffer())) });
    }
    body.files = files;
    const me = row.mailbox || owner;
    const who = { email: owner, name: '', picture: '', role: 'staff', via: 'google', kpi: true } as HubUser;
    const mail = await outMail(gm, await fromOf(gm, me, who, body), body, true);
    const out = await gm.send('POST', '/messages/send', { raw: rawOf(mail), threadId: body.threadId && /^[A-Za-z0-9]{6,40}$/.test(String(body.threadId)) ? String(body.threadId) : undefined });
    if (body.draftId && /^[A-Za-z0-9_-]{4,80}$/.test(String(body.draftId))) await gm.send('DELETE', '/drafts/' + String(body.draftId)).catch(() => undefined);
    await env.DB.prepare("UPDATE hub_mail_held SET state = 'sent', payload = '{}', thread_id = ? WHERE id = ?").bind(String(out.threadId || ''), id).run();
    await dropHeldFiles(env, id);
    forgetCount(owner);
    return { sent: true, threadId: String(out.threadId || ''), state: 'sent' };
  } catch (e) {
    await env.DB.prepare("UPDATE hub_mail_held SET state = 'failed' WHERE id = ?").bind(id).run().catch(() => undefined);
    await dropHeldFiles(env, id);
    throw e;
  }
}

/** Sends this person's held messages that are a minute old (the page did not release them), or every person's when owner is empty. */
export async function releaseDue(env: Env, owner: string, fetcher: Fetcher = fetch): Promise<number> {
  const q = owner ? env.DB.prepare("SELECT id, owner FROM hub_mail_held WHERE state = 'held' AND release_at <= ? AND owner = ? LIMIT 10").bind(nowIso(), owner) : env.DB.prepare("SELECT id, owner FROM hub_mail_held WHERE state = 'held' AND release_at <= ? LIMIT 10").bind(nowIso());
  const due = await q.all<{ id: string; owner: string }>().catch(() => ({ results: [] as any[] }));
  let n = 0;
  for (const r of due.results || []) {
    try {
      const o = await releaseHeld(env, r.owner, r.id, fetcher);
      if (o !== 'gone' && o.sent) n++;
    } catch {
      /* marked failed */
    }
  }
  return n;
}

export async function sendDue(env: Env, fetcher: Fetcher = fetch): Promise<{ sent: number; failed: number }> {
  const due = await env.DB.prepare("SELECT id, email, mailbox, payload, remind_days, thread_id FROM hub_mail_later WHERE state = 'waiting' AND send_at <= ? ORDER BY send_at LIMIT 10").bind(nowIso()).all<any>().catch(() => ({ results: [] as any[] }));
  let sent = 0;
  let failed = 0;
  for (const r of due.results || []) {
    try {
      const tok = r.mailbox ? await boxToken(env, r.email, r.mailbox) : await accessToken(env, r.email);
      if (!tok || !mailLevel(tok.scopes).write) throw new Error('no token');
      const gm = gmail(tok.token, fetcher);
      const body = safeJson(r.payload);
      const me = r.mailbox || r.email;
      const who: HubUser = { email: r.email, name: '', picture: '', role: 'staff', via: 'google', kpi: true } as HubUser;
      const mail = await outMail(gm, await fromOf(gm, me, who, body), body, true);
      const out = await gm.send('POST', '/messages/send', { raw: rawOf(mail), threadId: body.threadId && /^[A-Za-z0-9]{6,40}$/.test(String(body.threadId)) ? String(body.threadId) : undefined });
      await env.DB.prepare("UPDATE hub_mail_later SET state = 'sent', sent_at = ?, payload = '{}', thread_id = ? WHERE id = ?").bind(nowIso(), String(out.threadId || r.thread_id || ''), r.id).run();
      sent++;
    } catch {
      failed++;
      const late = Date.now() - Date.parse(String((await env.DB.prepare('SELECT send_at FROM hub_mail_later WHERE id = ?').bind(r.id).first<{ send_at: string }>().catch(() => null))?.send_at || nowIso())) > 864e5;
      if (late) await env.DB.prepare("UPDATE hub_mail_later SET state = 'missed', payload = '{}' WHERE id = ?").bind(r.id).run().catch(() => undefined);
    }
  }
  const held = await releaseDue(env, '', fetcher).catch(() => 0);
  return { sent: sent + held, failed };
}

async function snoozedList(env: Env, gm: Gmail, me: string) {
  const r = await env.DB.prepare('SELECT thread_id, until FROM hub_mail_snooze WHERE email = ? AND woke_at IS NULL ORDER BY until LIMIT 50').bind(me).all<{ thread_id: string; until: string }>();
  const rows = await pool(r.results || [], 8, async (s) => {
    const full = await gm.get('/threads/' + s.thread_id, { format: 'metadata', metadataHeaders: ROW_HEADERS }).catch(() => null);
    return full ? { ...shapeThreadRow(full, me), snoozed: s.until } : null;
  });
  return { threads: rows.filter(Boolean), next: '', estimate: rows.length };
}

/**
 * The inbox's unread conversations. `primary` is what Gmail's own Inbox number shows (the Primary tab, as Gmail counts it when
 * the tabs are on); `all` counts every tab. A grant that cannot search (headers only) answers `all` for both.
 */
export async function inboxCounts(gm: Gmail, canSearch: boolean, withPrimary = false): Promise<{ primary: number; all: number }> {
  const l = await gm.get('/labels/INBOX');
  const all = Number(l.threadsUnread) || 0;
  if (!withPrimary || !canSearch || !all) return { primary: all, all };
  // The Primary tab's share, for the breakdown shown on hover. One list of ids; never the number that is shown.
  const list = await gm.get('/threads', { q: 'in:inbox is:unread category:primary', maxResults: '500', fields: 'threads/id,nextPageToken' }).catch(() => null);
  if (!list) return { primary: all, all };
  return { primary: Math.min(all, (list.threads || []).length), all };
}

/** The rail badge: the person's Primary inbox unread, kept 15 seconds per person; zero until they connect. */
const COUNTS = new Map<string, { n: number; at: number }>();
const LABELS = new Map<string, { at: number; labels: any[] }>();
const remember = (email: string, n: number) => {
  if (COUNTS.size > 500) COUNTS.clear();
  COUNTS.set(lower(email), { n, at: Date.now() });
};
export async function mailUnreadCount(env: Env, email: string, fetcher: Fetcher = fetch): Promise<number> {
  const k = lower(email);
  const hit = COUNTS.get(k);
  if (hit && Date.now() - hit.at < 15000) return hit.n;
  const sample = isTester(k);
  const tok = sample ? SAMPLE_TOKEN : await accessToken(env, k);
  const lv = tok ? mailLevel(tok.scopes) : null;
  if (!tok || !lv || !lv.headers) return 0;
  const gm = gmail(tok.token, sample ? sampleFetcher(env, k) : fetcher);
  // The menu loads on every page, Today included, so a snoozed conversation is back by the time its owner looks.
  if (lv.write) await wakeDue(env, gm, k).catch(() => undefined);
  let n = (await inboxCounts(gm, lv.read)).all;
  // The menu number counts every mailbox the person connected, so Today, the menu and Mail agree.
  const rows = await listBoxes(env, k);
  if (rows.length) {
    const more = await Promise.all(rows.map(async (b) => {
      const t = await boxToken(env, k, b.mailbox).catch(() => null);
      return t ? inboxCounts(gmail(t.token, fetcher), mailLevel(t.scopes).read).then((c) => c.all).catch(() => 0) : 0;
    }));
    n += more.reduce((x, y) => x + y, 0);
  }
  remember(k, n);
  return n;
}
export const forgetCount = (email: string) => {
  LABELS.delete(lower(email));
  forgetScan(lower(email));
  return COUNTS.delete(lower(email));
};

/** Changes to many conversations at once: archive, Trash, read, star, labels, Inbox, snooze. At most 100, six at a time. */
export async function bulk(env: Env, gm: Gmail, me: string, canSearch: boolean, body: Record<string, any>) {
  const list = (Array.isArray(body.ids) ? body.ids : []).map(String).filter((x: string) => /^[A-Za-z0-9]{6,40}$/.test(x)).slice(0, 100);
  if (!list.length) throw new HttpError(400, 'nothing', 'Pick at least one conversation.');
  const action = String(body.action || '');
  const add = ids(body.add);
  const remove = ids(body.remove);
  let until = '';
  if (action === 'snooze') {
    const t = new Date(String(body.until || ''));
    if (!Number.isFinite(t.getTime()) || t.getTime() < Date.now() + 60000 || t.getTime() > Date.now() + 400 * 864e5) throw new HttpError(400, 'bad_time', 'Pick a time later than now.');
    until = t.toISOString();
  }
  const mod: Record<string, { add: string[]; remove: string[] }> = {
    archive: { add: [], remove: ['INBOX'] },
    inbox: { add: ['INBOX'], remove: [] },
    read: { add: [], remove: ['UNREAD'] },
    unread: { add: ['UNREAD'], remove: [] },
    star: { add: ['STARRED'], remove: [] },
    unstar: { add: [], remove: ['STARRED'] },
    label: { add, remove },
    snooze: { add: [], remove: ['INBOX'] },
  };
  if (action !== 'trash' && action !== 'untrash' && !mod[action]) throw new HttpError(400, 'bad_action', 'That change is not available.');
  if (action === 'label' && !add.length && !remove.length) throw new HttpError(400, 'nothing', 'Nothing to change.');
  let done = 0;
  let failed = 0;
  await pool(list, 6, async (id: string) => {
    try {
      if (action === 'trash' || action === 'untrash') await gm.send('POST', `/threads/${id}/${action}`);
      else await gm.send('POST', `/threads/${id}/modify`, { addLabelIds: mod[action].add, removeLabelIds: mod[action].remove });
      done++;
    } catch {
      failed++;
    }
  });
  if (action === 'inbox') await env.DB.batch(list.map((id: string) => env.DB.prepare('UPDATE hub_mail_snooze SET woke_at = ? WHERE email = ? AND thread_id = ? AND woke_at IS NULL').bind(nowIso(), me, id))).catch(() => undefined);
  if (action === 'snooze') {
    await env.DB.batch(
      list.map((id: string) =>
        env.DB.prepare(
          `INSERT INTO hub_mail_snooze (email, thread_id, until, created_at, woke_at) VALUES (?, ?, ?, ?, NULL)
           ON CONFLICT(email, thread_id) DO UPDATE SET until = excluded.until, created_at = excluded.created_at, woke_at = NULL`
        ).bind(me, id, until, nowIso())
      )
    ).catch(() => undefined);
  }
  const label = mod[action] || (action === 'trash' ? { add: ['TRASH'], remove: ['INBOX', 'UNREAD'] } : { add: ['INBOX'], remove: ['TRASH'] });
  await Promise.all(list.map((id: string) => applyLabels(env, me, id, label.add, label.remove)));
  forgetCount(me);
  const c = await inboxCounts(gm, canSearch).catch(() => null);
  if (c) remember(me, c.all);
  return { ok: true, done, failed, unread: c ? c.all : null, all: c ? c.all : null, ...(until ? { until } : {}) };
}
