/* The projects sidebar: every project the person can see, with its sections. The open project is expanded and follows the
   page (sections added or renamed show up at once). Other projects load their sections when expanded.
   On a phone it is a panel that opens from the Projects button. */
import { esc, icon, phone } from './ui-util.js';
import { api } from './ui-data.js';

const COLLAPSE = 'favor.hub.projects.side.v1';
let listP = null;
export const projectList = () => {
  if (!listP) listP = api.projects().then((d) => d.projects || []).catch((e) => { listP = null; throw e; });
  return listP;
};

export function mountSidebar(host, ctx, o) {
  const openKeys = new Set([o.key.toUpperCase()]);
  const secs = new Map();
  let projects = [];
  let q = '';
  let destroyed = false;
  host.classList.add('pj-side');

  const collapsed = () => { try { return localStorage.getItem(COLLAPSE) === '1'; } catch (_) { return false; } };
  const setCollapsed = (v) => { try { localStorage.setItem(COLLAPSE, v ? '1' : '0'); } catch (_) { /* private mode */ } };
  const applyCollapsed = () => host.classList.toggle('is-collapsed', collapsed() && !phone());

  function sectionsOf(p) {
    if (ctx.project && (p.key === ctx.project.key || p.id === ctx.project.id)) return ctx.sections;
    return secs.get(p.key) || null;
  }
  function paint() {
    if (destroyed) return;
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = projects.filter((p) => p.status === 'active' && words.every((w) => (p.name + ' ' + p.key).toLowerCase().includes(w)));
    const cur = o.key.toUpperCase();
    host.innerHTML = `<div class="pj-side__head"><span class="pj-side__t">Projects</span><button type="button" class="pj-side__x" data-s="collapse" aria-label="Collapse the sidebar">${icon('back')}</button></div>
      <nav class="pj-side__nav" aria-label="Projects">
        <a class="pj-side__a" href="/projects/?tab=mine">${icon('check')}<span>My tasks</span></a>
        <a class="pj-side__a" href="/projects/?tab=projects">${icon('list')}<span>All projects</span></a>
      </nav>
      ${projects.length > 8 ? `<label class="pj-side__find">${icon('search')}<input type="search" data-s="find" placeholder="Find a project" aria-label="Find a project" autocomplete="off" value="${esc(q)}" /></label>` : ''}
      <ul class="pj-side__list">${rows.map((p) => {
        const open = openKeys.has(p.key);
        const ss = open ? sectionsOf(p) : null;
        return `<li class="pj-side__p${p.key === cur ? ' is-cur' : ''}"><div class="pj-side__row"><button type="button" class="pj-side__car${open ? ' is-open' : ''}" data-s="toggle" data-k="${esc(p.key)}" aria-expanded="${open}" aria-label="${open ? 'Hide' : 'Show'} sections of ${esc(p.name)}">${icon('right')}</button><a class="pj-side__link" href="/projects/p/?p=${encodeURIComponent(p.key)}" ${p.key === cur ? 'aria-current="page"' : ''}><i class="pj-dot" data-c="${esc(p.color)}"></i><span>${esc(p.name)}</span></a></div>
          ${open ? `<ul class="pj-side__secs">${ss ? (ss.length ? ss.map((s) => `<li><a class="pj-side__sec" href="/projects/p/?p=${encodeURIComponent(p.key)}&section=${encodeURIComponent(s.id)}" data-s="section" data-k="${esc(p.key)}" data-id="${esc(s.id)}">${esc(s.name)}</a></li>`).join('') : '<li class="pj-side__none">No sections</li>') : '<li class="pj-side__none">Loading</li>'}</ul>` : ''}</li>`;
      }).join('')}${rows.length ? '' : `<li class="pj-side__none">${projects.length ? 'No match' : 'Loading'}</li>`}</ul>`;
    const f = host.querySelector('[data-s="find"]');
    if (f && q) { f.focus(); f.setSelectionRange(q.length, q.length); }
  }
  async function ensure(key) {
    if (secs.has(key) || (ctx.project && ctx.project.key === key)) return;
    try { const d = await api.project(key); secs.set(key, d.sections || []); } catch (_) { secs.set(key, []); }
    paint();
  }

  host.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    const s = b.dataset.s;
    if (s === 'collapse') { setCollapsed(true); applyCollapsed(); if (o.onToggle) o.onToggle(); return; }
    if (s === 'toggle') {
      const k = b.dataset.k;
      if (openKeys.has(k)) openKeys.delete(k); else { openKeys.add(k); ensure(k); }
      paint();
      return;
    }
    if (s === 'section' && ctx.project && b.dataset.k === ctx.project.key) {
      e.preventDefault();
      o.onSection(b.dataset.id);
      if (phone()) close();
    }
  });
  host.addEventListener('input', (e) => { if (e.target.dataset.s === 'find') { q = e.target.value; paint(); } });

  let scrim = null;
  const home = { parent: host.parentNode, next: host.nextSibling };
  function close() {
    host.classList.remove('is-open'); document.documentElement.classList.remove('pj-side-open');
    if (scrim) { scrim.remove(); scrim = null; }
    if (host.parentNode === document.body && home.parent) home.parent.insertBefore(host, home.next && home.next.parentNode === home.parent ? home.next : null);
  }
  function open() {
    document.body.appendChild(host);
    host.classList.add('is-open'); document.documentElement.classList.add('pj-side-open');
    scrim = document.createElement('div'); scrim.className = 'pj-side__scrim'; scrim.addEventListener('click', close); document.body.appendChild(scrim);
  }
  const offCtx = ctx.on((w) => { if (w === 'sections' || w === 'load' || w === 'project') paint(); });

  applyCollapsed();
  paint();
  projectList().then((l) => { projects = l; paint(); }).catch(() => { projects = []; });
  return {
    toggle() { if (phone()) { host.classList.contains('is-open') ? close() : open(); } else { setCollapsed(!collapsed()); applyCollapsed(); } },
    close,
    destroy() { destroyed = true; offCtx(); host.innerHTML = ''; },
  };
}
