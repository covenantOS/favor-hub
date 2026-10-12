// The smart half of Mail in FavorOS: categories, the Needs you view, Waiting on reply, clean-up suggestions, a one-line summary
// and suggested replies, and the partner card. Everything reads headers and the short preview Gmail gives with each conversation.
//
// What is stored (hub_mail_class, db/mail-smart.sql): per conversation and newest message id, Clef's kind and ask answers and a
// one-line summary. Never a message body. Rules that need no model run first (Gmail's own tabs, the list headers, staff
// addresses, partner addresses, calendar words); Clef (Workers AI, the same decision model Favor Brain uses) reads the rest.
// A conversation Clef has not read yet gets a plain-words guess for "needs you" and is read on the next look.
import type { Env } from '../http';
import { nowIso } from '../http';
import { pool, type Addr, type Gmail, type ThreadRow } from './gmail';
import { partnerMap, type PartnerLookup, type PartnerMap } from './partners';
import { idsFor, rowsFor } from './rows';

export const CATS = ['partners', 'staff', 'receipts', 'newsletters', 'notifications', 'calendar', 'people'] as const;
export type Cat = (typeof CATS)[number];
export const CAT_NAME: Record<Cat, string> = {
  partners: 'Partners',
  staff: 'Staff',
  receipts: 'Receipts and gifts',
  newsletters: 'Newsletters',
  notifications: 'Notifications',
  calendar: 'Calendar',
  people: 'People',
};
export const isCat = (v: unknown): v is Cat => (CATS as readonly string[]).includes(String(v));

export const CLEF_MODEL = '@cf/cloudflare/clef-flash';
export const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const CLEF_MS = 6000;
const TEXT_MS = 14000;
/** New conversations Clef reads in one request; the rest are read on the next look. */
const CLEF_CAP = 30;
export const SCAN = 100;

type Runner = { run(model: string, input: unknown): Promise<unknown> };
export interface SmartCtx {
  env: Env;
  me: string;
  name: string;
  /** Stand-ins for tests. */
  ai?: Runner;
  partners?: PartnerLookup;
}

const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const timeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error(what + ' took too long')), ms);
    p.then((v) => (clearTimeout(t), ok(v)), (e) => (clearTimeout(t), no(e)));
  });

/* ------------------------------------------------------------------ rules */

const CALENDAR = /^(updated invitation|invitation|accepted|declined|tentatively accepted|canceled event|cancelled event|canceled|cancelled|new event|reminder)\b.*(@|:|\bevent\b)|invitation from google calendar|^(accepted|declined|tentative):/i;
const RECEIPT = /\b(receipt|invoice|payment|payout|paid|statement|your order|order confirmation|purchase|donation|gift (received|from|notification)|charge|refund|billing|renewal|subscription|check (is )?available|tax document|remittance)\b/i;
const NOREPLY = /^(no-?reply|do-?not-?reply|donotreply|notifications?|notify|alerts?|mailer-daemon|postmaster|bounce|system|support|billing|receipts?|invoice|team|hello|news|updates?|info)([+._-].*)?@|@(mail|email|notify|notifications|e|em|send|bounce)\./i;

/** The category a conversation falls in by rules alone. `sure` is false for a conversation that looks like a person writing. */
export function ruleCat(r: ThreadRow, partner: boolean, staff: boolean, ai: string): { cat: Cat; sure: boolean } {
  const from = lower(r.from?.email);
  const labels = r.labelIds || [];
  const tab = (c: string) => labels.includes('CATEGORY_' + c);
  const subject = String(r.subject || '');
  if (CALENDAR.test(subject) || /calendar-notification@google\.com|@calendar\.google\.com/.test(from)) return { cat: 'calendar', sure: true };
  const automatic = r.bulk || NOREPLY.test(from) || /noreply|no-reply/.test(from);
  if (partner && !r.bulk && !/noreply|no-reply/.test(from)) return { cat: 'partners', sure: true };
  if (staff && !automatic) return { cat: 'staff', sure: true };
  const text = subject + ' ' + (r.snippet || '');
  if (automatic && RECEIPT.test(text)) return { cat: 'receipts', sure: true };
  if (r.bulk && (tab('PROMOTIONS') || tab('SOCIAL') || tab('FORUMS'))) return { cat: 'newsletters', sure: true };
  if (r.bulk && !tab('UPDATES') && !tab('PERSONAL')) return { cat: 'newsletters', sure: true };
  if (tab('PROMOTIONS') || tab('SOCIAL') || tab('FORUMS')) return { cat: 'newsletters', sure: !!ai || r.bulk };
  if (tab('UPDATES') || automatic) return { cat: 'notifications', sure: true };
  return { cat: 'people', sure: false };
}

