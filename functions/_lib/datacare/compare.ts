// The side-by-side card for one pair: everything staff compare before choosing which record stays. Read-only, from the mirror.
import { mirror } from '../foundations/blackbaud';
import type { Env } from '../http';

const REFUSES = /insert|update|replace|upsert|delete|drop|alter|create/i;
const ro = (sql: string): string => {
  if (REFUSES.test(sql)) throw new Error('mirror would refuse this statement');
  return sql;
};

const ONE = ro(`SELECT c.id AS id, c.constituent_lookup_id AS lookup, c.constituent_type AS type, trim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS name,
       c.organization_name AS org, substr(c.date_added, 1, 10) AS added, COALESCE(c.deceased, 0) AS dead, COALESCE(c.inactive, 0) AS inactive
  FROM constituents c WHERE c.id IN (SELECT value FROM json_each(?1))`);
const ADDRESSES = ro(`SELECT constituent_record_id AS cid, COALESCE(formatted_address, '') AS addr, COALESCE(do_not_mail, 0) AS dnm
  FROM addresses WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND COALESCE(is_inactive, 0) = 0 ORDER BY is_primary DESC`);
const PHONES = ro(`SELECT constituent_record_id AS cid, phone_number AS phone FROM phones WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND COALESCE(is_inactive, 0) = 0 ORDER BY is_primary DESC`);
const EMAILS = ro(`SELECT constituent_record_id AS cid, email_address AS email FROM emails WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND COALESCE(is_inactive, 0) = 0 ORDER BY is_primary DESC`);
const CODES = ro(`SELECT constituent_record_id AS cid, code_description AS code FROM constituent_codes WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND COALESCE(is_inactive, 0) = 0 AND (code_end IS NULL OR code_end = '')`);
const HOLDERS = ro(`SELECT s.constituent_record_id AS cid, trim(COALESCE(f.fundraiser_first_name, '') || ' ' || COALESCE(f.fundraiser_last_name, '')) AS who
  FROM assignments s JOIN fundraisers f ON f.id = s.assignment_fundraiser_id
 WHERE s.constituent_record_id IN (SELECT value FROM json_each(?1)) AND (s.assignment_to_date IS NULL OR substr(s.assignment_to_date, 1, 10) >= date('now'))`);
const GIFTS = ro(`SELECT constituent_record_id AS cid, COUNT(*) AS n, COALESCE(SUM(gift_amount), 0) AS total, MAX(substr(gift_date, 1, 10)) AS last
  FROM gifts WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND gift_amount > 0 GROUP BY constituent_record_id`);
const ACTIONS = ro(`SELECT constituent_record_id AS cid, COUNT(*) AS n, MAX(substr(date_added, 1, 10)) AS last FROM actions WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) GROUP BY constituent_record_id`);

export interface Side {
  id: string;
  lookup: string;
  name: string;
  type: string;
  added: string;
  address: string | null;
  addressDoNotMail: boolean;
  phone: string | null;
  emails: string[];
  codes: string[];
  heldBy: string[];
  gifts: { n: number; total: number; last: string | null };
  actions: { n: number; last: string | null };
}

export interface Compare {
  a: Side;
  b: Side;
  /** The record that has the gifts, the actions and the longest history: the one to keep unless staff pick the other. */
  suggestKeep: 'a' | 'b';
  differs: { name: boolean; address: boolean; phone: boolean };
}

const oneLine = (s: string): string => String(s).split(/\r?\n/).map((x) => x.trim()).filter(Boolean).join(', ').replace(/\s{2,}/g, ' ');
const norm = (s: string | null | undefined): string => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

export async function compareRecords(env: Env, idA: string, idB: string): Promise<Compare | null> {
  const p = [JSON.stringify([idA, idB])];
  const [one, adr, ph, em, cd, hd, gf, ac] = await Promise.all([
    mirror<any>(env, ONE, p), mirror<any>(env, ADDRESSES, p), mirror<any>(env, PHONES, p), mirror<any>(env, EMAILS, p),
    mirror<any>(env, CODES, p), mirror<any>(env, HOLDERS, p), mirror<any>(env, GIFTS, p), mirror<any>(env, ACTIONS, p),
  ]);
  const side = (id: string): Side | null => {
    const c = one.find((r) => String(r.id) === id);
    if (!c) return null;
    const a = adr.filter((r) => String(r.cid) === id);
    const good = a.find((r) => !r.dnm && r.addr) || a[0];
    const g = gf.find((r) => String(r.cid) === id);
    const x = ac.find((r) => String(r.cid) === id);
    return {
      id,
      lookup: String(c.lookup || ''),
      name: c.name || c.org || '',
      type: c.type || '',
      added: c.added || '',
      address: good && /[a-z0-9]/i.test(String(good.addr || '')) ? oneLine(good.addr) : null,
      addressDoNotMail: !!(good && good.dnm),
      phone: (ph.find((r) => String(r.cid) === id) || {}).phone || null,
      emails: [...new Set(em.filter((r) => String(r.cid) === id).map((r) => String(r.email).toLowerCase()))],
      codes: [...new Set(cd.filter((r) => String(r.cid) === id).map((r) => String(r.code)))],
      heldBy: [...new Set(hd.filter((r) => String(r.cid) === id).map((r) => String(r.who)).filter(Boolean))],
      gifts: { n: Number(g?.n || 0), total: Number(g?.total || 0), last: g?.last || null },
      actions: { n: Number(x?.n || 0), last: x?.last || null },
    };
  };
  const a = side(idA);
  const b = side(idB);
  if (!a || !b) return null;
  const weight = (s: Side) => s.gifts.n * 3 + s.actions.n + s.codes.length + s.heldBy.length * 2;
  const suggestKeep = weight(b) > weight(a) || (weight(b) === weight(a) && b.added && a.added && b.added < a.added) ? 'b' : 'a';
  return { a, b, suggestKeep, differs: { name: norm(a.name) !== norm(b.name), address: norm(a.address) !== norm(b.address), phone: norm(a.phone) !== norm(b.phone) } };
}
