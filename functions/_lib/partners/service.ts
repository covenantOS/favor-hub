// The Partners directory's own data (stars, recently opened, saved views, tags, merge requests) in the hub database, and the record
// page's paged reads from the Blackbaud mirror (gifts, actions, relationships, attributes, codes). Nothing here writes to Blackbaud:
// tags and stars are FavorOS's own, and a merge request goes to Support, who merge the two records in Blackbaud's database view.
import { HttpError, newId, nowIso, type Env } from '../http.ts';
import type { DirSpec } from './query.ts';
import { normalizeSpec } from './query.ts';

type Row = Record<string, any>;
export type Q = <T = Row>(sql: string, params?: unknown[]) => Promise<T[]>;

const ID = /^\d{1,12}$/;
export const checkId = (id: string): string => {
  if (!ID.test(id)) throw new HttpError(400, 'no_partner', 'No partner has that number.');
  return id;
};
const all = async (env: Env, sql: string, ...params: unknown[]): Promise<Row[]> => ((await env.DB.prepare(sql).bind(...params).all()).results || []) as Row[];

// ---- stars ----
export async function stars(env: Env, email: string): Promise<string[]> {
  return (await all(env, 'SELECT cid FROM pd_fav WHERE email = ? ORDER BY at DESC LIMIT 500', email)).map((r) => String(r.cid));
}
export async function setStar(env: Env, email: string, cid: string, on: boolean): Promise<void> {
  checkId(cid);
  if (on) await env.DB.prepare('INSERT INTO pd_fav (email, cid, at) VALUES (?, ?, ?) ON CONFLICT(email, cid) DO NOTHING').bind(email, cid, nowIso()).run();
  else await env.DB.prepare('DELETE FROM pd_fav WHERE email = ? AND cid = ?').bind(email, cid).run();
}

// ---- recently opened ----
export async function noteRecent(env: Env, email: string, cid: string): Promise<void> {
  checkId(cid);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO pd_recent (email, cid, at) VALUES (?, ?, ?) ON CONFLICT(email, cid) DO UPDATE SET at = excluded.at').bind(email, cid, nowIso()),
    env.DB.prepare('DELETE FROM pd_recent WHERE email = ? AND cid NOT IN (SELECT cid FROM pd_recent WHERE email = ? ORDER BY at DESC LIMIT 30)').bind(email, email),
  ]);
}
/** Partner rows (from the directory copy) for a list of ids, in the order given. */
export async function cards(env: Env, ids: string[]): Promise<Row[]> {
  if (!ids.length) return [];
  const rows = await all(
    env,
    `SELECT id, lookup, name, kind, city, state, lifetime, last_gift, last_amt, holder_names, deceased, passed_on FROM pd_partner WHERE id IN (SELECT value FROM json_each(?))`,
    JSON.stringify(ids)
  );
  const by = new Map(rows.map((r) => [String(r.id), r]));
  return ids.map((i) => by.get(i)).filter(Boolean) as Row[];
}
export async function recent(env: Env, email: string, n = 12): Promise<Row[]> {
  const ids = (await all(env, 'SELECT cid FROM pd_recent WHERE email = ? ORDER BY at DESC LIMIT ?', email, n)).map((r) => String(r.cid));
  return cards(env, ids);
}

