/* Giving statements: one partner's statement on request, and the January year-end run. */
(() => {
  const $ = (id) => document.getElementById(id);
  const app = $('stm-app');
  if (!app) return;

  const toastEl = $('stm-toast');
  const state = {
    me: null,
    tab: 'one',
    partner: null,
    hits: [],
    seq: 0,
    year: '',
    plan: null,
    batches: null,
    busy: false,
    last: null,
    statement: null,
  };

  const esc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const plural = (n, w, ws) => `${Number(n).toLocaleString('en-US')} ${Number(n) === 1 ? w : ws || w + 's'}`;
  const money = (n) => (Number(n) < 0 ? '-' : '') + '$' + Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${MON[+m[2] - 1]} ${+m[3]}, ${m[1]}` : '';
  };
  const stamp = (iso) =>
    iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const LIST_NAME = { mail: 'Mail', email: 'Email', other: 'Other' };

  let toastTimer = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 3800);
  }

  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (opts.body) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, { credentials: 'same-origin', ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.error === 'signin') {
      location.href = '/login/?next=' + encodeURIComponent(location.pathname + location.search);
      throw new Error('Sign in again.');
    }
    if (!res.ok || data.ok === false) {
      const err = new Error(data.message || 'Something went wrong. Try again.');
      err.status = res.status;
      err.code = data.error;
      throw err;
    }
    return data;
  }
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });

  /* ------------------------------------------------------------------ tabs */

  const TABS = [
    ['one', 'One statement'],
    ['year', 'Year-end run'],
    ['files', 'Print files'],
    ['wording', 'Wording'],
  ];

  function renderTabs() {
    $('stm-tabs').innerHTML = TABS.map(
      ([k, label]) => `<button type="button" role="tab" data-tab="${k}" class="${state.tab === k ? 'is-on' : ''}" aria-selected="${state.tab === k}">${label}</button>`
    ).join('');
    $('stm-tabs').querySelectorAll('button').forEach((btn) =>
      btn.addEventListener('click', () => {
        state.tab = btn.dataset.tab;
        renderTabs();
        showTab();
        if (state.tab === 'year') loadPlan();
        if (state.tab === 'files') loadFiles();
        if (state.tab === 'wording') renderWording();
      })
    );
  }

  function showTab() {
    for (const [k] of TABS) $(`stm-view-${k}`).hidden = state.tab !== k;
  }

  /* ------------------------------------------------------------ one statement */

  let findTimer = null;
  $('stm-q').addEventListener('input', () => {
    clearTimeout(findTimer);
    const q = $('stm-q').value.trim();
    if (q.length < 2) {
      state.hits = [];
      renderHits();
      return;
    }
    findTimer = setTimeout(() => find(q), 250);
  });

  async function find(q) {
    const mine = ++state.seq;
    try {
      const d = await api('/api/statements/find?q=' + encodeURIComponent(q));
      if (mine !== state.seq) return;
      state.hits = d.partners || [];
      renderHits(q);
    } catch (err) {
      if (mine === state.seq) $('stm-hits').innerHTML = `<p class="rcp-fine">${esc(err.message)}</p>`;
    }
  }

  function renderHits(q) {
    const box = $('stm-hits');
    if (!state.hits.length) {
      box.innerHTML = q ? '<p class="rcp-fine">No partner matches. Try the Blackbaud ID or another part of the name.</p>' : '';
      return;
    }
    box.innerHTML = state.hits
      .map(
        (h, i) =>
          `<button type="button" class="stm-hit" role="option" data-i="${i}"><b>${esc(h.name)}</b><span>ID ${esc(h.lookup)}${h.place ? ' · ' + esc(h.place) : ''} · ${plural(h.gifts, 'gift')}${h.last ? ', last ' + esc(day(h.last)) : ''}</span></button>`
      )
      .join('');
    box.querySelectorAll('.stm-hit').forEach((b) => b.addEventListener('click', () => pick(state.hits[Number(b.dataset.i)])));
  }

  function periodOptions() {
    const y = state.me.thisYear;
    const opts = [];
    for (let i = 0; i <= 6; i++) opts.push([String(y - i), String(y - i) + (i === 0 ? ' so far' : '')]);
    opts.push(['dates', 'Between two dates']);
    return opts;
  }

  function pick(hit) {
    state.partner = hit;
    state.last = null;
    state.hits = [];
    $('stm-hits').innerHTML = '';
    $('stm-q').value = '';
    $('stm-one').hidden = false;
    $('stm-who').innerHTML = `<h2>${esc(hit.name)}</h2><p class="fnd-note">Blackbaud ID ${esc(hit.lookup)}${hit.place ? ', ' + esc(hit.place) : ''}</p>`;
    const sel = $('stm-period');
    if (!sel.options.length) {
      sel.innerHTML = periodOptions().map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
      sel.value = String(state.me.defaultYear);
    }
    loadPreview();
  }

  function askBody() {
    const period = $('stm-period').value;
    const body = { cid: state.partner.id, includeSoft: $('stm-soft').checked };
    if (period === 'dates') {
      body.from = $('stm-from').value;
      body.to = $('stm-to').value;
    } else body.year = period;
    return body;
  }

  $('stm-period').addEventListener('change', () => {
    const dates = $('stm-period').value === 'dates';
    $('stm-from-wrap').hidden = !dates;
    $('stm-to-wrap').hidden = !dates;
    if (!dates) loadPreview();
  });
  for (const id of ['stm-from', 'stm-to']) $(id).addEventListener('change', () => $('stm-from').value && $('stm-to').value && loadPreview());
  $('stm-soft').addEventListener('change', () => state.partner && loadPreview());

  async function loadPreview() {
    if (!state.partner) return;
    const mine = ++state.seq;
    const box = $('stm-preview');
    state.last = null;
    box.innerHTML = '<p class="rcp-loading"><span class="rcp-spin"></span>Reading the gifts</p>';
    try {
      const d = await post('/api/statements/preview', askBody());
      if (mine !== state.seq) return;
      state.statement = d.statement;
      renderPreview();
    } catch (err) {
      if (mine !== state.seq) return;
      state.statement = null;
      $('stm-sheet').hidden = true;
      box.innerHTML = `<p class="rcp-loading is-bad">${esc(err.message)}</p>`;
    }
  }

  function lineTable(title, lines, opt = {}) {
    if (!lines.length) return '';
    return `<h3 class="stm-h">${esc(title)}</h3>
      <div class="fnd-table-wrap"><table class="exp-admin-table sc-table stm-table stm-lines">
        <thead><tr><th>Date</th><th>Gift ID</th><th>Designation</th><th>Type</th><th class="r">Amount</th></tr></thead>
        <tbody>${lines
          .map(
            (l) =>
              `<tr><td>${esc(day(l.date))}</td><td>${esc(l.gift)}</td><td>${opt.from && l.from ? esc(l.from) + ': ' : ''}${esc(l.fund || 'Where Needed Most')}${l.flags.includes('noncash') ? ' <span class="stm-flag">Stock or in-kind</span>' : ''}${l.flags.includes('split') ? ' <span class="stm-flag">Part of a split gift</span>' : ''}</td><td>${esc(l.kind)}</td><td class="r">${money(l.amount)}</td></tr>`
          )
          .join('')}</tbody>
      </table></div>`;
  }

  function renderPreview() {
    const s = state.statement;
    const t = s.totals;
    const stat = (n, cap) => `<div class="stm-tile"><b>${n}</b><span>${cap}</span></div>`;
    const left = s.left.filter((l) => l.reason !== 'schedule');
    const schedules = s.left.length - left.length;
    $('stm-sheet').hidden = false;
    $('stm-preview').innerHTML = `
      <div class="stm-tiles">
        ${stat(money(t.net), `Net total, ${esc(s.period)}`)}
        ${stat(plural(t.giftCount, 'gift'), `${money(t.gifts)} counted`)}
        ${t.refunds ? stat(money(t.refunds), 'Refunds') : ''}
        ${t.notDeductible ? stat(money(t.notDeductible), 'Not tax-deductible') : ''}
        ${t.soft ? stat(money(t.soft), 'Through a fund, not counted') : ''}
      </div>
      ${s.notes.length ? `<ul class="stm-notes">${s.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      ${s.gifts.length || s.refunds.length ? '' : '<p class="fnd-note">No gift belongs on this statement for the period.</p>'}
      ${lineTable('Gifts', s.gifts)}
      ${lineTable('Refunds and returned gifts', s.refunds)}
      ${lineTable('Payments that are not tax-deductible', s.notDeductible)}
      ${lineTable('Gifts made through a fund or foundation', s.soft, { from: true })}
      ${
        left.length
          ? `<details class="stm-left"><summary>${plural(left.length, 'row')} left off the statement</summary>
              <div class="fnd-table-wrap"><table class="exp-admin-table sc-table stm-table"><thead><tr><th>Date</th><th>Gift ID</th><th>Why</th><th class="r">Amount</th></tr></thead>
              <tbody>${left.map((l) => `<tr><td>${esc(day(l.date))}</td><td>${esc(l.gift)}</td><td>${esc(l.why)}</td><td class="r">${money(l.amount)}</td></tr>`).join('')}</tbody></table></div></details>`
          : ''
      }
      ${schedules ? `<p class="rcp-fine">${plural(schedules, 'monthly gift schedule')} in the period ${schedules === 1 ? 'is' : 'are'} not listed. The payments are.</p>` : ''}
      <div class="stm-actions" id="stm-actions">${actionsHtml()}</div>`;
    bindActions();
  }

  function actionsHtml() {
    const r = state.last;
    const s = state.statement;
    const empty = !s.gifts.length && !s.refunds.length;
    if (!r) {
      return `<button type="button" class="req-submit" id="stm-make" ${state.busy || empty ? 'disabled' : ''}>${state.busy ? 'Making the PDF' : 'Make the PDF'}</button>
        <span class="rcp-fine">${state.me.driveOn ? 'A copy is saved in US Team Files.' : 'The hub keeps a copy under Print files.'}</span>`;
    }
    const base = `/api/statements/batches/${encodeURIComponent(r.id)}/pdf`;
    return `<a class="req-submit rcp-btn" href="${base}" target="_blank" rel="noopener">Open the PDF</a>
      <a class="req-ghost rcp-btn" href="${base}?download=1">Download</a>
      ${state.me.emailOn ? `<button type="button" class="req-ghost" id="stm-email" ${s.partner.email ? '' : 'disabled'}>${s.partner.email ? 'Email it to the partner' : 'No email on the record'}</button>` : '<span class="rcp-fine">Emailing is off in Admin.</span>'}
      <p class="rcp-fine">Made ${esc(stamp(r.createdAt))} by ${esc(r.createdBy)}. ${r.driveFile ? 'A copy is in US Team Files.' : ''}</p>`;
  }

  function bindActions() {
    const mk = $('stm-make');
    if (mk) mk.addEventListener('click', makeOne);
    const em = $('stm-email');
    if (em) em.addEventListener('click', emailOne);
  }

  function redrawActions() {
    const el = $('stm-actions');
    if (!el) return;
    el.innerHTML = actionsHtml();
    bindActions();
  }

  async function makeOne() {
    if (state.busy) return;
    state.busy = true;
    redrawActions();
    try {
      const d = await post('/api/statements/single', askBody());
      state.last = d.batch;
      toast('The PDF is ready.');
    } catch (err) {
      toast(err.message);
    } finally {
      state.busy = false;
      redrawActions();
    }
  }

  async function emailOne() {
    if (!state.last || !confirm(`Email this statement to ${state.statement.partner.email}?`)) return;
    try {
      const d = await post(`/api/statements/batches/${encodeURIComponent(state.last.id)}`, { action: 'email', only: [state.statement.partner.id] });
      toast(d.result.sent ? 'Sent.' : 'It did not send. Try again.');
    } catch (err) {
      toast(err.message);
    }
  }

  if (window.FavorSheets) {
    window.FavorSheets.register('statement', () => {
      const s = state.statement;
      if (!s) throw new Error('Pick a partner first.');
      const rows = [
        ...s.gifts.map((l) => ({ section: 'Gifts', ...l })),
        ...s.refunds.map((l) => ({ section: 'Refunds', ...l })),
        ...s.notDeductible.map((l) => ({ section: 'Not tax-deductible', ...l })),
        ...s.soft.map((l) => ({ section: 'Through a fund', ...l })),
      ].map((l) => ({ section: l.section, date: l.date, gift: l.gift, fund: l.fund || '', kind: l.kind, amount: l.amount, from: l.from || '' }));
      return window.FavorSheets.screen(`Giving statement ${s.partner.lookup}, ${s.period}`, [{
        name: 'Gifts',
        columns: [
          { key: 'section', label: 'Section', type: 'text' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'gift', label: 'Gift ID', type: 'id' },
          { key: 'fund', label: 'Designation', type: 'text' }, { key: 'kind', label: 'Type', type: 'text' }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'from', label: 'Given by', type: 'text' },
        ],
        rows,
      }], { filters: s.period, classes: ['partner'] });
    });
  }

  /* ------------------------------------------------------------------ year-end */

  async function loadPlan(fresh) {
    const box = $('stm-view-year');
    if (!state.year) state.year = String(state.me.defaultYear);
    if (!state.plan || fresh || String(state.plan.year) !== state.year) {
      box.innerHTML = '<p class="rcp-loading"><span class="rcp-spin"></span>Reading the tax receipt lists</p>';
      const mine = ++state.seq;
      try {
        const d = await api('/api/statements/yearend?year=' + encodeURIComponent(state.year));
        if (mine !== state.seq) return;
        state.plan = d.plan;
      } catch (err) {
        if (mine === state.seq) box.innerHTML = `<p class="rcp-loading is-bad">${esc(err.message)} <button type="button" class="fnd-textbtn" id="stm-retry">Try again</button></p>`;
        const r = $('stm-retry');
        if (r) r.addEventListener('click', () => loadPlan(true));
        return;
      }
    }
    renderYear();
  }

  function listCard(k, p) {
    return `<div class="ticker__stat"><div class="ticker__num">${Number(p.count).toLocaleString('en-US')}</div><div class="ticker__caption">${LIST_NAME[k]} list<br>${money(p.total)}<br>${p.issued} in print files, ${p.remaining} left</div></div>`;
  }

  function renderYear() {
    const p = state.plan;
    const open = p.open;
    const years = [];
    for (let y = state.me.thisYear; y >= state.me.thisYear - 6; y--) years.push(y);
    const tie = (t) => {
      const cls = t.status === 'match' ? 'is-match' : t.status === 'differs' ? 'is-differs' : 'is-none';
      const fmt = (n) => (n == null ? 'not available' : t.kind === 'money' ? money(n) : Number(n).toLocaleString('en-US'));
      const word = t.status === 'match' ? 'Matches' : t.status === 'differs' ? 'Differs' : 'Not compared';
      return `<li class="stm-tie ${cls}"><b>${word}</b> <span>${esc(t.label)}: ${fmt(t.mine)}${t.other != null ? ' against ' + fmt(t.other) : ''}${t.note ? '. ' + esc(t.note) : ''}</span></li>`;
    };
    const lists = ['mail', 'email', 'other'];
    $('stm-view-year').innerHTML = `
      <div class="stm-year">
        <label class="req-field"><span>Gift year</span><select id="stm-year">${years.map((y) => `<option value="${y}"${String(y) === state.year ? ' selected' : ''}>${y}</option>`).join('')}</select></label>
        <button type="button" class="fnd-textbtn" id="stm-reload">Read the lists again</button>
      </div>
      <section class="ticker fnd-band rcp-band" aria-label="Year-end lists"><div class="ticker__label">${esc(p.year)} tax receipt lists</div>
        <div class="fnd-band__row">${lists.map((k) => listCard(k, p.lists[k])).join('')}
          <div class="ticker__stat"><div class="ticker__num">${Number(p.none.count).toLocaleString('en-US')}</div><div class="ticker__caption">No statement<br>${money(p.none.total)}<br>under $250, churches, foundations, DAFs</div></div>
        </div></section>
      <ul class="stm-ties">${p.ties.map(tie).join('')}</ul>
      <div id="stm-run">${open ? openFileHtml(open) : makeHtml(p)}</div>
      <h3 class="stm-h">Files made for ${esc(p.year)}</h3>
      ${filesTable(p.batches, true)}`;
    $('stm-year').addEventListener('change', (e) => {
      state.year = e.target.value;
      state.plan = null;
      loadPlan();
    });
    $('stm-reload').addEventListener('click', () => loadPlan(true));
    bindRun(open);
    bindFileButtons();
  }

  function makeHtml(p) {
    const any = ['mail', 'email', 'other'].some((k) => p.lists[k].remaining > 0);
    if (!any) return '<p class="fnd-note stm-done"><b>Every partner on the three lists has a statement in a print file.</b> A second run makes nothing new.</p>';
    return `<div class="rcp-make__row">
        <div><h2>Make the next print file</h2>
        <p class="fnd-note">${plural(p.size, 'statement')} to a file, one list at a time, ZIP order for mail. A partner already in a file is never included again. Nothing is marked printed until you press it.</p></div>
        <div class="rcp-make__form">
          <label class="req-field"><span>List</span><select id="stm-list">${['mail', 'email', 'other']
            .map((k) => `<option value="${k}"${p.lists[k].remaining ? '' : ' disabled'}>${LIST_NAME[k]}, ${p.lists[k].remaining} left</option>`)
            .join('')}</select></label>
          <label class="stm-check"><input type="checkbox" id="stm-yesoft" /> List gifts made through a fund</label>
          <button type="button" class="req-submit" id="stm-run-go" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Making the file' : 'Make the print file'}</button>
        </div></div>`;
  }

  function openFileHtml(b) {
    const base = `/api/statements/batches/${encodeURIComponent(b.id)}/pdf`;
    const printed = Boolean(b.downloadedAt);
    const step = (n, title, body, done, next) => `<li class="rcp-step${done ? ' is-done' : ''}${next ? ' is-next' : ''}"><span class="rcp-step__n">${done ? '&#10003;' : n}</span><div><h3>${title}</h3>${body}</div></li>`;
    return `<div class="rcp-make__row"><div><p class="make-kicker">Print file ready</p>
        <h2>${LIST_NAME[b.list]} ${b.seq}: ${plural(b.count, 'statement')} for ${esc(b.year)}</h2>
        <p class="fnd-note">${plural(b.gifts, 'gift')}, ${money(b.amount)} net.${b.skipped ? ` ${plural(b.skipped, 'partner')} on the list had nothing tax-deductible to print.` : ''} Made by ${esc(b.createdBy || 'someone')} on ${esc(stamp(b.createdAt))}.</p></div></div>
      <ol class="rcp-steps">
        ${step(1, 'Print', `<p>Letterhead or plain paper in the tray. In the print window pick <b>Letter</b> paper, <b>Actual size</b> (100%) and <b>one side</b>.</p>
          <a class="req-submit rcp-btn" id="stm-dl" href="${base}?download=1">Download the print file</a> <a class="fnd-textbtn" id="stm-open" href="${base}" target="_blank" rel="noopener">or open it in a tab</a>
          ${printed ? `<p class="rcp-fine">Downloaded ${esc(stamp(b.downloadedAt))}.</p>` : ''}`, printed, false)}
        ${step(2, 'Mark it printed', `<p>${printed ? '<b>Printed? Press this now.</b>' : 'Press this once the statements are printed.'} The next file cannot be made until this one is marked.</p>
          <button type="button" class="req-submit exp-green rcp-btn" id="stm-printed">Mark ${plural(b.count, 'statement')} printed</button>
          <button type="button" class="fnd-textbtn is-danger" id="stm-discard">Throw this print file away</button>`, false, printed)}
      </ol>`;
  }

  function bindRun(open) {
    const go = $('stm-run-go');
    if (go) go.addEventListener('click', makeYearEnd);
    if (open) {
      $('stm-printed').addEventListener('click', () => closeFile(open, 'printed'));
      $('stm-discard').addEventListener('click', () => {
        if (confirm('Throw this print file away? Its partners go back on the list.')) closeFile(open, 'discard');
      });
      for (const id of ['stm-dl', 'stm-open']) {
        $(id).addEventListener('click', () => {
          if (open.downloadedAt) return;
          setTimeout(() => loadPlan(true), 1500);
        });
      }
    }
  }

  async function makeYearEnd() {
    if (state.busy) return;
    state.busy = true;
    renderYear();
    try {
      const d = await post('/api/statements/yearend', { year: Number(state.year), list: $('stm-list').value, includeSoft: $('stm-yesoft').checked });
      toast(d.mismatches ? `File made. ${plural(d.mismatches, 'partner')} differ from the tax list, see below.` : 'The print file is ready.');
    } catch (err) {
      toast(err.message);
    } finally {
      state.busy = false;
      loadPlan(true);
    }
  }

  async function closeFile(b, action) {
    try {
      await post(`/api/statements/batches/${encodeURIComponent(b.id)}`, { action });
      toast(action === 'printed' ? 'Marked printed.' : 'Print file thrown away.');
    } catch (err) {
      toast(err.message);
    }
    loadPlan(true);
  }

  function filesTable(list, yearOnly) {
    if (!list || !list.length) return '<p class="fnd-note">Nothing yet.</p>';
    return `<div class="fnd-table-wrap"><table class="exp-admin-table sc-table stm-table">
      <thead><tr><th>File</th><th>Made</th><th class="r">Statements</th><th class="r">Gifts</th><th class="r">Net</th><th>Status</th><th></th></tr></thead>
      <tbody>${list
        .map((b) => {
          const name = b.kind === 'single' ? `Single, ${esc(b.from === `${b.to.slice(0, 4)}-01-01` && b.to.endsWith('12-31') ? b.to.slice(0, 4) : day(b.from) + ' to ' + day(b.to))}` : `${esc(b.year)} ${LIST_NAME[b.list] || ''} ${b.seq}`;
          const status = b.kind === 'single' ? 'Made' : b.status === 'printed' ? `Printed ${esc(stamp(b.printedAt))}` : 'Waiting to be marked printed';
          const base = `/api/statements/batches/${encodeURIComponent(b.id)}/pdf`;
          const mail = !yearOnly || b.list !== 'email' || !state.me.emailOn ? '' : `<button type="button" class="fnd-textbtn" data-email="${esc(b.id)}">Email them</button>`;
          return `<tr><td>${name}</td><td>${esc(stamp(b.createdAt))}<br><span class="rcp-fine">${esc(b.createdBy)}</span></td><td class="r">${b.count}</td><td class="r">${b.gifts}</td><td class="r">${money(b.amount)}</td><td>${status}</td><td class="r"><a class="fnd-textbtn" href="${base}" target="_blank" rel="noopener">Open</a> <a class="fnd-textbtn" href="${base}?download=1">Download</a> ${mail}</td></tr>`;
        })
        .join('')}</tbody></table></div>`;
  }

  function bindFileButtons() {
    document.querySelectorAll('[data-email]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!confirm('Email these statements to the partners in this file who have an email address? Each partner gets one.')) return;
        btn.disabled = true;
        try {
          const d = await post(`/api/statements/batches/${encodeURIComponent(btn.dataset.email)}`, { action: 'email' });
          toast(`${d.result.sent} sent, ${d.result.failed} failed${d.result.skipped ? `, ${d.result.skipped} already sent or without an email` : ''}.`);
        } catch (err) {
          toast(err.message);
        }
        btn.disabled = false;
      })
    );
  }

  /* ------------------------------------------------------------------- files */

  async function loadFiles() {
    const box = $('stm-view-files');
    box.innerHTML = '<p class="rcp-loading"><span class="rcp-spin"></span>Reading the print files</p>';
    try {
      const d = await api('/api/statements/batches');
      state.batches = d.batches;
      box.innerHTML = `<h2 class="stm-h2">Print files</h2>${filesTable(d.batches, false)}`;
    } catch (err) {
      box.innerHTML = `<p class="rcp-loading is-bad">${esc(err.message)}</p>`;
    }
  }

  /* ----------------------------------------------------------------- wording */

  function renderWording() {
    const c = state.me.copy;
    const rows = state.me.fields.map((f) => `<tr><th scope="row">${esc(f.label)}</th><td>${esc(c[f.key]) || '<span class="rcp-fine">Blank</span>'}</td></tr>`).join('');
    $('stm-view-wording').innerHTML = `
      <div class="rcp-make__row"><div><h2>Wording on the statement</h2>
      <p class="fnd-note">${state.me.admin ? 'Change any line in Admin.' : 'A hub admin changes these lines in Admin.'}</p></div>
      <div class="rcp-make__form">
        <a class="req-ghost rcp-btn" href="/api/statements/sample" target="_blank" rel="noopener">Open a sample statement</a>
        ${state.me.admin ? '<a class="req-submit rcp-btn" href="/admin/statements/">Change the wording</a>' : ''}
      </div></div>
      <div class="fnd-table-wrap"><table class="exp-admin-table sc-table stm-table stm-words"><tbody>${rows}</tbody></table></div>`;
  }

  /* -------------------------------------------------------------------- start */

  async function start() {
    try {
      state.me = await api('/api/statements/me');
    } catch (err) {
      $('stm-loading').classList.add('is-bad');
      $('stm-loading').innerHTML = esc(err.message);
      return;
    }
    $('stm-loading').hidden = true;
    app.hidden = false;
    renderTabs();
    showTab();
    const want = new URLSearchParams(location.search).get('tab');
    if (want && TABS.some(([k]) => k === want)) {
      state.tab = want;
      renderTabs();
      showTab();
      if (want === 'year') loadPlan();
      if (want === 'files') loadFiles();
      if (want === 'wording') renderWording();
    }
  }
  start();
})();
