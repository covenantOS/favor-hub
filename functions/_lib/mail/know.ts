// Mail knows Favor: who a sender is to Favor, what an appeal code, fund or Lookup ID is, the morning briefing, what a partner's
// email says about giving, the promises in sent mail, answers about a conversation, what an attachment is, a partner timeline,
// the writing check before send, and templates with data fields. Everything reads headers, short previews and the thread the
// person has open; nothing here keeps a message body (summaries, answers and category moves only).
import type { Env } from '../http';
import { nowIso } from '../http';
import { staffDirectory } from '../people';
import type { Addr, Gmail } from './gmail';
import { idsFor, rowsFor } from './rows';
import { MAJOR, TEXT_MODEL, scanInbox, tidy, type SmartCtx, type SmartRow } from './smart';
import { partnerMap } from './partners';
import { aiFor } from '../ai/guard';
import { lastGiftLine, lifetimeLine } from '../../../shared/giving';

const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const DAY = 864e5;
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

/* ------------------------------------------------------------------ sender profile */

export interface Profile {
  email: string;
  name: string;
  role: string;
  kind: 'staff' | 'partner' | 'outside';
  partner: { id: string; name: string } | null;
  staff: { title: string; team: string } | null;
  history: { lastDate: string; recent: Array<{ id: string; subject: string; date: string }> };
  /** The short facts the card shows after the role, already worded: last contact, shared projects, open tasks between the two. */
  facts: string[];
  canProspect: boolean;
}

