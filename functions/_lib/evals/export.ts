// Export to Google Sheets. The supervisor, HR and hub admins export the self-evaluation and each reviewer's answers as SEPARATE sheets,
// the reviewer's name next to every answer. Leadership combines them. FavorOS never writes the review itself (Rachel Cox, 2026-10-15).
//
// The sheet is made in the exporter's own Drive through the same writer the Favor Brain uses (hub/sheets.ts, drive.file scope,
// private to the person). The rule is the one that reads raw feedback: the supervisor, HR and admins, never the employee about themselves.
import { HttpError, type Env } from '../http';
import { audit } from '../admin/settings';
import { createSheet, type Col, type Ctx, type Result, type Spec, type Tab } from '../hub/sheets';
import { FORM_A, FORM_B, SCALE, type Form } from '../../../src/data/evaluation-forms';
import { answersOf, caseOf, names, reviewersOf, viewerOf, who, type Actor } from './service';
import { mayReadRaw, type Ans } from './rules';

const lower = (s: unknown) => String(s || '').trim().toLowerCase();

const COLS_SELF: Col[] = [
  { key: 'section', label: 'Section', type: 'text' },
  { key: 'n', label: '#', type: 'text' },
  { key: 'question', label: 'Question', type: 'text' },
  { key: 'rating', label: 'Rating', type: 'text' },
  { key: 'answer', label: 'Answer', type: 'text' },
  { key: 'example', label: 'Example given for a 1 or 2', type: 'text' },
];
const COLS_REVIEWER: Col[] = [{ key: 'reviewer', label: 'Reviewer', type: 'text' }, { key: 'relationship', label: 'Working relationship', type: 'text' }, ...COLS_SELF];

const ratingWord = (n: number | null | undefined): string => {
  if (n === null || n === undefined) return '';
  const s = SCALE.find((x) => x.value === n);
  return s ? `${s.short} ${s.label}` : String(n);
};

/** One row per question in the form's own order, so a reader finds the same question in the same place on every sheet. */
export function rowsFor(form: Form, answers: Ans[], extra: Record<string, string> = {}): Array<Record<string, unknown>> {
  const by = new Map(answers.map((a) => [a.qid, a]));
  const out: Array<Record<string, unknown>> = [];
  for (const sec of form.sections) {
    for (const q of sec.questions) {
      if (q.kind === 'auto') continue;
      const a = by.get(q.id);
      out.push({ ...extra, section: sec.title, n: q.n ?? '', question: q.text, rating: q.kind === 'rating' ? ratingWord(a?.rating) : '', answer: q.kind === 'rating' ? '' : a?.text || '', example: a?.example || '' });
    }
  }
  return out;
}

export interface ExportInput {
  part?: string;
  email?: string;
}

/** Builds the tabs and the title for one export. Throws 403 when the actor may not read raw answers. */
export async function exportSpec(env: Env, actor: Actor, caseId: string, input: ExportInput): Promise<{ title: string; tab: Tab; label: string }> {
  const c = await caseOf(env, caseId);
  const v = await viewerOf(env, actor);
  if (!mayReadRaw(v, { employee: c.employee_email, supervisor: lower(c.supervisor_email) })) throw new HttpError(403, 'forbidden', 'The supervisor, HR and administrators export the answers. Nobody exports their own.');
  const dir = await names(env);
  const emp = who(dir, c.employee_email);
  if (input.part === 'self') {
    if (!c.self_submitted_at) throw new HttpError(409, 'not_in', `${emp.name} has not submitted the self-evaluation yet.`);
    const rows = rowsFor(FORM_A, await answersOf(env, c.id, 'A', c.employee_email));
    return { title: `Self-evaluation, ${emp.name}, ${c.period_label}`, tab: { name: 'Self-evaluation', columns: COLS_SELF, rows }, label: 'self-evaluation' };
  }
  if (input.part === 'reviewer') {
    const email = lower(input.email);
    const r = (await reviewersOf(env, c.id)).find((x) => x.reviewer_email === email);
    if (!r) throw new HttpError(404, 'no_reviewer', 'That person is not a reviewer on this evaluation.');
    if (r.status !== 'submitted') throw new HttpError(409, 'not_in', `${who(dir, email).name} has not submitted feedback yet.`);
    const name = who(dir, email).name;
    const rows = rowsFor(FORM_B, await answersOf(env, c.id, 'B', email), { reviewer: name, relationship: r.relationship });
    return { title: `Feedback from ${name} on ${emp.name}, ${c.period_label}`, tab: { name: name.slice(0, 60), columns: COLS_REVIEWER, rows }, label: `feedback from ${name}` };
  }
  throw new HttpError(400, 'bad_part', 'Pick the self-evaluation or one reviewer.');
}

/** Makes one sheet in the exporter's Drive and records who exported what. No answer text is written to the audit log. */
export async function exportSheet(env: Env, actor: Actor, caseId: string, input: ExportInput, ctx?: Ctx): Promise<Result & { label: string }> {
  const { title, tab, label } = await exportSpec(env, actor, caseId, input);
  const spec: Spec = {
    mode: 'rows',
    title,
    tabs: [tab],
    classes: ['staff'],
    provenance: { kind: 'server', page: 'Evaluations', filters: 'Private HR information. Combine the sheets yourself, then keep them with the evaluation.' },
  };
  const made = await createSheet(env, { email: actor.email, name: actor.name, via: 'session' }, spec, undefined, ctx);
  await audit(env, { actor: actor.email, area: 'evaluations', key: `${caseId}:export`, label: `Exported ${label} to Google Sheets`, before: null, after: String(input.part || '') }).catch(() => undefined);
  return { ...made, label };
}
