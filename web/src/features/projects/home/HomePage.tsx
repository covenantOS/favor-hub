// The Projects home: My tasks (grouped by when they are due), the list of projects, and Team workload. Ported from
// public/js/projects/home.js. The Intake and My requests tabs are added by the Requests fold (../intake).
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { NavLink } from '@/shell/NavLink';
import { useRouter } from '@tanstack/react-router';
import { StaffProvider, useStaff } from '../lib/staff';
import { mineTasksQuery, projectsQuery } from '../lib/queries';
import { PageContext, type PageApi, type QuickAddDefaults } from '../lib/page';
import { TaskCtx, useCtx } from '../lib/store';
import { dueLabel, todayStr } from '../lib/dates';
import { goto, projectHref, setNavigator, useSearchParams, useSetSearch } from '../lib/url';
import { useTaskLinks } from '../lib/taskLinks';
import { Avatar } from '../kit/Avatar';
import { Icon } from '../kit/Icon';
import { debounce, OverlayHost } from '../kit/overlays';
import { installTips } from '../kit/tips';
import { toast } from '../kit/toast';
import { DrawerHost, openDrawer, setDrawerHooks, closeDrawer } from '../drawer';
import { ListView } from '../project/ListView';
import { AsanaChip, ConnectGate, useBfcacheReload, useProjectsKeys } from '../project/shared';
import { openPlanner } from '../sheets/Planner';
import { openProjectForm } from '../sheets/ProjectForm';
import { openQuickAdd } from '../sheets/QuickAdd';
import type { Project } from '../types';
import { HomeIntake, homeTabsExtra, type ExtraTab } from './intakeTabs';

const TeamLoad = lazy(() => import('../views/TeamLoad').then((m) => ({ default: m.TeamLoad })));

const TAB_KEY = 'favor.hub.projects.tab.v1';
const BASE_TABS = ['mine', 'projects', 'team'];

export function HomePage() {
  const router = useRouter();
  useEffect(() => {
    document.documentElement.classList.add('pj-page');
    setNavigator((href) => router.history.push(href));
    return () => {
      document.documentElement.classList.remove('pj-page');
      setNavigator(null);
    };
  }, [router]);
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <StaffProvider>
        <ConnectGate>
          <HomeBody />
        </ConnectGate>
      </StaffProvider>
    </Suspense>
  );
}

export function HomeSkeleton() {
  return (
    <div id="pj-root" className="pj" data-page="home" aria-live="polite">
      <div className="pj-home">
        <header className="pj-ph">
          <h1>Projects</h1>
        </header>
        <div className="pj-seg" role="tablist" aria-label="Projects" />
        <div className="pj-pane">
          <div className="pj-skel" aria-busy="true">
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
      </div>
    </div>
  );
}

