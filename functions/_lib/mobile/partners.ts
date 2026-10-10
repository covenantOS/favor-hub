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

export async function partnerCard(ctx: Ctx, id: string): Promise<Card> {
  if (!SYSTEM_ID.test(id)) throw new HttpError(404, 'no_partner', 'No partner has that number.');
  const p = await loadPartner(mirrorQ(ctx.env), id);
  if (!p) throw new HttpError(404, 'no_partner', 'No partner has that number.');
  return { ...p.card, last_gift_date: dayTime(p.card.last_gift_date), last_contact_date: dayTime(p.card.last_contact_date) };
}