const ASK_WORDS = /\b(please|can you|could you|would you|will you|let me know|need you|waiting on|waiting for|when can|do you|are you|thoughts|your approval|sign off|get back to me)\b/i;
/** The plain-words guess used until Clef has read the conversation. */
export function guessAsk(r: ThreadRow): boolean {
  if (r.fromMe || r.bulk || r.draft) return false;
  return r.toMe && (/\?/.test(r.snippet || '') || /\?/.test(r.subject || '') || ASK_WORDS.test(r.snippet || ''));
}

/* ------------------------------------------------------------------ Clef */

const KIND_OF: Record<string, Cat> = { person: 'people', receipt: 'receipts', newsletter: 'newsletters', notification: 'notifications', calendar: 'calendar' };

const QUESTIONS = {
  kind: {
    type: 'choice',
    instructions: 'What kind of email is this, judging from the sender, the subject and the preview?',
    criteria: {
      person: 'A message a person wrote to the recipient: a question, request, reply, update or introduction',
      receipt: 'An automatic receipt, invoice, payment, payout, order or gift confirmation',
      newsletter: 'A newsletter, promotion, marketing message or announcement sent to many people',
      notification: 'An automatic alert, report, status, comment or account notice from a system',
      calendar: 'A calendar invitation, change or reminder',
    },
  },
  ask: { type: 'noul', instructions: 'Does this email ask the recipient a question, ask for an answer or an action, or wait on a reply from the recipient?' },
};

export interface Read {
  kind: string;
  ask: boolean;
  p: number;
}

