// Evaluation rules that need no database: what counts as complete, the averages the supervisor compares, the recurring themes,
// the three week calendar and who may read what. Pure functions, so tests and the page's preview run them directly.
import { answerable, COMPETENCIES, CATEGORIES, FORM_A, FORM_B, FORM_C, requiredText, type Form, type Question } from '../../../src/data/evaluation-forms';

export type FormId = 'A' | 'B' | 'C';

export interface Ans {
  qid: string;
  rating: number | null;
  text: string;
  example: string;
}

export const MAX_TEXT = 8000;

export const STAGES = ['self', 'feedback', 'summary', 'meeting', 'acknowledged', 'signed', 'done'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_WORD: Record<string, string> = {
  self: 'Self-assessment and reviewers',
  feedback: 'Feedback and supervisor review',
  summary: 'Supervisor summary',
  meeting: 'Meeting and acknowledgment',
  acknowledged: 'Waiting for HR to sign',
  signed: 'Signed',
  done: 'Complete',
};

export function formOf(id: string): Form {
  if (id === 'A') return FORM_A;
  if (id === 'B') return FORM_B;
  if (id === 'C') return FORM_C;
  throw new Error('no such form');
}

export const REVIEWERS_MIN = 3;
export const REVIEWERS_MAX = 5;
export const GOALS_MIN = 2;
export const GOALS_MAX = 4;

const blank = (s: unknown) => !String(s ?? '').trim();

/** Cleans one answer before it is saved: a rating is 0 to 5 or empty, text is trimmed and capped. */
export function cleanAnswer(form: Form, raw: { qid?: unknown; rating?: unknown; text?: unknown; example?: unknown }): Ans | null {
  const qid = String(raw.qid || '');
  const q = form.sections.flatMap((s) => s.questions).find((x) => x.id === qid);
  if (!q || q.kind === 'auto') return null;
  let rating: number | null = null;
  if (q.kind === 'rating' && raw.rating !== null && raw.rating !== undefined && raw.rating !== '') {
    const n = Number(raw.rating);
    if (Number.isInteger(n) && n >= 0 && n <= 5) rating = n;
  }
  let text = q.kind === 'rating' ? '' : String(raw.text ?? '').slice(0, MAX_TEXT);
  if (q.kind === 'choice') {
    const v = String(raw.text ?? '').trim();
    text = q.options?.includes(v) ? v : '';
  }
  const example = q.kind === 'rating' ? String(raw.example ?? '').slice(0, MAX_TEXT) : '';
  return { qid, rating, text, example };
}

export interface Gaps {
  /** Ratings left unanswered. */
  ratings: string[];
  /** A 1 or 2 with no example. */
  examples: string[];
  /** Required long answers (and the choices on Form B) left empty. */
  texts: string[];
}

/** What is still missing before a form may be submitted. */
export function gapsOf(form: Form, answers: Ans[]): Gaps {
  const by = new Map(answers.map((a) => [a.qid, a]));
  const g: Gaps = { ratings: [], examples: [], texts: [] };
  for (const q of answerable(form)) {
    const a = by.get(q.id);
    if (q.kind === 'rating') {
      if (!a || a.rating === null || a.rating === undefined) g.ratings.push(q.id);
      else if ((a.rating === 1 || a.rating === 2) && blank(a.example)) g.examples.push(q.id);
    } else if (q.kind === 'choice') {
      if (!a || blank(a.text)) g.texts.push(q.id);
    } else if (q.req && (!a || blank(a.text))) g.texts.push(q.id);
  }
  return g;
}

export const isComplete = (g: Gaps) => !g.ratings.length && !g.examples.length && !g.texts.length;

/** How far along a form is: required items answered of required items, plus the optional answers given. */
export function progressOf(form: Form, answers: Ans[]): { done: number; total: number; optional: number } {
  const by = new Map(answers.map((a) => [a.qid, a]));
  let done = 0;
  let total = 0;
  let optional = 0;
  for (const q of answerable(form)) {
    const a = by.get(q.id);
    const has = q.kind === 'rating' ? a?.rating !== null && a?.rating !== undefined : !blank(a?.text);
    const required = q.kind === 'rating' || q.kind === 'choice' || !!q.req;
    if (required) {
      total++;
      if (has) done++;
    } else if (has) optional++;
  }
  return { done, total, optional };
}

/* --------------------------------------------------------------------------------------------- averages and themes */

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

function ratingsOf(ans: Ans[], ids: string[]): number[] {
  const set = new Set(ids);
  return ans.filter((a) => set.has(a.qid) && a.rating !== null && a.rating > 0).map((a) => a.rating as number);
}

export interface CompetencyRow {
  id: string;
  label: string;
  category: string;
  self: number | null;
  others: number | null;
  /** Reviewers who rated it (Not Observed leaves a reviewer out). */
  raters: number;
  /** others minus self. Positive: others rate higher than the employee does. */
  gap: number | null;
}

/** Per-competency self against others. Never one overall score. Not Observed (0) is left out of every average. */
export function competencyAverages(self: Ans[], reviewers: Ans[][]): { rows: CompetencyRow[]; categories: Array<{ category: string; self: number | null; others: number | null }> } {
  const rows: CompetencyRow[] = COMPETENCIES.map((c) => {
    const s = avg(ratingsOf(self, c.a));
    const per = reviewers.map((r) => avg(ratingsOf(r, c.b))).filter((x): x is number => x !== null);
    const o = avg(per);
    return { id: c.id, label: c.label, category: c.category, self: s, others: o, raters: per.length, gap: s !== null && o !== null ? Math.round((o - s) * 100) / 100 : null };
  });
  const categories = CATEGORIES.map((cat) => {
    const mine = rows.filter((r) => r.category === cat);
    return { category: cat, self: avg(mine.map((r) => r.self).filter((x): x is number => x !== null)), others: avg(mine.map((r) => r.others).filter((x): x is number => x !== null)) };
  });
  return { rows, categories };
}

const STOP = new Set(
  'a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours he is very really always often well great good work works worked working team employee person'.split(' ')
);

/** Words several different reviewers used in their written answers. A reviewer who repeats a word counts once. */
export function textThemes(reviewerTexts: string[][], minPeople = 2, limit = 12): Array<{ word: string; people: number }> {
  const seen = new Map<string, number>();
  for (const texts of reviewerTexts) {
    const mine = new Set<string>();
    for (const t of texts) {
      for (const w of String(t).toLowerCase().match(/[a-z][a-z'-]{3,}/g) || []) {
        const word = w.replace(/'s$/, '');
        if (!STOP.has(word)) mine.add(word);
      }
    }
    for (const w of mine) seen.set(w, (seen.get(w) || 0) + 1);
  }
  return [...seen.entries()]
    .filter(([, n]) => n >= minPeople)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word, people]) => ({ word, people }));
}

export interface Themes {
  strengths: CompetencyRow[];
  growth: CompetencyRow[];
  /** Where self and others differ by a full point or more. */
  gaps: CompetencyRow[];
  words: Array<{ word: string; people: number }>;
}

/** Recurring themes: competencies others rate high or low together, big gaps, and words several reviewers share. */
export function themesOf(rows: CompetencyRow[], reviewerTexts: string[][]): Themes {
  const rated = rows.filter((r) => r.others !== null && r.raters >= 2);
  return {
    strengths: rated.filter((r) => (r.others as number) >= 4).sort((a, b) => (b.others as number) - (a.others as number)).slice(0, 5),
    growth: rated.filter((r) => (r.others as number) < 3.5).sort((a, b) => (a.others as number) - (b.others as number)).slice(0, 5),
    gaps: rows.filter((r) => r.gap !== null && Math.abs(r.gap as number) >= 1).sort((a, b) => Math.abs(b.gap as number) - Math.abs(a.gap as number)).slice(0, 6),
    words: textThemes(reviewerTexts),
  };
}

/* ---------------------------------------------------------------------------------------------------- calendar */

export const addDays = (iso: string, n: number): string => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Week 1 ends 7 days after the start, week 2 after 14, week 3 after 21. */
export function weekDue(startsOn: string): { w1: string; w2: string; w3: string } {
  return { w1: addDays(startsOn, 7), w2: addDays(startsOn, 14), w3: addDays(startsOn, 21) };
}

export const todayEt = (now: Date = new Date()): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + 'T12:00:00Z').getTime());

