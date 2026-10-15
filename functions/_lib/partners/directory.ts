// The Partners directory's copy of every Blackbaud record: one pd_partner row per record in the mirror (individuals, organizations,
// churches, foundations, givers or not) with the fields the directory searches, filters and sorts on. Rebuilt with the lists snapshot
// (functions/_lib/lists/refresh.ts) and on demand by an admin; the table is emptied and refilled inside one D1 batch, so a reader
// sees the old copy or the new one. Read only against the mirror; nothing here writes to Blackbaud.
//
// Giving follows Favor's partner rule, the one the KPI dashboard, the Brain and Lists use (functions/_lib/lists/layer.ts): soft credits
// replace the record a gift sits on, spouses linked in Blackbaud are one household keyed by the smaller record id, and a household
// never gets more than the gift's amount from one gift. The figures are read from the lists snapshot (lr_hh and lr_gift), which is
// rebuilt just before this copy, so a partner's lifetime reads the same in the directory, in Lists and in the Brain. Both spouses'
// rows carry their household's figures. Active, LYBUNT and Lapsed use the household's last gift with the KPI windows.
import { bulkInsert, type SnapshotIO, type Stmt } from '../lists/snapshot.ts';
import { notTestPartnerSql } from '../testpartners.ts';

type Row = Record<string, any>;

const CONTACTS = "('Phone call', 'Email', 'Meeting', 'Mailing')";
const CHUNK = 6000;

export const PD_COLS = [
  'id', 'lookup', 'name', 'sort_name', 'kind', 'spouse_id', 'spouse_name', 'email', 'phone', 'addr', 'city', 'state', 'zip', 'country',
  'deceased', 'inactive', 'anon', 'no_email', 'no_addr', 'dnm', 'dne', 'dnc', 'added', 'codes', 'solicit', 'holders', 'holder_names',
  'gifts', 'lifetime', 'first_gift', 'last_gift', 'last_amt', 'largest', 'ytd', 'last_year', 'l12', 'hh_last', 'recurring', 'passed_on', 'passed_n', 'last_contact', 'open_actions', 'q',
] as const;

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const day = (v: unknown): string | null => (v ? String(v).slice(0, 10) : null);
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const flag = (v: unknown): number => (v === 1 || v === '1' || v === true || v === 'true' ? 1 : 0);
const pipe = (xs: Iterable<string>): string => {
  const s = [...new Set([...xs].filter(Boolean))];
  return s.length ? `|${s.join('|')}|` : '';
};
const digits = (s: string): string => s.replace(/\D/g, '');

/** Church, foundation (DAF providers and donor-advised funds too), other organization, or individual, from the type and the codes. */
export function kindOf(ctype: string, codes: string[]): 'individual' | 'organization' | 'church' | 'foundation' {
  if (ctype !== 'Organization') return 'individual';
  const c = codes.map((x) => x.toLowerCase());
  if (c.includes('church')) return 'church';
  if (c.some((x) => x === 'foundation' || x === 'daf provider' || x === 'donor advised fund')) return 'foundation';
  return 'organization';
}

/** "Smith, Ada" for a person, the name without a leading "The" for an organization, lower case. */
export function sortNameOf(kind: string, name: string, first: string, last: string): string {
  const clean = (x: string) => x.toLowerCase().replace(/^[^a-z0-9]+/, '').trim();
  const key = kind === 'individual' && clean(last) ? `${clean(last)}, ${clean(first)}` : clean(name.replace(/^the\s+/i, ''));
  // A name with no letters or digits ("? ?") sorts after every real name.
  return /^[a-z0-9]/.test(key) ? key : '~' + key;
}

function minusYears(iso: string, n: number): string {
  return `${Number(iso.slice(0, 4)) - n}${iso.slice(4)}`;
}

export interface DirectoryResult {
  asOf: string;
  records: number;
  givers: number;
  ms: number;
}

