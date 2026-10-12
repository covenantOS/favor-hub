// The final evaluation document: what the employee's file holds and what the employee downloads.
// It carries the supervisor's summary, the self against others averages, the six-month plan, the acknowledgment and the HR signature,
// and the employee's own self-assessment as an appendix. It never carries a reviewer's words or name: those stay in the hub.
import type { Env } from '../http';
import { FORM_A, FORM_C, SCALE, type Form } from '../../../src/data/evaluation-forms';
import { reportingOf } from '../people-dev';
import { answersOf, caseOf, goalsOf, longDate, names, reviewersOf, who, type GoalRow } from './service';
import { competencyAverages, type Ans } from './rules';

export interface DocSection {
  heading: string;
  paras?: string[];
  qa?: Array<{ q: string; a: string }>;
  table?: { head: string[]; rows: string[][] };
}

export interface EvalDoc {
  title: string;
  fileName: string;
  meta: Array<[string, string]>;
  sections: DocSection[];
  status: string;
}

const fmt = (n: number | null) => (n === null ? 'n/a' : n.toFixed(1));
const dash = (s: string) => s.trim() || 'No answer.';

function qaOf(form: Form, answers: Ans[]): Array<{ q: string; a: string }> {
  const by = new Map(answers.map((a) => [a.qid, a]));
  const out: Array<{ q: string; a: string }> = [];
  for (const s of form.sections) {
    for (const q of s.questions) {
      if (q.kind === 'auto') continue;
      const a = by.get(q.id);
      if (q.kind === 'rating') {
        const sc = SCALE.find((x) => x.value === a?.rating);
        out.push({ q: `${q.n}. ${q.text}`, a: sc ? `${sc.short} ${sc.label}${a?.example ? `. Example: ${a.example}` : ''}` : 'Not rated.' });
      } else out.push({ q: `${q.n ? q.n + '. ' : ''}${q.text}`, a: dash(a?.text || '') });
    }
  }
  return out;
}

export async function buildDocument(env: Env, caseId: string): Promise<EvalDoc> {
  const c = await caseOf(env, caseId);
  const dir = await names(env);
  const emp = who(dir, c.employee_email);
  const sup = who(dir, c.supervisor_email);
  const rep = await reportingOf(env, c.employee_email);
  const self = await answersOf(env, c.id, 'A', c.employee_email);
  const sumAns = await answersOf(env, c.id, 'C', (c.supervisor_email || '').toLowerCase());
  const goals = await goalsOf(env, c.id);
  const revs = (await reviewersOf(env, c.id)).filter((r) => r.status === 'submitted');
  const others: Ans[][] = [];
  for (const r of revs) others.push(await answersOf(env, c.id, 'B', r.reviewer_email));
  const avg = competencyAverages(self, others);
  const sections: DocSection[] = [];
  sections.push({ heading: 'Supervisor Evaluation', qa: qaOf(FORM_C, sumAns) });
  sections.push({
    heading: 'Self-assessment and feedback, by competency',
    paras: [`Averages on the 1 to 5 scale. Others are ${revs.length} reviewer${revs.length === 1 ? '' : 's'}. Not Observed answers are left out. There is no overall score. Reviewers' comments are not part of this document.`],
    table: {
      head: ['Competency', 'Self', 'Others', 'Reviewers'],
      rows: avg.rows.filter((r) => r.self !== null || r.others !== null).map((r) => [r.label, fmt(r.self), fmt(r.others), String(r.raters)]),
    },
  });
  sections.push({
    heading: 'By category',
    table: { head: ['Category', 'Self', 'Others'], rows: avg.categories.map((x) => [x.category, fmt(x.self), fmt(x.others)]) },
  });
  sections.push({
    heading: 'Six-month development plan',
    paras: ['Revisited at the next evaluation.'],
    table: { head: ['Development area', 'Goal', 'Action steps', 'Support needed', 'Target date'], rows: goals.map((g: GoalRow) => [g.area, g.goal, g.steps, g.support || 'None listed', g.target_date ? longDate(g.target_date) : '']) },
  });
  const prior = (
    await env.DB.prepare(
      `SELECT g.area, g.goal, g.review_status, g.review_note FROM eval_goals g JOIN eval_cases x ON x.id = g.case_id JOIN eval_terms t ON t.id = x.term_id
        WHERE g.employee_email = ? AND g.case_id != ? AND t.starts_on < ? ORDER BY t.starts_on DESC, g.created_at LIMIT 8`
    ).bind(c.employee_email, c.id, c.starts_on).all<{ area: string; goal: string; review_status: string; review_note: string }>()
  ).results || [];
  if (prior.length) {
    const word: Record<string, string> = { met: 'Met', partly: 'Partly met', not_met: 'Not met', '': 'Not recorded' };
    sections.push({ heading: 'Goals from the last evaluation', table: { head: ['Goal', 'Result', 'Note'], rows: prior.map((g) => [g.goal, word[g.review_status] || g.review_status, g.review_note]) } });
  }
  sections.push({
    heading: 'Meeting and acknowledgment',
    paras: [
      c.meeting_on ? `Meeting held ${longDate(c.meeting_on)}.` : 'Meeting date not recorded.',
      c.acknowledged_at ? `${emp.name} acknowledged this evaluation on ${longDate(c.acknowledged_at.slice(0, 10))}.${c.acknowledged_note ? ` Note from ${emp.name}: ${c.acknowledged_note}` : ''}` : 'Not yet acknowledged.',
      c.signed_at ? `Signed for HR by ${who(dir, c.signed_by).name} on ${longDate(c.signed_at.slice(0, 10))}.` : 'Not yet signed.',
    ],
  });
  sections.push({ heading: 'Appendix: Employee Self-Assessment (Form A)', qa: qaOf(FORM_A, self) });
  return {
    title: `Employee Evaluation: ${emp.name}`,
    fileName: `${emp.name} evaluation ${c.period_label}`,
    meta: [
      ['Employee', emp.name],
      ['Job title', rep.title || emp.title || ''],
      ['Department', rep.department || emp.team || ''],
      ['Immediate supervisor', sup.name],
      ['Evaluation period', c.period_label],
    ],
    sections,
    status: c.signed_at ? 'Signed' : 'Unsigned draft',
  };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] || ch));

/** HTML Google Drive turns into a Google Doc. Plain headings, paragraphs and tables so the Doc is easy to edit. */
export function docHtml(d: EvalDoc): string {
  const out = [`<html><head><meta charset="utf-8"><title>${esc(d.title)}</title></head><body style="font-family:Arial,sans-serif;font-size:11pt">`, `<h1>${esc(d.title)}</h1>`];
  out.push(`<table border="1" cellpadding="5" style="border-collapse:collapse">${d.meta.map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join('')}</table>`);
  for (const s of d.sections) {
    out.push(`<h2>${esc(s.heading)}</h2>`);
    for (const p of s.paras || []) out.push(`<p>${esc(p)}</p>`);
    for (const x of s.qa || []) out.push(`<p><b>${esc(x.q)}</b><br>${esc(x.a).replace(/\n/g, '<br>')}</p>`);
    if (s.table) out.push(`<table border="1" cellpadding="5" style="border-collapse:collapse"><tr>${s.table.head.map((h) => `<th align="left">${esc(h)}</th>`).join('')}</tr>${s.table.rows.map((r) => `<tr>${r.map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</table>`);
  }
  out.push('</body></html>');
  return out.join('\n');
}
