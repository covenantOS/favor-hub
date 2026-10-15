// The call-prep brief: one screen before a call or visit. It is the partner page's own view of the partner (loadPartner) with the few
// facts a call needs set in the order Partner Care's script follows (Thank, Pray, Report, Ask, Thank, Pray), each step filled from the
// records. Read from the D1 copy of Blackbaud, plus the partner's notes (one live call, kept ten minutes, shared with the drawer).
import type { Env } from '../http';
import { mirrorQ, loadPartner, type PartnerView, type Q } from './partner';
import { readOnly, FUNDS_SQL } from './repo';
import { partnerGiving } from '../gifts/partner-giving';
import { addMonths, giftDay } from '../../../shared/giving';

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const money = (n: number): string => '$' + (Math.round(n) === n ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const shortDay = (iso: string): string => (iso ? `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}` : '');
const longDay = (iso: string, today: string): string => (iso ? shortDay(iso) + (iso.slice(0, 4) === today.slice(0, 4) ? '' : ', ' + iso.slice(0, 4)) : '');

// The fund split of the gifts credited to the household (the ids come from partnerGiving, so a gift sent through a DAF is included).
const FUND_SPLIT_SQL = readOnly(`SELECT id, gift_splits AS splits FROM gifts WHERE id IN (SELECT value FROM json_each(?1))`);
const ASK_SQL = readOnly(`SELECT substr(COALESCE(a.action_completed_date, a.action_date_due), 1, 10) AS d, t.action_ask_amount AS amt FROM actions a JOIN action_tags t ON t.id = a.id
 WHERE a.constituent_record_id = ?1 AND COALESCE(t.action_ask_amount, 0) > 0 ORDER BY COALESCE(a.action_completed_date, a.action_date_due) DESC LIMIT 1`);

export interface NoteIn {
  date: string;
  summary: string;
  text: string;
  source: string;
}

/** A note or contact that mentions prayer, newest first. The excerpt is the sentence that carries the word. */
const PRAY = /\bpray(?:s|ed|ing|er|ers|erful(?:ly)?)?\b/i;
export function prayerOf(items: NoteIn[]): { date: string; text: string; source: string } | null {
  const sorted = items.filter((n) => n.date).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  for (const n of sorted) {
    const whole = `${n.summary || ''}. ${n.text || ''}`.replace(/\s+/g, ' ').trim();
    if (!PRAY.test(whole)) continue;
    const parts = whole.split(/(?<=[.!?])\s+/).filter(Boolean);
    const hit = parts.find((s) => PRAY.test(s)) || whole;
    return { date: n.date, text: hit.length > 180 ? hit.slice(0, 177).replace(/\s+\S*$/, '') + '...' : hit, source: n.source };
  }
  return null;
}

export interface Owed {
  giftId: string;
  amount: number;
  date: string;
  fund: string;
  ageDays: number;
}

export interface BriefStep {
  n: number;
  title: string;
  /** Plain text before the bold part, the bold part, then the rest. */
  pre?: string;
  strong?: string;
  post?: string;
}

export interface Brief {
  id: string;
  lookup: string;
  name: string;
  kind: string;
  place: string;
  /** The year of the first credited gift. Empty when the household has none. */
  since: string;
  /** The year the record was added, shown as "On record since" when there is no credited gift. */
  onRecord: string;
  household: { id: string; name: string; relation: string }[];
  call: { number: string } | null;
  text: { number: string } | null;
  email: string | null;
  flags: string[];
  /** Each channel's mark and why (shared/commprefs.ts): shown before a call, a mailing or an email. */
  comm: { channels: import('../../../shared/commprefs').Channel[]; banner: import('../../../shared/commprefs').Banner };
  owed: Owed[];
  steps: BriefStep[];
  giving: { lifetime: number; count: number; last12: number; prior12: number; largest: { amount: number; date: string } | null; last: { amount: number; date: string; fund: string; through?: string } | null; passedOn?: number };
  gives: { fund: string; share: number; since: string } | null;
  monthly: { amount: number; status: string; since: string; lastPayment: string }[];
  ask: { amount: number; date: string } | null;
  iwave: { overall: number | null; band: string; source: string } | null;
  contacts: { date: string; category: string; summary: string; text: string; by: string }[];
  open: { id: string; what: string; kind: string; due: string; by: string }[];
  prayer: { date: string; text: string; source: string } | null;
  notesLive: boolean;
  synced: string;
}

/** The call, in the order the script runs. Every line comes from a record; a step with nothing on record says so. */
export function stepsOf(b: Pick<Brief, 'owed' | 'giving' | 'gives' | 'monthly' | 'ask' | 'prayer' | 'since'> & { onRecord?: string }, today: string): BriefStep[] {
  const steps: BriefStep[] = [];
  if (b.owed.length === 1) {
    const g = b.owed[0];
    steps.push({ n: 1, title: 'Thank', strong: money(g.amount), post: ` to ${g.fund} on ${shortDay(g.date)}. Not thanked yet.` });
  } else if (b.owed.length > 1) {
    const total = b.owed.reduce((n, g) => n + g.amount, 0);
    steps.push({ n: 1, title: 'Thank', strong: `${b.owed.length} gifts, ${money(total)}`, post: ` since ${shortDay(b.owed[0].date)}. None thanked yet. The largest is ${money(Math.max(...b.owed.map((g) => g.amount)))} to ${b.owed.slice().sort((a, c) => c.amount - a.amount)[0].fund}.` });
  } else if (b.giving.last) {
    steps.push({ n: 1, title: 'Thank', pre: 'Last gift ', strong: money(b.giving.last.amount), post: ` to ${b.giving.last.fund || 'no fund on file'} on ${giftDay(b.giving.last.date)}${b.giving.last.through ? ' through ' + b.giving.last.through : ''}.` });
  } else if (b.giving.passedOn) steps.push({ n: 1, title: 'Thank', post: 'This record has no gifts of its own. It passes gifts on for other partners. Thank them for their time.' });
  else steps.push({ n: 1, title: 'Thank', post: 'No gifts on record yet. Thank them for their time.' });
  steps.push(
    b.prayer
      ? { n: 2, title: 'Pray', pre: `Their last prayer request (${longDay(b.prayer.date, today)}): `, post: `"${b.prayer.text}"` }
      : { n: 2, title: 'Pray', post: 'No prayer request on record. Ask how you can pray for them.' }
  );
  steps.push(
    b.gives
      ? { n: 3, title: 'Report', pre: 'They give to ', strong: b.gives.fund, post: ` (${Math.round(b.gives.share * 100)}% of their giving${b.gives.since ? ', since ' + b.gives.since.slice(0, 4) : ''}). Share the latest from that work.` }
      : { n: 3, title: 'Report', post: 'No designation on record. Ask what they care about most.' }
  );
  steps.push(b.ask ? { n: 4, title: 'Ask', pre: 'Last ask ', strong: money(b.ask.amount), post: ` on ${longDay(b.ask.date, today)}.` } : { n: 4, title: 'Ask', post: 'No ask on record.' });
  const m = b.monthly.find((x) => /active/i.test(x.status));
  steps.push({ n: 5, title: 'Thank', post: `${b.since ? 'Partner since ' + b.since + '.' : b.onRecord ? 'On record since ' + b.onRecord + '.' : ''}${m ? ` Gives ${money(m.amount)} a month.` : ''}` || 'Thank them for their time.' });
  steps.push({ n: 6, title: 'Pray', post: 'Close in prayer.' });
  return steps;
}

/** Each row's splits are scaled by k, the share of the gift credited to this household (a split soft credit gives less than the whole gift). */
function fundShare(rows: { k: number; splits: string | null; d: string }[], names: Map<string, string>): { fund: string; share: number; since: string } | null {
  const by = new Map<string, { amt: number; since: string }>();
  let total = 0;
  for (const r of rows) {
    let splits: any[] = [];
    try {
      splits = r.splits ? JSON.parse(r.splits) : [];
    } catch {
      splits = [];
    }
    for (const s of splits) {
      const id = String(s?.fund_id ?? '');
      const a = num(s?.amount?.value) * r.k;
      if (!id || !(a > 0)) continue;
      total += a;
      const cur = by.get(id) || { amt: 0, since: r.d };
      cur.amt += a;
      if (r.d < cur.since) cur.since = r.d;
      by.set(id, cur);
    }
  }
  if (!total) return null;
  const top = [...by.entries()].sort((a, b) => b[1].amt - a[1].amt)[0];
  const fund = names.get(top[0]);
  if (!fund) return null;
  return { fund, share: top[1].amt / total, since: top[1].since };
}

export async function briefFor(env: Env, id: string, o: { today: string; owed: Owed[]; notes: NoteIn[] | null; q?: Q; partner?: PartnerView; preview?: boolean }): Promise<Brief | null> {
  const q = o.q || mirrorQ(env);
  const p = o.partner || (await loadPartner(q, id, o.today));
  if (!p) return null;
  // Every number comes from the household's credited gifts (hard and soft), the same as the partner page: fund share, prior 12 months, since.
  const pg = await partnerGiving(q, id, o.today);
  const credited = (pg?.gifts || []).slice(0, 600);
  const [splitRows, askRows] = await Promise.all([
    credited.length ? q<any>(FUND_SPLIT_SQL, [JSON.stringify(credited.map((g) => g.id))]) : Promise.resolve([] as any[]),
    q<any>(ASK_SQL, [id]),
  ]);
  const t12 = addMonths(o.today, -12);
  const t24 = addMonths(o.today, -24);
  const prior12 = credited.filter((g) => g.date > t24 && g.date <= t12).reduce((t, g) => t + g.amount, 0);
  const byId = new Map<string, { k: number; d: string }>(credited.map((g) => [g.id, { k: g.gift > 0 ? g.amount / g.gift : 1, d: g.date }]));
  const ids = new Set<string>();
  for (const r of splitRows) {
    try {
      for (const s of JSON.parse(r.splits || '[]')) if (s?.fund_id != null) ids.add(String(s.fund_id));
    } catch {
      /* a split that does not parse is left out */
    }
  }
  const names = new Map<string, string>();
  if (ids.size) for (const f of await q<{ id: string; name: string }>(FUNDS_SQL, [JSON.stringify([...ids])])) names.set(String(f.id), f.name || '');
  const gives = fundShare(splitRows.map((r: any) => ({ k: byId.get(String(r.id))?.k ?? 1, splits: r.splits, d: byId.get(String(r.id))?.d || '' })), names);
  const phones = p.contact.phones || [];
  const callable = phones.find((x) => !x.doNotCall);
  const mobile = phones.find((x) => !x.doNotCall && /mobile|cell/i.test(x.type));
  const mail = (p.contact.emails || []).find((x) => !x.doNotEmail);
  const blockedWord = (k: string) => (k === 'call' ? 'Do not call' : k === 'email' ? 'Do not email' : k === 'mail' ? 'Do not mail' : 'Do not text');
  const flags = [
    ...new Set(
      [p.deceased ? 'Deceased' : '', p.inactive ? 'Inactive' : '', p.flags.doNotCall ? 'Do not call' : '', p.flags.doNotEmail ? 'Do not email' : '', p.flags.doNotMail ? 'Do not mail' : '']
        .concat(o.preview ? p.comm.banner.blocked.map(blockedWord) : [])
        .concat(o.preview ? p.comm.channels.filter((c) => c.state === 'limited').flatMap((c) => c.reasons.map((r) => r.text)) : [])
        .filter(Boolean)
    ),
  ];
  const contacts = (p.actions.recent || [])
    .filter((a) => ['Email', 'Phone call', 'Meeting', 'Mailing'].includes(a.category) && (a.done || a.due))
    .slice(0, 3)
    .map((a) => ({ date: a.done || a.due, category: a.category, summary: a.summary, text: (a.description || '').replace(/\s+/g, ' ').trim().slice(0, 260), by: (a.fundraisers || []).map((f) => f.name).join(', ') }));
  const pool: NoteIn[] = [];
  for (const a of p.actions.recent || []) pool.push({ date: a.done || a.due, summary: a.summary, text: a.description, source: 'Contact' });
  for (const n of p.notes || []) pool.push({ date: n.date, summary: n.summary, text: n.text, source: 'Note' });
  for (const n of o.notes || []) pool.push({ date: n.date, summary: n.summary, text: n.text, source: 'Note' });
  const prayer = prayerOf(pool);
  // "Partner since" is the first credited gift. A record with no gift says when it was added instead.
  const since = (p.giving.firstDate || '').slice(0, 4);
  const onRecord = since ? '' : (p.addedOn || '').slice(0, 4);
  const base = {
    owed: o.owed,
    giving: {
      lifetime: p.giving.total,
      count: p.giving.count,
      last12: p.giving.last12,
      prior12: Math.round(prior12 * 100) / 100,
      largest: p.giving.largest ? { amount: p.giving.largest.amount, date: p.giving.largest.date } : null,
      last: p.giving.last ? { amount: p.giving.last.credited ?? p.giving.last.amount, date: p.giving.last.date, fund: p.giving.last.fund, through: p.giving.last.through || '' } : null,
      passedOn: p.giving.passedOn.count,
    },
    gives,
    monthly: (p.recurring || []).map((r) => ({ amount: r.amount, status: r.status, since: r.since, lastPayment: r.lastPayment })),
    ask: askRows[0] && num(askRows[0].amt) > 0 ? { amount: num(askRows[0].amt), date: String(askRows[0].d || '') } : null,
    prayer,
    since,
    onRecord,
  };
  return {
    id: p.id,
    lookup: p.lookup,
    name: p.name,
    kind: p.kind,
    place: p.place,
    household: p.household || [],
    call: callable ? { number: callable.number } : null,
    text: mobile ? { number: mobile.number } : null,
    email: mail ? mail.address : null,
    flags,
    comm: o.preview ? { channels: p.comm.channels, banner: p.comm.banner } : { channels: [], banner: { show: false, lines: [], blocked: [] } },
    ...base,
    steps: stepsOf(base, o.today),
    iwave: p.iwave ? { overall: p.iwave.overall, band: p.iwave.capacityBand, source: p.iwave.source } : null,
    contacts,
    open: (p.actions.open || []).slice(0, 5).map((a) => ({ id: a.id, what: a.summary || a.type, kind: a.category, due: a.due, by: (a.fundraisers || []).map((f) => f.name).join(', ') })),
    notesLive: o.notes !== null,
    synced: p.synced,
  };
}
