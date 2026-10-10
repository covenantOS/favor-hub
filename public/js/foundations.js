/* Foundation prospects: search, list, history, and logging a contact that posts to Blackbaud. */
(() => {
  const $ = (id) => document.getElementById(id);
  const app = $('fnd-app');
  if (!app) return;

  const login = $('fnd-login');
  const loginMsg = $('fnd-login-msg');
  const actions = $('fnd-actions');
  const whoEl = $('fnd-who');
  const qEl = $('fnd-q');
  const qClear = $('fnd-q-clear');
  const resultsEl = $('fnd-results');
  const bodyEl = $('fnd-body');
  const drawer = $('fnd-drawer');
  const panel = $('fnd-panel');
  const toastEl = $('fnd-toast');

  const state = { list: [], meta: null, filter: 'all', sort: 'contacts', tab: 'list', openId: null, detail: null, bb: null, cleanup: null };

  const esc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const plural = (n, w) => `${n} ${w}${Number(n) === 1 ? '' : 's'}`;
  const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${MON[+m[2] - 1]} ${+m[3]}, ${m[1]}` : '';
  };
  const stamp = (iso) =>
    iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const firstNames = (csv) => String(csv || '').split(',').filter(Boolean).map((n) => n.trim().split(' ')[0]).join(', ');
  const today = () => {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  let toastTimer = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 3400);
  }

  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (opts.body) headers['Content-Type'] = 'application/json';
    const who = (whoEl.value || '').trim();
    if (who) headers['X-Fnd-Actor'] = encodeURIComponent(who);
    const res = await fetch(path, { credentials: 'same-origin', ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.error === 'signin') {
      location.href = '/login/?next=' + encodeURIComponent(location.pathname + location.search);
      throw new Error('Sign in again.');
    }
    if (res.status === 401 && path !== '/api/foundations/login' && data.error === 'unauthorized') {
      showLocked();
      throw new Error('Enter the code again.');
    }
    if (!res.ok || data.ok === false) {
      const err = new Error(data.message || 'Something went wrong. Try again.');
      err.data = data;
      throw err;
    }
    return data;
  }

  /* ------------------------------------------------------------ status */

  function statusOf(f) {
    if (f.status === 'dead') return ['dead', 'Dead end', 'fnd-pill-dead'];
    if (f.bb_lookup_id) return ['in', 'In Blackbaud', 'approved'];
    if (!Number(f.contacts)) return ['new', 'Not contacted', 'fnd-pill-new'];
    if (String(f.rdds || '').split(',').filter(Boolean).length > 1) return ['two', 'Two fundraisers', 'fnd-pill-two'];
    if (Number(f.contacts) > 1) return ['work', 'Working', 'fnd-pill-work'];
    return ['once', 'Contacted once', 'pending'];
  }
  const pill = (f) => {
    const s = statusOf(f);
    return `<span class="exp-pill ${s[2]}">${s[1]}</span>`;
  };

  /* -------------------------------------------------------------- lock */

  function showLocked() {
    app.hidden = true;
    actions.hidden = true;
    login.hidden = false;
    closeDrawer();
    setTimeout(() => $('fnd-code').focus(), 50);
  }

  login.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginMsg.textContent = '';
    try {
      await api('/api/foundations/login', { method: 'POST', body: JSON.stringify({ code: $('fnd-code').value }) });
      $('fnd-code').value = '';
      await load();
    } catch (err) {
      loginMsg.textContent = err.message;
    }
  });

  $('fnd-lock').addEventListener('click', async () => {
    await fetch('/api/foundations/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    showLocked();
  });

  whoEl.value = localStorage.getItem('fnd_actor') || '';
  whoEl.addEventListener('change', () => {
    localStorage.setItem('fnd_actor', whoEl.value.trim());
    whoEl.parentElement.classList.remove('is-bad');
  });

  /** Signed in with Google: the name comes from the account, so "Entered by" and Lock go away. */
  function useSignedInName(name) {
    whoEl.value = name;
    localStorage.setItem('fnd_actor', name);
    const label = whoEl.closest('label');
    if (label) label.hidden = true;
    $('fnd-lock').hidden = true;
  }

  function needWho() {
    if ((whoEl.value || '').trim()) return false;
    whoEl.parentElement.classList.add('is-bad');
    whoEl.focus();
    toast('Put your name in "Entered by" first.');
    return true;
  }

  /* -------------------------------------------------------------- load */

  async function load() {
    const data = await api('/api/foundations');
    state.list = data.foundations;
    state.meta = data;
    login.hidden = true;
    app.hidden = false;
    actions.hidden = false;
    render();
  }

  function render() {
    renderStats();
    renderTabs();
    renderFilters();
    renderRows();
  }

  function renderStats() {
    const L = state.list;
    const stats = [
      [L.length, 'Foundations'],
      [L.reduce((s, f) => s + Number(f.contacts || 0), 0), 'Contacts logged'],
      [L.filter((f) => f.bb_lookup_id).length, 'Have a Blackbaud record'],
      [L.filter((f) => f.status === 'dead').length, 'Dead ends'],
    ];
    $('fnd-stats').innerHTML = stats
      .map((s) => `<div class="ticker__stat"><div class="ticker__num">${s[0].toLocaleString('en-US')}</div><div class="ticker__caption">${s[1]}</div></div>`)
      .join('');
  }

  function renderTabs() {
    const misplaced = state.list.reduce((s, f) => s + Number(f.misplaced || 0), 0);
    const tabs = [
      ['list', 'Prospects', state.list.length],
      ['cleanup', 'To clean up', misplaced],
      ['activity', 'Sent to Blackbaud', ''],
    ];
    $('fnd-tabs').innerHTML = tabs
      .map((t) => `<button type="button" role="tab" data-tab="${t[0]}" class="${state.tab === t[0] ? 'is-on' : ''}">${t[1]}${t[2] === '' ? '' : `<span>${t[2]}</span>`}</button>`)
      .join('');
    $('fnd-view-list').hidden = state.tab !== 'list';
    $('fnd-view-cleanup').hidden = state.tab !== 'cleanup';
    $('fnd-view-activity').hidden = state.tab !== 'activity';
  }

  $('fnd-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    state.tab = b.dataset.tab;
    renderTabs();
    if (state.tab === 'cleanup') loadCleanup();
    if (state.tab === 'activity') loadActivity();
  });

  const FILTERS = [
    ['all', 'All'],
    ['work', 'Working'],
    ['once', 'Contacted once'],
    ['two', 'Two fundraisers'],
    ['in', 'In Blackbaud'],
    ['dead', 'Dead ends'],
  ];

  function renderFilters() {
    const count = (k) => (k === 'all' ? state.list.length : state.list.filter((f) => statusOf(f)[0] === k).length);
    $('fnd-filters').innerHTML =
      FILTERS.map((f) => `<button type="button" data-filter="${f[0]}" class="${state.filter === f[0] ? 'on' : ''}">${f[1]}<small>${count(f[0])}</small></button>`).join('') +
      `<select id="fnd-sort" aria-label="Sort">
        <option value="contacts"${state.sort === 'contacts' ? ' selected' : ''}>Most contacts first</option>
        <option value="recent"${state.sort === 'recent' ? ' selected' : ''}>Latest contact first</option>
        <option value="name"${state.sort === 'name' ? ' selected' : ''}>By name</option>
      </select>`;
    $('fnd-sort').addEventListener('change', (e) => {
      state.sort = e.target.value;
      renderRows();
    });
  }

  $('fnd-filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    state.filter = b.dataset.filter;
    renderFilters();
    renderRows();
  });

  function visibleRows() {
    let rows = state.list.filter((f) => state.filter === 'all' || statusOf(f)[0] === state.filter);
    if (state.sort === 'recent') rows = rows.slice().sort((a, b) => String(b.last_contact || '').localeCompare(String(a.last_contact || '')));
    else if (state.sort === 'name') rows = rows.slice().sort((a, b) => a.name.replace(/^the /i, '').localeCompare(b.name.replace(/^the /i, '')));
    return rows;
  }

  function renderRows() {
    const rows = visibleRows();
    $('fnd-rows').innerHTML = rows.length
      ? rows
          .map(
            (f) => `<tr class="exp-admin-row" data-id="${esc(f.id)}" tabindex="0">
              <td><span class="fnd-name">${esc(f.name)}</span>${f.location ? `<span class="fnd-sub">${esc(f.location)}</span>` : ''}</td>
              <td class="r mono">${Number(f.contacts) || 0}</td>
              <td class="mono">${day(f.last_contact) || 'None yet'}</td>
              <td>${esc(firstNames(f.rdds)) || ''}</td>
              <td>${pill(f)}${Number(f.waiting) ? `<span class="fnd-flag">${f.waiting} waiting</span>` : ''}</td>
            </tr>`
          )
          .join('')
      : `<tr><td colspan="5" class="fnd-empty">Nothing here yet.</td></tr>`;
  }

  // Open in Google Sheets: the rows the list shows now, in the order shown.
  if (window.FavorSheets) {
    window.FavorSheets.register('foundations', () => {
      const rows = visibleRows();
      const f = FILTERS.find((x) => x[0] === state.filter);
      return window.FavorSheets.screen('Foundation prospects', [{
        name: 'Foundations',
        columns: [
          { key: 'name', label: 'Foundation', type: 'text' }, { key: 'location', label: 'Location', type: 'text' }, { key: 'contacts', label: 'Contacts', type: 'int' },
          { key: 'last_contact', label: 'Last contact', type: 'date' }, { key: 'rdds', label: 'Fundraiser', type: 'text' }, { key: 'status', label: 'Status', type: 'text' },
          { key: 'waiting', label: 'Waiting', type: 'int' }, { key: 'bb', label: 'Blackbaud lookup ID', type: 'id' },
        ],
        rows: rows.map((r) => ({ name: r.name, location: r.location || '', contacts: Number(r.contacts) || 0, last_contact: r.last_contact ? String(r.last_contact).slice(0, 10) : null, rdds: firstNames(r.rdds) || '', status: statusOf(r)[1], waiting: Number(r.waiting) || 0, bb: r.bb_lookup_id || '' })),
      }], { filters: f && f[0] !== 'all' ? `Showing: ${f[1]}` : '' });
    });
  }

  $('fnd-rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) openFoundation(tr.dataset.id);
  });
  $('fnd-rows').addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openFoundation(tr.dataset.id);
    }
  });

  /* ------------------------------------------------------------ search */

  function advice(o) {
    const who = o.held.length ? (o.held.includes('Joe Krol') ? "Joe Krol's team" : o.held.join(', ')) : '';
    if (o.gifts) return ['', `Has given ${plural(o.gifts, 'gift')}, ${money(o.gift_total)} in all, last ${day(o.last_gift)}. ${who ? `Talk to ${who} before you call.` : 'No one is assigned.'}`];
    if (o.grant_actions) return ['', `The grants team has ${plural(o.grant_actions, 'grant action')} here${o.last_grant ? `, last ${day(o.last_grant)}` : ''}. ${who ? `Talk to ${who} before you call.` : ''}`];
    if (who) return ['', `Held by ${who}. ${o.contacts ? `${plural(o.contacts, 'contact')} logged, last ${day(o.last_contact)}.` : 'No contact logged.'}`];
    return ['is-clear', `In Blackbaud with no one assigned${o.contacts ? `, ${plural(o.contacts, 'contact')} logged, last ${day(o.last_contact)}.` : ' and no contact logged.'}`];
  }

  function orgCard(o, i, extra) {
    const a = advice(o);
    return `<div class="req-card fnd-hit--static" style="--i:${i}">
      <div class="req-card__kicker"><span>#${esc(o.lookup_id)}${o.where ? ` · ${esc(o.where)}` : ''}</span><span>${esc(o.codes.join(' · ') || 'No code')}</span></div>
      <h3>${esc(o.name)}</h3>
      <p>Record made ${day(o.made)}${extra || ''}</p>
      <p class="fnd-advice ${a[0]}">${esc(a[1])}</p>
    </div>`;
  }

  let searchTimer = null;
  let searchSeq = 0;
  function onSearch() {
    const q = qEl.value.trim();
    qClear.hidden = !q;
    clearTimeout(searchTimer);
    if (q.length < 2) {
      resultsEl.hidden = true;
      bodyEl.hidden = false;
      return;
    }
    searchTimer = setTimeout(() => runSearch(q), 220);
  }

  async function runSearch(q) {
    const seq = ++searchSeq;
    let data;
    try {
      data = await api('/api/foundations/check?q=' + encodeURIComponent(q));
    } catch (err) {
      return;
    }
    if (seq !== searchSeq || qEl.value.trim() !== q) return;
    bodyEl.hidden = true;
    resultsEl.hidden = false;
    const P = data.prospects;
    const B = data.blackbaud;
    if (!P.length && !B.length) {
      resultsEl.innerHTML = `<div class="fnd-none"><strong>Nothing under "${esc(q)}"</strong>
        ${data.offline ? 'Blackbaud could not be reached, so this covers the prospect list only.' : 'It is on neither the prospect list nor in Blackbaud. No one at Favor has logged a contact with it.'}
        <div><button type="button" class="req-submit" data-add="${esc(q)}">Add it to the list</button></div></div>`;
      return;
    }
    const linked = new Set(P.filter((p) => p.bb_lookup_id).map((p) => p.bb_lookup_id));
    resultsEl.innerHTML = `
      <section class="req-col">
        <div class="req-col__head"><h2>On the prospect list</h2><span>${P.length}</span></div>
        <div class="req-col__stack">${
          P.length
            ? P.map(
                (p, i) => `<button type="button" class="req-card" data-id="${esc(p.id)}" style="--i:${i}">
                  <div class="req-card__kicker"><span>${esc(p.location || firstNames(p.rdds) || 'New')}</span><span>${esc(statusOf(p)[1])}</span></div>
                  <h3>${esc(p.name)}</h3>
                  <p>${Number(p.contacts) ? `${plural(p.contacts, 'contact')}, last ${day(p.last_contact)} by ${esc(p.last_rdd || 'staff')}` : 'No contact logged yet'}</p>
                  ${p.status === 'dead' ? `<p class="fnd-advice">Dead end${p.dead_reason ? `: ${esc(p.dead_reason)}` : '.'}</p>` : p.bb_lookup_id ? `<p class="fnd-advice">Already in Blackbaud as #${esc(p.bb_lookup_id)}.</p>` : ''}
                </button>`
              ).join('')
            : `<p class="req-empty">Not on the list.</p><p class="req-empty" style="padding-top:0"><button type="button" class="fnd-textbtn" data-add="${esc(q)}">Add it to the list</button></p>`
        }</div>
      </section>
      <section class="req-col">
        <div class="req-col__head"><h2>In Blackbaud</h2><span>${data.offline ? 'offline' : B.length}</span></div>
        <div class="req-col__stack">${
          data.offline
            ? '<p class="req-empty">Blackbaud could not be reached. Try again in a minute.</p>'
            : B.length
              ? B.map((o, i) => orgCard(o, i, linked.has(o.lookup_id) ? ' · also on the prospect list' : '')).join('')
              : '<p class="req-empty">No organization in Blackbaud has this name.</p>'
        }</div>
      </section>`;
  }

  qEl.addEventListener('input', onSearch);
  qClear.addEventListener('click', () => {
    qEl.value = '';
    onSearch();
    qEl.focus();
  });
  resultsEl.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) return openAdd(add.dataset.add);
    const card = e.target.closest('[data-id]');
    if (card) openFoundation(card.dataset.id);
  });

  /* ------------------------------------------------------------ drawer */

  function openDrawer() {
    drawer.hidden = false;
    document.documentElement.style.overflow = 'hidden';
  }
  function closeDrawer() {
    drawer.hidden = true;
    document.documentElement.style.overflow = '';
    state.openId = null;
    state.detail = null;
    state.bb = null;
  }
  drawer.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeDrawer();
  });

  async function openFoundation(id, keepSlot) {
    state.openId = id;
    if (!keepSlot) {
      panel.innerHTML = '<button type="button" class="req-ghost fnd-close" data-close>Close</button><p class="req-empty">Loading</p>';
      openDrawer();
      panel.scrollTop = 0;
    }
    let data;
    try {
      data = await api('/api/foundations/' + encodeURIComponent(id));
    } catch (err) {
      panel.innerHTML = `<button type="button" class="req-ghost fnd-close" data-close>Close</button><p class="req-msg">${esc(err.message)}</p>`;
      return;
    }
    if (state.openId !== id) return;
    state.detail = data;
    renderDetail();
    api('/api/foundations/' + encodeURIComponent(id) + '/blackbaud')
      .then((bb) => {
        if (state.openId !== id) return;
        state.bb = bb;
        renderBb();
      })
      .catch(() => {});
  }

  function renderDetail(slotHtml) {
    const f = state.detail.foundation;
    const C = state.detail.contacts;
    const listRow = state.list.find((x) => x.id === f.id) || { contacts: C.length, rdds: [...new Set(C.map((c) => c.rdd).filter(Boolean))].join(','), status: f.status, bb_lookup_id: f.bb_lookup_id };
    const facts = [];
    if (f.phone) facts.push(esc(f.phone));
    if (f.website) facts.push(`<a href="${esc(/^https?:/i.test(f.website) ? f.website : 'https://' + f.website)}" target="_blank" rel="noopener">${esc(f.website.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''))}</a>`);
    if (f.email) facts.push(esc(f.email));
    if (f.assets) facts.push('Assets ' + esc(f.assets));
    panel.innerHTML = `
      <button type="button" class="req-ghost fnd-close" data-close>Close</button>
      <div class="req-card__kicker"><span>${esc(f.location || 'No address on file')}</span><span>${f.ein ? 'EIN ' + esc(f.ein) : ''}</span></div>
      <h2>${esc(f.name)}</h2>
      <div class="req-drawer__meta">${pill(Object.assign({}, listRow, { status: f.status, bb_lookup_id: f.bb_lookup_id, contacts: C.length }))}<span class="req-chip">${plural(C.length, 'contact')}</span></div>
      ${facts.length ? `<p class="fnd-facts">${facts.join(' · ')}</p>` : ''}
      ${f.notes ? `<p class="fnd-facts">${esc(f.notes)}</p>` : ''}
      ${f.status === 'dead' ? `<div class="fnd-bb is-warn"><span class="fnd-bb__kicker">Dead end</span>${esc(f.dead_reason || 'No reason given.')}<small>It stays on the list so nobody calls it cold again. Nothing about this went to Blackbaud.</small></div>` : ''}
      <div class="fnd-bb" id="fnd-bb"><span class="fnd-bb__kicker">Blackbaud</span>Checking Blackbaud.</div>
      <div class="req-actions">
        <button type="button" class="primary" data-act="log">Log a contact</button>
        <button type="button" data-act="${f.status === 'dead' ? 'reopen' : 'dead'}">${f.status === 'dead' ? 'Reopen' : 'Mark dead end'}</button>
        <button type="button" data-act="edit">Edit details</button>
      </div>
      <div id="fnd-slot">${slotHtml || ''}</div>
      <span class="exp-legend">History</span>
      <ul class="fnd-tl">${C.length ? C.map(contactHtml).join('') : '<li><p class="is-blank">No contact logged yet.</p></li>'}</ul>`;
    renderBb();
  }

  function contactHtml(c) {
    const pills = [];
    if (c.bb_state === 'posted') pills.push(`<span class="exp-pill approved">In Blackbaud · #${esc(c.bb_on || '')}</span>`);
    else if (c.bb_state === 'failed') pills.push('<span class="exp-pill fnd-pill-two">Did not post</span>');
    else if (c.bb_state === 'held') pills.push('<span class="exp-pill fnd-pill-work">Held, posting is off</span>');
    else pills.push('<span class="exp-pill fnd-pill-work">Waiting to post</span>');
    if (c.outcome) pills.push(`<span class="exp-pill pending">${esc(c.outcome)}</span>`);
    (c.tags || []).forEach((t) => pills.push(`<span class="exp-pill pending">${esc(t)}</span>`));
    if (c.bb_tags_state === 'waiting') pills.push('<span class="exp-pill fnd-pill-work" title="The tags are saved here and go to Blackbaud once the connection allows it.">Tags waiting</span>');
    const controls = [];
    if (c.source === 'app' && c.bb_state !== 'posted') controls.push(`<button type="button" class="fnd-textbtn" data-retry="${esc(c.id)}">Try again</button>`);
    if (c.source === 'app') controls.push(`<button type="button" class="fnd-textbtn is-danger" data-remove="${esc(c.id)}">Remove</button>`);
    return `<li data-contact="${esc(c.id)}">
      <div class="fnd-tl__head"><b>${esc(c.how === 'Other' ? c.category : c.how)}${c.rdd ? ` · ${esc(c.rdd)}` : ''}</b><span>${day(c.date)}</span></div>
      <p class="${c.note ? '' : 'is-blank'}">${esc(c.note) || 'No note.'}</p>
      <div class="fnd-tl__foot">${pills.join('')}${controls.join('')}</div>
      ${c.bb_state !== 'posted' && c.bb_error ? `<div class="fnd-tl__err">${esc(c.bb_error)}</div>` : ''}
    </li>`;
  }

  function renderBb() {
    const box = $('fnd-bb');
    if (!box || !state.detail) return;
    const f = state.detail.foundation;
    const catchAll = state.meta.catch_all;
    const onCatch = state.detail.contacts.filter((c) => c.bb_state === 'posted' && c.bb_on === catchAll.lookup).length;
    const bb = state.bb;
    if (f.bb_lookup_id) {
      const o = bb && bb.linked;
      const line = o
        ? [o.where, o.held.length ? 'Held by ' + o.held.join(', ') : 'No one assigned', o.gifts ? `${plural(o.gifts, 'gift')}, ${money(o.gift_total)}` : 'No gifts', o.grant_actions ? plural(o.grant_actions, 'grant action') : '']
            .filter(Boolean)
            .join(' · ')
        : bb && bb.offline
          ? 'Blackbaud could not be reached for the details.'
          : '';
      box.className = 'fnd-bb is-in';
      box.innerHTML = `<span class="fnd-bb__kicker">In Blackbaud · #${esc(f.bb_lookup_id)}${o && o.codes.length ? ' · ' + esc(o.codes.join(' · ')) : ''}</span>
        <b>${esc(f.bb_name || f.name)}</b>${line ? `<br>${esc(line)}` : ''}
        <small>New contacts post to this record.${onCatch ? ` ${plural(onCatch, 'earlier contact')} still ${onCatch === 1 ? 'sits' : 'sit'} on the ${esc(catchAll.name)} record (#${esc(catchAll.lookup)}).` : ''}${f.bb_match_reason ? ` Matched on: ${esc(f.bb_match_reason.charAt(0).toLowerCase() + f.bb_match_reason.slice(1))}.` : ''}</small>
        <div class="fnd-link"><button type="button" class="fnd-textbtn is-quiet" data-act="unlink">Not the same foundation? Untie it</button></div>`;
      return;
    }
    const sug = (bb && bb.suggestions) || [];
    box.className = 'fnd-bb';
    box.innerHTML = `<span class="fnd-bb__kicker">Not in Blackbaud</span>
      Each contact posts to Blackbaud as an action on the ${esc(catchAll.name)} record (#${esc(catchAll.lookup)}), so the fundraiser's activity still counts.
      ${
        sug.length
          ? `<small>Blackbaud has ${sug.length === 1 ? 'a record' : 'records'} with a similar name. Tie one only when it is the same foundation.</small>
             <ul class="fnd-sug">${sug
               .map(
                 (o) => `<li><div><b>${esc(o.name)}</b> #${esc(o.lookup_id)}<span>${esc([o.where, o.held.length ? 'held by ' + o.held.join(', ') : 'no one assigned', o.gifts ? plural(o.gifts, 'gift') : ''].filter(Boolean).join(' · '))}</span></div>
                 <button type="button" class="fnd-textbtn" data-link="${esc(o.lookup_id)}">This is the one</button></li>`
               )
               .join('')}</ul>`
          : ''
      }
      <div class="fnd-link"><input id="fnd-link-id" inputmode="numeric" placeholder="Constituent ID" aria-label="Blackbaud constituent ID" /><button type="button" class="fnd-textbtn" data-act="link">Tie to its Blackbaud record</button></div>`;
  }

  /* -------------------------------------------------------------- forms */

  function slot(html) {
    const el = $('fnd-slot');
    if (!el) return;
    el.innerHTML = html;
    const first = el.querySelector('input:not([type=radio]):not([type=checkbox]), select, textarea');
    if (first) first.focus();
    if (html) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function logForm() {
    const f = state.detail.foundation;
    const m = state.meta;
    const target = f.bb_lookup_id ? `${f.bb_name || f.name} (#${f.bb_lookup_id})` : `${m.catch_all.name} (#${m.catch_all.lookup})`;
    const lastRdd = localStorage.getItem('fnd_last_rdd') || '';
    const whose = [...new Set(m.people.map((p) => p.team))]
      .map((t) => `<optgroup label="${esc(t)}">${m.people.filter((p) => p.team === t).map((p) => `<option${p.name === lastRdd ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</optgroup>`)
      .join('');
    return `<form class="fnd-form" id="fnd-log">
      <h3>Log a contact</h3>
      <div class="exp-grid2">
        <label class="req-field"><span>Whose contact</span><select name="rdd" required><option value="">Choose</option>${whose}</select></label>
        <label class="req-field"><span>Date</span><input type="date" name="date" value="${today()}" max="${today()}" required /></label>
      </div>
      <fieldset class="make-pills"><legend>How</legend>${m.hows.map((h, i) => `<label><input type="radio" name="how" value="${esc(h)}"${i === 0 ? ' checked' : ''} />${esc(h)}</label>`).join('')}</fieldset>
      <label class="req-field"><span>Outcome</span><select name="outcome"><option value="">Choose</option>${m.outcomes.map((o) => `<option>${esc(o)}</option>`).join('')}</select></label>
      <label class="req-field"><span>What happened</span><textarea name="note" maxlength="4000" placeholder="Who you reached and what they said" required></textarea></label>
      <fieldset class="make-pills"><legend>Mark what applies</legend>${m.tags.map((t) => `<label><input type="checkbox" name="tags" value="${esc(t)}" />${esc(t)}</label>`).join('')}</fieldset>
      <p class="fnd-posts">${m.settings.posting === 'on' ? `Saves here and posts to Blackbaud as an action on <b>${esc(target)}</b>.` : 'Saves here. Posting to Blackbaud is switched off, so it waits.'}</p>
      <div class="fnd-form__foot"><button type="submit" class="req-submit">Save and post</button><button type="button" class="req-ghost" data-act="cancel">Cancel</button><p class="req-msg" aria-live="polite"></p></div>
    </form>`;
  }

  function deadForm(prefill) {
    return `<form class="fnd-form" id="fnd-dead">
      <h3>Mark a dead end</h3>
      <label class="req-field"><span>Why</span><input name="reason" maxlength="300" value="${esc(prefill || '')}" placeholder="Only funds in Texas. Number disconnected. Not interested." required /></label>
      <p class="fnd-posts">Nothing goes to Blackbaud. The foundation stays on this list with its history, so nobody calls it cold again.</p>
      <div class="fnd-form__foot"><button type="submit" class="req-submit">Mark dead end</button><button type="button" class="req-ghost" data-act="cancel">Cancel</button><p class="req-msg" aria-live="polite"></p></div>
    </form>`;
  }

  function fieldsHtml(f) {
    return `
      <label class="req-field"><span>Foundation name</span><input name="name" maxlength="160" value="${esc(f.name || '')}" required /></label>
      <div id="fnd-dupes"></div>
      <div class="exp-grid2">
        <label class="req-field"><span>City and state</span><input name="location" maxlength="120" value="${esc(f.location || '')}" /></label>
        <label class="req-field"><span>Phone</span><input name="phone" maxlength="40" value="${esc(f.phone || '')}" /></label>
      </div>
      <div style="height:14px"></div>
      <div class="exp-grid2">
        <label class="req-field"><span>Website</span><input name="website" maxlength="200" value="${esc(f.website || '')}" /></label>
        <label class="req-field"><span>Email</span><input name="email" maxlength="120" value="${esc(f.email || '')}" /></label>
      </div>
      <div style="height:14px"></div>
      <div class="exp-grid2">
        <label class="req-field"><span>EIN</span><input name="ein" maxlength="20" value="${esc(f.ein || '')}" /></label>
        <label class="req-field"><span>Assets</span><input name="assets" maxlength="60" value="${esc(f.assets || '')}" /></label>
      </div>
      <div style="height:14px"></div>
      <label class="req-field"><span>Notes</span><textarea name="notes" maxlength="2000" style="min-height:80px">${esc(f.notes || '')}</textarea></label>`;
  }

  function editForm() {
    return `<form class="fnd-form" id="fnd-edit"><h3>Edit details</h3>${fieldsHtml(state.detail.foundation)}
      <div class="fnd-form__foot"><button type="submit" class="req-submit">Save</button><button type="button" class="req-ghost" data-act="cancel">Cancel</button><p class="req-msg" aria-live="polite"></p></div></form>`;
  }

  function openAdd(name) {
    state.openId = 'new';
    state.detail = null;
    state.bb = null;
    panel.innerHTML = `<button type="button" class="req-ghost fnd-close" data-close>Close</button>
      <div class="req-card__kicker"><span>New prospect</span></div>
      <h2>Add a foundation</h2>
      <p class="fnd-facts">Nothing goes to Blackbaud until someone logs a contact.</p>
      <form class="fnd-form" id="fnd-new">${fieldsHtml({ name: name || '' })}
        <div class="fnd-form__foot"><button type="submit" class="req-submit">Add to the list</button><button type="button" class="req-ghost" data-close>Cancel</button><p class="req-msg" aria-live="polite"></p></div>
      </form>`;
    openDrawer();
    panel.scrollTop = 0;
    const input = panel.querySelector('input[name=name]');
    input.focus();
    if (name) checkDupes(name);
  }

  let dupeTimer = null;
  function checkDupes(name) {
    clearTimeout(dupeTimer);
    dupeTimer = setTimeout(async () => {
      const box = $('fnd-dupes');
      if (!box || name.trim().length < 3) return;
      try {
        const d = await api('/api/foundations/check?q=' + encodeURIComponent(name.trim()));
        const lines = [];
        d.prospects.slice(0, 3).forEach((p) => lines.push(`<li><div><b>${esc(p.name)}</b><span>Already on the list, ${plural(p.contacts, 'contact')}</span></div><button type="button" class="fnd-textbtn" data-open="${esc(p.id)}">Open it</button></li>`));
        d.blackbaud.slice(0, 3).forEach((o) => lines.push(`<li><div><b>${esc(o.name)}</b> #${esc(o.lookup_id)}<span>Already in Blackbaud${o.held.length ? ', held by ' + esc(o.held.join(', ')) : ''}</span></div></li>`));
        box.innerHTML = lines.length ? `<div class="fnd-bb is-warn" style="margin-bottom:14px"><span class="fnd-bb__kicker">Check these first</span><ul class="fnd-sug" style="margin-top:0">${lines.join('')}</ul></div>` : '';
      } catch (err) {
        box.innerHTML = '';
      }
    }, 320);
  }

  const formData = (form) => {
    const o = {};
    new FormData(form).forEach((v, k) => {
      if (k === 'tags') (o.tags = o.tags || []).push(v);
      else o[k] = typeof v === 'string' ? v.trim() : v;
    });
    return o;
  };

  async function refresh(id) {
    const data = await api('/api/foundations');
    state.list = data.foundations;
    state.meta = data;
    render();
    state.cleanup = null;
    if (id) await openFoundation(id, true);
  }

  panel.addEventListener('input', (e) => {
    if (e.target.name === 'name' && e.target.form && e.target.form.id === 'fnd-new') checkDupes(e.target.value);
  });

  panel.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const msg = form.querySelector('.req-msg');
    const btn = form.querySelector('button[type=submit]');
    const say = (t) => { if (msg) msg.textContent = t; };
    say('');
    if (needWho()) return;
    const data = formData(form);
    btn.disabled = true;
    try {
      if (form.id === 'fnd-log') {
        if (!data.outcome) throw new Error('Choose the outcome.');
        const res = await api(`/api/foundations/${encodeURIComponent(state.openId)}/contacts`, { method: 'POST', body: JSON.stringify(data) });
        localStorage.setItem('fnd_last_rdd', data.rdd);
        const c = res.contact || {};
        const dead = /not interested|does not fund|does not work/i.test(data.outcome);
        await refresh(state.openId);
        toast(c.bb_state === 'posted' ? 'Logged and posted to Blackbaud.' : 'Saved here. ' + (c.bb_error || 'It will post to Blackbaud shortly.'));
        if (dead && state.detail && state.detail.foundation.status !== 'dead') slot(deadForm(`${data.outcome}. ${data.note}`.slice(0, 280)));
      } else if (form.id === 'fnd-dead') {
        await api(`/api/foundations/${encodeURIComponent(state.openId)}`, { method: 'PATCH', body: JSON.stringify({ status: 'dead', dead_reason: data.reason }) });
        await refresh(state.openId);
        toast('Marked a dead end. Nothing went to Blackbaud.');
      } else if (form.id === 'fnd-edit') {
        await api(`/api/foundations/${encodeURIComponent(state.openId)}`, { method: 'PATCH', body: JSON.stringify(data) });
        await refresh(state.openId);
        toast('Saved.');
      } else if (form.id === 'fnd-new') {
        const res = await api('/api/foundations', { method: 'POST', body: JSON.stringify(data) });
        qEl.value = '';
        onSearch();
        await refresh(res.id);
        toast('Added to the list.');
      }
    } catch (err) {
      btn.disabled = false;
      if (err.data && err.data.error === 'already_listed' && err.data.id) {
        say(err.message);
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'fnd-textbtn';
        open.textContent = 'Open it';
        open.addEventListener('click', () => openFoundation(err.data.id));
        msg.appendChild(document.createTextNode(' '));
        msg.appendChild(open);
      } else say(err.message);
    }
  });

  let removeArmed = null;
  panel.addEventListener('click', async (e) => {
    const open = e.target.closest('[data-open]');
    if (open) return openFoundation(open.dataset.open);
    const act = e.target.closest('[data-act]');
    const id = state.openId;
    try {
      if (act) {
        const a = act.dataset.act;
        if (a === 'log') slot(logForm());
        else if (a === 'dead') slot(deadForm(''));
        else if (a === 'edit') slot(editForm());
        else if (a === 'cancel') slot('');
        else if (a === 'reopen') {
          if (needWho()) return;
          await api(`/api/foundations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'open' }) });
          await refresh(id);
          toast('Reopened.');
        } else if (a === 'unlink') {
          if (needWho()) return;
          if (act.dataset.armed !== '1') {
            act.dataset.armed = '1';
            act.textContent = 'Click again to untie it';
            return;
          }
          await api(`/api/foundations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ link: null }) });
          await refresh(id);
          toast('Untied. New contacts post to Unsolicited Foundations again.');
        } else if (a === 'link') {
          if (needWho()) return;
          const v = ($('fnd-link-id').value || '').trim();
          if (!v) return $('fnd-link-id').focus();
          await api(`/api/foundations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ link: v }) });
          await refresh(id);
          toast('Tied to its Blackbaud record. New contacts post there.');
        }
        return;
      }
      const link = e.target.closest('[data-link]');
      if (link) {
        if (needWho()) return;
        await api(`/api/foundations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ link: link.dataset.link, reason: 'Picked from the Blackbaud look-alikes' }) });
        await refresh(id);
        return toast('Tied to its Blackbaud record. New contacts post there.');
      }
      const retry = e.target.closest('[data-retry]');
      if (retry) {
        retry.disabled = true;
        const res = await api(`/api/foundations/contacts/${encodeURIComponent(retry.dataset.retry)}`, { method: 'POST' });
        await refresh(id);
        return toast(res.contact && res.contact.bb_state === 'posted' ? 'Posted to Blackbaud.' : 'Still waiting. ' + ((res.contact && res.contact.bb_error) || ''));
      }
      const rm = e.target.closest('[data-remove]');
      if (rm) {
        if (needWho()) return;
        if (removeArmed !== rm.dataset.remove) {
          removeArmed = rm.dataset.remove;
          rm.textContent = 'Click again to remove it here and in Blackbaud';
          setTimeout(() => {
            if (removeArmed === rm.dataset.remove) {
              removeArmed = null;
              if (rm.isConnected) rm.textContent = 'Remove';
            }
          }, 5000);
          return;
        }
        removeArmed = null;
        rm.disabled = true;
        await api(`/api/foundations/contacts/${encodeURIComponent(rm.dataset.remove)}`, { method: 'DELETE' });
        await refresh(id);
        toast('Removed here and in Blackbaud.');
      }
    } catch (err) {
      toast(err.message);
    }
  });

  $('fnd-add').addEventListener('click', () => openAdd(qEl.value.trim()));

  /* ----------------------------------------------------------- cleanup */

  async function loadCleanup() {
    const view = $('fnd-view-cleanup');
    if (!state.cleanup) view.innerHTML = '<div class="make-sheet fnd-sheet"><p class="req-empty">Loading</p></div>';
    try {
      state.cleanup = await api('/api/foundations/cleanup');
    } catch (err) {
      view.innerHTML = `<div class="make-sheet fnd-sheet"><p class="req-msg">${esc(err.message)}</p></div>`;
      return;
    }
    const M = state.cleanup.misplaced;
    const groups = [];
    M.forEach((r) => {
      let g = groups.find((x) => x.id === r.id);
      if (!g) groups.push((g = { id: r.id, name: r.name, lookup: r.bb_lookup_id, bbName: r.bb_name, why: r.bb_match_reason, rows: [] }));
      g.rows.push(r);
    });
    const T = state.cleanup.thin;
    view.innerHTML = `
      <div class="make-sheet fnd-sheet">
        <h2>Contacts on the wrong record</h2>
        <p class="fnd-note">${
          groups.length
            ? `${plural(groups.length, 'foundation')} on this list ${groups.length === 1 ? 'has its' : 'have their'} own Blackbaud record, and ${plural(M.length, 'contact')} that belong${M.length === 1 ? 's' : ''} there still ${M.length === 1 ? 'sits' : 'sit'} on Unsolicited Foundations. Moving them is not switched on yet. New contacts for these foundations already post to the right record.`
            : 'Every contact sits on the right record.'
        }</p>
        ${
          groups.length
            ? `<table class="exp-admin-table fnd-clean"><thead><tr><th>Foundation</th><th>Its Blackbaud record</th><th>Contacts to move</th></tr></thead><tbody>${groups
                .map(
                  (g) => `<tr class="exp-admin-row" data-id="${esc(g.id)}"><td><span class="fnd-name">${esc(g.name)}</span></td>
                    <td>#${esc(g.lookup)}<span class="fnd-sub">${esc(g.why || '')}</span></td>
                    <td>${g.rows.map((r) => `<span class="fnd-move">${esc(r.category)} · ${esc(r.rdd_name)} <span>${day(r.contact_date)}</span></span>`).join('')}</td></tr>`
                )
                .join('')}</tbody></table>`
            : ''
        }
      </div>
      <div class="make-sheet fnd-sheet">
        <h2>Records made at a first call</h2>
        <p class="fnd-note">${
          state.cleanup.offline
            ? 'Blackbaud could not be reached for this list. Try again in a minute.'
            : `${plural(T.length, 'foundation record')} created in Blackbaud since March hold${T.length === 1 ? 's' : ''} nothing but contacts from RDDs and grant writers: no gift, no grant request, no opportunity. ${T.filter((t) => t.contacts <= 2).length} of them have one or two contacts.`
        }</p>
        ${
          T.length
            ? `<table class="exp-admin-table fnd-clean"><thead><tr><th>Record</th><th>Made</th><th class="r">Contacts</th><th>Last contact</th></tr></thead><tbody>${T.map(
                (t) => `<tr><td><span class="fnd-name">${esc(t.name)}</span><span class="fnd-sub">#${esc(t.lookup_id)}</span></td><td class="mono">${day(t.made)}</td><td class="r mono">${t.contacts}</td><td class="mono">${day(t.last)}</td></tr>`
              ).join('')}</tbody></table>`
            : ''
        }
      </div>`;
  }

  $('fnd-view-cleanup').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) openFoundation(tr.dataset.id);
  });

  /* ---------------------------------------------------------- activity */

  const KIND = {
    contact_logged: 'Contact logged',
    post_contact: ['Posted to Blackbaud', 'Did not post'],
    tag: ['Tag added in Blackbaud', 'Tag is waiting'],
    delete_contact: ['Removed from Blackbaud', 'Could not remove from Blackbaud'],
    contact_removed: 'Contact removed',
    dead_end: 'Marked a dead end',
    reopened: 'Reopened',
    linked: 'Tied to a Blackbaud record',
    unlinked: 'Untied from a Blackbaud record',
    added: 'Foundation added',
    setting: 'Setting changed',
    imported: 'Brought in from Blackbaud',
  };

  async function loadActivity() {
    const view = $('fnd-view-activity');
    view.innerHTML = '<div class="make-sheet fnd-sheet"><p class="req-empty">Loading</p></div>';
    let data;
    try {
      data = await api('/api/foundations/activity');
    } catch (err) {
      view.innerHTML = `<div class="make-sheet fnd-sheet"><p class="req-msg">${esc(err.message)}</p></div>`;
      return;
    }
    const on = state.meta.settings.posting === 'on';
    view.innerHTML = `<div class="make-sheet fnd-sheet">
      <h2>Sent to Blackbaud</h2>
      <div class="fnd-state ${on ? '' : 'is-off'}"><span class="dot"></span><span>${on ? 'Posting is on. Each contact logged here goes to Blackbaud right away.' : 'Posting is off. Contacts are saved here and wait.'}</span><button type="button" class="fnd-textbtn is-quiet" id="fnd-switch">${on ? 'Switch off' : 'Switch on'}</button></div>
      <div id="fnd-switch-slot"></div>
      <p class="fnd-check__hint" id="fnd-health" style="margin:-8px 0 14px 2px">Checking the Blackbaud connection</p>
      ${
        data.waiting.length
          ? `<span class="exp-legend">Waiting to post</span><ul class="exp-timeline">${data.waiting
              .map(
                (w) => `<li><div class="exp-tl-row"><b>${esc(w.foundation)}</b><span>${esc(w.how)} · ${esc(w.rdd_name)} · ${day(w.contact_date)}</span></div><div class="exp-tl-meta">${esc(w.bb_state === 'posted' ? 'Posted. Its tags are waiting.' : w.bb_error || 'Waiting')}</div></li>`
              )
              .join('')}</ul><p style="margin:12px 0 4px"><button type="button" class="req-admin-btn" id="fnd-retry">Try them again now</button></p>`
          : ''
      }
      <span class="exp-legend">Everything this page has done</span>
      <ul class="exp-timeline">${
        data.log.length
          ? data.log
              .map((l) => {
                const k = KIND[l.kind];
                const label = Array.isArray(k) ? (l.ok ? k[0] : k[1]) : k || l.kind;
                return `<li><div class="exp-tl-row"><b>${l.method ? `<span class="fnd-verb ${l.ok ? 'ok' : 'no'}">${esc(l.method)}</span>` : ''}${esc(label)}</b><span>${esc(l.actor || 'staff')} · ${stamp(l.created_at)}</span></div>
                  <div class="exp-tl-meta">${esc([l.foundation, l.detail].filter(Boolean).join(' · '))}</div></li>`;
              })
              .join('')
          : '<li><div class="exp-tl-meta">Nothing yet. The first contact logged here shows up in this list.</div></li>'
      }</ul>
    </div>`;
    loadHealth();
  }

  function loadHealth() {
    api('/api/foundations/health')
      .then((h) => {
        const el = $('fnd-health');
        if (!el) return;
        el.textContent =
          (h.blackbaud ? 'Blackbaud connection is up' : 'Blackbaud connection is down, contacts will wait') +
          (h.mirror ? '' : ' · Blackbaud search is down') +
          (h.tags === 'waiting' ? ' · Tags are saved here and wait for one change to the connection' : '');
      })
      .catch(() => {});
  }

  $('fnd-view-activity').addEventListener('click', async (e) => {
    if (e.target.id === 'fnd-retry') {
      e.target.disabled = true;
      try {
        await api('/api/foundations/activity', { method: 'POST' });
        await refresh();
        await loadActivity();
        toast('Tried again.');
      } catch (err) {
        toast(err.message);
      }
    } else if (e.target.id === 'fnd-switch') {
      const next = state.meta.settings.posting === 'on' ? 'off' : 'on';
      $('fnd-switch-slot').innerHTML = `<form class="board-login" id="fnd-switch-form" style="box-shadow:none">
        <p>The board password switches posting ${next}.</p>
        <div class="board-login__row"><input type="password" name="password" placeholder="Board password" autocomplete="off" /><button type="submit" class="req-admin-btn">Switch ${next}</button></div>
        <p class="req-msg" aria-live="polite"></p></form>`;
      $('fnd-switch-form').querySelector('input').focus();
    }
  });
  $('fnd-view-activity').addEventListener('submit', async (e) => {
    if (e.target.id !== 'fnd-switch-form') return;
    e.preventDefault();
    const next = state.meta.settings.posting === 'on' ? 'off' : 'on';
    try {
      await api('/api/foundations/settings', { method: 'POST', body: JSON.stringify({ password: e.target.password.value, posting: next }) });
      await refresh();
      await loadActivity();
      toast('Posting is ' + next + '.');
    } catch (err) {
      e.target.querySelector('.req-msg').textContent = err.message;
    }
  });

  /* ---------------------------------------------------------- keyboard */

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '');
    if (e.key === 'Escape') {
      if (!drawer.hidden) closeDrawer();
      else if (qEl.value) {
        qEl.value = '';
        onSearch();
      }
    } else if (e.key === '/' && !typing && !app.hidden && drawer.hidden && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      qEl.focus();
    }
  });

  /* -------------------------------------------------------------- boot */

  fetch('/api/foundations/me', { credentials: 'same-origin' })
    .then((r) => r.json())
    .then((d) => {
      if (d.name) useSignedInName(d.name);
      return d.unlocked ? load() : showLocked();
    })
    .catch(() => showLocked());
})();
