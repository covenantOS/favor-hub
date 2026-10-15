// Work > Evaluations: my evaluation, the feedback I owe, my team's reviews, and one evaluation with its tabs. Same markup, class names and
// stylesheet as src/pages/evaluations/index.astro and public/js/evaluations.js, drawn by React. Every read is browser-only.
import '@hub/styles/evaluations.css';
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { NavLink } from '@/shell/NavLink';
import { FormRead } from './Forms';
import { Compare, EditorFor, Evidence, Feedback, Overview, Reviewers, Signoff, Summary, type Ctx } from './Panels';
import { caseQuery, coursesQuery, evKeys, formsQuery, mineQuery, peopleQuery } from './queries';
import { ToastHost } from './toast';
import { useSaver } from './useSaver';
import { caseHref, dateWord, tabShown, tabsFor, type CaseView, type EvalSearch, type FormsPayload, type Mine } from './logic';

export function EvaluationsPage({ search }: { search: EvalSearch }) {
  return (
    <>
      <div className="ev-page">
        <div className="container">{search.c ? <CaseRoute key={search.c} id={search.c} tab={search.v || ''} /> : <HomeRoute />}</div>
      </div>
      <ToastHost />
    </>
  );
}

const Opening = () => (
  <p className="ev-loading" id="ev-loading">
    Opening
  </p>
);

