/* Team workload: every person down the side, the next weeks across, tasks due in each week. A cell turns amber when a week is
   heavy for that person and red when it is overloaded, measured against that person's own usual week. Warnings list first. */
import { esc, icon, avatar, toast, shortDate } from './ui-util.js';
import { api } from './ui-data.js';

const lvlWord = { over: 'Overloaded', heavy: 'Heavy', behind: 'Behind', ok: '' };

export async function mountTeamLoad(host, shell) {
  const S = { weeks: 8, team: '', data: null, error: '', all: null };
  host.innerHTML = '<div class="pjv-root pj-tl"><div class="pj-tl__warns" data-warns></div><div class="pjv-bar" role="toolbar" aria-label="Team workload"><div class="pjv-seg" role="group" aria-label="Weeks shown">' +
    [4, 8, 12].map((n) => `<button type="button" data-w="${n}" aria-pressed="${n === S.weeks}">${n} weeks</button>`).join('') + '</div><div class="pj-chips" data-teams role="group" aria-label="Team"></div><span class="pjv-count" data-count></span></div>' +
    '<div class="wl-scroll pjv-body"><table class="wl-table pj-tl__table"></table></div><div class="cal-pop wl-pop" hidden role="dialog"></div></div>';
  const root = host.querySelector('.pj-tl');
  const table = root.querySelector('.wl-table');
  const pop = root.querySelector('.wl-pop');
  const teams = () => [...new Set((S.all || []).map((p) => p.team).filter(Boolean))].sort();

  function warns() {
    const w = S.data ? S.data.warnings : [];
    const el = root.querySelector('[data-warns]');
    if (!w.length) { el.innerHTML = S.data ? '<p class="pj-tl__ok">No one is over a usual week in the weeks shown.</p>' : ''; return; }
    el.innerHTML = `<ul class="pj-tl__list">${w.slice(0, 8).map((x) => `<li class="is-${x.level}"><b>${esc(lvlWord[x.level])}</b><span>${esc(x.text)}</span></li>`).join('')}</ul>${w.length > 8 ? `<p class="pj-tl__more">and ${w.length - 8} more</p>` : ''}`;
  }
  function render() {
    const d = S.data;
    if (S.error) { table.innerHTML = `<tbody><tr><td class="wl-empty" colspan="3">${esc(S.error)} <button type="button" class="pj-btn" data-retry>Try again</button></td></tr></tbody>`; return; }
    if (!d) { table.innerHTML = '<tbody><tr><td class="wl-empty">Loading</td></tr></tbody>'; return; }
    root.querySelector('[data-count]').textContent = `${d.people.length} ${d.people.length === 1 ? 'person' : 'people'}`;
    root.querySelector('[data-teams]').innerHTML = ['', ...teams()].map((t) => `<button type="button" class="pj-fchipbtn${S.team === t ? ' is-on' : ''}" data-team="${esc(t)}" aria-pressed="${S.team === t}">${t ? esc(t) : 'Everyone'}</button>`).join('');
    let h = `<thead><tr><th class="wl-name wl-corner" scope="col">Person</th><th scope="col" class="wl-col wl-col--over">Past due</th>${d.weeks.map((w, i) => `<th scope="col" class="wl-col${i === 0 ? ' is-now' : ''}"><span>${esc(shortDate(w))}</span></th>`).join('')}<th scope="col" class="wl-col wl-col--none">No date</th><th scope="col" class="wl-col wl-col--total">Open</th></tr></thead><tbody>`;
    if (!d.people.length) h += `<tr><td class="wl-empty" colspan="${d.weeks.length + 4}">No open tasks with an owner</td></tr>`;
    d.people.forEach((p, pi) => {
      h += `<tr><th class="wl-name" scope="row"><span class="wl-who">${avatar(p, 'sm')}<span class="wl-who__t"><b>${esc(p.name)}</b><small>${p.level !== 'ok' ? `<i class="pj-lvl pj-lvl--${p.level}">${esc(p.behind && p.level === 'heavy' ? 'Behind' : lvlWord[p.level] || '')}</i> ` : ''}usual ${p.usual}/wk</small></span></span></th>`;
      h += `<td class="wl-c">${p.overdue ? `<span class="pj-tl__cell${p.behind ? ' lv-over' : ' lv-heavy'}" aria-label="${esc(p.name)}, past due: ${p.overdue}">${p.overdue}</span>` : '<span class="wl-c--0" aria-hidden="true">–</span>'}</td>`;
      p.weeks.forEach((c, wi) => {
        h += `<td class="wl-c${wi === 0 ? ' is-now' : ''}">${c.count ? `<button type="button" class="wl-btn pj-tl__cell lv-${c.level}" data-p="${pi}" data-w="${wi}" aria-label="${esc(p.name)}, week of ${esc(shortDate(c.start))}: ${c.count} ${c.count === 1 ? 'task' : 'tasks'}${c.level !== 'ok' ? ', ' + lvlWord[c.level].toLowerCase() : ''}">${c.count}</button>` : '<span class="wl-c--0" aria-hidden="true">–</span>'}</td>`;
      });
      h += `<td class="wl-c">${p.undated ? `<span class="pj-tl__cell lv-none">${p.undated}</span>` : '<span class="wl-c--0" aria-hidden="true">–</span>'}</td><td class="wl-total">${p.open}</td></tr>`;
    });
    table.innerHTML = h + '</tbody>';
  }
  function openPop(btn) {
    const p = S.data.people[Number(btn.dataset.p)];
    const c = p.weeks[Number(btn.dataset.w)];
    pop.innerHTML = `<div class="cal-pop__h"><span class="wl-pop__t"><b>${esc(p.name)}</b><small>Week of ${esc(shortDate(c.start))}, ${c.count} ${c.count === 1 ? 'task' : 'tasks'}, usual ${p.usual}</small></span><button type="button" class="cal-pop__x" data-x aria-label="Close">${icon('x')}</button></div><ul class="cal-pop__list wl-list">${c.tasks.map((t) => `<li><button type="button" data-open="${esc(t.code || '')}"${t.code ? '' : ' disabled'}><i></i><span>${esc(t.title)}</span><em>${t.project_key ? esc(t.project_key) + ' · ' : ''}${esc(shortDate(t.due))}</em></button></li>`).join('')}${c.count > c.tasks.length ? `<li class="pj-tl__more">and ${c.count - c.tasks.length} more</li>` : ''}</ul>`;
    pop.hidden = false;
    if (matchMedia('(max-width: 860px)').matches) { pop.classList.add('is-sheet'); pop.style.left = ''; pop.style.top = ''; return; }
    pop.classList.remove('is-sheet');
    const mr = root.getBoundingClientRect();
    const ar = btn.getBoundingClientRect();
    const left = Math.min(Math.max(ar.left - mr.left - 20, 8), Math.max(8, mr.width - 340 - 8));
    let top = ar.bottom - mr.top + 6;
    if (top + pop.offsetHeight > mr.height - 8) top = Math.max(8, ar.top - mr.top - pop.offsetHeight - 6);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
  const close = () => { pop.hidden = true; pop.innerHTML = ''; };
  root.addEventListener('click', (e) => {
    const w = e.target.closest('.pjv-seg [data-w]');
    if (w) { S.weeks = Number(w.dataset.w); root.querySelectorAll('.pjv-seg [data-w]').forEach((b) => b.setAttribute('aria-pressed', String(b === w))); load(); return; }
    const t = e.target.closest('[data-team]');
    if (t) { S.team = t.dataset.team; load(); return; }
    if (e.target.closest('[data-retry]')) { load(); return; }
    const c = e.target.closest('.wl-btn');
    if (c) { openPop(c); return; }
    if (e.target.closest('[data-x]')) { close(); return; }
    const o = e.target.closest('[data-open]');
    if (o && o.dataset.open) { close(); shell.open({ code: o.dataset.open }); }
  });
  const away = (e) => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.wl-btn')) close(); };
  document.addEventListener('pointerdown', away, true);
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  async function load() {
    close();
    S.error = '';
    try {
      if (!S.all) S.all = (await api.workload({ weeks: 2 })).people;
      S.data = await api.workload({ weeks: S.weeks, team: S.team });
    } catch (e) { S.error = e.message || 'The workload did not load.'; toast(S.error); }
    warns();
    render();
  }
  render();
  await load();
  return { destroy() { document.removeEventListener('pointerdown', away, true); close(); host.innerHTML = ''; } };
}
