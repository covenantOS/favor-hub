/* The Projects home: My tasks (grouped by when they are due) and the list of projects. */
import { esc, icon, avatar, toast, debounce, todayStr, dueLabel } from './ui-util.js';
import { api, Ctx, Staff, loadStaff } from './ui-data.js';
import { mountList } from './list.js';
import { openProjectForm } from './ui-projform.js';

const TAB_KEY = 'favor.hub.projects.tab.v1';
export const projectHref = (key, extra) => '/projects/p/?p=' + encodeURIComponent(key) + (extra || '');

export async function mountHome(root, shell) {
  const params = new URLSearchParams(location.search);
  let tab = params.get('tab') || (() => { try { return localStorage.getItem(TAB_KEY); } catch (_) { return null; } })() || 'mine';
  if (tab !== 'mine' && tab !== 'projects') tab = 'mine';
  const ctx = new Ctx('mine');
  ctx.showDone = false;
  let list = null;
  let summary = { projects: [], mine: { open: 0, overdue: 0, dueToday: 0 } };
  let pq = '';
  let pstatus = 'active';

  root.innerHTML = `<div class="pj-home">
    <header class="pj-ph"><h1>Projects</h1><div class="pj-ph__act"><button type="button" class="pj-btn" data-h="task">${icon('plus')}Add task</button><button type="button" class="pj-btn pj-btn--primary" data-h="new">${icon('plus')}New project</button></div></header>
    <div class="pj-seg" role="tablist" aria-label="Projects"><button type="button" role="tab" data-tab="mine" id="pj-tab-mine">My tasks<span data-c-mine></span></button><button type="button" role="tab" data-tab="projects" id="pj-tab-projects">All projects<span data-c-projects></span></button></div>
    <div class="pj-pane" data-pane></div>
  </div>`;
  const pane = root.querySelector('[data-pane]');
  pane.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) loadProjects(); });

  function setTab(t, push) {
    tab = t;
    try { localStorage.setItem(TAB_KEY, t); } catch (_) { /* private mode */ }
    root.querySelectorAll('[data-tab]').forEach((b) => { const on = b.dataset.tab === t; b.setAttribute('aria-selected', String(on)); b.classList.toggle('is-on', on); b.tabIndex = on ? 0 : -1; });
    if (list) { list.destroy(); list = null; }
    pane._draw = null;
    if (t === 'mine') paintMine(); else paintProjects();
    const u = new URL(location.href);
    u.searchParams.set('tab', t);
    history.replaceState(history.state, '', u);
  }
  root.querySelector('.pj-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
  root.querySelector('.pj-seg').addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { setTab(tab === 'mine' ? 'projects' : 'mine'); root.querySelector(`[data-tab="${tab}"]`).focus(); } });
  root.querySelector('.pj-ph__act').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-h]');
    if (!b) return;
    if (b.dataset.h === 'task') shell.quickAdd(ctx);
    if (b.dataset.h === 'new') {
      const p = await openProjectForm({});
      if (p) { toast('Project created'); location.href = projectHref(p.key); }
    }
  });

  /* ---------------------------------------------------------------- My tasks */
  function counts() {
    const t = todayStr();
    const open = ctx.tasks.filter((x) => x.status !== 'done');
    return { open: open.length, late: open.filter((x) => x.due_date && x.due_date < t).length, today: open.filter((x) => x.due_date === t).length };
  }
  function paintMine() {
    pane.innerHTML = `<div class="pj-tiles" data-tiles></div>
      <div class="pj-bar pj-bar--home"><label class="pj-search pj-search--bar">${icon('search')}<input type="search" data-mq placeholder="Search my tasks" aria-label="Search my tasks" autocomplete="off" /></label><label class="pj-check-label"><input type="checkbox" data-done ${ctx.showDone ? 'checked' : ''} /><span>Show completed</span></label></div>
      <div data-list></div>`;
    list = mountList(pane.querySelector('[data-list]'), ctx, { mode: 'mine', open: (t) => shell.open(ctx, t), quickAdd: () => shell.quickAdd(ctx) });
    const q = pane.querySelector('[data-mq]');
    q.addEventListener('input', debounce(() => { ctx.filter.q = q.value.trim(); ctx.emit('filter'); }, 120));
    pane.querySelector('[data-done]').addEventListener('change', (e) => { ctx.showDone = e.target.checked; ctx.loading = true; ctx.emit('load'); ctx.reloadTasks().then(() => { ctx.loading = false; ctx.emit('load'); }); });
    paintTiles();
  }
  function paintTiles() {
    const t = pane.querySelector('[data-tiles]');
    if (!t) return;
    const c = counts();
    t.innerHTML = `<div class="pj-tile${c.late ? ' is-late' : ''}"><b>${c.late}</b><span>Overdue</span></div><div class="pj-tile"><b>${c.today}</b><span>Due today</span></div><div class="pj-tile"><b>${c.open}</b><span>Open</span></div>`;
    const m = root.querySelector('[data-c-mine]');
    if (m) m.textContent = c.open ? String(c.open) : '';
  }
  ctx.on((w) => { if (tab === 'mine' && w !== 'filter' && w !== 'select') paintTiles(); });

  /* ---------------------------------------------------------------- the projects */
  function card(p) {
    const total = p.open + p.done;
    const pct = total ? Math.round((p.done / total) * 100) : 0;
    return `<a class="pj-pcard" href="${projectHref(p.key)}" data-key="${esc(p.key)}"><div class="pj-pcard__top"><i class="pj-dot pj-dot--lg" data-c="${esc(p.color)}"></i><span class="pj-pcard__key">${esc(p.key)}</span>${p.team ? `<span class="pj-pcard__team">${esc(p.team)}</span>` : ''}${p.status !== 'active' ? `<span class="pj-tag">${esc(p.status)}</span>` : ''}${p.visibility === 'members' ? `<span class="pj-pcard__lock" title="Members only">${icon('lock')}</span>` : ''}</div><h3>${esc(p.name)}</h3>${p.description ? `<p>${esc(p.description)}</p>` : ''}<div class="pj-prog" role="img" aria-label="${pct} percent done"><i style="width:${pct}%" data-c="${esc(p.color)}"></i></div><div class="pj-pcard__foot"><span><b>${p.open}</b> open</span>${p.overdue ? `<span class="pj-late"><b>${p.overdue}</b> overdue</span>` : ''}${p.due_date ? `<span>${icon('cal')}${esc(dueLabel(p.due_date))}</span>` : ''}<span class="pj-sp"></span>${p.lead ? avatar(p.lead) : ''}</div></a>`;
  }
  function paintProjects() {
    pane.innerHTML = `<div class="pj-bar pj-bar--home"><label class="pj-search pj-search--bar">${icon('search')}<input type="search" data-pq placeholder="Search projects" aria-label="Search projects" autocomplete="off" value="${esc(pq)}" /></label><div class="pj-chips" role="group" aria-label="Show"><button type="button" class="pj-fchipbtn${pstatus === 'active' ? ' is-on' : ''}" data-ps="active">Active</button><button type="button" class="pj-fchipbtn${pstatus === 'all' ? ' is-on' : ''}" data-ps="all">All</button></div></div><div class="pj-pgrid" data-grid></div>`;
    const draw = () => {
      const g = pane.querySelector('[data-grid]');
      const words = pq.toLowerCase().split(/\s+/).filter(Boolean);
      const rows = summary.projects.filter((p) => (pstatus === 'all' || p.status === 'active') && words.every((w) => (p.name + ' ' + p.key + ' ' + p.team).toLowerCase().includes(w)));
      g.innerHTML = summary.loading ? '<div class="pj-skel pj-skel--cards"><i></i><i></i><i></i></div>' : summary.error ? `<div class="pj-empty pj-empty--err"><p>${esc(summary.error)}</p><button type="button" class="pj-btn" data-retry>Try again</button></div>` : rows.length ? rows.map(card).join('') : `<div class="pj-empty pj-empty--first"><b>${summary.projects.length ? 'No project matches' : 'No projects yet'}</b><span>${summary.projects.length ? 'Try another search.' : 'Create the first one with New project.'}</span></div>`;
    };
    draw();
    pane.querySelector('[data-pq]').addEventListener('input', debounce((e) => { pq = e.target.value.trim(); draw(); }, 100));
    pane.querySelector('.pj-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-ps]'); if (!b) return; pstatus = b.dataset.ps; pane.querySelectorAll('[data-ps]').forEach((x) => x.classList.toggle('is-on', x === b)); draw(); });
    pane._draw = draw;
  }
  async function loadProjects() {
    summary.loading = true; summary.error = '';
    if (pane._draw) pane._draw();
    try {
      const d = await api.projects();
      summary = { projects: d.projects || [], mine: d.mine || summary.mine };
      const c = root.querySelector('[data-c-projects]');
      if (c) c.textContent = summary.projects.filter((p) => p.status === 'active').length || '';
    } catch (e) { summary.loading = false; summary.error = e.message; }
    summary.loading = false;
    if (pane._draw) pane._draw();
  }

  await loadStaff();
  setTab(tab);
  ctx.load().then(() => paintTiles());
  loadProjects();
  return { ctx, destroy() { if (list) list.destroy(); } };
}
