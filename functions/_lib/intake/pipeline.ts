// A team's pipeline: a hub-only project whose sections are Intake, Triage, In progress, Review and Done (shared/intake-model.ts).
// Requests land in its Intake section. The pipeline is made the first time a request needs it; an admin may rename it or change its lead.
// It is never linked to Asana (setProjectSync refuses it), so requests make no noise there.
// A test account's requests go to a separate test pipeline led by that account, which only the test accounts can open, so a test card
// never shows on a real board.
import { HttpError, newId, nowIso, type Env } from '../http';
import { staffDirectory } from '../people';
import { isTester, notTesterSql } from '../testuser';
import { PIPELINE_PROJECTS, PIPELINE_TEAMS, STAGES, type PipelineTeam, type Stage } from '../../../shared/intake-model';
import { lower, FAVOR, projectsReady, type ProjectRow, type SectionRow } from '../projects/db';

export interface Pipeline {
  team: PipelineTeam;
  project: ProjectRow;
  sections: Map<Stage, SectionRow>;
}

const TEAM_WORD: Record<PipelineTeam, string> = { tech: 'Tech', marketing: 'Marketing' };
/** hub_intake_teams.team is the team, or the team with -test for the test pipeline. */
const slot = (team: PipelineTeam, test: boolean) => (test ? `${team}-test` : team);

/** False until db/projects-intake.sql and db/projects.sql are applied; the routes then answer 503. */
export async function intakeReady(env: Env): Promise<boolean> {
  if (!(await projectsReady(env))) return false;
  try {
    await env.DB.prepare('SELECT request_id FROM hub_intake LIMIT 1').first();
    await env.DB.prepare('SELECT team FROM hub_intake_teams LIMIT 1').first();
    return true;
  } catch {
    return false;
  }
}

/** Who leads a team's pipeline when it is made: found from the staff directory by title, else the first FavorOS admin. */
export async function pipelineLead(env: Env, team: PipelineTeam): Promise<string | null> {
  const people = await staffDirectory(env).catch(() => []);
  let pick: string | null = null;
  if (team === 'tech') {
    pick = (people.find((p) => /lead developer/i.test(p.title)) || people.find((p) => /developer/i.test(p.title)))?.email || null;
  } else {
    const m = people.filter((p) => /marketing/i.test(p.team));
    pick = (m.find((p) => /director|manager|lead/i.test(p.title)) || m[0])?.email || null;
  }
  if (pick && FAVOR.test(lower(pick)) && !isTester(pick)) return lower(pick);
  const admin = await env.DB.prepare(`SELECT email FROM hub_users WHERE role = 'admin' AND blocked = 0 AND ${notTesterSql('email')} ORDER BY created_at, email LIMIT 1`)
    .first<{ email: string }>()
    .catch(() => null);
  return admin?.email ? lower(admin.email) : null;
}

async function sectionsFor(env: Env, projectId: string): Promise<SectionRow[]> {
  const r = await env.DB.prepare('SELECT id, project_id, name, sort FROM hub_project_sections WHERE project_id = ? ORDER BY sort, id').bind(projectId).all<SectionRow>();
  return r.results || [];
}

/** The five sections, found by name (any case). A missing one is added in its place; an existing one is never renamed or moved. */
async function fillSections(env: Env, projectId: string): Promise<Map<Stage, SectionRow>> {
  let have = await sectionsFor(env, projectId);
  const byName = (s: Stage) => have.find((x) => x.name.trim().toLowerCase() === s.toLowerCase());
  const add: D1PreparedStatement[] = [];
  const base = have.length ? Math.max(...have.map((s) => Number(s.sort) || 0)) : 0;
  let n = 0;
  for (const [i, s] of STAGES.entries()) {
    if (byName(s)) continue;
    n++;
    add.push(env.DB.prepare('INSERT INTO hub_project_sections (id, project_id, name, sort) VALUES (?, ?, ?, ?)').bind(newId('sec'), projectId, s, have.length ? base + n * 1000 : (i + 1) * 1000));
  }
  if (add.length) {
    await env.DB.batch(add);
    have = await sectionsFor(env, projectId);
  }
  return new Map(STAGES.map((s) => [s, byName(s)!] as const));
}

