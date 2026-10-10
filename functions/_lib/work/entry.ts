// Entry: Support's intake of the week's contacts. Rows come from the RDD tracking sheet (pasted), from "One contact, many partners",
// or typed. Each is matched to a partner, checked against what Blackbaud already holds, and sent as one completed contact.
// The hub's own table (act_submissions) keeps every row, so nothing a person reviewed is lost when Blackbaud is down.
import { HttpError, newId, nowIso, type Env } from '../http';
import { addMeter, getSetting, listStaff, logEvent, setSetting, type StaffRow } from './db';
import { monthsBack, readOwnerTabs, SheetReadError } from './sheetsa';
import { batchByReq, saveBatch, todayEt, validDate, type Ctx, type PlannedItem } from './service';
import { idemKey } from '../actions/outbox';
import type { PartnerHit } from './repo';
import {
  askOf, channelOf, entryBody, entryTags, findDuplicate, HOWS, householdHints, pasteRef, parseSheetText, resolvePartner, shortSummary, tagsOf, TAGS, toIso, weekOf, weekWindow, type DoneAction, type SheetRow,
} from '../actions/intake';
import { addDays } from '../actions/completion';
import { CHUNK } from '../actions/batch';
import type { Step } from '../actions/completion';

export interface SubRow {
  id: string;
  owner_fid: string;
  source: string;
  sheet_ref: string | null;
  contact_date: string;
  raw: string;
  constituent_id: string | null;
  match_how: string | null;
  channel: string | null;
  summary: string | null;
  description: string | null;
  tags: string | null;
  ask_amount: number | null;
  referrals: number | null;
  state: string;
  dup_action_id: string | null;
  bb_action_id: string | null;
  posted_at: string | null;
  posted_by: string | null;
  created_at: string;
  created_by: string;
}

const j = (s: string | null, d: any) => {
  try {
    return s ? JSON.parse(s) : d;
  } catch {
    return d;
  }
};

export async function entryOwners(env: Env): Promise<StaffRow[]> {
  return (await listStaff(env).catch(() => [])).filter((s) => s.entry_owner === 1 && s.active === 1 && s.bb_fundraiser_id);
}

async function ownerOf(env: Env, fid: string): Promise<StaffRow> {
  const o = (await entryOwners(env)).find((s) => String(s.bb_fundraiser_id) === fid);
  if (!o) throw new HttpError(400, 'bad_owner', 'Pick whose contacts these are from the list.');
  return o;
}

const wkOf = (date: string) => weekOf(date, weekWindow());

function shapeSub(r: SubRow, parts: Map<string, PartnerHit>) {
  const raw = j(r.raw, {});
  return {
    id: r.id,
    owner: r.owner_fid,
    source: r.source,
    date: r.contact_date,
    wk: wkOf(r.contact_date),
    name: raw.name || (r.constituent_id && parts.get(r.constituent_id)?.name) || '',
    org: raw.org || '',
    isNew: raw.isNew || '',
    row: raw.row || '',
    how: r.match_how || 'none',
    cid: r.constituent_id,
    cands: (raw.cands || []) as string[],
    ch: r.channel || '',
    act: raw.act || '',
    sum: r.summary || '',
    notes: raw.notes || r.description || '',
    tags: j(r.tags, []) as string[],
    ask: r.ask_amount ? String(r.ask_amount) : '',
    state: r.state,
    ticked: !!raw.ticked,
    dup: raw.dup || null,
    posted: r.posted_at ? { at: r.posted_at, by: r.posted_by || '' } : null,
    email: !!raw.email,
    phone: !!raw.phone,
  };
}

