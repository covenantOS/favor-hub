// Other gifts: the rules that decide when a row is ready and what the Blackbaud gift looks like. Nothing here talks to Blackbaud or the
// database. Gifts from donor advised funds, foundations, wires, stock and phone gifts go in a batch with the soft credit named at
// entry; a second person approves the batch, and approving posts every gift through SKY API (post.ts).

export const KINDS = ['daf', 'foundation', 'wire', 'stock', 'phone'] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABEL: Record<Kind, string> = { daf: 'DAF', foundation: 'Foundation', wire: 'Wire', stock: 'Stock', phone: 'Phone' };
/** Words in the Blackbaud Reference, so a person reading the gift there sees how it came in. */
export const CHANNEL: Record<Kind, string> = { daf: 'DAF', foundation: 'Foundation', wire: 'Wire', stock: 'Stock', phone: 'Phone' };
export const isKind = (k: unknown): k is Kind => typeof k === 'string' && (KINDS as readonly string[]).includes(k);

/** DAF grants, foundation grants and stock come with a notice or letter that belongs on the gift. */
export const NEEDS_LETTER: Kind[] = ['daf', 'foundation', 'stock'];
/** A DAF or a foundation names who recommended the gift, or the entering person says nobody did. */
export const NEEDS_SOFT_DECISION: Kind[] = ['daf', 'foundation'];

export const WHERE_NEEDED_MOST = '79';
export const LETTER_MAX_BYTES = 10 * 1024 * 1024;
export const LETTER_TYPES: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' };

export interface OgGift {
  id: string;
  batch_id: string;
  seq: number;
  status: 'draft' | 'posting' | 'check' | 'posted' | 'failed' | 'removed';
  kind: Kind;
  partner_id: string | null;
  partner_lookup: string | null;
  partner_name: string | null;
  partner_place: string | null;
  fund_named: string | null;
  soft_partner_id: string | null;
  soft_partner_name: string | null;
  no_soft: number;
  amount_cents: number | null;
  gift_date: string | null;
  fund_id: string | null;
  fund_name: string | null;
  appeal_id: string | null;
  appeal_name: string | null;
  ref_text: string | null;
  memo: string | null;
  tribute_kind: string | null;
  tribute_name: string | null;
  tribute_notify: string | null;
  dup_json: string | null;
  letter_key: string | null;
  letter_name: string | null;
  letter_mime: string | null;
  letter_bytes: number | null;
  letter_status: string | null;
  letter_error: string | null;
  bb_file_id: string | null;
  bb_attachment_id: string | null;
  bb_gift_id: string | null;
  attempts: number;
  error: string | null;
  next_try_at: string | null;
  created_by: string;
  created_by_email: string;
  created_at: string;
  updated_at: string;
  posted_at: string | null;
}

export interface OgBatch {
  id: string;
  name: string;
  status: 'open' | 'waiting' | 'posting' | 'posted' | 'needs_person' | 'removed';
  created_by: string;
  created_by_email: string;
  created_at: string;
  submitted_at: string | null;
  submitted_by: string | null;
  approved_by: string | null;
  approved_by_email: string | null;
  approved_at: string | null;
  posted_at: string | null;
  note: string | null;
}

export interface Dup {
  message: string;
  decision: 'keep' | null;
}

export const parseJson = <T,>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

