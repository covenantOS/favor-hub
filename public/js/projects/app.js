/* Projects: entry point for the home page (/projects/) and the project page (/projects/p/?p=KEY&view=list|board|calendar|timeline|workload&t=CODE).
   With ?mock=1 the pages run on an in-memory fixture (ui-mock.js) instead of the server.

   Other lanes plug in here:
     window.PJ.views.<name> = { mount(el, detail) -> { destroy() } }   a view module (calendar, timeline, workload) registers itself
     window.addEventListener('pj:view', e => ...)                       fires when a view tab opens; e.detail = { view, el, project, sections, members, ctx, openTask, quickAdd, api }
     window.PJ.openTask(codeOrId)                                       opens the task drawer from anywhere
     window.addEventListener('pj:change', e => ...)                     fires after any task or section change; e.detail.ctx holds the current tasks */
import { esc, icon, avatar, phone, toast, debounce, openSheet, choose, PRIORITY, installTips } from './ui-util.js';
import { Ctx, api, Staff, loadStaff, personOf } from './ui-data.js';
import { mountList } from './list.js';
import { mountBoard } from './board.js';
import { openDrawer, closeDrawer, setDrawerHooks, drawerOpen } from './drawer.js';
import { openQuickAdd } from './quick-add.js';
import { mountHome } from './home.js';
import { openProjectForm } from './ui-projform.js';
import { pickOwner } from './ui-pickers.js';
import { openStatus } from './status.js';
import { mountFilterBar, readFilters, writeFilters, activeCount } from './filters.js';
import { mountSidebar } from './sidebar.js';
import { openSwitcher } from './switcher.js';

const qs = new URLSearchParams(location.search);
const PREFS = 'favor.hub.projects.prefs.v1';
const prefs = () => { try { return JSON.parse(localStorage.getItem(PREFS) || '{}'); } catch (_) { return {}; } };
const setPref = (k, v) => { try { const p = prefs(); p[k] = v; localStorage.setItem(PREFS, JSON.stringify(p)); } catch (_) { /* private mode */ } };

const VIEWS = [['list', 'List', 'list'], ['board', 'Board', 'board'], ['calendar', 'Calendar', 'cal'], ['timeline', 'Timeline', 'gantt'], ['workload', 'Workload', 'user']];

const PJ = (window.PJ = window.PJ || {});
PJ.views = PJ.views || {};
PJ.ctx = null;

function setUrl(mut) {
  const u = new URL(location.href);
  mut(u.searchParams);
  history.replaceState(history.state, '', u);
}

/** What every page shares: opening a task and the quick add box. */
const shell = {
  open(ctx, task) { return openDrawer(ctx, task.code || task.id); },
  quickAdd(ctx, defaults) { return openQuickAdd(ctx, defaults); },
};
setDrawerHooks({
  open: (t) => { setUrl((p) => p.set('t', t.code || t.id)); if (PJ.onTask) PJ.onTask(t); },
  // Closing steps back out of the drawer's history entry. A drawer opened from a task link (Chat, email, a mention) steps back
  // to an address that still names the task, so the task is cleared again once that step lands; a reload then shows the list.
  close: () => {
    const clear = () => setUrl((p) => p.delete('t'));
    clear();
    addEventListener('popstate', clear, { once: true });
    setTimeout(() => removeEventListener('popstate', clear), 800);
    if (PJ.onTask) PJ.onTask(null);
    if (PJ.refreshView) PJ.refreshView();
  },
});

