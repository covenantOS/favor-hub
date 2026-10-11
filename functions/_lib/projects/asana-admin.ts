// Admin > Projects: who can use Projects, the Asana token, picking and importing projects, run progress, and the hub's own projects.
// Everything here is for hub admins (the route wraps it in adminRoute). The Asana token is sealed with AES-GCM (GOOGLE_TOKEN_KEY, the same
// key and the same seal() the hub uses for stored Google refresh tokens) and kept in hub_settings under projects.asana.token. It is never
// returned by any route, never written to the audit log, and never put in a log line.
import { HttpError, newId, nowIso, type Env } from '../http';
import { audit, hubDel, hubGet, hubPut } from '../admin/settings';
import { open, seal } from '../hub/google';
import {
  AsanaApiSource, AsanaAuthError, ExportSource, parseExport,
  type Source,
} from './asana';
import { createRun, getRun, stepRun, type Pick, type RunOptions, type RunRow, type StepDeps } from './asana-import';

export const TOKEN_KEY = 'projects.asana.token';
const WHO_KEY = 'projects.asana.who';
export const ENABLED_KEY = 'projects.enabled';
export const REQUEST_KEY = 'requests.marketing_project';
const ENABLED = ['admins', 'staff', 'off'];
const lower = (v: unknown) => String(v || '').trim().toLowerCase();

/* -------------------------------------------------------------------------------------------------- the token */

export async function readToken(env: Env): Promise<string | null> {
  const row = await hubGet(env, TOKEN_KEY);
  if (!row || !row.value) return null;
  try {
    return await open(env, row.value);
  } catch {
    throw new HttpError(409, 'token_unreadable', 'The saved Asana token cannot be read. Paste it again.');
  }
}

export async function saveToken(env: Env, actor: string, token: string): Promise<void> {
  const t = token.trim();
  if (t.length < 20 || /\s/.test(t)) throw new HttpError(400, 'bad_token', 'That does not look like an Asana personal access token.');
  if (!env.GOOGLE_TOKEN_KEY) throw new HttpError(503, 'no_key', 'This copy of the hub has no key to seal secrets with (GOOGLE_TOKEN_KEY), so it cannot keep a token.');
  const had = !!(await hubGet(env, TOKEN_KEY));
  await hubPut(env, TOKEN_KEY, await seal(env, t), actor);
  await hubDel(env, WHO_KEY);
  await audit(env, { actor, area: 'projects', key: TOKEN_KEY, label: 'Asana token', before: had ? 'saved' : 'none', after: 'saved', note: 'value not logged' });
}

export async function clearToken(env: Env, actor: string): Promise<void> {
  const had = !!(await hubGet(env, TOKEN_KEY));
  await hubDel(env, TOKEN_KEY);
  await hubDel(env, WHO_KEY);
  if (had) await audit(env, { actor, area: 'projects', key: TOKEN_KEY, label: 'Asana token', before: 'saved', after: 'none', note: 'removed' });
}

/** Connect and test: asks Asana who the token belongs to and which workspaces it can see. Reads only. */
export async function testToken(env: Env, f: typeof fetch = fetch): Promise<{ name: string; email: string; workspaces: Array<{ gid: string; name: string }> }> {
  const token = await readToken(env);
  if (!token) throw new HttpError(400, 'no_token', 'Save an Asana token first.');
  const src = new AsanaApiSource({ token, fetch: f });
  try {
    const me = await src.me();
    const who = { name: me.name, email: me.email, workspaces: me.workspaces || [] };
    await hubPut(env, WHO_KEY, JSON.stringify({ ...who, at: nowIso() }), 'system');
    return who;
  } catch (err) {
    if (err instanceof AsanaAuthError) throw new HttpError(400, 'asana_refused', err.message);
    throw new HttpError(502, 'asana_down', (err as Error).message || 'Asana did not answer.');
  }
}

/* ------------------------------------------------------------------------------------------------ settings */