export async function entryView(ctx: Ctx, ownerFid: string) {
  const env = ctx.env;
  const owners = await entryOwners(env);
  const w = weekWindow();
  const since = addDays(w.lastStart, -60);
  const all = (await env.DB.prepare('SELECT * FROM act_submissions WHERE contact_date >= ? ORDER BY contact_date, created_at').bind(since).all<SubRow>()).results;
  const counts = (fid: string) => {
    const mine = all.filter((r) => r.owner_fid === fid);
    const open = (r: SubRow) => r.state === 'waiting' || r.state === 'failed' || r.state === 'posting';
    const inBB = (r: SubRow) => r.state === 'in_blackbaud' || r.state === 'posted';
    const thisW = mine.filter((r) => wkOf(r.contact_date) === 'this' && r.state !== 'skipped');
    return {
      sub: thisW.length,
      inBB: thisW.filter(inBB).length,
      wait: thisW.filter(open).length,
      late: mine.filter((r) => wkOf(r.contact_date) !== 'this' && open(r)).length,
      in: mine.filter(inBB).length,
      all: mine.length,
    };
  };
  const owner = owners.find((o) => String(o.bb_fundraiser_id) === ownerFid) || owners[0];
  const fid = owner ? String(owner.bb_fundraiser_id) : '';
  const rows = fid ? all.filter((r) => r.owner_fid === fid) : [];
  const cids = [...new Set(rows.flatMap((r) => [r.constituent_id, ...(j(r.raw, {}).cands || [])]).filter(Boolean) as string[])];
  const hits = await ctx.repo.partnersByIds(cids.slice(0, 500)).catch(() => []);
  const parts = new Map(hits.map((h) => [h.cid, h]));
  let bb = { this: 0, last: 0, lastByMon3: 0 };
  if (owner) {
    const cutoff = etCutoff(w.lastEnd);
    const wc = await ctx.repo.weekCounts([fid], { thisStart: w.thisStart, thisEnd: w.thisEnd, lastStart: w.lastStart, lastEnd: w.lastEnd, mondayCutoff: cutoff }).catch(() => []);
    const mine = wc.filter((x) => x.fid === fid && (!owner.entry_type || x.type === owner.entry_type));
    bb = { this: mine.reduce((n, x) => n + x.thisWeek, 0), last: mine.reduce((n, x) => n + x.lastWeek, 0), lastByMon3: mine.reduce((n, x) => n + x.lastByMon3, 0) };
  }
  const partners: Record<string, any> = {};
  for (const h of hits) partners[h.cid] = { n: h.name, loc: h.place, lk: h.lookup, hold: h.holders, dec: h.deceased ? 1 : 0 };
  return {
    ok: true,
    owners: owners.map((o) => ({ fid: String(o.bb_fundraiser_id), name: o.name, type: o.entry_type || 'RDD Action', tab: o.sheet_tab || '', ...counts(String(o.bb_fundraiser_id)) })),
    owner: fid,
    deadline: { iso: w.deadline, label: w.deadlineLabel, from: w.thisStart, to: w.thisEnd },
    week: owner ? counts(fid) : null,
    bb,
    rows: rows.map((r) => shapeSub(r, parts)),
    partners,
  };
}

/** The ET calendar day's 3:00 PM, as the UTC timestamp string the mirror stores dates added under. */
function etCutoff(lastEnd: string): string {
  // Monday after lastEnd at 15:00 Eastern; the mirror stores UTC-less local stamps, so a string compare on the Eastern clock is right.
  return `${addDays(lastEnd, 1)}T15:00:00`;
}

/* ------------------------------------------------------------------ paste */

export async function entryPaste(ctx: Ctx, ownerFid: string, text: string) {
  const { rows: sheet, unread } = parseSheetText(String(text || '').slice(0, 200000));
  if (!sheet.length) return { ok: true, added: [], skipped: 0, unread, message: 'No rows found. Copy whole rows from the sheet.' };
  if (sheet.length > 400) throw new HttpError(400, 'too_many', 'Paste 400 rows or fewer at a time.');
  return entryIngest(ctx, ownerFid, sheet, unread, 'paste');
}

