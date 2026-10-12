(() => {
  const COLS = [
    { id: 'inbox', label: 'Inbox' },
    { id: 'approved', label: 'Approved' },
    { id: 'in_progress', label: 'In motion' },
    { id: 'done', label: 'Done' },
  ];
  const STATUS = { inbox: 'Inbox', approved: 'Approved', in_progress: 'In motion', done: 'Done', declined: 'Declined' };
  const SURFACE = { website: 'Website', portal: 'Portal', dashboard: 'FavorOS', app: 'App' };
  // The filters over the board. Each reads the task fields the server sends with every request.
  const VIEWS = [
    { id: 'all', label: 'All' },
    { id: 'mine', label: 'Mine' },
    { id: 'sent', label: 'Sent by me' },
    { id: 'waiting', label: 'Waiting on others' },
    { id: 'onme', label: 'Waiting on me' },
    { id: 'new', label: 'New for you' },
  ];

  const boardEl = document.getElementById('req-board');
  const tabsEl = document.getElementById('req-tabs');
  const filtersEl = document.getElementById('req-filters');
  const countEl = document.getElementById('req-count');
  const unlockBtn = document.getElementById('req-unlock');
  const lockBtn = document.getElementById('req-lock');
  const login = document.getElementById('req-login');
  const loginMsg = document.getElementById('req-login-msg');
  const hint = document.getElementById('req-hint');
  if (!boardEl) return;
  const RT = window.ReqTasks;
  const FR = window.FavorRequest;

  let admin = false;
  let loaded = false;
  let items = [];
  let tasksOn = false;
  let meEmail = '';
  let activeTab = 'inbox';
  // On a phone the board shows one lane at a time. It opens on the first lane with cards until a lane is tapped.
  let tabPicked = false;
  const touch = window.matchMedia('(hover: none)').matches;
  let drag = null;
  const params = new URLSearchParams(location.search);
  let view = VIEWS.some((v) => v.id === params.get('view')) ? params.get('view') : 'all';
  let byPerson = '';

  const esc = (s) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '...' : s);

  // The card shows the ask in the requester's words. The form adds Kind, Where and Location lines
  // after it, and many asks repeat the title first; the drawer still shows all of it.
  const FORM_LINES = /\s*\b(?:Kind|Where|Location):/;
  function preview(item) {
    let text = String(item.body || '').split(FORM_LINES)[0].trim();
    const title = String(item.title || '').trim();
    if (title && text.toLowerCase().startsWith(title.toLowerCase())) text = text.slice(title.length).replace(/^[\s.:,-]+/, '');
    return clip(text, 140);
  }

  async function api(path, opts = {}) {
    const headers = Object.assign({ 'X-Hub-Request': '1' }, opts.json ? { 'Content-Type': 'application/json' } : {}, opts.headers || {});
    const res = await fetch(path, { credentials: 'same-origin', ...opts, headers, body: opts.json ? JSON.stringify(opts.json) : opts.body });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.error === 'signin') {
      location.href = '/login/?next=' + encodeURIComponent(location.pathname + location.search);
    }
    if (!res.ok) throw new Error(data.message || 'Request failed');
    return data;
  }

  const toast = (msg) => (FR ? FR.toast(msg) : undefined);

  // Who is signed in. Will signed in with Google reviews without the password; once sign-in is on,
  // the password box goes away for everyone else.
  let me = null;

  function setAdminUi() {
    const viaGoogle = Boolean(me && me.user && me.user.via === 'google');
    unlockBtn.hidden = !loaded || admin || Boolean(me && me.enforce);
    lockBtn.hidden = !admin || viaGoogle;
    login.hidden = admin || login.hidden;
    if (admin) login.hidden = true;
    hint.hidden = !admin;
    boardEl.classList.toggle('is-reviewing', admin);
  }

  // Shown until the first answer arrives: the same four lanes and card shapes, so nothing jumps when the cards land.
  function skeleton() {
    tabsEl.innerHTML = COLS.map(() => `<span class="req-skel req-skel--tab" aria-hidden="true"></span>`).join('');
    boardEl.innerHTML = `<section class="req-col is-on" aria-busy="true" aria-label="Loading requests">
      <div class="req-col__stack">${[0, 1, 2, 3]
        .map(() => `<div class="req-skel-card" aria-hidden="true"><span class="req-skel"></span><span class="req-skel req-skel--title"></span><span class="req-skel req-skel--line"></span></div>`)
        .join('')}</div></section>`;
  }

  /* ------------------------------------------------------------------ filters */
  const t = (i) => i.task || {};
  const onIt = (i, e) => { const k = t(i); return k.owner === e || k.sent_by === e || k.waiting_on === e || (k.followers || []).includes(e); };
  const TESTS = {
    all: () => true,
    mine: (i) => t(i).owner === meEmail,
    sent: (i) => t(i).sent_by === meEmail,
    waiting: (i) => !!t(i).waiting_on && t(i).waiting_on !== meEmail && (t(i).owner === meEmail || t(i).sent_by === meEmail),
    onme: (i) => t(i).waiting_on === meEmail && i.status !== 'done' && i.status !== 'declined',
    new: (i) => (t(i).unread || 0) > 0,
  };
  const shown = () => items.filter((i) => TESTS[view](i) && (!byPerson || onIt(i, byPerson)));
  function renderFilters() {
    if (!filtersEl) return;
    if (!tasksOn) { filtersEl.hidden = true; return; }
    filtersEl.hidden = false;
    const n = (id) => items.filter(TESTS[id]).length;
    const chips = VIEWS.filter((v) => (v.id !== 'new' && v.id !== 'onme') || n(v.id) > 0 || view === v.id).map((v) => {
      const count = v.id === 'all' ? '' : ` <span>${n(v.id)}</span>`;
      return `<button type="button" class="rt-chip${view === v.id ? ' is-on' : ''}" data-view="${v.id}" aria-pressed="${view === v.id}">${esc(v.label)}${count}</button>`;
    });
    const p = byPerson ? RT.person(byPerson) : null;
    chips.push(
      p
        ? `<span class="rt-chip rt-chip--person is-on">${RT.avatar(byPerson, 'sm')}<span>${esc(p.name)}</span><button type="button" class="rt-chip__x" data-person-clear aria-label="Show everyone">&#x2715;</button></span>`
        : `<button type="button" class="rt-chip rt-chip--pick" data-person-pick>By person</button>`
    );
    chips.push(`<button type="button" class="rt-chip rt-chip--quiet" data-prefs>Request email</button>`);
    filtersEl.innerHTML = chips.join('');
  }

  function renderTabs(list) {
    tabsEl.innerHTML = COLS.map(
      (c) =>
        `<button type="button" data-tab="${c.id}" class="${c.id === activeTab ? 'is-on' : ''}">${c.label} (${list.filter((i) => i.status === c.id).length})</button>`
    ).join('');
  }

  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  function cardFoot(item) {
    const k = item.task;
    if (!k) return '';
    const bits = [];
    if (k.owner) bits.push(`<span class="rt-owner">${RT.avatar(k.owner, 'sm')}<span>${esc(RT.person(k.owner).name.split(' ')[0])}</span></span>`);
    if (k.due_date) {
      const late = item.status !== 'done' && k.due_date < today();
      bits.push(`<span class="rt-due${late ? ' is-late' : ''}">${late ? 'Late ' : 'Due '}${esc(RT.dayWord(k.due_date))}</span>`);
    }
    if (k.waiting_on) bits.push(`<span class="rt-wait">Waiting on ${esc(RT.person(k.waiting_on).name.split(' ')[0])}</span>`);
    if (k.comments) bits.push(`<span class="rt-count" aria-label="${k.comments} comments"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>${k.comments}</span>`);
    if (k.unread) bits.push(`<span class="rt-new">New</span>`);
    return bits.length ? `<div class="rt-foot">${bits.join('')}</div>` : '';
  }

  function cardHtml(item, index) {
    const thumbs = (item.attachments || [])
      .slice(0, 3)
      .map((a) => attThumb(a))
      .join('');
    const dragAttr = admin ? ' data-draggable="true"' : '';
    return `<article class="req-card${item.task && item.task.unread ? ' has-new' : ''}" tabindex="0" role="button" data-id="${esc(item.id)}" style="--i:${Math.min(index, 8)}"${dragAttr}>
      <div class="req-card__kicker"><span>${esc(SURFACE[item.surface] || item.surface)}</span><span>${esc(item.submitter_name)}</span></div>
      <h3>${esc(item.title)}</h3>
      ${preview(item) ? `<p>${esc(preview(item))}</p>` : ''}
      ${thumbs ? `<div class="req-thumbs">${thumbs}</div>` : ''}
      ${cardFoot(item)}
    </article>`;
  }

  function renderBoard() {
    const list = shown();
    const declined = admin ? list.filter((i) => i.status === 'declined') : [];
    const declinedOpen = Boolean(boardEl.querySelector('details[data-col="declined"][open]'));
    const filtered = view !== 'all' || byPerson;
    boardEl.innerHTML = COLS.map((c) => {
      const lane = list.filter((i) => i.status === c.id);
      const body = lane.length
        ? lane.map((item, i) => cardHtml(item, i)).join('')
        : `<p class="req-empty">${filtered ? 'None here for this filter.' : admin && !touch ? 'Drop a card here.' : 'Nothing here yet.'}</p>`;
      return `<section class="req-col ${c.id === activeTab ? 'is-on' : ''}" data-col="${c.id}">
        <div class="req-col__head"><h2>${c.label}</h2><span>${lane.length}</span></div>
        <div class="req-col__stack">${body}</div>
      </section>`;
    }).join('');
    if (declined.length) {
      boardEl.insertAdjacentHTML(
        'beforeend',
        `<details class="req-col req-col--wide" data-col="declined"${declinedOpen ? ' open' : ''}>
          <summary class="req-col__head"><h2>Declined</h2><span>${declined.length}</span></summary>
          <div class="req-col__stack">${declined.map((item, i) => cardHtml(item, i)).join('')}</div>
        </details>`
      );
    }
    renderTabs(list);
    renderFilters();
    countEl.hidden = false;
    const open = items.filter((i) => i.status !== 'done' && i.status !== 'declined').length;
    countEl.textContent = `${open} open · ${items.filter((i) => i.status === 'done').length} done`;
  }

  function isImage(a) {
    return String(a.content_type || '').startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(a.filename || '');
  }

  function attThumb(a) {
    if (isImage(a)) return `<img src="${esc(a.url)}" alt="" />`;
    return `<span class="req-file">${esc(a.filename)}</span>`;
  }

  // A change made in the panel (or anywhere else on the page) lands on its card.
  document.addEventListener('favor-request', (e) => {
    const req = e.detail && e.detail.request;
    if (!req || !boardEl.isConnected) return;
    const idx = items.findIndex((i) => i.id === req.id);
    const card = Object.assign({}, req, { task: req.task || (idx >= 0 ? items[idx].task : null) });
    if (idx >= 0) items[idx] = card;
    else items.unshift(card);
    renderBoard();
  });

  function openDrawer(id) {
    const item = items.find((i) => i.id === id);
    if (FR) FR.open(id, { preview: item && item.can ? item : null });
  }

  async function moveCard(id, status) {
    const item = items.find((i) => i.id === id);
    if (!item || item.status === status) return;
    const data = await api(`/api/requests/${id}`, { method: 'PATCH', json: { status } });
    const idx = items.findIndex((i) => i.id === id);
    if (idx >= 0) items[idx] = Object.assign({}, data.request, { task: data.request.task || items[idx].task });
    renderBoard();
  }

  function clearDrag() {
    if (drag?.ghost) drag.ghost.remove();
    if (drag?.card) drag.card.classList.remove('req-card--origin');
    boardEl.classList.remove('is-dragging');
    document.body.classList.remove('is-dragging-card');
    boardEl.querySelectorAll('.req-col.is-drop').forEach((c) => c.classList.remove('is-drop'));
    drag = null;
  }

  async function load() {
    if (!me) me = await api('/api/auth/me').catch(() => ({}));
    const data = await api('/api/requests');
    admin = Boolean(data.admin);
    items = data.requests || [];
    tasksOn = Boolean(data.tasks) && !!RT && !!FR;
    meEmail = (data.me && data.me.email) || '';
    if (tasksOn) await RT.people();
    loaded = true;
    const list = shown();
    if (!tabPicked) activeTab = (COLS.find((c) => list.some((i) => i.status === c.id)) || COLS[0]).id;
    setAdminUi();
    renderBoard();
  }

  // Open in Google Sheets: every request the board shows this person (an admin also gets the email and the reason for a decline).
  if (window.FavorSheets) {
    window.FavorSheets.register('requests', () => {
      const cols = [
        { key: 'title', label: 'Request', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'surface', label: 'Where', type: 'text' }, { key: 'who', label: 'Asked by', type: 'text' },
        ...(admin ? [{ key: 'email', label: 'Email', type: 'text' }] : []),
        ...(tasksOn ? [{ key: 'owner', label: 'Owner', type: 'text' }, { key: 'due', label: 'Due', type: 'text' }, { key: 'waiting', label: 'Waiting on', type: 'text' }] : []),
        { key: 'created', label: 'Made', type: 'datetime' }, { key: 'updated', label: 'Changed', type: 'datetime' }, { key: 'done', label: 'Finished', type: 'datetime' },
        ...(admin ? [{ key: 'declined', label: 'Why declined', type: 'text' }] : []),
        { key: 'body', label: 'What was asked', type: 'text' },
      ];
      const nm = (e) => (e && RT ? RT.person(e).name : '');
      const rows = shown().map((i) => ({ title: i.title, status: STATUS[i.status] || i.status, surface: SURFACE[i.surface] || i.surface, who: i.submitter_name, email: i.submitter_email || '', owner: nm(i.task && i.task.owner), due: (i.task && i.task.due_date) || '', waiting: nm(i.task && i.task.waiting_on), created: i.created_at, updated: i.updated_at, done: i.completed_at, declined: i.declined_reason || '', body: i.body || '' }));
      return window.FavorSheets.screen('Request board', [{ name: 'Requests', columns: cols, rows }], { classes: admin ? ['staff'] : [] });
    });
  }

  boardEl.addEventListener('pointerdown', (e) => {
    if (!admin || e.button !== 0) return;
    const card = e.target.closest('.req-card');
    if (!card) return;
    drag = {
      id: card.dataset.id,
      x: e.clientX,
      y: e.clientY,
      card,
      moved: false,
      ghost: null,
      pointerId: e.pointerId,
    };
  });

  // Holding a card to drag it must not start selecting the text under the pointer.
  boardEl.addEventListener('mousedown', (e) => {
    if (admin && e.button === 0 && e.target.closest('.req-card')) e.preventDefault();
  });

  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && dx * dx + dy * dy < 64) return;
    if (!drag.moved) {
      drag.moved = true;
      const ghost = drag.card.cloneNode(true);
      ghost.classList.add('req-card--ghost');
      ghost.style.width = `${drag.card.getBoundingClientRect().width}px`;
      document.body.appendChild(ghost);
      drag.ghost = ghost;
      drag.card.classList.add('req-card--origin');
      boardEl.classList.add('is-dragging');
      document.body.classList.add('is-dragging-card');
      const sel = window.getSelection && window.getSelection();
      if (sel) sel.removeAllRanges();
    }
    drag.ghost.style.transform = `translate(${e.clientX - 28}px, ${e.clientY - 18}px) rotate(-2deg)`;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const col = under && under.closest('[data-col]');
    boardEl.querySelectorAll('.req-col').forEach((c) => c.classList.toggle('is-drop', c === col));
  });

  window.addEventListener('pointerup', async (e) => {
    if (!drag) return;
    const { id, moved } = drag;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const col = under && under.closest('[data-col]');
    const status = col && col.dataset.col;
    clearDrag();
    if (!moved) {
      openDrawer(id);
      return;
    }
    if (status) {
      try {
        await moveCard(id, status);
      } catch (err) {
        toast(err.message);
      }
    }
  });

  window.addEventListener('pointercancel', () => {
    if (drag) clearDrag();
  });

  // Everyone can open a card to read it; for Will the drag handler above opens it instead.
  boardEl.addEventListener('click', (e) => {
    if (admin) return;
    const card = e.target.closest('.req-card');
    if (card) openDrawer(card.dataset.id);
  });
  boardEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.req-card');
    if (!card) return;
    e.preventDefault();
    openDrawer(card.dataset.id);
  });

  tabsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    activeTab = btn.dataset.tab;
    tabPicked = true;
    renderBoard();
  });

  function setView(next) {
    view = next;
    const u = new URL(location.href);
    if (view === 'all') u.searchParams.delete('view');
    else u.searchParams.set('view', view);
    history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    if (!tabPicked) {
      const list = shown();
      activeTab = (COLS.find((c) => list.some((i) => i.status === c.id)) || COLS[0]).id;
    }
    renderBoard();
  }
  if (filtersEl) {
    filtersEl.addEventListener('click', async (e) => {
      const v = e.target.closest('[data-view]');
      if (v) { setView(v.dataset.view); return; }
      if (e.target.closest('[data-prefs]')) { FR.prefs(); return; }
      if (e.target.closest('[data-person-clear]')) { byPerson = ''; renderBoard(); return; }
      if (e.target.closest('[data-person-pick]')) {
        const r = await RT.pick({ title: 'Requests by person' });
        if (r && r.email) { byPerson = r.email; renderBoard(); }
      }
    });
  }

  unlockBtn.addEventListener('click', () => {
    login.hidden = !login.hidden;
    if (!login.hidden) document.getElementById('req-password').focus();
  });

  lockBtn.addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST', body: '{}' });
    admin = false;
    await load();
  });

  login.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginMsg.textContent = '';
    try {
      await api('/api/admin/login', { method: 'POST', json: { password: document.getElementById('req-password').value } });
      document.getElementById('req-password').value = '';
      await load();
    } catch (err) {
      loginMsg.textContent = err.message;
    }
  });

  skeleton();
  load().catch((err) => {
    countEl.hidden = false;
    countEl.textContent = 'Board unavailable';
    boardEl.innerHTML = '<p class="req-empty">The board did not load. <button type="button" class="req-ghost" id="req-retry">Try again</button></p>';
    const retry = document.getElementById('req-retry');
    if (retry) retry.addEventListener('click', () => { skeleton(); load().catch(() => { boardEl.innerHTML = '<p class="req-empty">Still not loading. Check the connection and try again in a minute.</p>'; }); });
    if (loginMsg) loginMsg.textContent = err.message;
  });
})();
