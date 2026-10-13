// The full communication picture for one partner: every touch in the last 12 months from Blackbaud actions (read from the D1 mirror),
// the steps and thank-yous saved in FavorOS, and the thank-you receipts printed on the Receipts page. Counts the thank-you touches
// in a calendar year against the target leadership set. Read only; nothing here writes to Blackbaud.
import type { Env } from '../http';
import { readOnly } from './repo';
import type { Q } from './partner';
import { addDays } from '../actions/completion';
import { textWord } from './cadence';

/** Leadership's rule: seven thank-you touches a year for a partner. */
export const TARGET = 7;

export type Kind = 'call' | 'text' | 'email' | 'card' | 'meeting' | 'letter' | 'receipt';
export const KIND_LABEL: Record<Kind, string> = { call: 'Call', text: 'Text', email: 'Email', card: 'Card or mailing', meeting: 'Meeting', letter: 'HQ thank-you letter', receipt: 'Thank-you receipt' };

export interface Touch {
  date: string;
  kind: Kind;
  /** The action's own wording, or what the receipt covered. */
  what: string;
  /** Where the record comes from. */
  source: 'Blackbaud' | 'FavorOS' | 'Receipts';
  by: string;
  /** Counts toward the thank-you target. */
  thanks: boolean;
  /** A call that reached voicemail: shown, never counted. */
  left?: boolean;
}

export interface MirrorAction { id?: string; d: string; cat: string; type: string; summary: string; outcome?: string | null; texted?: number; thanked?: number; by?: string }

const plainType = (t: string): string => String(t || '').replace(/^RESERVED \((.*)\)$/, '$1');

/** A Blackbaud action is a thank-you when it is tagged Thanked, is a New Gift Received follow-up or HQTY letter, or its summary says TY or thank. */
export function isThanks(a: Pick<MirrorAction, 'type' | 'summary' | 'thanked'>): boolean {
  if (Number(a.thanked) === 1) return true;
  if (/new gift received|hqty/i.test(String(a.type || ''))) return true;
  return /\b(ty|thank|thanks|thank-you|thankyou)\b/i.test(String(a.summary || '')) || /\bnew gift received\b/i.test(String(a.summary || ''));
}

export function fromAction(a: MirrorAction): Touch | null {
  const cat = String(a.cat || '');
  const d = String(a.d || '').slice(0, 10);
  if (!d) return null;
  const what = String(a.summary || '').trim() || plainType(a.type);
  const left = String(a.outcome || '') === 'Unsuccessful';
  let kind: Kind;
  if (cat === 'Phone call') kind = Number(a.texted) === 1 || textWord(a.summary) ? 'text' : 'call';
  else if (cat === 'Email') kind = 'email';
  else if (cat === 'Mailing') kind = /hqty/i.test(String(a.type || '')) ? 'letter' : 'card';
  else if (cat === 'Meeting') kind = 'meeting';
  else return null;
  return { date: d, kind, what, source: 'Blackbaud', by: a.by || '', thanks: !left && isThanks(a), left: left || undefined };
}

export interface HubStep { date: string; kind: Kind; what: string; by: string; thanks: boolean; left?: boolean }

