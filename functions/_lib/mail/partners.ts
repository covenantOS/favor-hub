// Which senders are partners: matched on email address in the Blackbaud copy (the mirror). Tests pass a stand-in through MailCtx.
import type { Env } from '../http';

export type PartnerMap = Record<string, { id: string; name: string }>;
export type PartnerLookup = (emails: string[]) => Promise<PartnerMap>;

export async function partnerMap(env: Env, emails: string[], stand?: PartnerLookup): Promise<PartnerMap> {
  const list = [...new Set(emails.map((e) => String(e || '').toLowerCase()))].filter(Boolean).slice(0, 200);
  if (!list.length) return {};
  if (stand) return stand(list).catch(() => ({}));
  const { mirror } = await import('../foundations/blackbaud');
  const rows = await mirror<any>(
    env,
    `SELECT lower(e.email_address) AS email, e.constituent_record_id AS id,
            COALESCE(json_extract(c.raw_json, '$.name'), trim(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,''))) AS name
       FROM emails e JOIN constituents c ON c.id = e.constituent_record_id
      WHERE lower(e.email_address) IN (${list.map(() => '?').join(',')})`,
    list
  ).catch(() => []);
  return Object.fromEntries(rows.map((r: any) => [r.email, { id: String(r.id), name: String(r.name || '') }]));
}
