// One project: ?p=KEY&view=list|board|calendar|timeline|workload, &t=CODE opens a task, &section=ID scrolls to a section. The header,
// view tabs, filter bar and stage are here; the views are in ListView, BoardView and ../views. Ported from mountProject in
// public/js/projects/app.js.
import '../css';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { NavLink } from '@/shell/NavLink';
import { useRouter } from '@tanstack/react-router';
import { StaffProvider, useStaff } from '../lib/staff';
import { api } from '../lib/api';
import { projectQuery, projectTasksQuery, pjKeys } from '../lib/queries';
import { PageContext, type PageApi, type QuickAddDefaults } from '../lib/page';
import { TaskCtx, useCtx } from '../lib/store';
import { cleanRef, goto, projectHref, setNavigator, useSearchParams, useSetSearch } from '../lib/url';
import { useTaskLinks } from '../lib/taskLinks';
import { PRIORITY } from '../lib/dates';
import type { Task } from '../types';
import { Avatar } from '../kit/Avatar';
import { Icon } from '../kit/Icon';
import { choose, OverlayHost, openSheet, debounce } from '../kit/overlays';
import { installTips } from '../kit/tips';
import { toast } from '../kit/toast';
import { closeDrawer, DrawerHost, openDrawer, setDrawerHooks } from '../drawer';
import { openProjectForm } from '../sheets/ProjectForm';
import { openQuickAdd } from '../sheets/QuickAdd';
import { openStatus } from '../sheets/Status';
import { BoardView } from './BoardView';
import { FilterBar } from './FilterBar';
import { activeCount, applyFilters, filtersFrom, writeFilters } from './filters';
import { ListView, type ListHandle } from './ListView';
import { Sidebar } from './Sidebar';
import { AsanaChip, ConnectGate, useBfcacheReload, useProjectsKeys } from './shared';

const CalendarView = lazy(() => import('../views/CalendarView').then((m) => ({ default: m.CalendarView })));
const TimelineView = lazy(() => import('../views/TimelineView').then((m) => ({ default: m.TimelineView })));
const WorkloadView = lazy(() => import('../views/WorkloadView').then((m) => ({ default: m.WorkloadView })));

const PREFS = 'favor.hub.projects.prefs.v1';
const readPrefs = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(PREFS) || '{}');
  } catch {
    return {};
  }
};
const setPref = (k: string, v: string) => {
  try {
    const p = readPrefs();
    p[k] = v;
    localStorage.setItem(PREFS, JSON.stringify(p));
  } catch {
    // private mode
  }
};
const SIDE = 'favor.hub.projects.side.v1';

const VIEWS: [string, string, string][] = [
  ['list', 'List', 'list'],
  ['board', 'Board', 'board'],
  ['calendar', 'Calendar', 'cal'],
  ['timeline', 'Timeline', 'gantt'],
  ['workload', 'Workload', 'user'],
];

/** The page shell: Suspense with a skeleton at the final size while the project and its tasks arrive. */
export function ProjectPage() {
  const search = useSearchParams();
  const key = cleanRef(search.get('p'));
  const router = useRouter();
  useEffect(() => {
    document.documentElement.classList.add('pj-page');
    setNavigator((href) => router.history.push(href));
    return () => {
      document.documentElement.classList.remove('pj-page');
      setNavigator(null);
    };
  }, [router]);
  useEffect(() => {
    if (!key) router.history.replace('/projects/');
  }, [key, router]);
  if (!key) return <ProjectSkeleton />;
  return (
    <Suspense fallback={<ProjectSkeleton />}>
      <StaffProvider>
        <ConnectGate>
          <ProjectBody key={key} pkey={key} />
        </ConnectGate>
      </StaffProvider>
    </Suspense>
  );
}

