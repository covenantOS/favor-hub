// How a partner found Favor: the appeal on their first gift ever (its description and category), the website form and referring page
// when the first gift came in online, and the gift's source code once the mirror carries one. Read only from the D1 mirror.
//
// Source codes: the partner's Source Code custom field (custom_fields, category 'Source Code', one code table entry such as
// "S2211-TGSE (Waup Book Club, WI)"). The earliest one added is the code the partner came in by. A gift column whose name holds "source"
// is the fallback when a partner has no such field.
//
// Mirror rule: no statement text may contain insert, update, replace, upsert, delete, drop, alter or create.
import { readOnly } from './repo';
import { GIVEN } from './gifts';
import type { Q } from './partner';

export interface FoundVia {
  giftId: string;
  date: string;
  amount: number;
  appealCode: string;
  appeal: string;
  category: string;
  /** The website form the first gift came through, when it came in online. */
  form: string;
  /** The page that sent the partner to the form, as a host and path. */
  referral: string;
  source: string;
  /** One short line for a row: "Acquisition · Facebook, Spring 2026" or "Website · Give page". */
  label: string;
}

const FIRST_GIFT_SQL = readOnly(`SELECT g.constituent_record_id AS cid, g.id AS gid, substr(g.gift_date, 1, 10) AS d, g.gift_amount AS amt, g.gift_splits AS splits
  FROM gifts g WHERE g.constituent_record_id IN (SELECT value FROM json_each(?1)) AND g.gift_amount > 0 AND g.gift_type IN ${GIVEN}
   AND substr(g.gift_date, 1, 10) = (SELECT MIN(substr(g2.gift_date, 1, 10)) FROM gifts g2 WHERE g2.constituent_record_id = g.constituent_record_id AND g2.gift_amount > 0 AND g2.gift_type IN ${GIVEN})
 ORDER BY g.gift_date, g.id`);

const APPEALS_SQL = readOnly(`SELECT id AS id, appeal_id AS code, appeal_description AS name, appeal_category AS cat FROM appeals WHERE id IN (SELECT value FROM json_each(?1))`);
const FIELDS_SQL = readOnly(`SELECT gift_id AS gid, category AS k, value AS v FROM gift_custom_fields WHERE gift_id IN (SELECT value FROM json_each(?1)) AND category IN ('Donation Form Name', 'Donation Referral URL', 'Original Appeal ID')`);
const SOURCE_FIELD_SQL = readOnly(`SELECT constituent_record_id AS cid, value AS v FROM custom_fields WHERE category = 'Source Code' AND value IS NOT NULL AND value <> '' AND constituent_record_id IN (SELECT value FROM json_each(?1)) ORDER BY date_added DESC, id DESC`);
const SOURCE_COLS_SQL = readOnly(`SELECT name AS name FROM pragma_table_info('gifts') WHERE lower(name) LIKE '%source%' AND lower(name) <> 'source_json'`);

const sourceCols = new WeakMap<Q, string[]>();
async function sourceColumns(q: Q): Promise<string[]> {
  const hit = sourceCols.get(q);
  if (hit) return hit;
  const rows = await q<{ name: string }>(SOURCE_COLS_SQL).catch(() => [] as { name: string }[]);
  const cols = rows.map((r) => String(r.name)).filter((n) => /^[a-z_][a-z0-9_]*$/i.test(n));
  sourceCols.set(q, cols);
  return cols;
}

const chunk = <T>(list: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};

/** "Digital Newsletter, September 2023, Week 1, Email Newsletter, Chad for Jesus" reads as "Email Newsletter, Chad for Jesus". */
export function appealTitle(name: string, category: string): string {
  const parts = String(name || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return '';
  const cat = String(category || '').toLowerCase();
  // Drop a lead part that only repeats the category ("Digital Newsletter", "Direct Mail") and the date parts after it.
  let i = 0;
  if (parts.length > 1 && (cat.includes(parts[0].toLowerCase()) || parts[0].toLowerCase().includes(cat.split(' ')[0] || '~'))) i = 1;
  while (i < parts.length - 1 && /^(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{4}|\d{4}|week \d|\d{1,2}\/\d{2,4}|q\d)$/i.test(parts[i])) i++;
  return parts.slice(i).join(', ');
}

const hostPath = (url: string): string => {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname)).slice(0, 60);
  } catch {
    return String(url || '').slice(0, 60);
  }
};