export async function readSettings(env: Env) {
  const enabled = (await hubGet(env, ENABLED_KEY))?.value || 'admins';
  const req = (await hubGet(env, REQUEST_KEY))?.value || '';
  const tokenRow = await hubGet(env, TOKEN_KEY);
  const who = (await hubGet(env, WHO_KEY).catch(() => null))?.value;
  let whoObj: any = null;
  try {
    whoObj = who ? JSON.parse(who) : null;
  } catch {
    whoObj = null;
  }
  return {
    enabled: ENABLED.includes(enabled) ? enabled : 'admins',
    marketing_project: req,
    token: { saved: !!tokenRow, by: tokenRow?.by || '', at: tokenRow?.at || '', who: whoObj },
    sealing: !!env.GOOGLE_TOKEN_KEY,
  };
}

export async function saveSettings(env: Env, actor: string, b: { enabled?: unknown; marketing_project?: unknown }) {
  if (b.enabled !== undefined) {
    const v = String(b.enabled);
    if (!ENABLED.includes(v)) throw new HttpError(400, 'bad_value', 'Who can use Projects is admins, staff or off.');
    const before = (await hubGet(env, ENABLED_KEY))?.value || 'admins';
    if (v !== before) {
      await hubPut(env, ENABLED_KEY, v, actor);
      await audit(env, { actor, area: 'projects', key: ENABLED_KEY, label: 'Who can use Projects', before, after: v });
    }
  }
  if (b.marketing_project !== undefined) {
    const v = String(b.marketing_project || '').trim();
    if (v) {
      const p = await env.DB.prepare("SELECT id, status FROM hub_projects WHERE id = ?").bind(v).first<{ id: string; status: string }>().catch(() => null);
      if (!p) throw new HttpError(400, 'no_project', 'Pick one of the hub projects.');
      if (p.status === 'archived') throw new HttpError(400, 'archived', 'That project is archived. Restore it first.');
    }
    const before = (await hubGet(env, REQUEST_KEY))?.value || '';
    if (v !== before) {
      if (v) await hubPut(env, REQUEST_KEY, v, actor);
      else await hubDel(env, REQUEST_KEY);
      await audit(env, { actor, area: 'projects', key: REQUEST_KEY, label: 'Marketing requests go to a project', before: before || 'off', after: v || 'off' });
    }
  }
  return readSettings(env);
}

/* ---------------------------------------------------------------------------------------------- hub projects */

export async function hubProjects(env: Env) {
  const r = await env.DB.prepare(
    `SELECT p.id, p.key, p.name, p.team, p.status, p.lead_email, p.updated_at,
       (SELECT COUNT(*) FROM hub_tasks t WHERE t.project_id = p.id AND t.status NOT IN ('done','dropped')) AS open,
       (SELECT COUNT(*) FROM hub_tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done,
       (SELECT COUNT(*) FROM hub_asana_map m WHERE m.kind = 'project' AND m.hub_id = p.id) AS from_asana
     FROM hub_projects p ORDER BY (p.status = 'archived'), p.name LIMIT 500`
  ).all().catch(() => ({ results: [] as any[] }));
  return r.results || [];
}

export async function setProjectState(env: Env, actor: string, id: string, action: string) {
  if (action !== 'archive' && action !== 'restore') throw new HttpError(400, 'bad_action', 'Archive or restore.');
  const p = await env.DB.prepare('SELECT id, name, status FROM hub_projects WHERE id = ?').bind(id).first<{ id: string; name: string; status: string }>();
  if (!p) throw new HttpError(404, 'no_project', 'There is no such project.');
  const to = action === 'archive' ? 'archived' : 'active';
  if (p.status !== to) {
    await env.DB.prepare('UPDATE hub_projects SET status = ?, updated_at = ? WHERE id = ?').bind(to, nowIso(), id).run();
    await audit(env, { actor, area: 'projects', key: `project.${id}`, label: `Project ${p.name}`, before: p.status, after: to });
    if (to === 'archived') {
      const cur = (await hubGet(env, REQUEST_KEY))?.value;
      if (cur === id) {
        await hubDel(env, REQUEST_KEY);
        await audit(env, { actor, area: 'projects', key: REQUEST_KEY, label: 'Marketing requests go to a project', before: p.name, after: 'off', note: 'the project was archived' });
      }
    }
  }
  return { id, status: to };
}

/* ----------------------------------------------------------------------------------------- Asana project list */

