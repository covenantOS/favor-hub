/* The first-day page: a welcome, the new hire's own steps, the first week by day, the people to meet, and the FavorOS tour. */
(() => {
  'use strict';
  const O = window.Onb;
  const root = document.getElementById('wl-root');
  if (!O || !root) return;
  const { esc, api, ic } = O;
  let D = null;
  const STEP_KIND = { form: 'Do this yourself', learn: 'In Learn', task: '', auto: '' };

  const face = (p) => (p.picture ? `<span class="rq-av wl-face"><img src="${esc(p.picture)}" alt="" referrerpolicy="no-referrer" /></span>` : O.avatar(p.email, ''));

  function hero() {
    const first = O.first(D.me.name) || 'there';
    const r = D.run;
    const when = r ? (r.date > O.today() ? `You start ${O.longDay(r.date)}.` : r.date === O.today() ? 'Your first day is today.' : `You started ${O.longDay(r.date)}.`) : '';
    const sup = D.meet.find((m) => m.why === 'Your supervisor');
    const note = r && r.welcome ? `<figure class="wl-note">${sup ? face(sup) : ''}<blockquote>${esc(r.welcome)}</blockquote>${sup ? `<figcaption>${esc(sup.name)}, ${esc(sup.title || 'your supervisor')}</figcaption>` : ''}</figure>` : '';
    return `<header class="wl-hero"><div class="wl-hero__t"><p class="wl-kicker">FavorOS</p><h1>Welcome to Favor, ${esc(first)}.</h1>
      <p class="wl-sub">${esc([when, r && r.title, r && r.team].filter(Boolean).join(' · '))}</p>
      <div class="wl-acts"><button type="button" class="h-btn h-btn--primary" data-tour-start>${ic('spark')}Take the FavorOS tour</button><a class="h-btn h-btn--ghost" href="/learn/">Open Learn</a></div></div>${note}</header>`;
  }

  function stepsBlock() {
    if (!D.run || !D.steps.length) return '';
    const open = D.steps.filter((s) => s.status === 'open').length;
    const rows = D.steps.map((s) => {
      const done = s.status === 'done' || (s.kind === 'learn' && D.learn[s.key]);
      const canTick = s.kind !== 'auto' && s.kind !== 'learn' && s.status !== 'skipped';
      const late = !done && s.due_date && s.due_date < O.today();
      return `<li class="ob-step wl-step${done ? ' is-done' : ''}${late ? ' is-late' : ''}" data-id="${esc(s.id)}">
        <button type="button" class="ob-tick" data-tick aria-pressed="${done}" aria-label="${done ? 'Done. Press to reopen' : 'Mark done'}: ${esc(s.title)}"${canTick ? '' : ' disabled'}>${ic('check')}</button>
        <div class="ob-step__body"><div class="ob-step__title"><span>${esc(s.title)}</span>${STEP_KIND[s.kind] ? `<span class="ob-chip">${STEP_KIND[s.kind]}</span>` : ''}</div>
        ${s.detail ? `<p class="ob-step__detail">${esc(s.detail)}</p>` : ''}
        <div class="ob-step__meta">${s.due_date ? `<span class="ob-due${late ? ' is-late' : ''}">${late ? 'Late, ' : 'Due '}${esc(O.dayWord(s.due_date))}</span>` : ''}${s.link_url && s.link_url !== '/welcome/' ? `<a class="ob-link" href="${esc(s.link_url)}"${/^https?:/.test(s.link_url) ? ' target="_blank" rel="noopener"' : ''}>${ic('link')}${esc(s.link_label || 'Open')}</a>` : ''}</div></div></li>`;
    }).join('');
    return `<section class="wl-sec"><h2>Your steps <span>${open} open</span></h2><ul class="ob-steps">${rows}</ul></section>`;
  }

  function weekBlock() {
    if (!D.week.length) return '';
    return `<section class="wl-sec"><h2>Your first week</h2><ol class="wl-week">${D.week.map((d) => `<li><h3>${esc(d.label)}</h3><ul>${d.items.map((i) => `<li class="${i.done ? 'is-done' : ''}"><span class="wl-who">${esc(i.who)}</span>${esc(i.title)}</li>`).join('')}</ul></li>`).join('')}</ol></section>`;
  }

  function peopleBlock() {
    if (!D.meet.length) return '';
    return `<section class="wl-sec wl-people"><h2>People to meet</h2><ul class="wl-grid">${D.meet.map((m) => `<li class="wl-person">${face(m)}<div><b>${esc(m.name)}</b><span>${esc(m.title || m.team)}</span><small>${esc(m.why)}</small></div></li>`).join('')}</ul></section>`;
  }

  function aroundBlock() {
    const links = [
      ['/', 'Today', 'What is waiting on you'],
      ['/requests/', 'Requests', 'Ask for something or see where it stands'],
      ['/meet/', 'Meetings', 'Join, book and read notes'],
      ['/help/', 'Help docs', 'How every tool works, with search'],
    ];
    return `<section class="wl-sec"><h2>Find your way around</h2><ul class="wl-links">${links.map(([h, t, d]) => `<li><a href="${h}"><b>${t}</b><span>${d}</span></a></li>`).join('')}</ul></section>`;
  }

  function draw() {
    root.removeAttribute('aria-busy'); root.innerHTML = hero() + `<div class="wl-body">${stepsBlock()}${weekBlock()}${peopleBlock()}${aroundBlock()}</div>`;
  }

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tick]');
    if (!t) return;
    const li = t.closest('[data-id]');
    const s = D.steps.find((x) => x.id === li.dataset.id);
    if (!s) return;
    const next = s.status === 'done' ? 'open' : 'done';
    t.disabled = true;
    try {
      await api(`runs/${D.run.id}/steps/${s.id}`, { method: 'PATCH', body: { status: next } });
      s.status = next;
      draw();
    } catch (err) { t.disabled = false; O.toast(err.message, true); }
  });

  O.ready().then(async () => {
    try {
      await window.ReqTasks.people();
      D = await api('welcome');
    } catch (e) { root.removeAttribute('aria-busy'); root.innerHTML = `<div class="ob-empty"><p>${esc(e.message)}</p></div>`; return; }
    draw();
  });
})();
