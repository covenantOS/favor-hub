import { errorJson, handleError, nowIso, type Env } from '../../_lib/http';
import { logAuth } from '../../_lib/session';
import { weekDue } from '../../_lib/evals/rules';
import { resetSample } from '../../_lib/mail/sample';
import { TESTER2_EMAIL, TESTER2_NAME, TESTER_EMAIL, TESTER_NAME, agentKeyOk, ensureTesters } from '../../_lib/testuser';

const TERM = 'evt_qa_tester';
const CASE = 'evc_qa_tester';
const RUN = 'onb_qa_tester';
const MEETINGS = ['a0a0a0a0a0a0a0a0a0a0a0a1', 'a0a0a0a0a0a0a0a0a0a0a0a2'];
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/**
 * Sets up the test users' sample data (agent key only, safe to repeat): the reporting line between them, an open evaluation term, a
 * first week for Tester Two, two upcoming meetings between them and a fresh sample mailbox. Nothing here reaches a real person: the
 * rows are for the two test addresses, which no staff list, count or notice includes. Documented in docs/TEST-USER.md.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!agentKeyOk(env, request)) return errorJson('forbidden', 'The test seed needs the agent key.', 403);
    await ensureTesters(env);
    const now = nowIso();
    const day = today();
    const db = env.DB;
    // Who reports to whom.
    await db.prepare(`INSERT INTO hub_reporting (email, supervisor_email, department, title, start_date, updated_by, updated_at) VALUES (?, ?, 'Operations', 'Test employee', ?, 'test-seed', ?)
      ON CONFLICT(email) DO UPDATE SET supervisor_email = excluded.supervisor_email, updated_at = excluded.updated_at`).bind(TESTER_EMAIL, TESTER2_EMAIL, '2025-01-06', now).run();
    await db.prepare(`INSERT INTO hub_reporting (email, supervisor_email, department, title, start_date, updated_by, updated_at) VALUES (?, ?, 'Partner Care', 'Associate', ?, 'test-seed', ?)
      ON CONFLICT(email) DO UPDATE SET supervisor_email = excluded.supervisor_email, start_date = excluded.start_date, updated_at = excluded.updated_at`).bind(TESTER2_EMAIL, TESTER_EMAIL, day, now).run();
    // An open evaluation term: Tester is the employee, Tester Two the supervisor.
    const due = weekDue(day);
    await db.prepare(`INSERT OR IGNORE INTO eval_terms (id, name, period_label, starts_on, status, created_by, created_at) VALUES (?, 'QA test evaluations', 'QA test period', ?, 'open', ?, ?)`).bind(TERM, day, TESTER_EMAIL, now).run();
    await db.prepare(`INSERT OR IGNORE INTO eval_cases (id, term_id, employee_email, supervisor_email, stage, w1_due, w2_due, w3_due, created_at, updated_at) VALUES (?, ?, ?, ?, 'self', ?, ?, ?, ?, ?)`).bind(CASE, TERM, TESTER_EMAIL, TESTER2_EMAIL, due.w1, due.w2, due.w3, now, now).run();
    // Tester Two is in week one: an onboarding run that started today, supervised by Tester.
    await db.prepare(`INSERT INTO onb_runs (id, kind, email, name, title, team, supervisor_email, date, status, hq, welcome, hub_done, created_by, created_at, updated_at)
      VALUES (?, 'onboard', ?, ?, 'Associate', 'Partner Care', ?, ?, 'active', 1, 'Welcome to the test team.', 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET date = excluded.date, status = 'active', updated_at = excluded.updated_at`).bind(RUN, TESTER2_EMAIL, TESTER2_NAME, TESTER_EMAIL, day, TESTER_EMAIL, now, now).run();
    // Two upcoming meetings between them, tomorrow and the day after.
    const people = JSON.stringify([{ email: TESTER2_EMAIL, name: TESTER2_NAME, team: 'Test', guest: false }]);
    for (const [i, id] of MEETINGS.entries()) {
      const start = new Date(Date.now() + (i + 1) * 86400000);
      start.setUTCHours(15, 0, 0, 0);
      const end = new Date(start.getTime() + 30 * 60000);
      await db.prepare(`INSERT INTO hub_meetings (id, title, agenda, host_email, host_name, starts_at, ends_at, duration_min, rec_mode, access, invitees, status, remind, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 30, 'notes', 'invited', ?, 'scheduled', 0, ?)
        ON CONFLICT(id) DO UPDATE SET starts_at = excluded.starts_at, ends_at = excluded.ends_at, status = 'scheduled', remind = 0`)
        .bind(id, i ? 'Test one-on-one' : 'Test planning check-in', 'A meeting between the two test users.', TESTER_EMAIL, TESTER_NAME, start.toISOString(), end.toISOString(), people, now).run();
    }
    await resetSample(env, TESTER_EMAIL);
    await resetSample(env, TESTER2_EMAIL);
    await logAuth(env, request, TESTER_EMAIL, 'test_seed', 'agent key');
    return new Response(JSON.stringify({ ok: true, term: TERM, case: CASE, run: RUN, meetings: MEETINGS }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleError(err);
  }
};
