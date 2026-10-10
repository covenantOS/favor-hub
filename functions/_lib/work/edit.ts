// Full editing in the Work Center: one action's every field, many actions at once, new actions with follow-ups and repeats,
// duplicate, move to another partner, delete, notes, tags, attachments and opportunities. Each change is planned here into the
// same outbox the bulk operations use (saved first, sent 15 calls at a time, checked, undone for 24 hours).
//
// Reads come from the D1 mirror (no Blackbaud call). Notes, tag ids and attachments are not in the mirror; the panel asks for
// them when a person opens that tab (one Blackbaud call each, kept ten minutes).
import { HttpError, nowIso, type Env } from '../http';
import { mirror } from '../foundations/blackbaud';
import { readOnly } from './repo';
import { addMeter, getMeter, getSetting, listStaff, setSetting } from './db';
import { DAILY_CAP } from '../actions/batch';
import type { Step } from '../actions/completion';
import {
  FALLBACK_CODES, checkFields, checkOpp, checkRecur, conflicts, copyBody, defaultsFor, nextDue, oppValuesOf, oppView, recurAfter, stamp, valuesOf,
  type Codes, type OppView, type Recur,
} from '../actions/fields';
import type { Ctx, PlannedItem } from './service';

const ID = /^\d{1,12}$/;
/** Attachment ids are GUIDs in Blackbaud. */
const ATT_ID = /^[A-Za-z0-9-]{1,40}$/;
const q = <T = Record<string, any>>(env: Env, sql: string, params: unknown[] = []) => mirror<T>(env, readOnly(sql), params);
const parse = (s: unknown): any => {
  try {
    return typeof s === 'string' ? JSON.parse(s) : s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
};
const todayEt = (): string => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/* ------------------------------------------------------------------ code tables */

const CODES_KEY = 'codes:v2';
const CODES_DAYS = 7;

/**
 * Action types, statuses, locations, note types, tag categories with their values, and opportunity statuses and purposes.
 * Read from Blackbaud at most once a week (about 14 calls) and kept in the hub database; the mirror's own values fill any gap.
 */
export async function getCodes(ctx: Ctx, opts: { force?: boolean } = {}): Promise<Codes & { at: string; source: string }> {
  const cached = await getSetting(ctx.env, CODES_KEY, '');
  const c = cached ? parse(cached) : null;
  const fresh = c && c.at && Date.now() - Date.parse(c.at) < CODES_DAYS * 86400000;
  if (c && fresh && !opts.force) return c;
  const meter = await getMeter(ctx.env).catch(() => ({ used: 0 }));
  if (meter.used > DAILY_CAP - 300) return c || { ...FALLBACK_CODES, at: '', source: 'fallback' };
  const paths = [
    '/constituent/v1/actiontypes', '/constituent/v1/actionstatustypes', '/constituent/v1/actionlocations', '/constituent/v1/actions/customfields/categories/details',
    '/nxt-data-integration/v1/re/codetables/5101/tableentries?limit=100', '/opportunity/v1/opportunitystatuses', '/opportunity/v1/opportunitypurposes',
  ];
  const r = await ctx.repo.send(paths.map((path) => ({ method: 'GET', path })));
  await addMeter(ctx.env, r.results.length, r.callsToday);
  const list = (i: number): string[] | null => {
    const x = r.results[i];
    // Action note types live in the Action Notepad Types code table (5101); its entries carry long_description and is_active.
    const v = x && x.ok && x.body && Array.isArray(x.body.value)
      ? x.body.value.filter((v: any) => typeof v === 'string' || v.is_active !== false).map((v: any) => (typeof v === 'string' ? v : String(v.long_description ?? v.name ?? v)))
      : null;
    return v && v.length ? v : null;
  };
  const cats = r.results[3] && r.results[3].ok && Array.isArray(r.results[3].body?.value) && r.results[3].body.value.length ? r.results[3].body.value : null;
  if (!list(0) && !cats) return c || { ...FALLBACK_CODES, at: '', source: 'fallback' };
  const tagCategories: Codes['tagCategories'] = (cats || FALLBACK_CODES.tagCategories).map((x: any) => ({ name: String(x.name), type: String(x.type || 'Text'), codeTable: x.code_table_id ? String(x.code_table_id) : undefined }));
  // The values of each code-table tag (Thanked, Scheduling ...), one call each, 15 to a request.
  const withTable = tagCategories.filter((t) => t.type === 'CodeTableEntry');
  for (let i = 0; i < withTable.length; i += 15) {
    const part = withTable.slice(i, i + 15);
    const v = await ctx.repo.send(part.map((t) => ({ method: 'GET', path: `/constituent/v1/actions/customfields/categories/values?category_name=${encodeURIComponent(t.name)}` })));
    await addMeter(ctx.env, v.results.length, v.callsToday);
    part.forEach((t, k) => {
      const x = v.results[k];
      if (x && x.ok && Array.isArray(x.body?.value)) t.values = x.body.value.map(String);
    });
  }
  // Purposes Blackbaud lists as active, plus the ones already on Favor's opportunities, so an existing value always shows.
  const mirrorPurposes = await q<{ p: string }>(ctx.env, 'SELECT DISTINCT purpose AS p FROM opportunities WHERE purpose IS NOT NULL').catch(() => []);
  const out: Codes & { at: string; source: string } = {
    types: list(0) || FALLBACK_CODES.types,
    statuses: list(1) || FALLBACK_CODES.statuses,
    locations: list(2) || FALLBACK_CODES.locations,
    tagCategories,
    noteTypes: list(4) || FALLBACK_CODES.noteTypes,
    oppStatuses: list(5) || FALLBACK_CODES.oppStatuses,
    oppPurposes: [...new Set([...(list(6) || []), ...mirrorPurposes.map((x) => x.p)])].filter(Boolean),
    at: nowIso(),
    source: 'blackbaud',
  };
  if (!out.oppPurposes.length) out.oppPurposes = FALLBACK_CODES.oppPurposes;
  await setSetting(ctx.env, CODES_KEY, JSON.stringify(out));
  return out;
}

/* ------------------------------------------------------------------ one action, as Blackbaud holds it */

export interface ActionRaw {
  id: string;
  constituent_id: string;
  [k: string]: any;
}

/** The mirror's copy of one action (every field Blackbaud returned), with its tags row and the time the sync wrote it. */
export async function actionRaw(env: Env, id: string): Promise<{ raw: ActionRaw; synced: string; tags: Record<string, any> | null } | null> {
  if (!ID.test(id)) return null;
  const rows = await q<{ raw: string; synced: string; tags: string | null }>(
    env,
    `SELECT a.raw_json AS raw, a.synced_at AS synced, t.raw_json AS tags FROM actions a LEFT JOIN action_tags t ON t.id = a.id WHERE a.id = ?1 LIMIT 1`,
    [id]
  );
  if (!rows.length) return null;
  const raw = parse(rows[0].raw);
  if (!raw.id) raw.id = id;
  return { raw, synced: rows[0].synced, tags: rows[0].tags ? parse(rows[0].tags) : null };
}

/** Changes the hub has saved for one action that the mirror does not show yet, laid over its copy. */
export async function pendingFor(env: Env, id: string, syncedAt: string): Promise<{ body: Record<string, unknown>; state: string; deleted: boolean }> {
  const r = await env.DB.prepare(
    `SELECT o.payload, o.state, o.op, o.queued_at FROM act_outbox o JOIN act_batches b ON b.id = o.batch_id
      WHERE o.action_id = ? AND o.op IN ('patch', 'delete') AND o.state IN ('queued', 'sent', 'verified') AND b.state <> 'undone' AND b.op <> 'undo'
      ORDER BY o.queued_at`
  )
    .bind(id)
    .all<{ payload: string; state: string; op: string; queued_at: string }>()
    .catch(() => ({ results: [] as { payload: string; state: string; op: string; queued_at: string }[] }));
  const body: Record<string, unknown> = {};
  let state = '';
  let deleted = false;
  const since = Date.parse(String(syncedAt || '').replace(' ', 'T') + (String(syncedAt || '').includes('Z') ? '' : 'Z'));
  for (const p of r.results) {
    if (!Number.isNaN(since) && Date.parse(p.queued_at) < since - 30 * 60000) continue;
    if (p.op === 'delete') deleted = true;
    const b = parse(p.payload);
    for (const [k, v] of Object.entries(b)) if (!k.startsWith('__')) body[k] = v;
    state = p.state === 'queued' ? 'saving' : 'saved';
  }
  return { body, state, deleted };
}

/** Tag values the mirror holds on an action, as { category: value }. The mirror keeps the common ones as columns. */
function tagsFromMirror(t: Record<string, any> | null): { category: string; value: string }[] {
  if (!t) return [];
  const list = Array.isArray(t) ? t : Array.isArray(t.value) ? t.value : Array.isArray(t.customfields) ? t.customfields : null;
  if (list) return list.map((x: any) => ({ category: String(x.category), value: String(x.value ?? '') }));
  return Object.entries(t)
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== 0)
    .map(([k, v]) => ({ category: k, value: String(v) }));
}