export async function listAsana(env: Env, archived: boolean, f: typeof fetch = fetch) {
  const token = await readToken(env);
  if (!token) throw new HttpError(400, 'no_token', 'Save an Asana token first.');
  const src = new AsanaApiSource({ token, fetch: f, deadline: Date.now() + 25_000 });
  try {
    const list = await src.projects({ archived });
    const done = await env.DB.prepare("SELECT gid, hub_id FROM hub_asana_map WHERE kind = 'project'").all<{ gid: string; hub_id: string }>().catch(() => ({ results: [] as any[] }));
    const have = new Map((done.results || []).map((r) => [r.gid, r.hub_id]));
    return list.map((p) => ({ ...p, imported: have.has(p.gid) }));
  } catch (err) {
    if (err instanceof AsanaAuthError) throw new HttpError(400, 'asana_refused', err.message);
    throw new HttpError(502, 'asana_down', (err as Error).message || 'Asana did not answer.');
  }
}

/* --------------------------------------------------------------------------------------------- export files */

const MAX_EXPORT = 40 * 1024 * 1024;

export async function saveExport(env: Env, actor: string, name: string, text: string) {
  if (!text || text.length > MAX_EXPORT) throw new HttpError(400, 'bad_file', 'The file is empty or larger than 40 MB.');
  let parsed;
  try {
    parsed = parseExport(text, name);
  } catch (err) {
    throw new HttpError(400, 'bad_file', (err as Error).message);
  }
  const id = newId('exp');
  await env.UPLOADS.put(`projects/_imports/${id}.txt`, text, { httpMetadata: { contentType: 'text/plain' }, customMetadata: { by: actor, name: name.slice(0, 120) } });
  return { upload: id, projects: parsed.map((p) => ({ ref: p.project.gid, name: p.project.name, archived: p.project.archived, tasks: p.project.num_tasks ?? p.tasks.length })) };
}

/* ------------------------------------------------------------------------------------------------------ runs */

export async function liveRun(env: Env): Promise<RunRow | null> {
  const r = await env.DB.prepare("SELECT id FROM hub_asana_runs WHERE status IN ('running','waiting') ORDER BY created_at DESC LIMIT 1").first<{ id: string }>();
  return r ? getRun(env, r.id) : null;
}

const sameRefs = (a: Pick[], b: Pick[]) => {
  const x = a.map((p) => p.ref).sort().join('|');
  const y = b.map((p) => p.ref).sort().join('|');
  return x === y;
};

export async function startRun(
  env: Env,
  actor: string,
  b: { source?: unknown; mode?: unknown; projects?: unknown; options?: unknown; confirm?: unknown; from_dry_run?: unknown; upload?: unknown }
): Promise<RunRow> {
  const mode = b.mode === 'import' ? 'import' : 'dry';
  const source = b.source === 'export' ? 'export' : 'api';
  const picks: Pick[] = (Array.isArray(b.projects) ? b.projects : [])
    .map((p: any) => ({ ref: String(p?.ref || '').slice(0, 200), name: String(p?.name || '').slice(0, 200) }))
    .filter((p) => p.ref);
  if (!picks.length) throw new HttpError(400, 'no_projects', 'Pick at least one project.');
  if (picks.length > 40) throw new HttpError(400, 'too_many', 'Pick 40 projects or fewer at a time.');
  const o = (b.options && typeof b.options === 'object' ? b.options : {}) as Record<string, any>;
  const options: RunOptions = {
    team: String(o.team || '').slice(0, 60),
    visibility: o.visibility === 'members' ? 'members' : 'staff',
    overwrite: o.overwrite === true,
    copyFiles: o.copyFiles !== false,
    since: /^\d{4}-\d{2}-\d{2}/.test(String(o.since || '')) ? String(o.since) : undefined,
    emailMap: {},
  };
  if (o.emailMap && typeof o.emailMap === 'object') {
    for (const [k, v] of Object.entries(o.emailMap).slice(0, 200)) if (/@/.test(k) && /^[^\s@]+@[^\s@]+$/.test(String(v))) options.emailMap![lower(k)] = lower(v);
  }
  if (source === 'export') {
    options.upload = String(b.upload || '');
    if (!/^exp_[0-9a-f]+$/.test(options.upload)) throw new HttpError(400, 'no_upload', 'Upload the export file first.');
  } else if (!(await readToken(env))) throw new HttpError(400, 'no_token', 'Save an Asana token first.');
  const tables = await env.DB.prepare('SELECT 1 AS x FROM hub_projects LIMIT 1').first().then(() => true).catch(() => false);
  if (!tables) throw new HttpError(409, 'no_tables', 'The Projects tables are not in this database yet.');
  const live = await liveRun(env);
  if (live) throw new HttpError(409, 'busy', 'Another run is still going. Let it finish or cancel it.');
  let fromDry: string | null = null;
  if (mode === 'import') {
    if (b.confirm !== true) throw new HttpError(409, 'confirm', 'An import needs a confirm.');
    fromDry = String(b.from_dry_run || '');
    const dry = fromDry ? await getRun(env, fromDry) : null;
    const fresh = dry && Date.parse(dry.created_at) > Date.now() - 14 * 864e5;
    if (!dry || dry.mode !== 'dry' || dry.status !== 'done' || !fresh || !sameRefs(dry.selection, picks) || dry.source !== source || (dry.options.upload || '') !== (options.upload || '')) {
      throw new HttpError(409, 'dry_first', 'Run a dry run on exactly these projects first, then import from it. A dry run counts for 14 days.');
    }
    const bad = Object.values(dry.report.projects).filter((p) => p.tasks.errors > 0).length;
    if (bad) throw new HttpError(409, 'dry_errors', 'The dry run had tasks it could not read. Read its log first.');
  }
  const run = await createRun(env, { mode, source, selection: picks, options, by: actor, fromDry });
  await audit(env, { actor, area: 'projects', key: `asana.run.${run.id}`, label: `Asana ${mode === 'dry' ? 'dry run' : 'import'}`, before: null, after: picks.map((p) => p.name).join(', ').slice(0, 300), note: source });
  return run;
}

