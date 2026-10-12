// The evaluation routes as one function, so tests call it with an actor and a path and the Pages Function is a thin shell.
import { HttpError, json, type Env } from '../http';
import { staffDirectory } from '../people';
import {
  EXAMPLE_NOTE, FORM_A, FORM_B, FORM_C, FREQUENCIES, PLAN_AREAS, RELATIONSHIPS, SCALE,
} from '../../../src/data/evaluation-forms';
import { requiredList, REVIEWERS_MAX, REVIEWERS_MIN, GOALS_MAX, GOALS_MIN } from './rules';
import {
  acknowledge, caseOf, changeSupervisor, closeTerm, declineReview, listTerms, mine, pickList, reopenForm, retryDocument, reviewGoal, runNudges,
  saveAnswers, saveGoals, setMeeting, setReviewers, sign, startTerm, submitForm, termReport, viewCase, viewerOf, waitingOn, mayRunEvals, type Actor,
} from './service';
import { courseList } from './learning';
import { evalFolder, pdfFor, setEvalFolder } from './drive';
import { mayReadRaw } from './rules';

export type Out = Record<string, unknown> | Response;

const body = (b: unknown): Record<string, any> => (b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, any>) : {});

export function formsPayload() {
  return {
    forms: { A: FORM_A, B: FORM_B, C: FORM_C },
    scale: SCALE,
    exampleNote: EXAMPLE_NOTE,
    relationships: RELATIONSHIPS,
    frequencies: FREQUENCIES,
    planAreas: PLAN_AREAS,
    limits: { reviewersMin: REVIEWERS_MIN, reviewersMax: REVIEWERS_MAX, goalsMin: GOALS_MIN, goalsMax: GOALS_MAX },
    required: { A: requiredList(FORM_A), B: requiredList(FORM_B), C: requiredList(FORM_C) },
  };
}

export async function handle(env: Env, actor: Actor, method: string, path: string[], rawBody: unknown, url?: URL): Promise<Out> {
  const b = body(rawBody);
  const [a, b1, b2, b3] = path;
  const get = method === 'GET';
  if (a === 'forms' && get) return formsPayload();
  if (a === 'me' && get) {
    const v = await viewerOf(env, actor);
    return { ...(await mine(env, actor)), isAdmin: v.admin };
  }
  if (a === 'waiting' && get) return await waitingOn(env, actor);
  if (a === 'people' && get) {
    return { people: (await staffDirectory(env)).map((p) => ({ email: p.email, name: p.name, title: p.title, team: p.team, picture: p.picture })) };
  }
  if (a === 'courses' && get) return { courses: await courseList(env) };

  if (a === 'case' && b1) {
    const id = b1;
    if (!b2 && get) return { view: await viewCase(env, actor, id) };
    if (b2 === 'answers' && method === 'PUT') return { ...(await saveAnswers(env, actor, id, String(b.form || ''), b.answers || [], { relationship: b.relationship, frequency: b.frequency })) };
    if (b2 === 'submit' && method === 'POST') return { ...(await submitForm(env, actor, id, String(b.form || ''), { proceedWithFewer: b.proceedWithFewer === true, meetingOn: b.meetingOn })) };
    if (b2 === 'reviewers' && method === 'PUT') return { ...(await setReviewers(env, actor, id, b.reviewers || [], { fewer: b.fewer === true })) };
    if (b2 === 'decline' && method === 'POST') {
      await declineReview(env, actor, id);
      return {};
    }
    if (b2 === 'reopen' && method === 'POST') {
      await reopenForm(env, actor, id, String(b.form || ''), b.reviewer);
      return {};
    }
    if (b2 === 'goals' && method === 'PUT') return { goals: await saveGoals(env, actor, id, b.goals || []) };
    if (b2 === 'goal-review' && method === 'POST') {
      await reviewGoal(env, actor, String(b.goalId || ''), String(b.status || ''), String(b.note || ''));
      return {};
    }
    if (b2 === 'meeting' && method === 'POST') {
      await setMeeting(env, actor, id, String(b.date || ''));
      return {};
    }
    if (b2 === 'acknowledge' && method === 'POST') {
      await acknowledge(env, actor, id, String(b.note || ''));
      return {};
    }
    if (b2 === 'sign' && method === 'POST') return { ...(await sign(env, actor, id)) };
    if (b2 === 'doc' && method === 'POST') return { ...(await retryDocument(env, actor, id)) };
    if (b2 === 'supervisor' && method === 'POST') {
      await changeSupervisor(env, actor, id, String(b.email || ''));
      return {};
    }
    if (b2 === 'pdf' && get) {
      const c = await caseOf(env, id);
      const v = await viewerOf(env, actor);
      const me = actor.email.toLowerCase();
      const facts = { employee: c.employee_email, supervisor: (c.supervisor_email || '').toLowerCase() };
      const allowed = mayReadRaw(v, facts) || (me === c.employee_email && !!c.summary_submitted_at);
      if (!allowed) throw new HttpError(403, 'forbidden', 'The document opens once your supervisor shares the summary.');
      const pdf = await pdfFor(env, id);
      return new Response(pdf.bytes, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${pdf.name.replace(/[^A-Za-z0-9 ._-]/g, '')}"`, 'Cache-Control': 'private, no-store' } });
    }
  }

  if (a === 'admin') {
    const v = await viewerOf(env, actor);
    if (!mayRunEvals(v)) throw new HttpError(403, 'forbidden', 'Evaluation administration is for HR and hub administrators.');
    if (b1 === 'terms' && get) return { terms: await listTerms(env, actor), folder: await evalFolder(env), hr: v.hr, admin: v.admin };
    if (b1 === 'terms' && method === 'POST') return { ...(await startTerm(env, actor, b)) };
    if (b1 === 'pick' && get) return { people: await pickList(env, actor) };
    if (b1 === 'gaps' && get) {
      // Who has nobody under Reports to in Admin > People. The page asks an admin to fill it in; no manager is ever guessed.
      const all = await pickList(env, actor);
      return { total: all.length, missing: all.filter((p) => !p.hasSupervisor).map((p) => ({ email: p.email, name: p.name, title: p.title, team: p.team })) };
    }
    if (b1 === 'term' && b2 && get) return { ...(await termReport(env, actor, b2)) };
    if (b1 === 'term' && b2 && b3 === 'close' && method === 'POST') {
      await closeTerm(env, actor, b2);
      return {};
    }
    if (b1 === 'nudge' && method === 'POST') return { ...(await runNudges(env)) };
    if (b1 === 'folder' && method === 'PUT') {
      try {
        return { folder: await setEvalFolder(env, actor.email, String(b.folder || '')) };
      } catch (e) {
        throw new HttpError(400, 'bad_folder', (e as Error).message);
      }
    }
  }
  void url;
  throw new HttpError(404, 'not_found', 'There is nothing at that address.');
}

export const asJson = (o: Out): Response => (o instanceof Response ? o : json({ ok: true, ...o }));
