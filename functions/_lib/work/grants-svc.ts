// Grants: what the routes do. The list reads the mirror (grants.ts) and lays the hub's own log rows over it so a new entry shows at once.
// Logging writes one action on the foundation (type RESERVED (Grant ...)) and, when a file is picked, attaches it to that action in the
// same batch, so Recent and Undo take both back together. Reading costs no Blackbaud calls. Logging costs 1 call for the action, 1 for
// the file's upload address and 1 for the attachment. Nothing here contacts a funder.
import { HttpError, newId, nowIso } from '../http';
import { mirrorQ, listMirrorQ } from './partner';
import { saveBatch, todayEt, authorizeBatch, validDate, validDue, type Ctx } from './service';
import { planEdit } from './edit';
import { clean, stamp } from '../actions/completion';
import { HOWS, HOW_CATEGORY, HOW_LABEL, KINDS, KIND_LABEL, KIND_TYPE, loadGrants, type GrantRow, type How, type Kind } from './grants';
import { uploadFile, type Uploaded } from './upload';

const ID = /^\d{1,12}$/;
export const mayGrants = (s: Ctx['scope']): boolean => !s || s.role === 'admin' || s.role === 'support' || s.role === 'grants';

interface HubLog { id: string; batch_id: string; cid: string; kind: string; state: string; category: string; on_date: string; summary: string; file_name: string | null; actor: string; at: string; bb_id: string | null }

/** Rows the hub logged, with the Blackbaud id of the action once the batch has posted. Undone batches are left out. */
async function hubLogs(ctx: Ctx, sinceIso: string): Promise<HubLog[]> {
  const r = await ctx.env.DB.prepare(
    `SELECT g.id, g.batch_id, g.cid, g.kind, g.state, g.category, g.on_date, g.summary, g.file_name, g.actor, g.at,
            (SELECT o.bb_id FROM act_outbox o WHERE o.batch_id = g.batch_id AND o.op = 'create' LIMIT 1) AS bb_id
       FROM act_grants g LEFT JOIN act_batches b ON b.id = g.batch_id
      WHERE g.at >= ? AND (b.state IS NULL OR b.state IN ('queued', 'running', 'done', 'partial')) ORDER BY g.at DESC`
  ).bind(sinceIso).all<HubLog>().catch(() => ({ results: [] as HubLog[] }));
  return r.results;
}

export interface GrantsOut {
  ok: true;
  today: string;
  synced: string;
  rows: GrantRow[];
  stats: { open: number; requestsMonth: number; loisMonth: number; reportsMonth: number; local: number };
  kinds: { id: Kind; label: string }[];
  hows: { id: How; label: string }[];
  me: { fid: string | null };
}

export async function grantsResponse(ctx: Ctx): Promise<GrantsOut> {
  if (!mayGrants(ctx.scope)) throw new HttpError(403, 'not_yours', 'Grants is for the grants team and the Support Team.');
  const today = todayEt();
  const synced = await ctx.repo.synced().catch(() => '');
  const logs = await hubLogs(ctx, new Date(Date.now() - 24 * 31 * 86400000).toISOString());
  const files = new Map<string, string>();
  for (const l of logs) if (l.bb_id && l.file_name) files.set(String(l.bb_id), l.file_name);
  const rows = await loadGrants(listMirrorQ(ctx.env), today, files);
  const have = new Set(rows.map((r) => r.id));
  const names = new Map<string, string>();
  const local: GrantRow[] = [];
  for (const l of logs.filter((x) => x.at >= new Date(Date.now() - 7 * 86400000).toISOString())) {
    if (l.bb_id && have.has(String(l.bb_id))) continue;
    if (!names.has(l.cid)) {
      const p = await mirrorQ(ctx.env)<{ n: string }>("SELECT COALESCE(json_extract(raw_json, '$.name'), trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))) AS n FROM constituents WHERE id = ?1", [l.cid]).catch(() => []);
      names.set(l.cid, p[0] && p[0].n ? String(p[0].n) : `Record ${l.cid}`);
    }
    const kind = (KINDS as readonly string[]).includes(l.kind) ? (l.kind as Kind) : null;
    local.push({ id: l.bb_id ? String(l.bb_id) : `local-${l.id}`, cid: l.cid, foundation: names.get(l.cid)!, place: '', kind, kindLabel: kind ? KIND_LABEL[kind] : 'Grant', category: l.category, date: l.on_date, open: l.state === 'todo', summary: l.summary, description: '', who: [l.actor], file: l.file_name, local: true });
  }
  const all = [...local, ...rows];
  const ym = today.slice(0, 7);
  const sentThisMonth = (k: Kind) => all.filter((r) => r.kind === k && !r.open && r.date.slice(0, 7) === ym).length;
  return {
    ok: true, today, synced, rows: all,
    stats: { open: all.filter((r) => r.open).length, requestsMonth: sentThisMonth('request'), loisMonth: sentThisMonth('loi'), reportsMonth: sentThisMonth('report'), local: local.length },
    kinds: KINDS.map((k) => ({ id: k, label: KIND_LABEL[k] })), hows: HOWS.map((h) => ({ id: h, label: HOW_LABEL[h] })), me: { fid: ctx.scope && ctx.scope.fid ? ctx.scope.fid : null },
  };
}

