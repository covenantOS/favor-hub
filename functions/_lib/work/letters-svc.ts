// Letters from the thank-you row (Gifts to thank, Support and admins). The page posts the gifts, who the letter is from, what the
// director said and the three paragraph switches. This reads the partner, address and gift from the D1 copy of Blackbaud, runs the
// letter engine (letters.ts) and answers with the merged pages or the PDF. Nothing is written here: logging goes through the
// existing thank-you route (a Mailing action with the Thanked tag, 2 Blackbaud calls per letter, Undo as for any thank-you).
import { HttpError } from '../http';
import { mirrorQ } from './partner';
import { readOnly, FUNDRAISERS_SQL } from './repo';
import { loadGifts, DEFAULT_DAYS } from './gifts';
import { loadHqty, pickAddress, partyOf } from './hqty';
import { thankLetter, titleFor, type LetterDoc } from './letters';
import { todayEt, type Ctx } from './service';
import { visibleOwners } from './gifts-svc';
import { getSetting } from './db';

export const mayLetters = (s: Ctx['scope']): boolean => !s || s.role === 'admin' || s.role === 'support';

export interface LetterInput {
  items?: { giftId?: string; cid?: string }[];
  from?: string;
  said?: string;
  designation?: boolean;
  words?: boolean;
  invitation?: boolean;
}

const LAST_SQL = readOnly(`SELECT substr(COALESCE(action_completed_date, action_date_due), 1, 10) AS d, action_category AS cat, action_summary AS s, substr(COALESCE(action_description, ''), 1, 400) AS des
  FROM actions WHERE constituent_record_id = ?1 AND json_extract(raw_json, '$.completed') = 1 ORDER BY COALESCE(action_completed_date, action_date_due) DESC LIMIT 1`);

const FROM_TYPES = /Regional Development|Church Engagement|Executive Director/i;

export async function lettersResponse(ctx: Ctx, input: LetterInput): Promise<{ docs: (LetterDoc & { key: string; giftId: string; cid: string; last: { date: string; text: string } | null })[]; froms: { id: string; name: string; title: string }[]; from: string }> {
  if (!mayLetters(ctx.scope)) throw new HttpError(403, 'not_yours', 'Letters are written by the Support Team. Directors thank by call, text, email, card or visit.');
  const items = (Array.isArray(input.items) ? input.items : []).filter((i) => i && /^\d{1,12}$/.test(String(i.giftId)) && /^\d{1,12}$/.test(String(i.cid)));
  if (!items.length) throw new HttpError(400, 'nothing_to_do', 'Pick a gift first.');
  if (items.length > 100) throw new HttpError(400, 'too_many', 'Print 100 letters or fewer at a time.');
  const q = mirrorQ(ctx.env);
  const today = todayEt();
  const days = Number(await getSetting(ctx.env, 'thank_days', String(DEFAULT_DAYS)).catch(() => '')) || DEFAULT_DAYS;
  const shaped = await loadGifts(ctx.env, q, { today, days });
  const byKey = new Map(shaped.rows.map((r) => [r.key, r]));
  const vis = visibleOwners(ctx.scope);
  const { raw } = await loadHqty(ctx.env, q, { today, ids: [...new Set(items.map((i) => String(i.giftId)))] });
  const parties = new Map(raw.parties.map((p) => [String(p.id), p]));
  const gifts = new Map(raw.gifts.map((g) => [String(g.id), g]));
  const addrs = new Map<string, typeof raw.addrs>();
  for (const a of raw.addrs) (addrs.get(String(a.cid)) || addrs.set(String(a.cid), []).get(String(a.cid))!).push(a);
  const fundraisers = await q<any>(FUNDRAISERS_SQL);
  const people = fundraisers.filter((f: any) => Number(f.active) === 1 && FROM_TYPES.test(String(f.type || ''))).map((f: any) => ({ id: String(f.id), name: `${f.first || ''} ${f.last || ''}`.trim(), title: titleFor(String(f.type || '')) }));
  const fromOf = (id: string) => people.find((p: { id: string }) => p.id === id) || fundraisers.map((f: any) => ({ id: String(f.id), name: `${f.first || ''} ${f.last || ''}`.trim(), title: titleFor(String(f.type || '')) })).find((p: { id: string }) => p.id === id);

  const docs: (LetterDoc & { key: string; giftId: string; cid: string; last: { date: string; text: string } | null })[] = [];
  for (const it of items) {
    const key = `${it.giftId}:${it.cid}`;
    const row = byKey.get(key);
    const gift = gifts.get(String(it.giftId));
    const testOk = !!ctx.testCid && String(it.cid) === ctx.testCid && !!gift;
    if (!row && !testOk) throw new HttpError(404, 'not_owed', 'That gift is not on the list of gifts to thank.');
    if (row && vis && !row.owners.some((o) => vis.has(o))) throw new HttpError(403, 'not_yours', 'That partner is outside your portfolio.');
    const amount = row ? row.amount : Number(gift!.amount) || 0;
    const date = row ? row.date : String(gift!.gdate).slice(0, 10);
    const fund = row ? (row.fund === 'No fund on file' ? '' : row.fund) : '';
    const fromId = String(input.from || (row && row.owners[0]) || '');
    const f = fromOf(fromId);
    if (!f) throw new HttpError(400, 'pick_from', 'Pick who the letter is from.');
    if (!people.some((p: { id: string }) => p.id === f.id)) people.push(f);
    const { addr } = pickAddress(addrs.get(String(it.cid)) || []);
    const last = (await q<{ d: string; cat: string; s: string; des: string }>(LAST_SQL, [String(it.cid)]).catch(() => []))[0];
    docs.push({
      key,
      giftId: String(it.giftId),
      cid: String(it.cid),
      last: last ? { date: last.d, text: [last.s, last.des].filter(Boolean).join(': ').replace(/\s+/g, ' ').trim().slice(0, 300) } : null,
      ...thankLetter(partyOf(parties.get(String(it.cid))), addr, { amount, date, fund }, { said: input.said, designation: input.designation !== false, words: input.words !== false, invitation: input.invitation === true, fromName: f.name, fromTitle: f.title }, today),
    });
  }
  const firstOwner = byKey.get(`${items[0].giftId}:${items[0].cid}`)?.owners[0] || '';
  return { docs, froms: people, from: String(input.from || firstOwner || '') };
}