/** Clef's read of one conversation from its sender, subject and preview. Null when the model is not there or did not answer. */
export async function clefRead(ai: Runner | undefined, r: ThreadRow): Promise<Read | null> {
  if (!ai) return null;
  const state = `From: ${r.from?.name || ''} <${r.from?.email || ''}>\nSent to the recipient directly: ${r.toMe ? 'yes' : 'no, copied'}\nSubject: ${String(r.subject || '').slice(0, 200)}\nPreview: ${String(r.snippet || '').slice(0, 300)}`;
  try {
    const out: any = await timeout(ai.run(CLEF_MODEL, { model: CLEF_MODEL.split('/').pop(), state, questions: QUESTIONS }), CLEF_MS, 'Clef');
    const answers = out?.answers || out?.result?.answers;
    if (!answers) return null;
    const kind = String(answers.kind?.choice || '');
    const probs: Record<string, number> = answers.kind?.probabilities || {};
    const p = Number(probs[kind]);
    const noul = Number(answers.ask?.noul);
    return { kind, ask: Number.isFinite(noul) ? noul >= 0.5 : false, p: Number.isFinite(p) ? p : 0 };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ classifying rows */

export interface Cls {
  cat: Cat;
  ask: boolean;
  partner?: { id: string; name: string };
}

const staffEmail = (e: string) => e.endsWith('@favorintl.org');

async function overrides(env: Env, me: string): Promise<Map<string, Cat>> {
  const r = await env.DB.prepare('SELECT sender, cat FROM hub_mail_cat WHERE email = ?').bind(me).all<{ sender: string; cat: string }>().catch(() => ({ results: [] as any[] }));
  return new Map((r.results || []).filter((x: any) => isCat(x.cat)).map((x: any) => [x.sender, x.cat as Cat]));
}

async function cached(env: Env, me: string, ids: string[]): Promise<Map<string, { last: string; kind: string; ask: number }>> {
  const out = new Map<string, { last: string; kind: string; ask: number }>();
  for (let i = 0; i < ids.length; i += 80) {
    const part = ids.slice(i, i + 80);
    const r = await env.DB.prepare(`SELECT thread_id, last_mid, kind, ask FROM hub_mail_class WHERE email = ? AND kind != '' AND thread_id IN (${part.map(() => '?').join(',')})`)
      .bind(me, ...part)
      .all<{ thread_id: string; last_mid: string; kind: string; ask: number }>()
      .catch(() => ({ results: [] as any[] }));
    for (const x of r.results || []) out.set(x.thread_id, { last: x.last_mid, kind: x.kind, ask: x.ask });
  }
  return out;
}

/**
 * Sorts conversations into categories and flags the ones that wait on the person. `read` lets Clef read up to CLEF_CAP new
 * conversations; without it only the saved answers and the rules are used (the plain list never waits on a model).
 */
export async function classify(ctx: SmartCtx, rows: ThreadRow[], read: boolean): Promise<{ by: Map<string, Cls>; pending: number }> {
  const { env, me } = ctx;
  const senders = rows.map((r) => lower(r.from?.email)).filter((e) => e && e !== me && !staffEmail(e));
  const [partners, over, saved] = await Promise.all([partnerMap(env, senders, ctx.partners), overrides(env, me), cached(env, me, rows.map((r) => r.id))]);
  const by = new Map<string, Cls>();
  const todo: ThreadRow[] = [];
  const base = new Map<string, { cat: Cat; sure: boolean }>();
  for (const r of rows) {
    const from = lower(r.from?.email);
    const b = ruleCat(r, !!partners[from], staffEmail(from) && from !== me, ctx.ai ? 'ai' : '');
    base.set(r.id, b);
    const hit = saved.get(r.id);
    const human = !r.fromMe && !r.draft && !r.bulk && (b.cat === 'partners' || b.cat === 'staff' || b.cat === 'people');
    if (human && (!hit || hit.last !== r.lastId)) todo.push(r);
  }
  const fresh = new Map<string, Read>();
  if (read && ctx.ai) {
    const batch = todo.slice(0, CLEF_CAP);
    const got = await pool(batch, 6, (r) => clefRead(ctx.ai, r));
    const stmts: any[] = [];
    batch.forEach((r, i) => {
      const g = got[i];
      if (!g) return;
      fresh.set(r.id, g);
      stmts.push(
        env.DB.prepare(
          `INSERT INTO hub_mail_class (email, thread_id, last_mid, kind, ask, p, at) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(email, thread_id) DO UPDATE SET last_mid = excluded.last_mid, kind = excluded.kind, ask = excluded.ask, p = excluded.p, at = excluded.at,
             summary = CASE WHEN hub_mail_class.last_mid = excluded.last_mid THEN hub_mail_class.summary ELSE '' END`
        ).bind(me, r.id, r.lastId, g.kind, g.ask ? 1 : 0, g.p, nowIso())
      );
    });
    if (stmts.length) await env.DB.batch(stmts).catch(() => undefined);
  }
  let pending = 0;
  for (const r of rows) {
    const from = lower(r.from?.email);
    let b = base.get(r.id)!;
    const hit = saved.get(r.id);
    const rd: Read | null = fresh.get(r.id) || (hit && hit.last === r.lastId ? { kind: hit.kind, ask: !!hit.ask, p: 1 } : null);
    if (!b.sure && rd && KIND_OF[rd.kind] && rd.p >= 0.5) b = { cat: KIND_OF[rd.kind], sure: true };
    const o = over.get(from);
    const cat: Cat = o || b.cat;
    const human = !r.fromMe && !r.draft && !r.bulk && (cat === 'partners' || cat === 'staff' || cat === 'people');
    let ask = false;
    if (human) {
      if (rd) ask = rd.ask;
      else {
        ask = guessAsk(r);
        pending++;
      }
    }
    const cls: Cls = { cat, ask };
    if (partners[from]) cls.partner = partners[from];
    by.set(r.id, cls);
  }
  return { by, pending: read ? Math.max(0, todo.length - CLEF_CAP) + todo.slice(0, CLEF_CAP).filter((r) => !fresh.has(r.id)).length : pending };
}

export type SmartRow = ThreadRow & { cat?: Cat; ask?: boolean; partner?: { id: string; name: string }; waitDays?: number };
export const decorate = (rows: ThreadRow[], by: Map<string, Cls>): SmartRow[] => rows.map((r) => ({ ...r, ...(by.get(r.id) || {}) }));

/* ------------------------------------------------------------------ scans */

interface Scan {
  at: number;
  rows: SmartRow[];
  pending: number;
  more: boolean;
}
const SCANS = new Map<string, Scan>();
export const forgetScan = (me: string) => {
  for (const k of [...SCANS.keys()]) if (k.startsWith(me + '|')) SCANS.delete(k);
};

/** The newest conversations in the inbox (up to SCAN), read, sorted into categories. Kept thirty seconds per person and search. */
export async function scanInbox(ctx: SmartCtx, gm: Gmail, q = '', read = true): Promise<Scan> {
  const key = ctx.me + '|' + q;
  const hit = SCANS.get(key);
  if (hit && Date.now() - hit.at < 30000 && (!read || hit.pending === 0)) return hit;
  const list = await idsFor(gm, { labelIds: 'INBOX', q: q || undefined }, SCAN);
  const rows = await rowsFor(gm, ctx.me, list.threads, 6);
  const { by, pending } = await classify(ctx, rows, read);
  const scan = { at: Date.now(), rows: decorate(rows, by), pending, more: list.more };
  // A scan that lost conversations to Gmail's rate limit is shown but never kept.
  if (rows.length >= list.threads.length * 0.95) {
    if (SCANS.size > 60) SCANS.clear();
    SCANS.set(key, scan);
  }
  return scan;
}

const DAY = 864e5;
const daysSince = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / DAY);

/** Sent mail nobody has answered: my message is the newest in the conversation and it is at least `days` old. Oldest first. */
export async function waitingOn(ctx: SmartCtx, gm: Gmail, days = 3): Promise<SmartRow[]> {
  const list = await idsFor(gm, { q: 'in:sent newer_than:30d -in:chats' }, 60);
  const rows = await rowsFor(gm, ctx.me, list.threads, 6);
  const mine = rows.filter((r) => r.fromMe && !r.draft && !(r.labelIds || []).includes('TRASH') && daysSince(r.date) >= days);
  const sent = mine.filter((r) => {
    const to = r.people?.[0]?.email || '';
    return to && !NOREPLY.test(to) && !/noreply|no-reply/.test(to);
  });
  const partners = await partnerMap(ctx.env, sent.map((r) => lower(r.people?.[0]?.email)), ctx.partners);
  return sent
    .map((r) => ({ ...r, waitDays: daysSince(r.date), ...(partners[lower(r.people?.[0]?.email)] ? { partner: partners[lower(r.people?.[0]?.email)] } : {}) }) as SmartRow)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 40);
}

