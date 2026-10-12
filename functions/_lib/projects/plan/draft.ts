// A draft plan from one sentence. The structure starts from a Favor template (templates.ts) or a generic outline, with dates
// counted from the date in the sentence and owners matched to the staff directory by title. A text model then reshapes that
// scaffold to the sentence. Whatever it returns is checked against the directory and the calendar before anyone sees it, and
// the unchanged template stands when the model is missing, slow or wrong. Nothing is saved until the person presses Create.
import type { Env } from '../../http';
import { aiFor } from '../../ai/guard';
import { staffDirectory, type Person } from '../../people';
import { parseAiJson } from '../../clipChapters';
import { lower, todayEastern } from '../db';
import { GENERIC, ROLE_TITLES, TEMPLATES, matchTemplate, templateById, type RoleId, type Template } from './templates';
import { addDays, assess, dn, ymd, usualWeeks, weekStart, type Warning } from './workload';

export interface PlanTask {
  title: string;
  owner_email: string | null;
  due_date: string | null;
  priority: 'low' | 'normal' | 'high';
  description: string;
}
export interface PlanSection {
  name: string;
  tasks: PlanTask[];
}
export interface Plan {
  template: string;
  name: string;
  description: string;
  team: string;
  color: string;
  lead_email: string;
  anchor: string;
  anchor_label: string;
  start_date: string | null;
  due_date: string | null;
  sections: PlanSection[];
}
export interface Draft {
  plan: Plan;
  source: 'template' | 'drafted';
  warnings: Warning[];
  templates: { id: string; name: string; blurb: string; anchor: string }[];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** A date written in the sentence: 2026-11-14, Nov 14, November 14th, 11/14, or "in 3 weeks". Null when there is none. */
export function dateIn(text: string, today: string): string | null {
  const iso = text.match(/\b(20\d\d)-(\d\d)-(\d\d)\b/);
  if (iso && !Number.isNaN(Date.parse(iso[0] + 'T12:00:00Z'))) return iso[0];
  const named = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d\d))?\b/i);
  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d\d))?\b/);
  let m = 0, d = 0, y = 0;
  if (named) {
    m = MONTHS.indexOf(named[1].slice(0, 3).toLowerCase()) + 1;
    d = Number(named[2]);
    y = Number(named[3]) || 0;
  } else if (slash) {
    m = Number(slash[1]);
    d = Number(slash[2]);
    y = Number(slash[3]) || 0;
  }
  if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
    const year = y || Number(today.slice(0, 4));
    let s = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (Number.isNaN(Date.parse(s + 'T12:00:00Z')) || new Date(s + 'T12:00:00Z').getUTCDate() !== d) return null;
    if (!y && s < today) s = `${year + 1}${s.slice(4)}`;
    return s;
  }
  const rel = text.match(/\bin (\d{1,2}) (day|week|month)s?\b/i);
  if (rel) {
    const n = Number(rel[1]);
    const days = rel[2].toLowerCase() === 'day' ? n : rel[2].toLowerCase() === 'week' ? n * 7 : n * 30;
    return addDays(today, days);
  }
  return null;
}

const plainText = (s: unknown, max: number) =>
  String(s ?? '')
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** The person whose title matches the role, with the lightest load of the matches; the project lead when none does. */
export function ownerFor(role: RoleId, dir: Person[], lead: string, load: Map<string, number>): string {
  if (role === 'lead') return lead;
  for (const re of ROLE_TITLES[role].titles) {
    const hit = dir.filter((p) => re.test(p.title));
    if (hit.length) return hit.sort((a, b) => (load.get(a.email) || 0) - (load.get(b.email) || 0) || a.name.localeCompare(b.name))[0].email;
  }
  return lead;
}

/** A due date counted from the anchor. A weekend date moves back to Friday unless the task keeps it. Never before today. */
export function dueFrom(anchor: string, offset: number, weekend: boolean | undefined, today: string): string {
  let n = dn(anchor) + offset;
  if (!weekend) {
    const dow = (n + 4) % 7;
    if (dow === 6) n -= 1;
    else if (dow === 0) n -= 2;
  }
  const out = ymd(n);
  return out < today ? today : out;
}

