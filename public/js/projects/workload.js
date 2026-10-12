/* Workload view: people down the side, weeks across, the number of open tasks due in each week. Click a cell to see its tasks.
   Mount: mount(el, {api, project|null, sections, members, user}) -> {refresh(), destroy()}. */
import {
  esc, dn, ymd, parts, startOfWeek, todayDn, fmtShort, fmtRange, span, isOpen, isOverdue, colorOf, avatar, toast, openTask, getApi,
  loadTasks, msgOf, debounceRaf, isPhone, fitHeight, prefs, ICON, trackOverlay, fmtLong,
} from './views-common.js';

export async function mount(host, ctx) {
  const api = await getApi(ctx);
  const project = ctx.project || null;
  const mine = !project;
  const pf = prefs('workload');
  const S = { weeks: [4, 8, 12].includes(pf.get.weeks) ? pf.get.weeks : 8, offset: 0, tasks: [], people: [], phone: isPhone(), pop: null };

  host.innerHTML =
    '<div class="pjv-root pjv-wl" data-pjv="workload">' +
    '<div class="pjv-bar" role="toolbar" aria-label="Workload">' +
    '<div class="cal-nav"><button type="button" class="pjv-btn pjv-btn--ico" data-act="prev" aria-label="Earlier weeks">' + ICON.chevL + '</button>' +
    '<button type="button" class="pjv-btn pjv-btn--ico" data-act="next" aria-label="Later weeks">' + ICON.chev + '</button></div>' +
    '<button type="button" class="pjv-btn" data-act="now">This week</button>' +
    '<h2 class="pjv-title" data-title></h2>' +
    '<div class="pjv-seg" role="group" aria-label="Weeks shown">' + [4, 8, 12].map((n) => '<button type="button" data-weeks="' + n + '" aria-pressed="' + (n === S.weeks) + '">' + n + ' weeks</button>').join('') + '</div>' +
    '<span class="pjv-count" data-count></span>' +
    '</div>' +
    '<div class="wl-scroll pjv-body"><table class="wl-table"></table></div>' +
    '<div class="cal-pop wl-pop" hidden role="dialog"></div><div class="cal-scrim" hidden></div>' +
    '</div>';
  const root = host.querySelector('.pjv-wl');
  const table = root.querySelector('.wl-table');
  const scrollEl = root.querySelector('.wl-scroll');
  const titleEl = root.querySelector('[data-title]');
  const countEl = root.querySelector('[data-count]');
  const pop = root.querySelector('.wl-pop');
  const scrim = root.querySelector('.cal-scrim');
  const unfit = fitHeight(root, 420);
  let popTok = null;

  const firstWeek = () => startOfWeek(todayDn()) + S.offset * 7;
  const heat = (n) => (n === 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : n <= 8 ? 3 : 4);

  function compute() {
    const td = todayDn();
    const w0 = firstWeek();
    const cols = [];
    for (let i = 0; i < S.weeks; i++) cols.push(w0 + i * 7);
    const people = new Map();
    const add = (p) => { if (p && p.email && !people.has(p.email.toLowerCase())) people.set(p.email.toLowerCase(), { p, key: p.email.toLowerCase(), cells: { over: [], none: [], weeks: cols.map(() => []) }, total: 0 }); };
    for (const m of ctx.members || []) add(m);
    if (mine && ctx.user) add(ctx.user);
    const unassigned = { p: null, key: '', cells: { over: [], none: [], weeks: cols.map(() => []) }, total: 0 };
    for (const t of S.tasks) {
      if (!isOpen(t)) continue;
      if (t.owner) add(t.owner);
      const row = t.owner && t.owner.email ? people.get(t.owner.email.toLowerCase()) : unassigned;
      if (!row) continue;
      const sp = span(t);
      row.total++;
      if (sp.s !== sp.s) { row.cells.none.push(t); continue; }
      const due = sp.d;
      if (due < td) { row.cells.over.push(t); continue; }
      if (due < w0) continue;
      const i = Math.floor((due - w0) / 7);
      if (i >= 0 && i < cols.length) row.cells.weeks[i].push(t);
    }
    const list = Array.from(people.values());
    if (unassigned.total) list.push(unassigned);
    list.sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : (b.total - a.total) || (a.p.name || a.p.email).localeCompare(b.p.name || b.p.email)));
    return { cols, list };
  }

  function render() {
    S.phone = isPhone();
    const { cols, list } = compute();
    S.model = { cols, list };
    const td = todayDn();
    const w0 = cols[0];
    titleEl.textContent = fmtShort(w0) + ' to ' + fmtShort(cols[cols.length - 1] + 6);
    root.querySelector('[data-act="prev"]').disabled = S.offset <= 0;
    const open = S.tasks.filter(isOpen).length;
    countEl.textContent = open + (open === 1 ? ' open task' : ' open tasks') + ' · ' + list.filter((r) => r.key !== '').length + ' people';
    let h = '<thead><tr><th class="wl-name wl-corner" scope="col">Person</th><th scope="col" class="wl-col wl-col--over">Overdue</th>' +
      cols.map((c) => '<th scope="col" class="wl-col' + (td >= c && td <= c + 6 ? ' is-now' : '') + '"><span>' + esc(fmtShort(c)) + '</span></th>').join('') +
      '<th scope="col" class="wl-col wl-col--none">No date</th><th scope="col" class="wl-col wl-col--total">Open</th></tr></thead><tbody>';
    if (!list.length) h += '<tr><td class="wl-empty" colspan="' + (cols.length + 4) + '">No people</td></tr>';
    list.forEach((r, ri) => {
      const label = r.p ? (r.p.name || r.p.email) : 'Unassigned';
      h += '<tr><th class="wl-name" scope="row"><span class="wl-who">' + avatar(r.p, 'sm') + '<span class="wl-who__t"><b>' + esc(label) + '</b>' + (r.p && r.p.title ? '<small>' + esc(r.p.title) + '</small>' : '') + '</span></span></th>';
      h += cell(ri, 'over', r.cells.over, 'Overdue', true);
      r.cells.weeks.forEach((c, i) => { h += cell(ri, 'w' + i, c, fmtRange(cols[i], cols[i] + 6), false, td >= cols[i] && td <= cols[i] + 6); });
      h += cell(ri, 'none', r.cells.none, 'No date', false);
      h += '<td class="wl-total">' + r.total + '</td></tr>';
    });
    table.innerHTML = h + '</tbody>';
  }
  function cell(ri, key, tasks, label, over, now) {
    const n = tasks.length;
    const who = S.model.list[ri];
    const name = who.p ? (who.p.name || who.p.email) : 'Unassigned';
    if (!n) return '<td class="wl-c wl-c--0' + (now ? ' is-now' : '') + '"><span aria-hidden="true">–</span></td>';
    return '<td class="wl-c' + (now ? ' is-now' : '') + '"><button type="button" class="wl-btn wl-h' + (over ? 4 : heat(n)) + (over ? ' is-over' : '') + '" data-r="' + ri + '" data-k="' + key + '" aria-label="' + esc(name + ', ' + label + ': ' + n + (n === 1 ? ' task' : ' tasks')) + '">' + n + '</button></td>';
  }

  /* ------------------------------------------------------------ the cell's tasks */
  function closePop() {
    if (pop.hidden) return;
    pop.hidden = true; scrim.hidden = true; pop.innerHTML = '';
    if (popTok) { const t = popTok; popTok = null; t.done(); }
  }
  function openPop(btn) {
    const r = S.model.list[Number(btn.dataset.r)];
    const k = btn.dataset.k;
    const tasks = k === 'over' ? r.cells.over : k === 'none' ? r.cells.none : r.cells.weeks[Number(k.slice(1))];
    const sorted = tasks.slice().sort((a, b) => (span(a).d || 0) - (span(b).d || 0));
    const when = k === 'over' ? 'Overdue' : k === 'none' ? 'No date' : fmtRange(S.model.cols[Number(k.slice(1))], S.model.cols[Number(k.slice(1))] + 6);
    const name = r.p ? (r.p.name || r.p.email) : 'Unassigned';
    pop.innerHTML = '<div class="cal-pop__h"><span class="wl-pop__t"><b>' + esc(name) + '</b><small>' + esc(when) + ' · ' + sorted.length + (sorted.length === 1 ? ' task' : ' tasks') + '</small></span>' +
      '<button type="button" class="cal-pop__x" data-act="popclose" aria-label="Close">' + ICON.x + '</button></div>' +
      '<ul class="cal-pop__list wl-list">' + sorted.map((t) => {
        const sp = span(t);
        return '<li><button type="button" data-act="popopen" data-id="' + esc(t.id) + '" data-pc="' + colorOf(t.project ? t.project.color : 'slate') + '"><i></i><span>' + esc(t.title) + '</span>' +
          '<em class="' + (isOverdue(t) ? 'is-late' : '') + '">' + (t.project && mine ? esc(t.project.key) + ' · ' : '') + (sp.s === sp.s ? esc(fmtShort(sp.d)) : 'No date') + '</em></button></li>';
      }).join('') + '</ul>';
    pop.hidden = false;
    pop.classList.toggle('is-sheet', S.phone);
    scrim.hidden = !S.phone;
    if (!S.phone) {
      const mr = root.getBoundingClientRect();
      const ar = btn.getBoundingClientRect();
      const pw = 340;
      const left = Math.min(Math.max(ar.left - mr.left - 20, 8), Math.max(8, mr.width - pw - 8));
      let top = ar.bottom - mr.top + 6;
      const ph = pop.offsetHeight;
      if (top + ph > mr.height - 8) top = Math.max(8, ar.top - mr.top - ph - 6);
      pop.style.left = left + 'px'; pop.style.top = top + 'px';
    } else { pop.style.left = ''; pop.style.top = ''; popTok = popTok || trackOverlay(() => { popTok = null; closePop(); }); }
  }

  root.querySelector('.pjv-bar').addEventListener('click', (e) => {
    const w = e.target.closest('[data-weeks]');
    if (w) { S.weeks = Number(w.dataset.weeks); pf.set({ weeks: S.weeks }); root.querySelectorAll('[data-weeks]').forEach((b) => b.setAttribute('aria-pressed', String(b === w))); closePop(); render(); return; }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    closePop();
    if (a.dataset.act === 'prev') S.offset = Math.max(0, S.offset - Math.max(2, Math.floor(S.weeks / 2)));
    else if (a.dataset.act === 'next') S.offset += Math.max(2, Math.floor(S.weeks / 2));
    else if (a.dataset.act === 'now') S.offset = 0;
    render();
  });
  table.addEventListener('click', (e) => { const b = e.target.closest('.wl-btn'); if (b) openPop(b); });
  pop.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'popclose') closePop();
    else if (a.dataset.act === 'popopen') { const id = a.dataset.id; closePop(); const t = S.tasks.find((x) => x.id === id); if (t) openTask(t); }
  });
  scrim.addEventListener('click', closePop);
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !S.phone && !pop.contains(e.target) && !e.target.closest('.wl-btn')) closePop(); }, true);
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
  const onResize = debounceRaf(() => { if (isPhone() !== S.phone) closePop(); render(); });
  window.addEventListener('resize', onResize);

  async function load() {
    try {
      if (project) S.tasks = await loadTasks(api, { project: project.key || project.id, status: 'open' });
      else {
        // all my projects: every open task in each active project, plus my own tasks that have no project
        const seen = new Map();
        const add = (rows) => { for (const t of rows) seen.set(t.id, t); };
        add(await loadTasks(api, { owner: 'me', status: 'open' }));
        const pr = await api.projects();
        const list = ((pr && pr.projects) || []).filter((p) => !p.status || p.status === 'active').slice(0, 25);
        const got = await Promise.all(list.map((p) => loadTasks(api, { project: p.key || p.id, status: 'open' }).catch(() => [])));
        got.forEach(add);
        S.tasks = Array.from(seen.values());
      }
    } catch (e) { S.tasks = []; toast(msgOf(e), 'error'); }
    render();
  }
  root.classList.add('is-loading');
  await load();
  root.classList.remove('is-loading');
  return { refresh: load, destroy() { unfit(); window.removeEventListener('resize', onResize); closePop(); host.innerHTML = ''; }, state: S };
}

if (typeof window !== 'undefined') {
  const fp = (window.FavorProjects = window.FavorProjects || {});
  fp.views = fp.views || {};
  fp.views.workload = { mount };
}
