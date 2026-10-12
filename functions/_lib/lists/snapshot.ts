// Builds the lr_* snapshot in the hub database from the Blackbaud mirror. The mirror read goes through the sync worker and takes
// seconds; the Lists page then counts against these tables in milliseconds. A table is emptied and refilled inside one batch, so a
// reader never sees half a copy.
import { giftRowsSnapshotSql, householdsSnapshotSql } from './layer.ts';

type Row = Record<string, any>;
export interface Stmt {
  sql: string;
  params: unknown[];
}
export interface SnapshotIO {
  /** Read-only SQL against the Blackbaud mirror. */
  read(sql: string, params?: unknown[]): Promise<Row[]>;
  /** Run statements in order as one transaction in the hub database. */
  write(stmts: Stmt[]): Promise<void>;
  /** Read from the hub database. */
  hub(sql: string, params?: unknown[]): Promise<Row[]>;
}

const CHUNK_BYTES = 350_000;

/** INSERT ... SELECT from one bound JSON array, chunked under D1's size limits. */
export function bulkInsert(table: string, cols: string[], rows: unknown[][]): Stmt[] {
  const out: Stmt[] = [];
  const sel = cols.map((_, i) => `json_extract(value, '$[${i}]')`).join(', ');
  const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) SELECT ${sel} FROM json_each(?1)`;
  let cur: unknown[][] = [];
  let size = 2;
  for (const r of rows) {
    const text = JSON.stringify(r);
    if (cur.length && size + text.length > CHUNK_BYTES) {
      out.push({ sql, params: [JSON.stringify(cur)] });
      cur = [];
      size = 2;
    }
    cur.push(r);
    size += text.length + 1;
  }
  if (cur.length) out.push({ sql, params: [JSON.stringify(cur)] });
  return out;
}

const text = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const day = (v: unknown): string | null => (v ? String(v).slice(0, 10) : null);
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function parse<T>(s: unknown, fallback: T): T {
  if (typeof s !== 'string' || !s.trim()) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** '|a|b|' so a menu pick is a LIKE '%|a|%'. */
const pipe = (xs: string[]): string => (xs.length ? `|${[...new Set(xs)].join('|')}|` : '');

export interface SnapshotResult {
  asOf: string;
  households: number;
  gifts: number;
  tags: number;
  holders: number;
  ms: number;
}

export async function buildSnapshot(io: SnapshotIO, asOf: string): Promise<SnapshotResult> {
  const started = Date.now();
  const hhq = householdsSnapshotSql(asOf);
  const gq = giftRowsSnapshotSql(asOf);

  const [households, giftRows, funds, appeals, fundraisers, holders, solicit, codes, attrs, rels, events, contacts, members, noAddr] = await Promise.all([
    io.read(hhq.sql, hhq.params),
    io.read(gq.sql, gq.params),
    io.read(`SELECT id, fund_id AS code, fund_description AS name, fund_category AS category, COALESCE(fund_inactive, 0) AS inactive FROM funds`),
    io.read(`SELECT id, appeal_id AS code, appeal_description AS name, appeal_category AS category, substr(appeal_start_date, 1, 10) AS start FROM appeals`),
    io.read(`SELECT id, trim(COALESCE(fundraiser_first_name, '') || ' ' || COALESCE(fundraiser_last_name, '')) AS name, fundraiser_type AS ftype, COALESCE(fundraiser_active, 0) AS active FROM fundraisers`),
    io.read(
      `SELECT x.constituent_record_id AS cid, x.assignment_fundraiser_id AS fid, x.assignment_type AS atype FROM assignments x
        WHERE x.assignment_fundraiser_id IS NOT NULL AND x.assignment_type IS NOT NULL AND (x.assignment_to_date IS NULL OR DATE(x.assignment_to_date) >= ?1)`,
      [asOf]
    ),
    io.read(`SELECT constituent_record_id AS cid, solicit_code AS v FROM solicit_codes WHERE solicit_code IS NOT NULL AND COALESCE(NULLIF(solicit_end, ''), '9999-12-31') >= ?1`, [asOf]),
    io.read(`SELECT constituent_record_id AS cid, code_description AS v FROM constituent_codes WHERE code_description IS NOT NULL AND COALESCE(is_inactive, 0) = 0`),
    io.read(`SELECT constituent_record_id AS cid, category AS v FROM custom_fields WHERE category IS NOT NULL`),
    io.read(
      `SELECT constituent_id AS cid, COALESCE(NULLIF(type, ''), NULLIF(position, '')) AS v FROM constituent_relationships
        WHERE COALESCE(NULLIF(type, ''), NULLIF(position, '')) IS NOT NULL AND COALESCE(NULLIF(end_date, ''), '9999-12-31') >= ?1`,
      [asOf]
    ),
    io.read(`SELECT ep.constituent_record_id AS cid, ev.name AS v FROM event_participants ep JOIN events ev ON ev.id = ep.event_id WHERE ev.name IS NOT NULL`),
    io.read(
      `SELECT constituent_record_id AS cid, MAX(DATE(COALESCE(action_completed_date, action_date_due))) AS d FROM actions
        WHERE json_extract(raw_json, '$.completed') = 1 AND action_category IN ('Phone call', 'Email', 'Meeting') GROUP BY constituent_record_id`
    ),
    io.read(`SELECT id AS cid, spouse_id AS sid FROM constituents WHERE spouse_id IS NOT NULL`),
    io.read(`SELECT id AS cid FROM constituents WHERE COALESCE(no_valid_address, 0) = 1`),
  ]);

  // Every record id to its household. A spouse that never gave maps through the household's other member.
  const hidOf = new Map<string, string>();
  for (const h of households) {
    hidOf.set(String(h.household_id), String(h.household_id));
    hidOf.set(String(h.record_id), String(h.household_id));
    if (h.spouse_record_id) hidOf.set(String(h.spouse_record_id), String(h.household_id));
  }
  for (const m of members) {
    const a = hidOf.get(String(m.cid));
    const b = hidOf.get(String(m.sid));
    if (a && !b) hidOf.set(String(m.sid), a);
    if (b && !a) hidOf.set(String(m.cid), b);
  }
  const hh = (cid: unknown) => hidOf.get(String(cid));

  const lastContact = new Map<string, string>();
  for (const c of contacts) {
    const h = hh(c.cid);
    const d = day(c.d);
    if (h && d && (!lastContact.get(h) || d > lastContact.get(h)!)) lastContact.set(h, d);
  }

  const fundBy = new Map(funds.map((f) => [String(f.id), f]));
  const appealBy = new Map(appeals.map((a) => [String(a.id), a]));
  const frName = new Map(fundraisers.map((f) => [String(f.id), String(f.name)]));

  const noAddrHh = new Set(noAddr.map((r) => hh(r.cid)).filter(Boolean) as string[]);
  const hhRows = households.map((h) => {
    const ids = [...new Set([String(h.record_id), ...(h.spouse_record_id ? [String(h.spouse_record_id)] : [])])];
    return [
      String(h.household_id), String(h.record_id), text(h.spouse_record_id), text(h.lookup_id), text(h.name), text(h.constituent_type), text(h.city), text(h.state), text(h.zip), text(h.country),
      num(h.alive), day(h.first_gift), day(h.last_gift), num(h.last_gift_amount), num(h.largest_gift), num(h.lifetime), num(h.gifts), num(h.major), day(h.last_gift_ly),
      text(h.first_appeal_code), text(h.first_appeal_category), text(h.last_appeal_code), text(h.last_appeal_category), lastContact.get(String(h.household_id)) ?? null, JSON.stringify(ids), noAddrHh.has(String(h.household_id)) ? 1 : 0,
    ];
  });

  const known = new Set(households.map((h) => String(h.household_id)));
  const holderSet = new Set<string>();
  const holderRows: unknown[][] = [];
  for (const x of holders) {
    const h = hh(x.cid);
    if (!h || !known.has(h)) continue;
    const key = `${h}|${x.fid}|${x.atype}`;
    if (holderSet.has(key)) continue;
    holderSet.add(key);
    holderRows.push([h, String(x.fid), String(x.atype)]);
  }

  const tagSet = new Set<string>();
  const tagRows: unknown[][] = [];
  const addTags = (kind: string, rows: Row[]) => {
    for (const r of rows) {
      const h = hh(r.cid);
      if (!h || !known.has(h) || !r.v) continue;
      const key = `${h}|${kind}|${r.v}`;
      if (tagSet.has(key)) continue;
      tagSet.add(key);
      tagRows.push([h, kind, String(r.v)]);
    }
  };
  addTags('solicit', solicit);
  addTags('code', codes);
  addTags('attr', attrs);
  addTags('rel', rels);
  addTags('event', events);

  const giftOut = giftRows.map((g) => {
    const splits = parse<Row[]>(g.splits, []);
    const fundIds = splits.map((s) => String(s.fund_id ?? '')).filter(Boolean);
    const appealIds = splits.map((s) => String(s.appeal_id ?? '')).filter(Boolean);
    const creds = parse<Row[]>(g.credits, []).map((c) => String(c.constituent_id ?? '')).filter(Boolean);
    const soft = parse<Row[]>(g.soft, []).some((s) => s && s.constituent_id) ? 1 : 0;
    return [
      String(g.gift_id), String(g.household_id), String(g.gift_date), Math.round(num(g.credited) * 100) / 100, num(g.amount), String(g.gift_type) === 'RecurringGiftPayment' ? 'recurring' : 'one_time', text(g.method),
      pipe(fundIds),
      [...new Set(fundIds.map((i) => String(fundBy.get(i)?.name ?? i)))].join('; '),
      pipe(fundIds.map((i) => String(fundBy.get(i)?.category ?? '')).filter(Boolean)),
      pipe(appealIds),
      [...new Set(appealIds.map((i) => String(appealBy.get(i)?.code ?? i)))].join('; '),
      pipe(appealIds.map((i) => String(appealBy.get(i)?.category ?? '')).filter(Boolean)),
      pipe(creds),
      [...new Set(creds.map((i) => frName.get(i) ?? i))].join('; '),
      soft, text(g.giver),
    ];
  });

  const seen = new Set<string>();
  const crRows: unknown[][] = [];
  const g1Rows: unknown[][] = [];
  for (let i = 0; i < giftRows.length; i++) {
    const g = giftRows[i];
    const id = String(g.gift_id);
    if (seen.has(id)) continue;
    seen.add(id);
    const o = giftOut[i];
    const kind = o[5];
    for (const c of parse<Row[]>(g.credits, [])) {
      if (!c || !c.constituent_id) continue;
      crRows.push([id, String(c.constituent_id), num(c.amount?.value), num(g.amount), String(g.gift_date), kind]);
    }
    g1Rows.push([id, String(g.gift_date), num(g.amount), kind, o[7], o[8], o[10], o[11], o[12]]);
  }

  const stmts = (table: string, cols: string[], rows: unknown[][]): Stmt[] => [{ sql: `DELETE FROM ${table}`, params: [] }, ...bulkInsert(table, cols, rows)];
  // One transaction per table, so a failed read above never empties a table, and a reader sees an old or a new copy.
  await io.write(
    stmts('lr_hh', ['household_id', 'record_id', 'spouse_record_id', 'lookup_id', 'name', 'ctype', 'city', 'state', 'zip', 'country', 'alive', 'first_gift', 'last_gift', 'last_amt', 'largest', 'lifetime', 'gifts', 'major', 'last_gift_ly', 'first_code', 'first_cat', 'last_code', 'last_cat', 'last_contact', 'members', 'no_addr'], hhRows)
  );
  await io.write(stmts('lr_holder', ['household_id', 'fundraiser_id', 'atype'], holderRows));
  await io.write(stmts('lr_tag', ['household_id', 'kind', 'value'], tagRows));
  await io.write(
    stmts('lr_gift', ['gift_id', 'household_id', 'gift_date', 'credited', 'amount', 'kind', 'method', 'funds', 'fund_names', 'fund_cats', 'appeals', 'appeal_codes', 'appeal_cats', 'creds', 'cred_names', 'soft', 'giver'], giftOut)
  );
  await io.write(stmts('lr_cr', ['gift_id', 'fundraiser_id', 'amount', 'gift_amount', 'gift_date', 'kind'], crRows));
  await io.write(stmts('lr_g1', ['gift_id', 'gift_date', 'amount', 'kind', 'funds', 'fund_names', 'appeals', 'appeal_codes', 'appeal_cats'], g1Rows));
  await io.write(stmts('lr_fund', ['id', 'code', 'name', 'category', 'inactive'], funds.map((f) => [String(f.id), text(f.code), text(f.name), text(f.category), num(f.inactive)])));
  await io.write(stmts('lr_appeal', ['id', 'code', 'name', 'category', 'start'], appeals.map((a) => [String(a.id), text(a.code), text(a.name), text(a.category), text(a.start)])));
  await io.write(stmts('lr_fr', ['id', 'name', 'ftype', 'active'], fundraisers.map((f) => [String(f.id), text(f.name), text(f.ftype), num(f.active)])));

  const ms = Date.now() - started;
  const result: SnapshotResult = { asOf, households: hhRows.length, gifts: giftOut.length, tags: tagRows.length, holders: holderRows.length, ms };
  await io.write([
    { sql: `INSERT INTO lr_meta (key, value) VALUES ('snapshot', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, params: [JSON.stringify({ ...result, builtAt: new Date().toISOString() })] },
  ]);
  return result;
}
