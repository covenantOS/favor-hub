// Creates the project the person edited and approved. The server checks every field again: owners must be in the staff directory,
// dates must be dates, sizes are capped. Tasks are made without a notice each; each owner gets one notice for the whole set
// (through the same gate every other task notice uses), so a twenty-task plan does not send twenty.
import { HttpError, type Env } from '../../http';
import { staffDirectory } from '../../people';
import type { Actor } from '../access';
import { addEvent, asDate, lower, projectOf, type ProjectRow, type TaskRow } from '../db';
import { addSection, createProject } from '../projects';
import { createTask } from '../tasks';
import { tell } from '../notices';
import { assess } from './workload';

export interface Created {
  project: ProjectRow;
  tasks: TaskRow[];
  told: string[];
}

const text = (v: unknown, max: number) => String(v ?? '').replace(/\s*[–—]\s*/g, ', ').replace(/\s+/g, ' ').trim().slice(0, max);

export async function createFromPlan(env: Env, actor: Actor, b: Record<string, unknown>): Promise<Created & { warnings: Awaited<ReturnType<typeof assess>> }> {
  const plan = (b.plan && typeof b.plan === 'object' ? b.plan : b) as Record<string, unknown>;
  const name = text(plan.name, 120);
  if (!name) throw new HttpError(400, 'missing_field', 'Give the project a name.');
  const secs = Array.isArray(plan.sections) ? (plan.sections as unknown[]).slice(0, 12) : [];
  const dir = new Map((await staffDirectory(env)).map((p) => [p.email, p]));
  const lead = lower(plan.lead_email) || actor.email;
  if (!dir.has(lead) && lead !== actor.email) throw new HttpError(400, 'bad_email', 'The project lead must be someone on the Favor staff list.');

  const clean: { section: string; tasks: { title: string; owner: string | null; due: string | null; priority: string; description: string }[] }[] = [];
  let total = 0;
  for (const s of secs) {
    const o = (s && typeof s === 'object' ? s : {}) as { name?: unknown; tasks?: unknown };
    const section = text(o.name, 80);
    if (!section) continue;
    const tasks: (typeof clean)[number]['tasks'] = [];
    for (const k of Array.isArray(o.tasks) ? (o.tasks as unknown[]).slice(0, 25) : []) {
      const t = (k && typeof k === 'object' ? k : {}) as Record<string, unknown>;
      const title = text(t.title, 200);
      if (!title) continue;
      if (++total > 60) throw new HttpError(400, 'too_big', 'A plan holds up to 60 tasks. Split this one into two projects.');
      const owner = lower(t.owner_email);
      if (owner && !dir.has(owner)) throw new HttpError(400, 'bad_email', `${owner} is not on the Favor staff list.`);
      tasks.push({
        title,
        owner: owner || null,
        due: asDate(t.due_date, 'due_date'),
        priority: t.priority === 'high' || t.priority === 'low' ? String(t.priority) : 'normal',
        description: String(t.description ?? '').trim().slice(0, 600),
      });
    }
    clean.push({ section, tasks });
  }
  if (!total) throw new HttpError(400, 'missing_field', 'Add at least one task.');

  const owners = [...new Set(clean.flatMap((s) => s.tasks.map((t) => t.owner).filter((e): e is string => !!e)))];
  const dues = clean.flatMap((s) => s.tasks.map((t) => t.due || '')).filter(Boolean).sort();
  const warnings = await assess(
    env,
    clean.flatMap((s) => s.tasks.filter((t) => t.owner && t.due).map((t) => ({ email: t.owner as string, due: t.due as string, priority: t.priority })))
  ).catch(() => []);

  const project = await createProject(env, actor, {
    name,
    key: typeof plan.key === 'string' ? plan.key.trim() : '',
    description: text(plan.description, 1000),
    team: text(plan.team, 60),
    lead_email: lead,
    color: typeof plan.color === 'string' ? plan.color : 'leaf',
    start_date: plan.start_date ? asDate(plan.start_date, 'start_date') : dues[0] || null,
    due_date: plan.due_date ? asDate(plan.due_date, 'due_date') : dues[dues.length - 1] || null,
    members: owners,
  });
  const tasks: TaskRow[] = [];
  for (const s of clean) {
    const sec = await addSection(env, actor, project.id, s.section);
    for (const t of s.tasks) {
      const made = await createTask(env, actor, { title: t.title, project_id: project.id, section_id: sec.id, owner_email: t.owner, due_date: t.due, priority: t.priority, description: t.description }, { quiet: true });
      tasks.push(made.task);
    }
  }
  // One notice per person, on their first task: "3 tasks in <project>".
  const told: string[] = [];
  for (const e of owners) {
    const mine = tasks.filter((t) => lower(t.owner_email) === e);
    if (!mine.length || e === actor.email) continue;
    told.push(...(await tell(env, mine[0].id, actor.email, [{ email: e, kind: 'assigned', body: `${mine.length} ${mine.length === 1 ? 'task' : 'tasks'} in ${project.name}` }])));
  }
  await addEvent(env, { project_id: project.id, actor: actor.email, kind: 'plan_created', detail: { template: text(plan.template, 40), tasks: tasks.length } });
  return { project: await projectOf(env, project.id), tasks, told, warnings };
}
