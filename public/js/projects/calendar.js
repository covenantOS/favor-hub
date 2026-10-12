/* Calendar view for one project or for "all my projects": month and week, drag a task to another day, an Unscheduled tray,
   click a day to add, and a plain agenda list on phones.
   Mount: mount(el, {api, project|null, sections, members, user}) -> {refresh(), destroy()}. */
import {
  esc, dn, ymd, parts, startOfWeek, todayDn, MONTHS, MON3, DOW3, fmtShort, fmtLong, fmtRange, span, isOpen, isDone, isOverdue, colorOf,
  avatar, toast, openTask, getApi, loadTasks, patchTask, createTask, msgOf, debounceRaf, isPhone, fitHeight, prefs, ICON, mkDn, trackOverlay,
} from './views-common.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export async function mount(host, ctx) {
  const api = await getApi(ctx);
  const project = ctx.project || null;
  const mine = !project;
  const pf = prefs('calendar');
  const S = {
    mode: pf.get.mode === 'week' ? 'week' : 'month',
    anchor: todayDn(),
    showDone: pf.get.showDone !== false,
    tray: pf.get.tray !== false,
    tasks: [], byId: new Map(), loaded: false, error: '', phone: isPhone(), pop: null,
  };

  host.innerHTML =
    '<div class="pjv-root pjv-cal" data-pjv="calendar">' +
    '<div class="pjv-bar" role="toolbar" aria-label="Calendar">' +
    '<div class="cal-nav"><button type="button" class="pjv-btn pjv-btn--ico" data-act="prev" aria-label="Previous">' + ICON.chevL + '</button>' +
    '<button type="button" class="pjv-btn pjv-btn--ico" data-act="next" aria-label="Next">' + ICON.chev + '</button></div>' +
    '<button type="button" class="pjv-btn" data-act="today">Today</button>' +
    '<h2 class="pjv-title" data-title aria-live="polite"></h2>' +
    '<div class="pjv-seg cal-modes" role="group" aria-label="View"><button type="button" data-mode="month">Month</button><button type="button" data-mode="week">Week</button></div>' +
    '<button type="button" class="pjv-btn pjv-btn--tog" data-act="done" aria-pressed="' + S.showDone + '">Completed</button>' +
    '<button type="button" class="pjv-btn pjv-btn--tog cal-traybtn" data-act="tray" aria-pressed="' + S.tray + '">No date <span data-nodate>0</span></button>' +
    '<button type="button" class="pjv-btn pjv-btn--primary cal-addbtn" data-act="addtop">' + ICON.plus + 'Task</button>' +
    '</div>' +
    '<div class="cal-wrap pjv-body">' +
    '<div class="cal-main"><div class="cal-dow"></div><div class="cal-scroll"><div class="cal-grid"></div></div></div>' +
    '<aside class="cal-tray" aria-label="Tasks without a date"><div class="cal-tray__h"><b>No date</b><span data-nodate>0</span></div><div class="cal-tray__list"></div></aside>' +
    '</div>' +
    '<div class="cal-agenda pjv-body" hidden></div>' +
    '<div class="cal-pop" hidden role="dialog" aria-label="Add a task"></div>' +
    '<div class="cal-scrim" hidden></div>' +
    '</div>';

  const root = host.querySelector('.pjv-cal');
  const titleEl = root.querySelector('[data-title]');
  const wrap = root.querySelector('.cal-wrap');
  const dowEl = root.querySelector('.cal-dow');
  const scrollEl = root.querySelector('.cal-scroll');
  const grid = root.querySelector('.cal-grid');
  const tray = root.querySelector('.cal-tray');
  const trayList = root.querySelector('.cal-tray__list');
  const agenda = root.querySelector('.cal-agenda');
  const pop = root.querySelector('.cal-pop');
  const scrim = root.querySelector('.cal-scrim');
  const unfit = fitHeight(root, 480);

  /* ------------------------------------------------------------ data */
  function visibleTasks() { return S.tasks.filter((t) => S.showDone || isOpen(t)); }
  const chipColor = (t) => colorOf(t.project ? t.project.color : 'slate');

  function period() {
    const p = parts(S.anchor);
    if (S.mode === 'week') { const s = startOfWeek(S.anchor); return { start: s, weeks: 1, first: s, last: s + 6 }; }
    const first = mkDn(p.y, p.m, 1);
    const last = mkDn(p.y, p.m + 1, 1) - 1;
    const start = startOfWeek(first);
    const weeks = Math.ceil((last - start + 1) / 7);
    return { start, weeks, first, last };
  }

  function titleText(per) {
    if (S.mode === 'month') { const p = parts(S.anchor); return MONTHS[p.m] + ' ' + p.y; }
    const a = parts(per.first), b = parts(per.last);
    return a.m === b.m ? MON3[a.m] + ' ' + a.d + ' to ' + b.d + ', ' + b.y : MON3[a.m] + ' ' + a.d + ' to ' + MON3[b.m] + ' ' + b.d + ', ' + b.y;
  }

  /* ------------------------------------------------------------ render: grid */
  function chipHtml(seg, laneRow) {
    const t = seg.t;
    const done = isDone(t);
    const over = isOverdue(t);
    const c = chipColor(t);
    const sp = span(t);
    const multi = sp.both && sp.s !== sp.d;
    return '<button type="button" class="cal-chip' + (done ? ' is-done' : '') + (over ? ' is-over' : '') + (multi ? ' is-multi' : '') + (seg.openL ? ' is-open-l' : '') + (seg.openR ? ' is-open-r' : '') + '"' +
      ' data-id="' + esc(t.id) + '" data-pc="' + c + '" style="grid-column:' + (seg.c0 + 1) + ' / span ' + (seg.c1 - seg.c0 + 1) + ';grid-row:' + (laneRow + 1) + '"' +
      ' aria-label="' + esc(t.title + ', ' + (multi ? fmtRange(sp.s, sp.d) : fmtShort(sp.d)) + (done ? ', completed' : '')) + '">' +
      (done ? '<span class="cal-chip__ck">' + ICON.check + '</span>' : '') +
      '<span class="cal-chip__t">' + esc(t.title) + '</span>' +
      (t.owner && !seg.openL ? '<span class="cal-chip__av">' + avatar(t.owner, 'xs') + '</span>' : '') + '</button>';
  }

  function renderGrid() {
    const per = period();
    titleEl.textContent = titleText(per);
    dowEl.innerHTML = DOW3.map((d) => '<span>' + d + '</span>').join('');
    const td = todayDn();
    const vis = visibleTasks();
    const lo = per.start, hi = per.start + per.weeks * 7 - 1;
    const inRange = [];
    for (const t of vis) { const sp = span(t); if (sp.s === sp.s && sp.d >= lo && sp.s <= hi) inRange.push({ t, sp }); }
    inRange.sort((a, b) => {
      const la = a.sp.d - a.sp.s, lb = b.sp.d - b.sp.s;
      if ((la > 0) !== (lb > 0)) return la > 0 ? -1 : 1;
      if (a.sp.s !== b.sp.s) return a.sp.s - b.sp.s;
      return a.t.title.localeCompare(b.t.title);
    });
    // how many lanes fit: measure the space
    const gridH = scrollEl.clientHeight || 600;
    const rowH = S.mode === 'week' ? Math.max(gridH, 360) : Math.max(116, Math.floor(gridH / per.weeks));
    const capacity = S.mode === 'week' ? 60 : Math.max(1, Math.floor((rowH - 36 - 22) / 27));
    let html = '';
    for (let w = 0; w < per.weeks; w++) {
      const ws = per.start + w * 7;
      const we = ws + 6;
      const segs = [];
      for (const it of inRange) {
        if (it.sp.d < ws || it.sp.s > we) continue;
        segs.push({ t: it.t, c0: Math.max(it.sp.s, ws) - ws, c1: Math.min(it.sp.d, we) - ws, openL: it.sp.s < ws, openR: it.sp.d > we });
      }
      const laneEnd = [];
      const hidden = [0, 0, 0, 0, 0, 0, 0];
      let items = '';
      let lanesUsed = 0;
      for (const sg of segs) {
        let l = 0;
        while (laneEnd[l] != null && laneEnd[l] >= sg.c0) l++;
        laneEnd[l] = sg.c1;
        if (l < capacity) { items += chipHtml(sg, l); lanesUsed = Math.max(lanesUsed, l + 1); } else { for (let c = sg.c0; c <= sg.c1; c++) hidden[c]++; }
      }
      let more = '';
      for (let c = 0; c < 7; c++) if (hidden[c]) more += '<button type="button" class="cal-more" data-day="' + (ws + c) + '" style="grid-column:' + (c + 1) + ';grid-row:' + (capacity + 1) + '">+' + hidden[c] + ' more</button>';
      let cells = '';
      for (let c = 0; c < 7; c++) {
        const d = ws + c;
        const p = parts(d);
        const off = S.mode === 'month' && (d < per.first || d > per.last);
        const showMon = S.mode === 'month' ? (p.d === 1) : (c === 0 || p.d === 1);
        cells += '<div class="cal-cell' + (d === td ? ' is-today' : '') + (off ? ' is-off' : '') + (c === 0 || c === 6 ? ' is-wknd' : '') + '" data-day="' + d + '" role="gridcell" aria-label="' + esc(fmtLong(d)) + '">' +
          '<span class="cal-num">' + (showMon ? MON3[p.m] + ' ' : '') + p.d + '</span><span class="cal-plus" aria-hidden="true">' + ICON.plus + '</span></div>';
      }
      html += '<div class="cal-week" data-ws="' + ws + '" style="' + (S.mode === 'week' ? 'min-height:' + rowH + 'px' : 'height:' + rowH + 'px') + '"><div class="cal-days">' + cells + '</div><div class="cal-items">' + items + more + '</div></div>';
    }
    grid.innerHTML = html;
    grid.style.setProperty('--cal-lane', '26px');
  }

  function renderTray() {
    const items = visibleTasks().filter((t) => span(t).s !== span(t).s);
    root.querySelectorAll('[data-nodate]').forEach((n) => { n.textContent = items.length; });
    items.sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.title.localeCompare(b.title));
    tray.classList.toggle('is-off', !S.tray);
    trayList.innerHTML = items.length ? items.map((t) =>
      '<button type="button" class="cal-tt' + (isDone(t) ? ' is-done' : '') + '" data-id="' + esc(t.id) + '" data-pc="' + chipColor(t) + '"><span class="cal-tt__t">' + esc(t.title) + '</span>' +
      '<span class="cal-tt__m">' + (t.project && mine ? '<i>' + esc(t.project.key) + '</i>' : '') + (t.owner ? avatar(t.owner, 'xs') : '') + '</span></button>').join('') : '<p class="cal-tray__none">None</p>';
  }

  /* ------------------------------------------------------------ render: phone agenda */
  function renderAgenda() {
    const per = period();
    titleEl.textContent = titleText(per);
    const td = todayDn();
    const vis = visibleTasks();
    const byDay = new Map();
    for (const t of vis) {
      const sp = span(t);
      if (sp.s !== sp.s) continue;
      const key = sp.d;
      if (key < per.first || key > per.last) continue;
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(t);
    }
    const days = [];
    for (let d = per.first; d <= per.last; d++) if (S.mode === 'week' || byDay.has(d) || d === td) days.push(d);
    let html = '';
    for (const d of days) {
      const list = (byDay.get(d) || []).slice().sort((a, b) => a.title.localeCompare(b.title));
      html += '<section class="ag-day' + (d === td ? ' is-today' : '') + '" data-day="' + d + '"><header><b>' + esc(fmtLong(d)) + '</b>' + (d === td ? '<em>Today</em>' : '') +
        '<button type="button" class="ag-add" data-act="agadd" data-day="' + d + '" aria-label="Add a task on ' + esc(fmtLong(d)) + '">' + ICON.plus + '</button></header>' +
        (list.length ? list.map(agendaRow).join('') : '<p class="ag-none">Nothing due</p>') + '</section>';
    }
    const nodate = vis.filter((t) => span(t).s !== span(t).s);
    if (nodate.length) {
      html += '<section class="ag-day ag-day--nodate"><header><b>No date</b><span class="ag-n">' + nodate.length + '</span></header>' + nodate.map(agendaRow).join('') + '</section>';
    }
    agenda.innerHTML = html || '<p class="ag-none">No tasks</p>';
    if (!S._scrolled && S.mode === 'month') {
      S._scrolled = true;
      const el = agenda.querySelector('.ag-day.is-today');
      if (el) requestAnimationFrame(() => { el.scrollIntoView({ block: 'start' }); });
    }
  }
  function agendaRow(t) {
    const done = isDone(t);
    const over = isOverdue(t);
    const sp = span(t);
    const sub = [];
    if (mine && t.project) sub.push(esc(t.project.name));
    if (sp.both && sp.s !== sp.d) sub.push(esc(fmtRange(sp.s, sp.d)));
    if (t.owner && !mine) sub.push(esc(t.owner.name || t.owner.email));
    return '<div class="ag-row' + (done ? ' is-done' : '') + '" data-id="' + esc(t.id) + '" data-pc="' + chipColor(t) + '">' +
      '<button type="button" class="ag-ck" data-act="agdone" aria-pressed="' + done + '" aria-label="' + (done ? 'Mark not complete: ' : 'Mark complete: ') + esc(t.title) + '">' + ICON.check + '</button>' +
      '<button type="button" class="ag-t" data-act="agopen"><span class="ag-t__n">' + esc(t.title) + '</span>' + (sub.length ? '<small>' + sub.join(' · ') + '</small>' : '') + '</button>' +
      '<label class="ag-date' + (over ? ' is-late' : '') + '"><span>' + (sp.s === sp.s ? esc(fmtShort(sp.d)) : 'Set date') + '</span>' + ICON.cal +
      '<input type="date" value="' + (sp.s === sp.s ? ymd(sp.d) : '') + '" data-act="agdate" aria-label="Due date for ' + esc(t.title) + '"></label></div>';
  }

  function render() {
    S.phone = isPhone();
    root.classList.toggle('is-phone', S.phone);
    wrap.hidden = S.phone;
    agenda.hidden = !S.phone;
    root.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)));
    if (S.phone) renderAgenda(); else { renderGrid(); renderTray(); }
  }

  /* ------------------------------------------------------------ saving */
  async function commit(t, patch) {
    const before = {};
    for (const k of Object.keys(patch)) before[k] = t[k];
    Object.assign(t, patch);
    render();
    try { await patchTask(api, t.id, patch); } catch (e) { Object.assign(t, before); render(); toast(msgOf(e), 'error'); }
  }
  async function toggleDone(t) {
    const was = { status: t.status, done_at: t.done_at };
    const next = !isDone(t);
    Object.assign(t, next ? { status: 'done', done_at: ymd(todayDn()) } : { status: 'open', done_at: null });
    render();
    try { await patchTask(api, t.id, { done: next }); } catch (e) { Object.assign(t, was); render(); toast(msgOf(e), 'error'); }
  }
  function movePatch(t, grabDay, dropDay) {
    const sp = span(t);
    if (sp.s !== sp.s) return { due_date: ymd(dropDay) };
    if (sp.both) { const dlt = dropDay - (grabDay == null ? sp.s : grabDay); return { start_date: ymd(sp.s + dlt), due_date: ymd(sp.d + dlt) }; }
    return t.due_date || !t.start_date ? { due_date: ymd(dropDay) } : { start_date: ymd(dropDay) };
  }

  /* ------------------------------------------------------------ drag to another day */
  function dayFromPoint(x, y) {
    const weeks = grid.querySelectorAll('.cal-week');
    for (const w of weeks) {
      const r = w.getBoundingClientRect();
      if (y >= r.top && y < r.bottom && x >= r.left && x < r.right) {
        const col = clamp(Math.floor(((x - r.left) / r.width) * 7), 0, 6);
        return Number(w.dataset.ws) + col;
      }
    }
    return null;
  }
  let drag = null;
  let raf = 0;
  let ghost = null;
  function onDown(e) {
    if (e.button != null && e.button > 0) return;
    const el = e.target.closest('.cal-chip, .cal-tt');
    if (!el) return;
    const t = S.byId.get(el.dataset.id);
    if (!t) return;
    drag = { t, el, tray: el.classList.contains('cal-tt'), x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, grab: dayFromPoint(e.clientX, e.clientY), pid: e.pointerId };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }
  function setGhost() {
    const r = drag.el.getBoundingClientRect();
    ghost = drag.el.cloneNode(true);
    ghost.classList.add('cal-ghost');
    ghost.removeAttribute('style');
    ghost.style.width = Math.min(Math.max(r.width, 140), 260) + 'px';
    document.body.appendChild(ghost);
    drag.el.classList.add('is-drag');
    document.body.classList.add('cal-dragging');
    drag.offX = clamp(drag.x0 - r.left, 12, Math.min(r.width, 260) - 12);
    drag.offY = r.height / 2;
  }
  function paint() {
    raf = 0;
    if (!drag || !drag.moved) return;
    ghost.style.transform = 'translate(' + (drag.x - drag.offX) + 'px,' + (drag.y - drag.offY) + 'px)';
    const day = dayFromPoint(drag.x, drag.y);
    const trayR = tray.getBoundingClientRect();
    const overTray = !tray.classList.contains('is-off') && drag.x >= trayR.left && drag.x <= trayR.right && drag.y >= trayR.top && drag.y <= trayR.bottom;
    drag.day = overTray ? null : day;
    drag.overTray = overTray;
    grid.querySelectorAll('.cal-cell.is-drop').forEach((n) => n.classList.remove('is-drop'));
    if (drag.day != null) { const c = grid.querySelector('.cal-cell[data-day="' + drag.day + '"]'); if (c) c.classList.add('is-drop'); }
    tray.classList.toggle('is-drop', overTray && !drag.tray);
    // scroll the grid when the pointer is near its top or bottom edge
    const sr = scrollEl.getBoundingClientRect();
    let dy = 0;
    if (drag.y < sr.top + 40) dy = -Math.ceil((sr.top + 40 - drag.y) / 3);
    else if (drag.y > sr.bottom - 40) dy = Math.ceil((drag.y - (sr.bottom - 40)) / 3);
    if (dy && drag.x < sr.right) { scrollEl.scrollTop += dy; raf = requestAnimationFrame(paint); }
  }
  function onMove(e) {
    if (!drag) return;
    drag.x = e.clientX; drag.y = e.clientY;
    if (!drag.moved) {
      if (Math.hypot(drag.x - drag.x0, drag.y - drag.y0) < 5) return;
      drag.moved = true;
      closePop();
      setGhost();
    }
    if (e.cancelable) e.preventDefault();
    if (!raf) raf = requestAnimationFrame(paint);
  }
  function endDrag() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    if (ghost) { ghost.remove(); ghost = null; }
    document.body.classList.remove('cal-dragging');
    grid.querySelectorAll('.cal-cell.is-drop').forEach((n) => n.classList.remove('is-drop'));
    tray.classList.remove('is-drop');
    if (drag && drag.el) drag.el.classList.remove('is-drag');
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  function onCancel() { endDrag(); drag = null; }
  function onUp(e) {
    const d = drag;
    if (!d) return;
    if (d.moved) { d.x = e.clientX; d.y = e.clientY; paint(); }
    endDrag();
    drag = null;
    if (!d.moved) { openTask(d.t); return; }
    if (d.overTray) {
      if (d.tray) return;
      const was = { start_date: d.t.start_date, due_date: d.t.due_date };
      commit(d.t, { start_date: null, due_date: null });
      toast('Date cleared', null, { label: 'Undo', fn: () => commit(d.t, was) });
      return;
    }
    if (d.day == null) return;
    const patch = movePatch(d.t, d.tray ? null : d.grab, d.day);
    const was = {};
    for (const k of Object.keys(patch)) was[k] = d.t[k];
    if (Object.keys(patch).every((k) => patch[k] === was[k])) return;
    commit(d.t, patch);
  }

  /* ------------------------------------------------------------ add and day sheet */
  let popTok = null;
  function closePop() {
    if (pop.hidden) return;
    pop.hidden = true;
    scrim.hidden = true;
    pop.innerHTML = '';
    S.pop = null;
    if (popTok) { const t = popTok; popTok = null; t.done(); }
  }
  function dayTasks(day) {
    return visibleTasks().filter((t) => { const sp = span(t); return sp.s === sp.s && day >= sp.s && day <= sp.d; });
  }
  function openPop(day, anchor) {
    S.pop = { day };
    const list = day == null ? [] : dayTasks(day);
    pop.innerHTML =
      '<div class="cal-pop__h"><b>' + esc(day == null ? 'New task' : fmtLong(day)) + '</b><button type="button" class="cal-pop__x" data-act="popclose" aria-label="Close">' + ICON.x + '</button></div>' +
      (list.length ? '<ul class="cal-pop__list">' + list.map((t) => '<li><button type="button" data-act="popopen" data-id="' + esc(t.id) + '" data-pc="' + chipColor(t) + '"><i></i><span>' + esc(t.title) + '</span>' + (isDone(t) ? '<em>Done</em>' : '') + '</button></li>').join('') + '</ul>' : '') +
      '<form class="cal-pop__f" data-add="1">' +
      (day == null ? '<input type="date" name="date" aria-label="Due date" value="' + ymd(todayDn()) + '">' : '') +
      '<input type="text" name="title" maxlength="180" placeholder="Task name" aria-label="Task name" autocomplete="off"><button type="submit" class="pjv-btn pjv-btn--primary">Add</button></form>';
    pop.hidden = false;
    pop.classList.toggle('is-sheet', S.phone);
    scrim.hidden = !S.phone;
    if (!S.phone && anchor) {
      const mr = root.getBoundingClientRect();
      const ar = anchor.getBoundingClientRect();
      const pw = 320;
      let left = clamp(ar.left - mr.left, 8, Math.max(8, mr.width - pw - 8));
      let top = ar.bottom - mr.top + 4;
      const ph = pop.offsetHeight;
      if (top + ph > mr.height - 8) top = Math.max(8, ar.top - mr.top - ph - 4);
      pop.style.left = left + 'px';
      pop.style.top = top + 'px';
    } else { pop.style.left = ''; pop.style.top = ''; }
    if (S.phone && !popTok) popTok = trackOverlay(() => { popTok = null; closePop(); });
    const inp = pop.querySelector('input[name="title"]');
    if (inp) setTimeout(() => inp.focus(), 30);
  }
  async function submitAdd(f) {
    const title = f.elements.title.value.trim();
    if (!title) return;
    const day = S.pop && S.pop.day != null ? S.pop.day : dn(f.elements.date && f.elements.date.value);
    const body = { title };
    if (day === day) body.due_date = ymd(day);
    if (project) body.project_id = project.id;
    else if (ctx.user && ctx.user.email) body.owner_email = ctx.user.email;
    const btn = f.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const r = await createTask(api, body);
      const t = r.task || r;
      if (!t.project && project) t.project = { id: project.id, key: project.key, name: project.name, color: project.color };
      S.tasks.push(t); S.byId.set(t.id, t);
      render();
      if (S.pop && S.pop.day != null) { const keep = S.pop.day; const a = grid.querySelector('.cal-cell[data-day="' + keep + '"]'); openPop(keep, a); }
      else closePop();
      toast('Added ' + (body.due_date ? 'for ' + fmtShort(dn(body.due_date)) : ''));
    } catch (e) { btn.disabled = false; toast(msgOf(e), 'error'); }
  }

  /* ------------------------------------------------------------ events */
  function go(dir) {
    const p = parts(S.anchor);
    if (S.mode === 'month') S.anchor = mkDn(p.y, p.m + dir, 1);
    else S.anchor += dir * 7;
    S._scrolled = false;
    closePop();
    render();
  }
  root.querySelector('.pjv-bar').addEventListener('click', (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) { S.mode = m.dataset.mode; pf.set({ mode: S.mode }); S._scrolled = false; closePop(); render(); return; }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act;
    if (act === 'prev') go(-1);
    else if (act === 'next') go(1);
    else if (act === 'today') { S.anchor = todayDn(); S._scrolled = false; render(); }
    else if (act === 'done') { S.showDone = !S.showDone; a.setAttribute('aria-pressed', String(S.showDone)); pf.set({ showDone: S.showDone }); render(); }
    else if (act === 'tray') { S.tray = !S.tray; a.setAttribute('aria-pressed', String(S.tray)); pf.set({ tray: S.tray }); renderTray(); renderGrid(); }
    else if (act === 'addtop') openPop(null, a);
  });
  grid.addEventListener('pointerdown', onDown);
  tray.addEventListener('pointerdown', onDown);
  grid.addEventListener('click', (e) => {
    if (e.target.closest('.cal-chip')) return;
    const more = e.target.closest('.cal-more');
    if (more) { openPop(Number(more.dataset.day), more); return; }
    const cell = e.target.closest('.cal-cell');
    if (cell) openPop(Number(cell.dataset.day), cell);
  });
  // a click that ended a drag must not also open the task
  grid.addEventListener('click', (e) => { if (e.target.closest('.cal-chip') && e.detail === 0) { const t = S.byId.get(e.target.closest('.cal-chip').dataset.id); if (t) openTask(t); } });
  pop.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'popclose') closePop();
    else if (a.dataset.act === 'popopen') { const t = S.byId.get(a.dataset.id); closePop(); if (t) openTask(t); }
  });
  pop.addEventListener('submit', (e) => { e.preventDefault(); submitAdd(e.target); });
  scrim.addEventListener('click', closePop);
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !S.phone && !pop.contains(e.target) && !e.target.closest('.cal-cell, .cal-more, .cal-addbtn')) closePop(); }, true);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePop();
    else if ((e.key === 't' || e.key === 'T') && !e.target.closest('input, textarea, select')) { S.anchor = todayDn(); render(); }
  });
  agenda.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const row = a.closest('.ag-row');
    const t = row ? S.byId.get(row.dataset.id) : null;
    if (a.dataset.act === 'agopen' && t) openTask(t);
    else if (a.dataset.act === 'agdone' && t) toggleDone(t);
    else if (a.dataset.act === 'agadd') openPop(Number(a.dataset.day), a);
  });
  agenda.addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-act="agdate"]');
    if (!inp) return;
    const t = S.byId.get(inp.closest('.ag-row').dataset.id);
    const day = dn(inp.value);
    if (!t || day !== day) return;
    commit(t, movePatch(t, null, day));
  });
  const onResize = debounceRaf(() => { if (isPhone() !== S.phone) { closePop(); S._scrolled = false; } render(); });
  window.addEventListener('resize', onResize);

  async function load() {
    try {
      S.tasks = await loadTasks(api, project ? { project: project.key || project.id } : { owner: 'me' });
      S.error = '';
    } catch (e) { S.tasks = []; S.error = msgOf(e); }
    S.byId = new Map(S.tasks.map((t) => [t.id, t]));
    S.loaded = true;
    render();
    if (S.error) toast(S.error, 'error');
  }
  root.classList.add('is-loading');
  await load();
  root.classList.remove('is-loading');

  return {
    refresh: load,
    destroy() { unfit(); window.removeEventListener('resize', onResize); endDrag(); closePop(); host.innerHTML = ''; },
    state: S,
  };
}

if (typeof window !== 'undefined') {
  const fp = (window.FavorProjects = window.FavorProjects || {});
  fp.views = fp.views || {};
  fp.views.calendar = { mount };
}
