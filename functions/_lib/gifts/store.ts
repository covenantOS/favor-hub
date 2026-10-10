// Gift entry's own tables (db/gift-entry.sql) and the rules that decide when a row is ready, which rows copy their photo to
// Blackbaud, and what the Blackbaud gift looks like. Nothing here talks to Blackbaud.
import { newId, nowIso, type Env } from '../http';

export const WHERE_NEEDED_MOST = '79';
export const CHECK_STATUSES_COUNTED = ['reading', 'review', 'ready', 'sent', 'failed', 'by_hand'];

export interface DepositRow {
  id: string;
  kind: 'regular' | 'acquisition' | 'grant';
  name: string;
  deposit_date: string;
  tape_cents: number;
  tape_count: number;
  status: string;
  created_by: string;
  created_by_email: string;
  created_at: string;
  sent_by: string | null;
  sent_at: string | null;
  bb_batch_id: string | null;
  bb_batch_number: string | null;
  committed_at: string | null;
  committed_by: string | null;
  last_polled_at: string | null;
  note: string | null;
}

export interface GiftRow {
  id: string;
  deposit_id: string;
  seq: number;
  status: string;
  kind: 'check' | 'cash';
  partner_id: string | null;
  partner_lookup: string | null;
  partner_name: string | null;
  partner_place: string | null;
  amount_cents: number | null;
  gift_date: string | null;
  check_number: string | null;
  check_date: string | null;
  payer: string | null;
  memo: string | null;
  fund_id: string | null;
  fund_name: string | null;
  appeal_id: string | null;
  appeal_name: string | null;
  soft_partner_id: string | null;
  soft_partner_name: string | null;
  rule: string | null;
  prayer: number;
  fields_json: string | null;
  candidates_json: string | null;
  dup_json: string | null;
  dedupe_key: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  bb_batch_gift_id: string | null;
  bb_gift_id: string | null;
  error: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ImageRow {
  id: string;
  gift_id: string;
  deposit_id: string;
  kind: string;
  r2_key: string;
  sha256: string;
  bytes: number;
  mime: string;
  uploaded_by: string;
  uploaded_at: string;
  copy_to_bb: number;
  bb_file_id: string | null;
  bb_attachment_id: string | null;
  attached_at: string | null;
  attach_error: string | null;
}

export const KIND_LABEL: Record<string, string> = { regular: 'Regular Mail', acquisition: 'Acquisition Mail', grant: 'Grant Mail' };

export const depositName = (kind: string, date: string) => `${KIND_LABEL[kind] || 'Mail'} ${date}`;

export async function logEvent(env: Env, e: { deposit_id?: string | null; gift_id?: string | null; kind: string; actor: string; detail?: unknown }): Promise<void> {
  const detail = e.detail == null ? null : typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail);
  await env.DB.prepare('INSERT INTO ge_event (at, deposit_id, gift_id, kind, actor, detail) VALUES (?,?,?,?,?,?)')
    .bind(nowIso(), e.deposit_id ?? null, e.gift_id ?? null, e.kind, e.actor, detail ? detail.slice(0, 1500) : null)
    .run();
}

export async function createDeposit(env: Env, who: { name: string; email: string }, input: { kind: string; date: string; tapeCents: number; tapeCount: number }): Promise<DepositRow> {
  const id = newId('gd');
  const row = {
    id,
    kind: input.kind,
    name: depositName(input.kind, input.date),
    deposit_date: input.date,
    tape_cents: input.tapeCents,
    tape_count: input.tapeCount,
    created_by: who.name,
    created_by_email: who.email,
    created_at: nowIso(),
  };
  await env.DB.prepare(
    'INSERT INTO ge_deposit (id, kind, name, deposit_date, tape_cents, tape_count, status, created_by, created_by_email, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
  )
    .bind(row.id, row.kind, row.name, row.deposit_date, row.tape_cents, row.tape_count, 'open', row.created_by, row.created_by_email, row.created_at)
    .run();
  await logEvent(env, { deposit_id: id, kind: 'deposit_created', actor: who.name, detail: { tape_cents: row.tape_cents, tape_count: row.tape_count } });
  return (await getDeposit(env, id))!;
}

export const getDeposit = (env: Env, id: string) => env.DB.prepare('SELECT * FROM ge_deposit WHERE id = ? LIMIT 1').bind(id).first<DepositRow>();

