// Learn > Manage (/learn/admin/): courses, learning paths, assigning them and the report of who is done, late and how they scored
// (port of src/pages/learn/admin/index.astro and the Manage half of public/js/learn-admin.js). The tab is in the address (?tab=) and
// ?course= or ?path= open the Assign tab on that course or path.
import { Suspense, useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import '@hub/styles/learn.css';
import '@hub/styles/lint-fix.css';
import { navQuery } from '../../lib/queries';
import { sendJson } from './api';
import {
  COLORS,
  STATUS,
  REPORT_STATUS,
  addDays,
  assignBody,
  assignCount,
  assignProblem,
  assignSummary,
  assignTargets,
  blankAssign,
  blankFilters,
  csvName,
  dayWord,
  learningValue,
  matchPeople,
  mins,
  pickLearning,
  plural,
  reportCsv,
  reportQs,
  sortCourses,
  sortPaths,
  swapOrder,
  targetFromSearch,
  todayEt,
  type AssignForm,
  type AssignResult,
  type CourseSummary,
  type Overview,
  type PathSummary,
  type People,
  type Report,
  type ReportFilters,
  type Who,
} from './logic';
import { laKeys, modeQuery, overviewQuery, peopleQuery, reportQuery, type Gate } from './queries';
import { ColorTile, Dialog, DialogError, FailView, Frame, PageSkeleton, StatusChip, Svg, toast, useConfirm } from './ui';

export interface ManageSearch {
  tab?: string;
  course?: string;
  path?: string;
}
const TABS = [
  ['courses', 'Courses'],
  ['paths', 'Paths'],
  ['assign', 'Assign'],
  ['report', 'Reports'],
] as const;
type Tab = (typeof TABS)[number][0];

export function ManagePage({ search }: { search: ManageSearch }) {
  return (
    <Frame view="admin">
      <Suspense
        fallback={
          <div aria-busy="true" style={{ display: 'contents' }}>
            <PageSkeleton title="Manage learning" />
          </div>
        }
      >
        <Loaded search={search} />
      </Suspense>
    </Frame>
  );
}

function Loaded({ search }: { search: ManageSearch }) {
  const { data } = useSuspenseQuery(overviewQuery);
  if (data.state === 'fail') return <FailView status={data.status} message={data.message} />;
  return <Manage overview={data.data} search={search} />;
}

const asTab = (t: string | undefined): Tab => (TABS.some(([k]) => k === t) ? (t as Tab) : 'courses');

function Manage({ overview, search }: { overview: Overview; search: ManageSearch }) {
  const [tab, setTab] = useState<Tab>(() => asTab(search.tab));
  const [assign, setAssign] = useState<AssignForm>(() => ({ ...blankAssign(), target: targetFromSearch(search) }));
  const [filters, setFilters] = useState<ReportFilters>(blankFilters);
  const [pathDlg, setPathDlg] = useState<{ path: PathSummary | null } | null>(null);
  const [newCourse, setNewCourse] = useState(false);

  const go = (t: Tab) => {
    setTab(t);
    window.history.replaceState(window.history.state, '', '/learn/admin/?tab=' + t);
  };
  const toAssign = (target: string) => {
    setAssign((a) => ({ ...a, target }));
    go('assign');
  };

  return (
    <>
      <div className="ln-head">
        <div>
          <h1>Manage learning</h1>
          <p>
            {plural(overview.courses.length, 'course')} and {plural(overview.paths.length, 'learning path')}
          </p>
        </div>
        <div className="ln-head__acts">
          {tab === 'courses' ? (
            <button type="button" className="h-btn h-btn--primary" id="la-new" onClick={() => setNewCourse(true)}>
              New course
            </button>
          ) : tab === 'paths' ? (
            <button type="button" className="h-btn h-btn--primary" id="la-newpath" onClick={() => setPathDlg({ path: null })}>
              New path
            </button>
          ) : null}
        </div>
      </div>
      <div className="la-tabs" role="tablist" aria-label="Manage learning">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" data-tab={k} aria-selected={tab === k} onClick={() => go(k)}>
            {l}
          </button>
        ))}
      </div>
      <div id="la-body">
        {tab === 'courses' ? <CoursesTab overview={overview} onAssign={toAssign} /> : null}
        {tab === 'paths' ? <PathsTab overview={overview} onEdit={(p) => setPathDlg({ path: p })} onAssign={toAssign} /> : null}
        {tab === 'assign' ? <AssignTab overview={overview} a={assign} setA={setAssign} /> : null}
        {tab === 'report' ? <ReportTab overview={overview} f={filters} setF={setFilters} /> : null}
      </div>
      {newCourse ? <NewCourseDialog onClose={() => setNewCourse(false)} /> : null}
      {pathDlg ? <PathDialog path={pathDlg.path} overview={overview} onClose={() => setPathDlg(null)} /> : null}
    </>
  );
}

