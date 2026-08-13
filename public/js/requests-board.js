(() => {
  const COLS = [
    { id: 'inbox', label: 'Inbox' },
    { id: 'approved', label: 'Approved' },
    { id: 'in_progress', label: 'In motion' },
    { id: 'done', label: 'Done' },
  ];
  const SURFACE = { website: 'Website', portal: 'Portal', dashboard: 'Hub', app: 'App' };

  const boardEl = document.getElementById('req-board');
  const tabsEl = document.getElementById('req-tabs');
  const countEl = document.getElementById('req-count');
  const form = document.getElementById('req-form');
  const msg = document.getElementById('req-msg');
  const submitBtn = document.getElementById('req-submit');
  const drop = document.getElementById('req-drop');
  const fileInput = document.getElementById('req-files');
  const previews = document.getElementById('req-previews');
  const drawer = document.getElementById('req-drawer');
  const panel = document.getElementById('req-drawer-panel');
  const unlockBtn = document.getElementById('req-unlock');
  const lockBtn = document.getElementById('req-lock');
  const login = document.getElementById('req-login');

  let admin = false;
  let items = [];
  let files = [];
  let activeTab = 'inbox';
  let openId = null;

  const esc = (s) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '...' : s);

  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: 'same-origin', ...opts });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Request failed');
    return data;
  }

  function renderTabs() {
    tabsEl.innerHTML = COLS.map(
      (c) =>
        `<button type="button" data-tab="${c.id}" class="${c.id === activeTab ? 'is-on' : ''}">${c.label} (${items.filter((i) => i.status === c.id).length})</button>`
    ).join('');
  }

  function cardHtml(item) {
    const thumbs = (item.attachments || [])
      .slice(0, 3)
      .map((a) => `<img src="${esc(a.url)}" alt="" />`)
      .join('');
    return `<button type="button" class="req-card" data-id="${esc(item.id)}">
      <div class="req-card__kicker"><span>${esc(SURFACE[item.surface] || item.surface)}</span><span>${esc(item.submitter_name)}</span></div>
      <h3>${esc(item.title)}</h3>
      <p>${esc(clip(item.body, 180))}</p>
      ${thumbs ? `<div class="req-thumbs">${thumbs}</div>` : ''}
    </button>`;
  }

  function renderBoard() {
    const declined = admin ? items.filter((i) => i.status === 'declined') : [];
    boardEl.innerHTML = COLS.map((c) => {
      const list = items.filter((i) => i.status === c.id);
      const body = list.length ? list.map(cardHtml).join('') : `<p class="req-empty">Nothing here yet.</p>`;
      return `<section class="req-col ${c.id === activeTab ? 'is-on' : ''}" data-col="${c.id}">
        <div class="req-col__head"><h2>${c.label}</h2><span>${list.length}</span></div>
        ${body}
      </section>`;
    }).join('');
    if (declined.length) {
      boardEl.insertAdjacentHTML(
        'beforeend',
        `<section class="req-col" data-col="declined" style="grid-column:1/-1">
          <div class="req-col__head"><h2>Declined</h2><span>${declined.length}</span></div>
          ${declined.map(cardHtml).join('')}
        </section>`
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

  function paintDrawer(item) {
    const atts = (item.attachments || [])
      .map((a) => `<a href="${esc(a.url)}" target="_blank" rel="noopener"><img src="${esc(a.url)}" alt="${esc(a.filename)}" /></a>`)
      .join('');
    const events = (item.events || [])
      .map((e) => `<li>${esc(e.created_at.slice(0, 10))} · ${esc(e.kind)} · ${esc(e.actor)}</li>`)
      .join('');
    panel.innerHTML = `
      <button type="button" class="req-ghost" data-close>Close</button>
      <div class="req-drawer__meta">
        <span class="req-chip">${esc(SURFACE[item.surface] || item.surface)}</span>
        <span class="req-chip">${esc(item.status.replace('_', ' '))}</span>
        <span class="req-chip">${esc(item.submitter_name)}</span>
      </div>
      <h2>${esc(item.title)}</h2>
      ${item.page_url ? `<p><a href="${esc(item.page_url)}" target="_blank" rel="noopener">${esc(item.page_url)}</a></p>` : ''}
      <div class="req-drawer__body">${esc(item.body)}</div>
      ${atts ? `<div class="req-gallery">${atts}</div>` : ''}
      ${nextActions(item)}
      ${item.repo ? `<p class="req-empty">Repo: ${esc(item.repo)} · ${esc(item.branch)}</p>` : ''}
      ${events ? `<ul class="req-timeline">${events}</ul>` : ''}
    `;
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

  async function load() {
    const data = await api('/api/requests');
    admin = Boolean(data.admin);
    items = data.requests || [];
    unlockBtn.hidden = admin;
    lockBtn.hidden = !admin;
    login.hidden = true;
    renderBoard();
  }

  function addFiles(list) {
    for (const file of list) {
      if (!file.type.startsWith('image/')) continue;
      if (files.length >= 6) break;
      files.push(file);
    }
    previews.innerHTML = '';
    files.forEach((file) => {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.alt = file.name;
      previews.appendChild(img);
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = '';
    msg.className = 'req-msg';
    submitBtn.disabled = true;
    try {
      const fd = new FormData(form);
      files.forEach((f) => fd.append('files', f));
      const data = await api('/api/requests', { method: 'POST', body: fd });
      if (data.request) items.unshift(data.request);
      form.reset();
      files = [];
      previews.innerHTML = '';
      form.querySelector('input[name="surface"][value="website"]').checked = true;
      msg.textContent = 'On the board. Will will review it.';
      msg.classList.add('is-ok');
      renderBoard();
    } catch (err) {
      msg.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });

  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', () => addFiles(fileInput.files));
  ;['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add('is-hot');
    })
  );
  ;['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove('is-hot');
    })
  );
  drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
  document.addEventListener('paste', (e) => {
    if (!e.clipboardData) return;
    const pasted = [...e.clipboardData.items]
      .filter((i) => i.type.startsWith('image/'))
      .map((i) => i.getAsFile())
      .filter(Boolean);
    if (pasted.length) addFiles(pasted);
  });

  boardEl.addEventListener('click', (e) => {
    const card = e.target.closest('[data-id]');
    if (card) openDrawer(card.dataset.id);
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
      const data = await api(`/api/requests/${openId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: btn.dataset.status }),
      });
      const idx = items.findIndex((i) => i.id === openId);
      if (idx >= 0) items[idx] = data.request;
      renderBoard();
      openDrawer(openId);
    } catch (err) {
      msg.textContent = err.message;
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !drawer.hidden) closeDrawer();
  });

  unlockBtn.addEventListener('click', () => {
    login.hidden = !login.hidden;
    document.getElementById('req-password').focus();
  });
  lockBtn.addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST', body: '{}' });
    admin = false;
    await load();
  });
  login.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: document.getElementById('req-password').value }),
      });
      document.getElementById('req-password').value = '';
      await load();
    } catch (err) {
      msg.textContent = err.message;
    }
  });

  load().catch((err) => {
    countEl.textContent = 'Board unavailable';
    msg.textContent = err.message;
  });
})();