/** The anchor: the sentence's date, or `lead` days out; snapped forward to the template's weekday. */
export function anchorFor(t: Template, given: string | null, today: string): string {
  let a = given && given >= today ? given : addDays(today, t.lead);
  if (t.snap !== undefined) {
    const dow = (dn(a) + 4) % 7;
    a = addDays(a, (t.snap - dow + 7) % 7);
  }
  return a;
}

/** The template filled in with dates and owners. No model involved. */
export function scaffold(t: Template, o: { today: string; anchor: string; lead: string; dir: Person[]; load: Map<string, number>; name: string; description: string }): Plan {
  const sections: PlanSection[] = t.sections.map((s) => ({
    name: s.name,
    tasks: s.tasks.map((k) => ({
      title: k.title,
      owner_email: ownerFor(k.role, o.dir, o.lead, o.load),
      due_date: dueFrom(o.anchor, k.offset, k.weekend, o.today),
      priority: k.priority || 'normal',
      description: k.note || '',
    })),
  }));
  const dues = sections.flatMap((s) => s.tasks.map((k) => k.due_date || '')).filter(Boolean).sort();
  return {
    template: t.id, name: o.name, description: o.description, team: t.team, color: t.color, lead_email: o.lead,
    anchor: o.anchor, anchor_label: t.anchor, start_date: dues[0] || null, due_date: o.anchor, sections,
  };
}

/** Title for a project when the sentence gives none: the template name and the month of its date. */
const MON_NAME = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const defaultName = (t: Template, anchor: string) => (t.id === 'generic' ? 'New project' : `${t.name}, ${MON_NAME[Number(anchor.slice(5, 7)) - 1]} ${Number(anchor.slice(8, 10))}`);

/* ---------------------------------------------------------------- the model */

const MODELS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-4-scout-17b-16e-instruct'];
const TIMEOUT_MS = 8000;

async function askModel(env: Env, system: string, user: string): Promise<unknown | null> {
  const ai = aiFor(env.AI, 'plan-draft');
  if (!ai) return null;
  for (const model of MODELS.slice(0, 1)) {
    try {
      const run = ai.run(model, { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 3000, temperature: 0.2 }) as Promise<{ response?: string }>;
      const res = await Promise.race([run, new Promise<null>((r) => setTimeout(() => r(null), TIMEOUT_MS))]);
      const text = res && typeof res.response === 'string' ? res.response : '';
      const parsed = text ? parseAiJson(text) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (err) {
      console.warn('[projects] plan model', model, err);
    }
  }
  return null;
}

const SYSTEM =
  'You plan projects for Favor International, a missions nonprofit. You receive a sentence from a staff member, a starting plan built from how Favor really runs this kind of work, the staff list and what each person already carries. ' +
  'Return ONE JSON object and nothing else: {"name": string, "description": string (one or two plain sentences), "sections": [{"name": string, "tasks": [{"title": string, "owner_email": string, "due_date": "YYYY-MM-DD", "priority": "low"|"normal"|"high", "description": string}]}]}. ' +
  'Keep the starting plan\'s structure and dates unless the sentence calls for a change. Add tasks the sentence asks for. Remove tasks that clearly do not apply. Every owner_email must come from the staff list. Prefer people with a lighter load. Never put more than three tasks due on one day for one person. ' +
  'Every due_date is a weekday on or after today. Work leading up to the event or deadline falls on or before project_date. Follow-up work (thank-yous, results, debriefs) may fall up to six weeks after it. Titles are short imperative phrases. Write plain sentences with no dashes, no emoji and no marketing language. Do not invent partner names, amounts or facts.';

/** Checks the model's plan against the directory and the calendar. Null when too little survives. */
export function sanitize(raw: unknown, base: Plan, dir: Person[], today: string): Plan | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { name?: unknown; description?: unknown; sections?: unknown };
  if (!Array.isArray(o.sections)) return null;
  const emails = new Set(dir.map((p) => p.email));
  const sections: PlanSection[] = [];
  let count = 0;
  for (const s of o.sections.slice(0, 8)) {
    if (!s || typeof s !== 'object') continue;
    const sec = s as { name?: unknown; tasks?: unknown };
    const name = plainText(sec.name, 60);
    if (!name || !Array.isArray(sec.tasks)) continue;
    const tasks: PlanTask[] = [];
    for (const k of sec.tasks.slice(0, 12)) {
      if (!k || typeof k !== 'object' || count >= 40) continue;
      const t = k as Record<string, unknown>;
      const title = plainText(t.title, 120);
      if (!title) continue;
      const owner = lower(t.owner_email);
      let due = typeof t.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.due_date) && !Number.isNaN(Date.parse(t.due_date + 'T12:00:00Z')) ? t.due_date : '';
      if (!due) due = base.anchor;
      if (due < today) due = today;
      const horizon = addDays(base.anchor, 45);
      if (due > horizon) due = horizon;
      const pr = lower(t.priority);
      tasks.push({
        title,
        owner_email: emails.has(owner) ? owner : base.lead_email,
        due_date: due,
        priority: pr === 'high' || pr === 'low' ? pr : 'normal',
        description: plainText(t.description, 400),
      });
      count++;
    }
    if (tasks.length) sections.push({ name, tasks });
  }
  if (count < 3) return null;
  const dues = sections.flatMap((s) => s.tasks.map((k) => k.due_date || '')).sort();
  return { ...base, name: plainText(o.name, 80) || base.name, description: plainText(o.description, 600) || base.description, start_date: dues[0] || base.start_date, sections };
}