export async function actionDetail(ctx: Ctx, id: string) {
  const got = await actionRaw(ctx.env, id);
  if (!got) throw new HttpError(404, 'not_found', 'That action is not in the hub’s copy of Blackbaud yet. If it was added in the last few minutes, try again shortly.');
  const pend = await pendingFor(ctx.env, id, got.synced);
  const view = { ...got.raw, ...pend.body };
  const partner = await partnerContext(ctx, String(got.raw.constituent_id));
  const recur = await ctx.env.DB.prepare('SELECT rule FROM act_recur WHERE action_id = ? AND active = 1 LIMIT 1').bind(id).first<{ rule: string }>().catch(() => null);
  return {
    action: {
      id: String(view.id),
      cid: String(view.constituent_id),
      summary: view.summary || '',
      description: view.description || '',
      category: view.category || '',
      type: view.type || '',
      status: view.status || (view.completed ? 'Completed' : 'Open'),
      date: String(view.date || '').slice(0, 10),
      start_time: view.start_time || '',
      end_time: view.end_time || '',
      completed: Boolean(view.completed),
      completed_date: view.completed_date ? String(view.completed_date).slice(0, 10) : '',
      priority: view.priority || 'Normal',
      direction: view.direction || '',
      location: view.location || '',
      outcome: view.outcome || '',
      fundraisers: Array.isArray(view.fundraisers) ? view.fundraisers.map(String) : [],
      opportunity_id: view.opportunity_id ? String(view.opportunity_id) : '',
      added: String(got.raw.date_added || '').slice(0, 19),
      modified: String(got.raw.date_modified || ''),
      author: got.raw.author || '',
      tags: tagsFromMirror(got.tags),
      pending: pend.state,
      deleted: pend.deleted,
      recur: recur ? parse(recur.rule) : null,
    },
    partner,
  };
}

/* ------------------------------------------------------------------ the partner beside the edit panel */

/**
 * What the edit panel itself needs about the partner: the name, current holders (the default fundraiser of a new action) and
 * opportunities (the linked-opportunity list). Everything else beside the panel is the partner page's own view
 * (GET /api/work/partners/:id, mounted compact on the page), so the two never disagree.
 */
export async function partnerContext(ctx: Ctx, cid: string) {
  if (!ID.test(cid)) throw new HttpError(400, 'bad_partner', 'That is not a partner record.');
  const env = ctx.env;
  const today = todayEt();
  const [name, holders, opps] = await Promise.all([
    partnerName(env, cid),
    q<any>(env, `SELECT assignment_fundraiser_id AS fid, assignment_type AS type FROM assignments
        WHERE constituent_record_id = ?1 AND (assignment_to_date IS NULL OR substr(assignment_to_date, 1, 10) >= ?2)`, [cid, today]).catch(() => []),
    oppsFor(ctx, [cid]).catch(() => [] as OppView[]),
  ]);
  return { cid, name: name || '(no name)', holders: holders.map((h: any) => ({ fid: String(h.fid), type: h.type || '' })), opps };
}

const parseArr = (s: unknown): string[] => {
  const v = parse(s);
  return Array.isArray(v) ? v.map(String) : [];
};

/* ------------------------------------------------------------------ opportunities */

/**
 * Opportunities from the mirror, with the hub's own writes laid over them until the mirror's copy is as new (the mirror reads
 * opportunities on its own schedule, so a change made here would otherwise vanish for hours).
 */
