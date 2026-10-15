// The line between Receipts and First-gift letters. A waiting gift that is an acquisition first gift (classify.ts) is thanked by a
// first-gift letter, so Receipts holds it back; a gift in an open first-gift print file is held back on both lists until the file is
// marked or thrown away. Receipts calls this when it lists gifts and again when it makes a print file.
import type { Env } from '../http';
import { mirrorQ } from '../work/partner';
import { acquisitionFirstGifts } from './classify';

export interface FglHold {
  /** 'file' when the gift sits in a first-gift print file that is not marked yet; 'letters' when it waits on the First-gift letters page. */
  kind: 'file' | 'letters';
  letterDate?: string;
  appeals: string[];
}

/** Gifts in a first-gift print file that is not yet marked, so the same gift is never printed twice. */
export async function openFglGifts(env: Env): Promise<Map<string, { id: string; letterDate: string }>> {
  const out = new Map<string, { id: string; letterDate: string }>();
  const rows = await env.DB.prepare(
    `SELECT g.gift_id, b.id, b.letter_date FROM fgl_batch_gifts g JOIN fgl_batches b ON b.id = g.batch_id
     WHERE b.status IN ('printing', 'marking') AND g.state <> 'marked'`
  )
    .all<{ gift_id: string; id: string; letter_date: string }>()
    .catch(() => ({ results: [] as { gift_id: string; id: string; letter_date: string }[] }));
  for (const r of rows.results) out.set(r.gift_id, { id: r.id, letterDate: r.letter_date });
  return out;
}

/**
 * Of these waiting gifts, the ones Receipts must not print: acquisition first gifts and anything in an open first-gift file. The mirror
 * read can fail; then only the open files hold gifts back and the failure is logged, so Receipts keeps working.
 */
export async function fglHolds(env: Env, giftIds: string[]): Promise<Map<string, FglHold>> {
  const out = new Map<string, FglHold>();
  const open = await openFglGifts(env);
  for (const [id, f] of open) out.set(id, { kind: 'file', letterDate: f.letterDate, appeals: [] });
  try {
    const acq = await acquisitionFirstGifts(mirrorQ(env), giftIds);
    for (const [id, a] of acq) if (!out.has(id)) out.set(id, { kind: 'letters', appeals: a.appeals });
    for (const [id, a] of acq) {
      const h = out.get(id);
      if (h && !h.appeals.length) h.appeals = a.appeals;
    }
  } catch (err) {
    console.error('first-gift hold: the mirror read failed', err);
  }
  return out;
}
