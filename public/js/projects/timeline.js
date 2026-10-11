/* Timeline (Gantt) view for one project or for "all my projects".
   Plain DOM and one SVG layer. Only the rows on screen are in the page, so 500 or 2,000 tasks scroll smoothly.
   Mount: mount(el, {api, project|null, sections, members, user}) -> {refresh(), destroy()}. */
import {
  esc, dn, ymd, parts, startOfWeek, todayDn, MONTHS, MON3, DOW3, fmtShort, fmtRange, span, isOpen, isDone, isOverdue, colorOf,
  avatar, toast, openTask, getApi, loadTasks, patchTask, createTask, putDeps, msgOf, debounceRaf, isPhone, fitHeight, prefs, ICON, mkDn,
} from './views-common.js';

const ZOOM_W = { day: 44, week: 18, month: 5.5 };
const ZOOMS = ['day', 'week', 'month'];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function cfg() {
  return isPhone()
    ? { leftW: 136, rowH: 52, barH: 30, headH: 64, phone: true }
    : { leftW: 320, rowH: 40, barH: 24, headH: 64, phone: false };
}

export async function mount(host, ctx) {
  const api = await getApi(ctx);
  const project = ctx.project || null;
  const mine = !project;
  const pf = prefs('timeline');
  let C = cfg();
  const S = {
    zoom: ZOOMS.includes(pf.get.zoom) ? pf.get.zoom : 'week',
    group: pf.get.group || (mine ? 'project' : 'section'),
    showDone: pf.get.showDone !== false,
    tasks: [], byId: new Map(), deps: new Map(), collapsed: new Set(), rows: [], rowIdx: new Map(),
    sel: null, selEdge: null, link: null, addAt: null,
    min: 0, max: 0, dayW: ZOOM_W.week, ov: null, rf: -1, rl: -1, tkey: '', loaded: false, error: '',
  };
  if (mine && S.group === 'section') S.group = 'project';
  if (!mine && S.group === 'project') S.group = 'section';
  S.dayW = ZOOM_W[S.zoom];

  host.innerHTML =
    '<div class="pjv-root pjv-tl" data-pjv="timeline">' +
    '<div class="pjv-bar" role="toolbar" aria-label="Timeline">' +
    '<div class="pjv-seg" role="group" aria-label="Zoom">' + ZOOMS.map((z) => '<button type="button" data-zoom="' + z + '" aria-pressed="' + (z === S.zoom) + '">' + z[0].toUpperCase() + z.slice(1) + '</button>').join('') + '</div>' +
    '<button type="button" class="pjv-btn" data-act="today">Today</button>' +
    '<label class="pjv-sel"><span>Group</span><select data-act="group" aria-label="Group by">' +
    (mine ? '<option value="project">Project</option>' : '<option value="section">Section</option>') +
    '<option value="owner">Owner</option><option value="none">None</option></select></label>' +
    '<button type="button" class="pjv-btn pjv-btn--tog" data-act="done" aria-pressed="' + S.showDone + '">Completed</button>' +
    '<span class="pjv-count" data-count aria-live="polite"></span>' +
    '</div>' +
    '<div class="tl-scroll"><div class="tl-canvas">' +
    '<div class="tl-head"><div class="tl-corner"><span data-corner></span></div><div class="tl-ticks"></div></div>' +
    '<div class="tl-body"><div class="tl-left"></div><div class="tl-chart"><div class="tl-lines"></div><div class="tl-rows"></div>' +
    '<svg class="tl-svg" aria-hidden="true"></svg><div class="tl-float"></div></div></div>' +
    '</div></div>' +
    '<div class="tl-empty" hidden></div>' +
    '<div class="tl-actions" hidden></div>' +
    '</div>';

  const root = host.querySelector('.pjv-tl');
  const scroll = root.querySelector('.tl-scroll');
  const canvas = root.querySelector('.tl-canvas');
  const head = root.querySelector('.tl-head');
  const corner = root.querySelector('.tl-corner');
  const ticks = root.querySelector('.tl-ticks');
  const body = root.querySelector('.tl-body');
  const left = root.querySelector('.tl-left');
  const chart = root.querySelector('.tl-chart');
  const linesEl = root.querySelector('.tl-lines');
  const rowsEl = root.querySelector('.tl-rows');
  const svg = root.querySelector('.tl-svg');
  const floatEl = root.querySelector('.tl-float');
  const emptyEl = root.querySelector('.tl-empty');
  const actionsEl = root.querySelector('.tl-actions');
  const countEl = root.querySelector('[data-count]');
  root.querySelector('select[data-act="group"]').value = S.group;
  const unfit = fitHeight(root, 420);

  /* ------------------------------------------------------------ data */
  const sortCmp = (a, b) => {
    const sa = span(a), sb = span(b);
    const aa = sa.s === sa.s, bb = sb.s === sb.s;
    if (aa !== bb) return aa ? -1 : 1;
    if (aa && sa.s !== sb.s) return sa.s - sb.s;
    if (aa && sa.d !== sb.d) return sa.d - sb.d;
    return (a.sort || 0) - (b.sort || 0);
  };

  function indexTasks() {
    S.byId = new Map(S.tasks.map((t) => [t.id, t]));
    S.deps = new Map();
    for (const t of S.tasks) if (Array.isArray(t.blocked_by) && t.blocked_by.length) S.deps.set(t.id, new Set(t.blocked_by));
  }

  function computeRange() {
    let lo = Infinity, hi = -Infinity;
    for (const t of S.tasks) { const sp = span(t); if (sp.s === sp.s) { lo = Math.min(lo, sp.s); hi = Math.max(hi, sp.d); } }
    const td = todayDn();
    lo = Math.min(lo, td - 28);
    hi = Math.max(hi, td + 84);
    S.min = startOfWeek(lo - 14);
    S.max = hi + 21;
    // at least a full screen of days at the loosest zoom, so Month zoom never shows a stub
    const need = Math.ceil(2400 / ZOOM_W.month);
    if (S.max - S.min < need) S.max = S.min + need;
  }

  function groupOf(t) {
    if (S.group === 'section') return { key: t.section_id || '', label: t.section || 'No section' };
    if (S.group === 'owner') return { key: t.owner ? t.owner.email : '', label: t.owner ? (t.owner.name || t.owner.email) : 'Unassigned' };
    if (S.group === 'project') return { key: t.project ? t.project.id : '', label: t.project ? t.project.name : 'No project' };
    return { key: '', label: '' };
  }

  function buildRows() {
    const items = S.tasks.filter((t) => S.showDone || isOpen(t));
    const ids = new Set(items.map((t) => t.id));
    const kids = new Map();
    const tops = [];
    for (const t of items) {
      if (t.parent_id && ids.has(t.parent_id)) { if (!kids.has(t.parent_id)) kids.set(t.parent_id, []); kids.get(t.parent_id).push(t); } else tops.push(t);
    }
    const groups = new Map();
    const order = [];
    if (S.group === 'section' && ctx.sections) {
      for (const sec of ctx.sections) { groups.set(sec.id, { key: sec.id, label: sec.name, tasks: [], sectionId: sec.id }); order.push(sec.id); }
    }
    for (const t of tops) {
      const g = groupOf(t);
      if (!groups.has(g.key)) { groups.set(g.key, { key: g.key, label: g.label, tasks: [], sectionId: S.group === 'section' ? (g.key || null) : null }); order.push(g.key); }
      groups.get(g.key).tasks.push(t);
    }
    let keys = order;
    if (S.group === 'owner') keys = order.slice().sort((a, b) => (a === '' ? 1 : b === '' ? -1 : groups.get(a).label.localeCompare(groups.get(b).label)));
    else if (S.group === 'project') keys = order.slice().sort((a, b) => (a === '' ? 1 : b === '' ? -1 : groups.get(a).label.localeCompare(groups.get(b).label)));
    else if (S.group === 'section') keys = order.filter((k) => k !== '').concat(order.includes('') ? [''] : []);
    const rows = [];
    for (const k of keys) {
      const g = groups.get(k);
      g.tasks.sort(sortCmp);
      let lo = Infinity, hi = -Infinity, n = 0;
      const flat = [];
      for (const t of g.tasks) {
        flat.push({ k: 't', t, depth: 0 });
        const ch = (kids.get(t.id) || []).slice().sort(sortCmp);
        for (const c of ch) flat.push({ k: 't', t: c, depth: 1 });
      }
      for (const r of flat) { n++; const sp = span(r.t); if (sp.s === sp.s) { lo = Math.min(lo, sp.s); hi = Math.max(hi, sp.d); } }
      g.lo = lo; g.hi = hi; g.n = n;
      if (S.group !== 'none') rows.push({ k: 'g', g });
      if (!S.collapsed.has(g.key)) {
        for (const r of flat) rows.push(r);
        if (S.addAt && S.addAt.key === g.key) rows.push({ k: 'a', g });
      }
    }
    if (S.group === 'none' && S.addAt) rows.push({ k: 'a', g: { key: '', sectionId: null } });
    S.rows = rows;
    S.rowIdx = new Map();
    rows.forEach((r, i) => { if (r.k === 't') S.rowIdx.set(r.t.id, i); });
    countEl.textContent = items.length + (items.length === 1 ? ' task' : ' tasks');
    corner.querySelector('[data-corner]').textContent = S.group === 'none' ? 'Task' : S.group === 'owner' ? 'Owner' : S.group === 'project' ? 'Project' : 'Section';
  }

  /* ------------------------------------------------------------ geometry */
  const X = (day) => (day - S.min) * S.dayW;
  const W = () => (S.max - S.min + 1) * S.dayW;
  const effSpan = (t) => {
    const o = S.ov && S.ov.id === t.id ? S.ov : null;
    if (o) return { s: o.s, d: o.d, both: o.both };
    return span(t);
  };
  function geom(t) {
    const sp = effSpan(t);
    if (sp.s !== sp.s) return null;
    if (sp.both) return { x: X(sp.s), w: Math.max(sp.d - sp.s + 1, 1) * S.dayW, dia: false, sp };
    const size = Math.round(C.barH * 0.8);
    return { x: X(sp.d) + S.dayW / 2 - size / 2, w: size, dia: true, sp };
  }

  /* ------------------------------------------------------------ layout and render */
  function layout() {
    C = cfg();
    const w = W();
    canvas.style.width = (C.leftW + w) + 'px';
    head.style.height = C.headH + 'px';
    head.style.width = (C.leftW + w) + 'px';
    corner.style.width = C.leftW + 'px';
    ticks.style.left = C.leftW + 'px';
    ticks.style.width = w + 'px';
    const bh = Math.max(S.rows.length, 1) * C.rowH + 8;
    body.style.height = bh + 'px';
    body.style.width = (C.leftW + w) + 'px';
    left.style.width = C.leftW + 'px';
    chart.style.left = C.leftW + 'px';
    chart.style.width = w + 'px';
    svg.setAttribute('width', w);
    svg.setAttribute('height', bh);
    root.style.setProperty('--tl-left', C.leftW + 'px');
    root.style.setProperty('--tl-row', C.rowH + 'px');
    root.style.setProperty('--tl-bar', C.barH + 'px');
    root.style.setProperty('--tl-day', S.dayW + 'px');
    root.classList.toggle('is-phone', C.phone);
    S.tkey = ''; S.rf = -1; S.rl = -1;
    renderTicks(true);
    renderRows(true);
  }

  function renderTicks(force) {
    const vw = scroll.clientWidth, sl = scroll.scrollLeft;
    const key = Math.floor(sl / 240) + '|' + vw + '|' + S.zoom + '|' + S.dayW;
    if (!force && key === S.tkey) return;
    S.tkey = key;
    const x0 = Math.max(0, sl - 500), x1 = Math.min(W(), sl + vw + 500);
    const d0 = clamp(S.min + Math.floor(x0 / S.dayW), S.min, S.max), d1 = clamp(S.min + Math.ceil(x1 / S.dayW), S.min, S.max);
    const td = todayDn();
    let top = '', bot = '', lines = '';
    const cellH = C.headH / 2;
    if (S.zoom === 'month') {
      // top: years, bottom: months
      let y = parts(d0).y;
      for (;; y++) {
        const ys = Math.max(mkDn(y, 0, 1), S.min), ye = Math.min(mkDn(y + 1, 0, 1) - 1, S.max);
        if (ys > d1) break;
        if (ye < d0) continue;
        top += '<div class="tl-tk tl-tk--top" style="left:' + X(ys) + 'px;width:' + (ye - ys + 1) * S.dayW + 'px;height:' + cellH + 'px"><span>' + y + '</span></div>';
      }
      let p = parts(d0), y2 = p.y, m = p.m;
      for (;;) {
        const ms = mkDn(y2, m, 1), me = mkDn(y2, m + 1, 1) - 1;
        if (ms > d1) break;
        const s = Math.max(ms, S.min), e = Math.min(me, S.max);
        const cur = td >= ms && td <= me;
        bot += '<div class="tl-tk' + (cur ? ' is-today' : '') + '" style="left:' + X(s) + 'px;width:' + (e - s + 1) * S.dayW + 'px;top:' + cellH + 'px;height:' + cellH + 'px"><span>' + MON3[m] + '</span></div>';
        lines += '<i class="tl-ln" style="left:' + X(s) + 'px"></i>';
        m++; if (m > 11) { m = 0; y2++; }
      }
    } else {
      let p = parts(d0), y2 = p.y, m = p.m;
      for (;;) {
        const ms = mkDn(y2, m, 1), me = mkDn(y2, m + 1, 1) - 1;
        if (ms > d1) break;
        const s = Math.max(ms, S.min), e = Math.min(me, S.max);
        top += '<div class="tl-tk tl-tk--top" style="left:' + X(s) + 'px;width:' + (e - s + 1) * S.dayW + 'px;height:' + cellH + 'px"><span>' + MONTHS[m] + ' ' + y2 + '</span></div>';
        m++; if (m > 11) { m = 0; y2++; }
      }
      if (S.zoom === 'day') {
        for (let d = d0; d <= d1; d++) {
          const wk = ((d + 4) % 7 + 7) % 7; // 1970-01-01 was a Thursday, so (d + 4) % 7 is the weekday with Sunday = 0
          const weekend = wk === 0 || wk === 6;
          const pd = parts(d);
          bot += '<div class="tl-tk' + (d === td ? ' is-today' : '') + (weekend ? ' is-wknd' : '') + '" style="left:' + X(d) + 'px;width:' + S.dayW + 'px;top:' + cellH + 'px;height:' + cellH + 'px"><span>' + pd.d + '<small>' + DOW3[wk][0] + '</small></span></div>';
          lines += '<i class="tl-ln' + (wk === 0 ? ' is-major' : '') + '" style="left:' + X(d) + 'px"></i>';
          if (weekend) lines += '<i class="tl-wk" style="left:' + X(d) + 'px;width:' + S.dayW + 'px"></i>';
        }
      } else {
        for (let d = startOfWeek(d0); d <= d1; d += 7) {
          const s = Math.max(d, S.min), e = Math.min(d + 6, S.max);
          const cur = td >= d && td <= d + 6;
          bot += '<div class="tl-tk' + (cur ? ' is-today' : '') + '" style="left:' + X(s) + 'px;width:' + (e - s + 1) * S.dayW + 'px;top:' + cellH + 'px;height:' + cellH + 'px"><span>' + fmtShort(d) + '</span></div>';
          lines += '<i class="tl-ln" style="left:' + X(s) + 'px"></i>';
        }
      }
    }
    if (td >= S.min && td <= S.max) lines += '<i class="tl-today" style="left:' + (X(td) + S.dayW / 2) + 'px"></i>';
    ticks.innerHTML = top + bot;
    linesEl.innerHTML = lines;
  }

  function barHtml(t) {
    const g = geom(t);
    if (!g) return '';
    const sp = g.sp;
    const done = isDone(t);
    const over = isOverdue(t);
    const blocked = !!t.blocked;
    const c = colorOf(t.project ? t.project.color : 'slate');
    const sel = S.sel === t.id;
    const total = t.subtasks && t.subtasks.total ? t.subtasks.total : 0;
    const prog = total ? Math.round((t.subtasks.done / total) * 100) : (done ? 100 : 0);
    const inside = !g.dia && g.w >= 84;
    const label = '<span class="tl-bl">' + esc(t.title) + '</span>';
    const range = sp.both ? fmtRange(sp.s, sp.d) : fmtShort(sp.d);
    return '<div class="tl-bar' + (g.dia ? ' is-dia' : '') + (done ? ' is-done' : '') + (over ? ' is-over' : '') + (blocked ? ' is-blocked' : '') + (sel ? ' is-sel' : '') + (inside ? ' is-in' : ' is-out') + (!g.dia && g.w < (C.phone ? 66 : 40) ? ' is-narrow' : '') + '"' +
      ' data-id="' + esc(t.id) + '" data-pc="' + c + '" tabindex="0" role="button" aria-label="' + esc(t.title + ', ' + range + (done ? ', completed' : '')) + '"' +
      ' style="left:' + g.x + 'px;width:' + g.w + 'px">' +
      (g.dia ? '<i class="tl-dia"></i>' : '<i class="tl-prog" style="width:' + prog + '%"></i>') +
      label +
      (g.dia ? '' : '<i class="tl-h tl-h--l" data-part="l"></i><i class="tl-h tl-h--r" data-part="r"></i>') +
      '<i class="tl-dot tl-dot--l" data-part="dl"></i><i class="tl-dot tl-dot--r" data-part="dr"></i>' +
      '</div>';
  }

  function renderRows(force) {
    const sTop = scroll.scrollTop, vh = scroll.clientHeight;
    const first = Math.max(0, Math.floor(sTop / C.rowH) - 4);
    const last = Math.min(S.rows.length - 1, Math.ceil((sTop + vh - C.headH) / C.rowH) + 4);
    if (!force && first === S.rf && last === S.rl) return;
    S.rf = first; S.rl = last;
    let lh = '', rh = '';
    for (let i = first; i <= last; i++) {
      const r = S.rows[i];
      const y = i * C.rowH;
      if (r.k === 'g') {
        const g = r.g;
        const col = S.collapsed.has(g.key);
        lh += '<div class="tl-lrow tl-lrow--g" style="top:' + y + 'px" data-g="' + esc(g.key) + '"><button type="button" class="tl-gtog" data-act="gtoggle" aria-expanded="' + !col + '" aria-label="' + (col ? 'Expand ' : 'Collapse ') + esc(g.label) + '">' + ICON.chev + '</button>' +
          '<b class="tl-gname">' + esc(g.label) + '</b><span class="tl-gn">' + g.n + '</span>' +
          (!mine && S.group === 'section' ? '<button type="button" class="tl-gadd" data-act="gadd" aria-label="Add a task to ' + esc(g.label) + '">' + ICON.plus + '</button>' : '') + '</div>';
        let sum = '';
        if (g.lo === g.lo && g.lo !== Infinity) sum = '<i class="tl-sum" style="left:' + X(g.lo) + 'px;width:' + Math.max((g.hi - g.lo + 1) * S.dayW, 6) + 'px"></i>';
        rh += '<div class="tl-row tl-row--g" style="top:' + y + 'px">' + sum + '</div>';
      } else if (r.k === 'a') {
        lh += '<form class="tl-lrow tl-lrow--add" style="top:' + y + 'px" data-add="1"><input type="text" maxlength="180" placeholder="Task name" aria-label="New task name" autocomplete="off"><button type="submit" class="tl-addgo" aria-label="Add">' + ICON.check + '</button></form>';
        rh += '<div class="tl-row" style="top:' + y + 'px"></div>';
      } else {
        const t = r.t;
        const done = isDone(t);
        const over = isOverdue(t);
        const sp = span(t);
        const dateTxt = sp.s === sp.s ? (sp.both ? fmtRange(sp.s, sp.d) : fmtShort(sp.d)) : '';
        lh += '<div class="tl-lrow' + (S.sel === t.id ? ' is-sel' : '') + (done ? ' is-done' : '') + '" style="top:' + y + 'px" data-id="' + esc(t.id) + '"' + (r.depth ? ' data-sub="1"' : '') + '>' +
          '<button type="button" class="tl-check" data-act="check" aria-pressed="' + done + '" aria-label="' + (done ? 'Mark not complete: ' : 'Mark complete: ') + esc(t.title) + '">' + ICON.check + '</button>' +
          '<button type="button" class="tl-title" data-act="open" title="' + esc(t.title) + '">' + esc(t.title) + '</button>' +
          (S.group !== 'owner' && t.owner ? avatar(t.owner, 'sm') : '') +
          (dateTxt ? '<span class="tl-dt' + (over ? ' is-late' : '') + '">' + esc(dateTxt) + '</span>' : '') + '</div>';
        const has = geom(t);
        rh += '<div class="tl-row' + (has ? '' : ' is-undated') + (S.sel === t.id ? ' is-sel' : '') + '" style="top:' + y + 'px" data-id="' + esc(t.id) + '">' + barHtml(t) + '</div>';
      }
    }
    left.innerHTML = lh;
    rowsEl.innerHTML = rh;
    drawEdges();
    syncActions();
    const e = S.rows.length === 0;
    emptyEl.hidden = !(e && S.loaded);
    if (e && S.loaded) emptyEl.textContent = S.error || 'No tasks';
  }

  /* ------------------------------------------------------------ dependency lines */
  function roundedPath(pts, r) {
    let d = 'M' + pts[0][0] + ',' + pts[0][1];
    for (let i = 1; i < pts.length - 1; i++) {
      const [px, py] = pts[i - 1], [cx, cy] = pts[i], [nx, ny] = pts[i + 1];
      const l1 = Math.hypot(cx - px, cy - py), l2 = Math.hypot(nx - cx, ny - cy);
      const rr = Math.min(r, l1 / 2, l2 / 2);
      const ax = cx + ((px - cx) / (l1 || 1)) * rr, ay = cy + ((py - cy) / (l1 || 1)) * rr;
      const bx = cx + ((nx - cx) / (l2 || 1)) * rr, by = cy + ((ny - cy) / (l2 || 1)) * rr;
      d += ' L' + ax + ',' + ay + ' Q' + cx + ',' + cy + ' ' + bx + ',' + by;
    }
    const last = pts[pts.length - 1];
    return d + ' L' + last[0] + ',' + last[1];
  }
  function edgePts(ax, ay, bx, by) {
    const gap = 12;
    if (Math.abs(by - ay) < 1) return [[ax, ay], [bx, by]];
    if (bx - ax >= gap * 2) return [[ax, ay], [ax + gap, ay], [ax + gap, by], [bx, by]];
    const dir = by > ay ? 1 : -1;
    const midY = ay + dir * (C.rowH / 2);
    return [[ax, ay], [ax + gap, ay], [ax + gap, midY], [bx - gap, midY], [bx - gap, by], [bx, by]];
  }

  function drawEdges() {
    const f = S.rf - 1, l = S.rl + 1;
    let out = '';
    S.edgeList = [];
    for (const [succ, preds] of S.deps) {
      const si = S.rowIdx.get(succ);
      if (si == null) continue;
      for (const pred of preds) {
        const pi = S.rowIdx.get(pred);
        if (pi == null) continue;
        if (Math.max(si, pi) < f || Math.min(si, pi) > l) continue;
        const ta = S.byId.get(pred), tb = S.byId.get(succ);
        const ga = geom(ta), gb = geom(tb);
        if (!ga || !gb) continue;
        const ay = pi * C.rowH + C.rowH / 2, by = si * C.rowH + C.rowH / 2;
        const ax = ga.x + ga.w, bx = gb.x;
        const pts = edgePts(ax, ay, bx, by);
        const d = roundedPath(pts, 5);
        const bad = bx < ax + S.dayW * 0.5 && !isDone(ta);
        const hot = S.selEdge && S.selEdge.a === pred && S.selEdge.b === succ;
        const dim = isDone(ta) && isDone(tb);
        out += '<g class="tl-edge' + (bad ? ' is-bad' : '') + (hot ? ' is-hot' : '') + (dim ? ' is-dim' : '') + '"><path class="tl-edge-p" d="' + d + '"/><path class="tl-edge-a" d="M' + bx + ',' + by + ' l-6,-4 l0,8 z"/><path class="tl-edge-hit" d="' + d + '" data-a="' + esc(pred) + '" data-b="' + esc(succ) + '"/></g>';
        S.edgeList.push({ a: pred, b: succ, pts });
      }
    }
    svg.innerHTML = out + '<path class="tl-rubber" d="" hidden/>';
    showEdgeBtn();
  }

  function showEdgeBtn() {
    floatEl.querySelectorAll('.tl-edgebtn').forEach((n) => n.remove());
    if (!S.selEdge) return;
    const e = (S.edgeList || []).find((x) => x.a === S.selEdge.a && x.b === S.selEdge.b);
    if (!e) return;
    // midpoint of the middle segment
    const pts = e.pts;
    const m = pts[Math.floor((pts.length - 1) / 2)], n = pts[Math.floor((pts.length - 1) / 2) + 1];
    const mx = (m[0] + n[0]) / 2, my = (m[1] + n[1]) / 2;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tl-edgebtn';
    b.style.left = mx + 'px';
    b.style.top = my + 'px';
    b.setAttribute('aria-label', 'Remove link');
    b.innerHTML = ICON.x + '<span>Remove link</span>';
    b.addEventListener('click', () => removeDep(S.selEdge.a, S.selEdge.b));
    floatEl.appendChild(b);
  }

  /* ------------------------------------------------------------ saving */
  async function commit(t, patch) {
    const before = {};
    for (const k of Object.keys(patch)) before[k] = t[k];
    Object.assign(t, patch);
    S.ov = null;
    renderRows(true);
    try { await patchTask(api, t.id, patch); } catch (e) { Object.assign(t, before); renderRows(true); toast(msgOf(e), 'error'); }
  }
  async function toggleDone(t) {
    const was = { status: t.status, done_at: t.done_at };
    const next = !isDone(t);
    Object.assign(t, next ? { status: 'done', done_at: ymd(todayDn()) } : { status: 'open', done_at: null });
    renderRows(true);
    try { await patchTask(api, t.id, { done: next }); } catch (e) { Object.assign(t, was); renderRows(true); toast(msgOf(e), 'error'); }
  }
  function datePatch(t, s, d, both) {
    if (both) return { start_date: ymd(s), due_date: ymd(d) };
    return t.due_date || !t.start_date ? { due_date: ymd(d) } : { start_date: ymd(s) };
  }
  function wouldCycle(pred, succ) {
    // adding "succ depends on pred" is a cycle when pred already depends (through any chain) on succ
    const seen = new Set();
    const stack = [pred];
    while (stack.length) {
      const x = stack.pop();
      if (x === succ) return true;
      if (seen.has(x)) continue;
      seen.add(x);
      const ps = S.deps.get(x);
      if (ps) for (const p of ps) stack.push(p);
    }
    return false;
  }
  async function addDep(pred, succ) {
    if (pred === succ) return;
    const has = S.deps.get(succ);
    if (has && has.has(pred)) { toast('Already linked'); return; }
    if (wouldCycle(pred, succ)) { toast('That link would loop back on itself', 'error'); return; }
    if (!has) S.deps.set(succ, new Set([pred])); else has.add(pred);
    const ts = S.byId.get(succ);
    if (ts) { ts.blocked_by = Array.from(S.deps.get(succ)); }
    drawEdges();
    try { await putDeps(api, succ, { add: [pred] }); } catch (e) {
      S.deps.get(succ).delete(pred);
      if (ts) ts.blocked_by = Array.from(S.deps.get(succ));
      drawEdges();
      toast(msgOf(e), 'error');
    }
  }
  async function removeDep(pred, succ) {
    const set = S.deps.get(succ);
    if (!set) return;
    set.delete(pred);
    S.selEdge = null;
    drawEdges();
    try { await putDeps(api, succ, { remove: [pred] }); } catch (e) { set.add(pred); drawEdges(); toast(msgOf(e), 'error'); }
  }
  async function loadMissingDeps() {
    // The task list may not carry blocked_by; ask the detail route for tasks that report blocked.
    const need = S.tasks.filter((t) => !Array.isArray(t.blocked_by) && t.blocked && typeof api.task === 'function').slice(0, 300);
    let i = 0;
    const worker = async () => {
      while (i < need.length) {
        const t = need[i++];
        try {
          const r = await api.task(t.code || t.id);
          const ids = (r && r.deps && r.deps.blockedBy || []).map((x) => x.id).filter(Boolean);
          if (ids.length) { S.deps.set(t.id, new Set(ids)); }
        } catch (e) { /* the line is skipped */ }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (need.length) drawEdges();
  }

  /* ------------------------------------------------------------ pointer work: move, resize, connect, create */
  const coarse = () => window.matchMedia('(pointer: coarse)').matches;
  function dayAt(clientX) {
    const r = scroll.getBoundingClientRect();
    const x = clientX - r.left + scroll.scrollLeft - C.leftW;
    return clamp(S.min + Math.floor(x / S.dayW), S.min, S.max);
  }
  let drag = null;
  let edgeScroll = 0;
  let rafScroll = 0;

  function tip(text, el) {
    let n = floatEl.querySelector('.tl-tip');
    if (!text) { if (n) n.remove(); return; }
    if (!n) { n = document.createElement('div'); n.className = 'tl-tip'; floatEl.appendChild(n); }
    n.textContent = text;
    const row = el.closest('.tl-row');
    n.style.left = (parseFloat(el.style.left) || 0) + 'px';
    n.style.top = (parseFloat(row.style.top) - 30) + 'px';
  }

  function onDown(e) {
    if (e.button != null && e.button > 0) return;
    S.selEdge && (S.selEdge = null, showEdgeBtn(), drawEdges());
    const barEl = e.target.closest('.tl-bar');
    if (barEl) {
      const t = S.byId.get(barEl.dataset.id);
      if (!t) return;
      const part = e.target.dataset && e.target.dataset.part ? e.target.dataset.part : 'body';
      const touch = e.pointerType === 'touch';
      if (S.link) { e.preventDefault(); finishLink(t.id); return; }
      if (touch && S.sel !== t.id) {
        // first tap selects; the selected bar can then be dragged
        S.sel = t.id; S.pendingTap = true; renderRows(true); return;
      }
      if (part === 'dl' || part === 'dr') {
        e.preventDefault();
        drag = { kind: 'connect', t, side: part === 'dr' ? 'r' : 'l', x0: e.clientX, y0: e.clientY, moved: false, bar: barEl };
        startDrag(e);
        return;
      }
      const sp = span(t);
      drag = { kind: part === 'l' ? 'resize-l' : part === 'r' ? 'resize-r' : 'move', t, sp0: sp, day0: dayAt(e.clientX), x0: e.clientX, y0: e.clientY, moved: false, bar: barEl, touch };
      if (!drag.touch || S.sel === t.id) { if (e.cancelable) e.preventDefault(); }
      startDrag(e);
      return;
    }
    const rowEl = e.target.closest('.tl-row');
    if (rowEl && rowEl.dataset.id && rowEl.classList.contains('is-undated')) {
      const t = S.byId.get(rowEl.dataset.id);
      if (!t) return;
      if (S.link) return;
      drag = { kind: 'create', t, day0: dayAt(e.clientX), x0: e.clientX, y0: e.clientY, moved: false, row: rowEl, touch: e.pointerType === 'touch', t0: Date.now() };
      startDrag(e);
      return;
    }
    if (S.sel && !e.target.closest('.tl-actions')) { S.sel = null; renderRows(true); }
  }

  function startDrag(e) {
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    drag.lastX = e.clientX; drag.lastY = e.clientY;
  }
  function stopDrag() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    document.body.classList.remove('tl-dragging');
    edgeScroll = 0;
    tip('');
  }

  function applyDrag() {
    const d = drag;
    if (!d) return;
    const cur = dayAt(d.lastX);
    if (d.kind === 'move' || d.kind === 'resize-l' || d.kind === 'resize-r') {
      const delta = cur - d.day0;
      const o = d.sp0;
      let s = o.s, e2 = o.d;
      if (d.kind === 'move') {
        const dd = clamp(delta, S.min - o.s, S.max - o.d);
        s = o.s + dd; e2 = o.d + dd;
      } else if (d.kind === 'resize-l') {
        s = clamp(o.s + delta, S.min, o.d);
      } else {
        e2 = clamp(o.d + delta, o.s, S.max);
      }
      S.ov = { id: d.t.id, s, d: e2, both: o.both };
      d.cur = { s, d: e2 };
      const g = geom(d.t);
      d.bar.style.left = g.x + 'px';
      d.bar.style.width = g.w + 'px';
      const inside = !g.dia && g.w >= 84;
      d.bar.classList.toggle('is-in', inside);
      d.bar.classList.toggle('is-out', !inside);
      d.bar.classList.toggle('is-narrow', !g.dia && g.w < (C.phone ? 66 : 40));
      tip(o.both ? fmtRange(s, e2) : fmtShort(e2), d.bar);
      drawEdges();
    } else if (d.kind === 'create') {
      let a = d.day0, b = cur;
      if (a > b) [a, b] = [b, a];
      let ghost = d.row.querySelector('.tl-ghost');
      if (!ghost) { ghost = document.createElement('div'); ghost.className = 'tl-ghost'; d.row.appendChild(ghost); }
      ghost.style.left = X(a) + 'px';
      ghost.style.width = (b - a + 1) * S.dayW + 'px';
      d.cur = { s: a, d: b };
      tip(a === b ? fmtShort(a) : fmtRange(a, b), ghost);
    } else if (d.kind === 'connect') {
      const r = chart.getBoundingClientRect();
      const g = geom(d.t);
      const ri = S.rowIdx.get(d.t.id);
      const sx = (d.side === 'r' ? g.x + g.w : g.x), sy = ri * C.rowH + C.rowH / 2;
      const ex = d.lastX - r.left, ey = d.lastY - r.top;
      const path = svg.querySelector('.tl-rubber');
      path.removeAttribute('hidden');
      path.setAttribute('d', 'M' + sx + ',' + sy + ' C' + (sx + (d.side === 'r' ? 40 : -40)) + ',' + sy + ' ' + (ex - (d.side === 'r' ? 40 : -40)) + ',' + ey + ' ' + ex + ',' + ey);
      const el = document.elementFromPoint(d.lastX, d.lastY);
      const tb = el && el.closest ? el.closest('.tl-bar') : null;
      rowsEl.querySelectorAll('.is-target').forEach((n) => n.classList.remove('is-target'));
      d.target = null;
      if (tb && tb.dataset.id !== d.t.id) { tb.classList.add('is-target'); d.target = tb.dataset.id; }
    }
  }

  function onMove(e) {
    if (!drag) return;
    drag.lastX = e.clientX; drag.lastY = e.clientY;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < (drag.touch ? 8 : 4)) return;
      if (drag.kind === 'create' && drag.touch) { stopDrag(); drag = null; return; }
      drag.moved = true;
      document.body.classList.add('tl-dragging');
      if (drag.bar) drag.bar.classList.add('is-drag');
    }
    if (e.cancelable) e.preventDefault();
    applyDrag();
    // scroll the chart when the pointer reaches an edge
    const r = scroll.getBoundingClientRect();
    const edge = 56;
    edgeScroll = 0;
    if (e.clientX > r.right - edge) edgeScroll = Math.ceil((e.clientX - (r.right - edge)) / 3);
    else if (e.clientX < r.left + C.leftW + edge && scroll.scrollLeft > 0) edgeScroll = -Math.ceil(((r.left + C.leftW + edge) - e.clientX) / 3);
    if (edgeScroll && !rafScroll) rafScroll = requestAnimationFrame(autoScroll);
  }
  function autoScroll() {
    rafScroll = 0;
    if (!drag || !edgeScroll) return;
    scroll.scrollLeft += edgeScroll;
    applyDrag();
    rafScroll = requestAnimationFrame(autoScroll);
  }

  function onCancel() {
    if (!drag) return;
    const d = drag;
    drag = null; S.ov = null;
    stopDrag();
    renderRows(true);
    void d;
  }

  async function onUp(e) {
    const d = drag;
    if (!d) return;
    drag = null;
    stopDrag();
    rowsEl.querySelectorAll('.is-target').forEach((n) => n.classList.remove('is-target'));
    const rub = svg.querySelector('.tl-rubber');
    if (rub) rub.setAttribute('hidden', '');
    if (d.kind === 'connect') {
      if (d.moved && d.target) {
        if (d.side === 'r') addDep(d.t.id, d.target); else addDep(d.target, d.t.id);
      }
      renderRows(true);
      return;
    }
    if (d.kind === 'create') {
      if (!d.moved) {
        if (d.touch && Date.now() - d.t0 > 500) return;
        const day = d.day0;
        S.ov = null;
        const was = { start_date: d.t.start_date, due_date: d.t.due_date };
        await commit(d.t, { due_date: ymd(day) });
        toast('Due ' + fmtShort(day), null, { label: 'Undo', fn: () => commit(d.t, was) });
      } else {
        const { s, d: dd } = d.cur;
        await commit(d.t, s === dd ? { due_date: ymd(dd) } : { start_date: ymd(s), due_date: ymd(dd) });
      }
      return;
    }
    // bar drags
    if (!d.moved) {
      S.ov = null;
      if (d.touch) {
        if (S.pendingTap) { S.pendingTap = false; renderRows(true); return; }
        openTask(d.t);
        return;
      }
      S.sel = d.t.id;
      openTask(d.t);
      renderRows(true);
      return;
    }
    S.pendingTap = false;
    const c = d.cur;
    if (!c || (c.s === d.sp0.s && c.d === d.sp0.d)) { S.ov = null; renderRows(true); return; }
    await commit(d.t, datePatch(d.t, c.s, c.d, d.sp0.both));
    void e;
  }

  /* link mode (touch): select a bar, press Link, tap the task that comes next */
  function finishLink(succId) {
    const pred = S.link;
    S.link = null;
    root.classList.remove('is-linking');
    if (pred && succId && pred !== succId) addDep(pred, succId);
    syncActions();
  }

  /* ------------------------------------------------------------ left column and bar clicks */
  function onClick(e) {
    const hit = e.target.closest('.tl-edge-hit');
    if (hit) {
      S.selEdge = { a: hit.dataset.a, b: hit.dataset.b };
      drawEdges();
      return;
    }
    const act = e.target.closest('[data-act]');
    if (act && left.contains(act)) {
      const row = act.closest('.tl-lrow');
      const id = row && row.dataset.id;
      const a = act.dataset.act;
      if (a === 'open' && id) {
        if (S.link) { finishLink(id); return; }
        S.sel = id; openTask(S.byId.get(id));
      } else if (a === 'check' && id) {
        const t = S.byId.get(id);
        toggleDone(t);
      } else if (a === 'gtoggle') {
        const k = row.dataset.g;
        if (S.collapsed.has(k)) S.collapsed.delete(k); else S.collapsed.add(k);
        rebuild();
      } else if (a === 'gadd') {
        S.addAt = { key: row.dataset.g };
        S.collapsed.delete(row.dataset.g);
        rebuild();
        const inp = left.querySelector('.tl-lrow--add input');
        if (inp) inp.focus();
      }
      return;
    }
  }

  async function onSubmit(e) {
    const f = e.target.closest('form[data-add]');
    if (!f) return;
    e.preventDefault();
    const inp = f.querySelector('input');
    const title = inp.value.trim();
    if (!title) { S.addAt = null; rebuild(); return; }
    inp.disabled = true;
    const at = S.addAt;
    const body = { title };
    if (project) body.project_id = project.id;
    if (at && at.key && S.group === 'section') body.section_id = at.key;
    if (!project && ctx.user && ctx.user.email) body.owner_email = ctx.user.email;
    try {
      const r = await createTask(api, body);
      const t = r.task || r;
      if (t) {
        if (!t.project && project) t.project = { id: project.id, key: project.key, name: project.name, color: project.color };
        if (S.group === 'section' && at && at.key && !t.section) { const sec = (ctx.sections || []).find((s) => s.id === at.key); if (sec) { t.section = sec.name; t.section_id = sec.id; } }
        S.tasks.push(t); S.byId.set(t.id, t);
      }
      // stay open for the next one
      rebuild();
      const next = left.querySelector('.tl-lrow--add input');
      if (next) next.focus();
    } catch (err) {
      inp.disabled = false;
      toast(msgOf(err), 'error');
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      if (S.link) { S.link = null; root.classList.remove('is-linking'); syncActions(); return; }
      if (S.addAt) { S.addAt = null; rebuild(); return; }
      if (S.selEdge) { S.selEdge = null; drawEdges(); return; }
      if (S.sel) { S.sel = null; renderRows(true); }
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.selEdge && !e.target.closest('input')) { removeDep(S.selEdge.a, S.selEdge.b); return; }
    const barEl = e.target.closest && e.target.closest('.tl-bar');
    if (!barEl) return;
    const t = S.byId.get(barEl.dataset.id);
    if (!t) return;
    if (e.key === 'Enter') { e.preventDefault(); openTask(t); return; }
    if (e.key === ' ') { e.preventDefault(); S.sel = t.id; renderRows(true); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const step = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 7 : 1);
      const sp = span(t);
      if (sp.s !== sp.s) return;
      let s = sp.s, d = sp.d;
      if (e.altKey && sp.both) d = Math.max(s, d + step); else { s += step; d += step; }
      commit(t, datePatch(t, s, d, sp.both)).then(() => {
        const n = rowsEl.querySelector('.tl-bar[data-id="' + CSS.escape(t.id) + '"]');
        if (n) n.focus({ preventScroll: true });
      });
    }
  }

  /* ------------------------------------------------------------ phone action bar */
  function syncActions() {
    const t = S.sel ? S.byId.get(S.sel) : null;
    if (!t || !(coarse() || C.phone)) { actionsEl.hidden = true; actionsEl.innerHTML = ''; return; }
    actionsEl.hidden = false;
    const done = isDone(t);
    if (S.link) {
      actionsEl.innerHTML = '<span class="tl-act-msg">Tap the task that comes after ' + esc(t.title) + '</span><button type="button" class="pjv-btn" data-act="linkcancel">Cancel</button>';
      return;
    }
    const has = span(t).s === span(t).s;
    actionsEl.innerHTML =
      '<span class="tl-act-t">' + esc(t.title) + '</span>' +
      '<button type="button" class="pjv-btn" data-act="aopen">Open</button>' +
      '<button type="button" class="pjv-btn" data-act="alink"' + (has ? '' : ' disabled') + '>Link</button>' +
      '<button type="button" class="pjv-btn" data-act="adone">' + (done ? 'Reopen' : 'Done') + '</button>' +
      '<button type="button" class="pjv-btn pjv-btn--ico" data-act="aclose" aria-label="Clear selection">' + ICON.x + '</button>';
  }
  actionsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const t = S.sel ? S.byId.get(S.sel) : null;
    const a = b.dataset.act;
    if (a === 'aopen' && t) openTask(t);
    else if (a === 'alink' && t) { S.link = t.id; root.classList.add('is-linking'); syncActions(); }
    else if (a === 'linkcancel') { S.link = null; root.classList.remove('is-linking'); syncActions(); }
    else if (a === 'adone' && t) toggleDone(t);
    else if (a === 'aclose') { S.sel = null; renderRows(true); }
  });

  /* ------------------------------------------------------------ toolbar */
  function rebuild() {
    buildRows();
    layout();
  }
  function setZoom(z) {
    if (z === S.zoom) return;
    const vw = scroll.clientWidth - C.leftW;
    const center = S.min + (scroll.scrollLeft + vw / 2) / S.dayW;
    S.zoom = z; S.dayW = ZOOM_W[z];
    pf.set({ zoom: z });
    root.querySelectorAll('[data-zoom]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.zoom === z)));
    layout();
    scroll.scrollLeft = Math.max(0, (center - S.min) * S.dayW - vw / 2);
    renderTicks(true);
  }
  function goToday(smooth) {
    const td = todayDn();
    const vw = scroll.clientWidth - C.leftW;
    const x = Math.max(0, X(td) - vw * 0.3);
    scroll.scrollTo({ left: x, behavior: smooth ? 'smooth' : 'auto' });
  }

  root.querySelector('.pjv-bar').addEventListener('click', (e) => {
    const z = e.target.closest('[data-zoom]');
    if (z) { setZoom(z.dataset.zoom); return; }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'today') goToday(true);
    else if (a.dataset.act === 'done') {
      S.showDone = !S.showDone;
      a.setAttribute('aria-pressed', String(S.showDone));
      pf.set({ showDone: S.showDone });
      rebuild();
    }
  });
  root.querySelector('select[data-act="group"]').addEventListener('change', (e) => {
    S.group = e.target.value;
    pf.set({ group: S.group });
    S.addAt = null;
    scroll.scrollTop = 0;
    rebuild();
  });

  const onScroll = debounceRaf(() => { renderRows(false); renderTicks(false); root.classList.toggle('is-scrolled', scroll.scrollLeft > 2); });
  scroll.addEventListener('scroll', onScroll, { passive: true });
  chart.addEventListener('pointerdown', onDown);
  chart.addEventListener('click', onClick);
  left.addEventListener('click', onClick);
  left.addEventListener('submit', onSubmit);
  root.addEventListener('keydown', onKey);
  scroll.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const i = ZOOMS.indexOf(S.zoom);
    setZoom(ZOOMS[clamp(i + (e.deltaY > 0 ? 1 : -1), 0, 2)]);
  }, { passive: false });
  const onResize = debounceRaf(() => {
    const was = C.phone;
    C = cfg();
    if (was !== C.phone) layout(); else { renderTicks(true); renderRows(true); }
  });
  window.addEventListener('resize', onResize);

  /* ------------------------------------------------------------ load */
  async function load() {
    try {
      const q = project ? { project: project.key || project.id } : { owner: 'me' };
      S.tasks = await loadTasks(api, q);
      S.error = '';
    } catch (e) {
      S.tasks = [];
      S.error = msgOf(e);
    }
    S.loaded = true;
    indexTasks();
    computeRange();
    buildRows();
    layout();
    goToday(false);
    renderTicks(true);
    loadMissingDeps();
  }
  root.classList.add('is-loading');
  await load();
  root.classList.remove('is-loading');

  return {
    refresh: load,
    destroy() {
      unfit();
      window.removeEventListener('resize', onResize);
      stopDrag();
      host.innerHTML = '';
    },
    // for tests and for the page shell
    state: S,
  };
}

if (typeof window !== 'undefined') {
  const fp = (window.FavorProjects = window.FavorProjects || {});
  fp.views = fp.views || {};
  fp.views.timeline = { mount };
}