/** What still stops a gift from being sent for approval. Empty means ready. */
export function blockers(g: OgGift): string[] {
  if (g.status === 'removed') return [];
  const out: string[] = [];
  if (!g.partner_id) out.push('Pick who the gift is from.');
  if (!g.amount_cents) out.push('Enter the amount.');
  if (!g.gift_date) out.push('Set the gift date.');
  if (!g.fund_id) out.push('Pick the fund.');
  if (!g.appeal_id) out.push('Pick the appeal.');
  if (g.kind === 'daf' && !(g.fund_named || '').trim()) out.push('Enter the giving fund named on the notice.');
  if (g.kind === 'stock' && !(g.ref_text || '').trim()) out.push('Enter the ticker and the number of shares.');
  if (NEEDS_SOFT_DECISION.includes(g.kind) && !g.soft_partner_id && !g.no_soft) out.push('Name who recommended this gift, or choose No partner named.');
  if (g.tribute_kind && !(g.tribute_name || '').trim()) out.push('Enter who the tribute is for.');
  const dup = parseJson<Dup | null>(g.dup_json, null);
  if (dup && dup.decision === null) out.push('Decide about the possible duplicate.');
  return out;
}

/** The people who entered anything in a batch: the batch's own enterer and every gift's. A second person is nobody on this list. */
export function entererEmails(batch: Pick<OgBatch, 'created_by_email'>, gifts: Pick<OgGift, 'created_by_email' | 'status'>[]): Set<string> {
  const s = new Set<string>([batch.created_by_email.toLowerCase()]);
  for (const g of gifts) if (g.status !== 'removed') s.add(g.created_by_email.toLowerCase());
  return s;
}

export const SECOND_PERSON_LINE = 'A second person approves this batch. The person who entered it cannot.';

/** Read by the page and by the approve route: why this person may not approve this batch, or an empty string. */
export function approveBlock(batch: OgBatch, gifts: OgGift[], me: { email: string; admin: boolean; canPost: boolean }): string {
  if (batch.status !== 'waiting') return batch.status === 'open' ? 'The enterer has not sent this batch for approval yet.' : 'This batch is already approved.';
  if (entererEmails(batch, gifts).has(me.email.toLowerCase())) return SECOND_PERSON_LINE;
  if (!me.admin && !me.canPost) return 'Approving is not switched on for you. Ask an admin.';
  const live = gifts.filter((g) => g.status !== 'removed');
  if (!live.length) return 'The batch has no gifts.';
  const open = live.filter((g) => blockers(g).length > 0).length;
  if (open) return `${open} ${open === 1 ? 'gift needs' : 'gifts need'} a fix before this batch can be approved.`;
  return '';
}

const fmtDay = (iso: string) => {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};
export const batchName = (isoDay: string) => `Other gifts ${fmtDay(isoDay)}`;

const clean = (s: string | null | undefined) => (s || '').replace(/favorintl\.org/gi, '').replace(/\s+/g, ' ').trim();

/**
 * The Reference carries the channel, the batch, who entered and who approved (Blackbaud will show only the connection's name), the
 * giving fund, the outside reference, the memo and the hub id (a retry finds the gift by it). 255 characters at most.
 */
export function referenceFor(g: Pick<OgGift, 'id' | 'kind' | 'fund_named' | 'ref_text' | 'memo'>, batch: string, enteredBy: string, approvedBy: string): string {
  const head = `[Channel: ${CHANNEL[g.kind]}] ${batch}, entered by ${clean(enteredBy)}, approved by ${clean(approvedBy)}`;
  const tail = `, hub ${g.id}`;
  let room = 255 - head.length - tail.length;
  let mid = '';
  for (const [label, v] of [['fund', g.fund_named], ['ref', g.ref_text], ['memo', g.memo]] as const) {
    const t = clean(v);
    if (!t) continue;
    const piece = `, ${label}: ${t}`;
    if (piece.length <= room) {
      mid += piece;
      room -= piece.length;
    } else if (room > 16) {
      mid += piece.slice(0, room);
      room = 0;
    }
  }
  return (head + mid + tail).slice(0, 255);
}

/**
 * The gift sent to POST /gift/v1/gifts. No constituency and no fundraiser credit: the 6 AM gift phase sets both, as it does for every
 * gift today. The soft credit goes in here, for the full amount, which is what the 486 existing soft credits are.
 */