export async function oppsFor(ctx: Ctx, cids: string[] | null, opts: { fr?: string; limit?: number } = {}): Promise<OppView[]> {
  const env = ctx.env;
  const limit = Math.min(opts.limit || 600, 1500);
  const rows = cids
    ? await q<{ raw: string }>(env, `SELECT raw_json AS raw FROM opportunities WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) ORDER BY date_modified DESC LIMIT ${limit}`, [JSON.stringify(cids)])
    : await q<{ raw: string }>(env, `SELECT raw_json AS raw FROM opportunities ORDER BY date_modified DESC LIMIT ${limit}`);
  const byId = new Map<string, OppView>();
  for (const r of rows) {
    const v = oppView(parse(r.raw));
    if (v.id) byId.set(v.id, v);
  }
  const shadow = await env.DB.prepare(cids ? `SELECT id, raw, at FROM act_opps WHERE cid IN (SELECT value FROM json_each(?))` : 'SELECT id, raw, at FROM act_opps')
    .bind(...(cids ? [JSON.stringify(cids)] : []))
    .all<{ id: string; raw: string; at: string }>()
    .catch(() => ({ results: [] as { id: string; raw: string; at: string }[] }));
  for (const s of shadow.results) {
    const mine = oppView(parse(s.raw));
    const theirs = byId.get(s.id);
    if (!theirs || !theirs.modified || Date.parse(theirs.modified) < Date.parse(s.at) - 60000) byId.set(s.id, { ...(theirs || {}), ...mine, modified: s.at } as OppView);
  }
  let list = [...byId.values()];
  if (opts.fr) list = list.filter((o) => o.fundraisers.includes(opts.fr as string));
  return list.sort((a, b) => (a.inactive === b.inactive ? (b.modified > a.modified ? 1 : -1) : a.inactive ? 1 : -1));
}

/** The opportunity's current values (mirror plus shadow), for Undo and for checking it exists. */
export async function oppRaw(ctx: Ctx, id: string): Promise<Record<string, any> | null> {
  const s = await ctx.env.DB.prepare('SELECT raw, at FROM act_opps WHERE id = ? LIMIT 1').bind(id).first<{ raw: string; at: string }>().catch(() => null);
  const m = await q<{ raw: string }>(ctx.env, 'SELECT raw_json AS raw FROM opportunities WHERE id = ?1 LIMIT 1', [id]).catch(() => []);
  const mr = m[0] ? parse(m[0].raw) : null;
  if (s && (!mr || !mr.date_modified || Date.parse(mr.date_modified) < Date.parse(s.at) - 60000)) return { ...(mr || {}), ...parse(s.raw) };
  return mr;
}

/** After an opportunity write is sent, the hub keeps its own copy until the mirror catches up. */
export async function shadowOpp(env: Env, id: string, cid: string, body: Record<string, unknown>, base: Record<string, any> | null): Promise<void> {
  const raw = { ...(base || {}), ...body, id, constituent_id: cid, date_modified: nowIso() };
  await env.DB.prepare(
    `INSERT INTO act_opps (id, cid, raw, at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET raw = excluded.raw, cid = excluded.cid, at = excluded.at`
  )
    .bind(id, cid, JSON.stringify(raw), nowIso())
    .run();
}

/* ------------------------------------------------------------------ planning the new kinds of change */

export interface EditInput {
  op: string;
  ids?: string[];
  set?: Record<string, unknown>;
  seen?: Record<string, unknown>;
  line?: string;
  tags?: { add?: { category: string; value?: unknown; comment?: string }[]; remove?: { id: string; category?: string }[]; change?: { id: string; value: unknown }[] };
  note?: { id?: string; type?: string; summary?: string; text?: string; date?: string; remove?: boolean };
  attach?: { id?: string; name?: string; url?: string; remove?: boolean; file_id?: string; file_name?: string };
  cids?: string[];
  to?: string;
  next?: Record<string, unknown> | null;
  recur?: unknown;
  complete?: Record<string, unknown>;
  opp?: Record<string, unknown>;
  opp_id?: string;
  cid?: string;
}

const labelFor = (partner: string, what: string) => `${partner || 'Partner'} | ${what || 'Action'}`;

async function partnerName(env: Env, cid: string): Promise<string> {
  const r = await q<any>(env, 'SELECT constituent_type AS t, first_name AS f, last_name AS l, preferred_name AS p, organization_name AS o, deceased AS d FROM constituents WHERE id = ?1 LIMIT 1', [cid]).catch(() => []);
  const w = r[0];
  if (!w) return '';
  return w.t === 'Organization' ? w.o || '' : `${w.p || w.f || ''} ${w.l || ''}`.trim();
}

/** Read the current action from Blackbaud (1 call): the exact values Undo puts back, and the check that nobody changed it meanwhile. */
async function liveAction(ctx: Ctx, id: string): Promise<Record<string, any>> {
  const r = await ctx.repo.send([{ method: 'GET', path: `/constituent/v1/actions/${id}` }]);
  await addMeter(ctx.env, r.results.length, r.callsToday);
  const x = r.results[0];
  if (!x) throw new HttpError(503, 'blackbaud_wait', `${r.wait || 'Blackbaud did not answer.'} Nothing was changed. Try again in a minute.`);
  if (x.refused) throw new HttpError(503, 'not_allowed', 'The Blackbaud connection does not allow this yet.');
  if (x.status === 404) throw new HttpError(404, 'gone', 'Blackbaud no longer has this action. Someone may have deleted it.');
  if (!x.ok || !x.body) throw new HttpError(503, 'blackbaud_wait', 'Blackbaud did not answer, so nothing was changed. Try again in a minute.');
  return x.body;
}

/** Mirror rows for many actions at once (bulk edit), each with the raw fields Undo needs. */
async function rawMany(env: Env, ids: string[]): Promise<Map<string, Record<string, any>>> {
  const out = new Map<string, Record<string, any>>();
  for (let i = 0; i < ids.length; i += 400) {
    const part = ids.slice(i, i + 400);
    const rows = await q<{ id: string; raw: string; mod: string; partner: string }>(
      env,
      `SELECT a.id AS id, a.raw_json AS raw, a.date_modified AS mod, COALESCE(json_extract(c.raw_json, '$.name'), trim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))) AS partner
         FROM actions a LEFT JOIN constituents c ON c.id = a.constituent_record_id WHERE a.id IN (SELECT value FROM json_each(?1))`,
      [JSON.stringify(part)]
    );
    for (const r of rows) out.set(String(r.id), { ...parse(r.raw), __mod: r.mod, __partner: r.partner });
  }
  return out;
}

export interface PlanOut {
  items: PlannedItem[];
  params: Record<string, unknown>;
  reads: number;
  skipped: number;
  changed: number;
  conflict?: { fields: string[]; current: Record<string, unknown> };
}

