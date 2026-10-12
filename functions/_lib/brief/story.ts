// One partner's whole history in one list (gifts, calls, emails, meetings, chat mentions, notes, events, clips), the next best action for
// them, and "What's the story with this partner?" written from those facts. Read only. Partner data goes only to people the Work Center
// gate lets in; the routes that call this are wrapped in work().
import type { Env } from '../http';
import { giftsForPartner } from '../work/gifts-svc';
import { GIVEN } from '../work/gifts';
import { loadPartner, mirrorQ, type PartnerView, type Q } from '../work/partner';
import { readOnly, FUNDS_SQL } from '../work/repo';
import { todayEt, type Ctx } from '../work/service';
import { cacheGet, cachePut, dayDiff, HOUSE, longDay, money, plural, shortDay, sig, writeText } from './text';
import { type Health, type Nba, healthOf, nextAction, rhythmOf, type GiftPt, type Rhythm } from './signals';

export type Kind = 'gift' | 'call' | 'email' | 'meeting' | 'mail' | 'chat' | 'note' | 'event' | 'clip' | 'task';

export interface TimelineEvent {
  id: string;
  kind: Kind;
  /** YYYY-MM-DD, or a full timestamp for chat, meetings and clips. */
  at: string;
  title: string;
  text: string;
  by: string;
  amount?: number;
  /** Gifts: the fund the gift went to. */
  fund?: string;
  href?: string;
  /** The event is still open (a task not done). */
  open?: boolean;
}

const KIND_OF: Record<string, Kind> = { 'Phone call': 'call', Email: 'email', Meeting: 'meeting', Mailing: 'mail' };
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '...' : s);
const oneLine = (s: unknown) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

const ACTION_ROWS = readOnly(`SELECT a.id AS id, substr(a.action_date_due, 1, 10) AS due, substr(a.action_completed_date, 1, 10) AS done, substr(a.date_added, 1, 10) AS added,
       a.action_type AS type, a.action_category AS category, a.action_summary AS summary, substr(COALESCE(a.action_description, ''), 1, 700) AS description,
       json_extract(a.raw_json, '$.outcome') AS outcome, json_extract(a.raw_json, '$.fundraisers') AS frs, json_extract(a.raw_json, '$.completed') AS completed,
       t.attended_Hosted AS att, t.thanked AS thanked
  FROM actions a LEFT JOIN action_tags t ON t.id = a.id WHERE a.constituent_record_id = ?1
 ORDER BY COALESCE(a.action_completed_date, a.action_date_due, a.date_added) DESC LIMIT 150`);

const GIFT_ROWS = readOnly(`SELECT id, gift_amount AS amount, substr(gift_date, 1, 10) AS d, gift_type AS gtype, gift_splits AS splits, gift_comments AS comment
  FROM gifts WHERE constituent_record_id = ?1 AND gift_amount > 0 AND gift_type IN ${GIVEN} ORDER BY gift_date DESC LIMIT 80`);

const EMAILS_OF = readOnly(`SELECT lower(email_address) AS e FROM emails WHERE constituent_record_id = ?1 AND COALESCE(is_inactive, 0) = 0 LIMIT 8`);

function parse<T>(v: unknown, fb: T): T {
  if (typeof v !== 'string' || !v) return fb;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fb;
  }
}

async function fundMap(q: Q, rows: any[]): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const r of rows) for (const s of parse<any[]>(r.splits, [])) if (s?.fund_id != null) ids.add(String(s.fund_id));
  const out = new Map<string, string>();
  if (ids.size) for (const f of await q<{ id: string; name: string }>(FUNDS_SQL, [JSON.stringify([...ids])]).catch(() => [])) out.set(String(f.id), f.name || '');
  return out;
}

