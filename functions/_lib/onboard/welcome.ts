// The first-day page's data: the person's own onboarding (when there is one), the steps that are theirs, the people to meet with
// their faces from the staff directory, and the first week laid out by day. Names come from the directory, never from this file.
import type { Env } from '../http';
import { staffDirectory } from '../people';
import { reportingOf } from '../people-dev';
import { addDays, DUTIES } from './template';
import { ownersMap, type Actor } from './run';
import { pathsFinished } from './learn';

const lower = (s: unknown) => String(s || '').trim().toLowerCase();

export interface Meet {
  email: string;
  name: string;
  title: string;
  team: string;
  picture: string;
  why: string;
}

export interface WeekItem {
  title: string;
  who: string;
  done: boolean;
}

export async function welcomeFor(env: Env, actor: Actor) {
  const me = actor.email;
  let run: { id: string; name: string; date: string; title: string; team: string; supervisor_email: string; welcome: string; status: string } | null = null;
  try {
    run = await env.DB.prepare(
      `SELECT id, name, date, title, team, supervisor_email, welcome, status FROM onb_runs WHERE email = ? AND kind = 'onboard' AND status <> 'cancelled' ORDER BY (status = 'active') DESC, date DESC LIMIT 1`
    ).bind(me).first();
  } catch {
    run = null;
  }
  const dir = await staffDirectory(env);
  const by = new Map(dir.map((p) => [p.email, p]));
  const mineRow = by.get(me);
  const rep = await reportingOf(env, me);
  const team = run?.team || mineRow?.team || rep.department || '';
  const supervisor = lower(run?.supervisor_email) || rep.supervisor;

  const meet: Meet[] = [];
  const seen = new Set<string>([me]);
  const add = (email: string, why: string) => {
    const p = by.get(lower(email));
    if (!p || seen.has(p.email)) return;
    seen.add(p.email);
    meet.push({ email: p.email, name: p.name, title: p.title, team: p.team, picture: p.picture, why });
  };
  if (supervisor) add(supervisor, 'Your supervisor');
  const owners = await ownersMap(env);
  for (const d of ['hr', 'training', 'tech', 'directory'] as const) {
    if (owners[d]) add(owners[d], DUTIES.find((x) => x.key === d)!.label);
  }
  if (team) for (const p of dir) if (p.team === team && meet.length < 14) add(p.email, `On your team, ${team}`);

  const steps: Array<{ id: string; title: string; detail: string; kind: string; due_date: string | null; status: string; link_url: string; link_label: string; grp: string; duty: string; owner_email: string; key: string }> = [];
  const week: Array<{ day: string; label: string; items: WeekItem[] }> = [];
  let learn: Record<string, boolean> = {};
  if (run) {
    learn = await pathsFinished(env, me);
    const all = (await env.DB.prepare(`SELECT id, title, detail, kind, due_date, status, link_url, link_label, grp, duty, owner_email, key FROM onb_steps WHERE run_id = ? ORDER BY sort`).bind(run.id).all<(typeof steps)[number]>()).results || [];
    for (const s of all) if (lower(s.owner_email) === me && s.status !== 'skipped') steps.push(s);
    // The first week: steps due in the seven days from the start date that the new hire, the supervisor or training does.
    const start = run.date;
    const end = addDays(start, 7);
    const days = new Map<string, WeekItem[]>();
    for (const s of all) {
      if (!s.due_date || s.due_date < start || s.due_date > end || s.status === 'skipped') continue;
      if (!['hire', 'supervisor', 'training'].includes(s.duty)) continue;
      const who = s.duty === 'hire' ? 'You' : s.duty === 'supervisor' ? 'Your supervisor' : 'Training';
      days.set(s.due_date, [...(days.get(s.due_date) || []), { title: s.title, who, done: s.status === 'done' }]);
    }
    for (const [d, items] of [...days].sort((a, b) => a[0].localeCompare(b[0]))) {
      week.push({ day: d, label: new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' }), items });
    }
  }
  return {
    me: { email: me, name: mineRow?.name || actor.name, picture: mineRow?.picture || '' },
    run: run ? { id: run.id, name: run.name, date: run.date, title: run.title, team: run.team, welcome: run.welcome, status: run.status } : null,
    steps,
    meet,
    week,
    learn,
  };
}