/** Rows read from an owner's tracking sheet tabs, whether pasted or read by the hub. Each is matched, checked against Blackbaud and saved once. */
export async function entryIngest(ctx: Ctx, ownerFid: string, sheet: SheetRow[], unread: number, source: 'paste' | 'sheet') {
  const owner = await ownerOf(ctx.env, ownerFid);
  const today = todayEt();
  const prepared = sheet.map((r) => {
    const date = toIso(r.date, today) || today;
    return { r, date, ref: pasteRef(ownerFid, r, date) };
  });
  const have = new Set<string>();
  for (let i = 0; i < prepared.length; i += 80) {
    const part = prepared.slice(i, i + 80);
    const found = await ctx.env.DB.prepare(`SELECT sheet_ref FROM act_submissions WHERE sheet_ref IN (${part.map(() => '?').join(',')})`).bind(...part.map((p) => p.ref)).all<{ sheet_ref: string }>();
    found.results.forEach((x) => have.add(x.sheet_ref));
  }
  // One read takes at most 400 new rows; the next read takes the rest.
  const unseen = prepared.filter((p, i) => !have.has(p.ref) && prepared.findIndex((q) => q.ref === p.ref) === i);
  const fresh = unseen.slice(0, 400);
  const skipped = prepared.length - unseen.length;
  if (!fresh.length) return { ok: true, added: [], skipped, unread };
  const lk = await ctx.repo.lookups(fresh.map((f) => ({ email: f.r.email, phone: f.r.phone, name: f.r.name })), ownerFid);
  const minDate = fresh.map((f) => f.date).sort()[0];
  const done: DoneAction[] = await ctx.repo.doneActions(addDays(minDate, -2), [ownerFid]).catch(() => []);
  const stmts: D1PreparedStatement[] = [];
  const added: string[] = [];
  for (const f of fresh) {
    const m = resolvePartner({ email: f.r.email, phone: f.r.phone, name: f.r.name }, ownerFid, lk);
    // A match on name alone is a guess (two partners can share a name), so the person confirms it with a click. Email, phone and a name inside the owner's own portfolio are enough.
    const cid = m.hits.length === 1 && m.how !== 'many' && m.how !== 'name' ? m.hits[0] : null;
    const ch = channelOf(f.r.act, f.r.notes);
    const dup = cid ? findDuplicate(cid, ownerFid, f.date, done) : null;
    const notes = f.r.notes.replace(/\s+/g, ' ').trim();
    const raw = {
      name: f.r.name, org: f.r.name.includes(' - ') ? f.r.name.split(' - ').slice(1).join(' - ') : '', isNew: f.r.isNew, act: f.r.act, notes, ticked: f.r.ticked, email: !!f.r.email, phone: !!f.r.phone,
      cands: m.hits.length > 1 || m.how === 'many' || m.how === 'name' ? m.hits : [], dup: dup ? { id: dup.id, added: (dup.added || '').slice(0, 10), cat: dup.category || '', same: dup.due.slice(0, 10) === f.date } : null,
    };
    const id = newId('wcs');
    added.push(id);
    const state = dup || f.r.ticked ? 'in_blackbaud' : 'waiting';
    stmts.push(
      ctx.env.DB.prepare(
        `INSERT INTO act_submissions (id, owner_fid, source, sheet_ref, contact_date, raw, constituent_id, match_how, channel, summary, description, tags, ask_amount, state, dup_action_id, created_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(id, ownerFid, source, f.ref, f.date, JSON.stringify(raw), cid, m.how === 'many' ? 'name' : m.how, ch || null, shortSummary(notes, ch).slice(0, 255), notes.slice(0, 2000), JSON.stringify(tagsOf(notes, f.r.act, ch)), askOf(f.r.ask, notes), state, dup ? dup.id : null, nowIso(), ctx.actor)
    );
  }
  for (let i = 0; i < stmts.length; i += 40) await ctx.env.DB.batch(stmts.slice(i, i + 40));
  await logEvent(ctx.env, { actor: ctx.actor, actor_email: ctx.email, kind: source === 'sheet' ? 'entry_sheet' : 'entry_paste', detail: `${added.length} rows for ${owner.name}, ${skipped} skipped` });
  void addMeter;
  return { ok: true, added, skipped, unread };
}

/* ------------------------------------------------------------------ one row */

export async function entryPatch(ctx: Ctx, id: string, body: Record<string, unknown>) {
  const row = await ctx.env.DB.prepare('SELECT * FROM act_submissions WHERE id = ? LIMIT 1').bind(id).first<SubRow>();
  if (!row) throw new HttpError(404, 'not_found', 'That row is not here.');
  if (row.state === 'posted' || row.state === 'posting') throw new HttpError(409, 'locked', 'That contact is already in Blackbaud.');
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    vals.push(v);
  };
  let cid = row.constituent_id;
  let date = row.contact_date;
  let recheck = false;
  if (body.constituent_id !== undefined) {
    const v = body.constituent_id === null || body.constituent_id === '' ? null : String(body.constituent_id);
    if (v) {
      const hit = await ctx.repo.partnersByIds([v]);
      if (!hit.length) throw new HttpError(400, 'bad_partner', 'That partner is not in Blackbaud.');
    }
    cid = v;
    set('constituent_id', v);
    set('match_how', v ? 'picked' : 'none');
    recheck = true;
  }
  if (body.contact_date !== undefined) {
    date = validDate(body.contact_date, 'the date of the contact');
    set('contact_date', date);
    recheck = true;
  }
  if (body.channel !== undefined) {
    const c = String(body.channel || '');
    if (c && !HOWS[c]) throw new HttpError(400, 'bad_how', 'Pick how it went out from the list.');
    set('channel', c || null);
  }
  if (body.summary !== undefined) set('summary', String(body.summary || '').trim().slice(0, 255));
  if (body.tags !== undefined) set('tags', JSON.stringify((Array.isArray(body.tags) ? body.tags : []).map(String).filter((t) => TAGS[t])));
  if (body.ask_amount !== undefined) {
    const n = body.ask_amount === '' || body.ask_amount === null ? null : Number(String(body.ask_amount).replace(/[$,\s]/g, ''));
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 1000000)) throw new HttpError(400, 'bad_ask', 'The ask must be a number, zero or more.');
    set('ask_amount', n);
  }
  if (body.skip !== undefined) set('state', body.skip ? 'skipped' : row.state === 'skipped' ? 'waiting' : row.state);
  const raw = j(row.raw, {});
  if (recheck && cid) {
    const done = await ctx.repo.doneActions(addDays(date, -2), [row.owner_fid]).catch(() => []);
    const dup = findDuplicate(cid, row.owner_fid, date, done);
    raw.dup = dup ? { id: dup.id, added: (dup.added || '').slice(0, 10), cat: dup.category || '', same: dup.due.slice(0, 10) === date } : null;
    set('raw', JSON.stringify(raw));
    set('dup_action_id', dup ? dup.id : null);
    if (body.skip === undefined) set('state', dup ? 'in_blackbaud' : row.state === 'in_blackbaud' && !raw.ticked ? 'waiting' : row.state);
  }
  if (sets.length) await ctx.env.DB.prepare(`UPDATE act_submissions SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  const fresh = (await ctx.env.DB.prepare('SELECT * FROM act_submissions WHERE id = ?').bind(id).first<SubRow>())!;
  const hits = await ctx.repo.partnersByIds([fresh.constituent_id, ...(j(fresh.raw, {}).cands || [])].filter(Boolean) as string[]).catch(() => []);
  return { ok: true, row: shapeSub(fresh, new Map(hits.map((h) => [h.cid, h]))), partners: Object.fromEntries(hits.map((h) => [h.cid, { n: h.name, loc: h.place, lk: h.lookup, hold: h.holders, dec: h.deceased ? 1 : 0 }])) };
}

/* ------------------------------------------------------------------ sending rows */

export async function entryPost(ctx: Ctx, submissionIds: string[], req?: string) {
  const again = await batchByReq(ctx.env, req);
  if (again) return { ok: true, batch: again.batch, notReady: [] as string[], items: again.items };
  const ids = [...new Set(submissionIds.map(String))].slice(0, 500);
  if (!ids.length) throw new HttpError(400, 'nothing_to_do', 'Pick rows that are ready.');
  const rows: SubRow[] = [];
  for (let i = 0; i < ids.length; i += 80) {
    const part = ids.slice(i, i + 80);
    rows.push(...(await ctx.env.DB.prepare(`SELECT * FROM act_submissions WHERE id IN (${part.map(() => '?').join(',')})`).bind(...part).all<SubRow>()).results);
  }
  const staff = await entryOwners(ctx.env);
  const items: PlannedItem[] = [];
  const notReady: string[] = [];
  const parts = new Map((await ctx.repo.partnersByIds([...new Set(rows.map((r) => r.constituent_id).filter(Boolean) as string[])])).map((h) => [h.cid, h]));
  for (const r of rows) {
    const owner = staff.find((s) => String(s.bb_fundraiser_id) === r.owner_fid);
    const ready = (r.state === 'waiting' || r.state === 'failed') && r.constituent_id && r.channel && (r.summary || '').trim() && owner && parts.has(r.constituent_id) && !parts.get(r.constituent_id)!.deceased;
    if (!ready) {
      notReady.push(r.id);
      continue;
    }
    const tags = entryTags(r.channel!, j(r.tags, []));
    const date = r.contact_date;
    const create = entryBody({ cid: r.constituent_id!, date, channel: r.channel!, summary: r.summary!, description: r.description, owner: r.owner_fid, ownerType: owner!.entry_type || 'RDD Action' });
    const steps: Step[] = [{ op: 'create', body: create, label: 'entry' }];
    for (const t of tags) steps.push({ op: 'tag', dep: 0, body: { category: TAGS[t], date: `${date}T00:00:00` }, label: 'tag ' + t });
    if (r.ask_amount) steps.push({ op: 'tag', dep: 0, body: { category: 'Amount of Ask', value: String(r.ask_amount), date: `${date}T00:00:00` }, label: 'ask' });
    const p = parts.get(r.constituent_id!)!;
    items.push({ submissionId: r.id, cid: r.constituent_id!, label: `${p.name} | ${r.summary}`, steps });
  }
  if (!items.length) throw new HttpError(400, 'nothing_to_do', 'None of those rows are ready to enter.');
  const batch = await saveBatch(ctx, 'create', items, { owner: items.length ? rows[0].owner_fid : '' }, { reqId: req });
  if (batch.id) {
    const ph = items.map(() => '?').join(',');
    await ctx.env.DB.prepare(`UPDATE act_submissions SET state = 'posting' WHERE id IN (${ph}) AND state <> 'posted'`).bind(...items.map((i) => i.submissionId)).run();
  }
  return { ok: true, batch, notReady, items: items.map((i) => ({ id: i.submissionId, state: 'queued' })) };
}

export interface ManyInput {
  owner: string;
  date: string;
  channel: string;
  summary: string;
  tags: string[];
  constituent_ids: string[];
  req?: string;
}

export async function entryMany(ctx: Ctx, input: ManyInput) {
  const owner = await ownerOf(ctx.env, String(input.owner));
  const date = validDate(input.date, 'the date of the contact');
  if (!HOWS[input.channel]) throw new HttpError(400, 'bad_how', 'Pick how it went out.');
  const summary = String(input.summary || '').trim().slice(0, 255);
  if (!summary) throw new HttpError(400, 'missing_summary', 'Say what happened in one line.');
  const ids = [...new Set((input.constituent_ids || []).map(String))].slice(0, 250);
  if (!ids.length) throw new HttpError(400, 'nothing_to_do', 'Pick at least one partner.');
  const hits = await ctx.repo.partnersByIds(ids);
  const known = new Map(hits.map((h) => [h.cid, h]));
  const tags = (Array.isArray(input.tags) ? input.tags : []).map(String).filter((t) => TAGS[t]);
  const done = await ctx.repo.doneActions(addDays(date, -2), [String(input.owner)]).catch(() => []);
  const again = await batchByReq(ctx.env, input.req);
  if (again) return { ok: true, batch: again.batch, items: again.items, notReady: [] as string[], dups: 0, created: again.items.length, owner: owner.name };
  const created: string[] = [];
  const stmts: D1PreparedStatement[] = [];
  let dups = 0;
  // Every partner on this contact has a reference of its own (owner, day, way, summary, partner). A second press of the button finds the rows the first made
  // instead of making them again; rows still waiting or failed go out, rows already in Blackbaud count as already entered.
  const sig = (await idemKey([summary])).slice(0, 12);
  const refOf = (cid: string) => `many:${input.owner}:${date}:${input.channel}:${sig}:${cid}`;
  const existing = new Map<string, { id: string; state: string }>();
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50).map(refOf);
    const r = await ctx.env.DB.prepare(`SELECT id, state, sheet_ref FROM act_submissions WHERE sheet_ref IN (${part.map(() => '?').join(',')})`).bind(...part).all<{ id: string; state: string; sheet_ref: string }>();
    r.results.forEach((x) => existing.set(x.sheet_ref, x));
  }
  for (const cid of ids) {
    if (!known.has(cid) || known.get(cid)!.deceased) continue;
    const had = existing.get(refOf(cid));
    if (had) {
      if (had.state === 'waiting' || had.state === 'failed') created.push(had.id);
      else dups++;
      continue;
    }
    if (findDuplicate(cid, String(input.owner), date, done)) {
      dups++;
      continue;
    }
    const id = newId('wcs');
    created.push(id);
    stmts.push(
      ctx.env.DB.prepare(
        `INSERT OR IGNORE INTO act_submissions (id, owner_fid, source, sheet_ref, contact_date, raw, constituent_id, match_how, channel, summary, tags, state, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(id, String(input.owner), 'many', refOf(cid), date, JSON.stringify({ name: known.get(cid)!.name, notes: 'Entered with One contact, many partners' }), cid, 'picked', input.channel, summary, JSON.stringify(tags), 'waiting', nowIso(), ctx.actor)
    );
  }
  for (let i = 0; i < stmts.length; i += 40) await ctx.env.DB.batch(stmts.slice(i, i + 40));
  if (!created.length) return { ok: true, batch: null, dups, created: 0, owner: owner.name };
  const posted = await entryPost(ctx, created, input.req);
  return { ...posted, dups, created: created.length, owner: owner.name };
}

export function household(picked: PartnerHit[], pool: PartnerHit[]) {
  return householdHints(picked.map((p) => ({ cid: p.cid, name: p.name, place: p.place })), pool.map((p) => ({ cid: p.cid, name: p.name, place: p.place })));
}

void CHUNK;
void getSetting;


/* ------------------------------------------------------------------ the hub reads the tracking sheet */

export const SHEET_GAP_MS = 10 * 60000;

/**
 * Read an owner's tracking sheet tabs (this month and last) and add the rows not seen before. Rows already here or in Blackbaud are skipped, so
 * reading the same sheet again adds nothing twice. A read within the last ten minutes is skipped unless `force` is set.
 */
export async function entrySheet(ctx: Ctx, ownerFid: string, opts: { force?: boolean } = {}) {
  const owner = await ownerOf(ctx.env, ownerFid);
  if (!owner.sheet_tab) return { ok: true, added: [], skipped: 0, unread: 0, read: 0, why: 'no_tab' };
  const key = `sheet:at:${ownerFid}`;
  const last = await getSetting(ctx.env, key, '');
  if (!opts.force && last && Date.now() - Date.parse(last) < SHEET_GAP_MS) return { ok: true, added: [], skipped: 0, unread: 0, read: 0, why: 'recent' };
  const sheetId = await getSetting(ctx.env, 'sheet:tracking', '');
  let tabs;
  try {
    tabs = await readOwnerTabs(ctx.env, sheetId, owner.sheet_tab, monthsBack(todayEt(), 1));
  } catch (err) {
    if (err instanceof SheetReadError) throw new HttpError(err.code === 'google' || err.code === 'token' ? 503 : 409, 'sheet_' + err.code, err.message);
    throw err;
  }
  await setSetting(ctx.env, key, nowIso());
  const rows: SheetRow[] = [];
  let unread = 0;
  for (const t of tabs) {
    const p = parseSheetText(t.text);
    rows.push(...p.rows);
    unread += p.unread;
  }
  if (!rows.length) return { ok: true, added: [], skipped: 0, unread, read: 0, tabs: tabs.map((t) => t.tab) };
  const out = await entryIngest(ctx, ownerFid, rows, unread, 'sheet');
  return { ...out, read: rows.length, tabs: tabs.map((t) => t.tab) };
}
