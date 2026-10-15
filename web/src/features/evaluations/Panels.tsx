// The read and action panels of one evaluation: overview, reviewers, the year's evidence, feedback, compare, summary and plan, sign-off.
// Same markup and class names as public/js/evaluations.js drew.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink } from '@/shell/NavLink';
import { evalCall } from './api';
import { FormEditor, FormLocked, FormRead, Intro, Lines, SectionBlock, rowHandlers } from './Forms';
import { toast } from './toast';
import {
  GOAL_WORD, NEW_GOAL, STEPS, activeReviewers, askHint, barWidth, caseHref, dateWord, gapText, gapsOf, goalsBody, goalComplete, isBigGap, merged, num, percent, plural,
  reviewerHits, rowsByCategory, stepNow, todayEt, totalsOf, type Ans, type CaseView, type FormsPayload, type Goal, type Person,
} from './logic';
import type { Saver } from './useSaver';

export interface Ctx {
  view: CaseView;
  forms: FormsPayload;
  meName: string;
  staff: Person[];
  courses: Array<{ id: string; title: string }>;
  saver: Saver;
  reload: () => Promise<unknown>;
  patch: (fn: (v: CaseView) => CaseView) => void;
  pick: string[];
  setPick: (p: string[]) => void;
  reviewerQ: string;
  setReviewerQ: (q: string) => void;
  /** Move to another view of this evaluation, replacing the entry in history. */
  replace: (href: string) => void;
}

const cid = (v: CaseView) => encodeURIComponent(v.case.id);
const fail = (e: unknown) => toast((e as Error).message, true);

async function busy(setB: (b: boolean) => void, fn: () => Promise<unknown>) {
  setB(true);
  try {
    await fn();
  } catch (e) {
    fail(e);
  }
  setB(false);
}

function Check({ done, text, extra }: { done: boolean; text: string; extra?: string }) {
  return (
    <li className={done ? 'is-done' : ''}>
      <span className="ev-tick" aria-hidden="true">
        {done ? '✓' : ''}
      </span>
      <span>
        {text}
        {extra ? (
          <>
            {' '}
            <em>{extra}</em>
          </>
        ) : null}
      </span>
    </li>
  );
}

