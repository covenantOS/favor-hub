// Fund and campaign requests (Admin > Appeal codes): a list of codes someone needs created in Blackbaud, with who asked and who closed it.
import { HttpError, newId, nowIso, type Env } from '../http';
import { audit } from './settings';

export const KINDS = ['fund', 'campaign'] as const;
export type Kind = (typeof KINDS)[number];
export interface CodeRequest { id: string; kind: Kind; code: string; description: string; category: string | null; start_date: string | null; note: string | null; state: string; requested_by: string; requested_at: string; closed_by: string | null; closed_at: string | null }

export async function listRequests(env: Env): Promise<CodeRequest[]> {
  const r = await env.DB.prepare("SELECT * FROM bb_code_requests WHERE state = 'open' OR closed_at >= ? ORDER BY requested_at DESC LIMIT 100")
    .bind(new Date(Date.now() - 60 * 86400000).toISOString()).all<CodeRequest>().catch(() => ({ results: [] as CodeRequest[] }));
  return r.results;
}

export async function addRequest(env: Env, actor: string, b: Record<string, any>): Promise<CodeRequest> {
  const kind = String(b.kind || '') as Kind;
  if (!(KINDS as readonly string[]).includes(kind)) throw new HttpError(400, 'bad_kind', 'Pick fund or campaign.');
  const code = String(b.code || '').replace(/\s+/g, ' ').trim().slice(0, 30);
  const description = String(b.description || '').replace(/\s+/g, ' ').trim().slice(0, 255);
  if (!code) throw new HttpError(400, 'need_code', 'Write the code.');
  if (!description) throw new HttpError(400, 'need_description', 'Write the description.');
  const start = String(b.start_date || '');
  if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new HttpError(400, 'bad_date', 'Pick a real start date.');
  const dup = await env.DB.prepare("SELECT id FROM bb_code_requests WHERE state = 'open' AND kind = ? AND upper(code) = upper(?) LIMIT 1").bind(kind, code).first();
  if (dup) throw new HttpError(409, 'duplicate', 'That code is already waiting.');
  const row: CodeRequest = { id: newId('bcr'), kind, code, description, category: String(b.category || '').trim().slice(0, 80) || null, start_date: start || null, note: String(b.note || '').trim().slice(0, 500) || null, state: 'open', requested_by: actor, requested_at: nowIso(), closed_by: null, closed_at: null };
  await env.DB.prepare('INSERT INTO bb_code_requests (id, kind, code, description, category, start_date, note, state, requested_by, requested_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(row.id, row.kind, row.code, row.description, row.category, row.start_date, row.note, row.state, row.requested_by, row.requested_at).run();
  await audit(env, { actor, area: 'appeal-codes', key: `${kind}:${code}`, label: `${kind === 'fund' ? 'Fund' : 'Campaign'} request ${code}`, before: null, after: description, note: 'requested' });
  return row;
}

export async function closeRequest(env: Env, actor: string, id: string, state: 'done' | 'dropped'): Promise<void> {
  const row = await env.DB.prepare("SELECT * FROM bb_code_requests WHERE id = ? AND state = 'open'").bind(id).first<CodeRequest>();
  if (!row) throw new HttpError(404, 'no_request', 'That request is closed or gone.');
  await env.DB.prepare('UPDATE bb_code_requests SET state = ?, closed_by = ?, closed_at = ? WHERE id = ?').bind(state, actor, nowIso(), id).run();
  await audit(env, { actor, area: 'appeal-codes', key: `${row.kind}:${row.code}`, label: `${row.kind === 'fund' ? 'Fund' : 'Campaign'} request ${row.code}`, before: 'open', after: state });
}
