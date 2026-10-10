// Log a call, visit or text from the phone. It enters the Work Center's one-contact-many-partners path with one partner, so the
// hub's duplicate guard, the outbox (saved first, then sent), the daily cap (lane 2,400 of 3,000) and the posting switch all apply
// unchanged. The person must be on the Entry list (an RDD or an executive owner); the contact is entered under their own name.
import { HttpError, nowIso } from '../http';
import { etParts } from '../actions/intake';
import { entryMany, entryOwners } from '../work/entry';
import { runBatch, type Ctx } from '../work/service';

export type ContactKind = 'call' | 'visit' | 'text' | 'email';
export const KINDS: ContactKind[] = ['call', 'visit', 'text', 'email'];
const CHANNEL: Record<ContactKind, string> = { call: 'call', visit: 'meet', text: 'text', email: 'email' };
const DEFAULT_SUMMARY: Record<ContactKind, string> = { call: 'Phone call', visit: 'Visit', text: 'Text', email: 'Email' };

export interface ContactInput {
  partner_id: string;
  kind: ContactKind;
  note?: string;
  occurred_at: string;
}

export function parseContact(b: Record<string, any>): ContactInput {
  const kind = String(b.kind || '') as ContactKind;
  if (!KINDS.includes(kind)) throw new HttpError(400, 'bad_kind', 'kind must be call, visit, text or email.');
  const partner = String(b.partner_id || '').trim();
  if (!/^\d{1,12}$/.test(partner)) throw new HttpError(400, 'bad_partner', 'partner_id is the partner system id.');
  const when = Date.parse(String(b.occurred_at || ''));
  if (!Number.isFinite(when)) throw new HttpError(400, 'bad_date', 'occurred_at must be a date and time.');
  if (when > Date.now() + 36 * 3600 * 1000) throw new HttpError(400, 'bad_date', 'That contact is dated in the future.');
  if (when < Date.now() - 400 * 86400 * 1000) throw new HttpError(400, 'bad_date', 'That contact is over a year old. Enter it in the Work Center.');
  return { partner_id: partner, kind, note: typeof b.note === 'string' ? b.note : '', occurred_at: new Date(when).toISOString() };
}

/** One line for the action's summary: the first line of the note, else the kind. The Work Center caps a summary at 255. */
export function summaryOf(kind: ContactKind, note: string | undefined): string {
  const first = String(note || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
  return (first || DEFAULT_SUMMARY[kind]).slice(0, 255);
}

export async function logContact(ctx: Ctx, fid: string, input: ContactInput, req: string, waitUntil: (p: Promise<unknown>) => void) {
  const owner = fid ? (await entryOwners(ctx.env)).find((o) => String(o.bb_fundraiser_id) === fid) : undefined;
  if (!owner) throw new HttpError(403, 'not_entry_owner', 'Your account is not set up to log contacts from the app yet.');
  const hits = await ctx.repo.partnersByIds([input.partner_id]);
  if (!hits.length) throw new HttpError(404, 'no_partner', 'No partner has that number.');
  if (hits[0].deceased) throw new HttpError(400, 'deceased', 'That partner is marked deceased.');
  const date = etParts(new Date(input.occurred_at)).date;
  const out = (await entryMany(ctx, {
    owner: fid,
    date,
    channel: CHANNEL[input.kind],
    summary: summaryOf(input.kind, input.note),
    description: String(input.note || '').trim() === summaryOf(input.kind, input.note) ? '' : String(input.note || '').trim().slice(0, 4000),
    tags: [],
    constituent_ids: [input.partner_id],
    req,
  })) as { batch?: { id?: string; run_when?: string } | null; created?: number; dups?: number };
  if (!out.created) {
    // The duplicate guard found this contact already in Blackbaud, or already entered here.
    throw new HttpError(409, 'already_recorded', 'That contact is already recorded.');
  }
  const b = out.batch;
  if (b && b.id && b.run_when === 'now') waitUntil(runBatch(ctx, b.id).catch(() => undefined));
  return { recorded: true, batch_id: b?.id || null, run_when: b?.run_when || null, at: nowIso() };
}