function Stepper({ stage, due }: { stage: string; due: { w1: string; w2: string; w3: string } }) {
  const { cur, done } = stepNow(stage);
  return (
    <ol className="ev-steps" aria-label="Where this evaluation is">
      {STEPS(due).map((s, i) => {
        const st = done || i + 1 < cur ? 'is-done' : i + 1 === cur ? 'is-now' : '';
        return (
          <li className={st} key={s.label}>
            <span className="ev-steps__n">{st === 'is-done' ? '✓' : i + 1}</span>
            <span className="ev-steps__t">
              <b>{s.label}</b>
              {s.text}
              <em>Due {dateWord(s.due)}</em>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------------------------------------------- overview */

function Prior({ x, canReview }: { x: Ctx; canReview: boolean }) {
  const goals = x.view.priorGoals || [];
  return (
    <section className="ev-panel">
      <h2>Goals from the last evaluation{goals[0] && goals[0].period ? ' (' + goals[0].period + ')' : ''}</h2>
      <ul className="ev-goals">
        {goals.map((g) => (
          <li className="ev-goal" key={g.id}>
            <div>
              <b>{g.goal}</b>
              <span className="ev-sub">
                {g.area}
                {g.target_date ? ' · Target ' + dateWord(g.target_date) : ''}
              </span>
            </div>
            {canReview ? <GoalReview x={x} g={g} /> : <span className="ev-chip ev-chip--quiet">{GOAL_WORD[g.review_status] || ''}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function GoalReview({ x, g }: { x: Ctx; g: Goal }) {
  const [status, setStatus] = useState(g.review_status);
  const [note, setNote] = useState(g.review_note);
  const saved = useRef({ status: g.review_status, note: g.review_note });
  const save = (s: string, n: string) => {
    evalCall('POST', 'case/' + cid(x.view) + '/goal-review', { goalId: g.id, status: s, note: n })
      .then(() => {
        saved.current = { status: s, note: n };
        x.patch((v) => ({ ...v, priorGoals: (v.priorGoals || []).map((p) => (p.id === g.id ? { ...p, review_status: s, review_note: n } : p)) }));
        toast('Saved.');
      })
      .catch(fail);
  };
  return (
    <div className="ev-goal__rv">
      <select
        data-goalrv={g.id}
        aria-label="How this goal went"
        value={status}
        onChange={(e) => {
          setStatus(e.target.value);
          save(e.target.value, note);
        }}
      >
        {['', 'met', 'partly', 'not_met'].map((k) => (
          <option key={k} value={k}>
            {GOAL_WORD[k]}
          </option>
        ))}
      </select>
      <input
        data-goalnote={g.id}
        value={note}
        placeholder="Note"
        maxLength={300}
        aria-label="Note on this goal"
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => {
          if (note !== saved.current.note) save(status, note);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </div>
  );
}

function SupervisorPick({ x }: { x: Ctx }) {
  const c = x.view.case;
  const [val, setVal] = useState(c.supervisor.email);
  useEffect(() => setVal(c.supervisor.email), [c.supervisor.email]);
  return (
    <section className="ev-panel">
      <h2>Supervisor</h2>
      <label className="ev-field">
        <span>Who supervises this evaluation</span>
        <select
          id="ev-sup"
          value={val}
          onChange={(e) => {
            const prev = val;
            setVal(e.target.value);
            evalCall('POST', 'case/' + cid(x.view) + '/supervisor', { email: e.target.value })
              .then(() => {
                toast('Supervisor saved.');
                return x.reload();
              })
              .catch((er) => {
                setVal(prev);
                fail(er);
              });
          }}
        >
          <option value="">Not assigned</option>
          {x.staff
            .filter((p) => p.email !== c.employee.email)
            .map((p) => (
              <option key={p.email} value={p.email}>
                {p.name}
              </option>
            ))}
        </select>
      </label>
    </section>
  );
}

export function Overview({ x }: { x: Ctx }) {
  const { view: v, forms } = x;
  const c = v.case;
  const r = v.role;
  const lim = forms.limits;
  const rv = v.reviewers || [];
  const act = activeReviewers(rv);
  const sent = rv.filter((y) => y.status === 'submitted').length;
  const F = forms.forms;
  return (
    <>
      <section className="ev-panel">
        <p className="ev-next ev-next--big">{v.next}</p>
        <Stepper stage={c.stage} due={c.due} />
        {r.employee ? (
          <>
            <ul className="ev-checks">
              <Check done={c.selfSubmitted} text="Self-assessment (Form A)" extra={c.selfSubmitted ? '' : v.self && v.self.progress ? v.self.progress.done + ' of ' + v.self.progress.total + ' required answers' : ''} />
              <Check done={act.length >= lim.reviewersMin} text={'Name ' + lim.reviewersMin + ' to ' + lim.reviewersMax + ' people for feedback'} extra={sent + ' of ' + act.length + ' sent their feedback'} />
              <Check done={c.summaryShared} text="Your supervisor shares the summary and your plan" />
              <Check done={!!c.acknowledgedAt} text={'You acknowledge after the meeting' + (c.meetingOn ? ' on ' + dateWord(c.meetingOn) : '')} />
              <Check done={!!c.signedAt} text="HR signs" />
            </ul>
            <div className="ev-acts">
              {c.stage === 'self' && c.termOpen ? (
                <NavLink className="h-btn h-btn--primary" href={caseHref(c.id, c.selfSubmitted ? 'reviewers' : 'self')}>
                  {c.selfSubmitted ? 'Choose reviewers' : 'Continue the self-assessment'}
                </NavLink>
              ) : null}
              {c.summaryShared ? (
                <NavLink className="h-btn h-btn--primary" href={caseHref(c.id, 'summary')}>
                  Read the summary and plan
                </NavLink>
              ) : null}
            </div>
          </>
        ) : r.raw ? (
          <ul className="ev-checks">
            <Check done={c.selfSubmitted} text="Self-assessment submitted" />
            <Check done={act.length >= lim.reviewersMin} text="Reviewers named" extra={act.length + ' named'} />
            <Check done={act.length > 0 && act.every((y) => y.status === 'submitted')} text="Feedback in" extra={act.filter((y) => y.status === 'submitted').length + ' of ' + act.length} />
            <Check done={c.summaryShared} text="Summary and plan shared" />
            <Check done={!!c.acknowledgedAt} text="Employee acknowledged" />
            <Check done={!!c.signedAt} text="HR signed" />
          </ul>
        ) : null}
      </section>
      {r.manage && c.termOpen ? <SupervisorPick x={x} /> : null}
      {v.priorGoals && v.priorGoals.length ? <Prior x={x} canReview={r.raw} /> : null}
      <section className="ev-panel ev-who">
        <h2>Who can read what</h2>
        {r.employee ? (
          <>
            <p>{F.A.readers}</p>
            <p>{F.B.readers}</p>
            <p>{F.C.readers}</p>
          </>
        ) : r.raw ? (
          <>
            <p>{F.B.readers}</p>
            <p>{F.C.readers}</p>
          </>
        ) : (
          <p>{F.B.readers}</p>
        )}
      </section>
    </>
  );
}

/* ------------------------------------------------------------------------------------------------------- the forms */

export function EditorFor({ x, formId }: { x: Ctx; formId: 'A' | 'B' }) {
  const { view: v, forms, saver } = x;
  const src = formId === 'A' ? v.self : v.mineB;
  if (!src) return null;
  const edit = !src.submitted && v.case.termOpen;
  const form = forms.forms[formId];
  if (!edit) return <FormLocked formId={formId} form={form} src={src.answers} view={v} forms={forms} meName={x.meName} />;
  return (
    <FormEditor
      key={formId}
      formId={formId}
      form={form}
      saved={src.answers}
      edits={saver.edits[formId]}
      saving={saver.saving}
      view={v}
      forms={forms}
      meName={x.meName}
      queue={saver.queue}
      flush={saver.flush}
      submit={(f) => evalCall('POST', 'case/' + cid(v) + '/submit', { form: f })}
      onSubmitted={async (f) => {
        await x.reload();
        x.replace(caseHref(v.case.id, f === 'A' ? 'reviewers' : 'overview'));
      }}
    />
  );
}

/* ----------------------------------------------------------------------------------------------------- reviewers */

export function Reviewers({ x }: { x: Ctx }) {
  const { view: v, forms } = x;
  const c = v.case;
  const lim = forms.limits;
  const list = v.reviewers || [];
  const active = activeReviewers(list);
  const editable = c.termOpen && !c.summaryShared;
  const find = useRef<HTMLInputElement>(null);
  const [b, setB] = useState(false);
  const chosen = editable ? x.pick : [];
  const nameOf = (e: string) => {
    const p = x.staff.find((y) => y.email === e);
    return p ? p.name : e;
  };
  return (
    <section className="ev-panel">
      <h2>People who give you feedback</h2>
      <p>
        Name {lim.reviewersMin} to {lim.reviewersMax} people who work with you: colleagues, people you lead, someone from another department. Each one gets their own feedback form. They are asked as soon as you save.
      </p>
      <p className="ev-readers">
        <b>Who reads their answers.</b> {forms.forms.B.readers}
      </p>
      {list.length ? (
        <ul className="ev-list">
          {list
            .filter((y) => y.status !== 'removed')
            .map((y) => (
              <li className="ev-row" key={y.email}>
                <div className="ev-row__main">
                  <b>{y.name}</b>
                </div>
                {y.status === 'submitted' ? <span className="ev-chip">Sent</span> : y.status === 'declined' ? <span className="ev-chip ev-chip--warn">Declined</span> : <span className="ev-chip ev-chip--quiet">Asked</span>}
                {editable && y.status !== 'submitted' ? (
                  <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-unpick={y.email} onClick={() => x.setPick(x.pick.filter((e) => e !== y.email))}>
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
        </ul>
      ) : null}
      {editable ? (
        <>
          <h3 className="ev-h3">{active.length ? 'Change who you ask' : 'Choose people'}</h3>
          <div className="ev-chosen" aria-live="polite">
            {chosen.length ? (
              chosen.map((e) => (
                <span className="ev-tag" key={e}>
                  {nameOf(e)}
                  <button type="button" data-unpick={e} aria-label={'Remove ' + nameOf(e)} onClick={() => x.setPick(x.pick.filter((y) => y !== e))}>
                    {'×'}
                  </button>
                </span>
              ))
            ) : (
              <span className="ev-sub">Nobody chosen yet</span>
            )}
          </div>
          <label className="ev-field">
            <span>Find a colleague</span>
            <input ref={find} type="search" id="ev-find" placeholder="Name or team" autoComplete="off" value={x.reviewerQ} onChange={(e) => x.setReviewerQ(e.target.value)} />
          </label>
          <ul className="ev-hits" id="ev-hits">
            {(() => {
              const hits = reviewerHits(x.staff, x.pick, x.reviewerQ, c.employee.email);
              return hits.length ? (
                hits.map((p) => (
                  <li key={p.email}>
                    <button
                      type="button"
                      data-pick={p.email}
                      onClick={() => {
                        x.setPick([...x.pick, p.email]);
                        x.setReviewerQ('');
                        find.current?.focus();
                      }}
                    >
                      <b>{p.name}</b>
                      <span>{[p.title, p.team].filter(Boolean).join(' · ')}</span>
                    </button>
                  </li>
                ))
              ) : (
                <li className="ev-sub">{x.reviewerQ.trim() ? 'Nobody matches.' : 'Everyone is chosen.'}</li>
              );
            })()}
          </ul>
          <div className="ev-acts">
            <button
              type="button"
              className="h-btn h-btn--primary"
              id="ev-askrev"
              disabled={b || chosen.length < lim.reviewersMin || chosen.length > lim.reviewersMax}
              onClick={() =>
                void busy(setB, async () => {
                  await evalCall('PUT', 'case/' + cid(v) + '/reviewers', { reviewers: x.pick.map((e) => ({ email: e })) });
                  toast('Feedback requested.');
                  x.setPick([]);
                  await x.reload();
                })
              }
            >
              Ask {chosen.length} {plural(chosen.length, 'person', 'people')}
            </button>
            <span className="ev-sub">{askHint(chosen.length, lim)}</span>
          </div>
        </>
      ) : (
        <p className="ev-sub">The feedback round is over.</p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------------------------------------- evidence */

export function Evidence({ x }: { x: Ctx }) {
  const e = x.view.evidence;
  const emp = x.view.role.employee;
  const title = emp ? 'My year' : 'Evidence';
  if (!e)
    return (
      <section className="ev-panel">
        <h2>{title}</h2>
        <p className="ev-sub">No records to show.</p>
      </section>
    );
  const Tile = ({ n, label, sub }: { n: number; label: string; sub: string }) => (
    <div className="ev-ev">
      <b>{n}</b>
      <span>{label}</span>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
  const List = ({ title: t, items, empty }: { title: string; items: ReactNode[]; empty: string }) => (
    <section className="ev-panel">
      <h3 className="ev-h3">{t}</h3>
      {items.length ? <ul className="ev-bul">{items}</ul> : <p className="ev-sub">{empty}</p>}
    </section>
  );
  return (
    <>
      <section className="ev-panel">
        <h2>{title}</h2>
        <p className="ev-sub">
          {dateWord(e.from, true)} to {dateWord(e.to, true)}
          {e.startedWithinYear ? ', from the start date' : ''}. Counted from Projects, the Work Center and Learn.
        </p>
        <div className="ev-evs">
          <Tile n={e.tasks.done} label="Tasks finished" sub={e.tasks.late ? e.tasks.late + ' after the due date' : ''} />
          <Tile n={e.partners.contacted} label="Partners contacted" sub={e.partners.actions + ' action' + (e.partners.actions === 1 ? '' : 's') + ' in the Work Center'} />
          <Tile n={e.courses.done} label="Courses finished" sub="" />
        </div>
      </section>
      <List
        title="Recent finished tasks"
        empty="No finished tasks in Projects in this window."
        items={e.tasks.recent.map((t, i) => (
          <li key={i}>
            {t.title} <small>{dateWord(t.doneAt)}</small>
          </li>
        ))}
      />
      <List
        title="Work Center actions"
        empty="No Work Center actions in this window."
        items={e.partners.byKind.map((k) => (
          <li key={k.kind}>
            {k.kind} <small>{k.n}</small>
          </li>
        ))}
      />
      <List
        title="Courses finished"
        empty="No courses finished in this window."
        items={e.courses.list.map((c, i) => (
          <li key={i}>
            {c.title} <small>{dateWord(c.completedAt)}</small>
          </li>
        ))}
      />
    </>
  );
}

/* ------------------------------------------------------------------------------------------------------ feedback */

export function Feedback({ x }: { x: Ctx }) {
  const { view: v, forms } = x;
  const fb = v.feedback || [];
  const F = forms.forms.B;
  return (
    <>
      <section className="ev-panel">
        <h2>Feedback from reviewers</h2>
        <p className="ev-readers">{F.readers} Do not pass a reviewer's words to the employee. The summary is how they hear it.</p>
        {!fb.length ? <p className="ev-sub">Nobody has been asked yet.</p> : null}
      </section>
      {fb.map((r) => (
        <details className="ev-acc" key={r.email}>
          <summary>
            <b>{r.reviewer}</b>
            <span className="ev-sub">{[r.relationship, r.frequency].filter(Boolean).join(' · ') || 'No relationship given'}</span>
            <span className={'ev-chip ' + (r.submitted ? '' : 'ev-chip--quiet')}>{r.submitted ? 'Submitted' : 'Not yet'}</span>
          </summary>
          {r.submitted ? (
            <>
              <FormRead form={F} answers={r.answers} label={'Form B from ' + r.reviewer} forms={forms} />
              {v.role.raw ? (
                <div className="ev-acts">
                  <button
                    type="button"
                    className="h-btn h-btn--ghost h-btn--sm"
                    data-reopenb={r.email}
                    onClick={() => {
                      if (window.confirm('Reopen this feedback form so the reviewer can change it?')) evalCall('POST', 'case/' + cid(v) + '/reopen', { form: 'B', reviewer: r.email }).then(x.reload).catch(fail);
                    }}
                  >
                    Reopen for {r.reviewer}
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <p className="ev-sub">Waiting on this form.</p>
          )}
        </details>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------------------------------------------- compare */

function Bars({ self, others }: { self: number | null; others: number | null }) {
  return (
    <span className="ev-cmp">
      <span className="ev-cmp__r">
        <i className="is-self" style={{ width: barWidth(self) + '%' }} />
      </span>
      <span className="ev-cmp__r">
        <i className="is-others" style={{ width: barWidth(others) + '%' }} />
      </span>
    </span>
  );
}

export function Compare({ x }: { x: Ctx }) {
  const a = x.view.analysis;
  if (!a)
    return (
      <section className="ev-panel">
        <h2>Compare</h2>
        <p className="ev-sub">The comparison opens once the self-assessment is submitted.</p>
      </section>
    );
  const t = a.themes;
  const list = (title: string, rows: typeof t.strengths, f: (r: (typeof t.strengths)[number]) => ReactNode) =>
    rows.length ? (
      <>
        <h3 className="ev-h3">{title}</h3>
        <ul className="ev-bul">{rows.map((r) => <li key={r.id}>{f(r)}</li>)}</ul>
      </>
    ) : null;
  const learning = x.view.learning || [];
  return (
    <>
      <section className="ev-panel">
        <h2>Self and others, by competency</h2>
        <p className="ev-sub">
          Averages on the 1 to 5 scale from {a.reviewersIn} submitted feedback form{a.reviewersIn === 1 ? '' : 's'}. Not Observed is left out. There is no overall score.{' '}
          <span className="ev-key">
            <i className="is-self"></i> Self <i className="is-others"></i> Others
          </span>
        </p>
        <div className="ev-cats">
          {a.categories.map((c) => (
            <div className="ev-cat" key={c.category}>
              <b>{c.category}</b>
              <Bars self={c.self} others={c.others} />
              <span className="ev-sub">
                Self {num(c.self)} {'·'} Others {num(c.others)}
              </span>
            </div>
          ))}
        </div>
        {rowsByCategory(a.rows).map(([k, rows]) => (
          <Fragment key={k}>
            <h3 className="ev-h3">{k}</h3>
            <div className="ev-table" role="table" aria-label={k}>
              <div className="ev-tr ev-tr--h" role="row">
                <span role="columnheader">Competency</span>
                <span role="columnheader"></span>
                <span role="columnheader">Self</span>
                <span role="columnheader">Others</span>
                <span role="columnheader">Gap</span>
              </div>
              {rows.map((r) => (
                <div className={'ev-tr' + (isBigGap(r.gap) ? ' is-gap' : '')} role="row" key={r.id}>
                  <span role="cell">{r.label}</span>
                  <span role="cell">
                    <Bars self={r.self} others={r.others} />
                  </span>
                  <span role="cell" data-l="Self">
                    {num(r.self)}
                  </span>
                  <span role="cell" data-l="Others">
                    {num(r.others)}
                    {r.raters ? (
                      <>
                        {' '}
                        <small>({r.raters})</small>
                      </>
                    ) : null}
                  </span>
                  <span role="cell" data-l="Gap">
                    {gapText(r.gap)}
                  </span>
                </div>
              ))}
            </div>
          </Fragment>
        ))}
      </section>
      <section className="ev-panel">
        <h2>Recurring themes</h2>
        {list('Others rate these highest', t.strengths, (r) => (
          <>
            {r.label} <small>(others {num(r.others)})</small>
          </>
        ))}
        {list('Others rate these lowest', t.growth, (r) => (
          <>
            {r.label} <small>(others {num(r.others)})</small>
          </>
        ))}
        {list('Self and others differ by a point or more', t.gaps, (r) => (
          <>
            {r.label}{' '}
            <small>
              (self {num(r.self)}, others {num(r.others)})
            </small>
          </>
        ))}
        {t.words.length ? (
          <>
            <h3 className="ev-h3">Words several reviewers used</h3>
            <p className="ev-words">
              {t.words.map((w) => (
                <span className="ev-tag ev-tag--plain" key={w.word}>
                  {w.word} <small>{w.people}</small>
                </span>
              ))}
            </p>
          </>
        ) : null}
        {!t.strengths.length && !t.growth.length && !t.gaps.length && !t.words.length ? <p className="ev-sub">No themes yet. They appear as feedback comes in.</p> : null}
      </section>
      {learning.length ? (
        <section className="ev-panel">
          <h2>Learning completed</h2>
          <ul className="ev-bul">
            {learning.map((l, i) => (
              <li key={i}>
                {l.title} <small>{dateWord(l.completedAt)}</small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------------------------------------------- summary, plan */

function DocLinks({ x }: { x: Ctx }) {
  const c = x.view.case;
  return (
    <div className="ev-acts">
      {c.summaryShared ? (
        <a className="h-btn h-btn--ghost" target="_blank" rel="noopener" href={'/api/evaluations/case/' + c.id + '/pdf'}>
          Download the PDF
        </a>
      ) : null}
      {c.docUrl && x.view.role.raw ? (
        <a className="h-btn h-btn--ghost" target="_blank" rel="noopener" href={c.docUrl}>
          Open the Google Doc
        </a>
      ) : null}
    </div>
  );
}

function GoalCard({ g, i, x, set, remove }: { g: Goal; i: number; x: Ctx; set: (i: number, k: keyof Goal, v: string) => void; remove: (i: number) => void }) {
  return (
    <li className="ev-goal ev-goal--edit" data-gi={i}>
      <div className="ev-goal__h">
        <b>Goal {i + 1}</b>
        <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-rmgoal={i} onClick={() => remove(i)}>
          Remove
        </button>
      </div>
      <label className="ev-field">
        <span>Development area</span>
        <select data-g="area" value={g.area} onChange={(e) => set(i, 'area', e.target.value)}>
          {x.forms.planAreas.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </label>
      <label className="ev-field">
        <span>Goal</span>
        <textarea data-g="goal" rows={2} maxLength={1000} value={g.goal} onChange={(e) => set(i, 'goal', e.target.value)} />
      </label>
      <label className="ev-field">
        <span>Action steps</span>
        <textarea data-g="steps" rows={3} maxLength={2000} value={g.steps} onChange={(e) => set(i, 'steps', e.target.value)} />
      </label>
      <label className="ev-field">
        <span>Support needed</span>
        <textarea data-g="support" rows={2} maxLength={1000} value={g.support} onChange={(e) => set(i, 'support', e.target.value)} />
      </label>
      <div className="ev-two">
        <label className="ev-field">
          <span>Target date</span>
          <input type="date" data-g="target_date" value={g.target_date || ''} onChange={(e) => set(i, 'target_date', e.target.value)} />
        </label>
        <label className="ev-field">
          <span>Learn course (optional)</span>
          <select data-g="course_id" value={g.course_id || ''} onChange={(e) => set(i, 'course_id', e.target.value)}>
            <option value="">None</option>
            {x.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
      </div>
    </li>
  );
}

function GoalRead({ g }: { g: Goal }) {
  return (
    <li className="ev-goal ev-goal--full">
      <div>
        <b>{g.goal}</b>
        <span className="ev-sub">
          {g.area}
          {g.target_date ? ' · Target ' + dateWord(g.target_date, true) : ''}
        </span>
      </div>
      <dl>
        <dt>Action steps</dt>
        <dd>
          <Lines text={g.steps} />
        </dd>
        <dt>Support needed</dt>
        <dd>{g.support || 'None listed'}</dd>
        {g.course_id ? (
          <>
            <dt>Learning</dt>
            <dd>
              <a href={'/learn/course/?id=' + encodeURIComponent(g.course_id)}>Open the course</a>
            </dd>
          </>
        ) : null}
      </dl>
    </li>
  );
}

function Acknowledge({ x }: { x: Ctx }) {
  const c = x.view.case;
  const [note, setNote] = useState('');
  const [b, setB] = useState(false);
  const [today, setToday] = useState('');
  // Today in Eastern time, read after the page is up so the server and browser draw the same first text.
  useEffect(() => setToday(todayEt()), []);
  if (c.acknowledgedAt)
    return (
      <section className="ev-panel">
        <h2>Acknowledged</h2>
        <p>
          You acknowledged this on {dateWord(c.acknowledgedAt, true)}.{c.acknowledgedNote ? ' Your note: ' + c.acknowledgedNote : ''}
        </p>
        <DocLinks x={x} />
      </section>
    );
  const early = !!c.meetingOn && !!today && today < c.meetingOn;
  return (
    <section className="ev-panel ev-submit">
      <h2>Acknowledge</h2>
      <p>After the meeting, acknowledge that you read the summary and the plan. Acknowledging does not mean you agree with every line. Add a note if you want your view recorded.</p>
      <label className="ev-field">
        <span>Your note (optional)</span>
        <textarea id="ev-acknote" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="ev-acts">
        <button
          type="button"
          className="h-btn h-btn--primary"
          id="ev-ack"
          disabled={early || b}
          onClick={() =>
            void busy(setB, async () => {
              await evalCall('POST', 'case/' + cid(x.view) + '/acknowledge', { note });
              toast('Acknowledged.');
              await x.reload();
            })
          }
        >
          I read this and met with my supervisor
        </button>
        {early ? <span className="ev-sub">Opens after the meeting on {dateWord(c.meetingOn, true)}.</span> : null}
      </div>
    </section>
  );
}

function SummaryEditor({ x }: { x: Ctx }) {
  const { view: v, forms, saver } = x;
  const sm = v.summary!;
  const F = forms.forms.C;
  const c = v.case;
  const lim = forms.limits;
  const [goals, setGoals] = useState<Goal[]>(() => (sm.goals || []).map((g) => ({ ...g })));
  const [msg, setMsg] = useState('');
  const [meet, setMeet] = useState(c.meetingOn || c.due.w3 || '');
  const [b, setB] = useState(false);
  const m = merged(sm.answers, saver.edits.C);
  const t = totalsOf(F, m);
  const gp = gapsOf(F, m);
  const nGoals = goals.filter(goalComplete).length;
  const ok = !gp.length && nGoals >= lim.goalsMin && nGoals === goals.length;
  const rv = (v.reviewers || []).filter((y) => y.status === 'submitted').length;
  const cur = (qid: string): Ans | undefined => merged(sm.answers, saver.edits.C)[qid];
  const h = rowHandlers('C', cur, saver.queue);
  const set = (i: number, k: keyof Goal, val: string) => {
    setMsg('');
    setGoals((gs) => gs.map((g, n) => (n === i ? { ...g, [k]: val } : g)));
  };
  const saveQuiet = () => evalCall<{ goals: Goal[] }>('PUT', 'case/' + cid(v) + '/goals', goalsBody(goals));
  const share = async (fewer: boolean) =>
    busy(setB, async () => {
      await saver.flush('C');
      await saveQuiet();
      await evalCall('POST', 'case/' + cid(v) + '/submit', { form: 'C', meetingOn: meet, proceedWithFewer: fewer });
      toast('Shared with the employee.');
      await x.reload();
    });
  return (
    <>
      <Intro form={F} />
      {v.priorGoals && v.priorGoals.length ? <Prior x={x} canReview /> : null}
      <div className="ev-form" data-form="C">
        <div className="ev-prog">
          <div className="ev-bar">
            <i style={{ width: percent(t.done, t.total) + '%' }} />
          </div>
          <span>
            <b id="ev-done">{t.done}</b> of {t.total} written
          </span>
          <span id="ev-save" className="ev-save" role="status">
            {saver.saving}
          </span>
        </div>
        {F.sections.map((s) => (
          <SectionBlock key={s.id} sec={s} m={m} edit forms={forms} view={v} meName={x.meName} h={h} />
        ))}
      </div>
      <section className="ev-panel">
        <h2>Six-month development plan</h2>
        <p className="ev-sub">
          {lim.goalsMin} to {lim.goalsMax} priority goals. Revisited at the next evaluation.
        </p>
        <ul className="ev-goals" id="ev-goals">
          {goals.map((g, i) => (
            <GoalCard key={i} g={g} i={i} x={x} set={set} remove={(n) => setGoals((gs) => gs.filter((_, k) => k !== n))} />
          ))}
        </ul>
        <div className="ev-acts">
          {goals.length < lim.goalsMax ? (
            <button type="button" className="h-btn h-btn--ghost" id="ev-addgoal" onClick={() => setGoals((gs) => [...gs, NEW_GOAL(forms.planAreas[0])])}>
              Add a goal
            </button>
          ) : null}
          <button
            type="button"
            className="h-btn h-btn--ghost"
            id="ev-savegoals"
            disabled={b}
            onClick={() =>
              void busy(setB, async () => {
                const d = await saveQuiet();
                setGoals(d.goals.map((g) => ({ ...g })));
                x.patch((vv) => (vv.summary ? { ...vv, summary: { ...vv.summary, goals: d.goals } } : vv));
                setMsg('Saved');
              })
            }
          >
            Save the plan
          </button>
          <span className="ev-save" id="ev-goalmsg" role="status">
            {msg}
          </span>
        </div>
      </section>
      <section className="ev-panel ev-submit">
        <h2>Share with {c.employee.name}</h2>
        {ok ? null : (
          <p>
            {gp.length ? gp.length + ' summary answer' + (gp.length === 1 ? '' : 's') + ' left. ' : ''}
            {nGoals < lim.goalsMin || nGoals !== goals.length ? 'The plan needs ' + lim.goalsMin + ' to ' + lim.goalsMax + ' goals with the goal, action steps and a target date.' : ''}
          </p>
        )}
        <label className="ev-field">
          <span>Meeting date</span>
          <input type="date" id="ev-meet" value={meet} onChange={(e) => setMeet(e.target.value)} />
        </label>
        {rv < lim.reviewersMin ? (
          <p className="ev-warn">
            Only {rv} of {lim.reviewersMin} feedback forms are in. You can go ahead with what you have.
          </p>
        ) : null}
        <div className="ev-acts">
          <button
            type="button"
            className="h-btn h-btn--primary"
            id="ev-share"
            disabled={!ok || b}
            onClick={() => {
              if (rv < lim.reviewersMin) {
                if (!window.confirm('Only ' + rv + ' of ' + lim.reviewersMin + ' feedback forms are in. Share the summary with what you have?')) return;
                void share(true);
                return;
              }
              if (!window.confirm('Share the summary and plan with the employee now?')) return;
              void share(false);
            }}
          >
            Share summary and plan
          </button>
        </div>
        <p className="ev-sub">After you share, the employee reads this and the plan. The raw feedback stays with you, HR and FavorOS administrators.</p>
      </section>
    </>
  );
}

export function Summary({ x }: { x: Ctx }) {
  const { view: v, forms } = x;
  const sm = v.summary;
  const F = forms.forms.C;
  const c = v.case;
  const r = v.role;
  if (!sm)
    return (
      <section className="ev-panel">
        <h2>Summary and plan</h2>
        <p className="ev-sub">Your supervisor writes this after the feedback is in. You see it when they share it.</p>
      </section>
    );
  if (sm.editable && r.raw) return <SummaryEditor x={x} />;
  return (
    <>
      <section className="ev-panel ev-intro">
        <h2>{F.title}</h2>
        <p className="ev-readers">
          <b>Who reads this.</b> {F.readers}
        </p>
        {c.meetingOn ? (
          <p>
            Meeting: <b>{dateWord(c.meetingOn, true)}</b>
          </p>
        ) : null}
      </section>
      <FormRead form={F} answers={sm.answers} label="Supervisor summary" forms={forms} />
      <section className="ev-panel">
        <h2>Six-month development plan</h2>
        <p className="ev-sub">Revisited at your next evaluation. Each goal is also a task in Projects when Projects is on.</p>
        <ul className="ev-goals">
          {sm.goals.length ? sm.goals.map((g, i) => <GoalRead key={g.id || i} g={g} />) : <li className="ev-sub">No goals yet.</li>}
        </ul>
      </section>
      {v.priorGoals && v.priorGoals.length ? <Prior x={x} canReview={r.raw} /> : null}
      {r.employee ? <Acknowledge x={x} /> : null}
      {r.raw && c.termOpen && !c.acknowledgedAt ? (
        <div className="ev-acts">
          <button
            type="button"
            className="h-btn h-btn--ghost"
            data-reopenc="1"
            onClick={() => {
              if (window.confirm('Reopen the summary? The employee stops seeing it until you share it again.')) evalCall('POST', 'case/' + cid(v) + '/reopen', { form: 'C' }).then(x.reload).catch(fail);
            }}
          >
            Reopen the summary
          </button>
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------------------------------------------- sign-off */

export function Signoff({ x }: { x: Ctx }) {
  const { view: v } = x;
  const c = v.case;
  const r = v.role;
  const [date, setDate] = useState(c.meetingOn);
  useEffect(() => setDate(c.meetingOn), [c.meetingOn]);
  const [b, setB] = useState(false);
  return (
    <section className="ev-panel">
      <h2>Meeting and sign-off</h2>
      <ul className="ev-checks">
        <Check done={c.summaryShared} text="Summary and plan shared" />
        <Check done={!!c.meetingOn} text="Meeting date" extra={c.meetingOn ? dateWord(c.meetingOn, true) : 'not set'} />
        <Check done={!!c.acknowledgedAt} text="Employee acknowledged" extra={c.acknowledgedAt ? dateWord(c.acknowledgedAt) : ''} />
        <Check done={!!c.signedAt} text="HR signed" extra={c.signedAt ? c.signedBy + ', ' + dateWord(c.signedAt) : ''} />
        <Check done={!!c.docUrl} text={"Filed in the employee's folder"} extra={c.docUrl ? '' : c.docError || ''} />
      </ul>
      {c.summaryShared && c.termOpen && !c.acknowledgedAt ? (
        <>
          <label className="ev-field">
            <span>Meeting date</span>
            <input type="date" id="ev-meet2" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className="ev-acts">
            <button
              type="button"
              className="h-btn h-btn--ghost"
              id="ev-setmeet"
              disabled={b}
              onClick={() =>
                void busy(setB, async () => {
                  await evalCall('POST', 'case/' + cid(v) + '/meeting', { date });
                  toast('Saved.');
                  await x.reload();
                })
              }
            >
              Save the date
            </button>
          </div>
        </>
      ) : null}
      <div className="ev-acts">
        {r.manage && c.stage === 'acknowledged' ? (
          <button
            type="button"
            className="h-btn h-btn--primary"
            id="ev-sign"
            onClick={() => {
              if (window.confirm('Sign this evaluation as HR? It files the Google Doc and the PDF.'))
                evalCall<{ docError?: string }>('POST', 'case/' + cid(v) + '/sign')
                  .then((d) => {
                    toast(d.docError ? 'Signed. The Google Doc was not filed: ' + d.docError : 'Signed and filed.', !!d.docError);
                    return x.reload();
                  })
                  .catch(fail);
            }}
          >
            Sign as HR
          </button>
        ) : null}
        {r.manage && c.signedAt && !c.docUrl ? (
          <button
            type="button"
            className="h-btn h-btn--ghost"
            id="ev-retrydoc"
            disabled={b}
            onClick={() =>
              void busy(setB, async () => {
                const d = await evalCall<{ docError?: string }>('POST', 'case/' + cid(v) + '/doc');
                toast(d.docError ? d.docError : 'Filed.', !!d.docError);
                await x.reload();
              })
            }
          >
            Try the Google Doc again
          </button>
        ) : null}
      </div>
      {c.stage === 'meeting' ? <p className="ev-sub">Waiting for the employee to acknowledge.</p> : null}
      {r.manage && c.stage === 'acknowledged' ? <p className="ev-sub">Signing files the Google Doc and the PDF in the employee's folder.</p> : null}
      <DocLinks x={x} />
    </section>
  );
}