const etDay = (iso: string) => (iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' }) : '');

/**
 * What a staff member and the viewer share in FavorOS Projects: the active projects both belong to, and the open tasks one of
 * them holds that the other made or follows. Only what the viewer may see (the Projects access rule and visibleProject and
 * visibleTask), and nothing at all when Projects is not open to the viewer or its tables are not there.
 */
export async function sharedWork(env: Env, me: string, other: string, viewer: { admin: boolean; name?: string }): Promise<{ projects: string[]; projectCount: number; tasks: number }> {
  const none = { projects: [] as string[], projectCount: 0, tasks: 0 };
  try {
    const { projectsMode, modeAllows, visibleProject, visibleTask } = await import('../projects/access');
    if (!modeAllows(await projectsMode(env), { admin: viewer.admin })) return none;
    const actor = { email: me, name: viewer.name || me, admin: viewer.admin };
    const vp = visibleProject(actor, 'p');
    const inProject = (who: string) => `(lower(p.lead_email) = ${who} OR EXISTS (SELECT 1 FROM hub_project_members m WHERE m.project_id = p.id AND lower(m.email) = ${who}))`;
    const projects = await env.DB.prepare(`SELECT p.name FROM hub_projects p WHERE p.status = 'active' AND ${vp.sql} AND ${inProject('?')} AND ${inProject('?')} ORDER BY p.name COLLATE NOCASE LIMIT 20`)
      .bind(...vp.args, me, me, other, other)
      .all<{ name: string }>();
    const vt = visibleTask(actor, 't');
    const onIt = (who: string) => `(lower(COALESCE(t.created_by, '')) = ${who} OR EXISTS (SELECT 1 FROM hub_task_people tp WHERE tp.task_id = t.id AND lower(tp.email) = ${who}))`;
    const tasks = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM hub_tasks t WHERE t.status NOT IN ('done', 'dropped') AND ${vt.sql}
         AND ((lower(COALESCE(t.owner_email, '')) = ? AND ${onIt('?')}) OR (lower(COALESCE(t.owner_email, '')) = ? AND ${onIt('?')}))`
    )
      .bind(...vt.args, other, me, me, me, other, other)
      .first<{ n: number }>();
    const names = (projects.results || []).map((r) => String(r.name));
    return { projects: names.slice(0, 3), projectCount: names.length, tasks: Number(tasks?.n) || 0 };
  } catch {
    return none;
  }
}

/** Who this address is to Favor: staff, a partner in Blackbaud, or someone outside, with the last contact and, for staff, what the two share. */
export async function senderProfile(ctx: SmartCtx, gm: Gmail, email: string, name = '', viewer: { admin: boolean } = { admin: false }): Promise<Profile> {
  const e = lower(email);
  const [dir, pm, hist] = await Promise.all([
    staffDirectory(ctx.env).catch(() => []),
    partnerMap(ctx.env, [e], ctx.partners),
    idsFor(gm, { q: `from:${e} OR to:${e}` }, 40).catch(() => ({ threads: [] as Array<{ id: string; historyId?: string }>, more: false })),
  ]);
  const person = dir.find((p) => p.email === e) || null;
  const partner = pm[e] || null;
  const rows = await rowsFor(gm, ctx.me, hist.threads.slice(0, 5), 5).catch(() => []);
  const kind: Profile['kind'] = person ? 'staff' : partner ? 'partner' : 'outside';
  const role = person ? `Staff${person.title ? ', ' + person.title : person.team ? ', ' + person.team : ''}` : partner ? `Partner in Blackbaud, ${partner.name}` : 'Not in Blackbaud';
  const lastDate = rows[0]?.date || '';
  const facts: string[] = [lastDate ? `Last contact ${etDay(lastDate)}` : 'First email'];
  if (person && e !== ctx.me) {
    const w = await sharedWork(ctx.env, ctx.me, e, { admin: viewer.admin, name: ctx.name });
    if (w.projects.length) facts.push(`Shared ${w.projectCount === 1 ? 'project' : 'projects'}: ${w.projects.join(', ')}${w.projectCount > w.projects.length ? ` and ${w.projectCount - w.projects.length} more` : ''}`);
    if (w.tasks) facts.push(`${w.tasks} open ${w.tasks === 1 ? 'task' : 'tasks'} between you`);
  }
  return {
    email: e,
    name: name || person?.name || partner?.name || e,
    role,
    kind,
    partner,
    staff: person ? { title: person.title || '', team: person.team || '' } : null,
    history: { lastDate, recent: rows.map((r) => ({ id: r.id, subject: r.subject, date: r.date })) },
    facts,
    canProspect: kind === 'outside' && !/noreply|no-reply|notifications?@|mailer-daemon/i.test(e),
  };
}

/* ------------------------------------------------------------------ entities (appeals, funds, Lookup IDs, staff) */

export interface EntityCard {
  kind: string;
  key: string;
  title: string;
  sub: string;
  lines: Array<{ k: string; v: string }>;
  href: string;
  id?: string;
}

export type MirrorQ = <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;

/** One card for what a message mentions. `q` is the appeal code, fund name, Lookup ID or staff email as written in the message. */
export async function entityCard(env: Env, mq: MirrorQ, kind: string, qRaw: string): Promise<EntityCard | null> {
  const q = String(qRaw || '').trim().slice(0, 120);
  if (!q) return null;
  // Appeal codes are answered by the shared /api/hub/entity route. Mail answers fund names and Lookup IDs.
  if (kind === 'fund') {
    const r = (await mq<any>("SELECT fund_id AS code, fund_description AS d, COALESCE(fund_inactive, 0) AS off FROM funds WHERE lower(fund_description) = lower(?1) OR upper(fund_id) = upper(?1) LIMIT 1", [q]))[0];
    if (!r) return null;
    return { kind, key: q, title: String(r.d || r.code), sub: 'Fund ' + String(r.code || ''), lines: [{ k: 'Status', v: Number(r.off) ? 'Inactive' : 'Active' }], href: '' };
  }
  if (kind === 'lookup') {
    const digits = q.replace(/\D/g, '');
    if (!digits) return null;
    const r = (await mq<any>("SELECT id, constituent_lookup_id AS lookup, COALESCE(json_extract(raw_json, '$.name'), trim(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'') || COALESCE(organization_name,''))) AS name FROM constituents WHERE constituent_lookup_id = ?1 LIMIT 1", [digits]))[0];
    if (!r) return null;
    // The household's credited giving under the shared rule (soft credits count for the partner they name, spouses once).
    const { givingForMany } = await import('../gifts/partner-giving');
    const g = (await givingForMany(mq as any, [String(r.id)])).get(String(r.id));
    const lines = [{ k: 'Giving', v: g ? lifetimeLine(g) : 'No gifts yet' }, ...(g && g.last ? [{ k: 'Last gift', v: lastGiftLine(g) }] : [])];
    return { kind, key: digits, id: String(r.id), title: String(r.name || 'Record ' + digits), sub: 'Lookup ID ' + digits, lines, href: '/work/partner/' + encodeURIComponent(String(r.id)) };
  }
  if (kind === 'staff') {
    const e = lower(q);
    const p = (await staffDirectory(env).catch(() => [])).find((x) => x.email === e);
    if (!p) return null;
    return { kind, key: e, title: p.name, sub: p.title || p.team || 'Staff', lines: [{ k: 'Email', v: p.email }, ...(p.team ? [{ k: 'Team', v: p.team }] : [])], href: '' };
  }
  return null;
}

let FUNDS: { at: number; names: string[] } | null = null;
/** Active fund names, so a message that names one can show its card. Kept an hour. */
export async function fundNames(mq: MirrorQ): Promise<string[]> {
  if (FUNDS && Date.now() - FUNDS.at < 3600000) return FUNDS.names;
  const rows = await mq<any>("SELECT fund_description AS d FROM funds WHERE COALESCE(fund_inactive, 0) = 0 AND length(fund_description) >= 6 ORDER BY length(fund_description) DESC LIMIT 400").catch(() => []);
  FUNDS = { at: Date.now(), names: rows.map((r: any) => String(r.d)).filter(Boolean) };
  return FUNDS.names;
}

/* ------------------------------------------------------------------ gifts and promises in the text */

const GIFT_WORDS = /\b(gift|donat\w*|check|cheque|giving|pledge|contribut\w*|sent|mailed|wire|transfer|matching)\b/i;
/** A dollar amount near a word about giving in a partner's email: the gift they say they gave or will give. */
export function giftMention(text: string): { amount: number; text: string } | null {
  const t = String(text || '');
  const re = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const around = t.slice(Math.max(0, m.index - 90), m.index + 90);
    const amount = Number(m[1].replace(/,/g, '')) + (m[2] ? Number(m[2]) / 100 : 0);
    if (amount >= 5 && GIFT_WORDS.test(around)) return { amount, text: around.replace(/\s+/g, ' ').trim() };
  }
  return null;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function dueIn(sentence: string, from: Date): string {
  const s = sentence.toLowerCase();
  const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  if (/\btomorrow\b/.test(s)) return day(new Date(from.getTime() + DAY));
  if (/\btoday\b|\btonight\b/.test(s)) return day(from);
  if (/\bnext week\b/.test(s)) return day(new Date(from.getTime() + 7 * DAY));
  const w = WEEKDAYS.findIndex((x) => new RegExp('\\b' + x + '\\b').test(s));
  if (w >= 0) {
    const add = ((w - from.getDay() + 7) % 7) || 7;
    return day(new Date(from.getTime() + add * DAY));
  }
  return '';
}

/** The promises in a message the person sent: "I will send", "I'll call", "we will confirm", each with a due day when it names one. */
export function commitments(text: string, sentAt: string): Array<{ text: string; due: string }> {
  const out: Array<{ text: string; due: string }> = [];
  const from = new Date(sentAt || Date.now());
  const body = String(text || '').split(/\n\s*On .{5,120} wrote:|\n>/)[0];
  for (const raw of body.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)) {
    const s = raw.trim();
    if (s.length < 12 || s.length > 220) continue;
    if (/\b(I will|I'll|I can|I am going to|I'm going to|We will|We'll|Let me)\b/i.test(s) && /\b(send|call|email|confirm|check|share|get back|follow up|review|schedule|forward|mail|update|look into|talk|reach out|find out|let you know)\b/i.test(s) && !/\?$/.test(s)) {
      out.push({ text: s.replace(/^(Hi|Hello|Dear)\b[^,]*,\s*/i, ''), due: dueIn(s, from) });
    }
    if (out.length >= 3) break;
  }
  return out;
}

/* ------------------------------------------------------------------ the morning briefing */

export interface Quiet {
  notifications: number;
  receipts: number;
  newsletters: number;
  calendar: number;
}

export interface Briefing {
  text: string;
  items: Array<{ id: string; mb: string; from: string; subject: string; why: string }>;
  stats: { needs: number; major: number; waiting: number; unlogged: number; unread: number; quiet: Quiet };
  /** The date of the newest message that matters (people, partners, staff). The close button keeps this; newer important mail brings the card back. */
  key: string;
  at: string;
  /** True when the person closed the card and nothing important has come in since. Set on each read, never stored with the briefing. */
  off?: boolean;
}

const QUIET_CATS = new Set(['notifications', 'receipts', 'newsletters', 'calendar']);
// Mail FavorOS and other systems send. A person with one of these names is rare enough that the briefing treats the sender as a system.
const SYSTEM_SENDER = /\bfavoros\b|^favor (projects|hub|brain|health)\b|\b(no-?reply|do-?not-?reply|mailer-daemon|notifications?)\b/i;
const SYSTEM_SUBJECT = /\b(in|from|on) favoros\b/i;

/** Which automatic kind a conversation is (notifications, receipts, newsletters, calendar), or '' for mail from a person. Partners are never quiet. */
export function quietKind(r: Pick<SmartRow, 'cat' | 'partner' | 'bulk' | 'from' | 'subject'>): keyof Quiet | '' {
  if (r.partner) return '';
  if (r.cat && QUIET_CATS.has(r.cat)) return r.cat as keyof Quiet;
  if (SYSTEM_SENDER.test(`${r.from?.name || ''} ${r.from?.email || ''}`) || SYSTEM_SUBJECT.test(String(r.subject || ''))) return 'notifications';
  if (r.bulk) return 'newsletters';
  return '';
}

/** How much a conversation matters to the person, lowest first: waiting on you (major partners, partners, then the rest), then partners, staff, everyone else. */
export function importance(r: SmartRow): number {
  if (r.ask) return r.major ? 0 : r.partner ? 1 : r.cat === 'staff' ? 2 : 3;
  if (r.major) return 4;
  if (r.partner) return 5;
  if (r.cat === 'staff') return 6;
  return r.starred ? 6 : 7;
}

const why = (r: SmartRow): string => {
  const bits: string[] = [];
  if (r.major) bits.push('major partner');
  else if (r.partner) bits.push('partner');
  else if (r.cat === 'staff') bits.push('staff');
  if (r.ask) bits.push('waits on you');
  if (r.starred) bits.push('starred');
  return bits.join(', ') || 'unread';
};

const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/**
 * The lines at the top of the inbox, from counts only. The first sentence is the most important conversation, the second the totals,
 * and the automatic mail (notifications, receipts, newsletters, calendar) is one closing line. Says nothing only when no messages show.
 */
export function briefLine(stats: { needs: number; major: number; waiting: number; unread: number; quiet?: Partial<Quiet> }, items: Array<{ from: string; subject: string; why?: string }>, shown: number): string {
  if (!shown) return '';
  const n = (x: number) => x.toLocaleString('en-US');
  const top = items[0];
  let lead = 'No unread mail from people or partners.';
  if (top) {
    const w = top.why || '';
    const from = top.from || 'Someone';
    const who = /major partner/.test(w) ? `${from} (major partner)` : /partner/.test(w) ? `${from} (partner)` : from;
    lead = /waits on you/.test(w) ? `${who} is waiting on you about "${top.subject}".` : `${who} wrote "${top.subject}".`;
  }
  const parts: string[] = [];
  if (stats.needs) parts.push(`${n(stats.needs)} waiting on you`);
  if (stats.major) parts.push(`${n(stats.major)} from ${stats.major === 1 ? 'a major partner' : 'major partners'}`);
  if (stats.waiting) parts.push(`${n(stats.waiting)} sent with no reply`);
  const q = stats.quiet || {};
  const quiet = [
    q.notifications ? plural(q.notifications, 'notification') : '',
    q.receipts ? plural(q.receipts, 'receipt') : '',
    q.newsletters ? plural(q.newsletters, 'newsletter') : '',
    q.calendar ? plural(q.calendar, 'calendar notice') : '',
  ].filter(Boolean);
  const tail = quiet.length ? `Plus ${quiet.length > 1 ? quiet.slice(0, -1).join(', ') + ' and ' + quiet[quiet.length - 1] : quiet[0]}.` : '';
  return [lead, parts.length ? parts.join(', ') + '.' : '', tail].filter(Boolean).join(' ');
}

/**
 * The newest-important-mail marker the person last closed the briefing at (hub_mail_brief_off, db/mail-smart.sql). A read or write
 * that finds the table missing makes it and tries once more, so the page works before the migration has run.
 */
const BRIEF_OFF_DDL = "CREATE TABLE IF NOT EXISTS hub_mail_brief_off (email TEXT PRIMARY KEY, key TEXT NOT NULL DEFAULT '', at TEXT NOT NULL)";
async function withBriefOff<T>(env: Env, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await env.DB.prepare(BRIEF_OFF_DDL).run();
    return fn();
  }
}
async function briefClosedAt(env: Env, me: string): Promise<string | null> {
  try {
    const r = await withBriefOff(env, () => env.DB.prepare('SELECT key FROM hub_mail_brief_off WHERE email = ?').bind(me).first<{ key: string }>());
    return r ? String(r.key || '') : null;
  } catch {
    return null;
  }
}
/** Records that the person closed the briefing while the newest important mail was dated `key`. Only moves forward. */
export async function closeBriefing(env: Env, me: string, key: string): Promise<void> {
  const k = String(key || '').slice(0, 40);
  await withBriefOff(env, () => env.DB.prepare('INSERT INTO hub_mail_brief_off (email, key, at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET key = CASE WHEN excluded.key > hub_mail_brief_off.key THEN excluded.key ELSE hub_mail_brief_off.key END, at = excluded.at').bind(me, k, nowIso()).run());
}

/** Kept this long. Short enough that new important mail brings a closed card back the same morning. */
const BRIEF_KEEP_MS = 10 * 60 * 1000;
const BRIEF_SHAPE = 2;

async function buildBriefing(ctx: SmartCtx, gm: Gmail, waiting: number): Promise<Briefing> {
  const scan = await scanInbox(ctx, gm, '', true);
  const quiet: Quiet = { notifications: 0, receipts: 0, newsletters: 0, calendar: 0 };
  const real: SmartRow[] = [];
  for (const r of scan.rows) {
    if (r.fromMe || r.draft) continue;
    const k = quietKind(r);
    if (k) {
      if (r.unread) quiet[k]++;
      continue;
    }
    if (r.unread || r.ask) real.push(r);
  }
  const ranked = [...real].sort((a, b) => importance(a) - importance(b) || b.date.localeCompare(a.date));
  const items = ranked.slice(0, 5).map((r) => ({ id: r.id, mb: '', from: r.partner?.name || r.from?.name || r.from?.email || '', subject: r.subject || '(no subject)', why: why(r) }));
  const stats = { needs: scan.rows.filter((r) => r.ask).length, major: scan.rows.filter((r) => r.major && r.unread).length, waiting, unlogged: 0, unread: real.filter((r) => r.unread).length, quiet };
  const key = real.reduce((m, r) => (r.date > m ? r.date : m), '');
  return { text: briefLine(stats, items, scan.rows.length), items, stats, key, at: nowIso() };
}

/** The conversations to start with, in order, and a few plain sentences about the morning. No model is asked. */
export async function briefing(ctx: SmartCtx, gm: Gmail, _runModel: (system: string, user: string, max: number) => Promise<string>, waiting: number, force = false): Promise<Briefing> {
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const closed = briefClosedAt(ctx.env, ctx.me);
  const saved = await ctx.env.DB.prepare('SELECT body, at FROM hub_mail_brief WHERE email = ? AND day = ?').bind(ctx.me, day).first<{ body: string; at: string }>().catch(() => null);
  let out: Briefing | null = null;
  if (!force && saved && Date.now() - Date.parse(saved.at) < BRIEF_KEEP_MS) {
    try {
      const b = JSON.parse(saved.body) as Briefing & { shape?: number };
      if (b.shape === BRIEF_SHAPE) out = b;
    } catch {
      /* rebuilt below */
    }
  }
  if (!out) {
    out = await buildBriefing(ctx, gm, waiting);
    await ctx.env.DB.prepare('INSERT INTO hub_mail_brief (email, day, body, at) VALUES (?, ?, ?, ?) ON CONFLICT(email, day) DO UPDATE SET body = excluded.body, at = excluded.at').bind(ctx.me, day, JSON.stringify({ ...out, shape: BRIEF_SHAPE }), out.at).run().catch(() => undefined);
  }
  const at = await closed;
  return { ...out, off: at !== null && out.key <= at };
}

/* ------------------------------------------------------------------ questions about one conversation */

/** The budget name Ask is booked under (functions/_lib/ai/guard.ts): the same daily ceiling as Favor Brain. */
export const ASK_FEATURE = 'mail-ask';
export const ASK_PAUSED = 'Ask is resting for today. It opens again tomorrow, and Ask Favor Brain still works.';

/** One question about one conversation, answered from the text of the last eight messages. Throws AiPaused past the daily ceiling. */
export async function askThread(runModel: (system: string, user: string, max: number) => Promise<string>, thread: string, question: string): Promise<string> {
  const q = String(question || '').trim().slice(0, 400);
  if (q.length < 3) return '';
  const a = await runModel('You answer a question about one email conversation. Use only what the conversation says. If it does not say, answer "The conversation does not say." Answer in one to three short sentences, plain words, no dashes, never the word donor (say partner).', `Conversation:\n${thread.slice(0, 9000)}\n\nQuestion: ${q}`, 220);
  return tidy(a, 700);
}

/* ------------------------------------------------------------------ what an attachment is */

export const FILE_KINDS: Record<string, string> = {
  check: 'A bank check, personal, business, DAF or foundation check, showing a pay-to line and an amount',
  receipt: 'A receipt, invoice or order confirmation for a purchase',
  w9: 'An IRS Form W-9 or other tax form',
  grant_letter: 'A letter from a foundation or funder about a grant: an award, a decline, a request for a report or a request for information',
  photo: 'A photograph of people, a place or an event',
  other: 'Any other document',
};
export const NEXT_STEP: Record<string, { text: string; href: string }> = {
  check: { text: 'Start a gift entry for this check', href: '/gift-entry/' },
  receipt: { text: 'Forward to accounting or file it with the expense request', href: '/expenses/new/' },
  w9: { text: 'Send to accounting', href: '' },
  grant_letter: { text: 'Add to the grants pipeline', href: '/work/?tab=grants' },
  photo: { text: 'Save to the Drive photo library', href: '' },
};

/** What a file is, from the picture when it is one (Clef reads images) and from its name and the email around it otherwise. */
export async function fileKind(ai: { run(model: string, input: unknown): Promise<unknown> } | undefined, name: string, mime: string, subject: string, dataUrl = ''): Promise<{ kind: string; p: number }> {
  const byName = /w-?9/i.test(name) ? 'w9' : /check|cheque/i.test(name) ? 'check' : /receipt|invoice/i.test(name) ? 'receipt' : /grant|award|loi|proposal/i.test(name + ' ' + subject) ? 'grant_letter' : /\.(jpe?g|png|heic|webp)$/i.test(name) ? 'photo' : 'other';
  if (!ai) return { kind: byName, p: 0 };
  try {
    const input: Record<string, unknown> = {
      model: 'clef',
      state: `File name: ${name}\nType: ${mime}\nEmail subject: ${subject.slice(0, 160)}`,
      questions: { kind: { type: 'choice', instructions: 'What kind of file is this attachment?', criteria: FILE_KINDS } },
    };
    if (dataUrl) input.images = [dataUrl];
    const out: any = await aiFor(ai, 'mail-sort').run('@cf/cloudflare/clef', input);
    const a = (out?.answers || out?.result?.answers)?.kind;
    const k = String(a?.choice || '');
    if (!(k in FILE_KINDS)) return { kind: byName, p: 0 };
    const p = Number(a?.probabilities?.[k]);
    return p >= 0.5 ? { kind: k, p } : { kind: byName, p: Number.isFinite(p) ? p : 0 };
  } catch {
    return { kind: byName, p: 0 };
  }
}

/* ------------------------------------------------------------------ the writing check before send */

export interface Warn {
  code: 'donor' | 'name' | 'amount' | 'attachment' | 'subject' | 'empty' | 'bulk' | 'external' | 'typo';
  text: string;
}

const plain = (html: string) => String(html || '').replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<blockquote[\s\S]*?<\/blockquote>/gi, ' ').replace(/<div class="gmail_quote"[\s\S]*$/i, ' ').replace(/<br\s*\/?>|<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

/**
 * What to look at before this message goes: the word "donor", a greeting that names someone other than the partner it goes to, an
 * amount that differs from the partner's last gift or the amounts in the earlier mail, "attached" with no file, and no subject.
 */
export function writingCheck(input: { html: string; subject: string; files: number; to: Addr[]; partnerName: string; lastGift: number; quotedAmounts: number[]; recipients?: number; threadInternal?: boolean; external?: string[] }): Warn[] {
  const t = plain(input.html);
  const out: Warn[] = [];
  if (!t.replace(/\s+/g, '').length && !input.files) out.push({ code: 'empty', text: 'The message is empty.' });
  if ((input.recipients || 0) > 8) out.push({ code: 'bulk', text: `This goes to ${input.recipients} people. Check that you meant to reply to all of them.` });
  if (input.threadInternal && input.external && input.external.length) out.push({ code: 'external', text: `${input.external.join(', ')} is outside Favor, and everyone else on this conversation is staff.` });
  // A greeting name one or two letters from the partner's first name is a likely misspelling of it.
  const g2 = t.match(/^\s*(?:[Hh]i|[Hh]ello|[Dd]ear|[Hh]ey)\s+([A-Z][a-z'’-]+)\s*[,:\n]/);
  if (g2 && input.partnerName) {
    const first = input.partnerName.split(/\s+/)[0] || '';
    if (first && first.toLowerCase() !== g2[1].toLowerCase() && editDistance(first.toLowerCase(), g2[1].toLowerCase()) <= 2 && Math.min(first.length, g2[1].length) >= 4) out.push({ code: 'typo', text: `The greeting says ${g2[1]}. The partner's name is ${first}.` });
  }
  if (/\bdonors?\b/i.test(t)) out.push({ code: 'donor', text: 'The message says "donor". Favor says "partner".' });
  const greet = t.match(/^\s*(?:[Hh]i|[Hh]ello|[Dd]ear|[Hh]ey)\s+([A-Z][a-z'’-]+(?:\s+(?:and|&)\s+[A-Z][a-z'’-]+)?)\s*[,:\n]/);
  if (greet && input.partnerName) {
    const names = greet[1].split(/\s+(?:and|&)\s+/).map((x) => x.toLowerCase());
    const target = input.partnerName.toLowerCase();
    if (!names.some((n) => target.includes(n))) out.push({ code: 'name', text: `The greeting says ${greet[1]}, and the partner on this email is ${input.partnerName}.` });
  }
  const amounts = [...t.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?/g)].map((m) => Number(m[1].replace(/,/g, '')));
  const known = new Set([...input.quotedAmounts, input.lastGift].filter((x) => x > 0));
  if (amounts.length && known.size) {
    const bad = amounts.find((a) => a >= 5 && !known.has(a));
    if (bad !== undefined && input.quotedAmounts.length) out.push({ code: 'amount', text: `The message says ${money(bad)}. The earlier mail says ${[...new Set(input.quotedAmounts)].map(money).join(' and ')}.` });
  }
  if (/\b(attached|attaching|enclosed|i have attached|see attachment)\b/i.test(t) && !input.files) out.push({ code: 'attachment', text: 'The message says a file is attached, and none is.' });
  if (!input.subject.trim()) out.push({ code: 'subject', text: 'There is no subject.' });
  return out.filter((w, _i, all) => !(w.code === 'name' && all.some((x) => x.code === 'typo')));
}