export async function listDeposits(env: Env, limit = 30): Promise<(DepositRow & { gifts: number; cents: number })[]> {
  const r = await env.DB.prepare(
    `SELECT d.*, (SELECT COUNT(*) FROM ge_gift g WHERE g.deposit_id = d.id AND g.status <> 'removed') AS gifts,
            (SELECT COALESCE(SUM(g.amount_cents), 0) FROM ge_gift g WHERE g.deposit_id = d.id AND g.status <> 'removed') AS cents
       FROM ge_deposit d WHERE d.status <> 'removed' ORDER BY d.created_at DESC LIMIT ?`
  )
    .bind(limit)
    .all<DepositRow & { gifts: number; cents: number }>();
  return r.results;
}

export async function giftsOf(env: Env, depositId: string): Promise<GiftRow[]> {
  const r = await env.DB.prepare("SELECT * FROM ge_gift WHERE deposit_id = ? AND status <> 'removed' ORDER BY seq").bind(depositId).all<GiftRow>();
  return r.results;
}

export const getGift = (env: Env, id: string) => env.DB.prepare('SELECT * FROM ge_gift WHERE id = ? LIMIT 1').bind(id).first<GiftRow>();

export async function imagesOf(env: Env, depositId: string): Promise<ImageRow[]> {
  const r = await env.DB.prepare('SELECT * FROM ge_image WHERE deposit_id = ? ORDER BY uploaded_at').bind(depositId).all<ImageRow>();
  return r.results;
}

/** Fields a person may change on a row. Everything else is set by the system. */
export const EDITABLE: Record<string, 'text' | 'cents' | 'date' | 'id' | 'bool' | 'kind'> = {
  partner_id: 'id',
  partner_lookup: 'text',
  partner_name: 'text',
  partner_place: 'text',
  amount_cents: 'cents',
  gift_date: 'date',
  check_number: 'text',
  check_date: 'date',
  payer: 'text',
  memo: 'text',
  fund_id: 'id',
  fund_name: 'text',
  appeal_id: 'id',
  appeal_name: 'text',
  soft_partner_id: 'id',
  soft_partner_name: 'text',
  prayer: 'bool',
  kind: 'kind',
};

export function cleanEdit(patch: Record<string, unknown>): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const [k, kindOf] of Object.entries(EDITABLE)) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (v === null || v === '') {
      out[k] = null;
      continue;
    }
    if (kindOf === 'cents') {
      const n = Math.round(Number(v));
      if (Number.isFinite(n) && n > 0 && n < 1_000_000_000) out[k] = n;
    } else if (kindOf === 'date') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) out[k] = String(v);
    } else if (kindOf === 'id') {
      if (/^\d{1,12}$/.test(String(v))) out[k] = String(v);
    } else if (kindOf === 'bool') {
      out[k] = v ? 1 : 0;
    } else if (kindOf === 'kind') {
      if (v === 'check' || v === 'cash') out[k] = String(v);
    } else out[k] = String(v).slice(0, 240);
  }
  return out;
}

export async function updateGift(env: Env, id: string, set: Record<string, string | number | null>): Promise<void> {
  const keys = Object.keys(set);
  if (!keys.length) return;
  const cols = keys.map((k) => `${k} = ?`).join(', ');
  await env.DB.prepare(`UPDATE ge_gift SET ${cols}, updated_at = ? WHERE id = ?`).bind(...keys.map((k) => set[k]), nowIso(), id).run();
}

// ---------------------------------------------------------------- rules

export interface Dup {
  kind: 'hub' | 'photo' | 'blackbaud';
  message: string;
  decision: 'keep' | 'remove' | null;
}

export const parseJson = <T,>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

export const GIVING_FUND_NAME = /(giving fund|foundation|charitable|community fund|donor.?advised|\bdaf\b|fidelity|schwab)/i;

/** Why a gift's photo copies to Blackbaud: designated fund, $5,000 or more, a giving fund or foundation. Empty when it does not. */
export function ruleFor(g: Pick<GiftRow, 'fund_id' | 'amount_cents' | 'partner_name' | 'payer'>): string {
  if (g.fund_id && g.fund_id !== WHERE_NEEDED_MOST) return 'designated';
  if ((g.amount_cents || 0) >= 500000) return 'big';
  if (GIVING_FUND_NAME.test(g.partner_name || '') || GIVING_FUND_NAME.test(g.payer || '')) return 'giving_fund';
  return '';
}

export const RULE_LABEL: Record<string, string> = {
  designated: 'Designated fund',
  big: '$5,000 or more',
  giving_fund: 'Giving fund or foundation',
};

const PRAYER_WORDS = /(pray|prayer|healing|surgery|cancer|hospital|passed away|grieving|struggl)/i;
export const prayerIn = (memo: string | null | undefined) => PRAYER_WORDS.test(memo || '');