export function stepDeps(env: Env, f: typeof fetch = fetch): StepDeps {
  return {
    uploads: env.UPLOADS,
    async makeSource(run, budget): Promise<Source> {
      if (run.source === 'api') {
        const token = await readToken(env);
        if (!token) throw new AsanaAuthError('The Asana token is no longer saved.');
        return new AsanaApiSource({ token, fetch: f, paceMs: 60, deadline: budget.deadline });
      }
      const obj = await env.UPLOADS.get(`projects/_imports/${run.options.upload}.txt`);
      if (!obj) throw new Error('The export file is gone. Upload it again.');
      return new ExportSource(parseExport(await obj.text(), 'export'), f);
    },
  };
}

export async function cancelRun(env: Env, actor: string, id: string) {
  await env.DB.prepare("UPDATE hub_asana_runs SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE id = ? AND status IN ('running','waiting')").bind(nowIso(), nowIso(), id).run();
  await env.DB.prepare('INSERT INTO hub_asana_log (run_id, at, level, text) VALUES (?, ?, ?, ?)').bind(id, nowIso(), 'warn', `Cancelled by ${actor}.`).run();
  return getRun(env, id);
}

export async function runView(env: Env, id: string, after = 0) {
  const run = await getRun(env, id);
  if (!run) throw new HttpError(404, 'no_run', 'There is no such run.');
  const log = await env.DB.prepare('SELECT id, at, level, text FROM hub_asana_log WHERE run_id = ? AND id > ? ORDER BY id LIMIT 300').bind(id, after).all();
  const rep = run.report;
  const projects = Object.entries(rep.projects).map(([ref, p]) => ({ ref, ...p }));
  const total = projects.reduce((n, p) => n + (p.expected || 0), 0);
  const read = projects.reduce((n, p) => n + p.tasks.create + p.tasks.update + p.tasks.same + p.tasks.kept + p.tasks.alsoIn - p.tasks.subtasks, 0);
  return {
    run: { ...run, cursor: undefined, report: undefined, options: { ...run.options, emailMap: undefined } },
    report: rep,
    progress: { read, total, selected: run.selection.length, at: Math.min(run.cursor.pi, run.selection.length) },
    log: log.results || [],
  };
}

export async function recentRuns(env: Env) {
  const r = await env.DB.prepare('SELECT id, mode, source, status, selection, calls, created_by, created_at, finished_at FROM hub_asana_runs ORDER BY created_at DESC LIMIT 12').all().catch(() => ({ results: [] as any[] }));
  return (r.results || []).map((x: any) => ({ ...x, selection: JSON.parse(x.selection || '[]').map((p: Pick) => p.name) }));
}

export { stepRun };
