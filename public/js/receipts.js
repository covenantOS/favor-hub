/* Thank-you receipts: the gifts waiting for a letter, the print file, and marking them thanked in Blackbaud. */
(() => {
  const $ = (id) => document.getElementById(id);
  const app = $('rcp-app');
  if (!app) return;

  const login = $('rcp-login');
  const loginMsg = $('rcp-login-msg');
  const actions = $('rcp-actions');
  const whoEl = $('rcp-who');
  const toastEl = $('rcp-toast');
  const makeEl = $('rcp-make');

  const KINDS = { regular: 'Regular', major: '$200 and up', recurring: 'Monthly' };
  const HELD = {
    no_address: ['No mailing address', 'Add the address in Blackbaud and the gift comes back to the letters.'],
    preference: ['Asked for less mail', 'The record is marked Do Not Mail Solicitation, Do Not Solicit, All Email or Event Invitations Only. The reply slip asks for a gift, so add a letter only if you know this partner wants a paper receipt.'],
    pass_through: ['Passed along for a partner', 'A fund or brokerage sent it for someone else. Add a letter only if you mean to thank the organization.'],
    organization: ['Foundation, business or fund', 'Churches and ministries get letters. Other organizations do not, and neither does a person whose gift came through a foundation, business or donor-advised fund.'],
    inactive: ['Record marked inactive', ''],
    deceased: ['Marked deceased', ''],
    abroad: ['Outside the U.S.', 'Letters go to U.S. addresses only.'],
    no_mail: ['No mail', 'The record is marked Do Not Mail, Do Not Contact or Do Not Mail Thank You, or its address is marked not to send mail.'],
    small: ['Under $10', 'Gifts under $10 never got a letter.'],
    gift_type: ['Other gift types', ''],
  };

  const state = {
    view: null,
    batches: [],
    left: new Set(),
    added: new Set(),
    filter: 'all',
    find: '',
    tab: 'letters',
    days: Number(localStorage.getItem('rcp_days')) || 90,
    busy: false,
    wording: null,
  };

  const esc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const plural = (n, w, ws) => `${Number(n).toLocaleString('en-US')} ${Number(n) === 1 ? w : ws || w + 's'}`;
  const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${MON[+m[2] - 1]} ${+m[3]}, ${m[1]}` : '';
  };
  const shortDay = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${MON[+m[2] - 1]} ${+m[3]}` : '';
  };
  const stamp = (iso) =>
    iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const today = () => {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const codeFor = (iso) => {
    const [y, m] = iso.split('-').map(Number);
    return `Y${String(y).slice(2)}${'123456789ABC'[m - 1]}-TY`;
  };

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
    const who = (whoEl.value || '').trim();
    if (who) headers['X-Rcp-Actor'] = encodeURIComponent(who);
    const res = await fetch(path, { credentials: 'same-origin', ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.error === 'unauthorized') {
      showLocked();
      throw new Error('Enter the code again.');
    }
    if (!res.ok || data.ok === false) throw new Error(data.message || 'Something went wrong. Try again.');
    return data;
  }

  /* -------------------------------------------------------------- lock */

  function showLocked() {
    app.hidden = true;
    actions.hidden = true;
    login.hidden = false;
    setTimeout(() => $('rcp-code').focus(), 50);
  }

  login.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginMsg.textContent = '';
    try {
      await api('/api/receipts/login', { method: 'POST', body: JSON.stringify({ code: $('rcp-code').value }) });
      $('rcp-code').value = '';
      await load();
    } catch (err) {
      loginMsg.textContent = err.message;
    }
  });

  $('rcp-lock').addEventListener('click', async () => {
    await fetch('/api/receipts/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    showLocked();
  });

  whoEl.value = localStorage.getItem('rcp_actor') || '';
  whoEl.addEventListener('change', () => {
    localStorage.setItem('rcp_actor', whoEl.value.trim());
    whoEl.parentElement.classList.remove('is-bad');
  });

  function needWho() {
    if ((whoEl.value || '').trim()) return false;
    whoEl.parentElement.classList.add('is-bad');
    whoEl.focus();
    toast('Put your name in "Your name" first.');
    return true;
  }

  /* -------------------------------------------------------------- load */

  async function load() {
    login.hidden = true;
    app.hidden = false;
    actions.hidden = false;
    state.view = null;
    renderLoading();
    const [view, past] = await Promise.all([
      api(`/api/receipts/waiting?days=${state.days}`).catch((err) => ({ error: err.message })),
      api('/api/receipts/batches').catch(() => ({ batches: [] })),
    ]);
    state.batches = past.batches || [];
    if (view.error) {
      renderError(view.error);
      return;
    }
    state.view = view;
    state.left = new Set([...state.left].filter((id) => view.letters.some((l) => l.id === id)));
    state.added = new Set([...state.added].filter((id) => view.held.some((h) => h.id === id && h.canAdd)));
    render();
  }

  function renderLoading() {
    $('rcp-stats').innerHTML = `<div class="rcp-loading"><span class="rcp-spin" aria-hidden="true"></span>Reading Blackbaud. This takes about fifteen seconds.</div>`;
    makeEl.innerHTML = '';
    $('rcp-rows').innerHTML = '';
  }

  function renderError(message) {
    $('rcp-stats').innerHTML = `<div class="rcp-loading is-bad">${esc(message)} <button type="button" class="fnd-textbtn" id="rcp-retry">Try again</button></div>`;
    $('rcp-retry').addEventListener('click', load);
  }

  /* ----------------------------------------------------------- helpers */

  const openBatch = () => state.batches.find((b) => b.kind === 'new' && (b.status === 'printing' || b.status === 'marking'));

  function printable() {
    const v = state.view;
    if (!v) return [];
    const picked = v.letters.filter((l) => !l.batch && !state.left.has(l.id));
    const extra = v.held.filter((h) => !h.batch && state.added.has(h.id));
    return picked.concat(extra);
  }

  // The print file makes one letter per partner, listing each of the partner's gifts.
  const partnerKey = (l) => l.constituentLookup || `${l.addressee}|${l.addressKey}`;

  function segmentOfGifts(gifts) {
    const once = gifts.filter((x) => x.type !== 'Recurring Gift Payment');
    if (!once.length) return 'recurring';
    return Math.max(...once.map((x) => x.amount)) >= 200 ? 'major' : 'regular';
  }

  /** Gifts grouped into letters. A gift already in a print file stays with that file's letter. */
  function letters(list) {
    const by = new Map();
    for (const l of list) {
      const k = `${partnerKey(l)}|${l.batch ? l.batch.id : ''}`;
      if (by.has(k)) by.get(k).push(l);
      else by.set(k, [l]);
    }
    return [...by.values()].map((gifts) => ({ gifts, first: gifts[0], segment: segmentOfGifts(gifts), batch: gifts[0].batch || null }));
  }

  function counts(list) {
    const c = { regular: 0, major: 0, recurring: 0, letters: 0, gifts: list.length };
    for (const g of letters(list)) {
      c[g.segment] += 1;
      c.letters += 1;
    }
    return c;
  }

  /** Street addresses with letters for two or more different records. Often one household with two records. */
  function sharedAddresses() {
    const v = state.view;
    const going = v.letters.filter((l) => !l.batch).concat(v.held.filter((h) => !h.batch && state.added.has(h.id)));
    const at = new Map();
    for (const l of going) {
      if (!l.addressKey) continue;
      if (!at.has(l.addressKey)) at.set(l.addressKey, new Map());
      at.get(l.addressKey).set(partnerKey(l), l.addressee);
    }
    return new Map([...at].filter(([, records]) => records.size > 1));
  }

  /* ------------------------------------------------------------ render */

  function render() {
    renderStats();
    renderMake();
    renderTabs();
    renderLetters();
    renderHeld();
    renderPast();
    if (state.tab === 'wording') renderWording();
    showTab();
  }

  function renderStats() {
    const v = state.view;
    const list = printable();
    const c = counts(list);
    const dates = list.map((l) => l.date).sort();
    $('rcp-band-label').innerHTML = `Waiting for a receipt <select id="rcp-days" class="rcp-days" aria-label="How far back">
      ${[30, 60, 90, 180].map((d) => `<option value="${d}"${d === state.days ? ' selected' : ''}>gifts from the last ${d} days</option>`).join('')}
    </select>`;
    $('rcp-days').addEventListener('change', (e) => {
      state.days = Number(e.target.value) || 90;
      localStorage.setItem('rcp_days', String(state.days));
      load();
    });
    const stat = (n, cap) => `<div class="ticker__stat"><div class="ticker__num">${Number(n).toLocaleString('en-US')}</div><div class="ticker__caption">${cap}</div></div>`;
    $('rcp-stats').innerHTML =
      stat(c.letters, `${openBatch() ? 'Not in the print file yet' : 'Letters to print'}${dates.length ? `<br>${plural(c.gifts, 'gift')}, ${esc(shortDay(dates[0]))} to ${esc(day(dates[dates.length - 1]))}` : ''}`) +
      stat(c.regular, 'Regular') +
      stat(c.major, '$200 and up') +
      stat(c.recurring, 'Monthly partners');
  }

  function renderMake() {
    const b = openBatch();
    if (b) {
      renderBatchSteps(b);
      return;
    }
    const list = printable();
    const c = counts(list);
    const date = state.letterDate || today();
    const shared = sharedAddresses().size;
    makeEl.innerHTML = `
      <div class="rcp-make__row">
        <div>
          <h2>Make the print file</h2>
          <p class="fnd-note">${
            list.length
              ? `${plural(c.letters, 'letter')} for ${plural(c.gifts, 'gift')}: ${c.regular} regular, ${c.major} of $200 and up, ${c.recurring} monthly. A partner with two or more gifts gets one letter that lists each gift.${
                  shared ? ` ${shared === 1 ? 'One address has letters' : `${shared} addresses have letters`} for two different records, marked "Same address" below. If it is one household, uncheck one.` : ''
                }`
              : 'Nothing is waiting for a letter.'
          }</p>
        </div>
        <div class="rcp-make__form">
          <label class="req-field rcp-date"><span>Date on the letters</span><input type="date" id="rcp-date" value="${esc(date)}" /></label>
          <div class="rcp-code"><span>Reply code</span><b id="rcp-code-out">${esc(codeFor(date))}</b></div>
          <button type="button" class="req-submit" id="rcp-make-go" ${list.length && !state.busy ? '' : 'disabled'}>${state.busy ? 'Making the file' : `Make the print file`}</button>
        </div>
      </div>
      <p class="rcp-fine">Blackbaud is read again when you press it, so the file has today's names and addresses. Nothing is marked thanked until you print and press "Mark as thanked".</p>`;
    $('rcp-date').addEventListener('change', (e) => {
      state.letterDate = e.target.value || today();
      $('rcp-code-out').textContent = codeFor(state.letterDate);
    });
    $('rcp-make-go').addEventListener('click', makeFile);
  }

  function step(n, title, body, done) {
    return `<li class="rcp-step${done ? ' is-done' : ''}"><span class="rcp-step__n">${done ? '&#10003;' : n}</span><div><h3>${title}</h3>${body}</div></li>`;
  }

  function renderBatchSteps(b) {
    const base = `/api/receipts/batches/${encodeURIComponent(b.id)}/pdf`;
    const marking = b.status === 'marking';
    const total = b.gifts || b.count;
    const pct = total ? Math.round((b.marked / total) * 100) : 0;
    makeEl.innerHTML = `
      <div class="rcp-make__row">
        <div>
          <p class="make-kicker">Print file ready</p>
          <h2>${plural(b.count, 'letter')} dated ${esc(day(b.letterDate))}</h2>
          <p class="fnd-note">${b.regular} regular, ${b.major} of $200 and up, ${b.recurring} monthly. ${plural(total, 'gift')} from ${esc(day(b.firstGift))} to ${esc(day(b.lastGift))}, ${esc(money(b.amount))} in all. Made by ${esc(b.createdBy || 'someone')} on ${esc(stamp(b.createdAt))}.</p>
        </div>
        <div class="rcp-code rcp-code--big"><span>Write on the reply envelopes</span><b>${esc(b.appealCode)}</b></div>
      </div>
      <ol class="rcp-steps">
        ${step(1, 'Check the proof', `<p>Every page drawn on a picture of the receipt paper. Look at the first few and the last few.</p><a class="req-ghost rcp-btn" href="${base}?proof=1" target="_blank" rel="noopener">Open the proof</a>`, false)}
        ${step(2, 'Print', `<p>Receipt paper in the tray. In the print window pick <b>Legal</b> paper, <b>Actual size</b> (100%), and printing on <b>one side</b>.</p><a class="req-submit rcp-btn" href="${base}?download=1">Download the print file</a> <a class="fnd-textbtn" href="${base}" target="_blank" rel="noopener">or open it in a tab</a>`, false)}
        ${step(
          3,
          'Mark as thanked in Blackbaud',
          `<p>Press this once the letters are printed. Every gift in them is marked thanked, dated ${esc(day(b.letterDate))}, so it leaves this list.</p>
           ${
             marking || b.marked
               ? `<div class="rcp-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div><p class="rcp-fine" id="rcp-mark-msg">${b.marked} of ${plural(total, 'gift')} marked${b.markFailed ? `, ${b.markFailed} Blackbaud turned down` : ''}.</p>`
               : ''
           }
           <button type="button" class="req-submit exp-green rcp-btn" id="rcp-mark" ${state.busy ? 'disabled' : ''}>${b.marked ? 'Finish marking' : `Mark ${plural(total, 'gift')} as thanked`}</button>
           ${b.marked ? '' : `<button type="button" class="fnd-textbtn is-danger" id="rcp-cancel">Throw this print file away</button>`}`,
          false
        )}
      </ol>`;
    $('rcp-mark').addEventListener('click', () => markBatch(b.id));
    const cancel = $('rcp-cancel');
    if (cancel) cancel.addEventListener('click', () => cancelBatch(b));
  }

  function renderTabs() {
    const v = state.view;
    const tabs = [
      ['letters', 'Letters', letters(v.letters).length],
      ['held', 'Held back', v.held.length],
      ['past', 'Past printings', state.batches.length],
      ['wording', 'Letter wording', null],
    ];
    $('rcp-tabs').innerHTML = tabs
      .map(([k, label, n]) => `<button type="button" role="tab" data-tab="${k}" class="${state.tab === k ? 'is-on' : ''}" aria-selected="${state.tab === k}">${label}${n == null ? '' : `<span>${n}</span>`}</button>`)
      .join('');
    $('rcp-tabs').querySelectorAll('button').forEach((btn) =>
      btn.addEventListener('click', () => {
        state.tab = btn.dataset.tab;
        renderTabs();
        if (state.tab === 'wording') renderWording();
        showTab();
      })
    );
  }

  function showTab() {
    for (const k of ['letters', 'held', 'past', 'wording']) $(`rcp-view-${k}`).hidden = state.tab !== k;
  }

  function renderLetters() {
    const v = state.view;
    const all = letters(v.letters);
    const c = counts(v.letters);
    const pills = [['all', 'All', all.length], ['regular', 'Regular', c.regular], ['major', '$200 and up', c.major], ['recurring', 'Monthly', c.recurring]];
    $('rcp-filters').innerHTML = pills
      .map(([k, label, n]) => `<button type="button" data-f="${k}" class="${state.filter === k ? 'on' : ''}">${label}<small>${n}</small></button>`)
      .join('');
    $('rcp-filters').querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        state.filter = b.dataset.f;
        renderLetters();
      })
    );
    const q = state.find.toLowerCase();
    const rows = all.filter(
      (g) => (state.filter === 'all' || g.segment === state.filter) && (!q || g.gifts.some((l) => `${l.addressee} ${l.place} ${l.lookup} ${l.constituentLookup}`.toLowerCase().includes(q)))
    );
    const shared = sharedAddresses();
    const tbody = $('rcp-rows');
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="fnd-empty">${all.length ? 'No letters match.' : 'Nothing is waiting for a letter.'}</td></tr>`;
    } else {
      tbody.innerHTML = rows
        .map((g) => {
          const l = g.first;
          const ids = g.gifts.map((x) => x.id);
          const off = Boolean(g.batch);
          const on = !off && !ids.some((id) => state.left.has(id));
          const funds = [...new Set(g.gifts.map((x) => x.fund).filter((f) => f && f !== 'Where Needed Most'))];
          const notes = [];
          if (g.gifts.length > 1) notes.push(['', `One letter for ${g.gifts.length} gifts, ${money(g.gifts.reduce((t, x) => t + x.amount, 0))} in all`]);
          const same = !off && l.addressKey && shared.get(l.addressKey);
          if (same) {
            const others = [...same].filter(([k]) => k !== partnerKey(l)).map(([, name]) => name);
            if (others.length) notes.push([' is-warn', `Same address as ${others.join(' and ')}`]);
          }
          return `<tr class="${on ? '' : 'is-off'}">
            <td class="rcp-tick"><input type="checkbox" data-ids="${esc(ids.join(','))}" ${on ? 'checked' : ''} ${off ? 'disabled' : ''} aria-label="Print a letter for ${esc(l.addressee)}" /></td>
            <td><span class="fnd-name">${esc(l.addressee)}</span><span class="fnd-sub">${esc(l.place)}${funds.length ? ` &middot; ${esc(funds.join(', '))}` : ''}</span>${notes
              .map(([cls, text]) => `<span class="rcp-note${cls}">${esc(text)}</span>`)
              .join('')}</td>
            <td class="mono">${g.gifts.map((x) => esc(day(x.date))).join('<br>')}</td>
            <td class="r">${g.gifts.map((x) => esc(money(x.amount))).join('<br>')}</td>
            <td>${off ? `<span class="exp-pill pending">In the ${esc(shortDay(g.batch.letterDate))} print file</span>` : `<span class="exp-pill rcp-pill-${g.segment}">${KINDS[g.segment]}</span>`}</td>
          </tr>`;
        })
        .join('');
    }
    tbody.querySelectorAll('input[type=checkbox]').forEach((box) =>
      box.addEventListener('change', () => {
        for (const id of box.dataset.ids.split(',')) {
          if (box.checked) state.left.delete(id);
          else state.left.add(id);
        }
        box.closest('tr').classList.toggle('is-off', !box.checked);
        renderStats();
        if (!openBatch()) renderMake();
      })
    );
    const allBox = $('rcp-all');
    allBox.checked = rows.every((g) => g.batch || !g.gifts.some((x) => state.left.has(x.id)));
    allBox.onchange = () => {
      for (const g of rows) {
        if (g.batch) continue;
        for (const x of g.gifts) {
          if (allBox.checked) state.left.delete(x.id);
          else state.left.add(x.id);
        }
      }
      renderLetters();
      renderStats();
      if (!openBatch()) renderMake();
    };
  }

  $('rcp-find').addEventListener('input', (e) => {
    state.find = e.target.value.trim();
    renderLetters();
  });

  function renderHeld() {
    const v = state.view;
    const el = $('rcp-view-held');
    if (!v.held.length) {
      el.innerHTML = `<p class="fnd-empty">Nothing is held back.</p>`;
      return;
    }
    const groups = {};
    for (const h of v.held) (groups[h.key] = groups[h.key] || []).push(h);
    const order = Object.keys(HELD).filter((k) => groups[k]);
    el.innerHTML =
      `<p class="fnd-note">These gifts stay unthanked in Blackbaud and get no letter. A gift that is fixed in Blackbaud (an address added, a code removed) comes back to the letters the next time this page loads.</p>` +
      order
        .map((k) => {
          const [title, note] = HELD[k];
          const list = groups[k];
          return `<div class="rcp-held">
            <h3>${esc(title)} <span>${list.length}</span></h3>
            ${note ? `<p class="rcp-fine">${esc(note)}</p>` : ''}
            <table class="exp-admin-table rcp-table">
              <tbody>${list
                .map(
                  (h) => `<tr>
                    <td><span class="fnd-name">${esc(h.addressee)}</span><span class="fnd-sub">${esc(h.place || h.reason)}</span></td>
                    <td class="mono">${esc(day(h.date))}</td>
                    <td class="r">${esc(money(h.amount))}</td>
                    <td class="rcp-held__act">${
                      h.batch
                        ? `<span class="exp-pill pending">In the ${esc(shortDay(h.batch.letterDate))} print file</span>`
                        : h.canAdd
                          ? `<button type="button" class="fnd-textbtn${state.added.has(h.id) ? '' : ' is-quiet'}" data-add="${esc(h.id)}">${state.added.has(h.id) ? 'Will print. Undo' : 'Add a letter'}</button>`
                          : ''
                    }</td>
                  </tr>`
                )
                .join('')}</tbody>
            </table>
          </div>`;
        })
        .join('');
    el.querySelectorAll('[data-add]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.add;
        if (state.added.has(id)) state.added.delete(id);
        else state.added.add(id);
        renderHeld();
        renderLetters();
        renderStats();
        if (!openBatch()) renderMake();
      })
    );
  }

  function statusPill(b) {
    if (b.kind === 'reprint') return `<span class="exp-pill pending">Printed again</span>`;
    if (b.status === 'done') return `<span class="exp-pill approved">Marked thanked</span>`;
    if (b.status === 'marking') return `<span class="exp-pill fnd-pill-work">${b.marked} of ${b.gifts || b.count} gifts marked</span>`;
    return `<span class="exp-pill fnd-pill-two">Not marked yet</span>`;
  }

  function renderPast() {
    const el = $('rcp-view-past');
    const rows = state.batches;
    el.innerHTML = `
      ${
        rows.length
          ? `<div class="fnd-table-wrap"><table class="exp-admin-table rcp-table">
          <thead><tr><th>Letters dated</th><th class="r">Letters</th><th>Gifts from</th><th>Made by</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows
            .map((b) => {
              const base = `/api/receipts/batches/${encodeURIComponent(b.id)}/pdf`;
              return `<tr>
                <td><span class="fnd-name">${esc(day(b.letterDate))}</span><span class="fnd-sub">${b.kind === 'reprint' ? `Gifts marked ${esc(day(b.sourceDate))}` : esc(b.appealCode)}</span></td>
                <td class="r">${b.count}${b.gifts && b.gifts !== b.count ? `<span class="fnd-sub">${plural(b.gifts, 'gift')}</span>` : ''}</td>
                <td class="mono">${esc(shortDay(b.firstGift))} to ${esc(shortDay(b.lastGift))}</td>
                <td>${esc(b.createdBy)}<span class="fnd-sub">${esc(stamp(b.createdAt))}</span></td>
                <td>${statusPill(b)}</td>
                <td class="rcp-past__act"><a class="fnd-textbtn" href="${base}?download=1">Print file</a> <a class="fnd-textbtn is-quiet" href="${base}?proof=1" target="_blank" rel="noopener">Proof</a></td>
              </tr>`;
            })
            .join('')}</tbody></table></div>`
          : `<p class="fnd-empty">No print files yet.</p>`
      }
      <div class="rcp-again">
        <h3>Print a past run again</h3>
        <p class="rcp-fine">Makes letters for every gift Blackbaud shows as thanked on one day, for a run that was marked but never printed or mailed. Nothing in Blackbaud changes.</p>
        <div class="rcp-again__row">
          <label class="req-field"><span>Gifts marked thanked on</span><input type="date" id="rcp-again-date" /></label>
          <label class="req-field"><span>Date on the letters</span><input type="date" id="rcp-again-letter" value="${esc(today())}" /></label>
          <button type="button" class="req-ghost" id="rcp-again-go">Make the print file</button>
        </div>
      </div>`;
    $('rcp-again-go').addEventListener('click', reprint);
  }

  /* ----------------------------------------------------------- actions */

  async function makeFile() {
    if (needWho() || state.busy) return;
    const list = printable();
    if (!list.length) return;
    state.busy = true;
    renderMake();
    const added = list.filter((l) => state.added.has(l.id)).map((l) => l.id);
    const ids = list.filter((l) => !state.added.has(l.id)).map((l) => l.id);
    try {
      const out = await api('/api/receipts/batches', {
        method: 'POST',
        body: JSON.stringify({ ids, added, letterDate: state.letterDate || today(), days: state.days }),
      });
      state.added.clear();
      state.left.clear();
      toast(`${plural(out.batch.count, 'letter')} ready to print.${out.skipped && out.skipped.length ? ` ${out.skipped.length} changed in Blackbaud and were left out.` : ''}`);
      state.busy = false;
      await load();
    } catch (err) {
      state.busy = false;
      renderMake();
      toast(err.message);
    }
  }

  async function markBatch(id) {
    if (needWho() || state.busy) return;
    state.busy = true;
    const btn = $('rcp-mark');
    if (btn) btn.disabled = true;
    let retry = false;
    try {
      for (let guard = 0; guard < 200; guard++) {
        const out = await api(`/api/receipts/batches/${encodeURIComponent(id)}/mark`, { method: 'POST', body: JSON.stringify({ retry }) });
        retry = false;
        const i = state.batches.findIndex((b) => b.id === id);
        if (i >= 0) state.batches[i] = out.batch;
        renderBatchSteps(out.batch);
        const b2 = $('rcp-mark');
        if (b2) b2.disabled = true;
        if (out.stopped) {
          toast(`${out.stopped}. ${out.marked} marked so far. Press the button again tomorrow to finish.`);
          break;
        }
        if (out.waiting === 0) {
          if (out.failed > 0) {
            toast(`${out.marked} marked. Blackbaud turned down ${out.failed}; press the button to try those again.`);
            retry = true;
          } else {
            toast(`Done. ${plural(out.marked, 'gift')} marked thanked.`);
          }
          break;
        }
      }
    } catch (err) {
      toast(err.message);
    }
    state.busy = false;
    await load();
  }

  async function cancelBatch(b) {
    if (needWho()) return;
    if (!confirm(`Throw away the print file of ${plural(b.count, 'letter')}? Do this only if the letters were not mailed. Nothing in Blackbaud changes, and the gifts go back on the list.`)) return;
    try {
      await api(`/api/receipts/batches/${encodeURIComponent(b.id)}`, { method: 'DELETE' });
      toast('Print file thrown away.');
      await load();
    } catch (err) {
      toast(err.message);
    }
  }

  async function reprint() {
    if (needWho() || state.busy) return;
    const date = $('rcp-again-date').value;
    if (!date) {
      toast('Pick the day the gifts were marked thanked.');
      return;
    }
    state.busy = true;
    const btn = $('rcp-again-go');
    btn.disabled = true;
    btn.textContent = 'Reading Blackbaud';
    try {
      const out = await api('/api/receipts/batches', { method: 'POST', body: JSON.stringify({ reprintOf: date, letterDate: $('rcp-again-letter').value || today() }) });
      toast(`${plural(out.batch.count, 'letter')} ready. It is under Past printings.`);
      state.tab = 'past';
      state.busy = false;
      await load();
    } catch (err) {
      state.busy = false;
      btn.disabled = false;
      btn.textContent = 'Make the print file';
      toast(err.message);
    }
  }

  /* ----------------------------------------------------------- wording */

  async function renderWording() {
    const el = $('rcp-view-wording');
    if (!state.wording) {
      el.innerHTML = `<p class="fnd-empty">Loading the letter.</p>`;
      try {
        state.wording = await api('/api/receipts/wording');
      } catch (err) {
        el.innerHTML = `<p class="fnd-empty">${esc(err.message)}</p>`;
        return;
      }
    }
    const w = state.wording;
    const c = w.copy;
    el.innerHTML = `
      <p class="fnd-note">Every letter prints these words. Put **two stars** around words to print them in bold, and {amount} where the gift amount goes. The page says when the letter is too long for the paper.</p>
      <div class="rcp-word">
        ${c.paragraphs
          .map((p, i) => `<label class="req-field"><span>Paragraph ${i + 1}</span><textarea data-p="${i}" rows="4">${esc(p)}</textarea></label>`)
          .join('')}
        <div class="exp-grid2 rcp-word__sign">
          <label class="req-field"><span>Closing</span><input id="rcp-w-closing" value="${esc(c.closing)}" /></label>
          <label class="req-field"><span>Signed</span><input id="rcp-w-name" value="${esc(c.signerName)}" /></label>
          <label class="req-field"><span>Title</span><input id="rcp-w-title" value="${esc(c.signerTitle)}" /></label>
          <label class="req-field"><span>Greeting</span>
            <select id="rcp-w-greet"><option value="full"${c.greeting === 'full' ? ' selected' : ''}>Dear Maurice and Corlyn Deming,</option><option value="first"${c.greeting === 'first' ? ' selected' : ''}>Dear Maurice and Corlyn,</option></select>
          </label>
          <label class="req-field"><span>Amounts on the reply slip</span><input id="rcp-w-asks" value="${esc(c.asks.regular.join(', '))}" /></label>
          <label class="req-field"><span>Amounts for gifts of $200 and up</span><input id="rcp-w-asks-major" value="${esc(c.asks.major.join(', '))}" /></label>
        </div>
        <p class="rcp-fine" id="rcp-w-fit">${w.fit.fits ? 'Fits on the page.' : 'Too long for the page.'}${w.saved ? ` Last changed by ${esc(w.saved.updated_by || 'someone')} on ${esc(stamp(w.saved.updated_at))}.` : ' This is the standard letter.'}</p>
        <div class="fnd-form__foot">
          <button type="button" class="req-submit" id="rcp-w-save">Save the wording</button>
          <button type="button" class="req-ghost" id="rcp-w-sample">See a sample letter</button>
          <button type="button" class="fnd-textbtn is-quiet" id="rcp-w-reset">Put back the standard letter</button>
        </div>
      </div>`;
    const collect = () => ({
      paragraphs: [...el.querySelectorAll('textarea[data-p]')].map((t) => t.value),
      closing: $('rcp-w-closing').value,
      signerName: $('rcp-w-name').value,
      signerTitle: $('rcp-w-title').value,
      greeting: $('rcp-w-greet').value,
      asks: {
        regular: $('rcp-w-asks').value.split(/[,\s$]+/).filter(Boolean).map(Number),
        major: $('rcp-w-asks-major').value.split(/[,\s$]+/).filter(Boolean).map(Number),
      },
    });
    $('rcp-w-save').addEventListener('click', async () => {
      if (needWho()) return;
      try {
        const out = await api('/api/receipts/wording', { method: 'POST', body: JSON.stringify({ copy: collect() }) });
        state.wording = null;
        toast('Saved. The next print file uses it.');
        renderWording();
        return out;
      } catch (err) {
        toast(err.message);
      }
    });
    $('rcp-w-reset').addEventListener('click', async () => {
      if (needWho()) return;
      if (!confirm('Put back the standard letter? The current wording is kept in the log.')) return;
      try {
        await api('/api/receipts/wording', { method: 'POST', body: JSON.stringify({ reset: true }) });
        state.wording = null;
        toast('The standard letter is back.');
        renderWording();
      } catch (err) {
        toast(err.message);
      }
    });
    $('rcp-w-sample').addEventListener('click', async () => {
      const tab = window.open('', '_blank');
      try {
        const res = await fetch('/api/receipts/sample', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ copy: collect() }),
        });
        if (!res.ok) throw new Error('The sample did not build. Try again.');
        const url = URL.createObjectURL(await res.blob());
        if (tab) tab.location = url;
        else window.location = url;
      } catch (err) {
        if (tab) tab.close();
        toast(err.message);
      }
    });
  }

  /* ------------------------------------------------------------- start */

  (async () => {
    try {
      const me = await api('/api/receipts/me');
      if (me.unlocked) await load();
      else showLocked();
    } catch {
      showLocked();
    }
  })();
})();