// ---- saved views ----
export interface View {
  id: string;
  name: string;
  spec: DirSpec;
  cols: string[];
  scope: 'private' | 'all';
  owner: string;
  ownerName: string;
  mine: boolean;
}
export async function views(env: Env, email: string): Promise<View[]> {
  const rows = await all(env, `SELECT * FROM pd_view WHERE owner = ? OR scope = 'all' ORDER BY (owner = ?) DESC, name COLLATE NOCASE`, email, email);
  return rows.map((r) => {
    let s: any = {};
    try {
      s = JSON.parse(r.spec);
    } catch {
      s = {};
    }
    return { id: r.id, name: r.name, spec: normalizeSpec(s.spec || s), cols: Array.isArray(s.cols) ? s.cols.map(String).slice(0, 40) : [], scope: r.scope === 'all' ? 'all' : 'private', owner: r.owner, ownerName: r.owner_name, mine: r.owner === email };
  });
}
export async function saveView(env: Env, email: string, name: string, b: Row): Promise<string> {
  const nm = String(name || '').trim().slice(0, 60);
  if (!nm) throw new HttpError(400, 'name', 'Give the view a name.');
  const spec = JSON.stringify({ spec: normalizeSpec(b.spec), cols: Array.isArray(b.cols) ? b.cols.map(String).slice(0, 40) : [] });
  const scope = b.scope === 'all' ? 'all' : 'private';
  const id = String(b.id || '');
  if (id) {
    const own = await env.DB.prepare('SELECT owner FROM pd_view WHERE id = ?').bind(id).first<{ owner: string }>();
    if (!own) throw new HttpError(404, 'no_view', 'That view is gone.');
    if (own.owner !== email) throw new HttpError(403, 'not_yours', 'Only the person who saved this view can change it.');
    await env.DB.prepare('UPDATE pd_view SET name = ?, spec = ?, scope = ?, updated_at = ? WHERE id = ?').bind(nm, spec, scope, nowIso(), id).run();
    return id;
  }
  const nid = newId('pdv');
  await env.DB.prepare('INSERT INTO pd_view (id, owner, owner_name, name, spec, scope, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(nid, email, String(b.ownerName || '').slice(0, 80), nm, spec, scope, nowIso(), nowIso())
    .run();
  return nid;
}
export async function dropView(env: Env, email: string, id: string, admin: boolean): Promise<void> {
  const own = await env.DB.prepare('SELECT owner FROM pd_view WHERE id = ?').bind(id).first<{ owner: string }>();
  if (!own) return;
  if (own.owner !== email && !admin) throw new HttpError(403, 'not_yours', 'Only the person who saved this view can delete it.');
  await env.DB.prepare('DELETE FROM pd_view WHERE id = ?').bind(id).run();
}

// ---- tags ----
export const cleanTag = (t: unknown): string => String(t || '').replace(/[|\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
export async function tagsOf(env: Env, cid: string): Promise<Row[]> {
  return all(env, 'SELECT tag, by_email AS by, at FROM pd_tag WHERE cid = ? ORDER BY tag COLLATE NOCASE', checkId(cid));
}
export async function allTags(env: Env): Promise<{ tag: string; n: number }[]> {
  return (await all(env, 'SELECT tag, COUNT(*) AS n FROM pd_tag GROUP BY tag ORDER BY tag COLLATE NOCASE LIMIT 400')) as { tag: string; n: number }[];
}
export async function addTag(env: Env, email: string, cids: string[], tag: string): Promise<number> {
  const t = cleanTag(tag);
  if (!t) throw new HttpError(400, 'tag', 'Type a tag.');
  const ids = [...new Set(cids.map(String))].filter((x) => ID.test(x)).slice(0, 2000);
  if (!ids.length) throw new HttpError(400, 'no_partner', 'Pick at least one partner.');
  await env.DB.prepare(`INSERT INTO pd_tag (cid, tag, by_email, at) SELECT value, ?, ?, ? FROM json_each(?) WHERE 1 ON CONFLICT(cid, tag) DO NOTHING`)
    .bind(t, email, nowIso(), JSON.stringify(ids))
    .run();
  return ids.length;
}
export async function dropTag(env: Env, cids: string[], tag: string): Promise<void> {
  const ids = [...new Set(cids.map(String))].filter((x) => ID.test(x)).slice(0, 2000);
  await env.DB.prepare('DELETE FROM pd_tag WHERE tag = ? AND cid IN (SELECT value FROM json_each(?))').bind(cleanTag(tag), JSON.stringify(ids)).run();
}

// ---- merge requests ----
export async function requestMerge(env: Env, who: { email: string; name: string }, keep: string, other: string, note: string): Promise<string> {
  checkId(keep);
  checkId(other);
  if (keep === other) throw new HttpError(400, 'same', 'Pick two different records.');
  const open = await env.DB.prepare(`SELECT id FROM pd_merge WHERE state = 'open' AND ((keep_cid = ? AND other_cid = ?) OR (keep_cid = ? AND other_cid = ?))`).bind(keep, other, other, keep).first<{ id: string }>();
  if (open) return open.id;
  const id = newId('pdm');
  await env.DB.prepare('INSERT INTO pd_merge (id, keep_cid, other_cid, note, by_email, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, keep, other, String(note || '').slice(0, 600), who.email, who.name.slice(0, 80), nowIso())
    .run();
  return id;
}
export async function merges(env: Env, state = 'open'): Promise<Row[]> {
  const rows = await all(env, `SELECT * FROM pd_merge WHERE state = ? ORDER BY at DESC LIMIT 200`, state);
  const ids = [...new Set(rows.flatMap((r) => [String(r.keep_cid), String(r.other_cid)]))];
  const by = new Map((await cards(env, ids)).map((c) => [String(c.id), c]));
  return rows.map((r) => ({ id: r.id, keep: by.get(String(r.keep_cid)) || { id: r.keep_cid }, other: by.get(String(r.other_cid)) || { id: r.other_cid }, note: r.note, by: r.by_name || r.by_email, at: r.at, state: r.state, doneBy: r.done_by, doneAt: r.done_at }));
}
/** Support marks a request merged (done in Blackbaud) or not the same partner. A pair marked not the same leaves the duplicates list. */
export async function decideMerge(env: Env, email: string, b: Row): Promise<void> {
  const state = b.state === 'done' ? 'done' : b.state === 'not_same' ? 'not_same' : '';
  if (!state) throw new HttpError(400, 'state', 'Mark it merged or not the same partner.');
  if (b.id) {
    await env.DB.prepare('UPDATE pd_merge SET state = ?, done_by = ?, done_at = ? WHERE id = ?').bind(state, email, nowIso(), String(b.id)).run();
    return;
  }
  // A pair from the duplicates list marked not the same without a request first.
  const a = checkId(String(b.keep || '')), c = checkId(String(b.other || ''));
  await env.DB.prepare('INSERT INTO pd_merge (id, keep_cid, other_cid, note, by_email, by_name, at, state, done_by, done_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(newId('pdm'), a, c, '', email, '', nowIso(), state, email, nowIso())
    .run();
}

// ---- the record page's paged reads from the mirror ----
const GIVEN = "('Donation', 'RecurringGiftPayment', 'GiftInKind', 'Stock/Property', 'Other')";
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const text = (v: unknown): string => (v == null ? '' : String(v));
function parse<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string' || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

export const GIFT_SORTS: Record<string, string> = { date: 'gdate', amount: 'amount', type: 'gtype' };

/**
 * One page of a partner's gifts: gifts on the record and gifts soft credited to it, newest first. Each row says how it counts:
 * Own (on the record, nobody else credited), Soft credit (on another record, credited here, with that record named) or Passed on
 * (on this record, credited to other partners, the way a DAF passes gifts on).
 */
export async function giftPage(q: Q, id: string, page: number, size: number, sort = 'date', dir = 'desc'): Promise<{ rows: Row[]; total: number }> {
  checkId(id);
  const like = `%"constituent_id":"${id}"%`;
  const lim = Math.min(Math.max(10, Math.floor(size) || 25), 100);
  const off = (Math.max(1, Math.floor(page) || 1) - 1) * lim;
  const col = GIFT_SORTS[sort] || 'gdate';
  const base = `SELECT id, constituent_record_id AS cid, gift_amount AS amount, substr(gift_date, 1, 10) AS gdate, gift_type AS gtype, gift_status AS gstatus,
            gift_payment_method AS method, acknowledgment_status AS ack, receipt_status AS rcpt, gift_splits AS splits, soft_credits AS soft, substr(COALESCE(gift_comments, ''), 1, 300) AS comment
       FROM gifts WHERE gift_amount > 0 AND gift_type IN ${GIVEN} AND (constituent_record_id = ?1 OR soft_credits LIKE ?2)`;
  const [rows, cnt] = await Promise.all([
    q<Row>(`${base} ORDER BY ${col} ${dir === 'asc' ? 'ASC' : 'DESC'}, gdate DESC, id DESC LIMIT ${lim} OFFSET ${off}`, [id, like]),
    q<Row>(`SELECT COUNT(*) AS n FROM gifts WHERE gift_amount > 0 AND gift_type IN ${GIVEN} AND (constituent_record_id = ?1 OR soft_credits LIKE ?2)`, [id, like]),
  ]);
  const fundIds = new Set<string>(), appealIds = new Set<string>(), others = new Set<string>();
  for (const g of rows) {
    for (const s of parse<Row[]>(g.splits, [])) {
      if (s.fund_id != null) fundIds.add(String(s.fund_id));
      if (s.appeal_id != null) appealIds.add(String(s.appeal_id));
    }
    if (String(g.cid) !== id) others.add(String(g.cid));
    for (const s of parse<Row[]>(g.soft, [])) if (s && s.constituent_id && String(s.constituent_id) !== id) others.add(String(s.constituent_id));
  }
  const [funds, appeals, names] = await Promise.all([
    fundIds.size ? q<Row>('SELECT id, fund_description AS n FROM funds WHERE id IN (SELECT value FROM json_each(?1))', [JSON.stringify([...fundIds])]) : Promise.resolve([] as Row[]),
    appealIds.size ? q<Row>('SELECT id, appeal_id AS code, appeal_description AS n FROM appeals WHERE id IN (SELECT value FROM json_each(?1))', [JSON.stringify([...appealIds])]) : Promise.resolve([] as Row[]),
    others.size
      ? q<Row>(
          `SELECT id, COALESCE(json_extract(raw_json, '$.name'), organization_name, trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))) AS n FROM constituents WHERE id IN (SELECT value FROM json_each(?1))`,
          [JSON.stringify([...others])]
        )
      : Promise.resolve([] as Row[]),
  ]);
  const fund = new Map(funds.map((f) => [String(f.id), text(f.n)]));
  const appeal = new Map(appeals.map((a) => [String(a.id), text(a.code) || text(a.n)]));
  const nm = new Map(names.map((n) => [String(n.id), text(n.n)]));
  return {
    total: num(cnt[0]?.n),
    rows: rows.map((g) => {
      const splits = parse<Row[]>(g.splits, []);
      const soft = parse<Row[]>(g.soft, []).filter((s) => s && s.constituent_id);
      const mine = soft.filter((s) => String(s.constituent_id) === id);
      const onRecord = String(g.cid) === id;
      const credit = !onRecord ? 'soft' : soft.length && !mine.length ? 'passed' : 'own';
      const amount = !onRecord && mine.length ? mine.reduce((t, s) => t + (num(s.amount?.value) || 0), 0) || num(g.amount) : num(g.amount);
      return {
        id: String(g.id),
        date: text(g.gdate),
        amount,
        giftAmount: num(g.amount),
        type: text(g.gtype),
        status: text(g.gstatus),
        method: text(g.method),
        ack: text(g.ack),
        receipt: text(g.rcpt),
        fund: [...new Set(splits.map((s) => fund.get(String(s.fund_id)) || '').filter(Boolean))].join(', '),
        appeal: [...new Set(splits.map((s) => appeal.get(String(s.appeal_id)) || '').filter(Boolean))].join(', '),
        credit,
        through: credit === 'soft' ? { id: String(g.cid), name: nm.get(String(g.cid)) || `Record ${g.cid}` } : null,
        to: credit === 'passed' ? soft.map((s) => ({ id: String(s.constituent_id), name: nm.get(String(s.constituent_id)) || `Record ${s.constituent_id}` })) : [],
        comment: text(g.comment),
      };
    }),
  };
}

const ACT_COLS = `a.id AS id, substr(a.action_date_due, 1, 10) AS due, substr(a.action_completed_date, 1, 10) AS done, a.action_type AS type, a.action_category AS category,
       a.action_summary AS summary, substr(COALESCE(a.action_description, ''), 1, 600) AS description, json_extract(a.raw_json, '$.outcome') AS outcome,
       json_extract(a.raw_json, '$.fundraisers') AS frs, json_extract(a.raw_json, '$.completed') AS completed, json_extract(a.raw_json, '$.computed_status') AS computed`;

/** One page of a partner's actions, open ones first, then the newest. */
export async function actionPage(q: Q, id: string, page: number, size: number, filter = ''): Promise<{ rows: Row[]; total: number }> {
  checkId(id);
  const lim = Math.min(Math.max(10, Math.floor(size) || 25), 100);
  const off = (Math.max(1, Math.floor(page) || 1) - 1) * lim;
  const openSql = `(a.action_completed_date IS NULL AND COALESCE(json_extract(a.raw_json, '$.completed'), 0) NOT IN (1, 'true') AND COALESCE(json_extract(a.raw_json, '$.computed_status'), '') NOT IN ('Completed', 'Canceled'))`;
  const cond = filter === 'open' ? ` AND ${openSql}` : filter === 'contacts' ? ` AND a.action_category IN ('Phone call', 'Email', 'Meeting', 'Mailing')` : '';
  const [rows, cnt, frs] = await Promise.all([
    q<Row>(`SELECT ${ACT_COLS}, ${openSql} AS isopen FROM actions a WHERE a.constituent_record_id = ?1${cond} ORDER BY isopen DESC, COALESCE(a.action_completed_date, a.action_date_due, a.date_added) DESC LIMIT ${lim} OFFSET ${off}`, [id]),
    q<Row>(`SELECT COUNT(*) AS n FROM actions a WHERE a.constituent_record_id = ?1${cond}`, [id]),
    q<Row>(`SELECT id, trim(COALESCE(fundraiser_first_name, '') || ' ' || COALESCE(fundraiser_last_name, '')) AS n FROM fundraisers`),
  ]);
  const fname = new Map(frs.map((f) => [String(f.id), text(f.n)]));
  return {
    total: num(cnt[0]?.n),
    rows: rows.map((a) => ({
      id: String(a.id),
      due: text(a.due),
      done: text(a.done).startsWith('1900') ? '' : text(a.done),
      open: num(a.isopen) === 1,
      type: text(a.type),
      category: text(a.category),
      summary: text(a.summary),
      description: text(a.description),
      outcome: text(a.outcome),
      by: parse<unknown[]>(a.frs, []).map((f) => fname.get(String(f)) || `Fundraiser ${f}`),
    })),
  };
}

/** Relationships, attributes, constituent codes and solicit codes with their dates, every address, email, phone and web address. */
export async function extras(q: Q, id: string): Promise<Row> {
  checkId(id);
  const [rels, attrs, codes, solicit, addrs, emails, phones, web] = await Promise.all([
    q<Row>(
      `SELECT relation_id AS rid, type, reciprocal_type AS rtype, COALESCE(name, trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))) AS name, is_spouse AS spouse,
              is_organization_contact AS orgc, is_primary_business AS biz, position, organization_contact_type AS ctype, substr(COALESCE(comment, ''), 1, 300) AS comment,
              substr(start_date, 1, 10) AS sd, substr(end_date, 1, 10) AS ed FROM constituent_relationships WHERE constituent_id = ?1 ORDER BY is_spouse DESC, name LIMIT 60`,
      [id]
    ),
    q<Row>(`SELECT category, value, substr(field_date, 1, 10) AS d, substr(COALESCE(comment, ''), 1, 200) AS comment FROM custom_fields WHERE constituent_record_id = ?1 ORDER BY field_date DESC LIMIT 40`, [id]),
    q<Row>(`SELECT code_description AS v, substr(code_start, 1, 10) AS sd, substr(code_end, 1, 10) AS ed, COALESCE(is_inactive, 0) AS ina FROM constituent_codes WHERE constituent_record_id = ?1 LIMIT 40`, [id]),
    q<Row>(`SELECT solicit_code AS v, substr(solicit_start, 1, 10) AS sd, substr(solicit_end, 1, 10) AS ed FROM solicit_codes WHERE constituent_record_id = ?1 LIMIT 40`, [id]),
    q<Row>(
      `SELECT address_type AS type, address_lines AS lines, address_city AS city, address_state AS st, address_postal_code AS zip, address_country AS country, is_primary AS p,
              do_not_mail AS dnm, seasonal_start AS ss, seasonal_end AS se FROM addresses WHERE constituent_record_id = ?1 AND COALESCE(is_inactive, 0) = 0 ORDER BY is_primary DESC LIMIT 12`,
      [id]
    ),
    q<Row>(`SELECT email_address AS v, json_extract(raw_json, '$.type') AS type, is_primary AS p, do_not_email AS dn FROM emails WHERE constituent_record_id = ?1 AND COALESCE(is_inactive, 0) = 0 ORDER BY is_primary DESC LIMIT 12`, [id]),
    q<Row>(`SELECT phone_number AS v, phone_type AS type, is_primary AS p, do_not_call AS dn FROM phones WHERE constituent_record_id = ?1 AND COALESCE(is_inactive, 0) = 0 ORDER BY is_primary DESC LIMIT 12`, [id]),
    q<Row>(`SELECT online_presence_address AS v, online_presence_type AS type FROM online_presences WHERE constituent_record_id = ?1 AND COALESCE(is_inactive, 0) = 0 LIMIT 8`, [id]),
  ]);
  return {
    relationships: rels.map((r) => ({ id: r.rid ? String(r.rid) : '', name: text(r.name), type: text(r.type), reciprocal: text(r.rtype), spouse: num(r.spouse) === 1, contact: num(r.orgc) === 1, business: num(r.biz) === 1, position: text(r.position), contactType: text(r.ctype), comment: text(r.comment), start: text(r.sd), end: text(r.ed) })),
    attributes: attrs.map((a) => ({ category: text(a.category), value: text(a.value), date: text(a.d), comment: text(a.comment) })),
    codes: codes.map((c) => ({ value: text(c.v), start: text(c.sd), end: text(c.ed), inactive: num(c.ina) === 1 })),
    solicit: solicit.map((c) => ({ value: text(c.v), start: text(c.sd), end: text(c.ed) })),
    addresses: addrs.map((a) => ({ type: text(a.type), lines: text(a.lines).replace(/\r?\n/g, ', '), city: text(a.city), state: text(a.st), zip: text(a.zip), country: text(a.country), primary: num(a.p) === 1, doNotMail: num(a.dnm) === 1, seasonal: a.ss ? `${text(a.ss)} to ${text(a.se)}` : '' })),
    emails: emails.map((e) => ({ value: text(e.v), type: text(e.type), primary: num(e.p) === 1, doNotEmail: num(e.dn) === 1 })),
    phones: phones.map((e) => ({ value: text(e.v), type: text(e.type), primary: num(e.p) === 1, doNotCall: num(e.dn) === 1 })),
    web: web.map((w) => ({ value: text(w.v), type: text(w.type) })),
  };
}