/** Newest first. A FavorOS step the mirror has already read back (same day, same kind) is dropped so nothing counts twice. */
export function merge(mirror: Touch[], hub: HubStep[], receipts: Touch[], since: string): Touch[] {
  const seen = new Set(mirror.map((t) => `${t.date}|${t.kind}`));
  const out: Touch[] = mirror.filter((t) => t.date >= since);
  for (const h of hub) {
    if (h.date < since || seen.has(`${h.date}|${h.kind}`)) continue;
    out.push({ date: h.date, kind: h.kind, what: h.what, source: 'FavorOS', by: h.by, thanks: h.thanks, left: h.left });
  }
  for (const r of receipts) if (r.date >= since) out.push(r);
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export interface Tally { year: string; count: number; target: number; byKind: { kind: Kind; label: string; n: number }[]; last12: number }

/** Thank-you touches in one calendar year, split by kind. last12 counts the 12 months to today. */
export function tally(touches: Touch[], today: string): Tally {
  const year = today.slice(0, 4);
  const mine = touches.filter((t) => t.thanks && t.date.slice(0, 4) === year && t.date <= today);
  const by = new Map<Kind, number>();
  for (const t of mine) by.set(t.kind, (by.get(t.kind) || 0) + 1);
  const since = addDays(today, -365);
  return {
    year, count: mine.length, target: TARGET,
    byKind: [...by.entries()].map(([kind, n]) => ({ kind, label: KIND_LABEL[kind], n })).sort((a, b) => b.n - a.n),
    last12: touches.filter((t) => t.thanks && t.date >= since && t.date <= today).length,
  };
}

/** Mailings every qualifying partner gets by rule. FavorOS holds no per-partner record of them, so they are listed apart, never counted. */
export const BY_RULE = [
  { label: 'Monthly appeal mailing', note: 'Every partner who gave in the past two years. No per-partner record.' },
];

export const ACTIONS_SQL = readOnly(`SELECT a.id AS id, substr(COALESCE(a.action_completed_date, a.action_date_due), 1, 10) AS d, a.action_category AS cat, a.action_type AS type,
       a.action_summary AS summary, json_extract(a.raw_json, '$.outcome') AS outcome, COALESCE(t.texted, 0) AS texted, COALESCE(t.thanked, 0) AS thanked,
       json_extract(a.raw_json, '$.completed') AS done
  FROM actions a LEFT JOIN action_tags t ON t.id = a.id
 WHERE a.constituent_record_id = ?1 AND a.action_category IN ('Phone call', 'Email', 'Mailing', 'Meeting')
   AND substr(COALESCE(a.action_completed_date, a.action_date_due), 1, 10) >= ?2 ORDER BY 2 DESC LIMIT 400`);
export const GIFT_IDS_SQL = readOnly(`SELECT id AS id FROM gifts WHERE constituent_record_id = ?1 AND substr(gift_date, 1, 10) >= ?2`);

export interface Comm {
  cid: string;
  today: string;
  touches: Touch[];
  tally: Tally;
  byRule: typeof BY_RULE;
  noText: { reason: string; by: string; at: string } | null;
  /** Sources with no per-partner record in FavorOS, so a count can run short. */
  missing: string[];
}

export const MISSING = ['Mailed appeals', 'Emails sent from GoHighLevel and newsletters'];

export async function loadComm(env: Env, q: Q, cid: string, today: string): Promise<Comm> {
  const first = today.slice(0, 4) + '-01-01';
  const since = first < addDays(today, -365) ? first : addDays(today, -365);
  const rows = await q<MirrorAction & { done: number | null }>(ACTIONS_SQL, [cid, since]);
  const mirror = rows.filter((r) => Number(r.done) === 1 || String(r.outcome || '') === 'Unsuccessful').map(fromAction).filter((t): t is Touch => !!t);
  const hub: HubStep[] = [];
  const receipts: Touch[] = [];
  let noText: Comm['noText'] = null;
  if (env.DB) {
    const a = await env.DB.prepare(
      `SELECT d.step, d.outcome, d.line, d.done_at, d.actor FROM act_cadence_done d LEFT JOIN act_batches b ON b.id = d.batch_id
        WHERE d.cid = ? AND d.done_at >= ? AND (b.state IS NULL OR b.state IN ('queued', 'running', 'done'))`
    ).bind(cid, since).all<{ step: string; outcome: string; line: string; done_at: string; actor: string }>().catch(() => ({ results: [] as any[] }));
    for (const r of a.results) hub.push({ date: String(r.done_at).slice(0, 10), kind: r.step as Kind, what: r.line || `${KIND_LABEL[r.step as Kind] || r.step} step`, by: r.actor || '', thanks: false, left: r.outcome === 'left' || undefined });
    const t = await env.DB.prepare(
      `SELECT t.how, t.outcome, t.line, t.created_at, t.actor FROM act_thanks t LEFT JOIN act_batches b ON b.id = t.batch_id
        WHERE t.cid = ? AND t.created_at >= ? AND (b.state IS NULL OR b.state IN ('queued', 'running', 'done'))`
    ).bind(cid, since).all<{ how: string; outcome: string; line: string; created_at: string; actor: string }>().catch(() => ({ results: [] as any[] }));
    for (const r of t.results) {
      const kind: Kind = r.how === 'letter' || r.how === 'card' ? 'card' : r.how === 'visit' ? 'meeting' : (r.how as Kind);
      hub.push({ date: String(r.created_at).slice(0, 10), kind, what: r.line || 'Thank-you', by: r.actor || '', thanks: r.outcome !== 'left', left: r.outcome === 'left' || undefined });
    }
    const gifts = await q<{ id: string }>(GIFT_IDS_SQL, [cid, since]);
    const ids = gifts.map((g) => String(g.id)).slice(0, 90);
    if (ids.length) {
      const marks = ids.map(() => '?').join(',');
      const b = await env.DB.prepare(
        `SELECT b.id, b.letter_date, b.appeal_code, COUNT(*) AS n FROM rcp_batch_gifts g JOIN rcp_batches b ON b.id = g.batch_id
          WHERE g.gift_id IN (${marks}) AND b.kind = 'new' AND b.status <> 'cancelled' GROUP BY b.id`
      ).bind(...ids).all<{ id: string; letter_date: string; appeal_code: string; n: number }>().catch(() => ({ results: [] as any[] }));
      for (const r of b.results) receipts.push({ date: String(r.letter_date).slice(0, 10), kind: 'receipt', what: `Receipt for ${r.n} ${r.n === 1 ? 'gift' : 'gifts'} with reply coupon ${r.appeal_code}`, source: 'Receipts', by: '', thanks: true });
    }
    const f = await env.DB.prepare('SELECT reason, set_by, set_at FROM cad_no_text WHERE cid = ?').bind(cid).first<{ reason: string; set_by: string; set_at: string }>().catch(() => null);
    if (f) noText = { reason: f.reason, by: f.set_by, at: f.set_at };
  }
  const touches = merge(mirror, hub, receipts, since);
  return { cid, today, touches, tally: tally(touches, today), byRule: BY_RULE, noText, missing: MISSING };
}

/** Partners flagged No texts: cid to reason. */
export async function noTextSet(env: Env): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!env.DB) return out;
  const r = await env.DB.prepare('SELECT cid, reason FROM cad_no_text').all<{ cid: string; reason: string }>().catch(() => ({ results: [] as any[] }));
  for (const x of r.results) out.set(String(x.cid), String(x.reason || 'Replied STOP'));
  return out;
}

/** Switch off the text step on rows whose partner replied STOP. The next step moves to the first one still open. */
export function applyNoText<T extends { cid: string; steps: { k: string; state: string; off: string | null }[]; blocked: boolean }>(rows: T[], flags: Map<string, string>): T[] {
  if (!flags.size) return rows;
  return rows.map((r) => {
    const why = flags.get(r.cid);
    if (!why || !r.steps.some((s) => s.k === 'text')) return r;
    let steps = r.steps.map((s) => (s.k === 'text' ? { ...s, off: why, state: 'todo' } : s));
    if (!steps.some((s) => s.state === 'next' && !s.off)) {
      const nx = steps.find((s) => !s.off);
      steps = steps.map((s) => ({ ...s, state: nx && s === nx ? 'next' : 'todo' }));
    }
    return { ...r, steps, blocked: steps.every((s) => !!s.off) };
  });
}