function tagSteps(actionId: string | undefined, dep: number | undefined, input: EditInput['tags'], today: string, codes: Codes): Step[] {
  const steps: Step[] = [];
  if (!input) return steps;
  const known = new Map(codes.tagCategories.map((c) => [c.name.toLowerCase(), c]));
  for (const t of input.add || []) {
    const cat = known.get(String(t.category || '').toLowerCase());
    if (!cat) throw new HttpError(400, 'bad_tag', `There is no tag called ${String(t.category || '').slice(0, 40)}.`);
    let value: unknown = t.value;
    if (cat.type === 'Number') {
      value = Number(String(t.value ?? '').replace(/[$,\s]/g, ''));
      if (!Number.isFinite(value as number)) throw new HttpError(400, 'bad_tag', `${cat.name} needs a number.`);
    } else if (cat.type === 'CodeTableEntry') {
      const list = cat.values || [];
      const v = String(t.value ?? '').trim();
      value = list.find((x) => x.toLowerCase() === v.toLowerCase()) || (list.find((x) => x.toLowerCase() === cat.name.toLowerCase()) ?? list[0] ?? (v || cat.name));
    } else if (cat.type === 'Boolean') value = t.value === true || t.value === 'true' || t.value === 'Yes';
    else value = String(t.value ?? '').slice(0, 255);
    const body: Record<string, unknown> = { category: cat.name, value, date: stamp(today) };
    if (t.comment) body.comment = String(t.comment).slice(0, 50);
    steps.push(dep !== undefined ? { op: 'tag', dep, body, label: 'tag ' + cat.name } : { op: 'tag', actionId, body, label: 'tag ' + cat.name });
  }
  for (const t of input.change || []) {
    if (!ID.test(String(t.id)) || !actionId) continue;
    steps.push({ op: 'call' as any, actionId, body: { __call: { method: 'PATCH', path: `/constituent/v1/actions/customfields/${t.id}` }, value: t.value }, label: 'tag change' });
  }
  for (const t of input.remove || []) {
    if (!ID.test(String(t.id)) || !actionId) continue;
    steps.push({ op: 'call' as any, actionId, body: { __call: { method: 'DELETE', path: `/constituent/v1/actions/customfields/${t.id}?action=${actionId}` }, __tag: t.category || '' }, label: 'tag remove' });
  }
  return steps;
}

/**
 * Plan one of the new operations. The service saves what this returns as a batch and sends it like any other.
 * Every write carries what it replaces, so Undo can put it back.
 */