/* ---------------------------------------------------------------- the project page */
async function mountProject(root, key) {
  const ctx = new Ctx('project');
  PJ.ctx = ctx;
  const pf = prefs();
  readFilters(ctx, qs);
  ctx.boardBy = pf.boardBy === 'status' ? 'status' : 'section';
  let view = qs.get('view') || pf.view || 'list';
  if (!VIEWS.some((v) => v[0] === view)) view = 'list';
  let current = null;
  let extHandle = null;

  root.innerHTML = `<div class="pj-shell"><aside data-side aria-label="Projects"></aside><div class="pj-proj">
    <header class="pj-pheader">
      <button type="button" class="pj-ib pj-sidebtn" data-pa="side" aria-label="Projects menu">${icon('list')}</button>
      <div class="pj-pheader__t" data-title><i class="pj-dot pj-dot--lg" data-c="leaf"></i><h1 class="pj-skel-line">&nbsp;</h1></div>
      <div class="pj-pheader__act" data-pact></div>
    </header>
    <nav class="pj-crumbs" aria-label="Breadcrumb" data-crumbs></nav>
    <div class="pj-tabsrow">
      <nav class="pj-views" role="tablist" aria-label="View">${VIEWS.map(([id, label, ic]) => `<button type="button" role="tab" data-ui-tooltip="pj-tip" aria-label="${label}" class="pj-view" data-view="${id}" aria-selected="false">${icon(ic)}<span>${label}</span></button>`).join('')}</nav>
      <div class="pj-tools" data-tools></div>
    </div>
    <div class="pj-fbar" data-fbar></div>
    <div class="pj-stage" data-stage></div>
  </div></div>`;
  const stage = root.querySelector('[data-stage]');
  const tools = root.querySelector('[data-tools]');
  const fbar = root.querySelector('[data-fbar]');
  const side = mountSidebar(root.querySelector('[data-side]'), ctx, { key, onSection: (id) => gotoSection(id, true) });
  mountFilterBar(fbar, ctx, { project: key });
  const crumbState = { section: qs.get('section') || '', task: null };
  function paintCrumbs() {
    const nav = root.querySelector('[data-crumbs]');
    const p = ctx.project;
    if (!p) { nav.innerHTML = '<a href="/projects/">Projects</a>'; return; }
    const sec = crumbState.task ? crumbState.task.section_id || '' : crumbState.section;
    const sname = sec ? ctx.sectionName(sec) : '';
    nav.innerHTML = '<a href="/projects/">Projects</a>' + icon('right') + `<button type="button" data-c="project">${esc(p.name)}</button>` + (sname ? icon('right') + `<button type="button" data-c="section" data-id="${esc(sec)}">${esc(sname)}</button>` : '') + (crumbState.task ? icon('right') + `<span class="pj-crumbs__cur">${esc(crumbState.task.code || crumbState.task.title)}</span>` : '');
  }
  root.querySelector('[data-crumbs]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    if (b.dataset.c === 'section') { closeDrawer(); gotoSection(b.dataset.id, true); } else { closeDrawer(); crumbState.section = ''; setUrl((p) => p.delete('section')); paintCrumbs(); stage.scrollIntoView({ block: 'start' }); }
  });
  PJ.onTask = (t) => { crumbState.task = t; paintCrumbs(); };
  function gotoSection(id, user) {
    crumbState.section = id || '';
    if (user) setUrl((p) => { if (id) p.set('section', id); else p.delete('section'); });
    paintCrumbs();
    if (view !== 'list' && view !== 'board') setView('list');
    requestAnimationFrame(() => {
      const z = stage.querySelector(`.pj-sec[data-zone="${CSS.escape(id)}"], .pj-col[data-zone="${CSS.escape(id)}"]`);
      if (!z) return;
      const fold = z.classList.contains('is-folded') && z.querySelector('[data-act="fold"]');
      if (fold) fold.click();
      z.scrollIntoView({ block: 'start', inline: 'start', behavior: 'smooth' });
    });
  }


  const filterCount = () => (ctx.filter.priority ? 1 : 0) + (ctx.sort.by !== 'manual' ? 1 : 0) + (view === 'list' || view === 'board' ? 0 : activeCount(ctx));
  function paintTools() {
    const list = view === 'list';
    const board = view === 'board';
    const taskView = list || board;
    const n = filterCount();
    tools.innerHTML = `${taskView ? `<label class="pj-search pj-search--bar">${icon('search')}<input type="search" data-q placeholder="Search tasks" aria-label="Search tasks" autocomplete="off" value="${esc(ctx.filter.q)}" /></label>` : ''}
      ${taskView ? `<button type="button" data-ui-tooltip="pj-tip" class="pj-tool${n ? ' is-on' : ''}" data-t="filter" aria-label="Filter and sort">${icon('filter')}<span>Filter</span>${n ? `<em>${n}</em>` : ''}</button>` : ''}
      ${board ? `<button type="button" data-ui-tooltip="pj-tip" class="pj-tool" data-t="group" aria-label="${ctx.boardBy === 'status' ? 'By status' : 'By section'}">${icon('board')}<span>${ctx.boardBy === 'status' ? 'By status' : 'By section'}</span></button>` : ''}
      ${list ? `<button type="button" data-ui-tooltip="pj-tip" class="pj-tool${ctx.selecting ? ' is-on' : ''}" data-t="select" aria-label="Select" aria-pressed="${!!ctx.selecting}">${icon('check')}<span>Select</span></button>` : ''}
      <button type="button" data-ui-tooltip="pj-tip" aria-label="Add task" class="pj-btn pj-btn--primary pj-tool--add" data-t="add" title="Add task (Tab, then Q)">${icon('plus')}<span>Add task</span></button>`;
    const q = tools.querySelector('[data-q]');
    if (q) q.addEventListener('input', debounce(() => { ctx.filter.q = q.value.trim(); ctx.emit('filter'); }, 120));
  }
  tools.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    const k = b.dataset.t;
    if (k === 'add') shell.quickAdd(ctx, { section_id: current && current.currentGroupId ? current.currentGroupId() || null : null });
    else if (k === 'select') { ctx.selecting = !ctx.selecting; if (!ctx.selecting) ctx.sel.clear(); ctx.emit('select'); paintTools(); }
    else if (k === 'group') {
      const v = await choose({ anchor: b, title: 'Group by', items: [{ value: 'section', label: 'Section', on: ctx.boardBy !== 'status' }, { value: 'status', label: 'Status', on: ctx.boardBy === 'status' }] });
      if (v) { ctx.boardBy = v; setPref('boardBy', v); if (v === 'status' && !ctx.showDone) await ctx.setShowDone(true); ctx.emit('group'); if (current && current.render) current.render(); paintTools(); }
    } else if (k === 'filter') filterSheet();
  });
  ctx.on((w) => { if (w === 'select' && !ctx.sel.size && !ctx.selecting) paintTools(); });

  function filterSheet() {
    const draw = () => {
      const chip = (grp, v, label, on) => `<button type="button" class="pj-fchipbtn${on ? ' is-on' : ''}" data-g="${grp}" data-v="${esc(v)}" aria-pressed="${on}">${esc(label)}</button>`;
      return `<div class="pj-filter">
        <span class="pj-label">Priority</span>
        <div class="pj-chips">${chip('priority', '', 'Any', !ctx.filter.priority)}${['high', 'normal', 'low'].map((p) => chip('priority', p, PRIORITY[p], ctx.filter.priority === p)).join('')}</div>
        ${view === 'list' ? `<span class="pj-label">Sort</span><div class="pj-chips">${[['manual', 'My order'], ['due', 'Due date'], ['owner', 'Owner'], ['priority', 'Priority'], ['title', 'Title']].map(([v, l]) => chip('sort', v, l, ctx.sort.by === v)).join('')}</div>` : ''}
        <div class="pj-sheet__foot"><button type="button" class="pj-btn" data-g="reset">Reset</button><button type="button" class="pj-btn pj-btn--primary" data-sheet-x>Done</button></div>
      </div>`;
    };
    const s = openSheet({ title: 'Filter and sort', cls: 'pj-sheet--filter', html: draw(), onClose: paintTools });
    const redraw = () => { s.body.innerHTML = draw(); };
    s.body.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-g]');
      if (!b) return;
      const g = b.dataset.g;
      if (g === 'priority') ctx.filter.priority = b.dataset.v;
      else if (g === 'sort') ctx.sort = { by: b.dataset.v, dir: 1 };
      else if (g === 'reset') { ctx.filter.priority = ''; ctx.sort = { by: 'manual', dir: 1 }; }
      else return;
      ctx.emit('filter');
      redraw();
    });
  }

  /* ----- views */
  let viewSeq = 0;
  function clearStage() {
    viewSeq++;
    if (current && current.destroy) current.destroy();
    if (extHandle && extHandle.destroy) { try { extHandle.destroy(); } catch (_) { /* a view that fails to clean up must not block the next */ } }
    current = null; extHandle = null; PJ.current = null;
    stage.innerHTML = '';
    stage.className = 'pj-stage';
  }
  function setView(v, fromUrl) {
    view = v;
    if (!fromUrl) { setPref('view', v); const u = new URL(location.href); u.searchParams.set('view', v); history.pushState(history.state, '', u); }
    fbar.hidden = !(v === 'list' || v === 'board');
    root.querySelectorAll('[data-view]').forEach((b) => { const on = b.dataset.view === v; b.setAttribute('aria-selected', String(on)); b.classList.toggle('is-on', on); b.tabIndex = on ? 0 : -1; });
    const wasExt = stage.classList.contains('pj-stage--ext');
    clearStage();
    if (wasExt && (v === 'list' || v === 'board')) ctx.reloadTasks();
    ctx.sel.clear(); ctx.selecting = false;
    paintTools();
    const opts = { key, open: (t) => shell.open(ctx, t), quickAdd: () => shell.quickAdd(ctx, { section_id: current && current.currentGroupId ? current.currentGroupId() || null : null }) };
    if (v === 'list') { const el = document.createElement('div'); stage.appendChild(el); stage.classList.add('pj-stage--list'); current = mountList(el, ctx, { ...opts, mode: 'project' }); }
    else if (v === 'board') { const el = document.createElement('div'); stage.appendChild(el); stage.classList.add('pj-stage--board'); current = mountBoard(el, ctx, opts); }
    else { PJ.refreshView = () => { if (extHandle && extHandle.refresh) extHandle.refresh(); }; mountExternal(v); }
  }
  async function mountExternal(v) {
    const el = document.createElement('div');
    el.id = 'pj-view-' + v;
    el.className = 'pj-ext';
    el.dataset.view = v;
    el.dataset.project = ctx.project ? ctx.project.id : '';
    el.dataset.key = key;
    stage.appendChild(el);
    stage.classList.add('pj-stage--ext');
    const detail = { view: v, el, ctx, project: ctx.project, sections: ctx.sections, members: ctx.members, openTask: (ref) => openDrawer(ctx, ref), quickAdd: (d) => shell.quickAdd(ctx, d), api };
    PJ.current = detail;
    el.innerHTML = '<div class="pj-skel" aria-busy="true"><i></i><i></i><i></i></div>';
    const mySeq = ++viewSeq;
    try {
      // Lane VIEWS: each module registers itself on window.FavorProjects.views and mounts as mount(el, { api, project, sections, members, user }).
      const fp = (window.FavorProjects = window.FavorProjects || {});
      fp.openTask = (ref) => openDrawer(ctx, ref);
      await import('./' + v + '.js');
      if (mySeq !== viewSeq) return;
      const plug = (fp.views || {})[v] || PJ.views[v];
      if (!plug || !plug.mount) throw new Error('missing');
      await ctx.loadedP;
      if (mySeq !== viewSeq) return;
      const { api: core } = await import('./api.js');
      el.innerHTML = '';
      const h = await plug.mount(el, { api: core, project: ctx.project, sections: ctx.sections, members: ctx.members, user: { email: Staff.me } });
      if (mySeq !== viewSeq) { if (h && h.destroy) h.destroy(); return; }
      extHandle = h || null;
    } catch (e) {
      if (mySeq === viewSeq) el.innerHTML = '<div class="pj-empty pj-empty--err"><b>This view did not open</b><span>Use the List or the Board for now.</span><button type="button" class="pj-btn" data-retry>Try again</button></div>';
      const r = el.querySelector('[data-retry]'); if (r) r.addEventListener('click', () => setView(v, true));
    }
    window.dispatchEvent(new CustomEvent('pj:view', { detail }));
  }
  PJ.registerView = (name, plug) => {
    PJ.views[name] = plug;
    if (PJ.current && PJ.current.view === name && !extHandle && plug && plug.mount) { PJ.current.el.innerHTML = ''; extHandle = plug.mount(PJ.current.el, PJ.current) || null; }
  };
  root.querySelector('.pj-views').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b && b.dataset.view !== view) setView(b.dataset.view); });
  root.querySelector('.pj-views').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = VIEWS.findIndex((x) => x[0] === view) + (e.key === 'ArrowRight' ? 1 : -1);
    if (VIEWS[i]) { setView(VIEWS[i][0]); root.querySelector(`[data-view="${VIEWS[i][0]}"]`).focus(); }
  });

  addEventListener('popstate', () => {
    const sp = new URLSearchParams(location.search);
    const v = sp.get('view') || 'list';
    if (VIEWS.some((x) => x[0] === v) && v !== view) setView(v, true);
    const before = JSON.stringify([ctx.filter.q, ctx.filter.owner, ctx.filter.due, ctx.filter.status, ctx.filter.code]);
    const wantDone = sp.get('done') === '1';
    readFilters(ctx, sp);
    ctx.showDone = wantDone ? true : ctx.showDone;
    if (!wantDone && ctx.showDone && !ctx.filter.status) ctx.setShowDone(false);
    if (before !== JSON.stringify([ctx.filter.q, ctx.filter.owner, ctx.filter.due, ctx.filter.status, ctx.filter.code])) ctx.emit('filter');
    crumbState.section = sp.get('section') || '';
    paintCrumbs();
  });
  ctx.on((w) => {
    if (w !== 'filter') return;
    const i = tools.querySelector('[data-q]');
    if (i && document.activeElement !== i && i.value !== ctx.filter.q) i.value = ctx.filter.q;
    writeFilters(ctx);
  });

  function paintHeader() {
    const p = ctx.project;
    if (!p) return;
    document.title = p.name + ' - FavorOS';
    root.querySelector('[data-title]').innerHTML = `<i class="pj-dot pj-dot--lg" data-c="${esc(p.color)}"></i><h1>${esc(p.name)}</h1><span class="pj-pkey">${esc(p.key)}</span>${p.team ? `<span class="pj-pcard__team">${esc(p.team)}</span>` : ''}${p.status !== 'active' ? `<span class="pj-tag">${esc(p.status)}</span>` : ''}${p.asana_sync === true ? '<span class="pj-tag pj-tag--asana">Synced with Asana</span>' : ''}${p.visibility === 'members' ? `<span class="pj-pcard__lock" title="Members only">${icon('lock')}</span>` : ''}`;
    const ms = ctx.members.slice(0, 5);
    root.querySelector('[data-pact]').innerHTML = `<button type="button" class="pj-members-btn" data-pa="details" aria-label="Members"><span class="pj-stack">${ms.map((m) => avatar(m)).join('')}</span>${ctx.members.length > 5 ? `<span class="pj-more">+${ctx.members.length - 5}</span>` : ''}</button><button type="button" class="pj-btn pj-pa-status" data-pa="status" aria-label="Friday update">${icon('clock')}<span>Friday update</span></button><button type="button" class="pj-ib" data-pa="details" aria-label="Project details">${icon('more')}</button>`;
  }
  root.querySelector('[data-pact]').addEventListener('click', async (e) => {
    if (e.target.closest('[data-pa="side"]')) { side.toggle(); return; }
    if (!e.target.closest('[data-pa]') || !ctx.project) return;
    if (e.target.closest('[data-pa]').dataset.pa === 'status') { openStatus(ctx.project); return; }
    const p = await openProjectForm({ project: ctx.project, members: ctx.members });
    if (p) { Object.assign(ctx.project, p); const d = await api.project(ctx.project.id).catch(() => null); if (d) { ctx.members = d.members || ctx.members; } paintHeader(); ctx.emit('project'); }
  });

  ctx.on((w) => { if (w === 'load') { if (ctx.project) paintHeader(); } });
  await loadStaff();
  ctx.loadedP = ctx.load(key);
  setView(view, true);
  const loaded = ctx.loadedP.then(() => {
    if (ctx.error) {
      const gone = ctx.status === 404 || ctx.status === 403;
      stage.innerHTML = `<div class="pj-empty pj-empty--err"><b>${gone ? 'This project is not available to you' : 'This project did not load'}</b><span>${esc(ctx.error)}</span>${gone ? '<a class="pj-btn" href="/projects/">All projects</a>' : '<button type="button" class="pj-btn" data-retry>Try again</button>'}</div>`;
      stage.querySelector('[data-retry]') && stage.querySelector('[data-retry]').addEventListener('click', () => location.reload());
      return;
    }
    paintHeader();
    paintCrumbs();
    const sec = qs.get('section');
    if (sec) setTimeout(() => gotoSection(sec, false), 60);
    const t = qs.get('t');
    if (t) openDrawer(ctx, t);
  });
  PJ.ready = loaded;
  return { ctx };
}