function editDistance(a: string, b: string): number {
  const d: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}

export const amountsIn = (text: string): number[] => [...String(text || '').matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?/g)].map((m) => Number(m[1].replace(/,/g, ''))).filter((x) => x >= 5).slice(0, 12);

/* ------------------------------------------------------------------ templates with data fields */

export const FIELDS = ['first_name', 'name', 'last_gift', 'last_gift_date', 'total_giving', 'my_name'] as const;

/** Fills {first_name}, {last_gift} and the other fields from the partner and the person writing. A field with no data is left for the person. */
export function fillTemplate(body: string, d: { name?: string; lastGift?: number; lastGiftDate?: string; total?: number; me?: string }): string {
  const first = String(d.name || '').replace(/\band\b.*$/i, '').trim().split(/\s+/)[0] || '';
  const map: Record<string, string> = {
    first_name: first,
    name: d.name || '',
    last_gift: d.lastGift ? money(d.lastGift) : '',
    last_gift_date: d.lastGiftDate ? new Date(d.lastGiftDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '',
    total_giving: d.total ? money(d.total) : '',
    my_name: d.me || '',
  };
  return String(body || '').replace(/\{(first_name|name|last_gift|last_gift_date|total_giving|my_name)\}/g, (all, k: string) => map[k] || all);
}

/* ------------------------------------------------------------------ plain-language search */

/** Turns "partners who emailed this month about a trip" into a Gmail search and filters; null when the model is not there. */
export async function readSearch(runModel: (system: string, user: string, max: number) => Promise<string>, question: string): Promise<{ q: string; partners: boolean; major: boolean } | null> {
  const raw = await runModel('Turn a question about email into a Gmail search. Return JSON only: {"q":"gmail search words","partners":true or false,"major":true or false}. Use Gmail operators (from:, to:, subject:, has:attachment, is:unread, newer_than:7d, after:2026/01/01). partners is true when the question limits to partners or donors or givers. major is true when it limits to major or large partners. Do not invent names.', question.slice(0, 300), 120).catch(() => '');
  const plainWords = question.replace(/[^\w@.\-\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  const m = raw.match(/\{[\s\S]*\}/);
  // When the model gives no usable search, Gmail searches the words as typed.
  if (!m) return plainWords ? { q: plainWords, partners: /\bpartners?\b/i.test(question), major: /\bmajor\b/i.test(question) } : null;
  try {
    const j = JSON.parse(m[0]);
    const q = String(j.q || '').replace(/[^\w@:.\-"\s/+]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    return q ? { q, partners: !!j.partners || !!j.major, major: !!j.major } : plainWords ? { q: plainWords, partners: false, major: false } : null;
  } catch {
    return plainWords ? { q: plainWords, partners: false, major: false } : null;
  }
}

export { TEXT_MODEL };

/* ------------------------------------------------------------------ scheduling from an email */

const etParts = (d: Date) => {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(d);
  const get = (t: string) => f.find((x) => x.type === t)?.value || '';
  return { wd: get('weekday'), h: Number(get('hour')), m: Number(get('minute')) };
};

/** The next free times everyone has, on weekdays from 9 AM to 5 PM Eastern, on the quarter hour. `busy` is each person's busy list. */
export function freeSlots(busy: Array<Array<{ start: string; end: string }>>, from: Date, days: number, minutes: number, max = 6): string[] {
  const blocks = busy.flat().map((b) => [Date.parse(b.start), Date.parse(b.end)] as const);
  const out: string[] = [];
  const start = Math.ceil(Math.max(from.getTime(), Date.now() + 3600000) / 900000) * 900000;
  const end = start + days * DAY;
  let lastDay = '';
  let perDay = 0;
  for (let t = start; t < end && out.length < max; t += 900000) {
    const p = etParts(new Date(t));
    if (p.wd === 'Sat' || p.wd === 'Sun') continue;
    const mins = p.h * 60 + p.m;
    if (mins < 540 || mins + minutes > 1020) continue;
    if (blocks.some(([a, b]) => t < b && t + minutes * 60000 > a)) continue;
    const day = new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    if (day !== lastDay) { lastDay = day; perDay = 0; }
    if (perDay >= 2) continue;
    // Two slots a day at least two hours apart, so the list offers different days.
    if (perDay === 1 && (t - Date.parse(out[out.length - 1])) < 2 * 3600000) continue;
    out.push(new Date(t).toISOString());
    perDay++;
  }
  return out;
}
