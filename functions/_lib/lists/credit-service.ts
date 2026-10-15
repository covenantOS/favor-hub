// Credit and assignment proposals: scan the mirror for gifts whose credit differs from Favor's rules, store proposals, take an approver's
// decision, keep the audit trail, and carry out an approved change through the existing paths only while lists:credit_apply is on.
//   Credit changes go to the queue the desktop's Blackbaud web view runner reads (the web view is the only route that changes credit on a saved gift).
//   Assignment changes go through the upkeep route (POST and PATCH fundraisers/assignments).
import { HttpError, newId, nowIso, type Env } from '../http.ts';
import {
  afterApproval, assignmentCall, mayApprove, oddCredits, proposeForGift, CREDIT_TYPES,
  type Actor, type Assignment, type CreditProposal, type GiftFacts, type State,
} from './credit.ts';
import type { Q } from './run.ts';

type Row = Record<string, any>;
const ID = /^\d{1,12}$/;
// The two test users (functions/_lib/testuser.ts; not imported here so this file loads under node's test runner).
const isTester = (email: string) => /^tester2?@favorintl\.org$/i.test(email);
const TESTER_REFUSAL = 'This is the FavorOS test user. It cannot write to Blackbaud, send email or notify staff.';
export const SETTING_APPLY = 'lists:credit_apply';
export const SETTING_TEST_ONLY = 'lists:credit_test_only';
export const SETTING_APPROVERS = 'lists:credit_approvers';
export const SETTING_AUTO = 'lists:credit_auto';
export const TEST_RECORD = '27202';

export async function setting(env: Env, key: string, fallback = ''): Promise<string> {
  const r = await env.DB.prepare(`SELECT value FROM act_settings WHERE key = ?1`).bind(key).first<{ value: string }>().catch(() => null);
  return r ? r.value : fallback;
}
export async function putSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO act_settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(key, value, nowIso()).run();
}

export async function actorOf(env: Env, email: string, admin: boolean): Promise<Actor> {
  const staff = await env.DB.prepare(`SELECT team FROM act_staff WHERE email = ?1 AND active = 1`).bind(email.toLowerCase()).first<{ team: string }>().catch(() => null);
  const named = (await setting(env, SETTING_APPROVERS)).toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
  return { email: email.toLowerCase(), admin, team: staff?.team || '', named };
}