export async function planEdit(ctx: Ctx, input: EditInput, board: { today: string; synced: string }): Promise<PlanOut> {
  const today = board.today;
  const codes = await getCodes(ctx).catch(() => ({ ...FALLBACK_CODES, at: '', source: 'fallback' }));
  const params: Record<string, unknown> = { op: input.op };
  const items: PlannedItem[] = [];
  let reads = 0;
  const ids = [...new Set((input.ids || []).map(String).filter((x) => ID.test(x)))];

  if (input.op === 'edit') {
    // One action, any field: read it live, stop on a real conflict, keep the exact old values for Undo.
    if (ids.length !== 1) throw new HttpError(400, 'one_only', 'Edit one action at a time here, or use Edit selected for many.');
    const id = ids[0];
    const { body, errors } = checkFields(input.set || {}, codes, today);
    if (errors.length) throw new HttpError(400, 'bad_field', errors[0]);
    const current = await liveAction(ctx, id);
    reads++;
    const clash = conflicts(current, input.seen || {}, body);
    if (clash.length) return { items: [], params, reads, skipped: 0, changed: 1, conflict: { fields: clash, current: valuesOf(current, clash) } };
    // Leave out what would not change.
    for (const k of Object.keys(body)) if (valuesOf(current, [k])[k] !== undefined && sameish(k, valuesOf(current, [k])[k], body[k])) delete body[k];
    if (input.line) {
      const line = String(input.line).replace(/\s+/g, ' ').trim().slice(0, 200);
      if (line) body.description = `${body.description !== undefined ? body.description : current.description || ''}${(body.description ?? current.description) ? '\n' : ''}${line} (${shortDay(today)}, ${ctx.actor})`;
    }
    const steps: Step[] = [];
    if (Object.keys(body).length) steps.push({ op: 'patch', actionId: id, body, before: valuesOf(current, Object.keys(body)), label: 'edit' });
    steps.push(...tagSteps(id, undefined, input.tags, today, codes));
    const recurOnly = input.recur !== undefined && (input.recur === null || !!checkRecur(input.recur));
    if (!steps.length && !recurOnly) throw new HttpError(400, 'nothing_to_do', 'Nothing changed.');
    const partner = await partnerName(ctx.env, String(current.constituent_id));
    if (steps.length) items.push({ actionId: id, cid: String(current.constituent_id), label: labelFor(partner, current.summary || current.type), steps });
    // A repeat set while editing: stored once the edit is sent (the action already exists).
    const r = input.recur === null ? 'off' : checkRecur(input.recur);
    if (r) params.recur = r;
    if (input.recur === null) params.recur = 'off';
    Object.assign(params, { fields: Object.keys(body) });
    return { items, params, reads, skipped: 0, changed: 0 };
  }

  if (input.op === 'bulk_edit') {
    if (!ids.length) throw new HttpError(400, 'nothing_to_do', 'Pick the actions to change.');
    if (ids.length > 2000) throw new HttpError(400, 'too_many', 'Pick 2,000 actions or fewer at a time.');
    const { body, errors } = checkFields(input.set || {}, codes, today);
    if (errors.length) throw new HttpError(400, 'bad_field', errors[0]);
    if (!Object.keys(body).length && !input.line && !(input.tags && (input.tags.add || []).length)) throw new HttpError(400, 'nothing_to_do', 'Pick a field to change.');
    const raws = await rawMany(ctx.env, ids);
    // One read finds actions changed in Blackbaud since the mirror's copy; those are left out and the person reloads.
    const seen = await changedSinceList(ctx, board.synced);
    reads++;
    let skipped = 0;
    let changed = 0;
    for (const id of ids) {
      const raw = raws.get(id);
      if (!raw) {
        skipped++;
        continue;
      }
      const bbMod = seen.get(id);
      if (bbMod && Date.parse(bbMod) > Date.parse(raw.__mod || '') + 1000) {
        changed++;
        continue;
      }
      const b: Record<string, unknown> = { ...body };
      for (const k of Object.keys(b)) if (sameish(k, valuesOf(raw, [k])[k], b[k])) delete b[k];
      if (input.line) {
        const line = String(input.line).replace(/\s+/g, ' ').trim().slice(0, 200);
        // Long descriptions may be cut in the mirror; those are left for one-at-a-time editing.
        if ((raw.description || '').length >= 2000) {
          changed++;
          continue;
        }
        if (line) b.description = `${raw.description || ''}${raw.description ? '\n' : ''}${line} (${shortDay(today)}, ${ctx.actor})`;
      }
      const steps: Step[] = [];
      if (Object.keys(b).length) steps.push({ op: 'patch', actionId: id, body: b, before: valuesOf(raw, Object.keys(b)), label: 'edit' });
      steps.push(...tagSteps(id, undefined, input.tags ? { add: input.tags.add } : undefined, today, codes));
      if (!steps.length) {
        skipped++;
        continue;
      }
      items.push({ actionId: id, cid: String(raw.constituent_id), label: labelFor(raw.__partner, raw.summary || raw.type), steps });
    }
    if (!items.length) throw new HttpError(409, 'nothing_to_do', changed ? 'Blackbaud has newer changes on those actions. Reload the list in a few minutes and try again.' : 'Nothing changes with these choices.');
    Object.assign(params, { fields: Object.keys(body), line: input.line || '' });
    return { items, params, reads, skipped, changed };
  }

  if (input.op === 'new') {
    // A new action on one partner or many, with tags, an optional follow-up after it and an optional repeat.
    const cids = [...new Set((input.cids || []).map(String).filter((x) => ID.test(x)))];
    if (!cids.length) throw new HttpError(400, 'no_partner', 'Pick the partner first.');
    if (cids.length > 200) throw new HttpError(400, 'too_many', 'Add to 200 partners or fewer at a time.');
    const { body, errors } = checkFields(input.set || {}, codes, today, { create: true });
    if (errors.length) throw new HttpError(400, 'bad_field', errors[0]);
    const recur = checkRecur(input.recur);
    const nextSet = input.next && typeof input.next === 'object' ? checkFields(input.next, codes, today, { create: true }) : null;
    if (nextSet && nextSet.errors.length) throw new HttpError(400, 'bad_field', 'Follow-up: ' + nextSet.errors[0]);
    for (const cid of cids) {
      const partner = await partnerName(ctx.env, cid);
      const create: Record<string, unknown> = { ...body, constituent_id: cid };
      if (recur) create.__recur = recur;
      const steps: Step[] = [{ op: 'create', body: create, label: 'new' }];
      steps.push(...tagSteps(undefined, 0, input.tags, today, codes));
      if (nextSet) {
        const nb: Record<string, unknown> = { ...nextSet.body, constituent_id: cid, completed: false };
        delete nb.completed_date;
        delete nb.outcome;
        nb.status = 'Open';
        steps.push({ op: 'create', body: nb, label: 'follow-up' });
      }
      items.push({ cid, label: labelFor(partner, String(body.summary || body.type || 'New action')), steps });
    }
    Object.assign(params, { n: cids.length, summary: body.summary || '', recur: recur || null, next: !!nextSet });
    return { items, params, reads, skipped: 0, changed: 0 };
  }

  if (input.op === 'complete_next') {
    // Complete this one and schedule the next: one PATCH, one new open action carrying the same partner and fundraisers.
    if (ids.length !== 1) throw new HttpError(400, 'one_only', 'Pick one action.');
    const id = ids[0];
    const current = await liveAction(ctx, id);
    reads++;
    if (current.completed) throw new HttpError(409, 'already_done', 'This action is already complete in Blackbaud. Reload it.');
    const done = checkFields({ completed: true, ...(input.complete || {}) }, codes, today);
    if (done.errors.length) throw new HttpError(400, 'bad_field', done.errors[0]);
    if (input.line) {
      const line = String(input.line).replace(/\s+/g, ' ').trim().slice(0, 200);
      if (line) done.body.description = `${current.description || ''}${current.description ? '\n' : ''}${line} (${shortDay(today)}, ${ctx.actor})`;
    }
    const tmpl = copyBody(current, String(current.constituent_id));
    const nextIn = { ...(input.next || {}) };
    const next = checkFields({ ...pickKeys(tmpl, ['category', 'type', 'summary', 'priority', 'location', 'direction', 'opportunity_id']), fundraisers: tmpl.fundraisers, ...nextIn, completed: false }, codes, today, { create: true });
    if (next.errors.length) throw new HttpError(400, 'bad_field', 'Next: ' + next.errors[0]);
    delete next.body.completed_date;
    next.body.status = 'Open';
    const nb: Record<string, unknown> = { ...next.body, constituent_id: String(current.constituent_id) };
    const r = checkRecur(input.recur);
    if (r) nb.__recur = r;
    const partner = await partnerName(ctx.env, String(current.constituent_id));
    const steps: Step[] = [
      { op: 'patch', actionId: id, body: done.body, before: valuesOf(current, Object.keys(done.body)), label: 'complete' },
      ...tagSteps(id, undefined, input.tags, today, codes),
      { op: 'create', body: nb, label: 'next' },
    ];
    items.push({ actionId: id, cid: String(current.constituent_id), label: labelFor(partner, current.summary || current.type), steps });
    Object.assign(params, { next: String(nb.date || '').slice(0, 10), summary: nb.summary || '' });
    return { items, params, reads, skipped: 0, changed: 0 };
  }

  if (input.op === 'duplicate' || input.op === 'move') {
    if (ids.length !== 1) throw new HttpError(400, 'one_only', 'Pick one action.');
    const id = ids[0];
    const current = await liveAction(ctx, id);
    reads++;
    const from = String(current.constituent_id);
    const targets = input.op === 'move' ? [String(input.to || '')] : [...new Set((input.cids && input.cids.length ? input.cids : [from]).map(String))];
    if (targets.some((x) => !ID.test(x))) throw new HttpError(400, 'no_partner', 'Pick the partner it goes to.');
    if (input.op === 'move' && targets[0] === from) throw new HttpError(400, 'same_partner', 'It is already on that partner.');
    if (targets.length > 200) throw new HttpError(400, 'too_many', 'Copy to 200 partners or fewer at a time.');
    const over = input.set ? checkFields(input.set, codes, today) : { body: {}, errors: [] as string[] };
    if (over.errors.length) throw new HttpError(400, 'bad_field', over.errors[0]);
    for (const cid of targets) {
      const partner = await partnerName(ctx.env, cid);
      if (!partner) throw new HttpError(404, 'no_partner', 'That partner is not in the hub’s copy of Blackbaud.');
      const body = { ...copyBody(current, cid), ...over.body, constituent_id: cid };
      const steps: Step[] = [{ op: 'create', body, label: input.op === 'move' ? 'move copy' : 'duplicate' }];
      if (input.op === 'move') {
        // The original goes only after the copy is in Blackbaud (dep), so a refused copy never loses the action.
        const original = copyBody(current, from);
        steps.push({ op: 'delete', actionId: id, body: {}, before: { __restore: original }, dep: 0, label: 'move remove' } as Step);
      }
      items.push({ actionId: input.op === 'move' ? id : undefined, cid, label: labelFor(partner, current.summary || current.type), steps });
    }
    Object.assign(params, { n: targets.length, to: input.op === 'move' ? targets[0] : undefined });
    return { items, params, reads, skipped: 0, changed: 0 };
  }

  if (input.op === 'delete') {
    if (!ids.length) throw new HttpError(400, 'nothing_to_do', 'Pick the actions to delete.');
    if (ids.length > 200) throw new HttpError(400, 'too_many', 'Delete 200 actions or fewer at a time.');
    const raws = await rawMany(ctx.env, ids);
    for (const id of ids) {
      const raw = raws.get(id);
      if (!raw) continue;
      // Undo puts a copy back (a new action with the same fields). Notes and attachments on it do not come back.
      items.push({ actionId: id, cid: String(raw.constituent_id), label: labelFor(raw.__partner, raw.summary || raw.type), steps: [{ op: 'delete', actionId: id, body: {}, before: { __restore: copyBody(raw, String(raw.constituent_id)) }, label: 'delete' }] });
    }
    if (!items.length) throw new HttpError(404, 'not_found', 'Those actions are not in the hub’s copy of Blackbaud.');
    Object.assign(params, { n: items.length });
    return { items, params, reads, skipped: ids.length - items.length, changed: 0 };
  }

  if (input.op === 'note') {
    if (ids.length !== 1) throw new HttpError(400, 'one_only', 'Pick one action.');
    const id = ids[0];
    const n = input.note || {};
    const got = await actionRaw(ctx.env, id);
    const cid = got ? String(got.raw.constituent_id) : '';
    const partner = cid ? await partnerName(ctx.env, cid) : '';
    const label = labelFor(partner, 'Note');
    if (n.remove) {
      if (!ID.test(String(n.id))) throw new HttpError(400, 'bad_note', 'Pick the note to remove.');
      const old = await noteById(ctx, id, String(n.id));
      reads++;
      const restore = old ? { parent_id: id, type: old.type, summary: old.summary, text: old.text, date: old.date } : null;
      items.push({ actionId: id, cid, label, steps: [{ op: 'call' as any, actionId: id, body: { __call: { method: 'DELETE', path: `/constituent/v1/actions/notes/${n.id}` } }, before: restore ? { __call: { method: 'POST', path: '/constituent/v1/actions/notes' }, ...restore } : undefined, label: 'note remove' }] });
    } else {
      const type = codes.noteTypes.find((t) => t.toLowerCase() === String(n.type || '').toLowerCase()) || codes.noteTypes[0] || 'Note (general)';
      const summary = String(n.summary || '').replace(/\s+/g, ' ').trim().slice(0, 255);
      const text = String(n.text || '').slice(0, 20000);
      if (!summary && !text) throw new HttpError(400, 'bad_note', 'Write the note first.');
      const day = /^\d{4}-\d{2}-\d{2}$/.test(String(n.date || '')) ? String(n.date) : today;
      const [y, m, d] = day.split('-').map(Number);
      const date = { y, m, d };
      if (n.id) {
        if (!ID.test(String(n.id))) throw new HttpError(400, 'bad_note', 'Pick the note to change.');
        const old = await noteById(ctx, id, String(n.id));
        reads++;
        items.push({ actionId: id, cid, label, steps: [{ op: 'call' as any, actionId: id, body: { __call: { method: 'PATCH', path: `/constituent/v1/actions/notes/${n.id}` }, type, summary, text, date }, before: old ? { __call: { method: 'PATCH', path: `/constituent/v1/actions/notes/${n.id}` }, type: old.type, summary: old.summary, text: old.text, date: old.date } : undefined, label: 'note change' }] });
      } else {
        items.push({ actionId: id, cid, label, steps: [{ op: 'call' as any, actionId: id, body: { __call: { method: 'POST', path: '/constituent/v1/actions/notes' }, parent_id: id, type, summary, text, date }, before: { __call: { method: 'DELETE', path: '/constituent/v1/actions/notes/{id}' } }, label: 'note add' }] });
      }
    }
    return { items, params, reads, skipped: 0, changed: 0 };
  }

  if (input.op === 'attach') {
    if (ids.length !== 1) throw new HttpError(400, 'one_only', 'Pick one action.');
    const id = ids[0];
    const a = input.attach || {};
    const got = await actionRaw(ctx.env, id);
    const cid = got ? String(got.raw.constituent_id) : '';
    const label = labelFor(cid ? await partnerName(ctx.env, cid) : '', 'Attachment');
    if (a.remove) {
      if (!ATT_ID.test(String(a.id))) throw new HttpError(400, 'bad_attach', 'Pick the attachment to remove.');
      const old = await attachmentById(ctx, id, String(a.id));
      reads++;
      const restore = old && old.type === 'Link' ? { __call: { method: 'POST', path: '/constituent/v1/actions/attachments' }, parent_id: id, name: old.name, type: 'Link', url: old.url, date: old.date } : undefined;
      items.push({ actionId: id, cid, label, steps: [{ op: 'call' as any, actionId: id, body: { __call: { method: 'DELETE', path: `/constituent/v1/actions/attachments/${a.id}` } }, before: restore, label: 'attachment remove' }] });
    } else if ((a as any).file_id) {
      // A file already put at Blackbaud's upload address (the upload route): attach it by its file id.
      const fileId = String((a as any).file_id).slice(0, 36);
      const fileName = String((a as any).file_name || a.name || 'file').slice(0, 150);
      const name = String(a.name || fileName).trim().slice(0, 150);
      items.push({ actionId: id, cid, label, steps: [{ op: 'call' as any, actionId: id, body: { __call: { method: 'POST', path: '/constituent/v1/actions/attachments' }, parent_id: id, name, type: 'Physical', file_id: fileId, file_name: fileName, date: stamp(today) }, before: { __call: { method: 'DELETE', path: '/constituent/v1/actions/attachments/{id}' } }, label: 'attachment add' }] });
    } else {
      const url = String(a.url || '').trim();
      if (!/^https:\/\/[^\s]+$/i.test(url) || url.length > 2000) throw new HttpError(400, 'bad_attach', 'Paste a web address that starts with https://');
      const name = String(a.name || '').trim().slice(0, 150) || url.replace(/^https:\/\//, '').slice(0, 150);
      items.push({ actionId: id, cid, label, steps: [{ op: 'call' as any, actionId: id, body: { __call: { method: 'POST', path: '/constituent/v1/actions/attachments' }, parent_id: id, name, type: 'Link', url, date: stamp(today) }, before: { __call: { method: 'DELETE', path: '/constituent/v1/actions/attachments/{id}' } }, label: 'attachment add' }] });
    }
    return { items, params, reads, skipped: 0, changed: 0 };
  }

  if (input.op === 'opp_new' || input.op === 'opp_edit') {
    const create = input.op === 'opp_new';
    const { body, errors } = checkOpp(input.opp || {}, codes, { create });
    if (errors.length) throw new HttpError(400, 'bad_field', errors[0]);
    if (create) {
      const cid = String(input.cid || '');
      if (!ID.test(cid)) throw new HttpError(400, 'no_partner', 'Pick the partner first.');
      if (!body.purpose) body.purpose = codes.oppPurposes.includes('Engagement') ? 'Engagement' : codes.oppPurposes[0];
      const partner = await partnerName(ctx.env, cid);
      items.push({ cid, label: labelFor(partner, `Opportunity: ${body.name}`), steps: [{ op: 'call' as any, body: { __call: { method: 'POST', path: '/opportunity/v1/opportunities' }, __opp: cid, ...body, constituent_id: cid }, before: { __call: { method: 'DELETE', path: `/opportunity/v1/opportunities/{id}?constituent=${cid}` } }, label: 'opportunity add' }] });
      // Link the action the person was on to the new opportunity, once it has an id.
      const link = ids[0];
      if (link) items[0].steps.push({ op: 'call' as any, actionId: link, dep: 0, body: { __call: { method: 'PATCH', path: `/constituent/v1/actions/${link}` }, opportunity_id: '__dep__' }, before: { __call: { method: 'PATCH', path: `/constituent/v1/actions/${link}` }, opportunity_id: null }, label: 'link action' });
    } else {
      const oid = String(input.opp_id || '');
      if (!ID.test(oid)) throw new HttpError(400, 'bad_opp', 'Pick the opportunity.');
      const cur = await oppRaw(ctx, oid);
      if (!cur) throw new HttpError(404, 'not_found', 'That opportunity is not in the hub’s copy of Blackbaud.');
      if (!Object.keys(body).length) throw new HttpError(400, 'nothing_to_do', 'Nothing changed.');
      const cid = String(cur.constituent_id || '');
      const partner = await partnerName(ctx.env, cid);
      items.push({ cid, label: labelFor(partner, `Opportunity: ${cur.name || oid}`), steps: [{ op: 'call' as any, body: { __call: { method: 'PATCH', path: `/opportunity/v1/opportunities/${oid}` }, __opp: cid, __oppid: oid, ...body }, before: { __call: { method: 'PATCH', path: `/opportunity/v1/opportunities/${oid}` }, ...oppValuesOf(cur, Object.keys(body)) }, label: 'opportunity change' }] });
    }
    Object.assign(params, { name: body.name || '' });
    return { items, params, reads, skipped: 0, changed: 0 };
  }

  throw new HttpError(400, 'bad_op', 'That is not something the Work Center does.');
}

const sameish = (k: string, a: unknown, b: unknown): boolean => {
  if (k === 'fundraisers') return JSON.stringify([...((a as string[]) || [])].map(String).sort()) === JSON.stringify([...((b as string[]) || [])].map(String).sort());
  if (k === 'date' || k === 'completed_date') return String(a ?? '').slice(0, 10) === String(b ?? '').slice(0, 10);
  if (k === 'completed') return Boolean(a) === Boolean(b);
  const n = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();
  return n(a) === n(b);
};

const pickKeys = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== '').map((k) => [k, o[k]]));

function shortDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${d}, ${y}`;
}

/** Actions Blackbaud changed since the mirror's sync, with each one's date_modified (one call). */
async function changedSinceList(ctx: Ctx, syncedIso: string): Promise<Map<string, string>> {
  const from = new Date((Date.parse(syncedIso || '') || Date.now() - 13 * 3600000) - 5 * 60000);
  const e = new Date(from.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const t = `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}T${String(e.getHours()).padStart(2, '0')}:${String(e.getMinutes()).padStart(2, '0')}:00`;
  const r = await ctx.repo.send([{ method: 'GET', path: `/constituent/v1/actions?last_modified=${t}&limit=2000` }]);
  await addMeter(ctx.env, r.results.length, r.callsToday);
  const res = r.results[0];
  if (!res || !res.ok || !Array.isArray(res.body?.value)) throw new HttpError(503, 'blackbaud_wait', 'Blackbaud did not answer the check that your list is current, so nothing was changed. Try again in a minute.');
  return new Map(res.body.value.map((v: any) => [String(v.id), String(v.date_modified || '')]));
}

/* ------------------------------------------------------------------ notes, tags, attachments: read on demand */

const EXTRA_MS = 10 * 60000;

/** Notes, tags (with their ids) or attachments on one action, read live and kept ten minutes. A write clears the copy. */
export async function actionExtra(ctx: Ctx, id: string, what: 'notes' | 'tags' | 'attachments', opts: { fresh?: boolean } = {}): Promise<any[]> {
  if (!ID.test(id)) throw new HttpError(400, 'bad_id', 'That is not an action.');
  const key = `${what}:${id}`;
  if (!opts.fresh) {
    const c = await ctx.env.DB.prepare('SELECT value, at FROM act_cache WHERE key = ? LIMIT 1').bind(key).first<{ value: string; at: string }>().catch(() => null);
    if (c && Date.now() - Date.parse(c.at) < EXTRA_MS) return parse(c.value) || [];
  }
  const path = what === 'notes' ? `/constituent/v1/actions/${id}/notes` : what === 'tags' ? `/constituent/v1/actions/${id}/customfields` : `/constituent/v1/actions/${id}/attachments`;
  const r = await ctx.repo.send([{ method: 'GET', path }]);
  await addMeter(ctx.env, r.results.length, r.callsToday);
  const x = r.results[0];
  if (!x) throw new HttpError(503, 'blackbaud_wait', r.wait || 'Blackbaud did not answer. Try again in a minute.');
  if (x.refused) throw new HttpError(503, 'not_allowed', 'The Blackbaud connection does not allow this yet.');
  const list = x.ok && Array.isArray(x.body?.value) ? x.body.value : [];
  const shaped = list.map((v: any) =>
    what === 'notes'
      ? { id: String(v.id), type: v.type || '', summary: v.summary || '', text: v.text || '', date: v.date || null, author: v.author || v.added_by || '', added: String(v.date_added || '').slice(0, 10) }
      : what === 'tags'
        ? { id: String(v.id), category: v.category || '', value: v.value, date: String(v.date || '').slice(0, 10), comment: v.comment || '' }
        : { id: String(v.id), name: v.name || '', type: v.type || '', url: v.url || '', file: v.file_name || '', size: v.file_size || null, date: String(v.date || '').slice(0, 10) }
  );
  await ctx.env.DB.prepare('INSERT INTO act_cache (key, value, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at').bind(key, JSON.stringify(shaped), nowIso()).run().catch(() => undefined);
  return shaped;
}

export async function forgetExtra(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM act_cache WHERE key IN (?, ?, ?)").bind(`notes:${id}`, `tags:${id}`, `attachments:${id}`).run().catch(() => undefined);
}

async function noteById(ctx: Ctx, actionId: string, noteId: string) {
  const list = await actionExtra(ctx, actionId, 'notes', { fresh: true });
  return list.find((n: any) => n.id === noteId) || null;
}

async function attachmentById(ctx: Ctx, actionId: string, attId: string) {
  const list = await actionExtra(ctx, actionId, 'attachments', { fresh: true });
  return list.find((n: any) => n.id === attId) || null;
}

/* ------------------------------------------------------------------ repeats */

/** Save a repeat on an action once it exists in Blackbaud. The next one is made when this one is completed. */
export async function saveRecur(env: Env, actionId: string, cid: string, rule: Recur, template: Record<string, unknown>, actor: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO act_recur (action_id, cid, rule, template, active, made_by, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(action_id) DO UPDATE SET rule = excluded.rule, template = excluded.template, active = 1`
  )
    .bind(actionId, cid, JSON.stringify(rule), JSON.stringify(template), actor, nowIso())
    .run();
}

