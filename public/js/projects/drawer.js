/* The task drawer: one panel for every task. A sheet on a phone (Back closes it), a panel on the right on desktop that opens over the page
   without moving it. Edits save the moment you make them; the composer, mention picker and people picker are the request board's. */
import { esc, icon, avatar, phone, toast, choose, openSheet, askText, dueLabel, ago, autosize, debounce, STATUS, PRIORITY, todayStr } from './ui-util.js';
import { api, Ctx, CODE_KINDS, personOf, Staff, loadStaff } from './ui-data.js';
import { pickOwner, pickDate, pickPriority, pickStatus, pickSection, pickCode, pickTask } from './ui-pickers.js';
import * as M from './ui-mentions.js';
import { dueHtml } from './ui-rows.js';

let el = null;
let st = null;
let tok = null;
let hooks = {};
let ret = null;
let main = null;
let solo = null;
let offs = [];
let kbBound = false;

export const drawerOpen = () => !!(el && el.classList.contains('is-open'));
export const currentTaskId = () => (st ? st.id : null);
export function setDrawerHooks(h) { hooks = h || {}; }

const refDate = (d) => dueLabel(d);
const nameOf = (email) => (email ? personOf(email).name : '');
const firstOf = (email) => nameOf(email).split(' ')[0];

function build() {
  el = document.createElement('div');
  el.className = 'pj-dr-wrap';
  el.innerHTML = `<div class="pj-dr__scrim" data-close></div>
  <aside class="pj-dr" role="dialog" aria-modal="true" aria-label="Task" tabindex="-1">
    <header class="pj-dr__bar">
      <a class="pj-dr__open" data-open-pj href="/projects/">Open in Projects</a>
      <span class="pj-dr__sp"></span>
      <button type="button" class="pj-dr__ib pj-dr__nav" data-a="prev" aria-label="Previous task">${icon('up')}</button>
      <button type="button" class="pj-dr__ib pj-dr__nav" data-a="next" aria-label="Next task">${icon('down')}</button>
      <button type="button" class="pj-dr__ib" data-a="more" aria-label="More">${icon('more')}</button>
      <button type="button" class="pj-dr__ib" data-close aria-label="Close">${icon('x')}</button>
    </header>
    <div class="pj-dr__scroll" data-scroll>
      <div class="pj-dr__crumb" data-crumb></div>
      <div class="pj-dr__trow"><button type="button" class="pj-check pj-dr__done" data-a="done"></button>
      <div class="pj-dr__title" data-title role="textbox" aria-label="Task title" aria-multiline="false" contenteditable="plaintext-only" spellcheck="true"></div></div>
      <div data-fields></div>
      <section class="pj-dr__sec"><h3 class="rt-h">Description</h3><div class="pj-dr__descview" data-descview tabindex="0" role="button" aria-label="Edit description"></div><textarea class="pj-dr__desc" data-desc rows="3" placeholder="Add details" aria-label="Description" hidden></textarea></section>
      <section class="pj-dr__sec" data-subs></section>
      <section class="pj-dr__sec" data-deps></section>
      <section class="pj-dr__sec" data-files></section>
      <section class="pj-dr__sec" data-pjl></section>
      <section class="pj-dr__sec"><h3 class="rt-h">Activity</h3><div class="rt-activity rt-ch" data-activity aria-live="polite"></div></section>
    </div>
    <footer class="rt-dfoot" data-comp></footer>
  </aside>`;
  document.body.appendChild(el);
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKey);
  const title = el.querySelector('[data-title]');
  title.addEventListener('input', () => { if (title.textContent.length > 300) title.textContent = title.textContent.slice(0, 300); });
  title.addEventListener('paste', (e) => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData('text').replace(/s+/g, ' '); document.execCommand('insertText', false, t); });
  title.addEventListener('blur', commitTitle);
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); title.blur(); } if (e.key === 'Escape' && title.textContent !== (st && st.task.title)) { e.stopPropagation(); title.textContent = st.task.title; title.blur(); } });
  const desc = el.querySelector('[data-desc]');
  const saveDesc = debounce(commitDesc, 900);
  desc.addEventListener('input', () => { autosize(desc); saveDesc(); });
  desc.addEventListener('blur', () => { saveDesc.cancel(); commitDesc(); desc.hidden = true; paintDesc(); });
  const view = el.querySelector('[data-descview]');
  const edit = () => { if (!st || !st.task) return; desc.value = st.task.description || ''; desc.hidden = false; autosize(desc); desc.focus(); };
  view.addEventListener('click', (e) => { if (!e.target.closest('a')) edit(); });
  view.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === view) { e.preventDefault(); edit(); } });
  desc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { /* closes the drawer; blur saves */ } });
  el._saveDesc = saveDesc;
  if (window.visualViewport && !kbBound) {
    kbBound = true;
    const fit = () => { const vv = window.visualViewport; el.style.setProperty('--pj-kb', Math.max(0, Math.round(innerHeight - vv.offsetTop - vv.height)) + 'px'); };
    window.visualViewport.addEventListener('resize', fit);
    window.visualViewport.addEventListener('scroll', fit);
  }
}