export interface Overview {
  counts: Record<string, { n: number; unread: number }>;
  needs: number;
  unread: number;
  waiting: number;
  marks: Record<string, { cat: Cat; ask: boolean }>;
  cleanup: { total: number; senders: Array<{ email: string; name: string; n: number }>; ids: string[] };
  scanned: number;
  pending: number;
}

/** Counts for every category tab, what waits on the person, who is waiting on a reply, and the newsletters nobody opens. */
export async function overview(ctx: SmartCtx, gm: Gmail, days = 3): Promise<Overview> {
  const [scan, wait] = await Promise.all([scanInbox(ctx, gm, '', true), waitingOn(ctx, gm, days).catch(() => [] as SmartRow[])]);
  const counts: Overview['counts'] = {};
  for (const c of CATS) counts[c] = { n: 0, unread: 0 };
  const marks: Overview['marks'] = {};
  const quiet = new Map<string, { name: string; ids: string[]; unread: number; all: number }>();
  let needs = 0;
  let unread = 0;
  for (const r of scan.rows) {
    const c = r.cat || 'people';
    counts[c].n++;
    if (r.unread) {
      counts[c].unread++;
      unread++;
    }
    if (r.ask) needs++;
    marks[r.id] = { cat: c, ask: !!r.ask };
    if (c === 'newsletters' || c === 'notifications') {
      const k = lower(r.from?.email);
      const g = quiet.get(k) || { name: r.from?.name || k, ids: [], unread: 0, all: 0 };
      g.all++;
      if (r.unread) {
        g.unread++;
        g.ids.push(r.id);
      }
      quiet.set(k, g);
    }
  }
  // "Never open": every conversation from the sender in the scan is still unread, and there are at least three.
  const senders = [...quiet.entries()].filter(([, g]) => g.all >= 3 && g.unread === g.all).sort((a, b) => b[1].all - a[1].all);
  const ids = senders.flatMap(([, g]) => g.ids);
  return {
    counts,
    needs,
    unread,
    waiting: wait.length,
    marks,
    cleanup: { total: ids.length, senders: senders.slice(0, 12).map(([email, g]) => ({ email, name: g.name, n: g.all })), ids: ids.slice(0, 100) },
    scanned: scan.rows.length,
    pending: scan.pending,
  };
}

/* ------------------------------------------------------------------ views */

