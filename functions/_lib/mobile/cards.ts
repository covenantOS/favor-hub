// The iPhone contract's Partner card for a list of partners in one pass (a search result, a portfolio). The partner page's own
// loadPartner (functions/_lib/work/partner.ts) builds the same card for one partner with the same definitions: the household's credited
// giving (shared/giving.ts, so a gift sent through a DAF counts for the partner it names), and the categories that count as a contact. A test holds the two to the same answer for the same partner.
// Read only, through the mirror's reader, which refuses any statement that could write.
import { openActionSql } from '../hub/actions';
import { etParts } from '../actions/intake';
import { readOnly, type PartnerHit } from '../work/repo';
import type { Q } from '../work/partner';
import { givingForMany, type MirrorQ } from '../gifts/partner-giving';

const CONTACT_CATEGORIES = "('Email', 'Phone call', 'Meeting', 'Mailing')";

/** A Blackbaud calendar day as the contract's date-time. Noon UTC keeps the same calendar day in every US time zone. */
export const dayTime = (ymd: string | null | undefined): string | null => (ymd && /^\d{4}-\d{2}-\d{2}/.test(ymd) ? `${ymd.slice(0, 10)}T12:00:00Z` : null);

export function kindOf(category: string): 'call' | 'visit' | 'text' | null {
  const c = category.toLowerCase();
  if (c.includes('phone')) return 'call';
  if (c.includes('meeting')) return 'visit';
  if (c.includes('email') || c.includes('mailing')) return 'text';
  return null;
}

export interface Card {
  id: string;
  name: string;
  place: string;
  phone: string | null;
  email: string | null;
  last_gift_cents: number | null;
  last_gift_date: string | null;
  year_to_date_cents: number;
  last_contact_date: string | null;
  last_contact_kind: 'call' | 'visit' | 'text' | null;
}

/** The phone and email on file for each id: the primary one, else the first. */
export async function contactsFor(q: Q, ids: string[]): Promise<Map<string, { phone: string | null; email: string | null }>> {
  const out = new Map<string, { phone: string | null; email: string | null }>();
  if (!ids.length) return out;
  const list = JSON.stringify(ids);
  const [phones, emails] = await Promise.all([
    q<any>(
      readOnly(`SELECT constituent_record_id AS id, phone_number AS value FROM phones WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND COALESCE(is_inactive, 0) = 0 ORDER BY is_primary DESC`),
      [list]
    ),
    q<any>(
      readOnly(`SELECT constituent_record_id AS id, email_address AS value FROM emails WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND COALESCE(is_inactive, 0) = 0 ORDER BY is_primary DESC`),
      [list]
    ),
  ]);
  for (const id of ids) out.set(id, { phone: null, email: null });
  for (const p of phones) {
    const row = out.get(String(p.id));
    if (row && !row.phone && p.value) row.phone = String(p.value);
  }
  for (const e of emails) {
    const row = out.get(String(e.id));
    if (row && !row.email && e.value) row.email = String(e.value);
  }
  return out;
}

export async function cardsFor(q: Q, hits: PartnerHit[], today: string = etParts(new Date()).date): Promise<Card[]> {
  if (!hits.length) return [];
  const ids = hits.map((h) => h.cid);
  const list = JSON.stringify(ids);
  const [contacts, giving, contact] = await Promise.all([
    contactsFor(q, ids),
    givingForMany(q as unknown as MirrorQ, ids, today),
    q<any>(
      readOnly(
        `SELECT id, dt, category FROM (
           SELECT a.constituent_record_id AS id, substr(COALESCE(a.action_completed_date, a.action_date_due), 1, 10) AS dt, a.action_category AS category,
                  ROW_NUMBER() OVER (PARTITION BY a.constituent_record_id ORDER BY COALESCE(a.action_completed_date, a.action_date_due) DESC) AS rn
             FROM actions a WHERE a.constituent_record_id IN (SELECT value FROM json_each(?1)) AND NOT (${openActionSql('a')}) AND a.action_category IN ${CONTACT_CATEGORIES}
         ) WHERE rn = 1`
      ),
      [list]
    ),
  ]);
  const contactBy = new Map(contact.map((r: any) => [String(r.id), r]));
  return hits.map((h) => {
    const g = giving.get(h.cid);
    const c = contactBy.get(h.cid);
    const cc = contacts.get(h.cid);
    return {
      id: h.cid,
      name: h.name,
      place: h.place,
      phone: cc?.phone ?? null,
      email: cc?.email ?? null,
      last_gift_cents: g && g.last ? Math.round(g.last.amount * 100) : null,
      last_gift_date: g && g.last ? dayTime(g.last.date) : null,
      year_to_date_cents: g ? Math.round(g.ytd * 100) : 0,
      last_contact_date: c ? dayTime(String(c.dt)) : null,
      last_contact_kind: c ? kindOf(String(c.category || '')) : null,
    };
  });
}