/* ---------------------------------------------------------------- open and close */
export async function openDrawer(ctx, ref, opts = {}) {
  if (!el) build();
  await Promise.all([M.ready(), loadStaff()]);
  main = ctx;
  const known = ctx && (ctx.by.get(ref) || [...ctx.by.values()].find((t) => t.code === ref));
  const wasOpen = drawerOpen();
  if (!wasOpen) ret = document.activeElement;
  detach();
  const id = known ? known.id : ref;
  st = { id, task: known || null, subtasks: [], comments: [], files: [], events: [], deps: { blockedBy: [], blocks: [] }, people: [], loaded: false, token: Math.random(), parentRef: null, sections: ctx && ctx.sections && ctx.project && known && known.project_id === ctx.project.id ? ctx.sections : null };
  const tokenNow = st.token;
  if (known) paintAll();
  else { paintLoading(); }
  if (!wasOpen) show();
  try {
    const d = await api.task(ref);
    if (!st || st.token !== tokenNow) return;
    st.id = d.task.id;
    if (known && known.id === d.task.id) Object.assign(known, d.task); else st.task = d.task;
    st.task = known && known.id === d.task.id ? known : d.task;
    st.subtasks = d.subtasks || [];
    st.comments = d.comments || [];
    st.files = d.files || [];
    st.events = d.events || [];
    st.deps = d.deps || { blockedBy: [], blocks: [] };
    st.people = d.people || [];
    st.loaded = true;
    solo = new Ctx('solo');
    solo.tasks = [st.task, ...st.subtasks];
    solo.by = new Map(solo.tasks.map((t) => [t.id, t]));
    solo.sections = ctx && ctx.sections ? ctx.sections : [];
    solo.project = ctx && ctx.project;
    offs.push(solo.on(() => { if (main && main.by.has(st.id)) main.emit('patch'); refresh(); }));
    if (main) offs.push(main.on(() => { if (!st) return; const t = main.by.get(st.id); if (t) { st.task = t; if (solo.by.has(t.id)) solo.by.set(t.id, t); } refresh(); }));
    if (!st.sections && st.task.project_id) { api.project(st.task.project_id).then((p) => { if (st && st.id === d.task.id) { st.sections = p.sections || []; solo.sections = st.sections; refresh(); } }).catch(() => {}); }
    paintAll();
    if (hooks.open) hooks.open(st.task);
  } catch (e) {
    if (!st || st.token !== tokenNow) return;
    paintError(e);
  }
}
function detach() { offs.forEach((f) => f()); offs = []; }

function show() {
  el.classList.add('is-open');
  document.documentElement.classList.add('pj-dr-open');
  if (window.hubOv && !tok) tok = window.hubOv.on(() => { tok = null; close(true); });
  addEventListener('keydown', gkey, true);
  requestAnimationFrame(() => { const p = el.querySelector('.pj-dr'); if (p && !el.contains(document.activeElement)) p.focus({ preventScroll: true }); });
}
export function closeDrawer() { close(false); }
function close(fromBack) {
  if (!el || !el.classList.contains('is-open')) return;
  flush();
  el.classList.remove('is-open');
  document.documentElement.classList.remove('pj-dr-open');
  removeEventListener('keydown', gkey, true);
  if (tok && window.hubOv) { const t = tok; tok = null; window.hubOv.off(t); }
  detach();
  const id = st && st.id;
  st = null;
  if (hooks.close) hooks.close(id);
  if (ret && ret.focus && document.contains(ret)) { try { ret.focus({ preventScroll: true }); } catch (_) { /* gone */ } }
  const row = id && document.querySelector(`.pj-row[data-id="${CSS.escape(id)}"], .pj-card[data-id="${CSS.escape(id)}"]`);
  if (row && !ret) row.focus({ preventScroll: true });
}
function flush() { if (!el || !st) return; commitTitle(); if (el._saveDesc) { el._saveDesc.cancel(); } commitDesc(); }