/* ---------------------------------------------------------------- start */
async function start() {
  // ?mock=1 uses lane CORE's fixture. ?mock=2 uses this UI's own (ui-mock.js: ?n=2000 tasks, ?lag=600 ms, ?fail=PATCH to test rollbacks).
  if (qs.get('mock') === '2') { const m = await import('./ui-mock.js'); m.installMock(); }
  else if (qs.get('mock') === '1') {
    const real = window.fetch.bind(window);
    window.fetch = (input, o) => ((typeof input === 'string' ? input : input.url).indexOf('/api/requests/people') >= 0 ? api.staff().then((d) => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } })) : real(input, o));
  }
  document.documentElement.classList.add('pj-page');
  // Ctrl or Cmd + K opens the Projects switcher here, ahead of the site search. A slash focuses the task search.
  document.addEventListener('keydown', (e) => {
    const a = document.activeElement;
    const typing = a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault(); e.stopImmediatePropagation();
      openSwitcher({ projectKey: PJ.ctx && PJ.ctx.project ? PJ.ctx.project.key : '', open: (ref) => PJ.openTask(ref) });
      return;
    }
    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !drawerOpen() && !document.querySelector('.pj-sheet')) {
      const q = document.querySelector('.pj-tools [data-q], [data-mq]');
      if (q) { e.preventDefault(); e.stopImmediatePropagation(); q.focus(); q.select(); }
    }
  }, true);
  installTips();
  const root = document.getElementById('pj-root');
  if (!root) return;
  root.innerHTML = '';
  root.setAttribute('data-ready', '1');
  PJ.openTask = (ref) => (PJ.ctx ? openDrawer(PJ.ctx, ref) : openDrawer(PJ.homeCtx, ref));
  PJ.closeTask = closeDrawer;
  PJ.quickAdd = (d) => shell.quickAdd(PJ.ctx || PJ.homeCtx, d);
  const key = qs.get('p');
  const isProject = !!key || /\/projects\/p\/?(\.html)?$/.test(location.pathname);
  if (isProject) {
    if (!key) { location.replace('/projects/'); return; }
    await mountProject(root, key);
  } else {
    const h = await mountHome(root, shell);
    PJ.homeCtx = h.ctx;
    const t = qs.get('t');
    if (t) h.ctx.load().then(() => openDrawer(h.ctx, t));
  }
  // Tab, then Q, opens quick add from anywhere that is not a text field. Any other key cancels it.
  let armed = 0;
  document.addEventListener('keydown', (e) => {
    const el = document.activeElement;
    const typing = el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    if (e.key === 'Tab' && !e.shiftKey && !typing && !e.ctrlKey && !e.metaKey && !drawerOpen() && !document.querySelector('.pj-sheet')) {
      const cardOrBody = el === document.body || !el || (el.classList && (el.classList.contains('pj-row') || el.classList.contains('pj-card')));
      if (cardOrBody && !armed) { e.preventDefault(); armed = Date.now(); toast('Press Q to add a task'); setTimeout(() => { armed = 0; }, 1500); return; }
    }
    if (armed && (e.key === 'q' || e.key === 'Q') && !typing) { e.preventDefault(); armed = 0; shell.quickAdd(PJ.ctx || PJ.homeCtx, {}); return; }
    if (e.key !== 'Tab') armed = 0;
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
}
start();
export { drawerOpen };
