/* Reporting: goal pacing, the week in plain language for each team, and My dashboard (answers pinned from Favor Brain).
   Numbers come from /api/hub/reporting, which reads the KPI dashboard; nothing is recomputed here. Each figure that opens
   an explanation carries data-drill="explain:<key>", which public/js/drill.js handles. A pin is drawn with the Favor Brain
   page's own block code (public/js/brain-blocks.js) so it reads as it did in the chat. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const root = $('rg-week-body');
  if (!root) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money0 = (n) => (Number(n) < 0 ? '-$' : '$') + Math.round(Math.abs(Number(n) || 0)).toLocaleString('en-US');
  const day = (iso) => new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const dayLong = (iso) => new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const clock = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  let toastTimer = 0;
  function toast(msg) {
    const t = $('rg-toast');
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-on'), 3200);
  }

  const api = (path, opt) =>
    fetch(path, Object.assign({ credentials: 'same-origin' }, opt || {}))
      .then((r) => r.json().catch(() => ({})).then((d) => Object.assign(d, { _status: r.status })))
      .catch(() => ({ ok: false, message: 'FavorOS could not be reached. Check the connection and try again.' }));

  // ---- Tabs ------------------------------------------------------------------------------------------
  const tabs = Array.from(document.querySelectorAll('.rg-tab'));
  let tab = 'week';
  function show(which, push) {
    tab = which === 'mine' ? 'mine' : 'week';
    tabs.forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    $('rg-week').hidden = tab !== 'week';
    $('rg-mine').hidden = tab !== 'mine';
    if (push) history.replaceState(null, '', tab === 'mine' ? '/reporting/?tab=mine' : '/reporting/');
    if (tab === 'mine') loadPins();
    else if (!weekLoaded) loadWeek();
    else drawCharts();
  }
  tabs.forEach((b) => {
    b.addEventListener('click', () => show(b.dataset.tab, true));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const next = tabs[(tabs.indexOf(b) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      show(next.dataset.tab, true);
      next.focus();
    });
  });

  // ---- This week -------------------------------------------------------------------------------------
  let weekLoaded = false;
  let weekData = null;
  const STATUS = { ahead: 'On pace to pass the goal', close: 'Close, it depends on the fourth quarter', behind: 'Behind pace' };

  function paceCard(key, p, name) {
    const scale = Math.max(p.goal, p.projectedHigh, p.raised) || 1;
    const at = (n) => Math.min(100, Math.max(0, (n / scale) * 100)).toFixed(2);
    const range = p.projectedLow === p.projectedHigh ? `about ${money0(p.projectedHigh)}` : `${money0(p.projectedLow)} to ${money0(p.projectedHigh)}`;
    const verb = p.measure === 'awarded' ? 'awarded' : 'raised';
    const band = p.projectedLow !== p.projectedHigh ? `<i class="rg-band" style="left:${at(p.projectedLow)}%;width:${(at(p.projectedHigh) - at(p.projectedLow)).toFixed(2)}%"></i>` : '';
    return `<button type="button" class="rg-pace h-card is-${p.status}" data-drill="explain:${esc(key)}" data-drill-label="${esc(name)}${key === 'year' ? '' : p.measure === 'awarded' ? ', awarded this year' : ', this year'}" data-drill-value="${Number(p.raised) || 0}" data-drill-shown-label="${p.measure === 'awarded' ? 'Awarded this year' : 'Raised so far this year'}">
      <span class="rg-pace__top"><b>${esc(name)}</b><span class="rg-chip is-${p.status}">${esc(STATUS[p.status])}</span></span>
      <span class="rg-pace__end">${range}</span>
      <span class="rg-pace__sub">${verb} by December 31 at this pace</span>
      <span class="rg-track" aria-hidden="true">${band}<i class="rg-fill" style="width:${at(p.raised)}%"></i><i class="rg-tick rg-tick--now" style="left:${at(p.expected)}%"></i><i class="rg-tick rg-tick--goal" style="left:${at(p.goal)}%"></i></span>
      <span class="rg-pace__facts"><span>${money0(p.raised)} of ${money0(p.goal)}, ${p.pctGoal.toFixed(1)}%</span><span>${p.pctYear.toFixed(1)}% of the year gone</span></span>
      <span class="rg-pace__facts rg-pace__need"><span>${money0(p.toGo)} to go</span><span>${money0(p.perWeekNeeded)} a week for ${Math.round(p.weeksLeft)} weeks</span></span>
    </button>`;
  }

  function highlightCard(h, lead) {
    return `<article class="rg-hl h-card${lead ? ' rg-hl--lead' : ''}" data-hl="${esc(h.key)}">
      <h3>${esc(h.name)}</h3>
      <p class="rg-hl__head">${esc(h.headline)}</p>
      ${h.lines.map((l) => `<p>${esc(l)}</p>`).join('')}
    </article>`;
  }

  function highlightText(d) {
    const parts = [d.highlights.overall].concat(d.highlights.teams).map((h) => `${h.name}\n${h.headline}\n${h.lines.join('\n')}`);
    return `Favor highlights, ${day(d.highlights.week.from)} to ${day(d.highlights.week.to)}\n\n${parts.join('\n\n')}`;
  }

  function drawWeek(d) {
    weekData = d;
    const order = ['year'].concat((d.teams || []).map((t) => t.key));
    const names = { year: 'Raised this year' };
    (d.teams || []).forEach((t) => { names[t.key] = t.name; });
    const cards = order.filter((k) => d.pace[k]).map((k) => paceCard(k, d.pace[k], names[k])).join('');
    const hl = d.highlights;
    root.innerHTML = `
      <div class="rg-sec">
        <div class="rg-sec__h"><h2>Where each goal ends the year</h2><p>${esc(dayLong(d.asOf))}. Press a card to see what is in it and why it changed since last month.</p></div>
        <div class="rg-pace-grid">${cards}</div>
        <p class="rg-key"><span><i class="rg-key__fill"></i>So far</span><span><i class="rg-key__now"></i>Where the line sits today</span><span><i class="rg-key__goal"></i>Goal</span><span><i class="rg-key__band"></i>Range for year end</span></p>
      </div>
      <div class="rg-sec">
        <div class="rg-sec__h rg-sec__h--row"><div><h2>The week in plain language</h2><p>${esc(day(hl.week.from))} to ${esc(day(hl.week.to))}, from the same gifts the KPI dashboard counts.</p></div>
          <button type="button" class="h-btn h-btn--ghost h-btn--sm" id="rg-copy">Copy as text</button></div>
        <div class="rg-hl-grid">${highlightCard(hl.overall, true)}${hl.teams.map((h) => highlightCard(h, false)).join('')}</div>
        ${d.giftsAvailable ? '' : '<p class="rg-note">Gift detail did not load, so the weekly lines are short. Reload in a minute.</p>'}
      </div>`;
    $('rg-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(highlightText(d));
        toast('Highlights copied');
      } catch {
        toast('Your browser would not copy.');
      }
    });
    if (d.lastUpdated) {
      const f = $('rg-fresh');
      f.textContent = 'KPI dashboard updated ' + clock(d.lastUpdated);
      f.hidden = false;
    }
  }

  async function loadWeek() {
    $('rg-wait').hidden = false;
    const d = await api('/api/hub/reporting');
    $('rg-wait').hidden = true;
    root.hidden = false;
    if (!d.ok) {
      root.innerHTML = `<div class="h-card rg-empty" role="alert"><p>${esc(d.message || 'The numbers did not load. Reload in a minute.')}</p></div>`;
      return;
    }
    weekLoaded = true;
    drawWeek(d);
  }

  // ---- My dashboard ----------------------------------------------------------------------------------
  const B = window.BrainBlocks;
  const mine = $('rg-mine-body');
  let pins = [];
  let pinsLoaded = false;
  const askedAt = (iso) => {
    const h = (Date.now() - new Date(iso)) / 36e5;
    return h < 1 ? 'just now' : h < 24 ? Math.round(h) + ' hours ago' : clock(iso).replace(/, \d{1,2}:\d{2}.*$/, '');
  };

  const host = {
    toast,
    page: '/reporting/',
    turn: () => null,
    rerender: () => {},
    ask: () => {},
    focusInput: () => {},
    openTable: () => {},
    closeTable: () => {},
    cue: () => {},
    api: () => Promise.reject(new Error('That works on the Favor Brain page.')),
  };

  function pinCard(p, i) {
    const blocks = (p.answer.blocks || []).map((b, bi) => B.render(b, { ti: -1, bi, canSheets: false, canRequest: () => false, expired: false })).join('');
    const body = blocks || (p.answer.markdown ? B.fallback(p.answer.markdown) : '<p class="rg-note">No answer is kept for this pin. Refresh asks again.</p>');
    return `<article class="rg-pin h-card" data-pin="${esc(p.id)}">
      <header class="rg-pin__h">
        <div class="rg-pin__t"><h3 class="rg-pin__title" tabindex="-1">${esc(p.title)}</h3><p class="rg-pin__q">${esc(p.question)}</p></div>
        <div class="rg-pin__acts">
          <span class="rg-pin__when">Asked ${esc(askedAt(p.asked_at))}</span>
          <button type="button" class="h-btn h-btn--ghost h-btn--xs" data-pin-act="refresh">Refresh</button>
          <button type="button" class="ib ib--sm" data-pin-act="up" aria-label="Move up"${i === 0 ? ' disabled' : ''}>${B.ic('sort')}</button>
          <button type="button" class="ib ib--sm" data-pin-act="down" aria-label="Move down"${i === pins.length - 1 ? ' disabled' : ''}><svg class="h-i rg-flip" aria-hidden="true"><use href="#bci-sort"/></svg></button>
          <button type="button" class="ib ib--sm" data-pin-act="rename" aria-label="Rename">${B.ic('edit')}</button>
          <button type="button" class="ib ib--sm" data-pin-act="remove" aria-label="Unpin">${B.ic('trash')}</button>
        </div>
      </header>
      <div class="rg-pin__body m-a">${body}</div>
    </article>`;
  }

  function drawPins() {
    const n = $('rg-pin-count');
    n.hidden = !pins.length;
    n.textContent = String(pins.length);
    if (!pins.length) {
      mine.innerHTML = `<div class="h-card rg-empty">
        <h2>Nothing pinned yet</h2>
        <p>Ask Favor Brain a question, then press Pin to My dashboard under the answer. It stays here, and Refresh asks it again with today's numbers.</p>
        <p><a class="h-btn h-btn--primary h-btn--sm" href="/brain/">Open Favor Brain</a></p>
        <div class="rg-eg"><span>Try asking</span>
          <a href="/brain/?ask=${encodeURIComponent('How much did RDDs raise this month compared with last month?')}">How much did RDDs raise this month compared with last month?</a>
          <a href="/brain/?ask=${encodeURIComponent('Which partners gave for the first time this month?')}">Which partners gave for the first time this month?</a>
          <a href="/brain/?ask=${encodeURIComponent('Which major partners have not given in a year?')}">Which major partners have not given in a year?</a>
        </div></div>`;
      return;
    }
    mine.innerHTML = `<div class="rg-pins">${pins.map(pinCard).join('')}</div>`;
    if (B.drawCharts) B.drawCharts(mine);
    if (B.countUp) B.countUp(mine, true);
    if (B.tableFades) B.tableFades();
  }

  function drawCharts() {
    if (tab === 'mine' && B && B.drawCharts) B.drawCharts(mine);
  }

  async function loadPins() {
    if (pinsLoaded) return;
    mine.innerHTML = '<div class="rg-wait" role="status"><span class="h-spin" aria-hidden="true"></span>Opening your pins</div>';
    const d = await api('/api/reporting/pins');
    if (!d.ok) {
      mine.innerHTML = `<div class="h-card rg-empty" role="alert"><p>${esc(d.message || 'Your pins did not load. Reload in a minute.')}</p></div>`;
      return;
    }
    pins = d.pins || [];
    pinsLoaded = true;
    drawPins();
  }

  async function act(card, kind, btn) {
    const id = card.dataset.pin;
    const p = pins.find((x) => x.id === id);
    if (!p) return;
    if (kind === 'refresh') {
      btn.disabled = true;
      btn.textContent = 'Asking';
      const d = await api(`/api/reporting/pins/${encodeURIComponent(id)}/refresh`, { method: 'POST' });
      if (d.ok && d.pin) {
        pins = pins.map((x) => (x.id === id ? d.pin : x));
        drawPins();
        toast('Refreshed');
      } else {
        btn.disabled = false;
        btn.textContent = 'Refresh';
        toast(d.message || 'That did not refresh. Try again.');
      }
    } else if (kind === 'up' || kind === 'down') {
      const d = await api(`/api/reporting/pins/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ move: kind }) });
      if (!d.ok) return toast(d.message || 'That did not move.');
      const i = pins.indexOf(p);
      const j = kind === 'up' ? i - 1 : i + 1;
      if (j >= 0 && j < pins.length) [pins[i], pins[j]] = [pins[j], pins[i]];
      drawPins();
      const again = mine.querySelector(`[data-pin="${id}"] [data-pin-act="${kind}"]:not([disabled])`) || mine.querySelector(`[data-pin="${id}"] .rg-pin__title`);
      if (again) again.focus();
    } else if (kind === 'rename') {
      const t = card.querySelector('.rg-pin__title');
      const input = document.createElement('input');
      input.className = 'rg-pin__edit';
      input.value = p.title;
      input.maxLength = 120;
      input.setAttribute('aria-label', 'Pin title');
      t.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const save = async (keep) => {
        if (done) return;
        done = true;
        const v = input.value.trim();
        if (keep && v && v !== p.title) {
          const d = await api(`/api/reporting/pins/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: v }) });
          if (d.ok) p.title = v.slice(0, 120);
          else toast(d.message || 'That did not save.');
        }
        drawPins();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); save(true); }
        if (e.key === 'Escape') { e.preventDefault(); save(false); }
      });
      input.addEventListener('blur', () => save(true));
    } else if (kind === 'remove') {
      const d = await api(`/api/reporting/pins/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!d.ok) return toast(d.message || 'That did not unpin.');
      pins = pins.filter((x) => x.id !== id);
      drawPins();
      toast('Unpinned');
    }
  }

  mine.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pin-act]');
    if (btn) {
      const card = btn.closest('[data-pin]');
      if (card) act(card, btn.dataset.pinAct, btn);
      return;
    }
    const el = e.target.closest('[data-act]');
    if (el && B && B.handle(e, el, host)) return;
  });

  // The pin count shows on the tab before it is opened.
  api('/api/reporting/pins').then((d) => {
    if (d.ok && !pinsLoaded) {
      pins = d.pins || [];
      pinsLoaded = true;
      const n = $('rg-pin-count');
      n.hidden = !pins.length;
      n.textContent = String(pins.length);
      if (tab === 'mine') drawPins();
    }
  });

  void reduced;
  show(new URLSearchParams(location.search).get('tab') === 'mine' ? 'mine' : 'week', false);
})();