/** What the hub knows about this partner outside Blackbaud: chat messages that mention them, meetings about them and the viewer's own clips. */
async function hubEvents(env: Env, me: string, name: string, cid: string, emails: string[]): Promise<TimelineEvent[]> {
  const out: TimelineEvent[] = [];
  const words = name.trim().split(/\s+/).filter(Boolean);
  const phrase = words.length >= 2 && name.trim().length >= 8 ? `%${name.trim().toLowerCase()}%` : '';
  const link = `%/work/partner/${cid}%`;
  try {
    const rows = await env.DB.prepare(
      `SELECT m.id, m.channel_id, m.thread_id, m.email, m.body, m.created_at, c.kind, c.name,
              COALESCE((SELECT name FROM meet_directory d WHERE lower(d.email) = lower(m.email) LIMIT 1), m.email) AS who
         FROM chat_messages m JOIN chat_channels c ON c.id = m.channel_id AND c.archived = 0
         JOIN chat_members cm ON cm.channel_id = m.channel_id AND cm.email = ?1
        WHERE m.deleted_at IS NULL AND (m.visible_to IS NULL OR m.visible_to = ?1) AND (m.body LIKE ?2 OR (?3 <> '' AND lower(m.body) LIKE ?3))
        ORDER BY m.id DESC LIMIT 12`
    )
      .bind(me, link, phrase)
      .all<{ id: number; channel_id: string; thread_id: number | null; email: string; body: string; created_at: string; kind: string; name: string; who: string }>();
    for (const r of rows.results || []) {
      const where = r.kind === 'public' || r.kind === 'private' ? '#' + r.name : 'Direct message';
      out.push({
        id: `chat:${r.id}`,
        kind: 'chat',
        at: r.created_at,
        title: `Mentioned in ${where}`,
        text: clip(oneLine(r.body).replace(/<@([^>|]+)(\|[^>]*)?>/g, '@$1').replace(/<#[^>]+>/g, '#channel'), 220),
        by: r.who || r.email,
        href: `/chat/?c=${encodeURIComponent(r.channel_id)}&m=${r.id}${r.thread_id ? '&t=' + r.thread_id : ''}`,
      });
    }
  } catch {
    // Chat tables not there yet: the timeline simply has no chat rows.
  }
  try {
    const likes = emails.slice(0, 4).map((e) => `%${e}%`);
    const rows = await env.DB.prepare(
      `SELECT id, title, starts_at, status, summary, host_name FROM hub_meetings
        WHERE status IN ('scheduled', 'live', 'ended') AND (lower(host_email) = ?1 OR instr(lower(invitees), '"' || ?1 || '"') > 0)
          AND (?2 <> '' AND lower(title) LIKE ?2 OR ?2 <> '' AND lower(summary) LIKE ?2${likes.map((_, i) => ` OR lower(invitees) LIKE ?${i + 3}`).join('')})
        ORDER BY COALESCE(starts_at, created_at) DESC LIMIT 8`
    )
      .bind(me, phrase, ...likes)
      .all<{ id: string; title: string; starts_at: string; status: string; summary: string; host_name: string }>();
    for (const r of rows.results || []) {
      out.push({ id: `meet:${r.id}`, kind: 'meeting', at: r.starts_at || '', title: r.title || 'Meeting', text: clip(oneLine(r.summary), 220), by: r.host_name || '', href: r.status === 'ended' ? '/meet/library/' : `/meet/room/?m=${r.id}` });
    }
  } catch {
    // Meetings tables not there yet.
  }
  try {
    if (phrase) {
      const rows = await env.DB.prepare("SELECT id, title, created_at FROM hub_clips WHERE lower(owner_email) = ?1 AND status = 'ready' AND lower(title) LIKE ?2 ORDER BY created_at DESC LIMIT 5")
        .bind(me, phrase)
        .all<{ id: string; title: string; created_at: string }>();
      for (const r of rows.results || []) out.push({ id: `clip:${r.id}`, kind: 'clip', at: r.created_at, title: r.title, text: 'Your clip', by: '', href: `/clips/watch/?id=${r.id}` });
    }
  } catch {
    // Clips tables not there yet.
  }
  return out.filter((e) => e.at);
}

export interface Timeline {
  partner: { id: string; name: string; place: string };
  events: TimelineEvent[];
  counts: Record<string, number>;
  synced: string;
}

export async function timelineFor(ctx: Ctx, cid: string, partner?: PartnerView | null): Promise<Timeline | null> {
  const q = mirrorQ(ctx.env);
  const p = partner || (await loadPartner(q, cid, todayEt()));
  if (!p) return null;
  const [acts, gifts, mails, soft] = await Promise.all([q<any>(ACTION_ROWS, [cid]), q<any>(GIFT_ROWS, [cid]), q<any>(EMAILS_OF, [cid]).catch(() => []), Promise.resolve(p.giving.soft.recent)]);
  const funds = await fundMap(q, gifts);
  const fundOf = (splits: unknown) => [...new Set(parse<any[]>(splits, []).map((s) => funds.get(String(s?.fund_id ?? ''))).filter(Boolean) as string[])].join(', ');
  const events: TimelineEvent[] = [];
  for (const g of gifts) {
    const fund = fundOf(g.splits);
    events.push({ id: `gift:${g.id}`, kind: 'gift', at: String(g.d), title: `${money(Number(g.amount) || 0)} to ${fund || 'no fund on file'}`, text: g.gtype === 'RecurringGiftPayment' ? 'Monthly gift' : oneLine(g.comment).slice(0, 160), by: '', amount: Number(g.amount) || 0, fund: fund || 'No fund on file' });
  }
  for (const g of soft) events.push({ id: `soft:${g.id}`, kind: 'gift', at: g.date, title: `${money(g.amount)} to ${g.fund || 'no fund on file'}`, text: 'Soft credit', by: '', amount: g.amount, fund: g.fund || 'No fund on file' });
  const fname = new Map<string, string>();
  for (const a of p.assignments) fname.set(a.fid, a.name);
  for (const a of acts) {
    const open = !(String(a.completed) === 'true' || Number(a.completed) === 1 || a.done);
    // Blackbaud stores 1900-01-01 where no date was ever set; such a note has no place in a dated list.
    const at = [a.done, a.due, a.added].map((x) => String(x || '')).find((x) => x && !x.startsWith('1900')) || '';
    if (!at || /^tags from ctg/i.test(oneLine(a.summary))) continue;
    const category = String(a.category || '');
    const by = parse<any[]>(a.frs, []).map((f) => fname.get(String(f)) || '').filter(Boolean).join(', ');
    const desc = oneLine(a.description);
    let kind: Kind = KIND_OF[category] || (desc ? 'note' : 'task');
    if (Number(a.att) === 1 || String(a.att) === 'true') kind = 'event';
    if (kind === 'task' && !open) continue;
    const title = oneLine(a.summary) || oneLine(a.type) || category || 'Action';
    events.push({ id: `act:${a.id}`, kind, at, title: clip(title, 140), text: clip(desc, 260), by: by + (a.outcome ? (by ? ' · ' : '') + oneLine(a.outcome) : ''), open, href: `/work/?action=${encodeURIComponent(String(a.id))}` });
  }
  const extra = await hubEvents(ctx.env, ctx.email.toLowerCase(), p.name, cid, mails.map((m: any) => String(m.e)));
  events.push(...extra);
  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const counts: Record<string, number> = {};
  for (const e of events) counts[e.kind] = (counts[e.kind] || 0) + 1;
  return { partner: { id: p.id, name: p.name, place: p.place }, events: events.slice(0, 250), counts, synced: p.synced };
}

/* ------------------------------------------------------------------ the story and the next best action */

export interface StoryFacts {
  name: string;
  place: string;
  kind: string;
  since: string;
  life: number;
  count: number;
  ytd: number;
  l12: number;
  p12: number;
  last: { amount: number; date: string; fund: string } | null;
  largest: { amount: number; date: string } | null;
  monthly: { amount: number; status: string } | null;
  fund: string;
  rhythm: Rhythm;
  health: Health;
  healthWhy: string;
  quiet: number | null;
  contacts: { date: string; how: string; line: string }[];
  notes: { date: string; line: string }[];
  open: { due: string; line: string }[];
  holders: string[];
  owed: { n: number; total: number; oldestDays: number } | null;
  asks: { amount: number; date: string } | null;
}

function topFund(p: PartnerView): string {
  const by = new Map<string, number>();
  for (const g of p.giving.recent) if (g.fund) by.set(g.fund, (by.get(g.fund) || 0) + g.amount);
  return [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

export async function factsOf(ctx: Ctx, cid: string, p: PartnerView, today: string): Promise<StoryFacts> {
  const pts: GiftPt[] = p.giving.recent.map((g) => ({ d: g.date, a: g.amount }));
  const rhythm = rhythmOf(pts, today);
  const lastContact = p.lastContact;
  const quiet = lastContact && lastContact.date ? Math.max(0, dayDiff(lastContact.date, today)) : null;
  const prevYear = p.giving.years.find((y) => y.year === String(Number(today.slice(0, 4)) - 1));
  const h = healthOf({ l12: p.giving.last12, p12: prevYear ? prevYear.total : 0, life: p.giving.total, gifts: p.giving.count, firstDate: p.giving.firstDate, quiet, rhythm }, today);
  const owedRows = await giftsForPartner(ctx, cid).catch(() => []);
  const m = p.recurring.find((r) => /active/i.test(r.status));
  return {
    name: p.name,
    place: p.place,
    kind: p.kind,
    since: p.giving.count ? (p.giving.firstDate || '').slice(0, 4) : '',
    life: p.giving.total,
    count: p.giving.count,
    ytd: p.giving.ytd,
    l12: p.giving.last12,
    p12: prevYear ? prevYear.total : 0,
    last: p.giving.last ? { amount: p.giving.last.amount, date: p.giving.last.date, fund: p.giving.last.fund } : null,
    largest: p.giving.largest ? { amount: p.giving.largest.amount, date: p.giving.largest.date } : null,
    monthly: m ? { amount: m.amount, status: m.status } : null,
    fund: topFund(p),
    rhythm,
    health: h.health,
    healthWhy: h.why,
    quiet,
    contacts: p.actions.recent
      .filter((a) => ['Phone call', 'Email', 'Meeting'].includes(a.category) && (a.done || a.due))
      .slice(0, 4)
      .map((a) => ({ date: a.done || a.due, how: a.category, line: clip(oneLine(a.description) || oneLine(a.summary), 160) })),
    notes: p.notes.slice(0, 4).map((n) => ({ date: n.date, line: clip(oneLine(n.summary + (n.text ? '. ' + n.text : '')), 200) })),
    open: p.actions.open.slice(0, 3).map((a) => ({ due: a.due, line: clip(oneLine(a.summary || a.type), 90) })),
    holders: p.assignments.filter((a) => a.current).map((a) => a.name),
    owed: owedRows.length ? { n: owedRows.length, total: owedRows.reduce((n, g) => n + g.amount, 0), oldestDays: Math.max(...owedRows.map((g) => g.ageDays)) } : null,
    asks: null,
  };
}

export function nbaFromFacts(f: StoryFacts, p: PartnerView, today: string): Nba {
  const phones = p.contact.phones || [];
  const emails = p.contact.emails || [];
  const task = f.open[0];
  return nextAction(
    {
      name: f.name,
      health: f.health,
      rhythm: f.rhythm,
      l12: f.l12,
      p12: f.p12,
      life: f.life,
      quiet: f.quiet,
      owed: f.owed,
      firstGiftDays: f.count === 1 && p.giving.firstDate ? Math.max(0, dayDiff(p.giving.firstDate, today)) : null,
      nextTask: task && task.due ? { due: task.due, summary: task.line } : null,
      hasPhone: phones.length > 0,
      doNotCall: phones.length > 0 && phones.every((x) => x.doNotCall),
      hasEmail: emails.length > 0,
      doNotEmail: emails.length > 0 && emails.every((x) => x.doNotEmail),
    },
    today
  );
}

/** The paragraph used when the model is not available or is slow: built from the same facts, so it is never wrong. */
export function plainStory(f: StoryFacts, today: string): string {
  const parts: string[] = [];
  const first = f.name.split(/\s+/)[0];
  if (!f.count) return f.holders.length ? `${f.holders.join(' and ')} holds the record. No gift yet.` : 'No gift yet.';
  parts.push(`${f.name} has given ${money(f.life)} in ${plural(f.count, 'gift')}${f.since ? ' since ' + f.since : ''}${f.monthly ? `, and gives ${money(f.monthly.amount)} a month` : ''}.`);
  if (f.last) parts.push(`The last gift was ${money(f.last.amount)}${f.last.fund ? ' to ' + f.last.fund : ''} on ${longDay(f.last.date, today)}.`);
  parts.push(f.healthWhy);
  if (f.owed) parts.push(`${first} has ${plural(f.owed.n, 'gift')} not thanked yet.`);
  if (f.contacts[0]) parts.push(`The last contact was a ${f.contacts[0].how.toLowerCase()} on ${longDay(f.contacts[0].date, today)}.`);
  return parts.join(' ');
}

export interface Story {
  text: string;
  at: string;
  health: Health;
  why: string;
}

const STORY_SYSTEM = `${HOUSE} You summarize one ministry partner for a staff member who is about to talk with them. Write exactly two short sentences. The first says how long and how much they have given and what they give to. The second gives the one thing to keep in mind from the last contact or notes, such as a prayer request. Use dollar amounts with commas.`;

/** True when no sentence contradicts the records: no absence claimed for a partner who has gifts, no year or dollar figure the records do not hold. */
export function agrees(text: string, f: StoryFacts, today: string): boolean {
  if (f.count > 0 && /\b(no (record|gifts?|giving)|not (on record|given)|never (given|gave)|has not given)\b/i.test(text)) return false;
  const years = new Set<string>([today.slice(0, 4), String(Number(today.slice(0, 4)) - 1), f.since, f.last ? f.last.date.slice(0, 4) : '', f.largest ? f.largest.date.slice(0, 4) : '']);
  for (const y of text.match(/\b(?:19|20)\d\d\b/g) || []) if (!years.has(y)) return false;
  const amounts = new Set<number>([f.life, f.ytd, f.l12, f.p12, f.last ? f.last.amount : -1, f.largest ? f.largest.amount : -1, f.monthly ? f.monthly.amount : -1].map((n) => Math.round(n)));
  for (const m of text.match(/\$[\d,]+(?:\.\d\d)?/g) || []) if (!amounts.has(Math.round(Number(m.replace(/[$,]/g, ''))))) return false;
  return true;
}

export async function storyFor(ctx: Ctx, cid: string, p: PartnerView, today: string, fresh = false): Promise<{ story: Story; facts: StoryFacts; nba: Nba }> {
  const facts = await factsOf(ctx, cid, p, today);
  const nba = nbaFromFacts(facts, p, today);
  const key = `story:${cid}`;
  const s = sig([facts.life, facts.count, facts.l12, facts.last, facts.contacts[0], facts.notes[0], facts.open[0], facts.owed, facts.healthWhy, today.slice(0, 7)]);
  if (!fresh) {
    const hit = await cacheGet<{ sig: string; story: Story }>(ctx.env, key, 24 * 3600000);
    if (hit && hit.sig === s) return { story: hit.story, facts, nba };
  }
  const brief = JSON.stringify(
    {
      today,
      partner: facts.name,
      place: facts.place,
      type: facts.kind,
      givingSince: facts.since,
      lifetime: facts.life,
      gifts: facts.count,
      thisYear: facts.ytd,
      last12Months: facts.l12,
      priorYear: facts.p12,
      lastGift: facts.last,
      largestGift: facts.largest,
      monthlyGift: facts.monthly,
      mostlyGivesTo: facts.fund,
      pattern: facts.rhythm.cadence,
      health: facts.healthWhy,
      daysSinceLastContact: facts.quiet,
      recentContacts: facts.contacts,
      recentNotes: facts.notes,
      openTasks: facts.open,
      heldBy: facts.holders,
      giftsNotThanked: facts.owed,
    },
    null,
    0
  );
  // The templated story comes first. A model sentence replaces it only when it agrees with the facts.
  const plain = plainStory(facts, today);
  const drafted = facts.count ? await writeText(ctx.env, { system: STORY_SYSTEM, user: brief, max: 200, timeoutMs: 14000 }) : null;
  const text = drafted && agrees(drafted, facts, today) ? drafted : plain;
  const story: Story = { text, at: new Date().toISOString(), health: facts.health, why: facts.healthWhy };
  await cachePut(ctx.env, key, { sig: s, story });
  return { story, facts, nba };
}

export { shortDay };
