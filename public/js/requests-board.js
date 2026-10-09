(() => {
  const COLS = [
    { id: 'inbox', label: 'Inbox' },
    { id: 'approved', label: 'Approved' },
    { id: 'in_progress', label: 'In motion' },
    { id: 'done', label: 'Done' },
  ];
  const STATUS = { inbox: 'Inbox', approved: 'Approved', in_progress: 'In motion', done: 'Done', declined: 'Declined' };
  const SURFACE = { website: 'Website', portal: 'Portal', dashboard: 'Hub', app: 'App' };

  const boardEl = document.getElementById('req-board');
  const tabsEl = document.getElementById('req-tabs');
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

  let admin = false;
  let items = [];
  let activeTab = 'inbox';
  let openId = null;
  let drag = null;

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
    const res = await fetch(path, { credentials: 'same-origin', ...opts });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.error === 'signin') {
      location.href = '/login/?next=' + encodeURIComponent(location.pathname + location.search);
    }
    if (!res.ok) throw new Error(data.message || 'Request failed');
    return data;
  }

  // Who is signed in. Will signed in with Google reviews without the password; once sign-in is on,
  // the password box goes away for everyone else.
  let me = null;

  function setAdminUi() {
    const viaGoogle = Boolean(me && me.user && me.user.via === 'google');
    unlockBtn.hidden = admin || Boolean(me && me.enforce);
    lockBtn.hidden = !admin || viaGoogle;
    login.hidden = admin || login.hidden;
    if (admin) login.hidden = true;
    hint.hidden = !admin;
    boardEl.classList.toggle('is-reviewing', admin);
  }

  function renderTabs() {
    tabsEl.innerHTML = COLS.map(
      (c) =>
        `<button type="button" data-tab="${c.id}" class="${c.id === activeTab ? 'is-on' : ''}">${c.label} (${items.filter((i) => i.status === c.id).length})</button>`
    ).join('');
  }

  function cardHtml(item, index) {
    const thumbs = (item.attachments || [])
      .slice(0, 3)
      .map((a) => attThumb(a))
      .join('');
    const dragAttr = admin ? ' data-draggable="true"' : '';
    return `<article class="req-card" tabindex="0" role="button" data-id="${esc(item.id)}" style="--i:${Math.min(index, 8)}"${dragAttr}>
      <div class="req-card__kicker"><span>${esc(SURFACE[item.surface] || item.surface)}</span><span>${esc(item.submitter_name)}</span></div>
      <h3>${esc(item.title)}</h3>
      ${preview(item) ? `<p>${esc(preview(item))}</p>` : ''}
      ${thumbs ? `<div class="req-thumbs">${thumbs}</div>` : ''}
    </article>`;
  }

  function renderBoard() {
    const declined = admin ? items.filter((i) => i.status === 'declined') : [];
    const declinedOpen = Boolean(boardEl.querySelector('details[data-col="declined"][open]'));
    boardEl.innerHTML = COLS.map((c) => {
      const list = items.filter((i) => i.status === c.id);
      const body = list.length
        ? list.map((item, i) => cardHtml(item, i)).join('')
        : `<p class="req-empty">${admin ? 'Drop a card here.' : 'Nothing here yet.'}</p>`;
      return `<section class="req-col ${c.id === activeTab ? 'is-on' : ''}" data-col="${c.id}">
        <div class="req-col__head"><h2>${c.label}</h2><span>${list.length}</span></div>
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
    renderTabs();
    const open = items.filter((i) => i.status !== 'done' && i.status !== 'declined').length;
    countEl.textContent = `${open} open · ${items.filter((i) => i.status === 'done').length} done`;
  }

  function nextActions(item) {
    if (!admin) return '';
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

  function paintDrawer(item) {
    const atts = (item.attachments || []).map((a) => attLink(a)).join('');
    const events = (item.events || [])
      .map((e) => `<li>${esc(e.created_at.slice(0, 10))} · ${esc(e.kind)} · ${esc(e.actor)}</li>`)
      .join('');
    panel.innerHTML = `
      <button type="button" class="h-x req-drawer__x" data-close aria-label="Close">&#x2715;</button>
      <div class="req-drawer__meta">
        <span class="req-chip">${esc(SURFACE[item.surface] || item.surface)}</span>
        <span class="req-chip req-chip--${esc(item.status)}">${esc(STATUS[item.status] || item.status)}</span>
        <span class="req-chip">${esc(item.submitter_name)}</span>
      </div>
      <h2>${esc(item.title)}</h2>
      ${item.page_url ? locHtml(item.page_url) : ''}
      <div class="req-drawer__body">${esc(item.body)}</div>
      ${atts ? `<div class="req-gallery">${atts}</div>` : ''}
      ${nextActions(item)}
      ${admin && item.repo ? `<p class="req-empty">Repo: ${esc(item.repo)} · ${esc(item.branch)}</p>` : ''}
      ${events ? `<ul class="req-timeline">${events}</ul>` : ''}
    `;
    // Keyboard users land on Close when the drawer opens.
    const close = panel.querySelector('[data-close]');
    if (close && !panel.contains(document.activeElement)) close.focus();
  }

  function openDrawer(id) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    openId = id;
    drawer.hidden = false;
    paintDrawer(item);
    fetch(`/api/requests/${id}`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((data) => {
        if (!data.request || openId !== id) return;
        const idx = items.findIndex((i) => i.id === id);
        if (idx >= 0) items[idx] = data.request;
        paintDrawer(data.request);
      })
      .catch(() => {});
  }

  function closeDrawer() {
    drawer.hidden = true;
    openId = null;
    panel.innerHTML = '';
  }

  async function moveCard(id, status) {
    const item = items.find((i) => i.id === id);
    if (!item || item.status === status) return;
    const data = await api(`/api/requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const idx = items.findIndex((i) => i.id === id);
    if (idx >= 0) items[idx] = data.request;
    renderBoard();
    if (openId === id) paintDrawer(data.request);
  }

  function clearDrag() {
    if (drag?.ghost) drag.ghost.remove();
    if (drag?.card) drag.card.classList.remove('req-card--origin');
    boardEl.classList.remove('is-dragging');
    boardEl.querySelectorAll('.req-col.is-drop').forEach((c) => c.classList.remove('is-drop'));
    drag = null;
  }

  async function load() {
    if (!me) me = await api('/api/auth/me').catch(() => ({}));
    const data = await api('/api/requests');
    admin = Boolean(data.admin);
    items = data.requests || [];
    setAdminUi();
    renderBoard();
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
        if (loginMsg) loginMsg.textContent = err.message;
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
    renderBoard();
  });

  drawer.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) {
      closeDrawer();
      return;
    }
    const btn = e.target.closest('[data-status]');
    if (!btn || !openId) return;
    try {
      await moveCard(openId, btn.dataset.status);
    } catch (err) {
      if (loginMsg) loginMsg.textContent = err.message;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !drawer.hidden) closeDrawer();
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
      await api('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: document.getElementById('req-password').value }),
      });
      document.getElementById('req-password').value = '';
      await load();
    } catch (err) {
      loginMsg.textContent = err.message;
    }
  });

  load().catch((err) => {
    countEl.textContent = 'Board unavailable';
    if (loginMsg) loginMsg.textContent = err.message;
  });
})();