function HomeBody() {
  const staff = useStaff();
  const qc = useQueryClient();
  const search = useSearchParams();
  const setSearch = useSetSearch();
  const summary = useSuspenseQuery(projectsQuery).data;
  const mineData = useSuspenseQuery(mineTasksQuery(false)).data;
  const ctx = useMemo(() => new TaskCtx('mine', staff, { tasks: mineData.tasks, total: mineData.total, counts: mineData.counts, showDone: false }), []); // eslint-disable-line react-hooks/exhaustive-deps
  useCtx(ctx);
  const extra = homeTabsExtra(staff);
  const tabIds = [...BASE_TABS, ...extra.map((t) => t.id)];

  useEffect(
    () => () => {
      qc.removeQueries({ queryKey: ['projects', 'tasks'] });
      qc.removeQueries({ queryKey: projectsQuery.queryKey });
    },
    [qc]
  );
  useEffect(() => installTips(), []);

  /* ----- the tab */
  const [prefTab, setPrefTab] = useState<string | null>(null);
  useEffect(() => {
    try {
      setPrefTab(localStorage.getItem(TAB_KEY));
    } catch {
      // private mode
    }
  }, []);
  const urlTab = search.get('tab');
  const tab = tabIds.includes(urlTab || '') ? (urlTab as string) : tabIds.includes(prefTab || '') ? (prefTab as string) : 'mine';
  const setTab = (t: string) => {
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // private mode
    }
    setPrefTab(t);
    setSearch((p) => p.set('tab', t), 'replace');
  };

  /* ----- the drawer, quick add, links */
  const openTask = useCallback((ref: string) => void openDrawer(ctx, ref), [ctx]);
  const quickAdd = useCallback((d: QuickAddDefaults = {}) => void openQuickAdd(ctx, d), [ctx]);
  useEffect(() => {
    setDrawerHooks({
      open: (t) => setSearch((p) => p.set('t', t.code || t.id), 'replace'),
      close: () => {
        const clear = () => setSearch((p) => p.delete('t'), 'replace');
        clear();
        addEventListener('popstate', clear, { once: true });
        setTimeout(() => removeEventListener('popstate', clear), 800);
      },
    });
    return () => setDrawerHooks({});
  }, [setSearch]);
  const t0 = useRef(search.get('t'));
  useEffect(() => {
    if (t0.current) openTask(t0.current);
    return () => closeDrawer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const page: PageApi = useMemo(() => ({ ctx, openTask, quickAdd }), [ctx, openTask, quickAdd]);
  useTaskLinks(openTask);
  useProjectsKeys({ projectKey: '', openTask, quickAdd });
  useBfcacheReload();
  useEffect(() => {
    document.title = 'Projects - FavorOS';
  }, []);

  /* ----- the counts */
  const todayS = todayStr();
  const open = ctx.tasks.filter((x) => x.status !== 'done');
  const counts = { open: open.length, late: open.filter((x) => x.due_date && x.due_date < todayS).length, today: open.filter((x) => x.due_date === todayS).length };
  const activeProjects = summary.projects.filter((p) => p.status === 'active').length;

  return (
    <PageContext.Provider value={page}>
      <div id="pj-root" className="pj" data-page="home" data-ready="1" aria-live="polite">
        <div className="pj-home">
          <header className="pj-ph">
            <h1>Projects</h1>
            <AsanaChip />
            <div className="pj-ph__act">
              <HomeIntake.MakeRequest />
              <button type="button" className="pj-btn" data-h="task" onClick={() => quickAdd({})}>
                <Icon name="plus" />
                Add task
              </button>
              <button
                type="button"
                className="pj-btn"
                data-h="plan"
                onClick={async () => {
                  const p = await openPlanner({});
                  if (p) {
                    toast('Project created');
                    goto(projectHref(p.key));
                  }
                }}
              >
                <Icon name="list" />
                Plan a project
              </button>
              <button
                type="button"
                className="pj-btn pj-btn--primary"
                data-h="new"
                onClick={async () => {
                  const p = await openProjectForm({});
                  if (p) {
                    toast('Project created');
                    goto(projectHref(p.key));
                  }
                }}
              >
                <Icon name="plus" />
                New project
              </button>
            </div>
          </header>
          <div
            className="pj-seg"
            role="tablist"
            aria-label="Projects"
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                const n = tabIds[(tabIds.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : tabIds.length - 1)) % tabIds.length];
                setTab(n);
                requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-tab="${n}"]`)?.focus());
              }
            }}
          >
            <button type="button" role="tab" data-tab="mine" id="pj-tab-mine" className={tab === 'mine' ? 'is-on' : ''} aria-selected={tab === 'mine'} tabIndex={tab === 'mine' ? 0 : -1} onClick={() => setTab('mine')}>
              My tasks<span data-c-mine>{counts.open ? String(counts.open) : ''}</span>
            </button>
            <button type="button" role="tab" data-tab="projects" id="pj-tab-projects" className={tab === 'projects' ? 'is-on' : ''} aria-selected={tab === 'projects'} tabIndex={tab === 'projects' ? 0 : -1} onClick={() => setTab('projects')}>
              All projects<span data-c-projects>{activeProjects || ''}</span>
            </button>
            <button type="button" role="tab" data-tab="team" id="pj-tab-team" className={tab === 'team' ? 'is-on' : ''} aria-selected={tab === 'team'} tabIndex={tab === 'team' ? 0 : -1} onClick={() => setTab('team')}>
              Team workload
            </button>
            {extra.map((t: ExtraTab) => (
              <button key={t.id} type="button" role="tab" data-tab={t.id} id={'pj-tab-' + t.id} className={tab === t.id ? 'is-on' : ''} aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)}>
                {t.label}
                <span>{t.count ? String(t.count) : ''}</span>
              </button>
            ))}
          </div>
          <div className="pj-pane">
            {tab === 'mine' ? <MineTab ctx={ctx} counts={counts} openTask={openTask} quickAdd={quickAdd} /> : null}
            {tab === 'projects' ? <ProjectsTab projects={summary.projects} /> : null}
            {tab === 'team' ? (
              <Suspense
                fallback={
                  <div className="pj-skel" aria-busy="true">
                    <i />
                    <i />
                    <i />
                  </div>
                }
              >
                <TeamLoad openTask={openTask} quickAdd={quickAdd} />
              </Suspense>
            ) : null}
            {extra.some((t) => t.id === tab) ? <HomeIntake.Tab id={tab} /> : null}
          </div>
        </div>
        <DrawerHost />
        <OverlayHost />
      </div>
    </PageContext.Provider>
  );
}

function MineTab({ ctx, counts, openTask }: { ctx: TaskCtx; counts: { open: number; late: number; today: number }; openTask: (ref: string) => void; quickAdd: (d?: QuickAddDefaults) => void }) {
  useCtx(ctx);
  const [q, setQ] = useState('');
  const apply = useMemo(
    () =>
      debounce((v: string) => {
        ctx.filter.q = v.trim();
        ctx.emit('filter');
      }, 120),
    [ctx]
  );
  useEffect(() => () => apply.cancel(), [apply]);
  useEffect(
    () => () => {
      ctx.filter.q = '';
    },
    [ctx]
  );
  return (
    <>
      <div className="pj-tiles">
        <div className={'pj-tile' + (counts.late ? ' is-late' : '')}>
          <b>{counts.late}</b>
          <span>Overdue</span>
        </div>
        <div className="pj-tile">
          <b>{counts.today}</b>
          <span>Due today</span>
        </div>
        <div className="pj-tile">
          <b>{counts.open}</b>
          <span>Open</span>
        </div>
      </div>
      <div className="pj-bar pj-bar--home">
        <label className="pj-search pj-search--bar">
          <Icon name="search" />
          <input
            type="search"
            data-mq
            placeholder="Search my tasks"
            aria-label="Search my tasks"
            autoComplete="off"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              apply(e.target.value);
            }}
          />
        </label>
        <label className="pj-check-label">
          <input
            type="checkbox"
            checked={ctx.showDone}
            onChange={(e) => {
              ctx.showDone = e.target.checked;
              ctx.loading = true;
              ctx.emit('load');
              void ctx.reloadTasks().then(() => {
                ctx.loading = false;
                ctx.emit('load');
              });
            }}
          />
          <span>Show completed</span>
        </label>
      </div>
        <ListView ctx={ctx} mode="mine" onOpen={(t) => openTask(t.code || t.id)} />
    </>
  );
}

function ProjectCard({ p }: { p: Project }) {
  const total = p.open + p.done;
  const pct = total ? Math.round((p.done / total) * 100) : 0;
  return (
    <NavLink className="pj-pcard" href={projectHref(p.key)} data-key={p.key}>
      <div className="pj-pcard__top">
        <i className="pj-dot pj-dot--lg" data-c={p.color} />
        <span className="pj-pcard__key">{p.key}</span>
        {p.team ? <span className="pj-pcard__team">{p.team}</span> : null}
        {p.status !== 'active' ? <span className="pj-tag">{p.status}</span> : null}
        {p.visibility === 'members' ? (
          <span className="pj-pcard__lock" title="Members only">
            <Icon name="lock" />
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
            <Icon name="cal" />
            {dueLabel(p.due_date)}
          </span>
        ) : null}
        <span className="pj-sp" />
        {p.lead ? <Avatar p={p.lead} /> : null}
      </div>
    </NavLink>
  );
}

function ProjectsTab({ projects }: { projects: Project[] }) {
  const [pq, setPq] = useState('');
  const [pstatus, setPstatus] = useState('active');
  const [q, setQ] = useState('');
  const apply = useMemo(() => debounce((v: string) => setPq(v.trim()), 100), []);
  useEffect(() => () => apply.cancel(), [apply]);
  const words = pq.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = projects.filter((p) => (pstatus === 'archived' ? p.status === 'archived' : p.status !== 'archived' && (pstatus === 'all' || p.status === 'active')) && words.every((w) => (p.name + ' ' + p.key + ' ' + p.team).toLowerCase().includes(w)));
  return (
    <>
      <div className="pj-bar pj-bar--home">
        <label className="pj-search pj-search--bar">
          <Icon name="search" />
          <input
            type="search"
            data-pq
            placeholder="Search projects"
            aria-label="Search projects"
            autoComplete="off"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              apply(e.target.value);
            }}
          />
        </label>
        <div className="pj-chips" role="group" aria-label="Show">
          {['active', 'all', 'archived'].map((s) => (
            <button key={s} type="button" className={'pj-fchipbtn' + (pstatus === s ? ' is-on' : '')} onClick={() => setPstatus(s)}>
              {s === 'active' ? 'Active' : s === 'all' ? 'All' : 'Archived'}
            </button>
          ))}
        </div>
      </div>
      <div className="pj-pgrid">
        {rows.length ? (
          rows.map((p) => <ProjectCard key={p.id} p={p} />)
        ) : (
          <div className="pj-empty pj-empty--first">
            <b>{projects.length ? 'No project matches' : 'No projects yet'}</b>
            <span>{projects.length ? 'Try another search.' : 'Create the first one with New project.'}</span>
          </div>
        )}
      </div>
    </>
  );
}

/** When Projects cannot be read: the reason as the server words it, and a way to try again. */
export function HomeError({ message }: { message: string }) {
  return (
    <div id="pj-root" className="pj" data-page="home" data-ready="1">
      <div className="pj-home">
        <header className="pj-ph">
          <h1>Projects</h1>
        </header>
        <div className="pj-empty pj-empty--err">
          <b>Projects did not load</b>
          <span>{message}</span>
          <button type="button" className="pj-btn" onClick={() => location.reload()}>
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
