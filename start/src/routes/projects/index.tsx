// Projects home, read only, ported from public/js/projects/home.js. Same markup and class names, so projects.css styles it unchanged.
// Both reads start on the server in parallel and stream into the page; tabs and search work in the browser with no further reads.
import { Suspense, useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { myTasksQuery, projectsQuery, type Person, type Project, type Task } from '../../poc/queries';
import { avatarProps, dueLabel, initials, PjIcon, todayStr } from '../../poc/pj';

const HUB = 'https://dash.favorintl.org';
const NBSP = String.fromCharCode(160);
type Tab = 'mine' | 'projects';

export const Route = createFileRoute('/projects/')({
  staticData: { nav: 'projects', title: 'Projects', layout: 'full' },
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => ({ tab: s.tab === 'projects' ? 'projects' : s.tab === 'mine' ? 'mine' : undefined }),
  loader: ({ context }) => {
    // Not awaited: the frame streams at once and each list fills in as its answer arrives.
    void context.queryClient.prefetchQuery(projectsQuery);
    void context.queryClient.prefetchQuery(myTasksQuery);
  },
  component: ProjectsHome,
});

function Avatar({ p }: { p?: Person | null }) {
  if (!p)
    return (
      <span className="pj-av pj-av--empty" title="Unassigned">
        <PjIcon n="user" />
      </span>
    );
  const a = avatarProps(p);
  return (
    <span className="pj-av" data-c={a.color} data-i={initials(a.name)}>
      {p.picture ? <img src={p.picture} alt="" referrerPolicy="no-referrer" loading="lazy" /> : null}
    </span>
  );
}

function ProjectCard({ p }: { p: Project }) {
  const total = p.open + p.done;
  const pct = total ? Math.round((p.done / total) * 100) : 0;
  return (
    <a className="pj-pcard" href={HUB + '/projects/p/?p=' + encodeURIComponent(p.key)} data-key={p.key}>
      <div className="pj-pcard__top">
        <i className="pj-dot pj-dot--lg" data-c={p.color} />
        <span className="pj-pcard__key">{p.key}</span>
        {p.team ? <span className="pj-pcard__team">{p.team}</span> : null}
        {p.status !== 'active' ? <span className="pj-tag">{p.status}</span> : null}
        {p.visibility === 'members' ? (
          <span className="pj-pcard__lock" title="Members only">
            <PjIcon n="lock" />
          </span>
        ) : null}
      </div>
      <h3>{p.name}</h3>
      {p.description ? <p>{p.description}</p> : null}
      <div className="pj-prog" role="img" aria-label={pct + ' percent done'}>
        <i style={{ width: pct + '%' }} data-c={p.color} />
      </div>
      <div className="pj-pcard__foot">
        <span>
          <b>{p.open}</b> open
        </span>
        {p.overdue ? (
          <span className="pj-late">
            <b>{p.overdue}</b> overdue
          </span>
        ) : null}
        {p.due_date ? (
          <span>
            <PjIcon n="cal" />
            {dueLabel(p.due_date)}
          </span>
        ) : null}
        <span className="pj-sp" />
        {p.lead ? <Avatar p={p.lead} /> : null}
      </div>
    </a>
  );
}

function Skel() {
  return (
    <div className="pj-skel pj-skel--cards">
      <i />
      <i />
      <i />
    </div>
  );
}

function MineBody() {
  const q = useSuspenseQuery(myTasksQuery);
  const [text, setText] = useState('');
  const t = todayStr();
  const tasks = useMemo(() => (q.data?.tasks ?? []).filter((x) => !x.parent_id), [q.data]);
  const open = tasks.filter((x) => x.status !== 'done');
  const late = open.filter((x) => x.due_date && x.due_date < t).length;
  const today = open.filter((x) => x.due_date === t).length;
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = open.filter((x) => words.every((w) => (x.title + ' ' + (x.project?.key || '')).toLowerCase().includes(w)));
  return (
    <>
      <div className="pj-tiles">
        <div className={'pj-tile' + (late ? ' is-late' : '')}>
          <b>{q.data ? late : NBSP}</b>
          <span>Overdue</span>
        </div>
        <div className="pj-tile">
          <b>{q.data ? today : NBSP}</b>
          <span>Due today</span>
        </div>
        <div className="pj-tile">
          <b>{q.data ? open.length : NBSP}</b>
          <span>Open</span>
        </div>
      </div>
      <div className="pj-bar pj-bar--home">
        <label className="pj-search pj-search--bar">
          <PjIcon n="search" />
          <input type="search" placeholder="Search my tasks" aria-label="Search my tasks" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      </div>
      {q.isPending ? (
        <Skel />
      ) : q.isError ? (
        <div className="pj-empty pj-empty--err">
          <p>{(q.error as Error).message}</p>
        </div>
      ) : rows.length ? (
        <ul className="poc-tasks" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map((x: Task) => (
            <li key={x.id} className="h-card" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 14px', marginBottom: 6 }}>
              <a href={HUB + '/projects/?t=' + encodeURIComponent(x.id)} style={{ flex: 1 }}>
                {x.title}
              </a>
              {x.project?.key ? <span className="pj-pcard__key">{x.project.key}</span> : null}
              {x.due_date ? <span className={x.due_date < t ? 'pj-late' : ''}>{dueLabel(x.due_date)}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="pj-empty pj-empty--first">
          <b>No open tasks</b>
          <span>Tasks given to you show here.</span>
        </div>
      )}
    </>
  );
}

function AllProjectsBody() {
  const q = useSuspenseQuery(projectsQuery);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'active' | 'all' | 'archived'>('active');
  const all = q.data?.projects ?? [];
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = all.filter(
    (p) =>
      (status === 'archived' ? p.status === 'archived' : p.status !== 'archived' && (status === 'all' || p.status === 'active')) &&
      words.every((w) => (p.name + ' ' + p.key + ' ' + (p.team || '')).toLowerCase().includes(w))
  );
  return (
    <>
      <div className="pj-bar pj-bar--home">
        <label className="pj-search pj-search--bar">
          <PjIcon n="search" />
          <input type="search" placeholder="Search projects" aria-label="Search projects" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="pj-chips" role="group" aria-label="Show">
          {(['active', 'all', 'archived'] as const).map((s) => (
            <button key={s} type="button" className={'pj-fchipbtn' + (status === s ? ' is-on' : '')} onClick={() => setStatus(s)}>
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="pj-pgrid">
        {q.isPending ? (
          <Skel />
        ) : q.isError ? (
          <div className="pj-empty pj-empty--err">
            <p>{(q.error as Error).message}</p>
          </div>
        ) : rows.length ? (
          rows.map((p) => <ProjectCard key={p.id} p={p} />)
        ) : (
          <div className="pj-empty pj-empty--first">
            <b>{all.length ? 'No project matches' : 'No projects yet'}</b>
            <span>{all.length ? 'Try another search.' : 'Create the first one with New project.'}</span>
          </div>
        )}
      </div>
    </>
  );
}

function ProjectsHome() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab: Tab = search.tab || 'mine';
  const projects = useQuery(projectsQuery);
  const mine = useQuery(myTasksQuery);
  const activeCount = (projects.data?.projects ?? []).filter((p) => p.status === 'active').length;
  const mineCount = (mine.data?.tasks ?? []).filter((x) => x.status !== 'done' && !x.parent_id).length;
  const set = (t: Tab) => void navigate({ search: { tab: t }, replace: true });
  return (
    <div id="pj-root" className="pj" data-page="home" data-ready="1">
      <div className="pj-home">
        <header className="pj-ph">
          <h1>Projects</h1>
          <div className="pj-ph__act">
            <a className="pj-btn" href={HUB + '/projects/'}>
              <PjIcon n="plus" />
              Add task
            </a>
            <a className="pj-btn pj-btn--primary" href={HUB + '/projects/'}>
              <PjIcon n="plus" />
              New project
            </a>
          </div>
        </header>
        <div className="pj-seg" role="tablist" aria-label="Projects">
          <button type="button" role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'is-on' : ''} onClick={() => set('mine')}>
            My tasks<span>{mineCount || ''}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'projects'} className={tab === 'projects' ? 'is-on' : ''} onClick={() => set('projects')}>
            All projects<span>{activeCount || ''}</span>
          </button>
        </div>
        <div className="pj-pane">
          <Suspense fallback={<Skel />}>{tab === 'mine' ? <MineBody /> : <AllProjectsBody />}</Suspense>
        </div>
      </div>
    </div>
  );
}