/** "January to June 2027" for a start date: the half year the date falls in. */
export function periodFor(startsOn: string): string {
  const y = startsOn.slice(0, 4);
  return Number(startsOn.slice(5, 7)) <= 6 ? `January to June ${y}` : `July to December ${y}`;
}

/**
 * Staff grouped by start date for the semiannual cycle. The first group holds people who started January to June, the second July to
 * December (Rachel's first group is January to June starters). A person with no start date goes in the group the admin picks.
 */
export function groupByStart(startDate: string | null | undefined): 'first' | 'second' | 'unknown' {
  const m = Number(String(startDate || '').slice(5, 7));
  if (!m) return 'unknown';
  return m <= 6 ? 'first' : 'second';
}

/* ---------------------------------------------------------------------------------------------------------- access */

export interface CaseFacts {
  employee: string;
  supervisor: string;
}

export interface Viewer {
  email: string;
  admin: boolean;
  hr: boolean;
}

/** Raw feedback (each reviewer's answers with their name): the supervisor, HR and hub admins, never the employee about themselves. */
export function mayReadRaw(v: Viewer, c: CaseFacts): boolean {
  if (v.email === c.employee) return false;
  return v.email === c.supervisor || v.hr || v.admin;
}

/** The employee's own self-assessment: the employee, and the people who may read raw feedback. */
export function mayReadSelf(v: Viewer, c: CaseFacts): boolean {
  return v.email === c.employee || mayReadRaw(v, c);
}

/** Admin rights in evaluations: a hub admin or someone marked HR. Not the employee's own evaluation. */
export function mayManage(v: Viewer, c: CaseFacts): boolean {
  return (v.admin || v.hr) && v.email !== c.employee;
}

export function stageAtLeast(stage: string, min: Stage): boolean {
  return STAGES.indexOf(stage as Stage) >= STAGES.indexOf(min);
}

/** The required long answers in the first rollout, for the result file and the form notes. */
export function requiredList(form: Form): Array<{ n: number | undefined; text: string }> {
  return requiredText(form).map((q: Question) => ({ n: q.n, text: q.text }));
}