/** Read the mirror's records a chunk at a time (the answer for all of them at once is several megabytes). */
async function readConstituents(io: SnapshotIO): Promise<Row[]> {
  const out: Row[] = [];
  let after = '';
  for (let i = 0; i < 20; i++) {
    const rows = await io.read(
      `SELECT id, constituent_lookup_id AS lookup, constituent_type AS ctype, first_name AS first, last_name AS last, preferred_name AS pref,
              organization_name AS org, json_extract(raw_json, '$.name') AS rname, deceased AS dec, inactive AS ina, gives_anonymously AS anon,
              requests_no_email AS rne, no_valid_address AS nva, substr(date_added, 1, 10) AS added, spouse_id AS sid
         FROM constituents WHERE id > ?1 AND ${notTestPartnerSql('id')} ORDER BY id LIMIT ${CHUNK}`,
      [after]
    );
    out.push(...rows);
    if (rows.length < CHUNK) break;
    after = String(rows[rows.length - 1].id);
  }
  return out;
}

export async function buildDirectory(io: SnapshotIO, asOf: string): Promise<DirectoryResult> {
  const started = Date.now();
  const yearStart = asOf.slice(0, 4) + '-01-01';
  const lastYearStart = String(Number(asOf.slice(0, 4)) - 1) + '-01-01';
  const yearAgo = minusYears(asOf, 1);

  const [people, emails, phones, addresses, recurringRows, holders, fundraisers, codes, solicit, contacts, open, passed] = await Promise.all([
    readConstituents(io),
    io.read(`SELECT constituent_record_id AS cid, email_address AS v, is_primary AS p, do_not_email AS dn FROM emails WHERE COALESCE(is_inactive, 0) = 0 AND email_address IS NOT NULL`),
    io.read(`SELECT constituent_record_id AS cid, phone_number AS v, is_primary AS p, do_not_call AS dn FROM phones WHERE COALESCE(is_inactive, 0) = 0 AND phone_number IS NOT NULL`),
    io.read(
      `SELECT constituent_record_id AS cid, address_lines AS lines, address_city AS city, address_state AS st, address_postal_code AS zip, address_country AS country,
              is_primary AS p, do_not_mail AS dn FROM addresses WHERE COALESCE(is_inactive, 0) = 0`
    ),
    io.read(`SELECT DISTINCT constituent_record_id AS cid FROM gifts WHERE gift_type = 'RecurringGift' AND gift_status = 'Active'`),
    io.read(
      `SELECT constituent_record_id AS cid, assignment_fundraiser_id AS fid FROM assignments
        WHERE assignment_fundraiser_id IS NOT NULL AND (assignment_to_date IS NULL OR DATE(assignment_to_date) >= ?1)`,
      [asOf]
    ),
    io.read(`SELECT id, trim(COALESCE(fundraiser_first_name, '') || ' ' || COALESCE(fundraiser_last_name, '')) AS name FROM fundraisers`),
    io.read(`SELECT constituent_record_id AS cid, code_description AS v FROM constituent_codes WHERE code_description IS NOT NULL AND COALESCE(is_inactive, 0) = 0`),
    io.read(`SELECT constituent_record_id AS cid, solicit_code AS v FROM solicit_codes WHERE solicit_code IS NOT NULL AND COALESCE(NULLIF(solicit_end, ''), '9999-12-31') >= ?1`, [asOf]),
    io.read(
      `SELECT constituent_record_id AS cid, MAX(DATE(COALESCE(action_completed_date, action_date_due))) AS d FROM actions
        WHERE json_extract(raw_json, '$.completed') = 1 AND action_category IN ${CONTACTS} GROUP BY constituent_record_id`
    ),
    io.read(
      `SELECT constituent_record_id AS cid, COUNT(*) AS n FROM actions a
        WHERE a.action_completed_date IS NULL AND COALESCE(json_extract(a.raw_json, '$.completed'), 0) NOT IN (1, 'true')
          AND COALESCE(json_extract(a.raw_json, '$.computed_status'), '') NOT IN ('Completed', 'Canceled') GROUP BY constituent_record_id`
    ),
    // Gifts that sit on a record but are soft credited to other partners: what a DAF or foundation passed on.
    io.read(
      `SELECT constituent_record_id AS cid, COUNT(*) AS n, SUM(gift_amount) AS t FROM gifts
        WHERE gift_amount > 0 AND gift_type <> 'RecurringGift' AND soft_credits IS NOT NULL AND soft_credits NOT IN ('', '[]') GROUP BY constituent_record_id`
    ),
  ]);
  const [households, credit] = await Promise.all([
    io.hub(`SELECT household_id AS hid, first_gift AS first, last_gift AS last, last_amt AS lamt, largest, lifetime, gifts FROM lr_hh`).catch(() => [] as Row[]),
    io.hub(
      `SELECT household_id AS hid, SUM(CASE WHEN gift_date >= ?1 THEN credited ELSE 0 END) AS ytd, SUM(CASE WHEN gift_date >= ?2 AND gift_date < ?1 THEN credited ELSE 0 END) AS ly,
              SUM(CASE WHEN gift_date > ?3 THEN credited ELSE 0 END) AS l12 FROM lr_gift WHERE gift_date >= ?4 GROUP BY household_id`,
      [yearStart, lastYearStart, yearAgo, lastYearStart < yearAgo ? lastYearStart : yearAgo]
    ).catch(() => [] as Row[]),
  ]);

  const group = <T>(rows: Row[], key = 'cid') => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const k = String(r[key]);
      const a = m.get(k);
      if (a) a.push(r);
      else m.set(k, [r]);
    }
    return m as Map<string, T[]>;
  };
  const emailBy = group<Row>(emails);
  const phoneBy = group<Row>(phones);
  const addrBy = group<Row>(addresses);
  const codeBy = group<Row>(codes);
  const solicitBy = group<Row>(solicit);
  const holderBy = group<Row>(holders);
  const frName = new Map(fundraisers.map((f) => [String(f.id), text(f.name)]));
  const lastContact = new Map(contacts.map((c) => [String(c.cid), day(c.d)]));
  const openN = new Map(open.map((o) => [String(o.cid), num(o.n)]));
  const passedBy = new Map(passed.map((o) => [String(o.cid), o]));

  const recurring = new Set(recurringRows.map((r) => String(r.cid)));
  const hhBy = new Map(households.map((h) => [String(h.hid), h]));
  const creditBy = new Map(credit.map((c) => [String(c.hid), c]));

  const byId = new Map(people.map((p) => [String(p.id), p]));
  const nameOf = (p: Row): string => {
    const raw = text(p.rname).trim();
    if (raw) return raw;
    if (text(p.ctype) === 'Organization') return text(p.org).trim() || `Record ${p.id}`;
    return `${text(p.pref) || text(p.first)} ${text(p.last)}`.trim() || `Record ${p.id}`;
  };

  let givers = 0;
  const rows: unknown[][] = people.map((p) => {
    const id = String(p.id);
    const codesOf = (codeBy.get(id) || []).map((c) => text(c.v));
    const kind = kindOf(text(p.ctype), codesOf);
    const name = nameOf(p);
    const sid = p.sid ? String(p.sid) : '';
    const spouse = sid ? byId.get(sid) : undefined;
    const spouseName = spouse ? nameOf(spouse) : '';
    const em = (emailBy.get(id) || []).slice().sort((a, b) => num(b.p) - num(a.p));
    const ph = (phoneBy.get(id) || []).slice().sort((a, b) => num(b.p) - num(a.p));
    const ad = (addrBy.get(id) || []).slice().sort((a, b) => num(b.p) - num(a.p))[0];
    // The household: the smaller of the two record ids when the spouse's record is in the mirror (layer.ts, hh).
    const hid = spouse && Number(sid) < Number(id) ? sid : id;
    const h = hhBy.get(hid);
    const c = creditBy.get(hid);
    if (h && num(h.gifts) > 0) givers++;
    const hold = (holderBy.get(id) || []).map((h) => String(h.fid));
    const lines = ad ? text(ad.lines).replace(/\r?\n/g, ', ') : '';
    const q = [name, spouseName, text(p.lookup), ...em.map((e) => text(e.v)), ...ph.map((x) => digits(text(x.v))), lines, ad ? text(ad.city) : '', ad ? text(ad.st) : '', ad ? text(ad.zip) : '']
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return [
      id, text(p.lookup) || null, name, sortNameOf(kind, name, text(p.pref) || text(p.first), text(p.last)), kind, sid || null, spouseName || null,
      em[0] ? text(em[0].v) : null, ph[0] ? text(ph[0].v) : null, lines || null, ad ? text(ad.city) || null : null, ad ? text(ad.st) || null : null,
      ad ? text(ad.zip) || null : null, ad ? text(ad.country) || null : null,
      flag(p.dec), flag(p.ina), flag(p.anon), flag(p.rne), flag(p.nva), ad && flag(ad.dn) ? 1 : 0,
      em.length && em.every((e) => flag(e.dn)) ? 1 : 0, ph.length && ph.every((x) => flag(x.dn)) ? 1 : 0,
      day(p.added), pipe(codesOf), pipe((solicitBy.get(id) || []).map((s) => text(s.v))), pipe(hold),
      [...new Set(hold.map((f) => frName.get(f) || ''))].filter(Boolean).join(', ') || null,
      h ? num(h.gifts) : 0, h ? Math.round(num(h.lifetime) * 100) / 100 : 0, day(h?.first), day(h?.last), h && h.last ? num(h.lamt) : null, h ? num(h.largest) : 0,
      c ? Math.round(num(c.ytd) * 100) / 100 : 0, c ? Math.round(num(c.ly) * 100) / 100 : 0, c ? Math.round(num(c.l12) * 100) / 100 : 0,
      day(h?.last), recurring.has(id) || (sid && recurring.has(sid)) ? 1 : 0,
      Math.round(num(passedBy.get(id)?.t) * 100) / 100, num(passedBy.get(id)?.n), lastContact.get(id) || null, openN.get(id) || 0, q,
    ];
  });

  // The directory's menus (codes, solicit codes, states and holders with their counts), kept with the copy.
  const count = (vals: Iterable<string>) => {
    const m = new Map<string, number>();
    for (const v of vals) if (v) m.set(v, (m.get(v) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v, n]) => ({ v, n }));
  };
  const at = (k: string) => PD_COLS.indexOf(k as (typeof PD_COLS)[number]);
  const split = (s: unknown) => String(s || '').split('|').filter(Boolean);
  const menus = {
    codes: count(rows.flatMap((r) => split(r[at('codes')]))),
    solicit: count(rows.flatMap((r) => split(r[at('solicit')]))),
    states: count(rows.map((r) => String(r[at('state')] || '').toUpperCase()).filter((x) => /^[A-Z]{2,3}$/.test(x))),
    holders: count(rows.flatMap((r) => split(r[at('holders')]))).map((h) => ({ ...h, name: frName.get(h.v) || `Fundraiser ${h.v}` })),
  };

  const stmts: Stmt[] = [{ sql: 'DELETE FROM pd_partner', params: [] }, ...bulkInsert('pd_partner', [...PD_COLS], rows)];
  stmts.push({ sql: `INSERT INTO pd_meta (key, value) VALUES ('menus', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, params: [JSON.stringify(menus)] });
  const result: DirectoryResult = { asOf, records: rows.length, givers, ms: 0 };
  result.ms = Date.now() - started;
  stmts.push({
    sql: `INSERT INTO pd_meta (key, value) VALUES ('directory', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    params: [JSON.stringify({ ...result, builtAt: new Date().toISOString() })],
  });
  if (rows.length) await io.write(stmts);
  return result;
}