/** The label a row shows. The category leads (it says the channel), then the appeal's own title, then the form or the source code. */
export function foundLabel(f: Pick<FoundVia, 'appeal' | 'category' | 'form' | 'source' | 'appealCode'>): string {
  const cat = String(f.category || '').replace(/^Director - /, '');
  const title = appealTitle(f.appeal, cat);
  const bits = [cat, title && title.toLowerCase() !== cat.toLowerCase() ? title : ''].filter(Boolean);
  if (!bits.length && f.appealCode) bits.push(f.appealCode);
  if (f.form && !bits.some((b) => b.toLowerCase().includes(f.form.toLowerCase()))) bits.push(f.form);
  if (f.source) bits.push('Source ' + f.source);
  return bits.join(' · ');
}

/** The first gift, its appeal, form and source for each partner. Partners with no gift in the mirror are left out. */
export async function foundVia(q: Q, cids: string[]): Promise<Map<string, FoundVia>> {
  const out = new Map<string, FoundVia>();
  const ids = [...new Set(cids.map(String))].filter((c) => /^\d{1,12}$/.test(c));
  if (!ids.length) return out;
  const firsts: { cid: string; gid: string; d: string; amt: number; aid: string }[] = [];
  for (const part of chunk(ids, 300)) {
    for (const r of await q<{ cid: string; gid: string; d: string; amt: number; splits: string | null }>(FIRST_GIFT_SQL, [JSON.stringify(part)])) {
      if (firsts.some((f) => f.cid === String(r.cid))) continue;
      let aid = '';
      try {
        const s = JSON.parse(String(r.splits || '[]'));
        aid = String((Array.isArray(s) && s.find((x: any) => x && x.appeal_id)?.appeal_id) || '');
      } catch {
        aid = '';
      }
      firsts.push({ cid: String(r.cid), gid: String(r.gid), d: String(r.d), amt: Number(r.amt) || 0, aid });
    }
  }
  if (!firsts.length) return out;
  const gids = firsts.map((f) => f.gid);
  const aids = [...new Set(firsts.map((f) => f.aid).filter(Boolean))];
  const cols = await sourceColumns(q);
  const [appeals, fields, sources, partnerSources] = await Promise.all([
    aids.length ? q<{ id: string; code: string; name: string; cat: string }>(APPEALS_SQL, [JSON.stringify(aids)]).catch(() => []) : Promise.resolve([]),
    (async () => {
      const all: { gid: string; k: string; v: string }[] = [];
      for (const part of chunk(gids, 300)) all.push(...(await q<{ gid: string; k: string; v: string }>(FIELDS_SQL, [JSON.stringify(part)]).catch(() => [])));
      return all;
    })(),
    (async () => {
      if (!cols.length) return [] as { gid: string; s: string }[];
      const all: { gid: string; s: string }[] = [];
      const expr = cols.map((c) => `NULLIF(CAST(${c} AS TEXT), '')`).join(', ');
      const sql = readOnly(`SELECT id AS gid, COALESCE(${expr}${cols.length === 1 ? ", NULL" : ''}) AS s FROM gifts WHERE id IN (SELECT value FROM json_each(?1))`);
      for (const part of chunk(gids, 300)) all.push(...(await q<{ gid: string; s: string }>(sql, [JSON.stringify(part)]).catch(() => [])));
      return all;
    })(),
    (async () => {
      const all: { cid: string; v: string }[] = [];
      for (const part of chunk(ids, 300)) all.push(...(await q<{ cid: string; v: string }>(SOURCE_FIELD_SQL, [JSON.stringify(part)]).catch(() => [])));
      return all;
    })(),
  ]);
  // Rows come newest first, so the last write per partner is the earliest code added.
  const partnerSourceBy = new Map(partnerSources.map((s) => [String(s.cid), String(s.v || '').trim()]));
  const appealBy = new Map(appeals.map((a) => [String(a.id), a]));
  const fieldBy = new Map<string, Record<string, string>>();
  for (const f of fields) (fieldBy.get(String(f.gid)) || fieldBy.set(String(f.gid), {}).get(String(f.gid))!)[String(f.k)] = String(f.v || '');
  const sourceBy = new Map(sources.map((s) => [String(s.gid), String(s.s || '').trim()]));
  for (const f of firsts) {
    const a = appealBy.get(f.aid);
    const fl = fieldBy.get(f.gid) || {};
    const v: FoundVia = {
      giftId: f.gid,
      date: f.d,
      amount: f.amt,
      appealCode: a ? String(a.code || '') : '',
      appeal: a ? String(a.name || '') : '',
      category: a ? String(a.cat || '') : '',
      form: String(fl['Donation Form Name'] || '').trim().slice(0, 60),
      referral: fl['Donation Referral URL'] ? hostPath(fl['Donation Referral URL']) : '',
      source: partnerSourceBy.get(f.cid) || sourceBy.get(f.gid) || '',
      label: '',
    };
    v.label = foundLabel(v);
    out.set(f.cid, v);
  }
  return out;
}