/* ---------------------------------------------------------------- painting */
function paintLoading() {
  el.querySelector('[data-title]').textContent = '';
  el.querySelector('[data-fields]').innerHTML = '<div class="pj-skel pj-skel--drawer" aria-busy="true"><i></i><i></i><i></i><i></i></div>';
  for (const k of ['subs', 'deps', 'files']) el.querySelector(`[data-${k}]`).innerHTML = '';
  el.querySelector('[data-activity]').innerHTML = '';
  el.querySelector('[data-comp]').innerHTML = '';
  el.querySelector('[data-crumb]').innerHTML = '';
  el.querySelector('[data-desc]').value = '';
  el.querySelector('[data-descview]').innerHTML = '';
  paintBar();
}
function paintError(e) {
  el.querySelector('[data-fields]').innerHTML = `<div class="pj-empty pj-empty--err"><p>${esc(e.status === 403 || e.status === 404 ? 'Not available to you.' : e.message || 'This task did not load.')}</p>${e.status === 403 || e.status === 404 ? '' : '<button type="button" class="pj-btn" data-a="retry">Try again</button>'}</div>`;
}
function paintAll() {
  if (!st || !st.task) return;
  const t = st.task;
  const title = el.querySelector('[data-title]');
  if (document.activeElement !== title) title.textContent = t.title;
  const desc = el.querySelector('[data-desc]');
  if (document.activeElement !== desc) { desc.value = t.description || ''; desc.hidden = true; }
  paintDesc();
  el.querySelector('[data-crumb]').innerHTML = crumbHtml();
  paintBar();
  paintFields();
  paintSubs();
  paintDeps();
  paintFiles();
  paintLinks(); // links hook: Chat, Drive, clips, expense request, calendar (public/js/projects/links.js)
  paintActivity();
  paintComposer();
}
function refresh() {
  if (!st || !st.task || !el) return;
  const t = st.task;
  const title = el.querySelector('[data-title]');
  if (document.activeElement !== title && title.textContent !== t.title) title.textContent = t.title;
  paintBar(); paintFields(); paintSubs(); paintDeps();
}
const projectUrl = (t) => (t.project && t.code ? '/projects/p/?p=' + encodeURIComponent(t.project.key) + '&t=' + encodeURIComponent(t.code) : '/projects/?t=' + encodeURIComponent(t.id));
const SRC_SENTENCE = /^From the meeting [^\n]*?:[ \t]*https?:\/\/\S+[ \t]*\n?/i;
function shortLink(u) {
  try { const x = new URL(u); const h = x.hostname.replace(/^www\./, ''); return x.pathname.length > 1 ? h + '/…' : h; } catch (_) { return u; }
}
function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => { const raw = u.replace(/&amp;/g, '&'); return '<a href="' + u + '" target="_blank" rel="noopener noreferrer" title="' + u + '">' + esc(shortLink(raw)) + '</a>'; });
}
function paintDesc() {
  const view = el.querySelector('[data-descview]');
  const t = st && st.task;
  if (!view || !t) return;
  const raw = t.description || '';
  const shown = (t.source ? raw.replace(SRC_SENTENCE, '') : raw).trim();
  view.innerHTML = shown ? linkify(shown) : '<span class="pj-quiet">Add details</span>';
}
function crumbHtml() {
  const t = st.task;
  const parts = [];
  if (t.parent_id && st.parentRef) parts.push(`<button type="button" class="pj-crumb__up" data-a="parent">${icon('up')}${esc(st.parentRef.code || 'Parent task')}</button>`);
  if (t.code) parts.push(`<button type="button" class="pj-code-id pj-code-id--btn" data-a="copy" draggable="true" data-task-drag title="Copy a link to this task, or drag it into an email">${esc(t.code)}${icon('copy')}</button>`);
  if (t.source && typeof t.source.url === 'string' && t.source.url.charAt(0) === '/') parts.push(`<a class="pj-src" href="${esc(t.source.url)}">${icon('link')}<span>${esc(t.source.label)}</span></a>`);
  return parts.join('');
}
function paintBar() {
  const t = st && st.task;
  const b = el.querySelector('[data-a="done"]');
  const open = el.querySelector('[data-open-pj]');
  if (!t) { b.innerHTML = ''; open.hidden = true; return; }
  const done = t.status === 'done';
  b.className = 'pj-check pj-dr__done' + (done ? ' is-on' : '');
  b.innerHTML = icon('check');
  b.setAttribute('role', 'checkbox');
  b.setAttribute('aria-checked', String(done));
  b.setAttribute('aria-label', done ? 'Mark not done' : 'Mark complete');
  open.href = projectUrl(t);
  open.hidden = location.pathname.indexOf('/projects') === 0;
  const ids = orderIds();
  const i = ids.indexOf(t.id);
  el.querySelector('[data-a="prev"]').disabled = i <= 0;
  el.querySelector('[data-a="next"]').disabled = i < 0 || i >= ids.length - 1;
  el.querySelector('.pj-dr__nav').hidden = ids.length < 2;
  el.querySelector('[data-a="next"]').hidden = ids.length < 2;
}
function orderIds() {
  if (!main) return [];
  if (main.kind === 'project') { const g = main.grouped(); const out = []; for (const arr of g.values()) arr.forEach((t) => out.push(t.id)); return out; }
  return main.tasks.filter((t) => main.matches(t)).map((t) => t.id);
}

const dateBtn = (field, label, v, extra = '') => `<button type="button" class="rt-pchip pj-fbtn${v ? '' : ' is-empty'}" data-f="${field}" aria-label="${esc(label)}: ${v ? esc(dueLabel(v)) : 'No date'}">${icon('cal')}<span>${v ? esc(dueLabel(v)) : 'No date'}</span></button>${v ? `<button type="button" class="pj-fclear" data-f="${field}-clear" aria-label="Clear ${esc(label.toLowerCase())}">${icon('x')}</button>` : ''}${extra}`;