/** A project key not used by any other project: the team's own, then the same with a letter added. */
async function freeKey(env: Env, wanted: string): Promise<string> {
  const taken = async (k: string) => !!(await env.DB.prepare('SELECT 1 AS ok FROM hub_projects WHERE key = ?').bind(k).first());
  if (!(await taken(wanted))) return wanted;
  for (let i = 0; i < 26; i++) {
    const k = wanted.slice(0, 4) + String.fromCharCode(65 + i);
    if (!(await taken(k))) return k;
  }
  throw new HttpError(409, 'key_taken', 'No free project key for the pipeline.');
}

/**
 * The team's pipeline, made on first use. Throws 503 when nobody can lead it yet.
 * testLead: a test account's email. The request then goes to the test pipeline, led by that account.
 */
export async function ensurePipeline(env: Env, team: PipelineTeam, testLead?: string): Promise<Pipeline> {
  const test = !!testLead && isTester(testLead);
  const found = await pipelineIfAny(env, team, test);
  if (found) return found;
  const lead = test ? lower(testLead) : await pipelineLead(env, team);
  if (!lead) throw new HttpError(503, 'no_owner', `Nobody is set up to take ${TEAM_WORD[team]} requests yet. Ask a FavorOS admin.`);
  const def = PIPELINE_PROJECTS[team];
  const now = nowIso();
  const id = newId('prj');
  const key = await freeKey(env, test ? def.key.slice(0, 2) + 'T' : def.key);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO hub_projects (id, key, name, description, team, lead_email, visibility, status, color, next_num, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'members', 'active', ?, 1, ?, ?, ?)`
    ).bind(id, key, test ? `${def.name} (test)` : def.name, def.description, TEAM_WORD[team], lead, def.color, lead, now, now),
    env.DB.prepare(`INSERT OR IGNORE INTO hub_project_members (project_id, email, role, added_at) VALUES (?, ?, 'lead', ?)`).bind(id, lead, now),
    env.DB.prepare('INSERT OR IGNORE INTO hub_intake_teams (team, project_id, created_at) VALUES (?, ?, ?)').bind(slot(team, test), id, now),
  ]);
  // Two requests at once may both get here; the pipeline that was recorded first wins.
  const won = await pipelineIfAny(env, team, test);
  if (!won) throw new HttpError(500, 'pipeline', 'Could not set up the pipeline.');
  return won;
}

/** The team's pipeline (or its test pipeline) when it exists. Reads only; makes nothing. */
export async function pipelineIfAny(env: Env, team: PipelineTeam, test = false): Promise<Pipeline | null> {
  const row = await env.DB.prepare('SELECT p.* FROM hub_intake_teams t JOIN hub_projects p ON p.id = t.project_id WHERE t.team = ?').bind(slot(team, test)).first<ProjectRow>().catch(() => null);
  if (!row) return null;
  return { team, project: row, sections: await fillSections(env, row.id) };
}

/** Project id to team, for every pipeline there is, test pipelines included. A handful of rows. */
export async function pipelineIds(env: Env): Promise<Map<string, PipelineTeam>> {
  const r = await env.DB.prepare('SELECT team, project_id FROM hub_intake_teams').all<{ team: string; project_id: string }>().catch(() => ({ results: [] as Array<{ team: string; project_id: string }> }));
  return new Map(
    (r.results || [])
      .map((x) => [x.project_id, x.team.replace(/-test$/, '')] as const)
      .filter(([, t]) => PIPELINE_TEAMS.includes(t as PipelineTeam))
      .map(([id, t]) => [id, t as PipelineTeam] as const)
  );
}

/** True when the project is a team pipeline. Asana sync refuses these. */
export async function isPipelineProject(env: Env, projectId: string | null | undefined): Promise<boolean> {
  if (!projectId) return false;
  const r = await env.DB.prepare('SELECT 1 AS ok FROM hub_intake_teams WHERE project_id = ?').bind(projectId).first().catch(() => null);
  return !!r;
}
