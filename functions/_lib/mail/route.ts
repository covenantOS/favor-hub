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
import { HttpError, errorJson, handleError, json, nowIso, type Env } from '../http';
import { accessToken, mailLevel } from '../hub/google';
import { staffDirectory } from '../people';
import type { HubUser } from '../session';
import { GmailError, ROW_HEADERS, gmail, pool, shapeMessage, shapeThreadRow, type Addr, type Fetcher, type Gmail } from './gmail';
import { b64ToBytes, rawOf, validEmail, type OutFile } from './mime';
import { boxToken, listBoxes, removeBox } from './boxes';
import { partnerMap, type PartnerLookup } from './partners';
import { idsFor, rowsFor } from './rows';
import { sanitizeHtml, textToHtml } from './sanitize';
import { assist, cardOf, classify, decorate, forgetScan, isCat, overview, saveSummary, savedSummary, smartView, type SmartCtx } from './smart';

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
      return errorJson('gmail', 'Gmail did not answer. Try again.', 502);
    }
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
  const owner = lower(user.email);
  let me = owner;
  const fetcher = ctx.fetcher || fetch;
  const [a = '', b = '', c = '', d = ''] = path;

  const writeOn = (await effective(env, 'mail.write', undefined, 'on').catch(() => 'on')).toLowerCase() !== 'off';
  let tok = await accessToken(env, owner);
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
    let signature = '';
    if (tok && level.read) {
      const s = await gmail(tok.token, fetcher).get('/settings/sendAs').catch(() => null);
      const main = (s?.sendAs || []).find((x: any) => x.isDefault) || (s?.sendAs || [])[0];
      signature = main?.signature ? sanitizeHtml(String(main.signature)) : '';
    }
    return json({ ok: true, connected: !!tok, email: me, name: user.name || me, level, write: writeOn, signature, mailboxes: (await listBoxes(env, owner)).map((x) => ({ email: x.mailbox, name: x.name, color: x.color })) });
  }

  if (a === 'boxes' && !b && method === 'GET') {
    const list = await listBoxes(env, owner);
    const one = async (email: string, t: { token: string; scopes: string } | null) => {
      if (!t) return -1;
      const lv = mailLevel(t.scopes);
      try {
        return (await inboxCounts(gmail(t.token, fetcher), lv.read)).primary;
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

  const smartCtx: SmartCtx = { env, me, name: user.name || me, ai: ctx.ai || (env.AI as any), partners: ctx.partners };

  if (a === 'count' && method === 'GET') {
    if (level.write) await wakeDue(env, gm, me).catch(() => undefined);
    const c = await inboxCounts(gm, level.read);
    remember(me, c.primary);
    return json({ ok: true, unread: c.primary, all: c.all });
  }

  if (a === 'labels' && method === 'GET') {
    const list = await gm.get('/labels');
    const mine = (list.labels || []).filter((l: any) => l.type === 'user' && l.labelListVisibility !== 'labelHide');
    const want = ['INBOX', 'DRAFT', 'SPAM', ...mine.map((l: any) => l.id)].slice(0, 60);
    const [got, inbox] = await Promise.all([pool(want, 8, (id) => gm.get('/labels/' + encodeURIComponent(id)).catch(() => null)), inboxCounts(gm, level.read)]);
    remember(me, inbox.primary);
    const by = new Map(got.filter(Boolean).map((l: any) => [l.id, l]));
    const sys = SYSTEM.map((id) => ({
      id,
      name: SYSTEM_NAME[id],
      type: 'system',
      unread: id === 'INBOX' ? inbox.primary : id === 'SPAM' ? Number(by.get(id)?.threadsUnread) || 0 : 0,
      ...(id === 'INBOX' ? { unreadAll: inbox.all } : {}),
      total: id === 'DRAFT' ? Number(by.get(id)?.threadsTotal) || 0 : 0,
    }));
    const own = mine
      .map((l: any) => ({ id: l.id, name: l.name, type: 'user', unread: Number(by.get(l.id)?.threadsUnread) || 0, total: Number(by.get(l.id)?.threadsTotal) || 0, color: l.color?.backgroundColor || '' }))
      .sort((x: any, y: any) => x.name.localeCompare(y.name));
    return json({ ok: true, labels: [...sys, ...own] });
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

  if (a === 'partner' && b && method === 'GET') {
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
    const smart = (view === 'needs' || view === 'waiting' || /^cat:/.test(view) || flags.includes('partner')) && !q && (label === 'INBOX' || view === 'waiting');
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
      const list = await gm.get('/threads', { ...params, maxResults: String(PAGE), pageToken: page || undefined });
      listed = list.threads || [];
      next = list.nextPageToken || '';
      estimate = Number(list.resultSizeEstimate) || 0;
    }
    const rows = await rowsFor(gm, me, listed);
    const marked = label === 'INBOX' ? decorate(rows, (await classify(smartCtx, rows, false)).by) : rows;
    return json({ ok: true, threads: mark(marked), next, estimate, level });
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
    const out = await assist(smartCtx, msgs, partner);
    // A saved summary stands in for the model on a second look; replies are written fresh each time.
    const summary = old || out.summary;
    if (out.summary && !old) await saveSummary(env, me, id, lastMid, out.summary);
    return json({ ok: true, summary, replies: out.replies, ask: out.ask, partner });
  }

  if (a === 'threads' && b && !c && method === 'GET') {
    const id = tid(b);
    if (!level.read) {
      // Headers only: the page can still show who wrote and when, with a button to allow reading.
      const meta = await gm.get('/threads/' + id, { format: 'metadata', metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date'] });
      const msgs = (meta.messages || []).map((m: any) => ({ ...shapeMessage(m), html: '', text: '' }));
      return json({ ok: true, headersOnly: true, thread: { id, subject: msgs[0]?.subject || '', messages: msgs }, partners: await partnersFor(ctx, msgs, me), drafts: {} });
    }
    const t = await gm.get('/threads/' + id, { format: 'full' });
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
    const sz = await env.DB.prepare('SELECT until FROM hub_mail_snooze WHERE email = ? AND thread_id = ? AND woke_at IS NULL').bind(me, id).first<{ until: string }>().catch(() => null);
    return json({ ok: true, thread: { id, subject: msgs[0]?.subject || '', messages: msgs, snoozed: sz?.until || '' }, partners: await partnersFor(ctx, msgs, me), drafts });
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
      const until = new Date(String((await readBody(request)).until || ''));
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

/** Snoozed threads whose time has come go back to the inbox, unread, as Gmail's own snooze does. */
export async function wakeDue(env: Env, gm: Gmail, me: string): Promise<number> {
  const due = await env.DB.prepare('SELECT thread_id FROM hub_mail_snooze WHERE email = ? AND woke_at IS NULL AND until <= ? LIMIT 20').bind(me, nowIso()).all<{ thread_id: string }>();
  let n = 0;
  for (const r of due.results || []) {
    await gm.send('POST', `/threads/${r.thread_id}/modify`, { addLabelIds: ['INBOX', 'UNREAD'], removeLabelIds: [] }).catch(() => undefined);
    await env.DB.prepare('UPDATE hub_mail_snooze SET woke_at = ? WHERE email = ? AND thread_id = ?').bind(nowIso(), me, r.thread_id).run();
    n++;
  }
  return n;
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
export async function inboxCounts(gm: Gmail, canSearch: boolean): Promise<{ primary: number; all: number }> {
  const l = await gm.get('/labels/INBOX');
  const all = Number(l.threadsUnread) || 0;
  if (!canSearch || !all) return { primary: all, all };
  // One list call of ids is the live truth for the tab (Gmail's label counts can trail a read by a few seconds).
  const list = await gm.get('/threads', { q: 'in:inbox is:unread category:primary', maxResults: '500', fields: 'threads/id,nextPageToken' }).catch(() => null);
  if (!list) return { primary: all, all };
  return { primary: Math.min(all, (list.threads || []).length), all };
}

/** The rail badge: the person's Primary inbox unread, kept 15 seconds per person; zero until they connect. */
const COUNTS = new Map<string, { n: number; at: number }>();
const remember = (email: string, n: number) => {
  if (COUNTS.size > 500) COUNTS.clear();
  COUNTS.set(lower(email), { n, at: Date.now() });
};
export async function mailUnreadCount(env: Env, email: string, fetcher: Fetcher = fetch): Promise<number> {
  const k = lower(email);
  const hit = COUNTS.get(k);
  if (hit && Date.now() - hit.at < 15000) return hit.n;
  const tok = await accessToken(env, k);
  const lv = tok ? mailLevel(tok.scopes) : null;
  if (!tok || !lv || !lv.headers) return 0;
  const gm = gmail(tok.token, fetcher);
  // The menu loads on every page, Today included, so a snoozed conversation is back by the time its owner looks.
  if (lv.write) await wakeDue(env, gm, k).catch(() => undefined);
  let n = (await inboxCounts(gm, lv.read)).primary;
  // The menu number counts every mailbox the person connected, so Today, the menu and Mail agree.
  const rows = await listBoxes(env, k);
  if (rows.length) {
    const more = await Promise.all(rows.map(async (b) => {
      const t = await boxToken(env, k, b.mailbox).catch(() => null);
      return t ? inboxCounts(gmail(t.token, fetcher), mailLevel(t.scopes).read).then((c) => c.primary).catch(() => 0) : 0;
    }));
    n += more.reduce((x, y) => x + y, 0);
  }
  remember(k, n);
  return n;
}
export const forgetCount = (email: string) => {
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
  forgetCount(me);
  const c = await inboxCounts(gm, canSearch).catch(() => null);
  if (c) remember(me, c.primary);
  return { ok: true, done, failed, unread: c ? c.primary : null, all: c ? c.all : null, ...(until ? { until } : {}) };
}