async function log(env: Env, changeId: string, actor: string, event: string, note = ''): Promise<void> {
  await env.DB.prepare(`INSERT INTO lr_credit_log (change_id, at, actor, event, note) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(changeId, nowIso(), actor, event, note.slice(0, 400)).run();
}

// ---- reading the mirror ----
const ASSIGN_SQL = `SELECT x.id AS id, x.constituent_record_id AS cid, x.assignment_fundraiser_id AS fid, x.assignment_type AS type, substr(x.assignment_from_date, 1, 10) AS from_d, substr(x.assignment_to_date, 1, 10) AS to_d
  FROM assignments x WHERE x.constituent_record_id IN (SELECT value FROM json_each(?1)) AND x.assignment_fundraiser_id IS NOT NULL`;

export const assignOf = (r: Row): Assignment => ({ id: String(r.id), cid: String(r.cid), fid: String(r.fid), type: String(r.type ?? ''), from: String(r.from_d ?? '0000-00-00'), to: String(r.to_d ?? '') });

const GIFT_SQL = `SELECT g.id AS id, DATE(g.gift_date) AS d, g.gift_amount AS amt, g.constituent_record_id AS cid, g.fundraiser_credits AS fc, g.soft_credits AS sc,
         ap.appeal_category AS cat, ap.appeal_id AS code
    FROM gifts g LEFT JOIN appeals ap ON ap.id = json_extract(g.gift_splits, '$[0].appeal_id')`;

export function factsOf(r: Row): GiftFacts {
  const parse = (s: unknown): Row[] => {
    try {
      const v = JSON.parse(String(s || '[]'));
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const soft = parse(r.sc).map((x) => String(x?.constituent_id ?? '')).filter(Boolean);
  return {
    id: String(r.id),
    date: String(r.d),
    amount: Number(r.amt) || 0,
    partners: soft.length ? soft : [String(r.cid)],
    category: String(r.cat ?? ''),
    code: String(r.code ?? ''),
    credits: parse(r.fc).filter((c) => c?.constituent_id).map((c) => ({ fid: String(c.constituent_id), amount: Number(c.amount?.value) || 0 })),
  };
}

async function assignmentsFor(mirror: Q, partners: string[]): Promise<Assignment[]> {
  const out: Assignment[] = [];
  const ids = [...new Set(partners)];
  for (let i = 0; i < ids.length; i += 2000) out.push(...(await mirror(ASSIGN_SQL, [JSON.stringify(ids.slice(i, i + 2000))])).map(assignOf));
  return out;
}

export interface ScanResult {
  gifts: number;
  proposals: number;
  added: number;
  odd: Array<{ giftId: string; fundraiserId: string; reason: string }>;
}

/** Look at the gifts in a period, store a proposal for each difference from the rules (once; an open proposal is not repeated). */
export async function scan(env: Env, mirror: Q, from: string, to: string, today: string): Promise<ScanResult> {
  const rows = await mirror(`${GIFT_SQL} WHERE g.gift_amount > 0 AND g.gift_type <> 'RecurringGift' AND DATE(g.gift_date) >= ?1 AND DATE(g.gift_date) <= ?2 ORDER BY g.gift_date DESC LIMIT 3000`, [from, to]);
  const facts = rows.map(factsOf);
  const assigns = await assignmentsFor(mirror, facts.flatMap((f) => f.partners));
  const res: ScanResult = { gifts: facts.length, proposals: 0, added: 0, odd: [] };
  for (const g of facts) {
    const mine = assigns.filter((a) => g.partners.includes(a.cid));
    for (const o of oddCredits(g, mine)) res.odd.push({ giftId: g.id, fundraiserId: o.fid, reason: o.reason });
    for (const p of proposeForGift(g, mine, today)) {
      res.proposals++;
      const dup = await env.DB.prepare(`SELECT id FROM lr_credit_change WHERE gift_id = ?1 AND fundraiser_id = ?2 AND state IN ('proposed', 'approved', 'queued') AND json_extract(change, '$.op') = ?3`).bind(p.giftId, p.fundraiserId, p.op).first();
      if (dup) continue;
      await insertCredit(env, 'scan', p, g.partners[0], g.partners[0]);
      res.added++;
    }
  }
  return res;
}

async function insertCredit(env: Env, by: string, p: CreditProposal, record: string, household: string): Promise<string> {
  const id = newId('crd');
  const change = JSON.stringify({ op: p.op, amount: p.amount, closedMonth: p.closedMonth });
  await env.DB.prepare(
    `INSERT INTO lr_credit_change (id, kind, gift_id, record_id, household_id, fundraiser_id, change, rule, reason, before_json, state, proposed_by, proposed_at) VALUES (?1, 'credit', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'proposed', ?10, ?11)`
  ).bind(id, p.giftId, record, household, p.fundraiserId, change, p.rule, p.reason, JSON.stringify(p.before), by, nowIso()).run();
  await log(env, id, by, 'proposed', p.reason);
  return id;
}

// ---- a person proposes ----
export interface ProposeInput {
  kind?: unknown;
  giftId?: unknown;
  fundraiserId?: unknown;
  op?: unknown;
  amount?: unknown;
  recordId?: unknown;
  assignmentId?: unknown;
  type?: unknown;
  reason?: unknown;
}

export async function propose(env: Env, mirror: Q, who: { email: string }, i: ProposeInput, today: string): Promise<string> {
  const reason = String(i.reason ?? '').trim().slice(0, 300);
  if (!reason) throw new HttpError(400, 'reason', 'Say why the change is needed.');
  const fid = String(i.fundraiserId ?? '');
  if (!ID.test(fid)) throw new HttpError(400, 'fundraiser', 'Pick the fundraiser.');
  if (i.kind === 'credit') {
    const gid = String(i.giftId ?? '');
    if (!ID.test(gid)) throw new HttpError(400, 'gift', 'Give the gift ID.');
    const op = i.op === 'remove' ? 'remove' : i.op === 'add' ? 'add' : null;
    if (!op) throw new HttpError(400, 'op', 'Choose add or remove.');
    const g = (await mirror(`${GIFT_SQL} WHERE g.id = ?1`, [gid]))[0];
    if (!g) throw new HttpError(404, 'no_gift', 'That gift is not in the Blackbaud copy.');
    const f = factsOf(g);
    const has = f.credits.some((c) => c.fid === fid);
    if (op === 'add' && has) throw new HttpError(409, 'has_credit', 'That fundraiser already has credit on this gift.');
    if (op === 'remove' && !has) throw new HttpError(409, 'no_credit', 'That fundraiser has no credit on this gift.');
    const amount = op === 'remove' ? f.credits.find((c) => c.fid === fid)!.amount : Math.min(Number(i.amount) > 0 ? Number(i.amount) : f.amount, f.amount);
    const closed = f.date.slice(0, 7) < today.slice(0, 7);
    return insertCredit(env, who.email, { kind: 'credit', giftId: gid, fundraiserId: fid, op, amount, rule: 'manual', reason, closedMonth: closed, before: f.credits }, f.partners[0], f.partners[0]);
  }
  if (i.kind === 'assignment') {
    const rec = String(i.recordId ?? '');
    if (!ID.test(rec)) throw new HttpError(400, 'record', 'Give the partner record.');
    const op = i.op === 'end' ? 'end' : i.op === 'add' ? 'add' : null;
    if (!op) throw new HttpError(400, 'op', 'Choose end or add.');
    let type = '';
    let aid = '';
    if (op === 'add') {
      type = String(i.type ?? '');
      if (!CREDIT_TYPES.includes(type)) throw new HttpError(400, 'type', 'Pick the assignment role.');
    } else {
      aid = String(i.assignmentId ?? '');
      if (!ID.test(aid)) throw new HttpError(400, 'assignment', 'Pick the assignment to end.');
      const a = (await assignmentsFor(mirror, [rec])).find((x) => x.id === aid);
      if (!a || a.fid !== fid) throw new HttpError(404, 'no_assignment', 'That assignment is not on this partner.');
      if (a.to) throw new HttpError(409, 'ended', 'That assignment has already ended.');
    }
    const id = newId('crd');
    await env.DB.prepare(
      `INSERT INTO lr_credit_change (id, kind, record_id, fundraiser_id, assignment_id, change, rule, reason, before_json, state, proposed_by, proposed_at) VALUES (?1, 'assignment', ?2, ?3, ?4, ?5, 'manual', ?6, '{}', 'proposed', ?7, ?8)`
    ).bind(id, rec, fid, aid || null, JSON.stringify({ op, type }), reason, who.email, nowIso()).run();
    await log(env, id, who.email, 'proposed', reason);
    return id;
  }
  throw new HttpError(400, 'kind', 'Choose a credit or an assignment change.');
}

// ---- the decision ----
export async function decide(env: Env, actor: Actor, id: string, decision: 'approve' | 'reject', note: string, today: string, ops?: (m: string, p: string, b?: unknown) => Promise<{ ok: boolean; wait?: string; refused?: string; body?: any }>): Promise<{ state: State; note: string }> {
  if (!mayApprove(actor)) throw new HttpError(403, 'not_approver', 'Only an admin, the Operations team or a person an admin names can decide a credit or assignment change.');
  const c = await env.DB.prepare(`SELECT * FROM lr_credit_change WHERE id = ?1`).bind(id).first<Row>();
  if (!c) throw new HttpError(404, 'not_found', 'That change is gone.');
  if (c.state !== 'proposed') throw new HttpError(409, 'decided', `That change is already ${c.state}.`);
  if (decision === 'approve' && c.proposed_by === actor.email) throw new HttpError(403, 'own', 'A second person approves a change you proposed.');
  const now = nowIso();
  if (decision === 'reject') {
    await env.DB.prepare(`UPDATE lr_credit_change SET state = 'rejected', decided_by = ?2, decided_at = ?3, decision_note = ?4 WHERE id = ?1`).bind(id, actor.email, now, note.slice(0, 300)).run();
    await log(env, id, actor.email, 'rejected', note);
    return { state: 'rejected', note: '' };
  }
  const applyOn = (await setting(env, SETTING_APPLY, 'off')) === 'on';
  const testOnly = (await setting(env, SETTING_TEST_ONLY, TEST_RECORD)).split(',').map((x) => x.trim()).filter(Boolean);
  let state = afterApproval(applyOn, c.kind);
  let why = '';
  if (applyOn && isTester(actor.email)) {
    state = 'approved';
    why = TESTER_REFUSAL;
  } else if (applyOn && testOnly.length && !testOnly.includes(String(c.record_id))) {
    state = 'approved';
    why = `Held: apply is limited to record ${testOnly.join(', ')} until an admin lifts the test limit.`;
  }
  let result = '';
  if (state === 'applied' && c.kind === 'assignment') {
    const ch = JSON.parse(c.change);
    const call = assignmentCall({ op: ch.op, assignmentId: c.assignment_id, recordId: c.record_id, fundraiserId: c.fundraiser_id, type: ch.type, date: today });
    const r = ops ? await ops(call.method, call.path, call.body) : { ok: false, wait: 'The Blackbaud connection is not available.' };
    if (!r.ok) {
      state = 'failed';
      result = String(r.refused || r.wait || JSON.stringify(r.body || '').slice(0, 200));
    } else result = 'Saved in Blackbaud';
  }
  await env.DB.prepare(`UPDATE lr_credit_change SET state = ?2, decided_by = ?3, decided_at = ?4, decision_note = ?5, applied_at = ?6, result = ?7 WHERE id = ?1`)
    .bind(id, state, actor.email, now, note.slice(0, 300), state === 'applied' ? now : null, (result || why) || null).run();
  await log(env, id, actor.email, 'approved', note);
  if (state === 'queued') await log(env, id, 'hub', 'queued', 'Waiting for the Blackbaud web view runner');
  if (state === 'applied') await log(env, id, 'hub', 'applied', result);
  if (state === 'failed') await log(env, id, 'hub', 'failed', result);
  if (state === 'approved') await log(env, id, 'hub', 'held', why || 'Apply is off');
  return { state, note: why };
}

export async function cancel(env: Env, actor: Actor, id: string): Promise<void> {
  const c = await env.DB.prepare(`SELECT proposed_by, state FROM lr_credit_change WHERE id = ?1`).bind(id).first<Row>();
  if (!c) throw new HttpError(404, 'not_found', 'That change is gone.');
  if (c.state !== 'proposed') throw new HttpError(409, 'decided', `That change is already ${c.state}.`);
  if (c.proposed_by !== actor.email && !mayApprove(actor)) throw new HttpError(403, 'not_yours', 'Only the person who proposed a change, or an approver, can take it back.');
  await env.DB.prepare(`UPDATE lr_credit_change SET state = 'cancelled', decided_by = ?2, decided_at = ?3 WHERE id = ?1`).bind(id, actor.email, nowIso()).run();
  await log(env, id, actor.email, 'cancelled');
}

// ---- the daily automatic run (desktop morning job, agent key) ----
// Rule proposals from the scan are approved by the system once apply and auto are on. Only current-month changes go through: a change to a closed
// month stays waiting for a person, because past numbers do not change on their own (Will, 2026-10-09). Removals also wait for a person. A proposal the mirror shows is already in
// place is cancelled instead of applied. A person's or an agent's proposal always waits for a second person.
const AUTO_ACTOR: Actor = { email: 'credit-auto@favorintl.org', admin: true, team: 'admin', named: [] };
export interface AutoResult {
  skipped?: string;
  scanned?: number;
  added?: number;
  approved: number;
  queued: number;
  applied: number;
  failed: number;
  alreadyDone: number;
  heldClosedMonth: number;
  heldForPerson: number;
}
export async function autoRun(env: Env, mirror: Q, today: string, ops?: Parameters<typeof decide>[6], days = 45): Promise<AutoResult> {
  const res: AutoResult = { approved: 0, queued: 0, applied: 0, failed: 0, alreadyDone: 0, heldClosedMonth: 0, heldForPerson: 0 };
  if ((await setting(env, SETTING_APPLY, 'off')) !== 'on') return { ...res, skipped: 'Apply is off.' };
  if ((await setting(env, SETTING_AUTO, 'off')) !== 'on') return { ...res, skipped: 'Automatic apply is off.' };
  const from = new Date(Date.parse(today + 'T12:00:00Z') - days * 86400000).toISOString().slice(0, 10);
  const sc = await scan(env, mirror, from, today, today);
  res.scanned = sc.gifts;
  res.added = sc.added;
  const waiting = (await env.DB.prepare(`SELECT id, kind, gift_id, fundraiser_id, change, proposed_by FROM lr_credit_change WHERE state = 'proposed' ORDER BY proposed_at LIMIT 300`).all<Row>()).results || [];
  for (const c of waiting) {
    const ch = JSON.parse(c.change || '{}');
    // Only an added credit goes through unattended. A removal takes numbers away from someone, so a person decides it.
    if (c.proposed_by !== 'scan' || c.kind !== 'credit' || ch.op !== 'add') {
      res.heldForPerson++;
      continue;
    }
    if (ch.closedMonth) {
      res.heldClosedMonth++;
      continue;
    }
    const g = (await mirror(`${GIFT_SQL} WHERE g.id = ?1`, [String(c.gift_id)]))[0];
    const has = g ? factsOf(g).credits.some((x) => x.fid === String(c.fundraiser_id)) : null;
    if (g === undefined || has === null || (ch.op === 'add' && has) || (ch.op === 'remove' && !has)) {
      const why = has === null ? 'The gift is not in the Blackbaud copy.' : 'Already in place in Blackbaud.';
      await env.DB.prepare(`UPDATE lr_credit_change SET state = 'cancelled', decided_by = ?2, decided_at = ?3, decision_note = ?4 WHERE id = ?1 AND state = 'proposed'`).bind(c.id, AUTO_ACTOR.email, nowIso(), why).run();
      await log(env, c.id, AUTO_ACTOR.email, 'cancelled', why);
      res.alreadyDone++;
      continue;
    }
    const r = await decide(env, AUTO_ACTOR, String(c.id), 'approve', 'Automatic: a rule proposal for a gift in the current month', today, ops);
    res.approved++;
    if (r.state === 'queued') res.queued++;
    else if (r.state === 'applied') res.applied++;
    else if (r.state === 'failed') res.failed++;
  }
  return res;
}

// ---- the runner's queue (agent key only) ----
export async function queued(env: Env): Promise<Row[]> {
  const r = await env.DB.prepare(`SELECT id, gift_id, record_id, fundraiser_id, change, before_json FROM lr_credit_change WHERE state = 'queued' AND kind = 'credit' ORDER BY proposed_at LIMIT 50`).all<Row>();
  return r.results || [];
}
export async function queueDone(env: Env, id: string, ok: boolean, result: string): Promise<void> {
  const c = await env.DB.prepare(`SELECT state FROM lr_credit_change WHERE id = ?1`).bind(id).first<Row>();
  if (!c || c.state !== 'queued') throw new HttpError(409, 'not_queued', 'That change is not waiting for the runner.');
  await env.DB.prepare(`UPDATE lr_credit_change SET state = ?2, applied_at = ?3, result = ?4 WHERE id = ?1`).bind(id, ok ? 'applied' : 'failed', ok ? nowIso() : null, result.slice(0, 300)).run();
  await log(env, id, 'runner', ok ? 'applied' : 'failed', result);
}

// ---- reading ----
export interface ChangeView {
  id: string;
  kind: string;
  giftId: string | null;
  recordId: string | null;
  fundraiserId: string | null;
  fundraiser: string;
  change: Row;
  rule: string;
  reason: string;
  state: string;
  proposedBy: string;
  proposedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  result: string | null;
}

export async function listChanges(env: Env, states: string[], limit = 100): Promise<ChangeView[]> {
  const ph = states.map((_, i) => `?${i + 1}`).join(',');
  const r = await env.DB.prepare(`SELECT c.*, COALESCE(f.name, c.fundraiser_id) AS fname FROM lr_credit_change c LEFT JOIN lr_fr f ON f.id = c.fundraiser_id WHERE c.state IN (${ph}) ORDER BY c.proposed_at DESC LIMIT ${Math.min(limit, 300)}`).bind(...states).all<Row>();
  return (r.results || []).map((c) => ({
    id: c.id, kind: c.kind, giftId: c.gift_id, recordId: c.record_id, fundraiserId: c.fundraiser_id, fundraiser: String(c.fname ?? ''), change: JSON.parse(c.change || '{}'), rule: c.rule, reason: c.reason,
    state: c.state, proposedBy: c.proposed_by, proposedAt: c.proposed_at, decidedBy: c.decided_by, decidedAt: c.decided_at, note: c.decision_note, result: c.result,
  }));
}

export async function history(env: Env, id: string): Promise<Row[]> {
  return ((await env.DB.prepare(`SELECT at, actor, event, note FROM lr_credit_log WHERE change_id = ?1 ORDER BY id`).bind(id).all<Row>()).results || []) as Row[];
}

/** A gift with its credits and the partner's assignments, for the look-up card. */
export async function lookupGift(env: Env, mirror: Q, gid: string, today: string) {
  const g = (await mirror(`${GIFT_SQL} WHERE g.id = ?1`, [gid]))[0];
  if (!g) return null;
  const f = factsOf(g);
  const as = await assignmentsFor(mirror, f.partners);
  const names = new Map(((await env.DB.prepare(`SELECT id, name FROM lr_fr`).all<Row>()).results || []).map((r) => [String(r.id), String(r.name)]));
  const nm = (id: string) => names.get(id) || id;
  return {
    gift: { id: f.id, date: f.date, amount: f.amount, category: f.category, code: f.code, partners: f.partners },
    credits: f.credits.map((c) => ({ ...c, name: nm(c.fid) })),
    assignments: as.map((a) => ({ ...a, name: nm(a.fid), onDate: a.from <= f.date && (!a.to || a.to >= f.date) })).sort((a, b) => b.from.localeCompare(a.from)),
    proposals: proposeForGift(f, as, today).map((p) => ({ ...p, name: nm(p.fundraiserId) })),
    odd: oddCredits(f, as).map((o) => ({ ...o, name: nm(o.fid) })),
  };
}

/** A partner's assignments with their history, and the recent gifts with their credit. */
export async function lookupPartner(env: Env, mirror: Q, rid: string) {
  const names = new Map(((await env.DB.prepare(`SELECT id, name FROM lr_fr`).all<Row>()).results || []).map((r) => [String(r.id), String(r.name)]));
  const nm = (id: string) => names.get(id) || id;
  const as = await assignmentsFor(mirror, [rid]);
  const gifts = (await mirror(`${GIFT_SQL} WHERE g.constituent_record_id = ?1 AND g.gift_amount > 0 AND g.gift_type <> 'RecurringGift' ORDER BY g.gift_date DESC LIMIT 25`, [rid])).map(factsOf);
  return {
    assignments: as.map((a) => ({ ...a, name: nm(a.fid) })).sort((a, b) => b.from.localeCompare(a.from)),
    gifts: gifts.map((g) => ({ id: g.id, date: g.date, amount: g.amount, category: g.category, code: g.code, credits: g.credits.map((c) => ({ ...c, name: nm(c.fid) })) })),
  };
}

export async function searchPartners(mirror: Q, term: string): Promise<Row[]> {
  const t = term.trim();
  if (t.length < 2) return [];
  if (/^\d+$/.test(t)) return mirror(`SELECT id AS rid, constituent_lookup_id AS lookup, COALESCE(NULLIF(organization_name, ''), trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))) AS name FROM constituents WHERE constituent_lookup_id = ?1 OR id = ?1 LIMIT 8`, [t]);
  return mirror(`SELECT id AS rid, constituent_lookup_id AS lookup, COALESCE(NULLIF(organization_name, ''), trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))) AS name FROM constituents
    WHERE lower(COALESCE(organization_name, '') || ' ' || COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) LIKE ?1 LIMIT 8`, ['%' + t.toLowerCase().replace(/[%_]/g, '') + '%']);
}