/** What still stops a row from going to Blackbaud. Empty means ready. */
export function blockers(g: GiftRow): string[] {
  if (g.status === 'removed') return [];
  const out: string[] = [];
  if (g.status === 'reading') out.push('Still being read.');
  if (g.status === 'by_hand') return out;
  if (!g.partner_id) out.push('Pick the partner.');
  if (!g.amount_cents) out.push('Enter the amount.');
  if (!g.gift_date) out.push('Set the gift date.');
  if (g.kind === 'check' && !g.check_number) out.push('Enter the check number.');
  if (!g.fund_id) out.push('Pick the fund.');
  if (!g.appeal_id) out.push('Pick the appeal.');
  if (g.rule === 'giving_fund' && !g.soft_partner_id && !g.soft_partner_name) out.push('Name who recommended this gift, or choose No partner named.');
  const dup = parseJson<Dup | null>(g.dup_json, null);
  if (dup && dup.decision === null) out.push('Decide about the possible duplicate.');
  const f = parseJson<{ card?: boolean }>(g.fields_json, {});
  if (f.card) out.push('A card number showed in the photo. Use Phone gift.');
  if (!g.confirmed_by) out.push('Look it over and press Looks right.');
  return out;
}

export interface Tape {
  tapeCents: number;
  tapeCount: number;
  cents: number;
  count: number;
  diffCents: number;
  diffCount: number;
  needLook: number;
  matches: boolean;
}

export function tapeOf(d: Pick<DepositRow, 'tape_cents' | 'tape_count'>, gifts: GiftRow[]): Tape {
  const live = gifts.filter((g) => g.status !== 'removed');
  const cents = live.reduce((s, g) => s + (g.amount_cents || 0), 0);
  const needLook = live.filter((g) => blockers(g).length > 0).length;
  const diffCents = cents - d.tape_cents;
  const diffCount = live.length - d.tape_count;
  return { tapeCents: d.tape_cents, tapeCount: d.tape_count, cents, count: live.length, diffCents, diffCount, needLook, matches: diffCents === 0 && diffCount === 0 };
}

// ---------------------------------------------------------------- the Blackbaud gift

export const CHANNEL_LABEL = { check: 'Mail check', cash: 'Mail cash' } as const;

/** The Reference carries the channel, the deposit, the check number and the hub id (a retry finds the gift by it). 255 characters at most. */
export function referenceFor(g: Pick<GiftRow, 'id' | 'kind' | 'check_number' | 'memo'>, depositName: string): string {
  const head = `[Channel: ${CHANNEL_LABEL[g.kind]}] ${depositName}`;
  const num = g.kind === 'check' && g.check_number ? `, check ${g.check_number}` : '';
  const tail = `, hub ${g.id}`;
  let memo = (g.memo || '').replace(/favorintl\.org/gi, '').replace(/\s+/g, ' ').trim();
  const room = 255 - (head.length + num.length + tail.length) - 8;
  memo = memo && room > 12 ? `, memo: ${memo.slice(0, room)}` : '';
  return (head + num + tail + memo).slice(0, 255);
}

const ymd = (s: string) => ({ y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)), d: Number(s.slice(8, 10)) });

/** One batch gift. No constituency and no fundraiser credit: the 6 AM gift phase sets both, as it does for every gift today. */
export function giftBody(g: GiftRow, deposit: Pick<DepositRow, 'name' | 'deposit_date'>): Record<string, unknown> {
  const amount = { value: Math.round(g.amount_cents || 0) / 100 };
  const payment: Record<string, unknown> = { payment_method: g.kind === 'cash' ? 'Cash' : 'PersonalCheck' };
  if (g.kind === 'check') {
    if (g.check_number) payment.check_number = g.check_number;
    if (g.check_date) payment.check_date = ymd(g.check_date);
  }
  const body: Record<string, unknown> = {
    type: 'Donation',
    constituent_id: g.partner_id,
    amount,
    date: `${g.gift_date || deposit.deposit_date}T00:00:00`,
    gift_splits: [{ amount, fund_id: g.fund_id, appeal_id: g.appeal_id }],
    payments: [payment],
    reference: referenceFor(g, deposit.name),
  };
  if (g.soft_partner_id) body.soft_credits = [{ constituent_id: g.soft_partner_id, amount }];
  return body;
}

export async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const d = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function dedupeKeyOf(g: Pick<GiftRow, 'partner_id' | 'amount_cents' | 'check_number' | 'check_date' | 'kind'>): Promise<string | null> {
  if (g.kind !== 'check' || !g.partner_id || !g.amount_cents || !g.check_number) return null;
  return sha256Hex(`${g.partner_id}|${g.amount_cents}|${g.check_number}|${g.check_date || ''}`);
}