/* ------------------------------------------------------------------------------------------------ courses */

function CoursesTab({ overview, onAssign }: { overview: Overview; onAssign: (target: string) => void }) {
  const list = sortCourses(overview.courses);
  return (
    <>
      <div className="ln-list">
        {list.length ? (
          list.map((c) => <CourseRow key={c.id} c={c} onAssign={onAssign} />)
        ) : (
          <div className="ln-empty">
            <b>No courses yet</b>
            <p>Build one from the help library, Clips and Drive.</p>
          </div>
        )}
      </div>
      <LearnModeCard />
    </>
  );
}

function CourseRow({ c, onAssign }: { c: CourseSummary; onAssign: (target: string) => void }) {
  return (
    <div className={'ln-card la-row ln-c--' + c.color}>
      <ColorTile color={c.color} icon="course" />
      <div className="la-row__t">
        <b>
          <Link to="/learn/admin/course/" search={{ c: c.id }}>
            {c.title}
          </Link>
        </b>
        <span>
          <StatusChip status={c.status} /> {c.audience ? c.audience + ' · ' : ''}
          {plural(c.lessons, 'lesson')}
          {c.minutes ? ' · ' + mins(c.minutes) : ''}
        </span>
      </div>
      <div className="la-row__n">
        {c.assigned ? `${c.done} of ${c.assigned} assigned done` : 'Not assigned'}
        {c.completions ? (
          <>
            <br />
            {plural(c.completions, 'completion')}
          </>
        ) : null}
      </div>
      <div className="la-row__acts">
        <Link to="/learn/admin/course/" search={{ c: c.id }} className="h-btn h-btn--ghost h-btn--sm">
          Edit
        </Link>
        <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-assign={'course:' + c.id} disabled={c.status !== 'published'} onClick={() => onAssign('course:' + c.id)}>
          Assign
        </button>
      </div>
    </div>
  );
}

/** Who can use Learn, for hub admins. Drawn after mount (it needs the menu answer) at the foot of the list. */
function LearnModeCard() {
  const nav = useQuery(navQuery);
  const mode = useQuery(modeQuery);
  const [mounted, setMounted] = useState(false);
  const [val, setVal] = useState('admins');
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mode.data) setVal(mode.data);
  }, [mode.data]);
  const admin = mounted && !!nav.data?.access?.admin;
  if (!admin) return null;
  const change = async (v: string) => {
    setVal(v);
    try {
      await sendJson('/api/admin/settings', 'POST', { id: 'learn.enabled', value: v });
      toast('Saved');
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <section className="ln-card la-form" id="la-set" aria-label="Who can use Learn">
      <h2>Who can use Learn</h2>
      <p className="ln-sum" style={{ margin: 0 }}>
        Admins and HR build and assign courses either way.
      </p>
      <div className="la-f" style={{ maxWidth: 320 }}>
        <select id="la-mode" aria-label="Who can use Learn" value={val} onChange={(e) => change(e.target.value)}>
          <option value="admins">Admins and HR only</option>
          <option value="staff">All staff</option>
          <option value="group">Chosen people and teams (pick them in Admin, Chat)</option>
          <option value="off">Off</option>
        </select>
      </div>
    </section>
  );
}

function NewCourseDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [audience, setAudience] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await sendJson('/api/learn/admin/courses', 'POST', { title, audience });
      const course = r.course as { id: string };
      qc.setQueryData(laKeys.course(course.id), { state: 'ok', data: course });
      void qc.invalidateQueries({ queryKey: laKeys.overview });
      onClose();
      void navigate({ to: '/learn/admin/course/', search: { c: course.id } });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog onClose={onClose} label="New course">
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2>New course</h2>
        <label className="la-f">
          <span>Name</span>
          <input id="nc-t" required maxLength={120} autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus="" />
        </label>
        <label className="la-f">
          <span>Who it is for</span>
          <input id="nc-a" maxLength={80} placeholder="Everyone, RDDs, Partner Care" autoComplete="off" value={audience} onChange={(e) => setAudience(e.target.value)} />
        </label>
        <div className="ln-dlg__acts">
          <button type="button" className="h-btn h-btn--ghost" data-no="" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="h-btn h-btn--primary" disabled={busy}>
            Create course
          </button>
        </div>
        <DialogError id="nc-e" text={err} />
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------------------------------ paths */

function PathsTab({ overview, onEdit, onAssign }: { overview: Overview; onEdit: (p: PathSummary) => void; onAssign: (target: string) => void }) {
  const cmap = new Map(overview.courses.map((c) => [c.id, c]));
  const list = sortPaths(overview.paths);
  return (
    <div className="ln-list">
      {list.length ? (
        list.map((p) => (
          <div key={p.id} className={'ln-card la-row ln-c--' + p.color}>
            <ColorTile color={p.color} icon="path" />
            <div className="la-row__t">
              <b>{p.title}</b>
              <span>
                <StatusChip status={p.status} /> {p.audience ? p.audience + ' · ' : ''}
                {p.courses
                  .map((id) => (cmap.get(id) || { title: '' }).title)
                  .filter(Boolean)
                  .join(', ') || 'No courses'}
              </span>
            </div>
            <div className="la-row__n">{p.assigned ? `${p.done} of ${p.assigned} assigned done` : 'Not assigned'}</div>
            <div className="la-row__acts">
              <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-edit={p.id} onClick={() => onEdit(p)}>
                Edit
              </button>
              <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-assign={'path:' + p.id} disabled={p.status !== 'published'} onClick={() => onAssign('path:' + p.id)}>
                Assign
              </button>
            </div>
          </div>
        ))
      ) : (
        <div className="ln-empty">
          <b>No learning paths yet</b>
          <p>A path puts courses in order for a role or a purpose.</p>
        </div>
      )}
    </div>
  );
}

