// Which senders are partners: matched on email address in the Blackbaud copy (the mirror). Tests pass a stand-in through MailCtx.
// What the copy said is kept in D1 for 6 hours (1 hour for "not a partner"), because the copy is a remote call and the answer changes slowly.
import type { Env } from '../http';

export type PartnerMap = Record<string, { id: string; name: string }>;
export type PartnerLookup = (emails: string[]) => Promise<PartnerMap>;

const YES = 6 * 3600e3;
const NO = 3600e3;

export async function partnerMap(env: Env, emails: string[], stand?: PartnerLookup): Promise<PartnerMap> {
  const list = [...new Set(emails.map((e) => String(e || '').toLowerCase()))].filter(Boolean).slice(0, 200);
  if (!list.length) return {};
  if (stand) return stand(list).catch(() => ({}));
  const out: PartnerMap = {};
  const known = new Set<string>();
  try {
    const r = await env.DB.prepare('SELECT email, partner_id, name, at FROM hub_mail_people WHERE email IN (SELECT value FROM json_each(?))').bind(JSON.stringify(list)).all<{ email: string; partner_id: string; name: string; at: string }>();
    for (const x of r.results || []) {
      const age = Date.now() - Date.parse(x.at);
      if (age > (x.partner_id ? YES : NO)) continue;
      known.add(x.email);
      if (x.partner_id) out[x.email] = { id: x.partner_id, name: x.name };
    }
  } catch {
    /* the table is not there yet */
  }
  const need = list.filter((e) => !known.has(e));
  if (!need.length) return out;
  const { mirror } = await import('../foundations/blackbaud');
  let rows: any[] | null = null;
  try {
    rows = await mirror<any>(
      env,
      `SELECT lower(e.email_address) AS email, e.constituent_record_id AS id,
              COALESCE(json_extract(c.raw_json, '$.name'), trim(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,''))) AS name
         FROM emails e JOIN constituents c ON c.id = e.constituent_record_id
        WHERE lower(e.email_address) IN (SELECT value FROM json_each(?1))`,
      [JSON.stringify(need)]
    );
  } catch {
    rows = null;
  }
  if (!rows) return out;
  const at = new Date().toISOString();
  const found = new Map<string, { id: string; name: string }>();
  for (const r of rows) if (!found.has(r.email)) found.set(r.email, { id: String(r.id), name: String(r.name || '') });
  for (const [e, v] of found) out[e] = v;
  await env.DB.batch(need.map((e) => env.DB.prepare('INSERT INTO hub_mail_people (email, partner_id, name, at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET partner_id = excluded.partner_id, name = excluded.name, at = excluded.at').bind(e, found.get(e)?.id || '', found.get(e)?.name || '', at))).catch(() => undefined);
  return out;
}