function Failed({ message }: { message: string }) {
  return (
    <div className="ev-root" id="ev-root">
      <section className="ev-empty">
        <h2>This did not open</h2>
        <p>{message}</p>
        <p>
          <NavLink href="/evaluations/">Back to Evaluations</NavLink>
        </p>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------------ home */

function HomeRoute() {
  const forms = useQuery(formsQuery);
  const me = useQuery(mineQuery);
  const err = forms.error || me.error;
  if (err) return <Failed message={(err as Error).message} />;
  if (!forms.data || !me.data) return <Opening />;
  return <Home m={me.data} />;
}

function Home({ m }: { m: Mine }) {
  const any = m.own.length || m.owe.length || m.team.length || m.needsSign.length;
  return (
    <div className="ev-root" id="ev-root">
      <header className="ev-head">
        <div>
          <p className="ev-kicker">Work</p>
          <h1>Evaluations</h1>
        </div>
        {m.manage ? (
          <NavLink className="h-btn h-btn--ghost" href="/evaluations/admin/">
            Manage terms
          </NavLink>
        ) : null}
      </header>
      {!any ? (
        <section className="ev-empty">
          <h2>No evaluation is open for you</h2>
          <p>When a term opens, your self-assessment shows up here and on Today. If you are asked for feedback about a colleague, that shows up here too.</p>
          {m.reports.length ? <p>People who report to you: {m.reports.length}. Their evaluations appear here when a term opens.</p> : null}
        </section>
      ) : null}
      {m.own.length ? (
        <section className="ev-sec">
          <h2>My evaluation</h2>
          {m.own.map((o) => (
            <article className="ev-card" key={o.id}>
              <div className="ev-card__top">
                <div>
                  <h3>{o.period}</h3>
                  <p className="ev-sub">{o.term}</p>
                </div>
                <span className="ev-chip">{o.stageWord}</span>
              </div>
              <p className="ev-next">
                {o.next}
                {o.due ? (
                  <>
                    {' '}
                    <span className="ev-due">Due {dateWord(o.due)}</span>
                  </>
                ) : null}
              </p>
              {o.stage === 'self' ? (
                <>
                  <div className="ev-bar" role="img" aria-label={o.self.done + ' of ' + o.self.total + ' required answers'}>
                    <i style={{ width: Math.round((100 * o.self.done) / Math.max(1, o.self.total)) + '%' }} />
                  </div>
                  <p className="ev-sub">
                    {o.self.done} of {o.self.total} required answers
                  </p>
                </>
              ) : null}
              <div className="ev-acts">
                <NavLink className="h-btn h-btn--primary" href={caseHref(o.id)}>
                  {o.stage === 'self' ? 'Continue' : 'Open'}
                </NavLink>
              </div>
            </article>
          ))}
        </section>
      ) : null}
      {m.owe.length ? (
        <section className="ev-sec">
          <h2>Feedback I owe</h2>
          <ul className="ev-list">
            {m.owe.map((o) => (
              <li className="ev-row" key={o.caseId}>
                <div className="ev-row__main">
                  <b>{o.employee}</b>
                  <span className="ev-sub">
                    {o.status === 'submitted' ? 'Submitted' : o.progress.done + ' of ' + o.progress.total + ' required answers'}
                    {o.due && o.status !== 'submitted' ? ' · Due ' + dateWord(o.due) : ''}
                  </span>
                </div>
                <NavLink className={'h-btn ' + (o.status === 'submitted' ? 'h-btn--ghost' : 'h-btn--primary') + ' h-btn--sm'} href={caseHref(o.caseId)}>
                  {o.status === 'submitted' ? 'View' : 'Give feedback'}
                </NavLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {m.team.length ? (
        <section className="ev-sec">
          <h2>My team</h2>
          <ul className="ev-list">
            {m.team.map((t) => (
              <li className="ev-row" key={t.id}>
                <div className="ev-row__main">
                  <b>{t.employee}</b>
                  <span className="ev-sub">
                    {t.next}
                    {t.due ? ' · Due ' + dateWord(t.due) : ''}
                  </span>
                </div>
                <span className="ev-chip ev-chip--quiet">{t.stageWord}</span>
                <NavLink className="h-btn h-btn--ghost h-btn--sm" href={caseHref(t.id)}>
                  Open
                </NavLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {m.needsSign.length ? (
        <section className="ev-sec">
          <h2>Waiting for HR to sign</h2>
          <ul className="ev-list">
            {m.needsSign.map((t) => (
              <li className="ev-row" key={t.id}>
                <div className="ev-row__main">
                  <b>{t.employee}</b>
                  <span className="ev-sub">{t.period}</span>
                </div>
                <NavLink className="h-btn h-btn--primary h-btn--sm" href={caseHref(t.id, 'signoff')}>
                  Review and sign
                </NavLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------- one case */

function CaseRoute({ id, tab }: { id: string; tab: string }) {
  const forms = useQuery(formsQuery);
  const me = useQuery({ ...mineQuery, staleTime: Infinity });
  const cq = useQuery(caseQuery(id));
  const v = cq.data;
  const needStaff = !!v && (v.role.employee || v.role.manage);
  const staff = useQuery({ ...peopleQuery, enabled: needStaff });
  const courses = useQuery({ ...coursesQuery, enabled: !!v && v.role.raw });
  const err = forms.error || me.error || cq.error || staff.error || courses.error;
  useEffect(() => {
    document.title = 'Evaluation - FavorOS';
  }, []);
  if (err) return <Failed message={(err as Error).message} />;
  if (!v || !forms.data || !me.data || (needStaff && !staff.data) || (v.role.raw && !courses.data)) return <Opening />;
  return <CaseView v={v} forms={forms.data} meName={me.data.me.name} staff={staff.data || []} courses={courses.data || []} tab={tab} />;
}

function CaseView({ v, forms, meName, staff, courses, tab }: { v: CaseView; forms: FormsPayload; meName: string; staff: Ctx['staff']; courses: Ctx['courses']; tab: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const c = v.case;
  const r = v.role;
  const saver = useSaver(c.id);
  const [pick, setPickState] = useState<string[] | null>(null);
  const [reviewerQ, setReviewerQ] = useState('');
  const shown = tabShown(v, tab);
  const tabs = tabsFor(v);

  // The people named for feedback start as the ones already asked, and change only by what the person picks.
  const active = (v.reviewers || []).filter((x) => x.status === 'asked' || x.status === 'submitted').map((x) => x.email);
  const pickNow = pick ?? active;

  const reload = useCallback(
    () => Promise.all([qc.refetchQueries({ queryKey: evKeys.case(c.id), exact: true }), qc.refetchQueries({ queryKey: evKeys.me, exact: true })]),
    [qc, c.id],
  );
  const patch = useCallback((fn: (x: CaseView) => CaseView) => qc.setQueryData<CaseView>(evKeys.case(c.id), (x) => (x ? fn(x) : x)), [qc, c.id]);
  const replace = useCallback((href: string) => router.history.replace(href), [router]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [shown]);

  const x: Ctx = {
    view: v,
    forms,
    meName,
    staff,
    courses,
    saver,
    reload,
    patch,
    pick: pickNow,
    setPick: (p) => setPickState(p),
    reviewerQ,
    setReviewerQ,
    replace,
  };

  return (
    <div className="ev-root" id="ev-root">
      <NavLink className="ev-back" href="/evaluations/">
        All evaluations
      </NavLink>
      <header className="ev-head">
        <div>
          <p className="ev-kicker">{c.period}</p>
          <h1>{r.employee ? 'My evaluation' : c.employee.name}</h1>
          <p className="ev-sub">
            {r.employee ? '' : (c.employee.title || c.employee.team) + (c.employee.title || c.employee.team ? ' · ' : '') + 'Supervisor: ' + (c.supervisor.name || 'not assigned')}
          </p>
        </div>
        <span className="ev-chip">{c.stageWord}</span>
      </header>
      {tabs.length > 1 ? (
        <nav className="ev-tabs" aria-label="Sections of this evaluation">
          {tabs.map((t) => (
            <NavLink key={t[0]} href={caseHref(c.id, t[0])} aria-current={t[0] === shown ? 'page' : undefined}>
              {t[1]}
            </NavLink>
          ))}
        </nav>
      ) : null}
      {v.reportsToMissing ? (
        <div className="ev-gap" role="alert">
          <b>No supervisor set for {c.employee.name}</b>
          <span>The summary and plan need one.</span>
          <NavLink className="h-btn h-btn--ghost h-btn--sm" href="/admin/people/?filter=nosup">
            Open People and roles
          </NavLink>
        </div>
      ) : null}
      <div className="ev-body">
        {shown === 'overview' ? <Overview x={x} /> : null}
        {shown === 'self' ? (r.employee ? <EditorFor x={x} formId="A" /> : <SelfRead x={x} />) : null}
        {shown === 'mine' ? <EditorFor x={x} formId="B" /> : null}
        {shown === 'reviewers' ? <Reviewers x={x} /> : null}
        {shown === 'evidence' ? <Evidence x={x} /> : null}
        {shown === 'feedback' ? <Feedback x={x} /> : null}
        {shown === 'compare' ? <Compare x={x} /> : null}
        {shown === 'summary' ? <Summary x={x} /> : null}
        {shown === 'signoff' ? <Signoff x={x} /> : null}
      </div>
    </div>
  );
}

function SelfRead({ x }: { x: Ctx }) {
  return <FormRead form={x.forms.forms.A} answers={x.view.self ? x.view.self.answers : []} label="Self-assessment" forms={x.forms} />;
}