function paintFields() {
  const t = st.task;
  const late = t.overdue;
  const owner = t.owner_email ? `<button type="button" class="rt-pchip" data-f="owner">${avatar(t.owner, '')}<span class="rt-pchip__t"><b>${esc(t.owner ? t.owner.name : nameOf(t.owner_email))}</b></span></button>` : `<button type="button" class="rt-pchip pj-fbtn is-empty" data-f="owner">${avatar(null)}<span>Unassigned</span></button>`;
  const waitName = t.waiting_on_email ? nameOf(t.waiting_on_email) : '';
  const follow = st.people.filter((p) => p.email !== t.owner_email);
  const sec = st.sections ? (st.sections.find((s) => s.id === t.section_id) || {}).name : t.section;
  const codes = CODE_KINDS.map((k) => `<button type="button" class="pj-codebtn${t[k.field] ? ' is-set' : ''}" data-f="code" data-kind="${k.kind}" data-field="${k.field}"><small>${esc(k.label)}</small><b>${t[k.field] ? esc(t[k.field]) : 'Add'}</b></button>`).join('');
  const proj = t.project ? '<span class="rt-pstatic"><i class="pj-dot" data-c="' + esc(t.project.color) + '"></i><span>' + esc(t.project.name) + '</span></span>' : '<span class="rt-pstatic"><span>Personal task</span></span>';
  const asana = typeof t.asana_url === 'string' && /^https?:[/][/]/i.test(t.asana_url) ? '<div class="rt-field"><dt>Asana</dt><dd><span class="pj-asana">Synced with Asana<a href="' + esc(t.asana_url) + '" target="_blank" rel="noopener noreferrer">Open in Asana</a></span></dd></div>' : '';
  const timeBits = t.due_date ? (t.due_time ? '<input type="time" class="rt-date pj-time" data-f="time" value="' + esc(t.due_time) + '" aria-label="Due time (Eastern)" /><button type="button" class="pj-fclear" data-f="time-clear" aria-label="Clear the time">' + icon('x') + '</button>' : '<button type="button" class="rt-pchip pj-fbtn is-empty" data-f="time-add">' + icon('clock') + '<span>Add time</span></button>') : '';
  const waiting = t.waiting_on_email ? '<button type="button" class="rt-pchip" data-f="waiting">' + avatar(personOf(t.waiting_on_email)) + '<span class="rt-pchip__t"><b>' + esc(waitName) + '</b></span></button><button type="button" class="pj-fclear" data-f="waiting-clear" aria-label="Clear waiting on">' + icon('x') + '</button>' : '<button type="button" class="rt-pchip pj-fbtn is-empty" data-f="waiting">' + icon('hourglass') + '<span>Nobody</span></button>';
  const follows = follow.map((p) => '<span class="pj-fchip" title="' + esc(p.name) + '">' + avatar(p) + '<span>' + esc(p.name.split(' ')[0]) + '</span><button type="button" data-f="unfollow" data-email="' + esc(p.email) + '" aria-label="Stop ' + esc(p.name) + ' following">' + icon('x') + '</button></span>').join('');
  const pri = (t.priority === 'normal' ? icon('flag') : '<span class="pj-pri pj-pri--' + t.priority + '">' + icon('flag') + '</span>') + '<span>' + esc(PRIORITY[t.priority] || 'Normal') + '</span>';
  const h = '<dl class="rt-fields pj-fields">' +
    '<div class="rt-field"><dt>Assignee</dt><dd>' + owner + '</dd></div>' +
    '<div class="rt-field"><dt>Due</dt><dd>' + dateBtn('due', 'Due date', t.due_date) + timeBits + (late ? '<span class="pj-late">Overdue</span>' : '') + '</dd></div>' +
    '<div class="rt-field"><dt>Project</dt><dd>' + proj + '</dd></div>' +
    (t.project_id ? '<div class="rt-field"><dt>Section</dt><dd><button type="button" class="rt-pchip pj-fbtn' + (sec ? '' : ' is-empty') + '" data-f="section">' + icon('list') + '<span>' + esc(sec || 'No section') + '</span></button></dd></div>' : '') +
    '<div class="rt-field"><dt>Priority</dt><dd><button type="button" class="rt-pchip pj-fbtn" data-f="priority">' + pri + '</button></dd></div>' +
    '<div class="rt-field"><dt>Status</dt><dd><button type="button" class="rt-pchip pj-fbtn" data-f="status"><i class="pj-sdot" data-s="' + esc(t.status) + '"></i><span>' + esc(STATUS[t.status] || t.status) + '</span></button></dd></div>' +
    asana + '</dl>' +
    '<details class="pj-more"><summary>More fields</summary><dl class="rt-fields pj-fields">' +
    '<div class="rt-field"><dt>Start</dt><dd>' + dateBtn('start', 'Start date', t.start_date) + '</dd></div>' +
    '<div class="rt-field"><dt>Waiting on</dt><dd>' + waiting + '</dd></div>' +
    '<div class="rt-field"><dt>Following</dt><dd class="pj-follow">' + follows + '<button type="button" class="rt-pchip pj-fbtn is-empty" data-f="follow">' + icon('plus') + '<span>Add</span></button></dd></div>' +
    '<div class="rt-field rt-field--codes"><dt>Codes</dt><dd class="pj-codegrid">' + codes + '</dd></div>' +
    '</dl></details>';
  const box = el.querySelector('[data-fields]');
  const open = box.querySelector('.pj-more') && box.querySelector('.pj-more').open;
  if (box._h !== h) { box.innerHTML = h; box._h = h; if (open) box.querySelector('.pj-more').open = true; }
}

