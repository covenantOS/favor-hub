/* The quick switcher: Ctrl or Cmd + K on a Projects page. Type to jump to a project, or to find a task by title or code. */
import { esc, icon, openSheet, debounce, dueLabel } from './ui-util.js';
import { api } from './ui-data.js';
import { projectList } from './sidebar.js';

let current = null;

export function openSwitcher(o = {}) {
  if (current) { current.close(); return; }
  const s = openSheet({
    hideHead: true, cls: 'pj-sheet--switch', label: 'Jump to a project or task',
    html: `<label class="pj-sw__in">${icon('search')}<input type="search" data-sw placeholder="Jump to a project or task" aria-label="Jump to a project or task" autocomplete="off" /></label><div class="pj-sw__list" data-list role="listbox"></div>`,
    onClose: () => { current = null; },
  });
  current = s;
  const input = s.body.querySelector('[data-sw]');
  const list = s.body.querySelector('[data-list]');
  let projects = [];
  let tasks = [];
  let hi = 0;
  let seq = 0;
  let entries = [];

  const go = (en) => {
    if (!en) return;
    s.close();
    if (en.kind === 'project') { location.href = en.href; return; }
    const same = o.projectKey && en.projectKey && en.projectKey.toUpperCase() === o.projectKey.toUpperCase();
    if (same || !en.projectKey && o.open) { if (o.open) o.open(en.ref); return; }
    location.href = en.projectKey ? '/projects/p/?p=' + encodeURIComponent(en.projectKey) + '&t=' + encodeURIComponent(en.ref) : '/projects/?t=' + encodeURIComponent(en.ref);
  };
  function paint() {
    const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    const ps = projects.filter((p) => p.status === 'active' && words.every((w) => (p.name + ' ' + p.key).toLowerCase().includes(w))).slice(0, 8);
    entries = [];
    if (!words.length || 'my tasks'.includes(words.join(' '))) entries.push({ kind: 'project', label: 'My tasks', sub: '', href: '/projects/?tab=mine', ic: 'check' });
    for (const p of ps) entries.push({ kind: 'project', label: p.name, sub: p.key, href: '/projects/p/?p=' + encodeURIComponent(p.key), dot: p.color });
    for (const t of tasks) entries.push({ kind: 'task', label: t.title, sub: [t.code, t.project ? t.project.name : 'Personal', t.due_date ? dueLabel(t.due_date, t.due_time) : ''].filter(Boolean).join(' \u00b7 '), ref: t.code || t.id, projectKey: t.project ? t.project.key : '', done: t.status === 'done' });
    hi = Math.min(hi, Math.max(0, entries.length - 1));
    const row = (en, i) => `<button type="button" class="pj-sw__r${i === hi ? ' is-hi' : ''}" role="option" data-i="${i}">${en.dot ? `<i class="pj-dot" data-c="${esc(en.dot)}"></i>` : icon(en.ic || (en.kind === 'task' ? 'list' : 'board'))}<span class="pj-sw__t${en.done ? ' is-done' : ''}">${esc(en.label)}</span><span class="pj-sw__s">${esc(en.sub)}</span></button>`;
    const firstTask = entries.findIndex((x) => x.kind === 'task');
    list.innerHTML = entries.length ? entries.map((en, i) => (i === 0 ? '<div class="pj-sw__h">Projects</div>' : '') + (i === firstTask ? '<div class="pj-sw__h">Tasks</div>' : '') + row(en, i)).join('') : `<p class="pj-none">${words.length ? 'Nothing matches' : 'Loading'}</p>`;
  }
  const search = debounce(async () => {
    const v = input.value.trim();
    const mine = ++seq;
    if (v.length < 2) { tasks = []; paint(); return; }
    try { const d = await api.tasks({ q: v, status: 'all', limit: 8 }); if (mine === seq) { tasks = d.tasks || []; paint(); } } catch (_) { if (mine === seq) { tasks = []; paint(); } }
  }, 180);
  input.addEventListener('input', () => { hi = 0; paint(); search(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (entries.length) hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length;
      list.querySelectorAll('.pj-sw__r').forEach((b, i) => b.classList.toggle('is-hi', i === hi));
      const b = list.querySelector('.pj-sw__r.is-hi'); if (b) b.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); go(entries[hi]); }
  });
  list.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) go(entries[+b.dataset.i]); });
  paint();
  projectList().then((l) => { projects = l; paint(); }).catch(() => paint());
  setTimeout(() => input.focus(), 0);
}