export function ProjectSkeleton() {
  return (
    <div id="pj-root" className="pj" data-page="project" aria-live="polite">
      <div className="pj-shell">
        <aside className="pj-side" aria-label="Projects" />
        <div className="pj-proj">
          <header className="pj-pheader">
            <div className="pj-pheader__t">
              <i className="pj-dot pj-dot--lg" data-c="leaf" />
              <h1 className="pj-skel-line">&nbsp;</h1>
            </div>
          </header>
          <div className="pj-tabsrow" />
          <div className="pj-stage pj-stage--list">
            <div className="pj-skel" aria-busy="true">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProjectNotFound({ status, message }: { status: number; message: string }) {
  const gone = status === 404 || status === 403;
  return (
    <div id="pj-root" className="pj" data-page="project" data-ready="1">
      <div className="pj-empty pj-empty--err">
        <b>{gone ? 'This project is not available to you' : 'This project did not load'}</b>
        <span>{message}</span>
        {gone ? (
          <NavLink className="pj-btn" href="/projects/">
            All projects
          </NavLink>
        ) : (
          <button type="button" className="pj-btn" onClick={() => location.reload()}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

function ProjectBody({ pkey }: { pkey: string }) {
  const staff = useStaff();
  const qc = useQueryClient();
  const search = useSearchParams();
  const setSearch = useSetSearch();
  const fseed = useMemo(() => filtersFrom(search), []); // eslint-disable-line react-hooks/exhaustive-deps
  const detail = useSuspenseQuery(projectQuery(pkey)).data;
  const tasks = useSuspenseQuery(projectTasksQuery(pkey, fseed.done)).data;

  const ctx = useMemo(() => {
    const c = new TaskCtx('project', staff, { project: detail.project, sections: detail.sections, members: detail.members, canManage: detail.can.manage, counts: detail.counts, tasks: tasks.tasks, total: tasks.total, showDone: fseed.done });
    if (tasks.counts) c.counts = tasks.counts;
    applyFilters(c, fseed);
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useCtx(ctx);

  // Leaving the page drops what it read, so the next visit asks again.
  useEffect(
    () => () => {
      qc.removeQueries({ queryKey: ['projects', 'tasks'] });
      qc.removeQueries({ queryKey: pjKeys.project(pkey) });
      qc.removeQueries({ queryKey: pjKeys.projects });
    },
    [qc, pkey]
  );
  useEffect(() => installTips(), []);

  /* ---------------------------------------------------------------- view, section, prefs */
  const [prefView, setPrefView] = useState<string | null>(null);
  useEffect(() => {
    const pf = readPrefs();
    if (pf.view) setPrefView(pf.view);
    if (pf.boardBy === 'status') {
      ctx.boardBy = 'status';
      ctx.emit('group');
    }
  }, [ctx]);
  const urlView = search.get('view');
  const view = VIEWS.some((v) => v[0] === urlView) ? (urlView as string) : VIEWS.some((v) => v[0] === prefView) ? (prefView as string) : 'list';
  const section = search.get('section') || '';
  const [taskNow, setTaskNow] = useState<Task | null>(null);

  const setView = useCallback(
    (v: string) => {
      setPref('view', v);
      setPrefView(v);
      ctx.sel.clear();
      ctx.selecting = false;
      setSearch((p) => p.set('view', v), 'push');
    },
    [ctx, setSearch]
  );
  // Switching back from a view that loaded its own data: the store already has the tasks.
  const listHandle = useRef<ListHandle | null>(null);

  const gotoSection = useCallback(
    (id: string, user: boolean) => {
      if (user) setSearch((p) => (id ? p.set('section', id) : p.delete('section')), 'replace');
      if (view !== 'list' && view !== 'board') setView('list');
      requestAnimationFrame(() => {
        const z = document.querySelector<HTMLElement>(`.pj-sec[data-zone="${CSS.escape(id)}"], .pj-col[data-zone="${CSS.escape(id)}"]`);
        if (!z) return;
        const fold = z.classList.contains('is-folded') && z.querySelector<HTMLElement>('[data-act="fold"]');
        if (fold) fold.click();
        z.scrollIntoView({ block: 'start', inline: 'start', behavior: 'smooth' });
      });
    },
    [setSearch, view, setView]
  );

  /* ---------------------------------------------------------------- the filters and the address */
  const sigOf = (f: { q: string; owner: string; due: string; status: string; code: string }, done: boolean) => JSON.stringify([f.q, f.owner, f.due, f.status, f.code, done]);
  useEffect(
    () =>
      ctx.on((w) => {
        if (w !== 'filter' && w !== 'load') return;
        setSearch((p) => writeFilters(ctx, p), 'replace');
      }),
    [ctx, setSearch]
  );
  // Back and Forward between filters of this project are answered from the address.
  useEffect(() => {
    const f = filtersFrom(search);
    if (sigOf(f, f.done) === sigOf(ctx.filter, ctx.showDone)) return;
    applyFilters(ctx, f);
    if (f.done) ctx.showDone = true;
    else if (ctx.showDone && !f.status) void ctx.setShowDone(false);
    ctx.emit('filter');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  /* ---------------------------------------------------------------- the drawer */
  const openTask = useCallback(
    (ref: string) => {
      void openDrawer(ctx, ref);
    },
    [ctx]
  );
  useEffect(() => {
    setDrawerHooks({
      open: (t) => {
        setSearch((p) => p.set('t', t.code || t.id), 'replace');
        setTaskNow(t);
      },
      // Closing steps back out of the drawer's history entry. A drawer opened from a task link steps back to an address that still
      // names the task, so the task is cleared again once that step lands.
      close: () => {
        const clear = () => setSearch((p) => p.delete('t'), 'replace');
        clear();
        addEventListener('popstate', clear, { once: true });
        setTimeout(() => removeEventListener('popstate', clear), 800);
        setTaskNow(null);
      },
    });
    return () => setDrawerHooks({});
  }, [setSearch]);
  const initialT = useRef(search.get('t'));
  useEffect(() => {
    if (initialT.current) openTask(initialT.current);
    const sec = new URLSearchParams(location.search).get('section');
    if (sec) setTimeout(() => gotoSection(sec, false), 60);
    return () => closeDrawer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const quickAdd = useCallback(
    (d: QuickAddDefaults = {}) => {
      void openQuickAdd(ctx, d);
    },
    [ctx]
  );
  const page: PageApi = useMemo(() => ({ ctx, openTask, quickAdd }), [ctx, openTask, quickAdd]);
  useTaskLinks(openTask);
  useProjectsKeys({ projectKey: ctx.project?.key || pkey, openTask, quickAdd });
  useBfcacheReload();
  useEffect(() => {
    document.title = (ctx.project?.name || 'Project') + ' - FavorOS';
  }, [ctx.project?.name]);

  /* ---------------------------------------------------------------- the sidebar */
  const [collapsed, setCollapsed] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDE) === '1');
    } catch {
      // private mode
    }
  }, []);
  const toggleSide = () => {
    if (matchMedia('(max-width: 860px)').matches) setSideOpen((o) => !o);
    else {
      const v = !collapsed;
      setCollapsed(v);
      try {
        localStorage.setItem(SIDE, v ? '1' : '0');
      } catch {
        // private mode
      }
    }
  };

  const p = ctx.project;
  if (!p) return <ProjectSkeleton />;
  const sname = (taskNow ? taskNow.section_id : section) ? ctx.sectionName(taskNow ? taskNow.section_id : section) : '';
  const secId = taskNow ? taskNow.section_id || '' : section;
  const ms = ctx.members.slice(0, 5);

  const projectMenu = async (anchor: HTMLElement) => {
    const archived = p.status === 'archived';
    const items = [{ value: 'edit', label: 'Edit details', hint: undefined as string | undefined }];
    if (ctx.canManage !== false) items.push({ value: archived ? 'restore' : 'archive', label: archived ? 'Restore' : 'Archive', hint: archived ? 'Back on the project lists' : 'Off the project lists until restored' }, { value: 'delete', label: 'Delete project', hint: 'Removes it and its tasks from FavorOS' });
    const v = await choose<string>({ anchor, title: 'Project', items });
    if (!v) return;
    if (v === 'archive' || v === 'restore') {
      try {
        const r = await api.patchProject(p.id, { status: v === 'archive' ? 'archived' : 'active' });
        if (r && r.project) {
          Object.assign(p, r.project);
          ctx.emit('project');
          toast(v === 'archive' ? 'Archived. Find it under Archived on the Projects page.' : 'Restored.');
        }
      } catch (err) {
        toast((err as Error).message || 'That did not save.');
      }
      return;
    }
    if (v === 'delete') {
      confirmDelete();
      return;
    }
    await editDetails();
  };
  const editDetails = async () => {
    const np = await openProjectForm({ project: p, members: ctx.members });
    if (np) {
      Object.assign(p, np);
      try {
        const d = await api.project(p.id);
        ctx.members = d.members || ctx.members;
      } catch {
        // keep the members we have
      }
      ctx.emit('project');
    }
  };
  const confirmDelete = () => {
    openSheet({
      title: 'Delete ' + p.name,
      render: (s) => <DeleteBody p={p} close={() => s.close()} />,
    });
  };

  return (
    <PageContext.Provider value={page}>
      <div id="pj-root" className="pj" data-page="project" data-ready="1" aria-live="polite">
        <div className="pj-shell">
          <Sidebar ctx={ctx} pkey={pkey} collapsed={collapsed} onCollapse={toggleSide} open={sideOpen} onClose={() => setSideOpen(false)} onSection={(id) => gotoSection(id, true)} />
          <div className="pj-proj">
            <header className="pj-pheader">
              <button type="button" className="pj-ib pj-sidebtn" aria-label="Projects menu" data-ui-tooltip="pj-tip" onClick={toggleSide}>
                <Icon name="list" />
              </button>
              <div className="pj-pheader__t">
                <i className="pj-dot pj-dot--lg" data-c={p.color} />
                <h1>{p.name}</h1>
                <span className="pj-pkey">{p.key}</span>
                {p.team ? <span className="pj-pcard__team">{p.team}</span> : null}
                {p.status !== 'active' ? <span className="pj-tag">{p.status}</span> : null}
                {p.asana_sync === true ? <span className="pj-tag pj-tag--asana">Synced with Asana</span> : null}
                {p.visibility === 'members' ? (
                  <span className="pj-pcard__lock" title="Members only">
                    <Icon name="lock" />
                  </span>
                ) : null}
                <AsanaChip />
              </div>
              <div className="pj-pheader__act">
                <button type="button" className="pj-members-btn" aria-label="Members" onClick={() => void editDetails()}>
                  <span className="pj-stack">
                    {ms.map((m) => (
                      <Avatar key={m.email} p={m} />
                    ))}
                  </span>
                  {ctx.members.length > 5 ? <span className="pj-more">+{ctx.members.length - 5}</span> : null}
                </button>
                <button type="button" className="pj-btn pj-pa-status" aria-label="Friday update" onClick={() => void openStatus(p)}>
                  <Icon name="clock" />
                  <span>Friday update</span>
                </button>
                <button type="button" className="pj-ib" aria-label="Project menu" data-ui-tooltip="pj-tip" onClick={(e) => void projectMenu(e.currentTarget)}>
                  <Icon name="more" />
                </button>
              </div>
            </header>
            <nav className="pj-crumbs" aria-label="Breadcrumb">
              <NavLink href="/projects/">Projects</NavLink>
              <Icon name="right" />
              <button
                type="button"
                onClick={() => {
                  closeDrawer();
                  setSearch((q) => q.delete('section'), 'replace');
                  document.querySelector('.pj-stage')?.scrollIntoView({ block: 'start' });
                }}
              >
                {p.name}
              </button>
              {sname ? (
                <>
                  <Icon name="right" />
                  <button
                    type="button"
                    onClick={() => {
                      closeDrawer();
                      gotoSection(secId, true);
                    }}
                  >
                    {sname}
                  </button>
                </>
              ) : null}
              {taskNow ? (
                <>
                  <Icon name="right" />
                  <span className="pj-crumbs__cur">{taskNow.code || taskNow.title}</span>
                </>
              ) : null}
            </nav>
            <div className="pj-tabsrow">
              <nav
                className="pj-views"
                role="tablist"
                aria-label="View"
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                  const i = VIEWS.findIndex((x) => x[0] === view) + (e.key === 'ArrowRight' ? 1 : -1);
                  if (VIEWS[i]) {
                    setView(VIEWS[i][0]);
                    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-view="${VIEWS[i][0]}"]`)?.focus());
                  }
                }}
              >
                {VIEWS.map(([id, label, ic]) => (
                  <button key={id} type="button" role="tab" data-ui-tooltip="pj-tip" aria-label={label} className={'pj-view' + (id === view ? ' is-on' : '')} data-view={id} aria-selected={id === view} tabIndex={id === view ? 0 : -1} onClick={() => id !== view && setView(id)}>
                    <Icon name={ic} />
                    <span>{label}</span>
                  </button>
                ))}
              </nav>
              <Tools ctx={ctx} view={view} listHandle={listHandle} quickAdd={quickAdd} />
            </div>
            <div className="pj-fbar" hidden={!(view === 'list' || view === 'board')}>
              <FilterBar ctx={ctx} project={pkey} />
            </div>
            <div className={'pj-stage' + (view === 'list' ? ' pj-stage--list' : view === 'board' ? ' pj-stage--board' : ' pj-stage--ext')}>
              {view === 'list' ? <ListView ctx={ctx} mode="project" projectKey={pkey} onOpen={(t) => openTask(t.code || t.id)} handleRef={listHandle} /> : null}
              {view === 'board' ? <BoardView ctx={ctx} projectKey={pkey} onOpen={(t) => openTask(t.code || t.id)} /> : null}
              {view === 'calendar' || view === 'timeline' || view === 'workload' ? (
                <div className="pj-ext" id={'pj-view-' + view} data-view={view} data-project={p.id} data-key={p.key}>
                  <Suspense
                    fallback={
                      <div className="pj-skel" aria-busy="true">
                        <i />
                        <i />
                        <i />
                      </div>
                    }
                  >
                    {view === 'calendar' ? <CalendarView ctx={ctx} project={p} sections={ctx.sections} members={ctx.members} openTask={openTask} quickAdd={quickAdd} /> : null}
                    {view === 'timeline' ? <TimelineView ctx={ctx} project={p} sections={ctx.sections} members={ctx.members} openTask={openTask} quickAdd={quickAdd} /> : null}
                    {view === 'workload' ? <WorkloadView ctx={ctx} project={p} sections={ctx.sections} members={ctx.members} openTask={openTask} quickAdd={quickAdd} /> : null}
                  </Suspense>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <DrawerHost />
        <OverlayHost />
      </div>
    </PageContext.Provider>
  );
}

/** The search box, filter, group, select and Add task buttons at the right of the view tabs. */
function Tools({ ctx, view, listHandle, quickAdd }: { ctx: TaskCtx; view: string; listHandle: React.MutableRefObject<ListHandle | null>; quickAdd: (d?: QuickAddDefaults) => void }) {
  useCtx(ctx);
  const list = view === 'list';
  const board = view === 'board';
  const taskView = list || board;
  const n = (ctx.filter.priority ? 1 : 0) + (ctx.sort.by !== 'manual' ? 1 : 0) + (taskView ? 0 : activeCount(ctx));
  const [q, setQ] = useState(ctx.filter.q);
  const qRef = useRef<HTMLInputElement>(null);
  // The address (Back, Clear filters) can change the filter; the box follows unless it has focus.
  useEffect(() => {
    if (document.activeElement !== qRef.current && q !== ctx.filter.q) setQ(ctx.filter.q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.filter.q, ctx.version]);
  const apply = useMemo(
    () =>
      debounce((v: string) => {
        ctx.filter.q = v.trim();
        ctx.emit('filter');
      }, 120),
    [ctx]
  );
  useEffect(() => () => apply.cancel(), [apply]);

  const group = async (anchor: HTMLElement) => {
    const v = await choose<string>({ anchor, title: 'Group by', items: [{ value: 'section', label: 'Section', on: ctx.boardBy !== 'status' }, { value: 'status', label: 'Status', on: ctx.boardBy === 'status' }] });
    if (v) {
      ctx.boardBy = v as 'section' | 'status';
      setPref('boardBy', v);
      if (v === 'status' && !ctx.showDone) await ctx.setShowDone(true);
      ctx.emit('group');
    }
  };
  const filterSheet = () => {
    openSheet({ title: 'Filter and sort', cls: 'pj-sheet--filter', render: (s) => <FilterSheet ctx={ctx} view={view} close={() => s.close()} /> });
  };
  return (
    <div className="pj-tools">
      {taskView ? (
        <label className="pj-search pj-search--bar">
          <Icon name="search" />
          <input
            ref={qRef}
            type="search"
            data-q
            placeholder="Search tasks"
            aria-label="Search tasks"
            autoComplete="off"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              apply(e.target.value);
            }}
          />
        </label>
      ) : null}
      {taskView ? (
        <button type="button" data-ui-tooltip="pj-tip" className={'pj-tool' + (n ? ' is-on' : '')} aria-label="Filter and sort" onClick={filterSheet}>
          <Icon name="filter" />
          <span>Filter</span>
          {n ? <em>{n}</em> : null}
        </button>
      ) : null}
      {board ? (
        <button type="button" data-ui-tooltip="pj-tip" className="pj-tool" aria-label={ctx.boardBy === 'status' ? 'By status' : 'By section'} onClick={(e) => void group(e.currentTarget)}>
          <Icon name="board" />
          <span>{ctx.boardBy === 'status' ? 'By status' : 'By section'}</span>
        </button>
      ) : null}
      {list ? (
        <button
          type="button"
          data-ui-tooltip="pj-tip"
          className={'pj-tool' + (ctx.selecting ? ' is-on' : '')}
          aria-label="Select"
          aria-pressed={!!ctx.selecting}
          onClick={() => {
            ctx.selecting = !ctx.selecting;
            if (!ctx.selecting) ctx.sel.clear();
            ctx.emit('select');
          }}
        >
          <Icon name="check" />
          <span>Select</span>
        </button>
      ) : null}
      <button type="button" data-ui-tooltip="pj-tip" aria-label="Add task" className="pj-btn pj-btn--primary pj-tool--add" title="Add task (Tab, then Q)" onClick={() => quickAdd({ section_id: listHandle.current?.currentGroupId?.() || null })}>
        <Icon name="plus" />
        <span>Add task</span>
      </button>
    </div>
  );
}

function FilterSheet({ ctx, view, close }: { ctx: TaskCtx; view: string; close: () => void }) {
  useCtx(ctx);
  const chip = (grp: string, v: string, label: string, on: boolean) => (
    <button
      key={grp + v}
      type="button"
      className={'pj-fchipbtn' + (on ? ' is-on' : '')}
      aria-pressed={on}
      onClick={() => {
        if (grp === 'priority') ctx.filter.priority = v;
        else ctx.sort = { by: v as typeof ctx.sort.by, dir: 1 };
        ctx.emit('filter');
      }}
    >
      {label}
    </button>
  );
  return (
    <div className="pj-filter">
      <span className="pj-label">Priority</span>
      <div className="pj-chips">
        {chip('priority', '', 'Any', !ctx.filter.priority)}
        {['high', 'normal', 'low'].map((p) => chip('priority', p, PRIORITY[p], ctx.filter.priority === p))}
      </div>
      {view === 'list' ? (
        <>
          <span className="pj-label">Sort</span>
          <div className="pj-chips">
            {[
              ['manual', 'My order'],
              ['due', 'Due date'],
              ['owner', 'Owner'],
              ['priority', 'Priority'],
              ['title', 'Title'],
            ].map(([v, l]) => chip('sort', v, l, ctx.sort.by === v))}
          </div>
        </>
      ) : null}
      <div className="pj-sheet__foot">
        <button
          type="button"
          className="pj-btn"
          onClick={() => {
            ctx.filter.priority = '';
            ctx.sort = { by: 'manual', dir: 1 };
            ctx.emit('filter');
          }}
        >
          Reset
        </button>
        <button type="button" className="pj-btn pj-btn--primary" onClick={close}>
          Done
        </button>
      </div>
    </div>
  );
}

function DeleteBody({ p, close }: { p: { id: string; key: string; name: string; open?: unknown; asana_sync?: boolean }; close: () => void }) {
  const [typed, setTyped] = useState('');
  const [asana, setAsana] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <p className="pj-del__t">This removes the project, its {String(p.open ?? '')} open tasks, their comments and files from FavorOS. It cannot be undone. Archive keeps it instead.</p>
      {p.asana_sync === true ? (
        <label className="pj-del__chk">
          <input type="checkbox" checked={asana} onChange={(e) => setAsana(e.target.checked)} /> Also archive it in Asana
        </label>
      ) : null}
      <label className="pj-del__lab">
        Type the project key, {p.key}, to confirm
        <input className="pj-in" autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} />
      </label>
      <div className="pj-del__acts">
        <button type="button" className="pj-btn" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="pj-btn pj-btn--danger"
          disabled={busy || typed.trim().toUpperCase() !== p.key}
          onClick={async () => {
            setBusy(true);
            const res = await fetch(`/api/projects/${encodeURIComponent(p.id)}${asana ? '?asana=archive' : ''}`, { method: 'DELETE', credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } })
              .then((r) => r.json())
              .catch(() => null);
            if (!res || res.ok === false) {
              setBusy(false);
              toast((res && res.message) || 'That did not delete.');
              return;
            }
            close();
            goto('/projects/');
          }}
        >
          Delete project
        </button>
      </div>
    </>
  );
}

export { projectHref };
