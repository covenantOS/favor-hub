// Data care: the lists, the review assignment and the merge queue. Reads Blackbaud only through the D1 mirror; a merge is queued here
// and carried out by the desktop runner through the NXT web view (SKY API has no merge route), which reports back through /api/datacare/done.
import { HttpError, newId, nowIso, type Env } from '../http';
import { hubUserOf, type HubUser } from '../session';
import { isTester, TESTER_REFUSAL } from '../testuser';
import { workAccessFor } from '../work/gate';
import { staffDirectory } from '../people';
import { createTask } from '../projects/tasks';
import { compareRecords, type Compare } from './compare';
import { getMeta, runScan, setMeta, type ScanResult } from './scan';

export const REVIEWER_DEFAULT = 'michael@favorintl.org';
export const PAGE_URL = 'https://dash.favorintl.org/data-care/';
const lower = (s: unknown): string => String(s || '').trim().toLowerCase();

export interface CareUser {
  user: HubUser;
  email: string;
  name: string;
  admin: boolean;
  agent: boolean;
}

/** Admins, the reviewer, and the people the Work Center is open to. Field staff and the signed-out never. */
export async function requireCare(env: Env, request: Request): Promise<CareUser> {
  const user = hubUserOf(request);
  if (!user) throw new HttpError(401, 'signin', 'Sign in with your Favor Google account first.');
  const email = lower(user.email);
  const admin = user.role === 'admin';
  const agent = user.via === 'agent';
  if (!agent && user.role === 'field') throw new HttpError(403, 'not_yours', 'Data care is for the staff who work in Blackbaud.');
  if (!admin && !agent && email !== (await reviewer(env))) {
    const w = await workAccessFor(env, email, admin).catch(() => null);
    if (!w || !w.ok) throw new HttpError(403, 'not_yours', 'Data care is for the staff who work in Blackbaud. If yours is one, tell the technology team through Feedback.');
  }
  return { user, email, name: user.name || user.email, admin, agent };
}

export async function reviewer(env: Env): Promise<string> {
  return lower((await getMeta(env, 'reviewer')) || REVIEWER_DEFAULT);
}

export interface FlagOut {
  cid: string;
  lookup: string;
  name: string;
  why: string;
  gave: number;
  gifts: number;
  lastGift: string | null;
  email: string | null;
  state: string;
  fixedAt: string | null;
  fixedHow: string | null;
}

const flagOut = (r: any): FlagOut => ({
  cid: String(r.cid), lookup: String(r.lookup), name: String(r.name), why: String(r.why), gave: Number(r.gave || 0), gifts: Number(r.gifts || 0),
  lastGift: r.last_gift || null, email: r.email || null, state: String(r.state), fixedAt: r.fixed_at || null, fixedHow: r.fixed_how || null,
});

export interface Summary {
  noAddress: { open: number; gave: number; fixed: number };
  pairs: { review: number; notSame: number; queued: number; merged: number; failed: number };
  scannedAt: string | null;
  sheet: string | null;
  reviewer: { email: string; name: string };
  assigned: { at: string; by: string; taskId: string | null } | null;
}

export async function summary(env: Env): Promise<Summary> {
  const [f, p, sc, sheet, rv, asg] = await Promise.all([
    env.DB.prepare(`SELECT state, COUNT(*) AS n, COALESCE(SUM(gave), 0) AS g FROM dc_flag WHERE kind = 'no_address' GROUP BY state`).all<{ state: string; n: number; g: number }>(),
    env.DB.prepare(`SELECT state, COUNT(*) AS n FROM dc_pair GROUP BY state`).all<{ state: string; n: number }>(),
    getMeta(env, 'scan'),
    getMeta(env, 'sheet'),
    reviewer(env),
    getMeta(env, 'assigned'),
  ]);
  const fl = new Map((f.results || []).map((r) => [r.state, r]));
  const pr = new Map((p.results || []).map((r) => [r.state, r.n]));
  const dir = await staffDirectory(env).catch(() => []);
  const who = dir.find((d) => d.email === rv);
  let scannedAt: string | null = null;
  try {
    scannedAt = sc ? (JSON.parse(sc) as ScanResult).at : null;
  } catch {
    scannedAt = null;
  }
  let assigned: Summary['assigned'] = null;
  try {
    assigned = asg ? JSON.parse(asg) : null;
  } catch {
    assigned = null;
  }
  return {
    noAddress: { open: Number(fl.get('open')?.n || 0), gave: Number(fl.get('open')?.g || 0), fixed: Number(fl.get('fixed')?.n || 0) },
    pairs: { review: pr.get('review') || 0, notSame: pr.get('not_same') || 0, queued: pr.get('queued') || 0, merged: pr.get('merged') || 0, failed: pr.get('failed') || 0 },
    scannedAt,
    sheet,
    reviewer: { email: rv, name: who ? who.name : rv },
    assigned,
  };
}