export function giftBody(g: OgGift, ctx: { batchName: string; enteredBy: string; approvedBy: string }): Record<string, unknown> {
  const amount = { value: Math.round(g.amount_cents || 0) / 100 };
  const body: Record<string, unknown> = {
    type: 'Donation',
    constituent_id: g.partner_id,
    amount,
    date: `${g.gift_date}T00:00:00`,
    gift_splits: [{ amount, fund_id: g.fund_id, appeal_id: g.appeal_id }],
    payments: [{ payment_method: 'Other' }],
    reference: referenceFor(g, ctx.batchName, ctx.enteredBy, ctx.approvedBy),
  };
  if (g.soft_partner_id) body.soft_credits = [{ constituent_id: g.soft_partner_id, amount }];
  return body;
}

export const letterFileName = (g: Pick<OgGift, 'id' | 'kind' | 'letter_mime'>) => `${CHANNEL[g.kind].toLowerCase()}-notice-${g.id}.${LETTER_TYPES[g.letter_mime || ''] || 'pdf'}`;

/** The Letter column: what a person sees for a hub-entered gift. */
export function letterState(g: Pick<OgGift, 'kind' | 'letter_key' | 'letter_status'>): 'attached' | 'pending' | 'failed' | 'needed' | 'none' {
  if (g.letter_status === 'done') return 'attached';
  if (g.letter_status === 'failed') return 'failed';
  if (g.letter_key) return 'pending';
  return NEEDS_LETTER.includes(g.kind) ? 'needed' : 'none';
}

const EDITABLE: Record<string, 'text' | 'cents' | 'date' | 'id' | 'bool' | 'kind' | 'tribute'> = {
  kind: 'kind',
  partner_id: 'id',
  partner_lookup: 'text',
  partner_name: 'text',
  partner_place: 'text',
  fund_named: 'text',
  soft_partner_id: 'id',
  soft_partner_name: 'text',
  no_soft: 'bool',
  amount_cents: 'cents',
  gift_date: 'date',
  fund_id: 'id',
  fund_name: 'text',
  appeal_id: 'id',
  appeal_name: 'text',
  ref_text: 'text',
  memo: 'text',
  tribute_kind: 'tribute',
  tribute_name: 'text',
  tribute_notify: 'text',
};

/** The fields a person may change on a row, cleaned. `today` is the Eastern date: a gift is never dated in the future. */
export function cleanEdit(patch: Record<string, unknown>, today: string): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const [k, kindOf] of Object.entries(EDITABLE)) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (v === null || v === '') {
      if (kindOf !== 'kind') out[k] = kindOf === 'bool' ? 0 : null;
      continue;
    }
    if (kindOf === 'cents') {
      const n = Math.round(Number(v));
      if (Number.isFinite(n) && n > 0 && n < 100_000_000_000) out[k] = n;
    } else if (kindOf === 'date') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) && String(v) <= today && String(v) >= '2000-01-01') out[k] = String(v);
    } else if (kindOf === 'id') {
      if (/^\d{1,12}$/.test(String(v))) out[k] = String(v);
    } else if (kindOf === 'bool') {
      out[k] = v ? 1 : 0;
    } else if (kindOf === 'tribute') {
      if (v === 'honor' || v === 'memorial') out[k] = String(v);
    } else if (kindOf === 'kind') {
      if (isKind(v)) out[k] = String(v);
    } else out[k] = String(v).slice(0, 240);
  }
  // No tribute kind means no name and no one to notify.
  if ('tribute_kind' in out ? out.tribute_kind === null : false) {
    out.tribute_name = null;
    out.tribute_notify = null;
  }
  // Naming a recommender and "No partner named" never both stand.
  if (out.soft_partner_id) out.no_soft = 0;
  if (out.no_soft === 1) {
    out.soft_partner_id = null;
    out.soft_partner_name = null;
  }
  return out;
}

export const money = (cents: number | null | undefined) => '$' + ((Number(cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