export async function stopRecur(env: Env, actionId: string): Promise<void> {
  await env.DB.prepare('UPDATE act_recur SET active = 0 WHERE action_id = ?').bind(actionId).run().catch(() => undefined);
}

/** The next action of a repeat, built from the one just completed. Null when the repeat has run its course. */
export function nextOfRecur(row: { rule: string; template: string; cid: string }, due: string): { body: Record<string, unknown>; rule: Recur } | null {
  const rule = checkRecur(parse(row.rule));
  if (!rule) return null;
  const nd = nextDue(due, rule);
  const after = recurAfter(rule, nd);
  if (!after) return null;
  const t = parse(row.template) || {};
  const body: Record<string, unknown> = { ...t, constituent_id: row.cid, date: stamp(nd), completed: false, status: 'Open' };
  for (const k of Object.keys(body)) if (k.startsWith('__')) delete body[k];
  delete body.completed_date;
  delete body.outcome;
  return { body, rule: after };
}

/* ------------------------------------------------------------------ saved views */

export async function listViews(env: Env, email: string) {
  const r = await env.DB.prepare('SELECT id, name, spec, is_default, updated_at FROM act_views WHERE email = ? ORDER BY name').bind(email.toLowerCase()).all<{ id: string; name: string; spec: string; is_default: number; updated_at: string }>();
  return r.results.map((v) => ({ id: v.id, name: v.name, spec: parse(v.spec), default: v.is_default === 1, at: v.updated_at }));
}

