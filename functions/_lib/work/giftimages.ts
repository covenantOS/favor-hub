// Gift images (Work Center tab "Gift images"): the gifts whose check or letter image belongs in Blackbaud, and the ones that still lack
// one. The Admin Desk attaches an image to every gift from a donor advised fund or giving fund and every gift of $5,000 or more; gifts
// entered through Gift entry get theirs after the batch is committed, and this tab covers the rest (gifts keyed by hand, wires, DAF
// grants, gifts from before Gift entry). The mirror holds no attachments, so a gift is "not checked" until the tab asks Blackbaud
// (one call, on the gift entry lane) or the hub attaches the image itself. Read only here: no Blackbaud calls.
//
// Mirror rules that shape the SQL: the endpoint refuses any statement whose text contains insert, update, replace, upsert, delete,
// drop, alter or create anywhere (readOnly checks it).
import { readOnly, FUNDS_SQL } from './repo';
import type { Q } from './partner';
import { addDays } from '../actions/completion';
import { GIVING_FUND_NAME, WHERE_NEEDED_MOST } from '../gifts/store';

/** How far back the tab looks. Older gifts were handled before this tab existed. */
export const IMAGE_DAYS = 45;
export const BIG = 5000;

export type Why = 'big' | 'giving_fund' | 'designated';
export const WHY_LABEL: Record<Why, string> = { big: '$5,000 or more', giving_fund: 'Giving fund or foundation', designated: 'Designated fund' };
/** Online payment methods never have a paper image. */
const ONLINE = "('CreditCard', 'DirectDebit', 'PayPal', 'Venmo', 'ApplePay', 'GooglePay')";

export const GIFTS_SQL = readOnly(`SELECT g.id AS id, g.constituent_record_id AS cid, g.gift_amount AS amount, substr(g.gift_date, 1, 10) AS d, g.gift_type AS type,
       g.gift_payment_method AS pm, g.gift_splits AS splits, json_extract(g.raw_json, '$.batch_number') AS batch,
       COALESCE(json_extract(c.raw_json, '$.name'), trim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))) AS name
  FROM gifts g LEFT JOIN constituents c ON c.id = g.constituent_record_id
 WHERE g.gift_date >= ?1 AND g.gift_amount > 0 AND COALESCE(g.gift_status, 'Active') = 'Active'
   AND g.gift_type IN ('Donation', 'Other', 'Stock/Property', 'GiftInKind') AND COALESCE(g.gift_payment_method, '') NOT IN ${ONLINE}
 ORDER BY g.gift_date DESC, g.id DESC LIMIT 900`);

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const text = (v: unknown): string => (v == null ? '' : String(v));
function parse<T>(v: unknown, fallback: T): T {
  if (v == null || v === '') return fallback;
  if (typeof v !== 'string') return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

/** Why this gift's image belongs in Blackbaud, or '' when it does not. A $5,000 gift and a giving fund come before a designated fund. */
export function whyOf(g: { amount: number; name: string; funds: string[] }): Why | '' {
  if (g.amount >= BIG) return 'big';
  if (GIVING_FUND_NAME.test(g.name || '')) return 'giving_fund';
  if (g.funds.some((f) => f && f !== WHERE_NEEDED_MOST)) return 'designated';
  return '';
}

/** What the hub knows about a gift's attachments. */
export interface Known { state: 'has' | 'none'; files: number; file: string | null; checked_at: string }

export interface ImageRow {
  giftId: string;
  cid: string;
  name: string;
  amount: number;
  date: string;
  method: string;
  batch: string;
  fund: string;
  why: Why;
  whyLabel: string;
  /** unknown: not asked yet. none: Blackbaud has no attachment. */
  state: 'unknown' | 'none';
  checkedAt: string | null;
  age: number;
}

interface RawGift { id: string; cid: string; amount: number; d: string; type: string; pm: string; splits: string | null; batch: string | null; name: string }

const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);

/** The rows still needing an image, newest first. Gifts the hub knows have an attachment are left out. */
export function shape(raw: RawGift[], o: { today: string; fundNames: Map<string, string>; known: Map<string, Known> }): ImageRow[] {
  const rows: ImageRow[] = [];
  for (const g of raw) {
    const splits = parse<{ fund_id?: string }[]>(g.splits, []);
    const funds = [...new Set(splits.map((s) => text(s.fund_id)).filter(Boolean))];
    const why = whyOf({ amount: num(g.amount), name: text(g.name), funds });
    if (!why) continue;
    const k = o.known.get(String(g.id));
    if (k && k.state === 'has') continue;
    rows.push({
      giftId: String(g.id), cid: String(g.cid), name: text(g.name) || `Record ${g.cid}`, amount: num(g.amount), date: g.d, method: text(g.pm), batch: text(g.batch),
      fund: funds.map((f) => o.fundNames.get(f) || '').filter(Boolean).join(', '), why, whyLabel: WHY_LABEL[why],
      state: k ? 'none' : 'unknown', checkedAt: k ? k.checked_at : null, age: Math.max(0, daysBetween(g.d, o.today)),
    });
  }
  return rows;
}

export async function loadImageRows(q: Q, o: { today: string; known: Map<string, Known> }): Promise<ImageRow[]> {
  const raw = await q<RawGift>(GIFTS_SQL, [addDays(o.today, -IMAGE_DAYS)]);
  const fundIds = [...new Set(raw.flatMap((g) => parse<{ fund_id?: string }[]>(g.splits, []).map((s) => text(s.fund_id)).filter(Boolean)))];
  const fundNames = new Map<string, string>();
  for (let i = 0; i < fundIds.length; i += 400) {
    for (const f of await q<{ id: string; name: string }>(FUNDS_SQL, [JSON.stringify(fundIds.slice(i, i + 400))])) fundNames.set(String(f.id), text(f.name));
  }
  return shape(raw, { today: o.today, fundNames, known: o.known });
}
