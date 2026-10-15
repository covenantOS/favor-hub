// Reads for requests inside Projects: the shape every list and drawer shows (IntakeItem in shared/intake-model.ts).
// Who may read what is decided by the callers (views.ts): a person asks for their own requests, or for the queue of a team they triage.
import type { Env } from '../http';
import { staffDirectory, type Person } from '../people';
import { moveText, stepsOf } from '../requests/progress';
import { chunk, lower, placeholders } from '../projects/db';
import {
  STATUS_WORD,
  stageOf,
  type IntakeItem,
  type IntakeMove,
  type IntakePerson,
  type PipelineTeam,
  type RequestStatus,
} from '../../../shared/intake-model';
import { placeLabel, teamLabel, type Kind } from '../../../shared/request-parse';
import { pipelineIds } from './pipeline';

interface ReqRow {
  id: string;
  title: string;
  body: string;
  surface: string;
  status: RequestStatus;
  submitter_name: string;
  submitter_email: string | null;
  page_url: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  declined_reason: string | null;
}

interface IntRow {
  request_id: string;
  task_id: string | null;
  team: PipelineTeam;
  kind: string;
  place: string;
  audience: string;
  assignee_hint: string | null;
  question_open: number;
}

interface CardRow {
  id: string;
  request_id: string;
  code: string | null;
  project_id: string | null;
  section_id: string | null;
  owner_email: string | null;
  due_date: string | null;
  status: string;
  done_at: string | null;
}

