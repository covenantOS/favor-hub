// The evaluation routes as one function, so tests call it with an actor and a path and the Pages Function is a thin shell.
import { HttpError, json, type Env } from '../http';
import { staffDirectory } from '../people';
import {
  EXAMPLE_NOTE, FORM_A, FORM_B, FREQUENCIES, RELATIONSHIPS, SCALE,
} from '../../../src/data/evaluation-forms';
import { requiredList, REVIEWERS_MAX, REVIEWERS_MIN } from './rules';
import {
  acknowledge, attachFinal, changeSupervisor, closeTerm, declineReview, listTerms, mine, pickList, reopenFinal, reopenForm, runNudges,
  saveAnswers, setMeeting, setReviewers, sign, startTerm, submitForm, termReport, viewCase, viewerOf, waitingOn, mayRunEvals, type Actor,
} from './service';
import { exportSheet } from './export';
import { evalSettings, mayUseEvals } from './settings';
import type { Ctx } from '../hub/sheets';

export type Out = Record<string, unknown> | Response;

const body = (b: unknown): Record<string, any> => (b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, any>) : {});

export function formsPayload() {
  return {
    forms: { A: FORM_A, B: FORM_B },
    scale: SCALE,
    exampleNote: EXAMPLE_NOTE,
    relationships: RELATIONSHIPS,
    frequencies: FREQUENCIES,
    limits: { reviewersMin: REVIEWERS_MIN, reviewersMax: REVIEWERS_MAX },
    required: { A: requiredList(FORM_A), B: requiredList(FORM_B) },
  };
}

export const NOT_OPEN = 'Evaluations are not open to everyone yet.';

export async function handle(env: Env, actor: Actor, method: string, path: string[], rawBody: unknown, url?: URL, ctx?: Ctx): Promise<Out> {
  const b = body(rawBody);
  if (!(await mayUseEvals(env, actor))) throw new HttpError(403, 'not_open', NOT_OPEN);
  const [a, b1, b2, b3] = path;
  const get = method === 'GET';
  if (a === 'forms' && get) return formsPayload();
  if (a === 'me' && get) {
    const v = await viewerOf(env, actor);
    return { ...(await mine(env, actor)), isAdmin: v.admin, settings: v.admin || v.hr ? await evalSettings(env) : undefined };
  }
  if (a === 'waiting' && get) return await waitingOn(env, actor);
  if (a === 'people' && get) {
    return { people: (await staffDirectory(env)).map((p) => ({ email: p.email, name: p.name, title: p.title, team: p.team, picture: p.picture })) };
  }

  if (a === 'case' && b1) {
    const id = b1;
    if (!b2 && get) return { view: await viewCase(env, actor, id) };
    if (b2 === 'answers' && method === 'PUT') return { ...(await saveAnswers(env, actor, id, String(b.form || ''), b.answers || [], { relationship: b.relationship, frequency: b.frequency })) };
    if (b2 === 'submit' && method === 'POST') return { ...(await submitForm(env, actor, id, String(b.form || ''))) };
    if (b2 === 'reviewers' && method === 'PUT') return { ...(await setReviewers(env, actor, id, b.reviewers || [], { fewer: b.fewer === true })) };
    if (b2 === 'decline' && method === 'POST') {
      await declineReview(env, actor, id, String(b.note || ''));
      return {};
    }
    if (b2 === 'reopen' && method === 'POST') {
      await reopenForm(env, actor, id, String(b.form || ''), b.reviewer);
      return {};
    }
    if (b2 === 'meeting' && method === 'POST') {
      await setMeeting(env, actor, id, { date: String(b.date || ''), time: String(b.time || ''), link: String(b.link || ''), leader: String(b.leader || '') });
      return {};
    }
    if (b2 === 'final' && method === 'POST') return { ...(await attachFinal(env, actor, id, String(b.url || ''))) };
    if (b2 === 'final-reopen' && method === 'POST') {
      await reopenFinal(env, actor, id);
      return {};
    }
    if (b2 === 'export' && method === 'POST') {
      const made = await exportSheet(env, actor, id, { part: String(b.part || ''), email: String(b.email || '') }, ctx);
      return { sheet: { id: made.id, url: made.url, title: made.title, label: made.label } };
    }
    if (b2 === 'acknowledge' && method === 'POST') {
      await acknowledge(env, actor, id, String(b.note || ''));
      return {};
    }
    if (b2 === 'sign' && method === 'POST') return { ...(await sign(env, actor, id)) };
    if (b2 === 'supervisor' && method === 'POST') {
      await changeSupervisor(env, actor, id, String(b.email || ''));
      return {};
    }
  }

  if (a === 'admin') {
    const v = await viewerOf(env, actor);
    if (!mayRunEvals(v)) throw new HttpError(403, 'forbidden', 'Evaluation administration is for HR and hub administrators.');
    if (b1 === 'terms' && get) return { terms: await listTerms(env, actor), hr: v.hr, admin: v.admin };
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
  }
  void url;
  throw new HttpError(404, 'not_found', 'There is nothing at that address.');
}

export const asJson = (o: Out): Response => (o instanceof Response ? o : json({ ok: true, ...o }));