function subRow(s) {
  const done = s.status === 'done';
  return `<div class="pj-sub${done ? ' is-done' : ''}${s.pending ? ' is-pending' : ''}" data-sid="${esc(s.id)}"><button type="button" class="pj-check${done ? ' is-on' : ''}" data-a="subdone" role="checkbox" aria-checked="${done}" aria-label="${done ? 'Mark not done' : 'Mark done'}: ${esc(s.title)}">${icon('check')}</button><button type="button" class="pj-sub__t" data-a="subopen">${esc(s.title)}</button>${s.due_date ? dueHtml(s) : ''}${s.owner ? avatar(s.owner) : ''}</div>`;
}
function paintSubs() {
  const box = el.querySelector('[data-subs]');
  const t = st.task;
  if (t.parent_id) { box.innerHTML = ''; box._h = ''; return; }
  const done = st.subtasks.filter((s) => s.status === 'done').length;
  const h = `<h3 class="rt-h">Subtasks${st.subtasks.length ? ` <span class="pj-h-n">${done}/${st.subtasks.length}</span>` : ''}</h3><div class="pj-subs">${st.subtasks.map(subRow).join('')}</div><form class="pj-add pj-add--sub" autocomplete="off"><span class="pj-add__plus">${icon('plus')}</span><input class="pj-add__in" type="text" maxlength="300" placeholder="Add a subtask" aria-label="Add a subtask" enterkeyhint="done" /></form>`;
  if (box._h === h) return;
  const f = box.querySelector('.pj-add__in');
  const keep = f && document.activeElement === f ? f.value : null;
  box.innerHTML = h;
  box._h = h;
  if (keep !== null) { const n = box.querySelector('.pj-add__in'); n.value = keep; n.focus({ preventScroll: true }); }
}
function depRow(d, removable) {
  return `<div class="pj-dep"><span class="pj-dep__s ${d.status === 'done' ? 'is-done' : ''}">${icon(d.status === 'done' ? 'check' : 'block')}</span><button type="button" class="pj-dep__t" data-a="depopen" data-ref="${esc(d.id || d.code)}">${d.code ? `<span class="pj-code-id">${esc(d.code)}</span>` : ''}${esc(d.title)}</button>${removable ? `<button type="button" class="pj-fclear" data-a="depdel" data-id="${esc(d.id)}" aria-label="Remove this dependency">${icon('x')}</button>` : ''}</div>`;
}
function paintDeps() {
  const box = el.querySelector('[data-deps]');
  const by = st.deps.blockedBy || [];
  const bl = st.deps.blocks || [];
  const h = `<h3 class="rt-h">Dependencies</h3>${by.length ? `<p class="pj-dep__h">Blocked by</p>${by.map((d) => depRow(d, true)).join('')}` : ''}${bl.length ? `<p class="pj-dep__h">Blocking</p>${bl.map((d) => depRow(d, false)).join('')}` : ''}<button type="button" class="rt-pchip pj-fbtn is-empty" data-a="depadd">${icon('plus')}<span>Add a task this waits on</span></button>`;
  if (box._h !== h) { box.innerHTML = h; box._h = h; }
}
function paintLinks() {
  const box = el.querySelector('[data-pjl]');
  if (!box || api.mock || !st || !st.task) return;
  const ref = st.task.code || st.task.id;
  if (box._ref === ref) return;
  box._ref = ref;
  box.innerHTML = `<h3 class="rt-h">Links</h3><div data-pj-links data-task="${esc(ref)}"></div>`;
}
function paintFiles() {
  const box = el.querySelector('[data-files]');
  const rows = st.files.map((f) => `<div class="pj-file"><span class="pj-file__i">${icon(f.kind === 'link' ? 'link' : 'file')}</span>${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a>` : `<span>${esc(f.name)}</span>`}<span class="pj-file__k">${esc(f.kind === 'upload' ? 'File' : f.kind === 'drive' ? 'Drive' : f.kind === 'clip' ? 'Clip' : 'Link')}</span><button type="button" class="pj-fclear" data-a="filedel" data-id="${esc(f.id)}" aria-label="Remove ${esc(f.name)}">${icon('x')}</button></div>`).join('');
  box.innerHTML = `<h3 class="rt-h">Files</h3>${rows}<div class="pj-filebar"><button type="button" class="rt-pchip pj-fbtn is-empty" data-a="fileup">${icon('plus')}<span>Upload a file</span></button><button type="button" class="rt-pchip pj-fbtn is-empty" data-a="filelink">${icon('link')}<span>Add a link</span></button><input type="file" hidden data-fileinput multiple /></div>`;
}

/* ---------------------------------------------------------------- activity */
function eventText(e) {
  let d = e.detail;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { d = {}; } }
  d = d || {};
  const who = esc(nameOf(e.actor_email) || 'Someone');
  switch (e.kind) {
    case 'created': return `${who} made this task`;
    case 'done': return `${who} completed this`;
    case 'reopened': return `${who} reopened this`;
    case 'status': return `${who} set the status to ${esc(STATUS[d.to] || d.to || '')}`;
    case 'owner': return d.to ? `${who} assigned it to <b>${esc(nameOf(d.to))}</b>` : `${who} removed the owner`;
    case 'due': return d.to ? `${who} set ${d.field === 'start_date' ? 'the start' : 'the due date'} to ${esc(refDate(d.to))}` : `${who} cleared ${d.field === 'start_date' ? 'the start date' : 'the due date'}`;
    case 'move': return `${who} moved it${d.section_id ? '' : ' out of its section'}`;
    case 'file': return `${who} attached ${esc(d.name || 'a file')}`;
    case 'dep': return `${who} changed what this waits on`;
    case 'edit': { const f = { title: 'the title', priority: 'the priority', description: 'the description', appeal_code: 'the appeal code', source_code: 'the source code', fund_code: 'the fund code', campaign_code: 'the campaign code', waiting_on_email: 'who it waits on' }[d.field]; return `${who} changed ${f || 'a detail'}`; }
    default: return `${who} · ${esc(e.kind)}`;
  }
}
function paintActivity() {
  const box = el.querySelector('[data-activity]');
  const me = Staff.me;
  const RT = window.ReqTasks;
  const items = [];
  for (const c of st.comments) if (!c.deleted_at) items.push({ at: c.created_at, c });
  for (const e of st.events) if (!['mention', 'comment'].includes(e.kind)) items.push({ at: e.created_at, e });
  items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.e ? -1 : 1));
  let prev = null;
  box.innerHTML = items.map((it) => {
    if (it.e) { prev = null; return `<div class="rt-event"><span>${eventText(it.e)}</span><time>${esc(ago(it.e.created_at))}</time></div>`; }
    const c = it.c;
    const cont = prev && prev.author_email === c.author_email && Date.parse(c.created_at) - Date.parse(prev.created_at) < 5 * 60000;
    prev = c;
    const name = nameOf(c.author_email);
    const gut = cont ? '' : RT.avatar(c.author_email);
    const meta = cont ? '' : `<div class="ch-msg__meta"><span class="ch-msg__name">${esc(name)}</span>${c.source === 'chat' ? '<span class="ch-tag rt-tag">Chat</span>' : ''}<span class="ch-msg__time">${esc(ago(c.created_at))}</span></div>`;
    const del = c.author_email === me && !String(c.id).startsWith('tmp-') ? `<div class="ch-bar" role="toolbar" aria-label="Comment actions"><button type="button" data-a="cdel" data-id="${esc(c.id)}" aria-label="Delete">${icon('trash')}</button></div>` : '';
    return `<article class="ch-msg${cont ? ' ch-msg--cont' : ''}${String(c.id).startsWith('tmp-') ? ' is-pending' : ''}" data-cid="${esc(c.id)}"><div class="ch-msg__gut">${gut}</div><div class="ch-msg__body">${meta}<div class="ch-msg__text">${M.fmt(c.body, me)}</div></div>${del}</article>`;
  }).join('') || '<p class="pj-quiet">No activity yet.</p>';
}
function paintComposer() {
  const box = el.querySelector('[data-comp]');
  if (box._for === st.id) return;
  box._for = st.id;
  box.innerHTML = M.composerHtml();
  M.bindComposer(box, async (text) => {
    const id = st.id;
    const tmp = { id: 'tmp-' + Math.random().toString(36).slice(2), task_id: id, author_email: Staff.me, body: text, mentions: M.mentionsIn(text), source: 'hub', created_at: new Date().toISOString() };
    st.comments.push(tmp);
    paintActivity();
    scrollActivity();
    try {
      const d = await api.comment(id, { body: text, mentions: tmp.mentions });
      if (d.comment) Object.assign(tmp, d.comment);
      if (st && st.id === id) { paintActivity(); const t = st.task; t.comments = (t.comments || 0) + 1; if (main) main.emit('patch'); }
    } catch (e) {
      const i = st ? st.comments.indexOf(tmp) : -1;
      if (i >= 0) st.comments.splice(i, 1);
      if (st) paintActivity();
      toast(e.message || 'The comment did not send.', { error: true });
      throw e;
    }
  });
}
function scrollActivity() { const s = el.querySelector('[data-scroll]'); requestAnimationFrame(() => { s.scrollTop = s.scrollHeight; }); }

/* ---------------------------------------------------------------- saving */
const ctxFor = (id) => (main && main.by.has(id) ? main : solo);
function upd(body, opts) {
  if (!st || !st.task) return Promise.resolve(false);
  const c = ctxFor(st.id);
  return c.patch(st.id, body, opts).then((ok) => { if (ok) refreshEvents(); return ok; });
}
const refreshEvents = debounce(async () => {
  if (!st) return;
  const id = st.id;
  try { const d = await api.task(id); if (!st || st.id !== id) return; st.events = d.events || []; st.comments = d.comments || st.comments; paintActivity(); } catch (_) { /* the next change will try again */ }
}, 700);
function commitTitle() {
  if (!st || !st.task) return;
  const v = el.querySelector('[data-title]').textContent.trim();
  if (!v) { el.querySelector('[data-title]').textContent = st.task.title; return; }
  if (v !== st.task.title) upd({ title: v });
}
function commitDesc() {
  if (!st || !st.task) return;
  const v = el.querySelector('[data-desc]').value;
  if (v !== (st.task.description || '')) upd({ description: v }, { quiet: false });
}

/* ---------------------------------------------------------------- events */
async function onClick(e) {
  if (e.target.closest('[data-close]')) { close(false); return; }
  const a = e.target.closest('[data-a]');
  const f = e.target.closest('[data-f]');
  if (a) return action(a, e);
  if (f && st && st.task) return field(f);
}
async function action(a, e) {
  const k = a.dataset.a;
  const t = st && st.task;
  if (k === 'retry') { openDrawer(main, st.id); return; }
  if (!t) return;
  if (k === 'done') { upd({ done: t.status !== 'done' }); return; }
  if (k === 'prev' || k === 'next') { stepTask(k === 'next' ? 1 : -1); return; }
  if (k === 'more') { more(a); return; }
  if (k === 'copy') { copyLink(); return; }
  if (k === 'parent') { if (t.parent_id) openDrawer(main, t.parent_id); return; }
  if (k === 'subdone') { const id = a.closest('[data-sid]').dataset.sid; const s = st.subtasks.find((x) => x.id === id); if (s) { await solo.patch(id, { done: s.status !== 'done' }); const done = st.subtasks.filter((x) => x.status === 'done').length; t.subtasks = { done, total: st.subtasks.length }; if (main) main.emit('patch'); } return; }
  if (k === 'subopen') { const id = a.closest('[data-sid]').dataset.sid; const s = st.subtasks.find((x) => x.id === id); if (s) { const parent = t; await openDrawer(main, id); if (st) st.parentRef = parent; if (st && el) { el.querySelector('[data-crumb]').innerHTML = crumbHtml(); } } return; }
  if (k === 'depopen') { openDrawer(main, a.dataset.ref); return; }
  if (k === 'depadd') {
    const r = await pickTask({ anchor: a, title: 'This task waits on', exclude: [t.id, ...(st.deps.blockedBy || []).map((d) => d.id)] });
    if (!r) return;
    const ref = { id: r.id, code: r.code, title: r.title, status: r.status };
    st.deps.blockedBy.push(ref); paintDeps(); t.blocked = r.status !== 'done' || t.blocked; if (main) main.emit('patch');
    try { await api.deps(t.id, { add: [r.id] }); refreshEvents(); } catch (err) { st.deps.blockedBy.splice(st.deps.blockedBy.indexOf(ref), 1); paintDeps(); toast(err.message, { error: true }); }
    return;
  }
  if (k === 'depdel') {
    const id = a.dataset.id; const i = st.deps.blockedBy.findIndex((d) => d.id === id); if (i < 0) return;
    const [gone] = st.deps.blockedBy.splice(i, 1); paintDeps();
    try { await api.deps(t.id, { remove: [id] }); } catch (err) { st.deps.blockedBy.splice(i, 0, gone); paintDeps(); toast(err.message, { error: true }); }
    return;
  }
  if (k === 'filelink') {
    const url = await askText({ title: 'Add a link', label: 'Address', placeholder: 'https://', action: 'Add' });
    if (!url) return;
    const link = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    const name = await askText({ title: 'Name the link', label: 'Name', value: link.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60), action: 'Add' });
    if (!name) return;
    try { const d = await api.addFile(t.id, { kind: 'link', name, url: link }); st.files.push(d.file || { id: 'f' + Date.now(), kind: 'link', name, url: link }); t.files = st.files.length; paintFiles(); if (main) main.emit('patch'); } catch (err) { toast(err.message, { error: true }); }
    return;
  }
  if (k === 'fileup') { el.querySelector('[data-fileinput]').click(); return; }
  if (k === 'filedel') {
    const id = a.dataset.id; const i = st.files.findIndex((x) => x.id === id); if (i < 0) return;
    const [gone] = st.files.splice(i, 1); t.files = st.files.length; paintFiles(); if (main) main.emit('patch');
    try { await api.deleteFile(t.id, id); } catch (err) { st.files.splice(i, 0, gone); t.files = st.files.length; paintFiles(); toast(err.message, { error: true }); }
    return;
  }
  if (k === 'cdel') {
    const id = a.dataset.id; const c = st.comments.find((x) => x.id === id); if (!c) return;
    c.deleted_at = new Date().toISOString(); paintActivity();
    try { await api.deleteComment(t.id, id); t.comments = Math.max(0, (t.comments || 1) - 1); if (main) main.emit('patch'); } catch (err) { c.deleted_at = null; paintActivity(); toast(err.message, { error: true }); }
  }
}
async function field(f) {
  const t = st.task;
  const k = f.dataset.f;
  if (k === 'owner') { const r = await pickOwner({ title: 'Assign to', current: t.owner_email }); if (r) upd({ owner_email: r.email }); return; }
  if (k === 'due') { const v = await pickDate({ anchor: f, value: t.due_date, title: 'Due date' }); if (v !== undefined) upd(v ? { due_date: v } : { due_date: null, due_time: null }); return; }
  if (k === 'time-clear') { upd({ due_time: null }); return; }
  if (k === 'time-add') { const v = await askTime(f); if (v) upd({ due_time: v }); return; }
  if (k === 'due-clear') { upd({ due_date: null, due_time: null }); return; }
  if (k === 'start') { const v = await pickDate({ anchor: f, value: t.start_date, title: 'Start date' }); if (v !== undefined) upd({ start_date: v }); return; }
  if (k === 'start-clear') { upd({ start_date: null }); return; }
  if (k === 'priority') { const v = await pickPriority({ anchor: f, value: t.priority }); if (v) upd({ priority: v }); return; }
  if (k === 'status') { const v = await pickStatus({ anchor: f, value: t.status }); if (!v || v === t.status) return; if (v === 'done') upd({ done: true }); else if (t.status === 'done') { await upd({ done: false }); if (v !== 'open') upd({ status: v }); } else upd({ status: v }); return; }
  if (k === 'section') { const secs = st.sections || (main && main.sections) || []; const v = await pickSection({ anchor: f, sections: secs, value: t.section_id }); if (v !== undefined && (v || null) !== (t.section_id || null)) { const c = ctxFor(t.id); c.move(t.id, { section_id: v }); } return; }
  if (k === 'waiting') { const r = await pickOwner({ title: 'Waiting on', current: t.waiting_on_email, clear: 'Nobody' }); if (r) upd({ waiting_on_email: r.email }); return; }
  if (k === 'waiting-clear') { upd({ waiting_on_email: null }); return; }
  if (k === 'code') { const kind = f.dataset.kind; const field = f.dataset.field; const v = await pickCode({ anchor: f, kind, value: t[field] }); if (v !== undefined) upd({ [field]: v }); return; }
  if (k === 'follow') {
    const r = await pickOwner({ title: 'Add a follower', clear: '', exclude: [t.owner_email, ...st.people.map((p) => p.email)].filter(Boolean) });
    if (!r || !r.email) return;
    const p = personOf(r.email);
    st.people.push(p); paintFields();
    try { await api.people(t.id, { add: [{ email: r.email, role: 'follower' }] }); } catch (err) { st.people = st.people.filter((x) => x.email !== r.email); paintFields(); toast(err.message, { error: true }); }
    return;
  }
  if (k === 'unfollow') {
    const email = f.dataset.email; const p = st.people.find((x) => x.email === email); if (!p) return;
    st.people = st.people.filter((x) => x.email !== email); paintFields();
    try { await api.people(t.id, { remove: [{ email, role: 'follower' }] }); } catch (err) { st.people.push(p); paintFields(); toast(err.message, { error: true }); }
  }
}
// The time field and the file input are real inputs, so they report through change.
document.addEventListener('change', (e) => {
  if (!el || !st || !el.contains(e.target)) return;
  const tm = e.target.closest('[data-f="time"]');
  if (tm) { upd({ due_time: tm.value || null }); return; }
  const fi = e.target.closest('[data-fileinput]');
  if (fi && fi.files.length) uploadFiles([...fi.files]).then(() => { fi.value = ''; });
});
async function uploadFiles(files) {
  const t = st.task;
  for (const file of files) {
    if (file.size > 25 * 1024 * 1024) { toast(file.name + ' is over 25 MB.', { error: true }); continue; }
    try { const d = await api.upload(t.id, file); st.files.push(d.file || { id: 'f' + Date.now(), kind: 'upload', name: file.name, url: '' }); t.files = st.files.length; paintFiles(); if (main) main.emit('patch'); } catch (err) { toast(err.message, { error: true }); }
  }
}
document.addEventListener('submit', async (e) => {
  const f = e.target.closest && e.target.closest('.pj-add--sub');
  if (!f || !el || !el.contains(f) || !st) return;
  e.preventDefault();
  const inp = f.querySelector('input');
  const title = inp.value.trim();
  if (!title) return;
  inp.value = '';
  const t = st.task;
  const tmp = { id: 'tmp-' + Math.random().toString(36).slice(2), title, status: 'open', parent_id: t.id, owner: null, pending: true, project_id: t.project_id, section_id: t.section_id, sort: 0, priority: 'normal' };
  st.subtasks.push(tmp); solo.tasks.push(tmp); solo.by.set(tmp.id, tmp); paintSubs();
  inp.focus({ preventScroll: true });
  try {
    const d = await api.createTask({ title, parent_id: t.id, project_id: t.project_id || undefined, section_id: t.section_id || undefined });
    solo.by.delete(tmp.id);
    Object.assign(tmp, d.task, { pending: false });
    solo.by.set(tmp.id, tmp);
    t.subtasks = { done: st.subtasks.filter((x) => x.status === 'done').length, total: st.subtasks.length };
    paintSubs(); if (main) main.emit('patch');
  } catch (err) {
    st.subtasks.splice(st.subtasks.indexOf(tmp), 1); solo.by.delete(tmp.id); paintSubs();
    toast(err.message + ' "' + title.slice(0, 40) + '" was removed.', { error: true });
  }
});

async function more(anchor) {
  const t = st.task;
  // Find a time and a clip reply come from integrations.js (window.FavorIx) when it is on the page; Send to email from the composer.
  const ix = window.FavorIx;
  const items = [{ value: 'copy', label: 'Copy link', icon: 'copy' }]
    .concat(ix ? [{ value: 'meet', label: 'Find a time', icon: 'clock' }] : [])
    .concat(ix && ix.clipReply ? [{ value: 'clip', label: 'Reply with a clip', icon: 'send' }] : [])
    .concat(window.FavorCompose && document.documentElement.classList.contains('has-mail') ? [{ value: 'email', label: 'Send to email', icon: 'send' }] : [])
    .concat(window.FavorHandoff ? [{ value: 'handoff', label: 'Hand off', icon: 'user' }] : [])
    .concat([{ value: 'del', label: 'Remove task', icon: 'trash' }]);
  const v = await choose({ anchor, title: 'Task', items });
  if (v === 'meet' && ix) ix.findTime({ kind: 'task', ref: t.id });
  if (v === 'clip' && ix && ix.clipReply) ix.clipReply({ kind: 'task', ref: t.id, title: t.title });
  if (v === 'copy') copyLink();
  if (v === 'email') window.FavorCompose.add(taskItem(t));
  if (v === 'handoff') window.FavorHandoff.open({ kind: 'task', id: t.id, title: t.title || '' });
  if (v === 'del') { const c = ctxFor(t.id); close(false); if (c === main) await main.remove([t.id]); else { try { await api.deleteTask(t.id); toast('Task removed'); } catch (err) { toast(err.message, { error: true }); } } }
}
// Dragging the task code into an email draft adds the task as a link.
document.addEventListener('dragstart', (e) => {
  const chip = e.target.closest && e.target.closest('[data-task-drag]');
  if (!chip || !e.dataTransfer || !st || !st.task) return;
  const it = taskItem(st.task);
  e.dataTransfer.setData('application/x-favoros-item', JSON.stringify(it));
  e.dataTransfer.setData('text/uri-list', it.url);
  e.dataTransfer.setData('text/plain', it.url);
  e.dataTransfer.effectAllowed = 'copy';
});
// A task as an item for the email composer (public/js/compose/compose.js).
function taskItem(t) {
  const sub = [t.status ? String(t.status).replace(/_/g, ' ') : '', t.due_date ? 'due ' + t.due_date : ''].filter(Boolean).join(', ');
  return { kind: 'task', title: (t.code ? t.code + ' ' : '') + (t.title || 'Task'), url: taskUrl(t), sub };
}
function taskUrl(t) {
  const u = new URL(location.origin + '/projects/');
  if (t.project) { u.pathname = '/projects/p/'; u.search = '?p=' + encodeURIComponent(t.project.key) + '&t=' + encodeURIComponent(t.code || t.id); }
  else u.search = '?t=' + encodeURIComponent(t.id);
  return u.toString();
}
function copyLink() {
  const t = st.task;
  const u = new URL(location.href);
  if (t.project) { u.pathname = u.pathname.replace(/\/projects\/?.*$/, '/projects/p/'); u.search = '?p=' + encodeURIComponent(t.project.key) + '&t=' + encodeURIComponent(t.code || t.id); }
  else { u.search = '?t=' + encodeURIComponent(t.id); }
  const done = () => toast('Link copied');
  if (navigator.clipboard) navigator.clipboard.writeText(u.toString()).then(done, () => toast(u.toString())); else toast(u.toString());
}
function askTime(anchor) {
  return new Promise((resolve) => {
    let out;
    const s = openSheet({ title: 'Due time', cls: 'pj-sheet--date', html: '<input type="time" class="pj-date" data-t value="09:00" aria-label="Due time, Eastern" /><p class="pj-quiet" style="padding:8px 14px 0">Eastern time.</p><div class="pj-sheet__foot"><button type="button" class="pj-btn" data-sheet-x>Cancel</button><button type="button" class="pj-btn pj-btn--primary" data-set>Set time</button></div>', onClose: () => resolve(out) });
    const i = s.body.querySelector('[data-t]');
    setTimeout(() => i.focus(), 30);
    const set = () => { if (i.value) { out = i.value; s.close(); } };
    s.body.querySelector('[data-set]').addEventListener('click', set);
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); set(); } });
  });
}
function stepTask(dir) {
  const ids = orderIds();
  const i = ids.indexOf(st.id);
  const n = ids[i + dir];
  if (n) { flush(); openDrawer(main, n); }
}

/* ---------------------------------------------------------------- keys */
function onKey(e) {
  if (e.key === 'Tab') {
    const nodes = [...el.querySelectorAll('.pj-dr button:not([disabled]):not([hidden]), .pj-dr input:not([hidden]), .pj-dr textarea, .pj-dr a[href]')].filter((n) => n.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement.classList.contains('pj-dr'))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}
function gkey(e) {
  if (!drawerOpen()) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
  if (e.key === 'Escape') {
    if (document.querySelector('.pj-sheet, .pj-pop, .rt-sheet, .ch-pop')) return;
    e.stopPropagation(); e.preventDefault(); close(false);
  } else if (!typing && (e.key === '[' || e.key === ']')) { e.preventDefault(); stepTask(e.key === ']' ? 1 : -1); }
  else if (!typing && e.key === ' ' && st && st.task && document.activeElement && !document.activeElement.closest('button, a')) { e.preventDefault(); upd({ done: st.task.status !== 'done' }); }
}