export async function saveView(env: Env, email: string, v: { id?: string; name?: string; spec?: unknown; default?: boolean }) {
  const name = String(v.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!name) throw new HttpError(400, 'bad_name', 'Name the view.');
  const spec = JSON.stringify(v.spec || {});
  if (spec.length > 4000) throw new HttpError(400, 'too_big', 'That view holds too much.');
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM act_views WHERE email = ?').bind(email.toLowerCase()).first<{ n: number }>();
  const id = v.id && /^wcv_[a-z0-9]+$/i.test(v.id) ? v.id : 'wcv_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  if (!v.id && Number(n?.n) >= 30) throw new HttpError(400, 'too_many', 'Thirty saved views is the limit. Delete one first.');
  if (v.default) await env.DB.prepare('UPDATE act_views SET is_default = 0 WHERE email = ?').bind(email.toLowerCase()).run();
  await env.DB.prepare(
    `INSERT INTO act_views (id, email, name, spec, is_default, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, spec = excluded.spec, is_default = excluded.is_default, updated_at = excluded.updated_at WHERE act_views.email = excluded.email`
  )
    .bind(id, email.toLowerCase(), name, spec, v.default ? 1 : 0, nowIso())
    .run();
  return listViews(env, email);
}

export async function deleteView(env: Env, email: string, id: string) {
  await env.DB.prepare('DELETE FROM act_views WHERE id = ? AND email = ?').bind(id, email.toLowerCase()).run();
  return listViews(env, email);
}

/* ------------------------------------------------------------------ who is signed in, for smart defaults */

export async function meFor(env: Env, email: string): Promise<{ fid: string | null; type: string | null; name: string | null }> {
  const staff = await listStaff(env).catch(() => []);
  const me = staff.find((s) => s.email === email.toLowerCase());
  return { fid: me?.bb_fundraiser_id || null, type: me?.entry_type || null, name: me?.name || null };
}

/** The contact type each staff fundraiser logs under (RDD Action, CED Action ...), for the default type of a new action. */
export async function typesByFundraiser(env: Env): Promise<Record<string, string>> {
  const staff = await listStaff(env).catch(() => []);
  const out: Record<string, string> = {};
  for (const s of staff) if (s.bb_fundraiser_id && s.entry_type) out[s.bb_fundraiser_id] = s.entry_type;
  return out;
}

export { defaultsFor, oppView };

/** Partner names for a list of opportunities, in one mirror read. */
export async function oppNames(ctx: Ctx, cids: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(cids.filter((x) => ID.test(x)))];
  const out: Record<string, string> = {};
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await q<any>(
      ctx.env,
      `SELECT id AS id, constituent_type AS t, first_name AS f, last_name AS l, preferred_name AS p, organization_name AS o FROM constituents WHERE id IN (SELECT value FROM json_each(?1))`,
      [JSON.stringify(ids.slice(i, i + 500))]
    ).catch(() => []);
    for (const w of rows) out[String(w.id)] = w.t === 'Organization' ? w.o || '' : `${w.p || w.f || ''} ${w.l || ''}`.trim();
  }
  return out;
}

/** The actions linked to one opportunity (Blackbaud's opportunity_id on the action), newest first. */
export async function oppLinked(ctx: Ctx, oppId: string) {
  const rows = await q<any>(
    ctx.env,
    `SELECT a.id AS id, substr(a.action_date_due, 1, 10) AS d, a.action_type AS type, a.action_category AS cat, a.action_summary AS summary,
            json_extract(a.raw_json, '$.completed') AS done, json_extract(a.raw_json, '$.fundraisers') AS frs
       FROM actions a WHERE json_extract(a.raw_json, '$.opportunity_id') = ?1 ORDER BY a.action_date_due DESC LIMIT 50`,
    [oppId]
  ).catch(() => []);
  return rows.map((a: any) => ({ id: String(a.id), date: a.d, type: a.type || '', category: a.cat || '', summary: a.summary || '', done: Number(a.done) === 1, by: parseArr(a.frs) }));
}
