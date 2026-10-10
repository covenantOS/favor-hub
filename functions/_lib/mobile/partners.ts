// Partner lookup and detail for the phone. Search uses the partner page's global search (name, email, phone, lookup id, street) and
// adds the card fields so the list needs no second call. Detail is the partner page's own loadPartner, trimmed to its `card`.
import { HttpError } from '../http';
import { mirrorQ, loadPartner, searchPartners, SYSTEM_ID } from '../work/partner';
import { readOnly, type ActionsRepo } from '../work/repo';
import { etParts } from '../actions/intake';
import type { Ctx } from '../work/service';
import { cardsFor, dayTime, type Card } from './cards';

export const PORTFOLIO_LIMIT = 25;

/** The person's own partners: current assignments to their fundraiser id, alive and active, by name. */
async function portfolioHits(ctx: Ctx, fid: string): Promise<{ cid: string }[]> {
  if (!fid) return [];
  const today = etParts(new Date()).date;
  const rows = await mirrorQ(ctx.env)<{ id: string }>(
    readOnly(
      `SELECT a.constituent_record_id AS id FROM assignments a JOIN constituents c ON c.id = a.constituent_record_id
        WHERE a.assignment_fundraiser_id = ?1 AND (a.assignment_to_date IS NULL OR substr(a.assignment_to_date, 1, 10) >= ?2)
          AND COALESCE(c.inactive, 0) = 0 AND COALESCE(c.deceased, 0) = 0
        GROUP BY a.constituent_record_id ORDER BY COALESCE(MAX(c.last_name), MAX(c.organization_name), '') , MAX(c.first_name) LIMIT ${PORTFOLIO_LIMIT}`
    ),
    [fid, today]
  );
  return rows.map((r) => ({ cid: String(r.id) }));
}

export async function searchCards(ctx: Ctx, fid: string, q: string): Promise<Card[]> {
  const text = q.trim().slice(0, 80);
  const read = mirrorQ(ctx.env);
  let hits;
  if (!text) {
    const mine = await portfolioHits(ctx, fid);
    hits = mine.length ? await ctx.repo.partnersByIds(mine.map((m) => m.cid)) : [];
    const order = new Map(mine.map((m, i) => [m.cid, i]));
    hits.sort((a, b) => (order.get(a.cid) ?? 0) - (order.get(b.cid) ?? 0));
  } else {
    hits = await searchPartners(ctx.repo as ActionsRepo, read, text, fid || undefined, 8);
  }
  return cardsFor(read, hits.filter((h) => !h.deceased));
}

export interface OpenTask {
  id: string;
  summary: string;
  type: string;
  due_date: string | null;
}

/** The phone's partner page: the card plus what a call needs on screen (largest gift, open tasks, address, lookup id). */
export interface PartnerDetail extends Card {
  lookup_id: string;
  address: string | null;
  largest_gift_cents: number | null;
  largest_gift_date: string | null;
  open_task_count: number;
  open_tasks: OpenTask[];
  synced_at: string | null;
}

export async function partnerCard(ctx: Ctx, id: string): Promise<PartnerDetail> {
  if (!SYSTEM_ID.test(id)) throw new HttpError(404, 'no_partner', 'No partner has that number.');
  const p = await loadPartner(mirrorQ(ctx.env), id);
  if (!p) throw new HttpError(404, 'no_partner', 'No partner has that number.');
  const a = p.contact.address;
  const address = a ? [a.lines, [a.city, a.state].filter(Boolean).join(', '), a.zip].filter(Boolean).join(' ').trim() : '';
  return {
    ...p.card,
    last_gift_date: dayTime(p.card.last_gift_date),
    last_contact_date: dayTime(p.card.last_contact_date),
    lookup_id: p.lookup,
    address: address || null,
    largest_gift_cents: p.giving.largest ? Math.round(p.giving.largest.amount * 100) : null,
    largest_gift_date: p.giving.largest ? dayTime(p.giving.largest.date) : null,
    open_task_count: p.actions.openCount,
    open_tasks: p.actions.open.slice(0, 10).map((t) => ({ id: t.id, summary: t.summary || t.type || 'Task', type: t.type, due_date: dayTime(t.due) })),
    synced_at: p.synced ? p.synced.replace(/\.\d+/, '') : null,
  };
}
