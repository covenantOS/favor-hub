/* Work Overview (/work-home/): one read from /api/hub/home, shown from this tab's last copy first, then refreshed.
   Complete, snooze and Thank write through the Work Center's own batches (saved, sent, checked, undone from the toast). */
(() => {
  'use strict';
  const root = document.getElementById('wh');
  if (!root) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const F = () => window.FavorWG;
  const KEY = 'favor.wh.v1';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ROLE = { admin: 'Admin', support: 'Support Team', director: 'Director', partner_care: 'Partner Care', grants: 'Grants writer', staff: 'Staff' };
  const n0 = (n) => Number(n || 0).toLocaleString('en-US');
  const plural = (n, one, many) => n0(n) + ' ' + (n === 1 ? one : many || one + 's');
  const money = (a) => '$' + Number(a || 0).toLocaleString('en-US', { minimumFractionDigits: Math.round(a) === Number(a) ? 0 : 2, maximumFractionDigits: 2 });
  const fd = (iso) => { const [, m, d] = String(iso).slice(0, 10).split('-').map(Number); return MON[m - 1] + ' ' + d; };
  const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const TODAY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const arrow = '<svg class="h-i" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  const tick = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const AS = new URLSearchParams(location.search).get('as') || '';

  let D = null;
  let loading = false;

  async function api(path, opts) {
    const o = opts || {};
    const url = AS && path.startsWith('/api/work') ? path + (path.includes('?') ? '&' : '?') + 'as=' + encodeURIComponent(AS) : path;
    const headers = Object.assign({ 'X-Hub-Request': '1' }, o.body ? { 'Content-Type': 'application/json' } : {});
    const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, o, { headers }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) { const e = new Error(data.message || 'Something went wrong. Try again.'); e.data = data; throw e; }
    return data;
  }
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });

  const ago = (iso) => {
    const t = Date.parse(iso);
    if (!t) return '';
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'Now';
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    const d = new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    return d === addDays(TODAY(), -1) ? 'Yesterday' : fd(d);
  };

  /* ------------------------------------------------------------------ click a number: its Favor definition and the rows behind it */
  // data-whd names the count. The rows come from /api/hub/home-drill (same pool and tests as the card); a count with no rows opens its definition only.
  const WHD = {
    open: { title: 'Open actions', defs: ['Open and overdue actions'], rows: true, type: 'int' },
    overdue: { title: 'Overdue actions', defs: ['Open and overdue actions'], rows: true, type: 'int' },
    today: { title: 'Actions due today', defs: ['Open and overdue actions'], rows: true, type: 'int' },
    gifts: { title: 'Gifts to thank', defs: ['Gifts to thank'], rows: true, type: 'int' },
    over24: { title: 'Gifts waiting over 24 hours', defs: ['Gifts to thank'], rows: true, type: 'int' },
    first: { title: 'First gifts to thank', defs: ['Gifts to thank'], rows: true, type: 'int' },
    teamopen: { title: 'Open actions', defs: ['Open and overdue actions'], type: 'int' },
    teamlate: { title: 'Overdue actions', defs: ['Open and overdue actions'], type: 'int' },
    teamty: { title: 'Thank-you tasks', defs: ['Open and overdue actions'], type: 'int' },
  };
  const COLS = {
    actions: [{ key: 'due', label: 'Due', type: 'text' }, { key: 'partner', label: 'Partner', type: 'text' }, { key: 'place', label: 'Place', type: 'text' }, { key: 'type', label: 'Type', type: 'text' }, { key: 'summary', label: 'Summary', type: 'text' }, { key: 'late', label: 'Days late', type: 'int' }],
    gifts: [{ key: 'date', label: 'Gift date', type: 'text' }, { key: 'partner', label: 'Partner', type: 'text' }, { key: 'place', label: 'Place', type: 'text' }, { key: 'amount', label: 'Gift', type: 'money' }, { key: 'fund', label: 'Fund', type: 'text' }, { key: 'waiting', label: 'Days waiting', type: 'int' }, { key: 'badges', label: 'Notes', type: 'text' }],
  };
  const dn = (key, text, n) => `<span class="dr-num" tabindex="0" role="button" data-whd="${key}"${n == null ? '' : ` data-whd-n="${Number(n) || 0}"`}>${text}</span>`;
  function openCount(el) {
    const key = el.getAttribute('data-whd');
    const def = WHD[key];
    const FD = window.FavorDrill;
    if (!def || !FD) return;
    const shown = el.hasAttribute('data-whd-n') ? Number(el.getAttribute('data-whd-n')) : Number((el.textContent.match(/[\d,]+/) || ['0'])[0].replace(/,/g, ''));
    const spec = { title: def.title, shown, shownType: 'int', shownLabel: 'On the Work Overview', defs: def.defs, totalLabel: 'Rows behind it', rowsLabel: def.title };
    if (!def.rows) { FD.open(spec); return; }
    FD.openAsync(spec, async () => {
      try {
        const out = await api('/api/hub/home-drill?key=' + encodeURIComponent(key));
        return { rows: out.rows, total: out.total, columns: COLS[out.kind] };
      } catch (e) { return { message: e.message }; }
    }).then(() => {});
  }
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-whd]');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    openCount(el);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest && e.target.closest('[data-whd]');
    if (!el) return;
    e.preventDefault();
    openCount(el);
  });

  /* ------------------------------------------------------------------ header and tools */
  function paintTop(d) {
    const w = d.work;
    $('wh-title').textContent = d.name || 'Work';
    const role = w ? ROLE[w.role] || '' : 'Staff';
    const day = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' });
    const at = d.at ? new Date(d.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : '';
    $('wh-meta').innerHTML = esc([role, day].filter(Boolean).join(' · ')) + (w && w.synced ? ` · Blackbaud copy <span class="copy-stamp" data-copy-stamp data-iso="${esc(w.synced)}"></span>` : '') + (at ? ` · Updated ${esc(at)}` : '');
    if (window.copyStamps) { try { window.copyStamps(); } catch (_) { /* optional */ } }
    // Admins have the shorter left column, so the activity feed goes under the right one; everyone else keeps it beside their gifts.
    const feed = $('wh-feed');
    const dest = document.querySelector(w && w.role === 'admin' ? '.wh-col--side' : '.wh-col--main');
    if (feed && dest && feed.parentElement !== dest) dest.appendChild(feed);
    const counts = d.counts || {};
    const access = d.access || {};
    document.querySelectorAll('[data-wh]').forEach((el) => {
      const need = el.getAttribute('data-need');
      if (need && access[need] === false) { el.hidden = true; return; }
      const key = el.getAttribute('data-wh-count');
      let n = key ? Number(counts[key] || 0) : 0;
      const nEl = el.querySelector('[data-n]');
      nEl.hidden = !(n > 0);
      if (n > 0) { nEl.textContent = n0(n) + (key === 'workOpen' ? ' open' : ''); if (key === 'workOpen') nEl.title = plural(n, 'open action'); }
    });
    document.querySelectorAll('[data-need="workCenter"]').forEach((el) => { if (!el.hasAttribute('data-wh')) el.hidden = access.workCenter === false || !w; });
  }

  /* ------------------------------------------------------------------ today's work */
  const dueChip = (r) => (r.late > 0 ? `<span class="r2t-chip r2t-chip--late"><i></i>${plural(r.late, 'day')} late</span>` : '<span class="r2t-chip r2t-chip--due"><i></i>Today</span>');
  function paintDue(w) {
    const card = $('wh-due');
    const d = w && w.due;
    card.hidden = !d;
    if (!d) return;
    const mine = d.scope === 'mine';
    $('wh-due-h').textContent = mine ? "Today's work" : 'Due today and overdue';
    const chips = [];
    // Every number on this card counts open actions on the Work Center board, and its link opens exactly those.
    const fr = d.fr ? '&fr=' + encodeURIComponent(d.fr) : '';
    if (d.overdue) chips.push(`<a class="r2t-chip r2t-chip--late" href="/work/?view=open&due=past${fr}"><i></i>${dn('overdue', n0(d.overdue), d.overdue)} overdue</a>`);
    if (d.today) chips.push(`<a class="r2t-chip r2t-chip--due" href="/work/?view=open&due=today${fr}"><i></i>${dn('today', n0(d.today), d.today)} due today</a>`);
    $('wh-due-all').setAttribute('href', '/work/?view=open' + fr);
    $('wh-due-chips').innerHTML = chips.join('');
    $('wh-due-all').innerHTML = `Open all ${dn('open', n0(d.open), d.open)}`;
    const list = $('wh-due-list');
    if (!d.rows.length) { list.innerHTML = `<li class="wh-empty">Nothing due or overdue. ${plural(d.open, 'open action')} in the Work Center.</li>`; return; }
    list.innerHTML = d.rows.map((r) => `<li class="wh-row" data-id="${esc(r.id)}" data-cid="${esc(r.cid)}" data-name="${esc(r.partner)}">
      <button type="button" class="wh-chk" data-do="complete" aria-label="Complete: ${esc(r.summary || r.type || 'action')} for ${esc(r.partner)}">${tick}</button>
      <div class="wh-t"><a href="/work/partner/${esc(r.cid)}" data-partner-id="${esc(r.cid)}">${esc(r.partner)}</a><span>${esc(r.summary || r.type || 'Action')}${r.place ? ' · ' + esc(r.place) : ''}</span></div>
      ${dueChip(r)}
      <div class="wh-acts wh-acts--hover"><button type="button" class="wh-do wh-do--go" data-do="complete">Complete</button><button type="button" class="wh-do" data-do="snooze" aria-haspopup="true">Snooze</button><a class="wh-do" href="/work/partner/${esc(r.cid)}" data-partner-id="${esc(r.cid)}">Partner</a></div>
    </li>`).join('') + (d.total > d.rows.length ? `<li class="wh-more"><a href="/work/?view=open&due=now${fr}">${n0(d.total)} due today or overdue</a></li>` : '');
  }

  /* ------------------------------------------------------------------ gifts to thank */
  function paintGifts(w) {
    const card = $('wh-gifts');
    const g = w && w.gifts;
    card.hidden = !g;
    if (!g) return;
    const chips = [];
    if (g.over24) chips.push(`<a class="r2t-chip r2t-chip--late" href="/work/?view=gifts"><i></i>${dn('over24', n0(g.over24), g.over24)} waiting over 24 hours</a>`);
    if (g.first) chips.push(`<a class="r2t-chip r2t-chip--plain" href="/work/?view=gifts">${dn('first', n0(g.first), g.first)} first gifts</a>`);
    $('wh-gifts-chips').innerHTML = chips.join('');
    $('wh-gifts-all').innerHTML = `Open all ${dn('gifts', n0(g.total), g.total)}`;
    const list = $('wh-gifts-list');
    if (!g.rows.length) { list.innerHTML = `<li class="wh-empty">No gifts waiting for a thank-you.${g.week ? ' ' + plural(g.week, 'partner') + ' thanked this week.' : ''}</li>`; return; }
    list.innerHTML = g.rows.map((r) => {
      const late = r.age >= 3;
      return `<li class="wh-row wh-gift" data-gift="${esc(r.giftId)}" data-cid="${esc(r.cid)}">
      <div class="wh-t"><a href="/work/partner/${esc(r.cid)}" data-partner-id="${esc(r.cid)}">${esc(r.name)}</a><span>${fd(r.date)}${r.fund ? ' · ' + esc(r.fund) : ''}${r.owner && D && D.work && D.work.role !== 'director' ? ' · ' + esc(r.owner) : ''}${r.badges.length ? ' · ' + esc(r.badges.join(', ')) : ''}</span></div>
      <span class="wh-amt">${money(r.amount)} <span class="r2t-chip ${late ? 'r2t-chip--late' : 'r2t-chip--plain'}">${r.age <= 0 ? 'Today' : plural(r.age, 'day')}</span></span>
      <div class="wh-acts"><button type="button" class="wh-do wh-do--go" data-thank="${esc(r.giftId)}">Thank</button></div>
    </li>`;
    }).join('') + (g.total > g.rows.length ? `<li class="wh-more"><a href="/work/?view=gifts">${n0(g.total - g.rows.length)} more in Gifts to thank</a></li>` : '');
  }

  /* ------------------------------------------------------------------ the week */
  const goal = (label, n, of, href) => `<a class="wh-goal${n >= of ? ' is-met' : ''}" href="${href}"><b>${esc(label)}</b><span>${n0(n)} of ${n0(of)}</span><div class="r2t-bar" role="presentation"><i style="width:${Math.min(100, Math.round((n / of) * 100))}%"></i></div></a>`;
  function paintWeek(w) {
    const card = $('wh-week');
    const k = w && w.week;
    card.hidden = !k || k.kind === 'plain' || k.kind === 'director_plain';
    if (card.hidden) return;
    const body = $('wh-week-body');
    const sub = $('wh-week-sub');
    if (k.kind === 'director') {
      $('wh-week-h').textContent = 'Your week';
      sub.textContent = k.range;
      const c = k.counts, gl = k.goals;
      const gv = k.giving;
      body.innerHTML = goal('Connections', c.conn, gl.conn, '/work/?view=week') + goal('Meetings', c.mtg, gl.mtg, '/work/?view=week') + goal('One-on-ones', c.oo, gl.oo, '/work/?view=week') + goal('Event scheduled', c.ev, gl.ev, '/work/?view=week')
        + (gv && gv.goal ? `<a class="wh-goal${gv.ytd >= gv.goal ? ' is-met' : ''}" href="/work/?view=week"><b>Giving this year</b><span>${money(gv.ytd)} of ${money(gv.goal)}</span><div class="r2t-bar" role="presentation"><i style="width:${Math.min(100, Math.round(gv.pct || (gv.ytd / gv.goal) * 100))}%"></i></div></a>` : '');
    } else if (k.kind === 'support' || k.kind === 'admin') {
      $('wh-week-h').textContent = k.kind === 'admin' ? 'Entry' : 'Your week';
      sub.textContent = '';
      const e = k.entry;
      const owners = e && e.owners ? e.owners.filter((o) => o.wait) : [];
      body.innerHTML = `<div data-tool="leaf"><a class="wh-big" href="/work/?view=intake"><b>${n0(e ? e.wait : 0)}</b><span>${e && e.wait === 1 ? 'contact' : 'contacts'} waiting to enter in Blackbaud${e && e.late ? `, ${n0(e.late)} from earlier weeks` : ''}</span></a></div>`
        + (owners.length ? `<div class="wh-owners">${owners.slice(0, 7).map((o) => `<a href="/work/?view=intake"><span>${esc(o.name)}</span>${o.late ? `<span class="r2t-chip r2t-chip--late">${n0(o.late)} late</span>` : ''}<b>${n0(o.wait)}</b></a>`).join('')}</div>` : '')
        + `<div class="wh-kv wh-kv--1"><a href="/work/?view=recent"><b>${n0(k.sending)}</b><span>${k.sending === 1 ? 'change' : 'changes'} waiting to send</span></a></div>`;
    } else if (k.kind === 'pc') {
      $('wh-week-h').textContent = 'Cadence';
      sub.textContent = '';
      const s = k.stats;
      body.innerHTML = `<div data-tool="leaf"><a class="wh-big" href="/work/?view=cadence"><b>${n0(s.due)}</b><span>${s.due === 1 ? 'partner is' : 'partners are'} due for contact</span></a></div>`
        + `<div class="wh-kv"><a href="/work/?view=cadence"><b>${n0(s.first)}</b><span>First contact</span></a><a href="/work/?view=cadence"><b>${n0(s.repeat)}</b><span>Monthly or longer</span></a><a href="/work/?view=cadence"><b>${n0(s.quarterly)}</b><span>Quarterly</span></a></div>`
        + `<div class="wh-kv"><a href="/work/?view=cadence"><b>${n0(s.week)}</b><span>Done this week</span></a><a href="/work/?view=cadence"><b>${n0(k.lists.friday + k.lists.saturday + k.lists.sunday)}</b><span>On the weekend lists</span></a><a href="/work/?view=cadence"><b>${n0(k.everyone)}</b><span>Partners held</span></a></div>`;
    }
  }

  /* ------------------------------------------------------------------ requests */
  const KIND = { request: 'sky', expense: 'terra', meeting: 'teal' };
  function reqRows(list, chip) {
    return list.map((r) => `<a href="${esc(r.href)}"><span class="r2t-ico r2t-ico--sm" data-tool="${KIND[r.kind] || 'slate'}">${arrow}</span><span class="wh-t"><b>${esc(r.title)}</b><span>${esc(r.sub || r.status || '')}</span></span>${chip(r)}</a>`).join('');
  }
  function paintReq(d) {
    const wt = d.waiting || { rows: [], totals: {} };
    const t = wt.totals || {};
    const chips = [];
    if (t.requests) chips.push(`<a class="r2t-chip r2t-chip--due" href="/requests/"><i></i>${n0(t.requests)} to review</a>`);
    if (t.expenses) chips.push(`<a class="r2t-chip r2t-chip--due" href="/expenses/"><i></i>${n0(t.expenses)} to sign</a>`);
    if (t.meetings) chips.push(`<a class="r2t-chip r2t-chip--plain" href="/meet/library/">${n0(t.meetings)} meeting ${t.meetings === 1 ? 'item' : 'items'}</a>`);
    $('wh-req-chips').innerHTML = chips.join('');
    const mine = (d.mine || []).map((m) => ({ ...m, sub: m.status }));
    let html = '';
    if (wt.rows.length) html += `<div class="wh-sub">Waiting on you</div><div class="wh-rl">${reqRows(wt.rows, (r) => `<span class="r2t-chip r2t-chip--plain">${esc(ago(r.at))}</span>`)}</div>`;
    if (mine.length) html += `<div class="wh-sub">Your requests</div><div class="wh-rl">${reqRows(mine, (r) => `<span class="r2t-chip ${/Approved|Done/.test(r.status) ? 'r2t-chip--ok' : 'r2t-chip--plain'}">${esc(r.status)}</span>`)}</div>`;
    $('wh-req-body').innerHTML = html || '<div class="wh-empty" style="padding:0">Nothing waiting on you and no open requests of your own.</div>';
  }

  /* ------------------------------------------------------------------ recent activity */
  const APPS = { Requests: '/requests/', Expenses: '/expenses/', Receipts: '/receipts/', Foundations: '/foundations/' };
  function paintFeed(d) {
    const w = d.work;
    const items = [];
    if (w && w.recent) for (const b of w.recent) items.push({ at: b.at, text: `${b.actor ? b.actor + ': ' : ''}${b.label}${b.failed ? ` (${n0(b.failed)} not sent)` : ''}`, href: '/work/?view=recent', tool: 'leaf' });
    for (const a of d.activity || []) items.push({ at: a.at, text: a.text, href: APPS[a.app] || '/', tool: { Requests: 'sky', Expenses: 'terra', Receipts: 'sun', Foundations: 'slate' }[a.app] || 'slate' });
    items.sort((a, b) => (a.at < b.at ? 1 : -1));
    const top = items.slice(0, 9);
    $('wh-feed-list').innerHTML = top.length
      ? top.map((i) => `<li><a class="wh-fr" href="${esc(i.href)}"><span class="r2t-ico r2t-ico--sm" data-tool="${i.tool}">${arrow}</span><p>${esc(i.text)}</p><time datetime="${esc(i.at)}">${esc(ago(i.at))}</time></a></li>`).join('')
      : '<li class="wh-empty">No activity in the last 7 days.</li>';
  }

  /* ------------------------------------------------------------------ team (admins) */
  function paintTeam(w) {
    const card = $('wh-team');
    const t = w && w.team;
    card.hidden = !t || !t.people.length;
    if (card.hidden) return;
    const over = t.all ? t.all.overdue : t.people.reduce((n, p) => n + p.overdue, 0);
    $('wh-team-chips').innerHTML = over ? `<a class="r2t-chip r2t-chip--late" href="/work/?view=open&quick=past"><i></i>${n0(over)} overdue</a>` : '';
    const TEAM = { rdd: 'RDD', church: 'Church Engagement', partner_care: 'Partner Care', support: 'Support', grants: 'Grants', exec: 'Executive', admin: 'Operations' };
    $('wh-team-table').innerHTML = '<thead><tr><th>Person</th><th>Team</th><th class="n">Open</th><th class="n">Overdue</th><th class="n">Thank-yous</th></tr></thead><tbody>'
      + t.people.map((p) => `<tr><td><a href="/work/?view=open&fr=${esc(p.fid)}">${esc(p.name)}</a></td><td>${esc(TEAM[p.team] || p.team || '')}</td><td class="n"><a href="/work/?view=open&fr=${esc(p.fid)}">${dn('teamopen', n0(p.open), p.open)}</a></td><td class="n"><a href="/work/?view=open&fr=${esc(p.fid)}&quick=past" class="${p.overdue ? 'wh-late' : ''}">${dn('teamlate', n0(p.overdue), p.overdue)}</a></td><td class="n"><a href="/work/?view=ty">${dn('teamty', n0(p.ty), p.ty)}</a></td></tr>`).join('') + '</tbody>'
      + (t.all ? `<tfoot><tr><td>Everyone</td><td>Each action once</td><td class="n"><a href="/work/?view=open">${dn('teamopen', n0(t.all.open), t.all.open)}</a></td><td class="n"><a href="/work/?view=open&quick=past">${dn('teamlate', n0(t.all.overdue), t.all.overdue)}</a></td><td class="n"><a href="/work/?view=ty">${dn('teamty', n0(t.all.ty), t.all.ty)}</a></td></tr></tfoot>` : '');
  }

  function paint(d) {
    D = d;
    paintTop(d);
    paintDue(d.work);
    paintGifts(d.work);
    paintWeek(d.work);
    paintReq(d);
    paintFeed(d);
    paintTeam(d.work);
    root.removeAttribute('aria-busy');
  }
  /* ------------------------------------------------------------------ loading: last copy first, then fresh */
  async function load(fresh) {
    if (loading) { if (fresh) setTimeout(() => load(true), 600); return; }
    loading = true;
    try {
      const d = await api('/api/hub/home' + (fresh ? '?fresh=1' : ''));
      try { sessionStorage.setItem(KEY, JSON.stringify(d)); } catch (_) { /* storage refused */ }
      paint(d);
    } catch (e) {
      if (!D) $('wh-req-body').innerHTML = `<div class="wh-empty" style="padding:0">${esc(e.message)} <button type="button" class="wh-do" data-reload>Try again</button></div>`;
    }
    loading = false;
  }
  try { const hit = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (hit && hit.ok) paint(hit); } catch (_) { /* no copy yet */ }
  load();

  /* ------------------------------------------------------------------ complete and snooze */
  async function drive(bid) {
    for (let i = 0; i < 40; i++) {
      const r = await post(`/api/work/batches/${bid}/run`);
      if (r.held === 'busy') { await sleep(1500); continue; }
      if (r.held || !r.left) break;
      await sleep(1200);
    }
  }
  async function change(li, body, msg) {
    li.classList.add('is-busy');
    try {
      const out = await post('/api/work/batches', Object.assign({ req: F().reqId() }, body));
      const b = out.batch;
      li.classList.remove('is-busy'); li.classList.add('is-gone');
      F().toast(msg, b && b.id ? [b.id] : null);
      setTimeout(() => load(true), 260);
      if (b && b.id && b.run_when !== 'tonight') {
        drive(b.id).then(async () => {
          const rc = (await api('/api/work/recent').catch(() => ({ batches: [] }))).batches || [];
          const mine = rc.find((x) => x.id === b.id);
          if (mine && mine.failed) { F().toast('Blackbaud turned it down. Nothing was lost. Recent has Try again.', [b.id], true); load(true); }
        }).catch(() => undefined);
      }
    } catch (e) {
      li.classList.remove('is-busy');
      F().toast(e.message, null, true);
    }
  }

  let snz = null;
  function closeSnooze() { if (snz) { snz.remove(); snz = null; } }
  function openSnooze(btn, li) {
    closeSnooze();
    const t = TODAY();
    const opts = [['Tomorrow', addDays(t, 1)], ['In 3 days', addDays(t, 3)], ['Next week', addDays(t, 7)]];
    snz = document.createElement('div');
    snz.className = 'wh-snz'; snz.setAttribute('role', 'menu');
    snz.innerHTML = opts.map(([l, d]) => `<button type="button" role="menuitem" data-d="${d}">${l} (${fd(d)})</button>`).join('') + `<label>Pick a date<input type="date" min="${addDays(t, 1)}" /></label>`;
    document.body.appendChild(snz);
    const r = btn.getBoundingClientRect();
    snz.style.top = Math.min(innerHeight - snz.offsetHeight - 8, r.bottom + 6) + 'px';
    snz.style.left = Math.max(8, Math.min(innerWidth - 208, r.right - 200)) + 'px';
    const go = (d) => { closeSnooze(); change(li, { op: 'reschedule', ids: [li.dataset.id], due: d }, `Moved ${li.dataset.name} to ${fd(d)}`); };
    snz.addEventListener('click', (e) => { const b = e.target.closest('button[data-d]'); if (b) go(b.dataset.d); });
    snz.querySelector('input').addEventListener('change', (e) => { if (e.target.value) go(e.target.value); });
    const first = snz.querySelector('button'); if (first) first.focus();
  }
  document.addEventListener('click', (e) => { if (snz && !snz.contains(e.target) && !e.target.closest('[data-do="snooze"]')) closeSnooze(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSnooze(); });

  root.addEventListener('click', (e) => {
    const rel = e.target.closest('[data-reload]');
    if (rel) { load(); return; }
    const act = e.target.closest('[data-do]');
    if (act && F()) {
      const li = act.closest('.wh-row');
      if (!li) return;
      if (act.dataset.do === 'complete') { change(li, { op: 'complete', ids: [li.dataset.id], how: 'none' }, `Completed for ${li.dataset.name}`); return; }
      if (act.dataset.do === 'snooze') { openSnooze(act, li); return; }
    }
    const th = e.target.closest('[data-thank]');
    if (th && F() && D && D.work && D.work.gifts) {
      const r = D.work.gifts.rows.find((x) => x.giftId === th.dataset.thank);
      if (r) F().pop(th, { giftId: r.giftId, cid: r.cid, name: r.name, amount: r.amount, date: r.date, fund: r.fund, phone: r.phone, left: null, tasks: r.tasks, team: r.team });
      return;
    }
    const q = e.target.closest('[data-q]');
    if (q) openPick(q.dataset.q);
  });

  // A thank-you saved here or in the drawer takes its row off at once and refreshes the list.
  document.addEventListener('favor:thanked', (e) => {
    const ids = new Set(((e.detail && e.detail.items) || []).map((i) => String(i.giftId)));
    document.querySelectorAll('#wh-gifts-list .wh-gift').forEach((li) => { if (ids.has(li.dataset.gift)) li.classList.add('is-gone'); });
    setTimeout(() => load(true), 1800);
  });
  document.addEventListener('favor:thanked-failed', () => load(true));
  document.addEventListener('favor:thanked-undone', () => load(true));

  /* ------------------------------------------------------------------ quick actions and search */
  function ready(fn, n) {
    if (window.FavorPartner && window.FavorWG) { fn(); return; }
    if ((n || 0) < 60) setTimeout(() => ready(fn, (n || 0) + 1), 100);
  }
  function openPick(kind) {
    const host = $('wh-pick');
    ready(() => {
      host.hidden = false;
      host.innerHTML = `<p>${kind === 'task' ? 'Which partner is the task for?' : 'Which partner did you contact?'}</p><div id="wh-pick-s"></div>`;
      const input = window.FavorPartner.search($('wh-pick-s'), { placeholder: 'Find a partner', onPick: (h) => { host.hidden = true; host.innerHTML = ''; window.FavorPartner.openCompose(h.cid, kind); } });
      if (input) input.focus();
    });
  }
  ready(() => {
    const find = $('wh-find');
    if (find && !find.firstChild) window.FavorPartner.search(find, { placeholder: 'Find a partner' });
  });
})();
