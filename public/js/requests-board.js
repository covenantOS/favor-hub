(() => {
  const COLS = [
    { id: 'inbox', label: 'Inbox' },
    { id: 'approved', label: 'Approved' },
    { id: 'in_progress', label: 'In motion' },
    { id: 'done', label: 'Done' },
  ];
  const STATUS = { inbox: 'Inbox', approved: 'Approved', in_progress: 'In motion', done: 'Done', declined: 'Declined' };
  const SURFACE = { website: 'Website', portal: 'Portal', dashboard: 'Hub', app: 'App' };
  // The filters over the board. Each reads the task fields the server sends with every request.
  const VIEWS = [
    { id: 'all', label: 'All' },
    { id: 'mine', label: 'Mine' },
    { id: 'sent', label: 'Sent by me' },
    { id: 'waiting', label: 'Waiting on others' },
    { id: 'new', label: 'New for you' },
  ];

  const boardEl = document.getElementById('req-board');
  const tabsEl = document.getElementById('req-tabs');
  const filtersEl = document.getElementById('req-filters');
  const countEl = document.getElementById('req-count');
  const drawer = document.getElementById('req-drawer');
  const panel = document.getElementById('req-drawer-panel');
  const unlockBtn = document.getElementById('req-unlock');
  const lockBtn = document.getElementById('req-lock');
  const login = document.getElementById('req-login');
  const loginMsg = document.getElementById('req-login-msg');
  const hint = document.getElementById('req-hint');
  if (!boardEl) return;
  // The drawer sits on the body so it covers the menu and the top bar.
  document.body.appendChild(drawer);
  const RT = window.ReqTasks;

  let admin = false;
  let loaded = false;
  let items = [];
  let tasksOn = false;
  let meEmail = '';
  let activeTab = 'inbox';
  // On a phone the board shows one lane at a time. It opens on the first lane with cards until a lane is tapped.
  let tabPicked = false;
  const touch = window.matchMedia('(hover: none)').matches;
  let openId = null;
  let drag = null;
  let ovTok = null;
  const params = new URLSearchParams(location.search);
  let view = VIEWS.some((v) => v.id === params.get('view')) ? params.get('view') : 'all';
  let byPerson = '';
  let pendingOpen = params.get('r') || '';

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

  let toastEl = null;
  let toastT = 0;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'rt-toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('is-on'), 3000);
  }

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
    new: (i) => (t(i).unread || 0) > 0,
  };
  const shown = () => items.filter((i) => TESTS[view](i) && (!byPerson || onIt(i, byPerson)));
  function renderFilters() {
    if (!filtersEl) return;
    if (!tasksOn) { filtersEl.hidden = true; return; }
    filtersEl.hidden = false;
    const n = (id) => items.filter(TESTS[id]).length;
    const chips = VIEWS.filter((v) => v.id !== 'new' || n('new') > 0 || view === 'new').map((v) => {
      const count = v.id === 'all' ? '' : ` <span>${n(v.id)}</span>`;
      return `<button type="button" class="rt-chip${view === v.id ? ' is-on' : ''}" data-view="${v.id}" aria-pressed="${view === v.id}">${esc(v.label)}${count}</button>`;
    });
    const p = byPerson ? RT.person(byPerson) : null;
    chips.push(
      p
        ? `<span class="rt-chip rt-chip--person is-on">${RT.avatar(byPerson, 'xs')}<span>${esc(p.name)}</span><button type="button" class="rt-chip__x" data-person-clear aria-label="Show everyone">&#x2715;</button></span>`
        : `<button type="button" class="rt-chip rt-chip--pick" data-person-pick>By person</button>`
    );
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
    if (k.owner) bits.push(`<span class="rt-owner">${RT.avatar(k.owner, 'xs')}<span>${esc(RT.person(k.owner).name.split(' ')[0])}</span></span>`);
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

  function nextActions(item) {
    if (!admin) {
      const can = item.can || {};
      if (!tasksOn) return '';
      if (can.done) return `<div class="req-actions"><button type="button" class="primary" data-mine="done">Mark done</button></div>`;
      if (can.comment && item.status === 'done') return `<div class="req-actions"><button type="button" data-mine="reopen">Reopen</button></div>`;
      return '';
    }
    const btns = [];
    if (item.status === 'inbox') btns.push(['approved', 'Approve'], ['declined', 'Decline']);
    if (item.status === 'approved') btns.push(['in_progress', 'Start'], ['inbox', 'Back to inbox'], ['declined', 'Decline']);
    if (item.status === 'in_progress') btns.push(['done', 'Mark done'], ['approved', 'Back to approved']);
    if (item.status === 'done') btns.push(['in_progress', 'Reopen']);
    if (item.status === 'declined') btns.push(['inbox', 'Restore']);
    return `<div class="req-actions">${btns
      .map(
        ([status, label], i) =>
          `<button type="button" class="${i === 0 ? 'primary' : ''}" data-status="${status}">${label}</button>`
      )
      .join('')}</div>`;
  }

  function isImage(a) {
    return String(a.content_type || '').startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(a.filename || '');
  }

  function attThumb(a) {
    if (isImage(a)) return `<img src="${esc(a.url)}" alt="" />`;
    return `<span class="req-file">${esc(a.filename)}</span>`;
  }

  function attLink(a) {
    if (isImage(a)) {
      return `<a href="${esc(a.url)}" target="_blank" rel="noopener"><img src="${esc(a.url)}" alt="${esc(a.filename)}" /></a>`;
    }
    return `<a class="req-file" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.filename)}</a>`;
  }

  function locHtml(url) {
    if (!url) return '';
    if (/^https?:\/\//i.test(url) || url.startsWith('/')) {
      return `<p><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></p>`;
    }
    return `<p>${esc(url)}</p>`;
  }

  /* ------------------------------------------------------------------ the drawer */
  function personBtn(email, attr, label) {
    const p = RT.person(email);
    return `<button type="button" class="rt-pchip" ${attr} aria-label="${esc(label)}">${RT.avatar(email, 'xs')}<span class="rt-pchip__t"><b>${esc(p.name)}</b>${p.team ? `<small>${esc(p.team)}</small>` : ''}</span></button>`;
  }
  function fieldsHtml(item) {
    if (!tasksOn || !item.task) return '';
    const k = item.task;
    const can = item.can || {};
    const owner = k.owner
      ? `<span class="rt-pstatic">${RT.avatar(k.owner, 'xs')}<span class="rt-pchip__t"><b>${esc(RT.person(k.owner).name)}</b>${RT.person(k.owner).team ? `<small>${esc(RT.person(k.owner).team)}</small>` : ''}</span></span>`
      : '<span class="rt-none-inline">No owner</span>';
    const send = can.send ? `<button type="button" class="rt-btn rt-btn--primary rt-btn--sm" data-send-to>Send to...</button>` : '';
    const due = can.edit
      ? `<input type="date" class="rt-date" data-due value="${esc(k.due_date || '')}" aria-label="Due date" />${k.due_date ? `<button type="button" class="rt-btn rt-btn--ghost rt-btn--sm" data-due-clear>Clear</button>` : ''}`
      : k.due_date ? `<span>${esc(RT.dayWord(k.due_date))}</span>` : '<span class="rt-none-inline">None</span>';
    const wait = k.waiting_on
      ? can.edit ? personBtn(k.waiting_on, 'data-wait', 'Change who it is waiting on') : `<span class="rt-pstatic">${RT.avatar(k.waiting_on, 'xs')}<span class="rt-pchip__t"><b>${esc(RT.person(k.waiting_on).name)}</b></span></span>`
      : can.edit ? `<button type="button" class="rt-btn rt-btn--ghost rt-btn--sm" data-wait>Pick a person</button>` : '<span class="rt-none-inline">Nobody</span>';
    const fol = (k.followers || []).slice(0, 6).map((e) => `<span title="${esc(RT.person(e).name)}">${RT.avatar(e, 'xs')}</span>`).join('');
    const more = (k.followers || []).length > 6 ? `<span class="rt-more">+${k.followers.length - 6}</span>` : '';
    const follow = can.follow ? `<button type="button" class="rt-btn rt-btn--ghost rt-btn--sm${item.following ? ' is-on' : ''}" data-follow aria-pressed="${item.following ? 'true' : 'false'}">${item.following ? 'Following' : 'Follow'}</button>` : '';
    return `<dl class="rt-fields">
      <div class="rt-field"><dt>Owner</dt><dd>${owner}${send}</dd></div>
      <div class="rt-field"><dt>Due</dt><dd>${due}</dd></div>
      <div class="rt-field"><dt>Waiting on</dt><dd>${wait}${k.waiting_on && can.edit ? `<button type="button" class="rt-btn rt-btn--ghost rt-btn--sm" data-wait-clear>Clear</button>` : ''}</dd></div>
      <div class="rt-field"><dt>Following</dt><dd><span class="rt-stack">${fol}${more}</span>${follow}</dd></div>
    </dl>`;
  }

  function scrollHtml(item) {
    const atts = (item.attachments || []).map((a) => attLink(a)).join('');
    const activity = tasksOn && item.comments ? RT.activityHtml(item, meEmail) : (item.events || []).map((e) => `<li>${esc(e.created_at.slice(0, 10))} · ${esc(e.kind)} · ${esc(e.actor)}</li>`).join('');
    return `
      <div class="req-drawer__meta">
        <span class="req-chip req-chip--${esc(item.status)}">${esc(STATUS[item.status] || item.status)}</span>
        <span class="req-chip">${esc(SURFACE[item.surface] || item.surface)}</span>
        <span class="req-chip">${esc(item.submitter_name)}</span>
      </div>
      <h2 id="rt-title">${esc(item.title)}</h2>
      ${fieldsHtml(item)}
      ${item.page_url ? locHtml(item.page_url) : ''}
      <div class="req-drawer__body">${esc(item.body)}</div>
      ${atts ? `<div class="req-gallery">${atts}</div>` : ''}
      ${nextActions(item)}
      ${admin && item.repo ? `<p class="req-empty">Repo: ${esc(item.repo)} · ${esc(item.branch)}</p>` : ''}
      ${tasksOn && item.comments ? (activity ? `<h3 class="rt-h">Activity</h3><div class="rt-activity rt-ch" aria-live="polite">${activity}</div>` : '') : activity ? `<ul class="req-timeline">${activity}</ul>` : ''}`;
  }

  function footHtml(item) {
    if (!tasksOn || !item.can) return '';
    if (item.can.comment) return `<div class="rt-dfoot rt-ch">${RT.composerHtml('Comment, or @ to bring someone in')}</div>`;
    return `<div class="rt-dfoot rt-dfoot--note">Comments are open to the people on this request.</div>`;
  }

  function paintDrawer(item, opts = {}) {
    const scroll = panel.querySelector('.rt-dscroll');
    const atBottom = scroll && scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 40;
    const keep = scroll ? scroll.scrollTop : 0;
    if (!panel.querySelector('.rt-dhead') || panel.dataset.id !== item.id) {
      panel.dataset.id = item.id;
      panel.classList.add('rt-panel');
      panel.innerHTML = `<div class="rt-dhead"><button type="button" class="h-x req-drawer__x" data-close aria-label="Close">&#x2715;</button></div><div class="rt-dscroll"></div><div class="rt-dfoot-slot"></div>`;
      drawer.setAttribute('aria-labelledby', 'rt-title');
    }
    panel.querySelector('.rt-dscroll').innerHTML = scrollHtml(item);
    // The composer is drawn once per request, so a draft survives every refresh of the rest.
    const slot = panel.querySelector('.rt-dfoot-slot');
    const want = footHtml(item);
    const has = slot.dataset.kind || '';
    const kind = item.can && item.can.comment ? 'composer' : want ? 'note' : '';
    if (has !== kind) {
      slot.innerHTML = want;
      slot.dataset.kind = kind;
      if (kind === 'composer') RT.bindComposer(slot, (text) => comment(item.id, text));
    }
    const s2 = panel.querySelector('.rt-dscroll');
    if (opts.toEnd || atBottom) s2.scrollTop = s2.scrollHeight;
    else s2.scrollTop = keep;
    // Keyboard users land on Close when the drawer opens.
    const close = panel.querySelector('[data-close]');
    if (opts.first && close && !touch && !panel.contains(document.activeElement)) close.focus();
  }

  function take(req) {
    const idx = items.findIndex((i) => i.id === req.id);
    const card = Object.assign({}, req, { task: req.task || (idx >= 0 ? items[idx].task : null) });
    if (card.task) card.task = Object.assign({}, card.task, { unread: 0 });
    if (idx >= 0) items[idx] = card;
    return card;
  }

  function openDrawer(id) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    openId = id;
    drawer.hidden = false;
    document.documentElement.classList.add('req-drawer-open');
    // The phone back gesture closes the drawer and stays on the board.
    if (window.hubOv) {
      if (!ovTok) ovTok = window.hubOv.on(() => { ovTok = null; closeDrawer(true); });
    } else if (!(history.state && history.state.reqDrawer)) history.pushState({ reqDrawer: true }, '');
    panel.removeAttribute('data-id');
    paintDrawer(item, { first: true });
    fetch(`/api/requests/${id}`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((data) => {
        if (!data.request || openId !== id) return;
        const had = (item.task && item.task.unread) || 0;
        paintDrawer(take(data.request), { toEnd: had > 0 });
        renderBoard();
        if (had && tasksOn) api(`/api/requests/${id}/read`, { method: 'POST', json: {} }).then(() => { if (window.WCBell && window.WCBell.refresh) window.WCBell.refresh(); }).catch(() => {});
      })
      .catch(() => {});
  }

  function closeDrawer(fromPop) {
    if (drawer.hidden) return;
    RT && RT.closeSheet(null);
    drawer.hidden = true;
    openId = null;
    panel.innerHTML = '';
    panel.removeAttribute('data-id');
    document.documentElement.classList.remove('req-drawer-open');
    if (ovTok && window.hubOv) { const tk = ovTok; ovTok = null; window.hubOv.off(tk); }
    else if (fromPop !== true && history.state && history.state.reqDrawer) history.back();
    if (new URLSearchParams(location.search).get('r')) {
      const u = new URL(location.href);
      u.searchParams.delete('r');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    }
  }
  window.addEventListener('popstate', () => {
    if (!drawer.hidden && !window.hubOv) closeDrawer(true);
  });

  async function moveCard(id, status) {
    const item = items.find((i) => i.id === id);
    if (!item || item.status === status) return;
    const data = await api(`/api/requests/${id}`, { method: 'PATCH', json: { status } });
    const card = take(data.request);
    renderBoard();
    if (openId === id) paintDrawer(card);
  }

  async function act(id, path, json, method = 'POST') {
    const data = await api(`/api/requests/${id}/${path}`, { method, json: json || {} });
    const card = take(data.request);
    renderBoard();
    if (openId === id) paintDrawer(card, { toEnd: path === 'comments' });
    return card;
  }
  const comment = (id, text) => act(id, 'comments', { body: text }).catch((err) => { toast(err.message); throw err; });

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
    tasksOn = Boolean(data.tasks) && !!RT;
    meEmail = (data.me && data.me.email) || '';
    if (tasksOn) await RT.people();
    loaded = true;
    const list = shown();
    if (!tabPicked) activeTab = (COLS.find((c) => list.some((i) => i.status === c.id)) || COLS[0]).id;
    setAdminUi();
    renderBoard();
    if (pendingOpen) {
      const id = pendingOpen;
      pendingOpen = '';
      if (items.some((i) => i.id === id)) openDrawer(id);
      else {
        // A request outside the board's list (declined, for someone on it) still opens from its link.
        api(`/api/requests/${id}`).then((d) => { if (d.request) { items.push(Object.assign({ task: null }, d.request)); openDrawer(id); } }).catch(() => toast('That request is not on the board.'));
      }
    }
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
      if (e.target.closest('[data-person-clear]')) { byPerson = ''; renderBoard(); return; }
      if (e.target.closest('[data-person-pick]')) {
        const r = await RT.pick({ title: 'Requests by person' });
        if (r && r.email) { byPerson = r.email; renderBoard(); }
      }
    });
  }

  drawer.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) {
      closeDrawer();
      return;
    }
    const id = openId;
    if (!id) return;
    const item = items.find((i) => i.id === id) || {};
    try {
      const btn = e.target.closest('[data-status]');
      if (btn) { await moveCard(id, btn.dataset.status); return; }
      const mine = e.target.closest('[data-mine]');
      if (mine) {
        await act(id, mine.dataset.mine);
        toast(mine.dataset.mine === 'done' ? 'Marked done. The person who asked gets an email.' : 'Reopened');
        return;
      }
      if (e.target.closest('[data-send-to]')) {
        const owner = item.task && item.task.owner;
        const r = await RT.pick({ title: 'Send to', note: true, noteLabel: 'Context', action: 'Send', exclude: owner ? [owner] : [] });
        if (r && r.email) {
          await act(id, 'send', { to: r.email, note: r.note || '' });
          toast(`Sent to ${RT.person(r.email).name}`);
        }
        return;
      }
      if (e.target.closest('[data-wait]')) {
        const r = await RT.pick({ title: 'Waiting on', current: item.task && item.task.waiting_on, exclude: [meEmail] });
        if (r && r.email) await act(id, 'task', { waiting_on: r.email }, 'PATCH');
        return;
      }
      if (e.target.closest('[data-wait-clear]')) { await act(id, 'task', { waiting_on: null }, 'PATCH'); return; }
      if (e.target.closest('[data-due-clear]')) { await act(id, 'task', { due_date: null }, 'PATCH'); return; }
      const f = e.target.closest('[data-follow]');
      if (f) { await act(id, 'follow', { on: !item.following }); return; }
      const d = e.target.closest('[data-rt-del]');
      if (d) { await act(id, `comments/${encodeURIComponent(d.dataset.rtDel)}`, {}, 'DELETE'); return; }
    } catch (err) {
      toast(err.message);
    }
  });
  drawer.addEventListener('change', async (e) => {
    const due = e.target.closest('[data-due]');
    if (!due || !openId) return;
    try { await act(openId, 'task', { due_date: due.value || null }, 'PATCH'); } catch (err) { toast(err.message); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !drawer.hidden && !document.documentElement.classList.contains('rt-sheet-open')) closeDrawer();
  });

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