const parse = (s: string | null): Record<string, unknown> => {
  try {
    const v = s ? JSON.parse(s) : null;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const personOf = (dir: Map<string, Person>, email: string | null | undefined, fallbackName = ''): IntakePerson | null => {
  const e = lower(email);
  if (!e) return null;
  const p = dir.get(e);
  return { email: e, name: p?.name || fallbackName || e.split('@')[0], ...(p?.picture ? { picture: p.picture } : {}) };
};

/** One history line for a person to read. */
function line(kind: string, actor: string, payload: Record<string, unknown>): string {
  const who = /^agent$/i.test(actor || '') ? '' : String(actor || '').split(/\s+/)[0];
  if (kind === 'asked') return `${who || 'Someone'} asked a question`;
  if (kind === 'triage') {
    if (payload.action === 'accept') return `${who || 'Someone'} accepted it${payload.project ? ` into ${String(payload.project)}` : ''}${payload.stage ? `, ${String(payload.stage)}` : ''}`;
    if (payload.action === 'decline') return `${who || 'Someone'} declined it`;
    return '';
  }
  if (kind === 'answered') return `${who || 'The asker'} answered`;
  return moveText(kind, actor, payload);
}

/** The requests with these ids as the lists show them. The caller has already decided the person may read every one. */
export async function buildItems(env: Env, ids: string[]): Promise<IntakeItem[]> {
  if (!ids.length) return [];
  const reqs: ReqRow[] = [];
  const ints = new Map<string, IntRow>();
  const cards = new Map<string, CardRow>();
  const owners = new Map<string, { owner_email: string | null; due_date: string | null }>();
  const events: Array<{ request_id: string; kind: string; actor: string; payload: string | null; created_at: string }> = [];
  for (const part of chunk(ids, 60)) {
    const ph = placeholders(part.length);
    const [r, i, c, o, e] = await Promise.all([
      env.DB.prepare(`SELECT id, title, body, surface, status, submitter_name, submitter_email, page_url, created_at, updated_at, approved_at, started_at, completed_at, declined_reason FROM requests WHERE id IN (${ph})`).bind(...part).all<ReqRow>(),
      env.DB.prepare(`SELECT request_id, task_id, team, kind, place, audience, assignee_hint, question_open FROM hub_intake WHERE request_id IN (${ph})`).bind(...part).all<IntRow>().catch(() => ({ results: [] as IntRow[] })),
      env.DB.prepare(`SELECT id, request_id, code, project_id, section_id, owner_email, due_date, status, done_at FROM hub_tasks WHERE request_id IN (${ph}) AND status <> 'dropped' ORDER BY created_at`).bind(...part).all<CardRow>().catch(() => ({ results: [] as CardRow[] })),
      env.DB.prepare(`SELECT request_id, owner_email, due_date FROM request_tasks WHERE request_id IN (${ph})`).bind(...part).all<{ request_id: string; owner_email: string | null; due_date: string | null }>().catch(() => ({ results: [] as Array<{ request_id: string; owner_email: string | null; due_date: string | null }> })),
      env.DB.prepare(`SELECT request_id, kind, actor, payload, created_at FROM events WHERE request_id IN (${ph}) AND kind IN ('status', 'sent', 'due', 'waiting', 'asked', 'triage', 'answered') ORDER BY created_at DESC, rowid DESC`).bind(...part).all<{ request_id: string; kind: string; actor: string; payload: string | null; created_at: string }>().catch(() => ({ results: [] as never[] })),
    ]);
    reqs.push(...(r.results || []));
    for (const x of i.results || []) ints.set(x.request_id, x);
    for (const x of c.results || []) if (!cards.has(x.request_id)) cards.set(x.request_id, x);
    for (const x of o.results || []) owners.set(x.request_id, x);
    events.push(...(e.results || []));
  }
  const projIds = [...new Set([...cards.values()].map((c) => c.project_id).filter((x): x is string => !!x))];
  const secIds = [...new Set([...cards.values()].map((c) => c.section_id).filter((x): x is string => !!x))];
  const projects = new Map<string, { id: string; key: string; name: string }>();
  const sections = new Map<string, { id: string; name: string }>();
  for (const part of chunk(projIds, 60)) for (const p of (await env.DB.prepare(`SELECT id, key, name FROM hub_projects WHERE id IN (${placeholders(part.length)})`).bind(...part).all<{ id: string; key: string; name: string }>()).results || []) projects.set(p.id, p);
  for (const part of chunk(secIds, 60)) for (const s of (await env.DB.prepare(`SELECT id, name FROM hub_project_sections WHERE id IN (${placeholders(part.length)})`).bind(...part).all<{ id: string; name: string }>()).results || []) sections.set(s.id, s);
  const pipes = await pipelineIds(env);
  const dir = new Map((await staffDirectory(env).catch(() => [])).map((p) => [p.email, p]));
  const byId = new Map(reqs.map((r) => [r.id, r]));

  const out: IntakeItem[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) continue;
    const it = ints.get(id);
    const card = cards.get(id) || null;
    const team: PipelineTeam = it?.team || (r.surface === 'marketing' ? 'marketing' : 'tech');
    const place = it?.place || (r.surface === 'marketing' ? 'design' : r.surface);
    const own = owners.get(id);
    const proj = card?.project_id ? projects.get(card.project_id) || null : null;
    const sec = card?.section_id ? sections.get(card.section_id) || null : null;
    const inPipe = !!card?.project_id && pipes.has(card.project_id);
    const evs = events.filter((e) => e.request_id === id);
    const ask = it?.question_open ? evs.find((e) => e.kind === 'asked') : undefined;
    const askP = ask ? parse(ask.payload) : {};
    const moves: IntakeMove[] = evs
      .map((e) => ({ at: e.created_at, text: line(e.kind, e.actor, parse(e.payload)) }))
      .filter((m) => m.text)
      .slice(0, 6);
    const status = r.status;
    out.push({
      id,
      title: r.title,
      body: r.body,
      status,
      word: STATUS_WORD[status] || status,
      steps: stepsOf(r),
      team,
      team_name: teamLabel(team),
      kind: ((it?.kind as Kind) || 'other') as Kind,
      place,
      place_label: placeLabel(team, place),
      audience: it?.audience || '',
      task: card ? { id: card.id, code: card.code, url: `/projects/?t=${encodeURIComponent(card.id)}` } : null,
      project: proj,
      section: sec,
      stage: inPipe ? stageOf(sec?.name) : null,
      owner: personOf(dir, card?.owner_email || own?.owner_email),
      assignee_hint: personOf(dir, it?.assignee_hint),
      due_date: card?.due_date || own?.due_date || null,
      submitter: personOf(dir, r.submitter_email, r.submitter_name),
      question: ask
        ? { by: personOf(dir, String(askP.by_email || ''), String(ask.actor || '')) || { email: '', name: String(ask.actor || '') }, body: String(askP.body || ''), at: ask.created_at }
        : null,
      declined_reason: status === 'declined' ? r.declined_reason : null,
      created_at: r.created_at,
      updated_at: r.updated_at,
      done_at: r.completed_at || card?.done_at || null,
      moves,
      href: `/projects/?r=${encodeURIComponent(id)}`,
    });
  }
  return out;
}