export async function listFlags(env: Env, q: { state: string; offset: number; limit: number; search: string }): Promise<{ rows: FlagOut[]; total: number }> {
  const state = q.state === 'fixed' ? 'fixed' : 'open';
  const like = `%${q.search.replace(/[%_]/g, '')}%`;
  const where = q.search ? `AND (name LIKE ?2 OR lookup = ?3 OR email LIKE ?2)` : '';
  const bind = (st: D1PreparedStatement) => st;
  void bind;
  const args = q.search ? [state, like, q.search.trim()] : [state];
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM dc_flag WHERE kind = 'no_address' AND state = ?1 ${where}`).bind(...args).first<{ n: number }>();
  const rows = await env.DB.prepare(`SELECT * FROM dc_flag WHERE kind = 'no_address' AND state = ?1 ${where} ORDER BY ${state === 'fixed' ? 'fixed_at DESC' : 'gave DESC'}, cid LIMIT ${Math.min(Math.max(q.limit, 1), 200)} OFFSET ${Math.max(q.offset, 0)}`)
    .bind(...args)
    .all();
  return { rows: (rows.results || []).map(flagOut), total: Number(total?.n || 0) };
}

export interface PairOut {
  id: string;
  a: { id: string; lookup: string; name: string };
  b: { id: string; lookup: string; name: string };
  score: number;
  why: string;
  state: string;
  keep: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  result: string | null;
}

const pairOut = (r: any): PairOut => ({
  id: String(r.id), a: { id: String(r.a), lookup: String(r.a_lookup || ''), name: String(r.a_name || '') }, b: { id: String(r.b), lookup: String(r.b_lookup || ''), name: String(r.b_name || '') },
  score: Number(r.score), why: String(r.why), state: String(r.state), keep: r.keep || null, decidedBy: r.decided_by || null, decidedAt: r.decided_at || null, result: r.result || null,
});

const PAIR_STATES: Record<string, string[]> = { review: ['review'], not_same: ['not_same'], done: ['queued', 'merged', 'failed'] };

export async function listPairs(env: Env, tab: string): Promise<PairOut[]> {
  const states = PAIR_STATES[tab] || PAIR_STATES.review;
  const r = await env.DB.prepare(`SELECT * FROM dc_pair WHERE state IN (${states.map(() => '?').join(',')}) ORDER BY score DESC, id LIMIT 200`).bind(...states).all();
  return (r.results || []).map(pairOut);
}

export async function pairDetail(env: Env, id: string): Promise<{ pair: PairOut; compare: Compare | null }> {
  const row = await env.DB.prepare('SELECT * FROM dc_pair WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'no_pair', 'That pair is not on the list.');
  const pair = pairOut(row);
  const compare = await compareRecords(env, pair.a.id, pair.b.id).catch(() => null);
  return { pair, compare };
}

/** Flags for one partner page: whether the partner has no mailing address, and any duplicate pair they are in. */
export async function careFor(env: Env, cid: string): Promise<{ noAddress: FlagOut | null; pairs: { id: string; otherId: string; otherLookup: string; otherName: string; score: number }[] }> {
  const [f, p] = await Promise.all([
    env.DB.prepare(`SELECT * FROM dc_flag WHERE cid = ? AND kind = 'no_address' LIMIT 1`).bind(cid).first(),
    env.DB.prepare(`SELECT * FROM dc_pair WHERE (a = ?1 OR b = ?1) AND state = 'review' ORDER BY score DESC LIMIT 5`).bind(cid).all(),
  ]);
  return {
    noAddress: f ? flagOut(f) : null,
    pairs: (p.results || []).map((r: any) => (String(r.a) === cid ? { id: String(r.id), otherId: String(r.b), otherLookup: String(r.b_lookup || ''), otherName: String(r.b_name || ''), score: Number(r.score) } : { id: String(r.id), otherId: String(r.a), otherLookup: String(r.a_lookup || ''), otherName: String(r.a_name || ''), score: Number(r.score) })),
  };
}

export async function decidePair(env: Env, who: CareUser, id: string, b: Record<string, unknown>): Promise<PairOut> {
  const row = await env.DB.prepare('SELECT * FROM dc_pair WHERE id = ?').bind(id).first<any>();
  if (!row) throw new HttpError(404, 'no_pair', 'That pair is not on the list.');
  const action = String(b.action || '');
  const now = nowIso();
  if (action === 'not_same' || action === 'undo') {
    if (!['review', 'not_same'].includes(row.state)) throw new HttpError(409, 'locked', 'That pair is already merged or waiting to be.');
    await env.DB.prepare(`UPDATE dc_pair SET state = ?, decided_by = ?, decided_at = ?, keep = NULL, picks = NULL WHERE id = ?`).bind(action === 'undo' ? 'review' : 'not_same', who.email, now, id).run();
  } else if (action === 'merge') {
    if (isTester(who.email)) throw new HttpError(403, 'test_user', TESTER_REFUSAL);
    if (row.state !== 'review') throw new HttpError(409, 'locked', 'That pair is not waiting for a decision.');
    const keep = b.keep === 'b' ? 'b' : 'a';
    const pk = (b.picks || {}) as Record<string, unknown>;
    const picks = { name: pk.name === 'other' ? 'other' : 'keep', contact: pk.contact === 'other' ? 'other' : 'keep', personal: pk.personal === 'other' ? 'other' : 'keep' };
    await env.DB.prepare(`UPDATE dc_pair SET state = 'queued', keep = ?, picks = ?, decided_by = ?, decided_at = ?, result = NULL WHERE id = ?`).bind(keep, JSON.stringify(picks), who.email, now, id).run();
  } else throw new HttpError(400, 'bad_action', 'Choose Merge or Not the same person.');
  return pairOut(await env.DB.prepare('SELECT * FROM dc_pair WHERE id = ?').bind(id).first());
}

/** What the desktop runner carries out: queued pairs with the system ids it needs. The source is the record that goes away. */
export async function queue(env: Env): Promise<{ id: string; keepId: string; keepLookup: string; sourceId: string; sourceLookup: string; picks: Record<string, string> }[]> {
  const r = await env.DB.prepare(`SELECT * FROM dc_pair WHERE state = 'queued' ORDER BY decided_at LIMIT 5`).all<any>();
  return (r.results || []).map((p) => {
    const keepA = p.keep !== 'b';
    return {
      id: String(p.id),
      keepId: String(keepA ? p.a : p.b), keepLookup: String(keepA ? p.a_lookup : p.b_lookup),
      sourceId: String(keepA ? p.b : p.a), sourceLookup: String(keepA ? p.b_lookup : p.a_lookup),
      picks: p.picks ? JSON.parse(p.picks) : {},
    };
  });
}

export async function done(env: Env, id: string, ok: boolean, result: string): Promise<void> {
  const now = nowIso();
  await env.DB.prepare(`UPDATE dc_pair SET state = ?, done_at = ?, result = ? WHERE id = ? AND state = 'queued'`).bind(ok ? 'merged' : 'failed', now, result.slice(0, 400), id).run();
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

export interface AssignResult {
  to: string;
  taskId: string | null;
  tagged: boolean;
  emailId: string | null;
  tested: boolean;
}

export function reviewEmail(name: string, s: Summary): { subject: string; html: string; text: string } {
  const first = name.split(' ')[0] || 'there';
  const money = '$' + Math.round(s.noAddress.gave).toLocaleString('en-US');
  const lines = [
    `Hi ${first},`,
    `${s.noAddress.open} partners gave ${money} in the last 12 months and have no mailing address in Blackbaud. They cannot get a receipt or a statement by mail until an address is on file.`,
    `I flagged each one on their partner page in FavorOS and built a Data care list for you to work through. It shows the gift total, the last gift date and the email on file, and a partner drops off the list on its own when an address appears in Blackbaud.`,
    `The same page lines up ${s.pairs.review} possible duplicate partner records side by side. You can merge them there, with no trip to Blackbaud.`,
  ];
  const link = PAGE_URL;
  const text = [...lines, `Open Data care: ${link}`, s.sheet ? `The full list as a Google Sheet: ${s.sheet}` : '', 'Will'].filter(Boolean).join('\n\n');
  const html = `<div style="font:15px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#1f2a24;max-width:560px">${lines.map((l) => `<p>${esc(l)}</p>`).join('')}<p><a href="${link}">Open Data care</a></p>${s.sheet ? `<p><a href="${esc(s.sheet)}">The full list as a Google Sheet</a></p>` : ''}<p>Will</p></div>`;
  return { subject: `Data care: ${s.noAddress.open} partners with no mailing address`, html, text };
}

async function sendResend(env: Env, to: string, mail: { subject: string; html: string; text: string }): Promise<string> {
  if (!env.RESEND_API_KEY) throw new HttpError(503, 'no_mail', 'Email is not set up on this server.');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.RESEND_FROM || 'Favor International <noreply@mail.favorintl.org>', to: [to], reply_to: 'will@favorintl.org', subject: mail.subject, html: mail.html, text: mail.text }),
  });
  const data = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
  if (!res.ok || !data?.id) throw new HttpError(502, 'mail_failed', `The email did not send: ${String(data?.message || res.status).slice(0, 160)}`);
  return data.id;
}

/**
 * Assign the review. Makes one task for the reviewer, tags them (a Today and bell notice), and sends one email with the link.
 * `to` other than the saved reviewer is a test send: it sends the email only, makes no task and does not mark the review as assigned.
 * The real send happens once: a second call answers with the first one unless `again` is set.
 */
export async function assign(env: Env, who: CareUser, b: { to?: string; again?: boolean }): Promise<AssignResult> {
  const saved = await reviewer(env);
  const to = lower(b.to || saved);
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(to)) throw new HttpError(400, 'bad_email', 'That is not an email address.');
  const s = await summary(env);
  const dir = await staffDirectory(env).catch(() => []);
  const name = (dir.find((d) => d.email === to) || { name: to.split('@')[0] }).name;
  const mail = reviewEmail(name, s);
  const test = to !== saved;
  if (test) {
    if (!who.admin && !who.agent) throw new HttpError(403, 'admin_only', 'Only an admin can send a test.');
    const emailId = await sendResend(env, to, { ...mail, subject: '[Test] ' + mail.subject });
    return { to, taskId: null, tagged: false, emailId, tested: true };
  }
  if (isTester(who.email)) throw new HttpError(403, 'test_user', TESTER_REFUSAL);
  if (!who.admin && !who.agent) throw new HttpError(403, 'admin_only', 'Only an admin can assign the review.');
  const prior = await getMeta(env, 'assigned');
  if (prior && !b.again) {
    const p = JSON.parse(prior) as { taskId: string | null; emailId: string | null };
    return { to, taskId: p.taskId, tagged: true, emailId: p.emailId, tested: false };
  }
  const title = `Review ${s.noAddress.open} partners with no mailing address in Data care`;
  const description = `<@${to}> ${s.noAddress.open} partners gave ${'$' + Math.round(s.noAddress.gave).toLocaleString('en-US')} in the last 12 months and have no mailing address in Blackbaud. Work through the list: ${PAGE_URL}`;
  const actor = { email: who.email, name: who.name, admin: who.admin };
  const made = await createTask(env, actor, { title, description, owner_email: to, priority: 'high' }, { quiet: true }).catch((e) => {
    console.error('[datacare] task failed', String((e && e.message) || e));
    return null;
  });
  const taskId = made ? made.task.id : null;
  let tagged = false;
  if (taskId) {
    await env.DB.prepare('INSERT INTO hub_task_notices (id, email, task_id, kind, actor_email, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(newId('ntc'), to, taskId, 'mentioned', lower(who.email), title.slice(0, 600), nowIso())
      .run();
    tagged = true;
  }
  const emailId = await sendResend(env, to, mail);
  await setMeta(env, 'assigned', JSON.stringify({ at: nowIso(), by: who.email, taskId, emailId, to }));
  return { to, taskId, tagged, emailId, tested: false };
}

export async function rescan(env: Env): Promise<ScanResult> {
  return runScan(env);
}

export { setMeta, getMeta };