export interface ViewOpts {
  view: string; // 'needs' | 'waiting' | 'cat:<name>' | ''
  flags: string[]; // unread starred files partner
  sort: 'new' | 'old' | '';
  days: number;
}

/** A smart view: the scanned inbox filtered by category, by what waits on the person, or by the filter chips. */
export async function smartView(ctx: SmartCtx, gm: Gmail, o: ViewOpts): Promise<{ threads: SmartRow[]; scanned: number; pending: number }> {
  if (o.view === 'waiting') {
    const rows = await waitingOn(ctx, gm, o.days);
    return { threads: o.sort === 'new' ? rows.reverse() : rows, scanned: rows.length, pending: 0 };
  }
  const terms: string[] = [];
  if (o.flags.includes('unread')) terms.push('is:unread');
  if (o.flags.includes('starred')) terms.push('is:starred');
  if (o.flags.includes('files')) terms.push('has:attachment');
  const scan = await scanInbox(ctx, gm, terms.join(' '), true);
  let rows = scan.rows;
  if (o.view === 'needs') rows = rows.filter((r) => r.ask);
  else if (o.view.startsWith('cat:')) {
    const c = o.view.slice(4);
    rows = rows.filter((r) => r.cat === c);
  }
  if (o.flags.includes('partner')) rows = rows.filter((r) => r.partner);
  const oldest = o.sort === 'old' || (o.sort === '' && o.view === 'needs');
  rows = [...rows].sort((a, b) => (oldest ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
  return { threads: rows, scanned: scan.rows.length, pending: scan.pending };
}

/* ------------------------------------------------------------------ summary and suggested replies */

const BANNED = /\b(just|simply|actually|literally|truly|delve|leverage|utilize|facilitate)\b ?/gi;
/** Text meant for Will's mail: no dashes used as breaks, none of the empty adverbs, one tidy line each. */
export function tidy(s: unknown, max = 600): string {
  return String(s || '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(BANNED, '')
    .replace(/\bdonors?\b/gi, 'partner')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, max);
}

/** The newest words of one message: its plain text without quoted earlier mail, signatures cut short. */
export function freshText(m: { text: string; html: string; snippet: string }): string {
  let t = m.text;
  if (!t && m.html) {
    t = m.html
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
  }
  t = t || m.snippet || '';
  t = t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  const cut = t.search(/\n\s*(On .{5,120} wrote:|-{2,} ?Original Message|From: .+\nSent: )/);
  if (cut > 0) t = t.slice(0, cut);
  return t
    .split('\n')
    .filter((l) => !/^\s*>/.test(l))
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function llm(ai: Runner | undefined, system: string, user: string, max: number): Promise<string> {
  if (!ai) return '';
  const out: any = await timeout(
    ai.run(TEXT_MODEL, { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: max, temperature: 0.4 }),
    TEXT_MS,
    'The model'
  );
  return String(out?.response ?? out?.result?.response ?? '').trim();
}

export interface Assist {
  summary: string;
  replies: string[];
  ask: boolean;
}

interface AssistMsg {
  from: Addr;
  date: string;
  text: string;
  html: string;
  snippet: string;
  draft: boolean;
  labelIds: string[];
}

const firstName = (a: Addr) => (a.name || a.email.split('@')[0]).replace(/[^A-Za-z' -]/g, ' ').trim().split(/\s+/)[0] || '';

export function parseReplies(raw: string): string[] {
  const m = raw.match(/\{[\s\S]*\}/);
  let list: unknown[] = [];
  try {
    const j = JSON.parse(m ? m[0] : raw);
    list = Array.isArray(j) ? j : Array.isArray(j?.replies) ? j.replies : [];
  } catch {
    list = [...raw.matchAll(/"([^"\n]{8,400})"/g)].map((x) => x[1]);
  }
  return list
    .map((x) => tidy(typeof x === 'string' ? x : (x as any)?.text, 500))
    .filter((x) => x.length >= 4)
    .slice(0, 3);
}

/** The one-line summary of a long conversation and up to three short replies to the newest message, in the person's voice. */
export async function assist(ctx: SmartCtx, msgs: AssistMsg[], partner: { name: string } | null): Promise<Assist> {
  const real = msgs.filter((m) => !m.draft);
  const last = real[real.length - 1];
  if (!last) return { summary: '', replies: [], ask: false };
  const texts = real.slice(-4).map((m) => ({ m, t: freshText(m).slice(0, 1400) }));
  const long = real.length >= 3 || texts.reduce((n, x) => n + x.t.length, 0) > 1300;
  const incoming = last.from.email !== ctx.me && !last.labelIds.some((l) => /^CATEGORY_(PROMOTIONS|SOCIAL|FORUMS)$/.test(l)) && !/no-?reply|donotreply|notifications?@/i.test(last.from.email);
  const thread = texts.map((x) => `From ${x.m.from.name || x.m.from.email}${x.m.from.email === ctx.me ? ' (me)' : ''}, ${x.m.date.slice(0, 10)}:\n${x.t}`).join('\n\n---\n\n');
  const first = ctx.name.split(/\s+/)[0] || 'me';

  const sum = long
    ? llm(ctx.ai, 'You summarize email conversations for a busy ministry executive. Reply with one plain sentence of at most 28 words that says who wants what and any date or amount. No preface, no quotes, no dashes.', thread, 90).then((s) => tidy(s.split('\n')[0], 220)).catch(() => '')
    : Promise.resolve('');
  const rep = incoming
    ? llm(
        ctx.ai,
        `You draft email replies for ${first} at Favor International, a ministry. Write in first person, short, plain and direct, warm without gushing. Each reply is under 45 words and starts with "Hi ${firstName(last.from) || 'there'}," on its own line. Never use dashes as breaks, never the words just, simply or actually, never "donor" (say partner). Do not invent facts, dates, amounts or promises the email does not settle. Give three options that differ in stance: say yes or agree, say not yet or no, and ask one clarifying question. When the email only informs, give three ways to acknowledge it. Return JSON only: {"replies":["...","...","..."]}.${partner ? ` The sender, ${partner.name}, is a Favor partner.` : ''}`,
        thread,
        420
      ).then(parseReplies).catch(() => [] as string[])
    : Promise.resolve([] as string[]);
  const [summary, replies] = await Promise.all([sum, rep]);
  const ask = incoming && (/\?/.test(texts[texts.length - 1].t) || ASK_WORDS.test(texts[texts.length - 1].t));
  return { summary, replies, ask };
}

/** Saves a summary under the conversation's newest message id so a second look costs nothing. */
export async function saveSummary(env: Env, me: string, threadId: string, lastMid: string, summary: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO hub_mail_class (email, thread_id, last_mid, summary, summary_mid, at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(email, thread_id) DO UPDATE SET summary = excluded.summary, summary_mid = excluded.summary_mid, at = excluded.at`
  ).bind(me, threadId, lastMid, summary, lastMid, nowIso()).run().catch(() => undefined);
}

export async function savedSummary(env: Env, me: string, threadId: string, lastMid: string): Promise<string> {
  const r = await env.DB.prepare('SELECT summary, summary_mid FROM hub_mail_class WHERE email = ? AND thread_id = ?').bind(me, threadId).first<{ summary: string; summary_mid: string }>().catch(() => null);
  return r && r.summary && r.summary_mid === lastMid ? r.summary : '';
}

/* ------------------------------------------------------------------ partner card */

export interface PartnerCard {
  id: string;
  name: string;
  lookup: string;
  total: number;
  count: number;
  firstDate: string;
  ytd: number;
  last: { amount: number; date: string; fund: string } | null;
  holders: Array<{ name: string; type: string }>;
  lastContact: { date: string; category: string } | null;
  openActions: number;
  doNotEmail: boolean;
}

export function cardOf(p: any): PartnerCard {
  return {
    id: String(p.id),
    name: String(p.name || ''),
    lookup: String(p.lookup || ''),
    total: Number(p.giving?.total) || 0,
    count: Number(p.giving?.count) || 0,
    firstDate: String(p.giving?.firstDate || ''),
    ytd: Number(p.giving?.ytd) || 0,
    last: p.giving?.last ? { amount: Number(p.giving.last.amount) || 0, date: String(p.giving.last.date || ''), fund: String(p.giving.last.fund || '') } : null,
    holders: (p.assignments || []).filter((a: any) => a.current).map((a: any) => ({ name: String(a.name || ''), type: String(a.type || '') })).slice(0, 4),
    lastContact: p.lastContact ? { date: String(p.lastContact.date || ''), category: String(p.lastContact.category || '') } : null,
    openActions: Number(p.actions?.openCount) || 0,
    doNotEmail: !!p.flags?.doNotEmail,
  };
}