/* ---------------------------------------------------------------- the entry point */

/* ---------------------------------------------------------------- facts stated in the sentence */

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const rx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface Facts {
  date: string | null;
  owner_me: boolean;
  people: string[];
  name: string;
}

/** "by Friday", "due next Tuesday", "Friday": the first such weekday on or after today ("next" adds a week). */
export function weekdayIn(text: string, today: string): string | null {
  const m = text.match(/\b(next\s+|this\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  if (!m) return null;
  const target = WEEKDAYS.indexOf(m[2].toLowerCase());
  const dow = (dn(today) + 4) % 7;
  const ahead = (target - dow + 7) % 7;
  return addDays(today, /^next/i.test(m[1] || '') ? ahead + 7 : ahead);
}

/** Every fact the sentence states, read without a model: the date, "owner me", named staff, a name. */
export function factsIn(text: string, today: string, dir: Person[]): Facts {
  const date = dateIn(text, today) || weekdayIn(text, today);
  const owner_me =
    /\b(?:owner|owned by|assign(?:ed)?(?: to)?|lead|run by)\s*[:,-]?\s*(?:is\s+)?(?:me|myself|i)\b/i.test(text) || /\bfor me\b|\bi(?:'ll| will) (?:own|run|do)\b/i.test(text);
  const people: string[] = [];
  if (!owner_me) {
    const hay = (text.match(/\b(?:with|owner|owners|assign(?:ed)? to|lead|and)\s+[A-Z][\w'. ,-]*/g) || []).join(' ');
    for (const p of dir) {
      const first = p.name.split(/\s+/)[0];
      const full = new RegExp(`\\b${rx(p.name)}\\b`, 'i').test(text);
      const one = first.length > 2 && new RegExp(`\\b${rx(first)}\\b`).test(hay);
      if ((full || one) && !people.includes(p.email)) people.push(p.email);
    }
  }
  const nm = text.match(/\b(?:called|named|name it)\s+["“]?([^"”,.;]{3,70})/i) || text.match(/["“]([^"”]{3,70})["”]/);
  return { date, owner_me, people, name: nm ? plainText(nm[1], 70) : '' };
}

/** Puts the stated facts back onto a plan, whatever made the plan. */
export function enforce(plan: Plan, f: Facts, actor: string): Plan {
  const out: Plan = JSON.parse(JSON.stringify(plan));
  if (f.name) out.name = f.name;
  if (f.owner_me) {
    out.lead_email = actor;
    for (const sec of out.sections) for (const t of sec.tasks) t.owner_email = actor;
  } else if (f.people.length) {
    out.lead_email = f.people[0];
    let i = 0;
    for (const sec of out.sections) for (const t of sec.tasks) t.owner_email = f.people[i++ % f.people.length];
  }
  if (f.date) {
    out.anchor = f.date;
    out.due_date = f.date;
  }
  const dues = out.sections.flatMap((s) => s.tasks.map((k) => k.due_date || '')).filter(Boolean).sort();
  out.start_date = dues[0] || out.start_date;
  return out;
}

async function loadMap(env: Env, now: string) {
  const r = await env.DB.prepare(`SELECT owner_email, COUNT(*) AS n FROM hub_tasks WHERE owner_email IS NOT NULL AND status NOT IN ('done', 'dropped') AND due_date >= ? AND due_date <= ? GROUP BY owner_email`)
    .bind(now, addDays(now, 42))
    .all<{ owner_email: string; n: number }>()
    .catch(() => ({ results: [] as { owner_email: string; n: number }[] }));
  return new Map((r.results || []).map((x) => [lower(x.owner_email), Number(x.n) || 0]));
}

async function warn(env: Env, plan: Plan, now: string) {
  const adds = plan.sections.flatMap((s) => s.tasks.filter((k) => k.owner_email && k.due_date).map((k) => ({ email: k.owner_email as string, due: k.due_date as string, priority: k.priority })));
  return assess(env, adds, now).catch(() => []);
}

/** The instant draft: no model. A template only when the sentence matches one, every stated fact applied. */
export async function draftPlan(
  env: Env,
  actor: { email: string; name: string },
  input: { prompt: string; template?: string; date?: string | null; lead_email?: string },
  now: string = todayEastern()
): Promise<Draft & { facts: Facts }> {
  const prompt = plainText(input.prompt, 600);
  const dir = await staffDirectory(env);
  const lead = dir.some((p) => p.email === lower(input.lead_email)) ? lower(input.lead_email) : actor.email;
  const picked = (input.template && templateById(input.template)) || matchTemplate(prompt) || GENERIC;
  const facts = factsIn(prompt, now, dir);
  if (input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date)) facts.date = input.date;
  if (facts.date && facts.date < now) facts.date = null;
  const anchor = facts.date || anchorFor(picked, null, now);
  const load = await loadMap(env, now);
  const base = scaffold(picked, { today: now, anchor, lead, dir, load, name: defaultName(picked, anchor), description: prompt.slice(0, 400) });
  const firstLine = plainText(prompt.split(/[.\n,]/)[0], 70);
  if (picked.id === 'generic' && firstLine) base.name = firstLine;
  const plan = enforce(base, facts, actor.email);
  return { plan, source: 'template', warnings: await warn(env, plan, now), templates: TEMPLATES.map((t) => ({ id: t.id, name: t.name, blurb: t.blurb, anchor: t.anchor })), facts };
}

/** The slow pass: the model reshapes the draft inside 8 seconds, then every stated fact is put back. Null when it adds nothing. */
export async function refinePlan(
  env: Env,
  actor: { email: string; name: string },
  input: { prompt: string; plan: Plan },
  now: string = todayEastern()
): Promise<{ plan: Plan; warnings: Warning[] } | null> {
  const prompt = plainText(input.prompt, 600);
  const base = input.plan;
  if (!base || !Array.isArray(base.sections) || prompt.length < 8) return null;
  const dir = await staffDirectory(env);
  const facts = factsIn(prompt, now, dir);
  const load = await loadMap(env, now);
  const usual = await usualWeeks(env, now).catch(() => new Map());
  const staff = dir.map((p) => ({ email: p.email, name: p.name, title: p.title, team: p.team, open_next_6_weeks: load.get(p.email) || 0, usual_tasks_per_week: usual.get(p.email)?.usual ?? 4 }));
  const user = JSON.stringify({ today: now, week_of_today: weekStart(now), sentence: prompt, project_date: base.anchor, project_lead: base.lead_email, stated_facts: facts, starting_plan: { template: base.template, sections: base.sections }, staff });
  const made = sanitize(await askModel(env, SYSTEM, user), base, dir, now);
  if (!made) return null;
  const plan = enforce(made, facts, actor.email);
  return { plan, warnings: await warn(env, plan, now) };
}
