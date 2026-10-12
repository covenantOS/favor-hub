/* The request panel: one request with its owner, due date, Waiting on, followers, history and conversation, opened as a side
   panel on a desktop and a full sheet on a phone. It lives on every FavorOS page, so a request opens in place from the board,
   from its card in Chat, from Today, the bell, the Work Overview and search: any link to /requests/?r=<id> opens here.

     FavorRequest.open(id, { preview, reply, done })   preview: a request already in hand, drawn while the full one loads
     FavorRequest.close()
     FavorRequest.prefs()                              the "Request email" choices
     document 'favor-request' event                    detail.request after every change, for the board's cards

   The page behind does not scroll while the panel is open and nothing else moves: only <html> is locked (locking <body>
   too un-sticks the rail), and the width the scrollbar took is handed back as padding. */
(() => {
  'use strict';
  if (window.FavorRequest) return;
  const RT = window.ReqTasks;
  const FM = window.FavorMention;
  if (!RT || !FM) return;
  const esc = RT.esc;
  const ic = RT.ic;
  const STATUS = { inbox: 'Inbox', approved: 'Approved', in_progress: 'In motion', done: 'Done', declined: 'Declined' };
  const SURFACE = { website: 'Website', portal: 'Portal', dashboard: 'FavorOS', app: 'App' };
  const ET = 'America/New_York';
  const touch = matchMedia('(hover: none)').matches;
  const first = (n) => String(n || '').split(' ')[0];

  let root = null;
  let panel = null;
  let cur = null; // the request on screen
  let openId = null;
  let box = null; // the mention composer
  let ovTok = null;
  let ret = null;
  let ask = ''; // 'done' when a link asked to mark it done

  async function api(path, opts = {}) {
    const headers = Object.assign({ 'X-Hub-Request': '1' }, opts.json ? { 'Content-Type': 'application/json' } : {});
    const res = await fetch(path, { credentials: 'same-origin', method: opts.method || 'GET', headers, body: opts.json ? JSON.stringify(opts.json) : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.error === 'signin') location.href = '/login/?next=' + encodeURIComponent(location.pathname + location.search);
    if (!res.ok) throw new Error(data.message || 'That did not work. Try again.');
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
    toastT = setTimeout(() => toastEl.classList.remove('is-on'), 3200);
  }

  /* ------------------------------------------------------------------ pieces */
  const when = (iso) => {
    const d = new Date(iso);
    const day = (x) => x.toLocaleDateString('en-CA', { timeZone: ET });
    const time = d.toLocaleTimeString('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' });
    if (day(d) === day(new Date())) return time;
    return d.toLocaleDateString('en-US', { timeZone: ET, month: 'short', day: 'numeric' }) + ', ' + time;
  };
  const isImage = (a) => String(a.content_type || '').startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(a.filename || '');
  const attLink = (a) => (isImage(a) ? `<a href="${esc(a.url)}" target="_blank" rel="noopener"><img src="${esc(a.url)}" alt="${esc(a.filename)}" /></a>` : `<a class="rq-file" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.filename)}</a>`);
  const locHtml = (url) => (/^https?:\/\//i.test(url) || url.startsWith('/') ? `<p class="rq-loc"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></p>` : `<p class="rq-loc">${esc(url)}</p>`);
  const personChip = (email, tag, attr, label) => {
    const p = RT.person(email);
    const inner = `${RT.avatar(email, 'sm')}<span class="rq-p__t"><b>${esc(p.name)}</b>${p.team ? `<small>${esc(p.team)}</small>` : ''}</span>`;
    return tag === 'button' ? `<button type="button" class="rq-p rq-p--btn" ${attr} aria-label="${esc(label)}">${inner}</button>` : `<span class="rq-p">${inner}</span>`;
  };

  /** Says plainly whether the person has heard, so nobody guesses while notices are off. */
  function toldLine(t, me, can) {
    if (!t || t.told || t.email === me) return '';
    const name = first(RT.person(t.email).name);
    if (!t.open) return `<p class="rq-told">${esc(name)} has not been told: notices are off.</p>`;
    return `<p class="rq-told">${esc(name)} has not been told.${can ? ` <button type="button" class="rq-linkbtn" data-tell="${esc(t.email)}">Tell ${esc(name)}</button>` : ''}</p>`;
  }

  function fieldsHtml(r) {
    if (!r.task) return '';
    const k = r.task;
    const can = r.can || {};
    const me = RT.me();
    const told = r.told || {};
    const owner = k.owner ? personChip(k.owner) : '<span class="rq-none">No owner</span>';
    const send = can.send ? `<button type="button" class="rt-btn ${k.owner ? '' : 'rt-btn--primary '}rt-btn--sm" data-send-to>${k.owner ? 'Send on...' : 'Send to...'}</button>` : '';
    const due = can.edit
      ? `<input type="date" class="rq-date" data-due value="${esc(k.due_date || '')}" aria-label="Due date" />${k.due_date ? `<button type="button" class="rt-btn rt-btn--ghost rt-btn--sm" data-due-clear>Clear</button>` : ''}`
      : k.due_date ? `<span>${esc(RT.dayWord(k.due_date))}</span>` : '<span class="rq-none">None</span>';
    const wait = k.waiting_on
      ? (can.edit ? personChip(k.waiting_on, 'button', 'data-wait', 'Change who it is waiting on') + `<button type="button" class="rt-btn rt-btn--ghost rt-btn--sm" data-wait-clear>Clear</button>` : personChip(k.waiting_on))
      : can.edit ? `<button type="button" class="rt-btn rt-btn--sm" data-wait>Pick a person</button>` : '<span class="rq-none">Nobody</span>';
    const list = k.followers || [];
    const fol = list.slice(0, 6).map((e) => `<span class="rq-fol" title="${esc(RT.person(e).name)}">${RT.avatar(e, 'sm')}</span>`).join('');
    const more = list.length > 6 ? `<span class="rq-more">+${list.length - 6}</span>` : '';
    const follow = can.follow ? `<button type="button" class="rt-btn rt-btn--sm${r.following ? ' is-on' : ''}" data-follow aria-pressed="${r.following ? 'true' : 'false'}">${r.following ? 'Following' : 'Follow'}</button>` : '';
    const sg = r.suggest;
    const dayLong = (d) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }) : '');
    const useOwner = sg && sg.owner && !k.owner && can.send;
    const useDue = sg && sg.due_date && !k.due_date && can.edit;
    const suggest = useOwner || useDue
      ? `<div class="of-suggest"><span>Suggested from the request: ${useOwner ? `<b>${esc(sg.owner.name)}</b>` : ''}${useOwner && useDue ? ', ' : ''}${useDue ? `due <b>${esc(dayLong(sg.due_date))}</b>` : ''}</span><button type="button" class="rt-btn rt-btn--primary rt-btn--sm" data-use-suggest>Use ${useOwner && useDue ? 'these' : 'this'}</button><small>${esc([useOwner ? sg.owner.why : '', useDue && sg.why ? 'Date: ' + sg.why : ''].filter(Boolean).join('. '))}</small></div>`
      : '';
    return `${suggest}<dl class="rq-fields">
      <div class="rq-field"><dt>Owner</dt><dd><div class="rq-row">${owner}${send}</div>${toldLine(told.owner, me, can.send)}</dd></div>
      <div class="rq-field"><dt>Due</dt><dd><div class="rq-row">${due}</div></dd></div>
      <div class="rq-field"><dt>Waiting on</dt><dd><div class="rq-row">${wait}</div>${toldLine(told.waiting, me, can.edit)}</dd></div>
      <div class="rq-field"><dt>Following</dt><dd><div class="rq-row">${list.length ? `<span class="rq-fols" role="group" aria-label="${esc('Following: ' + list.map((e) => RT.person(e).name).join(', '))}">${fol}${more}</span>` : '<span class="rq-none">Nobody yet</span>'}${follow}</div></dd></div>
    </dl>`;
  }

  function actionsHtml(r) {
    const can = r.can || {};
    if (!can.triage) {
      if (can.done) return `<div class="rq-actions"><button type="button" class="rt-btn rt-btn--primary" data-mine="done">Mark done</button></div>`;
      if (can.comment && r.status === 'done') return `<div class="rq-actions"><button type="button" class="rt-btn" data-mine="reopen">Reopen</button></div>`;
      return '';
    }
    const b = [];
    if (r.status === 'inbox') b.push(['approved', 'Approve'], ['declined', 'Decline']);
    if (r.status === 'approved') b.push(['in_progress', 'Start'], ['inbox', 'Back to inbox'], ['declined', 'Decline']);
    if (r.status === 'in_progress') b.push(['done', 'Mark done'], ['approved', 'Back to approved']);
    if (r.status === 'done') b.push(['in_progress', 'Reopen']);
    if (r.status === 'declined') b.push(['inbox', 'Restore']);
    return `<div class="rq-actions">${b.map(([s, l], i) => `<button type="button" class="rt-btn${i === 0 ? ' rt-btn--primary' : ''}" data-status="${s}">${l}</button>`).join('')}</div>`;
  }

  /** One line of history in words. Lines written by the hub's own jobs name no one; a line that says nothing is left out. */
  function eventText(e) {
    const p = e.payload || {};
    const machine = /^agent$/i.test(e.actor || '');
    const who = machine ? '' : esc(e.actor);
    const sub = (verb, passive) => (who ? `${who} ${verb}` : passive);
    if (e.kind === 'created') return who ? `${who} made the request` : 'The request was made';
    if (e.kind === 'status') return sub(`moved it to ${esc(STATUS[p.to] || p.to)}`, `Moved to ${esc(STATUS[p.to] || p.to)}`) + (p.to === 'declined' && p.declined_reason ? `: ${esc(p.declined_reason)}` : '');
    if (e.kind === 'note') return p.note ? `<span class="rq-note">Note: ${esc(p.note)}</span>` : '';
    if (e.kind === 'sent') return `${esc(p.from_name || e.actor)} sent it to <b>${esc(p.to_name || RT.person(p.to).name)}</b>${p.told === false ? ' <span class="rq-untold">not told</span>' : ''}`;
    if (e.kind === 'due') return p.to ? sub(`set the due date to ${esc(RT.dayWord(p.to))}`, `Due ${esc(RT.dayWord(p.to))}`) : sub('cleared the due date', 'Due date cleared');
    if (e.kind === 'waiting') return p.email ? `${who || 'Marked'} ${who ? 'marked it ' : ''}waiting on <b>${esc(p.name || RT.person(p.email).name)}</b>${p.told === false ? ' <span class="rq-untold">not told</span>' : ''}` : sub('cleared Waiting on', 'Waiting on cleared');
    if (e.kind === 'told') return `${who || 'Someone'} told <b>${esc(p.name || RT.person(p.email).name)}</b>`;
    return '';
  }

  function activityHtml(r) {
    const me = RT.me();
    const items = [];
    for (const c of r.comments || []) items.push({ at: c.created_at, c });
    for (const e of r.events || []) if (e.kind !== 'mention') items.push({ at: e.created_at, e });
    items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.e ? -1 : 1));
    // The line "sent it to" reads before the note that went with it (the note is saved a moment earlier).
    for (let i = 1; i < items.length; i++) {
      const p = items[i - 1];
      const n = items[i];
      if (n.e && n.e.kind === 'sent' && p.c && p.c.source === 'send' && Date.parse(n.at) - Date.parse(p.at) < 5000) { items[i - 1] = n; items[i] = p; }
    }
    let prev = null;
    return items.map((it) => {
      if (it.e) {
        const text = eventText(it.e);
        if (!text) return '';
        prev = null;
        return `<div class="rq-event"><span>${text}</span><time>${esc(when(it.e.created_at))}</time></div>`;
      }
      const c = it.c;
      const cont = prev && prev.email === c.email && prev.source === c.source && Date.parse(c.created_at) - Date.parse(prev.created_at) < 5 * 60000;
      prev = c;
      const name = c.name && !c.name.includes('@') ? c.name : RT.person(c.email).name;
      const text = c.deleted ? '<div class="rq-msg__text rq-msg__gone">This comment was deleted.</div>' : `<div class="rq-msg__text">${FM.render(c.body, RT.names, me)}</div>`;
      const from = c.source === 'chat' ? '<span class="rq-tag">from Chat</span>' : c.source === 'send' ? '<span class="rq-tag">sent with it</span>' : '';
      const del = !c.deleted && c.email === me ? `<button type="button" class="rq-msg__del" data-rt-del="${esc(c.id)}" aria-label="Delete this comment" title="Delete">${ic('trash')}</button>` : '';
      return `<article class="rq-msg${cont ? ' rq-msg--cont' : ''}" data-cid="${esc(c.id)}"><div class="rq-msg__gut">${cont ? '' : RT.avatar(c.email)}</div><div class="rq-msg__body">${cont ? '' : `<div class="rq-msg__meta"><b>${esc(name)}</b>${from}<time>${esc(when(c.created_at))}</time></div>`}${text}</div>${del}</article>`;
    }).join('');
  }

  function bodyHtml(r) {
    const atts = (r.attachments || []).map(attLink).join('');
    const act = activityHtml(r);
    const banner = ask === 'done' && r.can && r.can.done ? `<div class="rq-ask" role="alert"><span>Mark this request done? The person who asked gets an email.</span><span class="rq-ask__b"><button type="button" class="rt-btn rt-btn--primary rt-btn--sm" data-ask-done>Mark done</button><button type="button" class="rt-btn rt-btn--sm" data-ask-no>Not now</button></span></div>` : '';
    return `${banner}<h2 id="rq-title">${esc(r.title)}</h2>
      ${fieldsHtml(r)}
      ${r.page_url ? locHtml(r.page_url) : ''}
      <div class="rq-text">${esc(r.body)}</div>
      ${atts ? `<div class="rq-gallery">${atts}</div>` : ''}
      ${actionsHtml(r)}
      ${act ? `<h3 class="rq-h">Activity</h3><div class="rq-activity" aria-live="polite">${act}</div>` : ''}`;
  }

  const headHtml = (r) => `<div class="rq__chips"><span class="rq-chip rq-chip--${esc(r.status)}">${esc(STATUS[r.status] || r.status)}</span><span class="rq-chip">${esc(SURFACE[r.surface] || r.surface)}</span><span class="rq-chip">Asked by ${esc(r.submitter_name)}</span></div><button type="button" class="rt-x" data-rq-close aria-label="Close">${ic('x')}</button>`;

  function footHtml(r) {
    if (!r.can) return '';
    if (!r.can.comment) return `<p class="rq-foot__note">Comments are open to the people on this request.</p>`;
    return `<form class="rq-comp" autocomplete="off"><div class="rq-comp__box"><div class="rq-comp__in" data-mi></div><div class="rq-comp__bar"><button type="button" class="rq-comp__at" data-at aria-label="Mention someone" title="Mention someone">${ic('at')}</button><span class="rq-comp__sp"></span><button type="submit" class="rq-comp__send" disabled aria-label="Send">${ic('send')}<span>Send</span></button></div></div></form>`;
  }

  /* ------------------------------------------------------------------ drawing */
  function ensure() {
    if (root) return;
    root = document.createElement('div');
    root.className = 'rq';
    root.id = 'rq-drawer';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'rq-title');
    root.innerHTML = `<div class="rq__scrim" data-rq-close></div><aside class="rq__panel"><header class="rq__head"></header><div class="rq__body"></div><footer class="rq__foot"></footer></aside>`;
    document.body.appendChild(root);
    panel = root.querySelector('.rq__panel');
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    const body = root.querySelector('.rq__body');
    body.addEventListener('scroll', () => panel.classList.toggle('is-scrolled', body.scrollTop > 4), { passive: true });
  }

  function paint(r, opts = {}) {
    cur = r;
    const body = root.querySelector('.rq__body');
    const atEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 48;
    const keep = body.scrollTop;
    root.querySelector('.rq__head').innerHTML = headHtml(r);
    body.innerHTML = bodyHtml(r);
    // The comment box is drawn once per request, so a half-typed comment survives every refresh of the rest.
    const foot = root.querySelector('.rq__foot');
    const kind = !r.can ? '' : r.can.comment ? 'comp' : 'note';
    if (foot.dataset.kind !== kind) {
      foot.dataset.kind = kind;
      foot.innerHTML = footHtml(r);
      box = null;
      const host = foot.querySelector('[data-mi]');
      if (host) {
        const send = foot.querySelector('.rq-comp__send');
        box = FM.attach(host, {
          people: () => RT.list().map((p) => ({ id: p.email, name: p.name, sub: RT.sub(p), picture: p.picture })),
          me: RT.me(),
          placeholder: 'Comment, or @ to bring someone in',
          label: 'Comment',
          onInput: (b) => { send.disabled = b.isEmpty(); },
          onSubmit: () => submit(),
        });
      }
    }
    body.scrollTop = opts.toEnd || (atEnd && !opts.first) ? body.scrollHeight : opts.first ? 0 : keep;
    panel.classList.toggle('is-scrolled', body.scrollTop > 4);
  }

  function changed(r) {
    document.dispatchEvent(new CustomEvent('favor-request', { detail: { request: r } }));
    if (window.WCBell && window.WCBell.refresh) window.WCBell.refresh();
  }

  // The page behind must not move while the panel is open. Changing overflow on <html> or <body> un-sticks the rail and the
  // top bar on a desktop (the hub's body clips sideways, so it would become the scroller), so there the wheel and the paging
  // keys are held instead and nothing about the page's layout changes. On a phone the panel covers the whole screen and the
  // class locks the page the usual way.
  function lock(on) {
    document.documentElement.classList.toggle('rq-open', on);
  }
  const scrollerOf = (t) => {
    let n = t && t.nodeType === 1 ? t : t && t.parentElement;
    while (n && n !== document.body) {
      if (n.matches && n.matches('.rq__body, .mi, .rt-people, .mi-pop, .rt-note') && n.scrollHeight > n.clientHeight + 1) return n;
      n = n.parentElement;
    }
    return null;
  };
  window.addEventListener('wheel', (e) => {
    if (!document.documentElement.classList.contains('rq-open')) return;
    const sc = scrollerOf(e.target);
    if (!sc) { e.preventDefault(); return; }
    const up = e.deltaY < 0;
    if ((up && sc.scrollTop <= 0) || (!up && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1)) e.preventDefault();
  }, { passive: false, capture: true });
  window.addEventListener('keydown', (e) => {
    if (!root || root.hidden || !['PageDown', 'PageUp', 'Home', 'End', ' '].includes(e.key)) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === ' ' && t && /^(BUTTON|A)$/.test(t.tagName)) return;
    e.preventDefault();
    const body = root.querySelector('.rq__body');
    if (!body || document.documentElement.classList.contains('rt-sheet-open')) return;
    const page = body.clientHeight * 0.9;
    body.scrollTop = e.key === 'Home' ? 0 : e.key === 'End' ? body.scrollHeight : body.scrollTop + (e.key === 'PageUp' ? -page : page);
  }, true);

  async function open(id, opts = {}) {
    ensure();
    const ready = RT.people();
    if (openId !== id) {
      root.querySelector('.rq__foot').dataset.kind = 'x';
      root.querySelector('.rq__body').scrollTop = 0;
    }
    const wasOpen = !root.hidden;
    openId = id;
    ask = opts.done ? 'done' : '';
    if (!wasOpen) {
      ret = document.activeElement;
      root.hidden = false;
      lock(true);
      // Back closes the panel and stays on the page.
      if (window.hubOv) ovTok = window.hubOv.on(() => { ovTok = null; close(true); });
    }
    if (opts.preview) { await ready; paint(opts.preview, { first: true }); }
    else if (!wasOpen || !cur || cur.id !== id) {
      root.querySelector('.rq__head').innerHTML = `<div class="rq__chips"><span class="rq-skel rq-skel--chip"></span><span class="rq-skel rq-skel--chip"></span></div><button type="button" class="rt-x" data-rq-close aria-label="Close">${ic('x')}</button>`;
      root.querySelector('.rq__body').innerHTML = `<div class="rq-skel rq-skel--title"></div><div class="rq-skel rq-skel--line"></div><div class="rq-skel rq-skel--line"></div><div class="rq-skel rq-skel--block"></div>`;
      root.querySelector('.rq__foot').innerHTML = '';
    }
    // Focus moves into the panel: to Close with a keyboard, to the panel itself on touch (no ring, no keyboard popping up).
    if (!panel.contains(document.activeElement)) { const x = root.querySelector('[data-rq-close].rt-x'); if (!touch && x) x.focus({ preventScroll: true }); else { panel.tabIndex = -1; panel.focus({ preventScroll: true }); } }
    try {
      const [data] = await Promise.all([api(`/api/requests/${encodeURIComponent(id)}`), ready]);
      if (openId !== id || !data.request) return;
      // Before the task tables exist the answer carries no rights; an admin still triages.
      if (!data.request.can && data.admin) data.request.can = { triage: true };
      const had = (opts.preview && opts.preview.task && opts.preview.task.unread) || (data.request.task && data.request.task.unread) || 0;
      paint(data.request, { first: !opts.preview, toEnd: had > 0 || opts.reply });
      if (had) api(`/api/requests/${encodeURIComponent(id)}/read`, { method: 'POST', json: {} }).then(() => { if (cur && cur.task) cur.task.unread = 0; changed(cur); }).catch(() => {});
      if (opts.reply && box) box.focus();
    } catch (err) {
      if (openId !== id) return;
      if (!opts.preview) root.querySelector('.rq__body').innerHTML = `<p class="rq-none" style="padding-top:24px">${esc(err.message === 'Request not found' ? 'That request is not on the board.' : err.message)}</p>`;
    }
  }

  function close(fromBack) {
    if (!root || root.hidden) return;
    RT.closeSheet(null);
    root.hidden = true;
    openId = null;
    cur = null;
    box = null;
    lock(false);
    root.querySelector('.rq__body').innerHTML = '';
    root.querySelector('.rq__foot').innerHTML = '';
    root.querySelector('.rq__foot').dataset.kind = '';
    if (ovTok && window.hubOv && fromBack !== true) { const t = ovTok; ovTok = null; window.hubOv.off(t); }
    ovTok = null;
    const u = new URL(location.href);
    if (u.pathname.replace(/\/$/, '') === '/requests' && (u.searchParams.has('r') || u.searchParams.has('do') || u.searchParams.has('reply'))) {
      ['r', 'do', 'reply'].forEach((k) => u.searchParams.delete(k));
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    }
    if (ret && ret.focus && document.contains(ret)) { try { ret.focus({ preventScroll: true }); } catch (_) { /* gone */ } }
    ret = null;
  }

  /* ------------------------------------------------------------------ actions */
  async function act(path, json, method = 'POST', opts = {}) {
    const id = openId;
    const data = await api(`/api/requests/${encodeURIComponent(id)}${path ? '/' + path : ''}`, { method, json: json || {} });
    if (openId !== id) return data.request;
    paint(data.request, opts);
    changed(data.request);
    return data.request;
  }

  async function submit() {
    if (!box || box.isEmpty() || !openId) return;
    const text = box.value();
    const names = {};
    box.mentions().forEach((id) => { names[id] = RT.person(id).name; });
    const send = root.querySelector('.rq-comp__send');
    box.clear();
    send.disabled = true;
    try {
      await act('comments', { body: text }, 'POST', { toEnd: true });
    } catch (err) {
      if (box) box.setValue(text, names);
      toast(err.message);
    }
  }

  async function onClick(e) {
    const t = e.target;
    if (t.closest('[data-rq-close]')) { close(); return; }
    if (!openId || !cur) return;
    const r = cur;
    try {
      const st = t.closest('[data-status]');
      if (st) { await act('', { status: st.dataset.status }, 'PATCH'); return; }
      const mine = t.closest('[data-mine]');
      if (mine) { await act(mine.dataset.mine); toast(mine.dataset.mine === 'done' ? 'Marked done. The person who asked gets an email.' : 'Reopened'); return; }
      if (t.closest('[data-ask-done]')) { ask = ''; await act(r.can.triage ? '' : 'done', r.can.triage ? { status: 'done' } : {}, r.can.triage ? 'PATCH' : 'POST'); toast('Marked done. The person who asked gets an email.'); return; }
      if (t.closest('[data-ask-no]')) { ask = ''; paint(r); return; }
      if (t.closest('[data-use-suggest]')) {
        const sg = r.suggest;
        if (sg && sg.due_date && !(r.task && r.task.due_date)) await act('task', { due_date: sg.due_date }, 'PATCH');
        if (sg && sg.owner && !(r.task && r.task.owner)) {
          const next = await act('send', { to: sg.owner.email, note: '' }, 'POST', { toEnd: true });
          const told = next && next.told && next.told.owner;
          toast(told && !told.told && sg.owner.email !== RT.me() ? `Sent to ${RT.person(sg.owner.email).name}. ${first(RT.person(sg.owner.email).name)} has not been told: notices are off.` : `Sent to ${RT.person(sg.owner.email).name}`);
        } else toast('Due date set');
        return;
      }
      if (t.closest('[data-send-to]')) {
        const owner = r.task && r.task.owner;
        const p = await RT.pick({ title: owner ? 'Send on to' : 'Send to', note: true, noteLabel: 'Context', action: 'Send', exclude: owner ? [owner] : [] });
        if (p && p.email) {
          const next = await act('send', { to: p.email, note: p.note || '' }, 'POST', { toEnd: true });
          const told = next && next.told && next.told.owner;
          toast(told && !told.told && p.email !== RT.me() ? `Sent to ${RT.person(p.email).name}. ${first(RT.person(p.email).name)} has not been told: notices are off.` : `Sent to ${RT.person(p.email).name}`);
        }
        return;
      }
      if (t.closest('[data-wait]')) {
        const p = await RT.pick({ title: 'Waiting on', current: r.task && r.task.waiting_on });
        if (p && p.email) await act('task', { waiting_on: p.email }, 'PATCH');
        return;
      }
      if (t.closest('[data-wait-clear]')) { await act('task', { waiting_on: null }, 'PATCH'); return; }
      if (t.closest('[data-due-clear]')) { await act('task', { due_date: null }, 'PATCH'); return; }
      const tell = t.closest('[data-tell]');
      if (tell) { await act('tell', { email: tell.dataset.tell }); toast(`${first(RT.person(tell.dataset.tell).name)} has been told`); return; }
      if (t.closest('[data-follow]')) { await act('follow', { on: !r.following }); return; }
      const del = t.closest('[data-rt-del]');
      if (del) { await act(`comments/${encodeURIComponent(del.dataset.rtDel)}`, {}, 'DELETE'); return; }
      if (t.closest('[data-at]') && box) {
        const p = await RT.pick({ title: 'Mention someone', exclude: [RT.me()] });
        if (p && p.email) box.insertMention({ id: p.email, name: RT.person(p.email).name });
      }
    } catch (err) {
      toast(err.message);
    }
  }
  async function onChange(e) {
    const due = e.target.closest('[data-due]');
    if (!due || !openId) return;
    try { await act('task', { due_date: due.value || null }, 'PATCH'); } catch (err) { toast(err.message); }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !root || root.hidden || e.defaultPrevented) return;
    if (document.documentElement.classList.contains('rt-sheet-open')) return;
    close();
  });
  // Tab stays inside the panel while it is open.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !root || root.hidden || document.documentElement.classList.contains('rt-sheet-open')) return;
    const f = Array.from(panel.querySelectorAll('button, [href], input, [contenteditable="true"]')).filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const a = f[0];
    const z = f[f.length - 1];
    if (!panel.contains(document.activeElement)) { e.preventDefault(); a.focus(); }
    else if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  });

  /* ------------------------------------------------------------------ request email: now, daily or none */
  async function prefs() {
    let p;
    try { p = await api('/api/requests/prefs'); } catch (err) { toast(err.message); return; }
    const rows = [['now', 'Immediately', 'One email for each thing sent to you, each mention and each comment'], ['daily', 'Daily summary', 'One email each weekday morning, grouped by request'], ['off', 'None', 'Today, the bell and Chat only']];
    const state = !p.notices_on ? 'Request notices are off for you right now. Your choice is kept for when they are on.' : !p.email_on ? 'Request email is switched off for everyone right now.' : `Email goes to ${p.email}.`;
    const done = RT.openSheet(`<div class="rt-sheet__head"><h2>Request email</h2><button type="button" class="rt-x" data-rt-close aria-label="Close">${ic('x')}</button></div>
      <div class="rq-prefs" role="radiogroup" aria-label="Request email">${rows.map(([v, l, s]) => `<button type="button" role="radio" class="rq-pref${p.mode === v ? ' is-on' : ''}" aria-checked="${p.mode === v}" data-mode="${v}"><span class="rq-pref__dot"></span><span><b>${l}</b><small>${s}</small></span></button>`).join('')}</div>
      <p class="rq-prefs__note">${esc(state)}</p>`, 'Request email');
    const el = document.querySelector('.rt-sheet');
    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-rt-close]')) { RT.closeSheet(null); return; }
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      try {
        await api('/api/requests/prefs', { method: 'PUT', json: { mode: b.dataset.mode } });
        RT.closeSheet(null);
        toast(b.dataset.mode === 'now' ? 'Request email: immediately' : b.dataset.mode === 'daily' ? 'Request email: a daily summary' : 'Request email: none');
      } catch (err) { toast(err.message); }
    });
    return done;
  }

  /* ------------------------------------------------------------------ any link to a request opens here */
  const idFrom = (href) => {
    try {
      const u = new URL(href, location.href);
      if (u.origin !== location.origin || u.pathname.replace(/\/$/, '') !== '/requests') return null;
      const id = u.searchParams.get('r');
      return id ? { id, done: u.searchParams.get('do') === 'done', reply: u.searchParams.get('reply') === '1' } : null;
    } catch (_) { return null; }
  };
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    const hit = idFrom(a.getAttribute('href'));
    if (!hit) return;
    e.preventDefault();
    open(hit.id, hit);
  }, true);

  // A page opened on /requests/?r=<id> (an email link, a shared link) opens that request; ?notices=1 opens the email choices.
  function fromUrl() {
    const u = new URL(location.href);
    if (u.pathname.replace(/\/$/, '') !== '/requests') return;
    const hit = idFrom(location.href);
    if (hit) open(hit.id, hit);
    else if (u.searchParams.get('notices') === '1') {
      u.searchParams.delete('notices');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
      prefs();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fromUrl);
  else fromUrl();

  window.FavorRequest = { open, close, prefs, toast, isOpen: () => !!root && !root.hidden, current: () => cur };
})();