export interface LogInput { cid?: string; kind?: string; how?: string; state?: string; date?: string; summary?: string; notes?: string; req?: string; file?: File | null }

/** Log one grant action, and attach the file when there is one. */
export async function logGrant(ctx: Ctx, input: LogInput, put?: typeof fetch) {
  if (!mayGrants(ctx.scope)) throw new HttpError(403, 'not_yours', 'Grants is for the grants team and the Support Team.');
  const cid = String(input.cid || '');
  if (!ID.test(cid)) throw new HttpError(400, 'no_partner', 'Pick the foundation first.');
  const kind = String(input.kind || '') as Kind;
  if (!(KINDS as readonly string[]).includes(kind)) throw new HttpError(400, 'bad_kind', 'Pick request, LOI, report, task or cultivation.');
  const how = (HOWS as readonly string[]).includes(String(input.how)) ? (String(input.how) as How) : 'portal';
  const state = input.state === 'todo' ? 'todo' : 'sent';
  const today = todayEt();
  let date: string;
  if (state === 'todo') date = validDue(input.date || today);
  else {
    date = validDate(input.date || today, 'the date sent');
    if (date > today) throw new HttpError(400, 'bad_date', 'A date sent cannot be in the future. Log it as a to-do with a due date instead.');
  }
  const summary = clean(input.summary, 255);
  if (!summary) throw new HttpError(400, 'need_summary', 'Write a short summary.');
  const notes = String(input.notes || '').replace(/\r\n/g, '\n').trim().slice(0, 4000);
  const req = String(input.req || '').slice(0, 60) || newId('wcr');
  const owner = ctx.scope && ctx.scope.fid ? ctx.scope.fid : '';
  await authorizeBatch(ctx, { op: 'new', cids: [cid], set: owner ? { fundraisers: [owner] } : {} });
  const file = input.file && typeof (input.file as any).arrayBuffer === 'function' && input.file.size > 0 ? input.file : null;
  // The file goes first: if it cannot reach Blackbaud, nothing is logged.
  let up: Uploaded | null = null;
  if (file) up = await uploadFile(ctx, file, `${KIND_LABEL[kind]}: ${summary}`, put);
  const synced = await ctx.repo.synced().catch(() => '');
  const category = HOW_CATEGORY[how];
  const set: Record<string, unknown> = {
    category,
    type: KIND_TYPE[kind],
    date,
    summary,
    description: notes,
    completed: state === 'sent',
    status: state === 'sent' ? 'Completed' : 'Open',
  };
  if (owner) set.fundraisers = [owner];
  if (state === 'sent' && category !== 'Task/Other') set.direction = 'Outbound';
  const plan = await planEdit(ctx, { op: 'new', cids: [cid], set } as any, { today, synced });
  if (up && plan.items[0]) {
    plan.items[0].steps.push({
      op: 'call' as any, dep: 0,
      body: { __call: { method: 'POST', path: '/constituent/v1/actions/attachments' }, parent_id: '__dep__', name: up.name, type: 'Physical', file_id: up.file_id, file_name: up.file_name, date: stamp(today) },
      before: { __call: { method: 'DELETE', path: '/constituent/v1/actions/attachments/{id}' } },
      label: 'attachment add',
    } as any);
  }
  const batch = await saveBatch(ctx, 'new', plan.items, { op: 'new', n: plan.items.length, summary: `${KIND_LABEL[kind]} logged`, grant: kind }, { reqId: req, reads: plan.reads + (up ? 1 : 0), keySalt: req });
  if (!batch.id) return { ok: true, batch: null, repeat: true };
  if (!batch.repeat) {
    await ctx.env.DB.prepare(
      'INSERT INTO act_grants (id, batch_id, cid, kind, state, category, on_date, summary, file_name, actor, actor_email, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(newId('wgr'), batch.id, cid, kind, state, category, date, summary, up ? up.file_name : null, ctx.actor, ctx.email, nowIso()).run();
  }
  return { ok: true, batch: { id: batch.id, n: batch.n, run_when: batch.run_when }, kind, state, file: up ? up.file_name : null };
}
