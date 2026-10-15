// The read and action panels of one evaluation: overview, reviewers, the year's evidence, feedback, compare, the meeting and the final evaluation.
// Same markup and class names as public/js/evaluations.js drew.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink } from '@/shell/NavLink';
import { evalCall } from './api';
import { FormEditor, FormLocked, FormRead, Intro, Lines, SectionBlock, rowHandlers } from './Forms';
import { toast } from './toast';
import {
  STEPS, activeReviewers, askHint, barWidth, caseHref, dateWord, gapText, gapsOf, isBigGap, merged, num, percent, plural,
  reviewerHits, rowsByCategory, stepNow, timeWord, todayEt, totalsOf, type Ans, type CaseView, type FormsPayload, type Person,
} from './logic';
import type { Saver } from './useSaver';

export interface Ctx {
  view: CaseView;
  forms: FormsPayload;
  meName: string;
  staff: Person[];
  settings?: { summaryUrl: string; instructionsUrl: string };
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
  const [today, setToday] = useState('');
  useEffect(() => setToday(todayEt()), []);
  const { cur, done } = stepNow(stage, due.w1, today);
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
              <Check done={c.selfSubmitted} text="Self-evaluation" extra={c.selfSubmitted ? '' : v.self && v.self.progress ? v.self.progress.done + ' of ' + v.self.progress.total + ' required answers' : ''} />
              <Check done={act.length >= lim.reviewersMin} text={'Name ' + lim.reviewersMin + ' or ' + lim.reviewersMax + ' people for feedback, your supervisor included'} extra={sent + ' of ' + act.length + ' sent their feedback'} />
              <Check done={!!c.meetingOn} text="Review meeting scheduled" extra={c.meetingOn ? dateWord(c.meetingOn) : ''} />
              <Check done={c.summaryShared} text="Your supervisor shares your final evaluation after the meeting" />
              <Check done={!!c.acknowledgedAt} text="You acknowledge it" />
              <Check done={!!c.signedAt} text="HR signs" />
            </ul>
            <div className="ev-acts">
              {c.stage === 'self' && c.termOpen ? (
                <NavLink className="h-btn h-btn--primary" href={caseHref(c.id, c.selfSubmitted ? 'reviewers' : 'self')}>
                  {c.selfSubmitted ? 'Choose reviewers' : 'Continue the self-assessment'}
                </NavLink>
              ) : null}
              {c.summaryShared ? (
                <NavLink className="h-btn h-btn--primary" href={caseHref(c.id, 'final')}>
                  Read your final evaluation
                </NavLink>
              ) : null}
            </div>
          </>
        ) : r.raw ? (
          <ul className="ev-checks">
            <Check done={c.selfSubmitted} text="Self-evaluation submitted" />
            <Check done={act.length >= lim.reviewersMin} text="Reviewers named" extra={act.length + ' named'} />
            <Check done={act.length > 0 && act.every((y) => y.status === 'submitted')} text="Feedback in" extra={act.filter((y) => y.status === 'submitted').length + ' of ' + act.length} />
            <Check done={!!c.meetingOn} text="Review meeting scheduled" extra={c.meetingOn ? dateWord(c.meetingOn) : ''} />
            <Check done={c.summaryShared} text="Final evaluation shared" />
            <Check done={!!c.acknowledgedAt} text="Employee acknowledged" />
            <Check done={!!c.signedAt} text="HR signed" />
          </ul>
        ) : null}
      </section>
      {c.meetingOn || c.leader.email ? <MeetingInfo x={x} /> : null}
      {r.raw && v.feedback && v.self ? <ExportPanel x={x} /> : null}
      {r.manage && c.termOpen ? <SupervisorPick x={x} /> : null}
      <section className="ev-panel ev-who">
        <h2>Who can read what</h2>
        {r.employee ? (
          <>
            <p>{F.A.readers}</p>
            <p>{F.B.readers}</p>
            <p>Your final evaluation is a Google Doc your supervisor shares with you after the review meeting.</p>
          </>
        ) : r.raw ? (
          <>
            <p>{F.A.readers}</p>
            <p>{F.B.readers}</p>
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
        Name {lim.reviewersMin} or {lim.reviewersMax} people who work with you. Your supervisor is always one of them. The others can be a colleague, someone you lead, or someone from another department. Each one gets an email with their own link to a feedback form as soon as you save.
      </p>
      {list.some((y) => y.status === 'declined') && c.termOpen ? <p className="ev-sub">Someone declined. Choose another person and save so you still have {lim.reviewersMin} or {lim.reviewersMax} reviewers.</p> : null}
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
                {editable && y.status !== 'submitted' && y.email !== c.supervisor.email ? (
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
                  {e === c.supervisor.email ? (
                    <em className="ev-sub"> supervisor</em>
                  ) : (
                    <button type="button" data-unpick={e} aria-label={'Remove ' + nameOf(e)} onClick={() => x.setPick(x.pick.filter((y) => y !== e))}>
                      {'×'}
                    </button>
                  )}
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
        <p className="ev-readers">{F.readers} Do not pass a reviewer's words to the employee. You write the evaluation they receive.</p>
        {!fb.length ? <p className="ev-sub">Nobody has been asked yet.</p> : null}
      </section>
      {v.role.raw && v.self ? <ExportPanel x={x} /> : null}
      {fb.map((r) => (
        <details className="ev-acc" key={r.email}>
          <summary>
            <b>{r.reviewer}</b>
            <span className="ev-sub">{[r.relationship, r.frequency].filter(Boolean).join(' · ') || 'No relationship given'}</span>
            <span className={'ev-chip ' + (r.submitted ? '' : 'ev-chip--quiet')}>{r.submitted ? 'Submitted' : (v.reviewers || []).find((y) => y.email === r.email)?.status === 'declined' ? 'Declined' : 'Not yet'}</span>
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
            <p className="ev-sub">
              {(v.reviewers || []).find((y) => y.email === r.email)?.status === 'declined'
                ? 'Declined to give feedback.' + ((v.reviewers || []).find((y) => y.email === r.email)?.declineNote ? ' Their note: ' + (v.reviewers || []).find((y) => y.email === r.email)?.declineNote : '')
                : 'Waiting on this form.'}
            </p>
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

/* ---------------------------------------------------------------------------------------------- meeting and final evaluation */

function when(c: CaseView['case']): string {
  return c.meetingOn ? dateWord(c.meetingOn, true) + (c.meetingTime ? ' at ' + timeWord(c.meetingTime) : '') : '';
}

/** The review meeting in one place: day and time, who joins, the Zoom link. Everyone in the evaluation sees the same lines. Never answers. */
function MeetingInfo({ x }: { x: Ctx }) {
  const c = x.view.case;
  return (
    <section className="ev-panel">
      <h2>Review meeting</h2>
      {c.meetingOn ? (
        <p>
          <b>{when(c)}</b>
        </p>
      ) : (
        <p className="ev-sub">Not scheduled yet. HR schedules the meetings ahead of time.</p>
      )}
      <p className="ev-sub">
        With {c.supervisor.name || 'the supervisor'}
        {c.leader.name ? ' and ' + c.leader.name : ''}.
      </p>
      {c.meetingLink ? (
        <div className="ev-acts">
          <a className="h-btn h-btn--ghost" target="_blank" rel="noopener" href={c.meetingLink}>
            Open the Zoom link
          </a>
        </div>
      ) : null}
    </section>
  );
}

type Made = { sheet?: { url: string; title: string; label: string } };

/** Export to Google Sheets: the self-evaluation and each reviewer's answers as separate sheets, in your own Drive. You combine them. */
function ExportButtons({ x, part, email, label }: { x: Ctx; part: 'self' | 'reviewer'; email?: string; label: string }) {
  const [b, setB] = useState(false);
  const [note, setNote] = useState<{ text: string; href?: string; link?: string } | null>(null);
  const next = encodeURIComponent('/evaluations/?c=' + x.view.case.id);
  return (
    <>
      <button
        type="button"
        className="h-btn h-btn--ghost h-btn--sm"
        data-export={part + (email ? ':' + email : '')}
        disabled={b}
        onClick={() => {
          setB(true);
          setNote(null);
          evalCall<Made>('POST', 'case/' + cid(x.view) + '/export', { part, email })
            .then((d) => {
              toast('Sheet made in your Drive.');
              setNote({ text: d.sheet?.title || 'Sheet made', link: d.sheet?.url });
            })
            .catch((e) => {
              const code = (e as { code?: string }).code;
              if (code === 'not_connected') setNote({ text: 'Connect your Google account to FavorOS first.', href: '/api/google/connect?next=' + next });
              else if (code === 'consent') setNote({ text: 'Allow Favor to make Google Sheets for you. Google asks once.', href: '/api/google/connect?add=sheets&next=' + next });
              else fail(e);
            })
            .finally(() => setB(false));
        }}
      >
        {b ? 'Making the sheet...' : 'Export ' + label + ' to Google Sheets'}
      </button>
      {note ? (
        <span className="ev-sub" role="status">
          {note.text}{' '}
          {note.href ? <a href={note.href}>Continue</a> : null}
          {note.link ? (
            <a href={note.link} target="_blank" rel="noopener">
              Open the sheet
            </a>
          ) : null}
        </span>
      ) : null}
    </>
  );
}

function ExportPanel({ x }: { x: Ctx }) {
  const v = x.view;
  const fb = (v.feedback || []).filter((r) => r.submitted);
  return (
    <section className="ev-panel">
      <h2>Export the answers</h2>
      <p>
        Each export makes its own private Google Sheet in your Drive, with the reviewer's name next to every answer. Combine them yourself into the evaluation. FavorOS does not write it for you.
      </p>
      <div className="ev-acts">
        {v.self?.submitted ? <ExportButtons x={x} part="self" label="the self-evaluation" /> : <span className="ev-sub">The self-evaluation is not submitted yet.</span>}
      </div>
      {fb.map((r) => (
        <div className="ev-acts" key={r.email}>
          <ExportButtons x={x} part="reviewer" email={r.email} label={r.reviewer + "'s answers"} />
        </div>
      ))}
      {!fb.length ? <p className="ev-sub">Reviewer answers can be exported once a reviewer submits.</p> : null}
    </section>
  );
}

function MeetingForm({ x }: { x: Ctx }) {
  const c = x.view.case;
  const [date, setDate] = useState(c.meetingOn);
  const [time, setTime] = useState(c.meetingTime);
  const [link, setLink] = useState(c.meetingLink);
  const [leader, setLeader] = useState(c.leader.email);
  const [b, setB] = useState(false);
  useEffect(() => {
    setDate(c.meetingOn);
    setTime(c.meetingTime);
    setLink(c.meetingLink);
    setLeader(c.leader.email);
  }, [c.meetingOn, c.meetingTime, c.meetingLink, c.leader.email]);
  return (
    <section className="ev-panel">
      <h2>Schedule the review meeting</h2>
      <p className="ev-sub">The supervisor and one leadership member meet with {c.employee.name} on Zoom. Saving emails all three.</p>
      <label className="ev-field">
        <span>Day</span>
        <input type="date" id="ev-meet2" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="ev-field">
        <span>Time, Eastern</span>
        <input type="time" id="ev-meet-time" value={time} onChange={(e) => setTime(e.target.value)} />
      </label>
      <label className="ev-field">
        <span>Leadership member who joins</span>
        <select id="ev-meet-leader" value={leader} onChange={(e) => setLeader(e.target.value)}>
          <option value="">Not chosen yet</option>
          {x.staff
            .filter((p) => p.email !== c.employee.email && p.email !== c.supervisor.email)
            .map((p) => (
              <option key={p.email} value={p.email}>
                {p.name}
              </option>
            ))}
        </select>
      </label>
      <label className="ev-field">
        <span>Zoom link</span>
        <input type="url" id="ev-meet-link" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
      </label>
      <div className="ev-acts">
        <button
          type="button"
          className="h-btn h-btn--primary"
          id="ev-setmeet"
          disabled={b || !date}
          onClick={() =>
            void busy(setB, async () => {
              await evalCall('POST', 'case/' + cid(x.view) + '/meeting', { date, time, link, leader });
              toast('Meeting saved. Everyone in it was emailed.');
              await x.reload();
            })
          }
        >
          {c.meetingOn ? 'Save changes' : 'Schedule the meeting'}
        </button>
      </div>
    </section>
  );
}

function ShareFinal({ x }: { x: Ctx }) {
  const v = x.view;
  const c = v.case;
  const f = v.final;
  const [url, setUrl] = useState('');
  const [b, setB] = useState(false);
  if (!f) return null;
  return (
    <section className="ev-panel">
      <h2>Final evaluation</h2>
      <p>
        After the meeting, make a copy of the form, fill it in with your leadership member, and share it with {c.employee.name} in Google Docs. Then paste its link here so they can read it and acknowledge it.
      </p>
      <div className="ev-acts">
        {f.instructionsUrl ? (
          <a className="h-btn h-btn--ghost" target="_blank" rel="noopener" href={f.instructionsUrl}>
            Supervisor instructions
          </a>
        ) : null}
        {f.templateUrl ? (
          <a className="h-btn h-btn--ghost" target="_blank" rel="noopener" href={f.templateUrl}>
            Final evaluation form (make a copy)
          </a>
        ) : null}
      </div>
      {f.shared ? (
        <>
          <p>
            <b>Shared with {c.employee.name}.</b>
          </p>
          <div className="ev-acts">
            {f.docUrl ? (
              <a className="h-btn h-btn--ghost" target="_blank" rel="noopener" href={f.docUrl}>
                Open the final evaluation
              </a>
            ) : null}
            {c.termOpen && !c.acknowledgedAt ? (
              <button
                type="button"
                className="h-btn h-btn--ghost"
                data-reopenc="1"
                onClick={() => {
                  if (window.confirm('Take it back? ' + c.employee.name + ' stops seeing the link until you share it again.')) evalCall('POST', 'case/' + cid(v) + '/final-reopen').then(x.reload).catch(fail);
                }}
              >
                Take it back
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <label className="ev-field">
            <span>Link to the finished Google Doc</span>
            <input type="url" id="ev-final-url" placeholder="https://docs.google.com/document/d/..." value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <div className="ev-acts">
            <button
              type="button"
              className="h-btn h-btn--primary"
              id="ev-final"
              disabled={b || !url.trim() || !c.meetingOn || !c.termOpen}
              onClick={() =>
                void busy(setB, async () => {
                  await evalCall('POST', 'case/' + cid(v) + '/final', { url: url.trim() });
                  toast('Shared with ' + c.employee.name + '.');
                  setUrl('');
                  await x.reload();
                })
              }
            >
              Share with {c.employee.name}
            </button>
            {!c.meetingOn ? <span className="ev-sub">Schedule the meeting first.</span> : null}
          </div>
        </>
      )}
    </section>
  );
}

function Acknowledge({ x }: { x: Ctx }) {
  const c = x.view.case;
  const [note, setNote] = useState('');
  const [b, setB] = useState(false);
  const [today, setToday] = useState('');
  // Today in Eastern time, read after the page is up so the server and browser draw the same first text.
  useEffect(() => setToday(todayEt()), []);
  const doc = c.docUrl ? (
    <div className="ev-acts">
      <a className="h-btn h-btn--primary" target="_blank" rel="noopener" href={c.docUrl}>
        Open your final evaluation
      </a>
    </div>
  ) : null;
  if (c.acknowledgedAt)
    return (
      <section className="ev-panel">
        <h2>Acknowledged</h2>
        <p>
          You acknowledged this on {dateWord(c.acknowledgedAt, true)}.{c.acknowledgedNote ? ' Your note: ' + c.acknowledgedNote : ''}
        </p>
        {doc}
      </section>
    );
  const early = !!c.meetingOn && !!today && today < c.meetingOn;
  return (
    <>
      <section className="ev-panel">
        <h2>Your final evaluation</h2>
        <p>Your supervisor and a leadership member wrote this after your meeting. Read it before you acknowledge it.</p>
        {doc}
      </section>
      <section className="ev-panel ev-submit">
        <h2>Acknowledge</h2>
        <p>Acknowledging means you received your evaluation and talked it through. It does not mean you agree with every line. Add a note if you want your view recorded.</p>
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
    </>
  );
}

/** The tab for the meeting and the final evaluation. The employee reads and acknowledges. The supervisor, HR and admins schedule, share and sign. */
export function Final({ x }: { x: Ctx }) {
  const { view: v } = x;
  const c = v.case;
  const r = v.role;
  const [b, setB] = useState(false);
  if (r.employee) {
    return (
      <>
        <MeetingInfo x={x} />
        {c.summaryShared ? <Acknowledge x={x} /> : <section className="ev-panel"><h2>Your final evaluation</h2><p className="ev-sub">Your supervisor shares it after the review meeting.</p></section>}
      </>
    );
  }
  return (
    <>
      <section className="ev-panel">
        <h2>Meeting and final evaluation</h2>
        <ul className="ev-checks">
          <Check done={!!c.meetingOn} text="Review meeting scheduled" extra={c.meetingOn ? when(c) : 'not set'} />
          <Check done={c.summaryShared} text="Final evaluation shared with the employee" />
          <Check done={!!c.acknowledgedAt} text="Employee acknowledged" extra={c.acknowledgedAt ? dateWord(c.acknowledgedAt) : ''} />
          <Check done={!!c.signedAt} text="HR signed" extra={c.signedAt ? c.signedBy + ', ' + dateWord(c.signedAt) : ''} />
        </ul>
        {c.stage === 'meeting' ? <p className="ev-sub">Waiting for the employee to acknowledge.</p> : null}
        {r.manage && c.stage === 'acknowledged' ? (
          <div className="ev-acts">
            <button
              type="button"
              className="h-btn h-btn--primary"
              id="ev-sign"
              disabled={b}
              onClick={() => {
                if (window.confirm('Sign this evaluation as HR?'))
                  void busy(setB, async () => {
                    await evalCall('POST', 'case/' + cid(v) + '/sign');
                    toast('Signed.');
                    await x.reload();
                  });
              }}
            >
              Sign as HR
            </button>
          </div>
        ) : null}
      </section>
      {c.termOpen && !c.acknowledgedAt ? <MeetingForm x={x} /> : <MeetingInfo x={x} />}
      <ShareFinal x={x} />
    </>
  );
}

/** A reviewer who cannot give feedback says so, with an optional note. The employee picks a replacement. The supervisor cannot decline. */
export function DeclineBox({ x }: { x: Ctx }) {
  const v = x.view;
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [b, setB] = useState(false);
  if (!v.mineB || v.mineB.submitted || v.role.supervisor || !v.case.termOpen) return null;
  return (
    <section className="ev-panel">
      <h2>Not able to give feedback?</h2>
      {open ? (
        <>
          <label className="ev-field">
            <span>A note for the supervisor (optional)</span>
            <textarea id="ev-decline-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="ev-acts">
            <button
              type="button"
              className="h-btn h-btn--primary"
              id="ev-decline"
              disabled={b}
              onClick={() =>
                void busy(setB, async () => {
                  await evalCall('POST', 'case/' + cid(v) + '/decline', { note });
                  toast('Declined. ' + v.case.employee.name + ' will pick someone else.');
                  x.replace('/evaluations/');
                })
              }
            >
              Decline
            </button>
            <button type="button" className="h-btn h-btn--ghost" onClick={() => setOpen(false)}>
              Keep my form
            </button>
          </div>
        </>
      ) : (
        <div className="ev-acts">
          <button type="button" className="h-btn h-btn--ghost" id="ev-decline-open" onClick={() => setOpen(true)}>
            Decline to give feedback
          </button>
          <span className="ev-sub">{v.case.employee.name} then names someone else.</span>
        </div>
      )}
    </section>
  );
}