function PathDialog({ path, overview, onClose }: { path: PathSummary | null; overview: Overview; onClose: () => void }) {
  const qc = useQueryClient();
  const isNew = !path;
  const [title, setTitle] = useState(path ? path.title : '');
  const [summary, setSummary] = useState(path ? path.summary : '');
  const [audience, setAudience] = useState(path ? path.audience : '');
  const [status, setStatus] = useState<string>(path ? path.status : 'draft');
  const [color, setColor] = useState(path ? path.color : 'leaf');
  const [courses, setCourses] = useState<string[]>(path ? path.courses.slice() : []);
  const [err, setErr] = useState('');
  const { confirm, node } = useConfirm();
  const cmap = new Map(overview.courses.map((c) => [c.id, c]));
  const left = overview.courses.filter((c) => !courses.includes(c.id) && c.status !== 'archived');

  const refresh = () => qc.invalidateQueries({ queryKey: laKeys.overview });
  const submit = async () => {
    const body = { title, summary, audience, color, status, courses };
    try {
      if (isNew) await sendJson('/api/learn/admin/paths', 'POST', body);
      else await sendJson('/api/learn/admin/path/' + encodeURIComponent(path.id), 'PATCH', body);
      toast('Saved');
      onClose();
      void refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const del = async () => {
    if (!path) return;
    if (!(await confirm({ title: 'Delete this path?', text: 'A path nobody has been assigned is deleted. One with assignments is archived so the records stay.', ok: 'Delete', danger: true }))) return;
    try {
      const r = await sendJson('/api/learn/admin/path/' + encodeURIComponent(path.id), 'DELETE');
      toast(r.result === 'archived' ? 'Archived' : 'Deleted');
      onClose();
      void refresh();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <>
      <Dialog cls="ln-dlg--wide" onClose={onClose} label={isNew ? 'New learning path' : 'Edit learning path'}>
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h2>{isNew ? 'New learning path' : 'Edit learning path'}</h2>
          <div className="la-fields">
            <label className="la-f wide">
              <span>Name</span>
              <input id="pd-t" maxLength={120} value={title} autoComplete="off" onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="la-f wide">
              <span>Summary</span>
              <textarea id="pd-s" maxLength={400} style={{ minHeight: 80 }} value={summary} onChange={(e) => setSummary(e.target.value)} />
            </label>
            <label className="la-f">
              <span>Who it is for</span>
              <input id="pd-a" maxLength={80} value={audience} autoComplete="off" onChange={(e) => setAudience(e.target.value)} />
            </label>
            <label className="la-f">
              <span>Status</span>
              <select id="pd-st" value={status} onChange={(e) => setStatus(e.target.value)}>
                {Object.entries(STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <div className="la-f wide">
              <span>Color</span>
              <div className="la-colors" id="pd-col">
                {COLORS.map((c) => (
                  <button key={c} type="button" className={'ln-c--' + c} data-c={c} aria-label={c} aria-pressed={c === color} onClick={() => setColor(c)}>
                    <Svg n="check" />
                  </button>
                ))}
              </div>
            </div>
            <div className="la-f wide">
              <span>Courses, in order</span>
              <div id="pd-list" className="la-less ln-card">
                {courses.length ? (
                  courses.map((id, i) => {
                    const c = cmap.get(id);
                    return (
                      <div key={id} className="la-l" style={{ gridTemplateColumns: '36px minmax(0,1fr) auto auto auto' }}>
                        <span className={'ln-tile ln-tile--sm ln-c--' + ((c && c.color) || 'leaf')}>
                          <Svg n="course" />
                        </span>
                        <span className="la-l__t">
                          <b>{c ? c.title : 'Missing course'}</b>
                          <span>{c ? `${STATUS[c.status]} · ${plural(c.lessons, 'lesson')}` : ''}</span>
                        </span>
                        <button type="button" className="la-ib" data-up={i} aria-label="Move up" disabled={!i} onClick={() => setCourses(swapOrder(courses, i, i - 1))}>
                          <Svg n="up" />
                        </button>
                        <button type="button" className="la-ib" data-dn={i} aria-label="Move down" disabled={i >= courses.length - 1} onClick={() => setCourses(swapOrder(courses, i, i + 1))}>
                          <Svg n="down" />
                        </button>
                        <button type="button" className="la-ib la-ib--x" data-rm={i} aria-label="Remove" onClick={() => setCourses(courses.filter((_, k) => k !== i))}>
                          <Svg n="x" />
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <p className="ln-sum" style={{ padding: 12 }}>
                    No courses yet.
                  </p>
                )}
              </div>
              <label className="la-f" style={{ marginTop: 8 }}>
                <span className="ln-sr">Add a course</span>
                <select id="pd-add" value="" onChange={(e) => e.target.value && setCourses([...courses, e.target.value])}>
                  <option value="">Add a course</option>
                  {left.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                      {c.status === 'draft' ? ' (draft)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <DialogError id="pd-e" text={err} />
          <div className="ln-dlg__acts">
            {isNew ? null : (
              <button type="button" className="h-btn h-btn--ghost" id="pd-del" style={{ marginRight: 'auto' }} onClick={() => void del()}>
                Delete
              </button>
            )}
            <button type="button" className="h-btn h-btn--ghost" data-no="" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="h-btn h-btn--primary">
              {isNew ? 'Create path' : 'Save'}
            </button>
          </div>
        </form>
      </Dialog>
      {node}
    </>
  );
}

/* ------------------------------------------------------------------------------------------------ assign */

function GateFail({ title, gate }: { title: string; gate: Extract<Gate<unknown>, { state: 'fail' }> }) {
  return (
    <div className="ln-empty">
      <b>{title}</b>
      <p>{gate.message}</p>
    </div>
  );
}

function AssignTab({ overview, a, setA }: { overview: Overview; a: AssignForm; setA: (f: AssignForm | ((p: AssignForm) => AssignForm)) => void }) {
  const q = useQuery(peopleQuery);
  if (!q.data) return <div className="ln-card ln-skel h-skel" />;
  if (q.data.state === 'fail') return <GateFail title="The staff list did not load" gate={q.data} />;
  return <AssignFormView overview={overview} people={q.data.data} a={a} setA={setA} />;
}

function AssignFormView({ overview, people, a, setA }: { overview: Overview; people: People; a: AssignForm; setA: (f: AssignForm | ((p: AssignForm) => AssignForm)) => void }) {
  const qc = useQueryClient();
  const [find, setFind] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const targets = assignTargets(overview);
  const targetOk = targets.some((t) => t[0] === a.target);
  const target = targetOk ? a.target : '';
  const byEmail = new Map(people.people.map((p) => [p.email, p]));
  const hits = matchPeople(people.people, find);
  const count = assignCount(people.people, a);
  const set = (p: Partial<AssignForm>) => setA((f) => ({ ...f, ...p }));
  const pick = (em: string) => set({ emails: a.emails.includes(em) ? a.emails.filter((x) => x !== em) : [...a.emails, em] });
  const due = (n: number) => set({ due: n ? addDays(todayEt(), n) : '' });

  const submit = async () => {
    const problem = assignProblem({ ...a, target }, targetOk);
    if (problem) {
      setMsg(problem);
      return;
    }
    setBusy(true);
    try {
      const r = await sendJson('/api/learn/admin/assign', 'POST', assignBody({ ...a, target }));
      setMsg(assignSummary(r as AssignResult));
      void qc.invalidateQueries({ queryKey: laKeys.reports });
      void qc.invalidateQueries({ queryKey: laKeys.overview });
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <form
      className="ln-card la-form"
      id="as-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2>Assign learning</h2>
      <div className="la-fields">
        <label className="la-f wide">
          <span>Course or path</span>
          <select id="as-t" value={target} onChange={(e) => set({ target: e.target.value })}>
            <option value="">Choose one</option>
            {targets.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <div className="la-f wide">
          <span>Who</span>
          <div className="ln-seg" role="group" aria-label="Who">
            {(
              [
                ['people', 'People'],
                ['team', 'A team'],
                ['everyone', 'Everyone'],
              ] as [Who, string][]
            ).map(([k, l]) => (
              <button key={k} type="button" data-who={k} aria-pressed={a.who === k} onClick={() => set({ who: k })}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="la-f wide" id="as-people" hidden={a.who !== 'people'}>
          <input className="la-in" id="as-find" type="search" placeholder="Find a person" autoComplete="off" aria-label="Find a person" value={find} onChange={(e) => setFind(e.target.value)} />
          <div className="la-sel" id="as-sel">
            {a.emails.map((e) => {
              const name = (byEmail.get(e) || { name: '' }).name || e;
              return (
                <span key={e} className="ln-chip ln-chip--c">
                  {name}
                  <button type="button" data-rm={e} aria-label={'Remove ' + name} onClick={() => set({ emails: a.emails.filter((x) => x !== e) })}>
                    &times;
                  </button>
                </span>
              );
            })}
          </div>
          <div className="la-people" id="as-list" role="group" aria-label="Staff">
            {hits.length ? (
              hits.map((p) => {
                const on = a.emails.includes(p.email);
                return (
                  <button key={p.email} type="button" className="la-person" data-pick={p.email} aria-pressed={on} onClick={() => pick(p.email)}>
                    {on ? <Svg n="check" style={{ width: 16, height: 16, stroke: 'currentColor', fill: 'none', strokeWidth: 3 }} /> : null}
                    <span>{p.name}</span>
                    <small>{p.team || p.title || ''}</small>
                  </button>
                );
              })
            ) : (
              <p className="ln-sum" style={{ padding: 12, margin: 0 }}>
                No one matches.
              </p>
            )}
          </div>
        </div>
        <label className="la-f wide" id="as-team" hidden={a.who !== 'team'}>
          <span>Team</span>
          <select id="as-teamsel" value={a.team} onChange={(e) => set({ team: e.target.value })}>
            <option value="">Choose a team</option>
            {people.teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <div className="la-f">
          <span>Due date</span>
          <input id="as-due" type="date" value={a.due} min={todayEt()} onChange={(e) => set({ due: e.target.value })} />
          <div className="ln-chips" style={{ marginTop: 6 }}>
            {(
              [
                [7, 'In a week'],
                [14, 'In two weeks'],
                [30, 'In 30 days'],
                [0, 'No due date'],
              ] as [number, string][]
            ).map(([n, l]) => (
              <button key={n} type="button" className="ln-chip" data-dd={n} style={{ border: 0, cursor: 'pointer', minHeight: 32 }} onClick={() => due(n)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <label className="la-f">
          <span>Note to them (optional)</span>
          <textarea id="as-note" maxLength={500} style={{ minHeight: 96 }} value={a.note} onChange={(e) => set({ note: e.target.value })} />
        </label>
      </div>
      <p className="ln-sum" id="as-msg" role="status" hidden={!msg}>
        {msg}
      </p>
      <div className="la-save">
        <button type="submit" className="h-btn h-btn--primary h-btn--lg" id="as-go" disabled={busy}>
          Assign
        </button>
        <small id="as-count">{a.who === 'people' && !count ? '' : plural(count, 'person', 'people')}</small>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------------------------------------ report */

function ReportTab({ overview, f, setF }: { overview: Overview; f: ReportFilters; setF: (f: ReportFilters | ((p: ReportFilters) => ReportFilters)) => void }) {
  const qs = reportQs(f);
  const q = useQuery({ ...reportQuery(qs), placeholderData: keepPreviousData });
  if (!q.data) return <div className="ln-card ln-skel h-skel" />;
  if (q.data.state === 'fail') return <GateFail title="The report did not load" gate={q.data} />;
  return <ReportView overview={overview} r={q.data.data} f={f} setF={setF} />;
}

function ReportView({ overview, r, f, setF }: { overview: Overview; r: Report; f: ReportFilters; setF: (f: ReportFilters | ((p: ReportFilters) => ReportFilters)) => void }) {
  const qc = useQueryClient();
  const { confirm, node } = useConfirm();
  const [text, setText] = useState(f.q);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => setF((p) => (p.q === text ? p : { ...p, q: text })), 300);
    return () => clearTimeout(t);
  }, [text, setF]);

  const s = r.summary;
  const cur = learningValue(f);
  const chip = (st: string) => <span className={'ln-chip' + (st === 'done' ? ' ln-chip--ok' : st === 'overdue' ? ' ln-chip--late' : st === 'in_progress' ? ' ln-chip--due' : '')}>{REPORT_STATUS[st]}</span>;

  const download = () => {
    const url = URL.createObjectURL(new Blob([reportCsv(r.rows)], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = csvName(todayEt());
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const remove = async (id: string) => {
    if (!(await confirm({ title: 'Remove this assignment?', text: 'The person keeps any progress. The task in Projects closes.', ok: 'Remove', danger: true }))) return;
    try {
      await sendJson('/api/learn/admin/assignments/' + encodeURIComponent(id), 'DELETE');
      toast('Removed');
      void qc.invalidateQueries({ queryKey: laKeys.reports });
      void qc.invalidateQueries({ queryKey: laKeys.overview });
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <>
      <div className="la-sum">
        <div>
          <b>{s.assigned}</b>
          <span>assigned</span>
        </div>
        <div>
          <b>{s.done}</b>
          <span>done</span>
        </div>
        <div>
          <b>{s.in_progress}</b>
          <span>in progress</span>
        </div>
        <div>
          <b>{s.not_started}</b>
          <span>not started</span>
        </div>
        <div className={s.overdue ? 'late' : ''}>
          <b>{s.overdue}</b>
          <span>late</span>
        </div>
        <div>
          <b>{s.avg_score == null ? '-' : s.avg_score + '%'}</b>
          <span>average quiz score</span>
        </div>
      </div>
      <div className="la-filters">
        <label className="la-f">
          <span>Learning</span>
          <select id="rp-c" value={cur} onChange={(e) => setF((p) => pickLearning(p, e.target.value))}>
            <option value="">All</option>
            {overview.paths.map((p) => (
              <option key={'p' + p.id} value={'p:' + p.slug}>
                {'Path: ' + p.title}
              </option>
            ))}
            {overview.courses.map((c) => (
              <option key={'c' + c.id} value={'c:' + c.slug}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label className="la-f">
          <span>Team</span>
          <select id="rp-t" value={f.team} onChange={(e) => setF((p) => ({ ...p, team: e.target.value }))}>
            <option value="">All teams</option>
            {r.teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="la-f">
          <span>Status</span>
          <select id="rp-s" value={f.status} onChange={(e) => setF((p) => ({ ...p, status: e.target.value }))}>
            <option value="">Any</option>
            {Object.entries(REPORT_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="la-f">
          <span>Person</span>
          <input id="rp-q" type="search" value={text} placeholder="Name" autoComplete="off" onChange={(e) => setText(e.target.value)} />
        </label>
        <button type="button" className="h-btn h-btn--ghost" id="rp-csv" disabled={!r.rows.length} onClick={download}>
          Download CSV
        </button>
      </div>
      {r.rows.length ? (
        <div className="ln-card la-tbl" role="table" aria-label="Assignments">
          <div className="la-tr la-tr--h" role="row">
            {['Person', 'Learning', 'Due', 'Status', 'Progress', 'Score', ''].map((h, i) => (
              <span key={i} role="columnheader">
                {h}
              </span>
            ))}
          </div>
          {r.rows.map((x) => (
            <div key={x.assignment_id} className="la-tr" role="row">
              <span>
                <b>{x.name}</b>
                <br />
                {x.team}
              </span>
              <span>
                <a href={x.href}>{x.title}</a>
              </span>
              <span>{x.due_date ? dayWord(x.due_date) : 'No date'}</span>
              <span>{chip(x.status)}</span>
              <span>
                {x.pct}%
                {x.last_at ? (
                  <>
                    <br />
                    {dayWord(x.last_at.slice(0, 10))}
                  </>
                ) : null}
              </span>
              <span>{x.best_score == null ? '' : x.best_score + '%'}</span>
              <span>
                {x.status === 'done' ? null : (
                  <button type="button" className="la-ib la-ib--x" data-rm={x.assignment_id} aria-label={`Remove ${x.name} from ${x.title}`} onClick={() => void remove(x.assignment_id)}>
                    <Svg n="x" />
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="ln-empty">
          <b>Nothing to show</b>
          <p>Assigned courses and paths, and how far each person has come, list here.</p>
        </div>
      )}
      {node}
    </>
  );
}

