/* Cross-app integrations, one script on every FavorOS page (classic and the app frame).
     FavorIx.accept(requestId)          the Accept sheet: project, owner, due date, who hears about it; then the focus time offer
     FavorIx.focus(requestId, title)    hold focus time on my own calendar for a request I own
     FavorIx.findTime(ctx)              Find a time with the people in context (see findtime below)
     FavorIx.clipReply(ctx)             record a clip in place and send it as the reply (see clips below)
   Sheets reuse the request panel's sheet look (rt-sheet in request-tasks.css), so they match the people picker. */
(() => {
  'use strict';
  if (window.FavorIx) return;
  const ET = 'America/New_York';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const first = (n) => String(n || '').trim().split(/\s+/)[0] || '';
  const phone = () => matchMedia('(max-width: 720px)').matches;
  const ICON = {
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    task: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
    chat: '<path d="M5 18.5V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8.5z"/>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4.5 7 7.5 6 7.5-6"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 2"/>',
    cam: '<rect x="3" y="6.5" width="13" height="11" rx="2.5"/><path d="m16 10.5 5-3v9l-5-3z"/>',
    people: '<circle cx="9" cy="9" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6"/><circle cx="17" cy="8.5" r="2.6"/><path d="M15.8 13.6c2.4-.2 4.2 1.2 4.7 3.9"/>',
  };
  const ic = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ''}</svg>`;

  async function api(path, opts = {}) {
    const headers = Object.assign({ 'X-Hub-Request': '1' }, opts.json ? { 'Content-Type': 'application/json' } : {});
    const res = await fetch(path, { credentials: 'same-origin', method: opts.method || 'GET', headers, body: opts.json ? JSON.stringify(opts.json) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const err = new Error(data.message || 'That did not work. Try again.');
      err.code = data.error || '';
      err.status = res.status;
      throw err;
    }
    return data;
  }

  let toastEl = null;
  let toastT = 0;
  function toast(msg, ms = 3600) {
    if (window.hubToast) { window.hubToast(msg, { ms: Math.max(4000, ms) }); return; }
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'rt-toast ix-toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('is-on'), ms);
  }

  /* ------------------------------------------------------------------ the sheet */

  let sheet = null;
  function close(result) {
    if (!sheet) return;
    const s = sheet;
    sheet = null;
    if (s.tok && window.hubOv) window.hubOv.off(s.tok);
    s.el.classList.add('is-leaving');
    s.scrim.classList.add('is-leaving');
    setTimeout(() => { s.el.remove(); s.scrim.remove(); }, 140);
    document.documentElement.classList.remove('rt-sheet-open');
    s.resolve(result === undefined ? null : result);
    if (s.ret && s.ret.focus) { try { s.ret.focus({ preventScroll: true }); } catch (_) { /* gone */ } }
  }
  /** Opens a sheet. draw(el, done) fills it and wires it; done(value) closes it with that value. */
  function open(label, draw, cls = '') {
    close(null);
    return new Promise((resolve) => {
      const scrim = document.createElement('div');
      scrim.className = 'rt-scrim ix-scrim';
      const el = document.createElement('div');
      el.className = 'rt-sheet ix-sheet' + (cls ? ' ' + cls : '');
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-label', label);
      document.body.append(scrim, el);
      document.documentElement.classList.add('rt-sheet-open');
      sheet = { el, scrim, resolve, ret: document.activeElement, tok: null };
      scrim.addEventListener('click', () => close(null));
      if (window.hubOv) sheet.tok = window.hubOv.on(() => { if (sheet) sheet.tok = null; close(null); });
      draw(el, close);
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheet) { e.stopPropagation(); close(null); }
  }, true);
  const head = (title, sub) => `<div class="rt-sheet__head ix-head"><div class="ix-head__t"><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div><button type="button" class="rt-x" data-ix-close aria-label="Close">${ic('x')}</button></div>`;
  const busy = (btn, on, text) => {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.classList.add('is-busy'); if (text) btn.textContent = text; }
    else { btn.disabled = false; btn.classList.remove('is-busy'); if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
  };
  const when = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: ET, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const timeOnly = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' });
  const person = (email) => (window.ReqTasks && window.ReqTasks.person ? window.ReqTasks.person(email) : { name: String(email || '').split('@')[0], email });
  const avatar = (email) => (window.ReqTasks && window.ReqTasks.avatar ? window.ReqTasks.avatar(email, 'sm') : '');
  const LAST_PROJECT = 'favor.ix.acceptProject';

  /* ------------------------------------------------------------------ 1. Accept */

  async function accept(requestId) {
    let opts;
    try {
      opts = await api(`/api/requests/${encodeURIComponent(requestId)}/accept`);
    } catch (err) {
      toast(err.message);
      return null;
    }
    const remembered = (() => { try { return localStorage.getItem(LAST_PROJECT) || ''; } catch (_) { return ''; } })();
    const state = { owner: opts.owner, project: opts.projects.some((p) => p.id === remembered) ? remembered : '', due: '', note: '' };
    const result = await open('Accept the request', (el, done) => {
      const draw = () => {
        const rq = opts.requester;
        const p = opts.projects.find((x) => x.id === state.project);
        const ownerName = person(state.owner).name;
        const who = first(rq.name || opts.request.submitter.name) || 'The person who asked';
        const tellLine = rq.via === 'none'
          ? (!rq.email ? `${who} is not told: the request has no email address.` : rq.email === state.owner ? `${who} asked for it, so there is nobody else to tell.` : 'Nobody else needs telling.')
          : !rq.told
            ? `${first(rq.name) || 'The person who asked'} is not told: request notices are off.`
            : rq.via === 'chat'
              ? `${first(rq.name)} gets a card in Chat from ${state.owner === opts.owner ? first(ownerName) : first(ownerName)}, and you can talk there.`
              : `${first(rq.name) || 'The person who asked'} gets one email (not in Chat).`;
        el.innerHTML = `${head('Accept', opts.request.title)}
          <div class="ix-body">
            <div class="ix-field"><span class="ix-label">Owner</span><button type="button" class="ix-pick" data-ix-owner>${avatar(state.owner)}<span><b>${esc(ownerName)}</b>${state.owner === (window.ReqTasks && window.ReqTasks.me ? window.ReqTasks.me() : '') ? '<small>You</small>' : ''}</span><em>Change</em></button></div>
            <label class="ix-field"><span class="ix-label">Project</span>
              <select class="ix-select" data-ix-project>
                <option value="">My tasks (no project)</option>
                ${opts.projects.map((x) => `<option value="${esc(x.id)}"${x.id === state.project ? ' selected' : ''}>${esc(x.name)} (${esc(x.key)})${x.synced ? ', syncs with Asana' : ''}</option>`).join('')}
              </select>
            </label>
            <label class="ix-field"><span class="ix-label">Due</span><input type="date" class="ix-input" data-ix-due value="${esc(state.due)}" /></label>
            ${rq.via === 'chat' ? `<label class="ix-field"><span class="ix-label">Note to ${esc(first(rq.name))}</span><textarea class="ix-input ix-note" rows="2" maxlength="600" data-ix-note placeholder="Optional">${esc(state.note)}</textarea></label>` : ''}
            <ul class="ix-plan" aria-label="What Accept does">
              <li>${ic('task')}<span>A task ${p ? `in <b>${esc(p.name)}</b>${p.synced ? ', and in Asana' : ''}` : 'on the owner’s list'}${opts.task ? ` (already made: ${esc(opts.task.code || 'open it')})` : ''}</span></li>
              <li>${ic(rq.via === 'email' ? 'mail' : 'chat')}<span>${esc(tellLine)}</span></li>
              <li>${ic('cal')}<span>${state.owner === (window.ReqTasks && window.ReqTasks.me ? window.ReqTasks.me() : '') ? 'Next, you can hold focus time on your calendar.' : `${esc(first(ownerName))} can hold focus time from the request.`}</span></li>
              <li>${ic('check')}<span>When the task is done, ${rq.email ? `${esc(who)} gets the done email` : 'the request closes with it'}.</span></li>
            </ul>
          </div>
          <div class="rt-sheet__foot"><button type="button" class="rt-btn" data-ix-close>Cancel</button><button type="button" class="rt-btn rt-btn--primary" data-ix-go>${ic('check')}Accept</button></div>`;
      };
      draw();
      el.addEventListener('change', (e) => {
        if (e.target.matches('[data-ix-project]')) { state.project = e.target.value; draw(); }
        if (e.target.matches('[data-ix-due]')) state.due = e.target.value;
      });
      el.addEventListener('input', (e) => { if (e.target.matches('[data-ix-note]')) state.note = e.target.value; });
      el.addEventListener('click', async (e) => {
        if (e.target.closest('[data-ix-close]')) { done(null); return; }
        if (e.target.closest('[data-ix-owner]') && window.ReqTasks) {
          const pk = await window.ReqTasks.pick({ title: 'Owner', current: state.owner });
          if (pk && pk.email) { state.owner = pk.email; draw(); }
          return;
        }
        const go = e.target.closest('[data-ix-go]');
        if (!go) return;
        busy(go, true, 'Accepting');
        try {
          const r = await api(`/api/requests/${encodeURIComponent(requestId)}/accept`, { method: 'POST', json: { owner_email: state.owner, project_id: state.project || undefined, due_date: state.due || undefined, note: state.note || undefined } });
          try { localStorage.setItem(LAST_PROJECT, state.project || ''); } catch (_) { /* private mode */ }
          done(r);
        } catch (err) {
          busy(go, false);
          toast(err.message);
        }
      });
    }, 'ix-accept');
    if (!result) return null;
    const bits = [`Accepted. Task ${result.task.code || 'made'}${result.task.synced ? ', in Asana too' : ''}.`];
    if (result.told.via === 'chat') bits.push(`${first(opts.requester.name)} has a card in Chat.`);
    else if (result.told.via === 'email') bits.push(`${first(opts.requester.name) || 'They'} got an email.`);
    else if (result.told.why) bits.push(result.told.why);
    toast(bits.join(' '), 5200);
    document.dispatchEvent(new CustomEvent('favor-request', { detail: { request: result.request } }));
    if (result.focus && result.focus.offer) await focus(requestId, opts.request.title, { ready: result.focus.ready, offered: true });
    return result;
  }

  /* ------------------------------------------------------------------ focus time */

  async function focus(requestId, title, o = {}) {
    let minutes = 60;
    return open('Hold focus time', (el, done) => {
      const paint = (slots, err, consent) => {
        el.innerHTML = `${head(o.offered ? 'Hold focus time?' : 'Hold focus time', title)}
          <div class="ix-body">
            <div class="ix-seg" role="group" aria-label="How long">${[30, 60, 90, 120].map((m) => `<button type="button" class="ix-seg__b${m === minutes ? ' is-on' : ''}" data-ix-min="${m}" aria-pressed="${m === minutes}">${m < 60 ? m + ' min' : m / 60 + (m === 60 ? ' hour' : ' hours')}</button>`).join('')}</div>
            ${consent
              ? `<p class="ix-quiet">${esc(err)}</p><a class="rt-btn rt-btn--primary" href="/api/google/connect?add=meetings&next=${encodeURIComponent(location.pathname + location.search)}">${ic('cal')}Connect Google Calendar</a>`
              : err
                ? `<p class="ix-quiet">${esc(err)}</p>`
                : !slots
                  ? '<div class="ix-skel" aria-hidden="true"><i></i><i></i><i></i></div><p class="ix-quiet" role="status">Reading your calendar</p>'
                  : slots.length
                    ? `<p class="ix-quiet">Open on your calendar. Google adds a busy block with no guests.</p><div class="ix-slots">${slots.map((s) => `<button type="button" class="ix-slot" data-ix-hold="${esc(s.start)}">${ic('clock')}<span><b>${esc(s.label)}</b><small>to ${esc(timeOnly(s.end))}</small></span></button>`).join('')}</div>`
                    : '<p class="ix-quiet">No open stretch that long in the next week of your working hours. Try a shorter one.</p>'}
          </div>
          <div class="rt-sheet__foot"><button type="button" class="rt-btn" data-ix-close>${o.offered ? 'Not now' : 'Close'}</button></div>`;
      };
      const load = async () => {
        paint(null);
        try {
          const r = await api(`/api/requests/${encodeURIComponent(requestId)}/focus?minutes=${minutes}`);
          paint(r.slots);
        } catch (err) {
          paint(null, err.message, err.code === 'consent');
        }
      };
      load();
      el.addEventListener('click', async (e) => {
        if (e.target.closest('[data-ix-close]')) { done(null); return; }
        const m = e.target.closest('[data-ix-min]');
        if (m) { minutes = Number(m.dataset.ixMin); load(); return; }
        const h = e.target.closest('[data-ix-hold]');
        if (h) {
          busy(h, true, 'Holding');
          try {
            const r = await api(`/api/requests/${encodeURIComponent(requestId)}/focus`, { method: 'POST', json: { start: h.dataset.ixHold, minutes } });
            toast(`Focus time held: ${when(r.hold.start)}.`);
            done(r.hold);
          } catch (err) {
            busy(h, false);
            toast(err.message);
          }
        }
      });
    }, 'ix-focus');
  }

  /* ------------------------------------------------------------------ 2. Find a time */

  const me = () => {
    try { return (window.ReqTasks && window.ReqTasks.me && window.ReqTasks.me()) || (JSON.parse(localStorage.getItem('favor.hub.nav.v1') || 'null') || {}).user.email || ''; } catch (_) { return ''; }
  };
  const EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;

  /**
   * ctx: { kind: 'chat'|'mail'|'task'|'partner'|'request', ref, thread?, people?: [{email, name}], title? }
   * Books a FavorOS meeting (Google sends the invites) and puts its card back where it came from.
   */
  async function findTime(ctx) {
    const st = { title: ctx.title || '', people: [], minutes: 30, slots: null, err: '', consent: false, pick: null, step: 'times', loading: true };
    const self = String(me()).toLowerCase();
    const addPerson = (p) => {
      const e = String(p.email || '').trim().toLowerCase();
      if (!EMAIL.test(e) || e === self || st.people.some((x) => x.email === e)) return;
      st.people.push({ email: e, name: p.name || '', guest: !/@favorintl\.org$/.test(e), on: true });
    };
    (ctx.people || []).forEach(addPerson);
    return open('Find a time', (el, done) => {
      const label = (p) => p.name || (person(p.email).name !== p.email.split('@')[0] ? person(p.email).name : p.email);
      const draw = () => {
        const on = st.people.filter((p) => p.on);
        if (st.step === 'confirm' && st.pick) {
          const where = ctx.kind === 'chat' ? 'The meeting card goes in this conversation, and the notes come back here after.'
            : ctx.kind === 'task' || ctx.kind === 'request' ? 'The meeting goes in the comments here, and the notes link comes back after.'
              : ctx.kind === 'mail' ? 'The meeting goes into your reply, ready for you to send.' : '';
          el.innerHTML = `${head('Book this time', st.title || 'Meeting')}
            <div class="ix-body">
              <div class="ix-slot is-static">${ic('clock')}<span><b>${esc(when(st.pick.start))}</b><small>${st.minutes} minutes, to ${esc(timeOnly(st.pick.end))}</small></span></div>
              <p class="ix-quiet">${on.length ? `Google sends ${on.length === 1 ? esc(label(on[0])) : on.length + ' people'} an invite from your calendar.` : 'Nobody else is invited.'}${on.some((p) => p.guest) ? ' People outside Favor get a guest link to join.' : ''} ${where}</p>
              <div class="ix-people">${on.map((p) => `<span class="ix-chip">${avatar(p.email)}<span>${esc(label(p))}${p.guest ? ' (guest)' : ''}</span></span>`).join('')}</div>
            </div>
            <div class="rt-sheet__foot"><button type="button" class="rt-btn" data-ix-back>Back</button><button type="button" class="rt-btn rt-btn--primary" data-ix-book>${ic('cal')}Book and invite</button></div>`;
          return;
        }
        let slotsHtml;
        if (st.consent) slotsHtml = `<p class="ix-quiet">${esc(st.err)}</p><a class="rt-btn rt-btn--primary" href="/api/google/connect?add=meetings&next=${encodeURIComponent(location.pathname + location.search)}">${ic('cal')}Connect Google Calendar</a>`;
        else if (st.err) slotsHtml = `<p class="ix-quiet">${esc(st.err)}</p>`;
        else if (st.loading || !st.slots) slotsHtml = '<div class="ix-skel" aria-hidden="true"><i></i><i></i><i></i></div><p class="ix-quiet" role="status">Reading calendars</p>';
        else if (st.slots.length) {
          const unread = (st.unread || []).map((e) => first(label({ email: e })) || e);
          slotsHtml = `${unread.length ? `<p class="ix-quiet">${esc(unread.join(', '))}: calendar not shared with you, so only their FavorOS meetings count.</p>` : ''}<div class="ix-slots">${st.slots.map((x, i) => {
            const miss = (x.busy || []).concat(x.outside || []).filter((e) => e !== self);
            return `<button type="button" class="ix-slot" data-ix-slot="${i}">${ic('clock')}<span><b>${esc(when(x.start))}</b><small>${miss.length ? esc('Not free: ' + miss.map((e) => first(label({ email: e })) || e).join(', ')) : 'Everyone is free'}</small></span></button>`;
          }).join('')}</div>`;
        } else slotsHtml = '<p class="ix-quiet">No time in the next two weeks works for everyone. Try fewer people or a shorter meeting.</p>';
        const sub = { mail: 'From this email', chat: 'With this conversation', task: 'For this task', partner: 'With this partner', request: 'For this request' }[ctx.kind] || '';
        el.innerHTML = `${head('Find a time', sub)}
          <div class="ix-body">
            <label class="ix-field"><span class="ix-label">Title</span><input class="ix-input" data-ix-title maxlength="140" value="${esc(st.title)}" placeholder="Meeting" /></label>
            <div class="ix-field"><span class="ix-label">People</span>
              <div class="ix-people">${st.people.map((p, i) => `<span class="ix-chip${p.on ? '' : ' is-off'}">${avatar(p.email)}<span>${esc(label(p))}${p.guest ? ' (guest)' : ''}</span><button type="button" data-ix-toggle="${i}" aria-label="${p.on ? 'Leave out' : 'Add back'} ${esc(label(p))}" title="${p.on ? 'Leave out' : 'Add back'}">${p.on ? ic('x') : ic('check')}</button></span>`).join('')}
                <button type="button" class="rt-btn rt-btn--sm" data-ix-add>${ic('people')}Add</button></div>
              <input class="ix-input" data-ix-email type="email" placeholder="Or type an email address and press Enter" autocomplete="off" />
            </div>
            <div class="ix-seg" role="group" aria-label="How long">${[15, 30, 45, 60].map((m) => `<button type="button" class="ix-seg__b${m === st.minutes ? ' is-on' : ''}" data-ix-min="${m}" aria-pressed="${m === st.minutes}">${m} min</button>`).join('')}</div>
            <div class="ix-field"><span class="ix-label">Suggested times</span>${slotsHtml}</div>
          </div>
          <div class="rt-sheet__foot"><a class="rt-btn rt-btn--ghost" href="/meet/book/">More options</a><button type="button" class="rt-btn" data-ix-close>Close</button></div>`;
      };
      let seq = 0;
      const load = async () => {
        const n = ++seq;
        st.loading = true; st.err = ''; st.consent = false;
        draw();
        try {
          const from = new Date(Date.now() + 30 * 60000).toISOString();
          const to = new Date(Date.now() + 14 * 86400000).toISOString();
          const r = await api('/api/meet/meetings/assist', { method: 'POST', json: { emails: st.people.filter((p) => p.on).map((p) => p.email), durationMin: st.minutes, from, to, limit: 8 } });
          if (n !== seq) return;
          st.slots = (r.slots || []).slice(0, 8);
          st.unread = (r.people || []).filter((x) => x.source === 'none' && x.email !== self).map((x) => x.email);
        } catch (err) {
          if (n !== seq) return;
          st.err = err.message; st.consent = err.code === 'consent';
        }
        st.loading = false;
        draw();
      };
      (async () => {
        if (ctx.kind === 'chat' || ctx.kind === 'task' || ctx.kind === 'request') {
          try {
            const c = await api(`/api/integrations/context?kind=${encodeURIComponent(ctx.kind)}&ref=${encodeURIComponent(ctx.ref)}${ctx.thread ? '&thread=' + encodeURIComponent(ctx.thread) : ''}`);
            if (!st.title) st.title = c.title || '';
            c.people.forEach(addPerson);
          } catch (err) { st.err = err.message; }
        }
        load();
      })();
      el.addEventListener('input', (e) => {
        if (e.target.matches('[data-ix-title]')) st.title = e.target.value;
      });
      el.addEventListener('keydown', (e) => {
        if (e.target.matches('[data-ix-email]') && e.key === 'Enter') {
          e.preventDefault();
          const v = e.target.value.trim();
          if (!EMAIL.test(v)) { toast('That is not an email address.'); return; }
          addPerson({ email: v });
          load();
        }
      });
      el.addEventListener('click', async (e) => {
        if (e.target.closest('[data-ix-close]')) { done(null); return; }
        const tg = e.target.closest('[data-ix-toggle]');
        if (tg) { const p = st.people[+tg.dataset.ixToggle]; p.on = !p.on; load(); return; }
        if (e.target.closest('[data-ix-add]') && window.ReqTasks) {
          const pk = await window.ReqTasks.pick({ title: 'Add someone', exclude: [self].concat(st.people.map((p) => p.email)) });
          if (pk && pk.email) { addPerson({ email: pk.email, name: person(pk.email).name }); load(); }
          return;
        }
        const m = e.target.closest('[data-ix-min]');
        if (m) { st.minutes = Number(m.dataset.ixMin); load(); return; }
        const sl = e.target.closest('[data-ix-slot]');
        if (sl) { st.pick = st.slots[+sl.dataset.ixSlot]; st.step = 'confirm'; draw(); return; }
        if (e.target.closest('[data-ix-back]')) { st.step = 'times'; draw(); return; }
        const bk = e.target.closest('[data-ix-book]');
        if (!bk) return;
        const on = st.people.filter((p) => p.on);
        busy(bk, true, 'Booking');
        try {
          const made = await api('/api/meet/meetings', { method: 'POST', json: { title: st.title || 'Meeting', startsAt: st.pick.start, durationMin: st.minutes, access: 'invited', invitees: on.map((p) => ({ email: p.email, name: label(p), guest: p.guest })) } });
          const mt = made.meeting || {};
          let posted = 'none';
          try {
            const o = await api('/api/integrations/origin', { method: 'POST', json: { meeting_id: mt.id, kind: ctx.kind, ref: ctx.ref, thread_id: ctx.thread || null } });
            posted = o.posted;
          } catch (_) { /* the meeting stands even if the card could not go back */ }
          const item = { kind: 'meeting', title: mt.title || st.title || 'Meeting', url: location.origin + '/meet/room/?m=' + mt.id, sub: when(st.pick.start) + ' ET, ' + st.minutes + ' min' };
          if (ctx.kind === 'mail') {
            try { window.dispatchEvent(new CustomEvent('favor-mail:reply', { detail: { threadId: ctx.ref, items: [item] } })); } catch (_) { /* older Mail */ }
          }
          const told = posted === 'chat' ? ' The card is in the conversation.' : posted === 'task' || posted === 'request' ? ' It is in the comments.' : '';
          toast(`Booked for ${when(st.pick.start)}.${on.length ? ' Google sent the invites.' : ''}${told}`, 5200);
          document.dispatchEvent(new CustomEvent('favor-ix:booked', { detail: { meeting: mt, ctx } }));
          done(mt);
        } catch (err) {
          busy(bk, false);
          toast(err.code === 'consent' ? 'Connect your Google Calendar first, then book again.' : err.message, 5200);
        }
      });
    }, 'ix-find');
  }

  /* ------------------------------------------------------------------ 3. Clip replies */

  // Records with the usual recorder (the camera button in the header) and hears back on the recorder's channel when it is saved.
  function recordClip() {
    return new Promise((resolve) => {
      const cam = document.getElementById('clip-cam');
      if (!cam) { toast('The clip recorder is not on this page.'); resolve(null); return; }
      let done = false;
      const ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('favor-clips') : null;
      const finish = (id) => {
        if (done) return;
        done = true;
        if (ch) ch.close();
        window.removeEventListener('clips:changed', onChanged);
        clearTimeout(timer);
        resolve(id);
      };
      const onChanged = (e) => { if (e && e.detail && e.detail.id) finish(e.detail.id); };
      if (ch) ch.onmessage = (e) => { const m = e.data || {}; if (m.t === 'saved' && m.id) finish(m.id); else if (m.t === 'closed' || m.t === 'gone') finish(null); };
      window.addEventListener('clips:changed', onChanged);
      const timer = setTimeout(() => finish(null), 30 * 60000);
      cam.click();
      toast('Record your clip. It is sent here when you press Stop.', 4200);
    });
  }

  const LEVELS = [
    ['people', 'Only the people here'],
    ['staff', 'Anyone at Favor with the link'],
    ['public', 'Everybody with the link'],
  ];

  /**
   * ctx: { kind: 'chat'|'mail'|'task'|'request'|'partner', ref, thread?, title?, people?: [{email, name}], partnerId? }
   * Records a clip in place, then sends it where the reply goes, at the sharing level the person picks.
   */
  async function clipReply(ctx, clipIdIn) {
    const id = clipIdIn || (await recordClip());
    if (!id) return null;
    let info = null;
    try { info = await api(`/api/clips/${id}/info`); } catch (_) { info = null; }
    const clip = (info && info.clip) || { id, title: 'Your clip' };
    let people = (ctx.people || []).filter((p) => p && p.email);
    if (!people.length && (ctx.kind === 'task' || ctx.kind === 'request' || ctx.kind === 'chat')) {
      try { people = (await api(`/api/integrations/context?kind=${encodeURIComponent(ctx.kind)}&ref=${encodeURIComponent(ctx.ref)}`)).people || []; } catch (_) { people = []; }
    }
    const outside = people.filter((p) => !/@favorintl\.org$/i.test(p.email));
    const was = (info && (info.clip.access || (info.clip.share ? 'public' : info.clip.staffLink ? 'staff' : ''))) || '';
    const st = { level: outside.length || ctx.kind === 'partner' ? 'public' : was === 'staff' || was === 'public' ? was : 'people', suggest: false };
    return open('Send your clip', (el, done) => {
      const draw = () => {
        const needPublic = (outside.length || ctx.kind === 'partner') && st.level !== 'public';
        el.innerHTML = `${head('Send your clip', clip.title || 'Your clip')}
          <div class="ix-body">
            <div class="ix-field"><span class="ix-label">Who can watch</span>
              <div class="ix-seg" role="radiogroup" aria-label="Who can watch">${LEVELS.map(([v, l]) => `<button type="button" class="ix-seg__b${st.level === v ? ' is-on' : ''}" role="radio" aria-checked="${st.level === v}" data-ix-level="${v}">${esc(l)}</button>`).join('')}</div>
              <p class="ix-quiet">${needPublic ? 'People outside Favor can only watch when it is set to Everybody.' : st.level === 'people' ? (ctx.kind === 'chat' ? 'Everyone in this conversation can watch it.' : people.length ? `${esc(people.map((p) => first(p.name) || p.email).slice(0, 4).join(', '))}${people.length > 4 ? ' and others' : ''} can watch it.` : 'Only you, until you add people.') : st.level === 'staff' ? 'Anyone signed in at Favor with the link can watch it.' : 'Anyone with the link can watch it, signed in or not.'}</p>
            </div>
            ${ctx.kind === 'partner' ? `<label class="ix-check"><input type="checkbox" data-ix-suggest ${st.suggest ? 'checked' : ''} /> <span>Suggest it for the contact log. Nothing is logged until you press Log it on the partner's page.</span></label>` : ''}
            <p class="ix-quiet">${ctx.kind === 'chat' ? 'It goes in the thread, and comments on the clip show there too.' : ctx.kind === 'task' || ctx.kind === 'request' ? 'It goes in the comments, and comments on the clip show there too.' : ctx.kind === 'mail' ? 'It goes into your reply, ready for you to send.' : ctx.kind === 'partner' ? 'It opens in an email to the partner, ready for you to send.' : ''}</p>
          </div>
          <div class="rt-sheet__foot"><button type="button" class="rt-btn" data-ix-close>Keep it in My clips</button><button type="button" class="rt-btn rt-btn--primary" data-ix-send>${ic('check')}Send</button></div>`;
      };
      draw();
      el.addEventListener('change', (e) => { if (e.target.matches('[data-ix-suggest]')) st.suggest = e.target.checked; });
      el.addEventListener('click', async (e) => {
        if (e.target.closest('[data-ix-close]')) { done(null); return; }
        const lv = e.target.closest('[data-ix-level]');
        if (lv) { st.level = lv.dataset.ixLevel; draw(); return; }
        const go = e.target.closest('[data-ix-send]');
        if (!go) return;
        busy(go, true, 'Sending');
        try {
          const add = people.filter((p) => /@favorintl\.org$/i.test(p.email)).map((p) => p.email);
          await api(`/api/clips/${id}`, { method: 'PATCH', json: Object.assign({ access: st.level }, add.length && st.level === 'people' ? { addPeople: add } : {}) });
          const item = { kind: 'clip', title: clip.title || 'Clip', url: location.origin + '/c/' + id, sub: clip.duration ? Math.round(clip.duration) + ' sec' : '' };
          const place = { clip_id: id, kind: ctx.kind, ref: ctx.ref };
          if (ctx.kind === 'chat') {
            const m = await api(`/api/chat/channels/${encodeURIComponent(ctx.ref)}/messages`, { method: 'POST', json: { body: '', thread_id: ctx.thread || null, attachments: [{ type: 'clip', id }] } });
            place.message_id = (m.message && m.message.id) || 0;
          }
          if (ctx.kind === 'partner') place.suggest_log = !!st.suggest;
          await api('/api/integrations/clip-place', { method: 'POST', json: place });
          if (ctx.kind === 'mail') {
            window.dispatchEvent(new CustomEvent('favor-mail:reply', { detail: { threadId: ctx.ref, items: [item] } }));
          } else if (ctx.kind === 'partner') {
            if (window.FavorCompose && window.FavorCompose.open) {
              const me1 = first((person(me()) || {}).name);
              await window.FavorCompose.open({ mode: 'float', to: people.map((p) => ({ email: p.email, name: p.name || '' })), subject: `A short video${me1 ? ' from ' + me1 : ''}`, body: '' });
              if (window.FavorCompose.add) window.FavorCompose.add(item);
            } else {
              try { await navigator.clipboard.writeText(item.url); toast('Link copied. Paste it into your email.'); } catch (_) { toast(item.url, 8000); }
            }
          }
          toast(ctx.kind === 'chat' ? 'Your clip is in the thread.' : ctx.kind === 'task' || ctx.kind === 'request' ? 'Your clip is in the comments.' : st.suggest ? 'Suggested for the contact log on the partner page.' : 'Your clip is ready to send.', 4200);
          done({ id, level: st.level });
        } catch (err) {
          busy(go, false);
          toast(err.message, 5200);
        }
      });
    }, 'ix-clip');
  }

  /* ------------------------------------------------------------------ the contact log suggestion on a partner page */

  const seenPartner = new Set();
  async function partnerSuggestions(acts) {
    const link = acts.querySelector('[data-pp-link]');
    const pid = link && link.dataset.ppLink;
    if (!pid || acts.dataset.ixLog === pid) return;
    acts.dataset.ixLog = pid;
    let r;
    try { r = await api(`/api/integrations/clip-log?partner=${encodeURIComponent(pid)}`); } catch (_) { return; }
    const list = (r.suggestions || []).slice(0, 3);
    acts.parentElement && acts.parentElement.querySelectorAll('.ix-logs').forEach((x) => x.remove());
    if (!list.length) return;
    const box = document.createElement('div');
    box.className = 'ix-logs';
    box.innerHTML = list.map((s) => `<div class="ix-log" data-clip="${esc(s.clip_id)}"><span>${ic('cam')}<b>${esc(s.title)}</b><small>${s.state === 'failed' ? 'Did not log last time. Try again.' : 'You suggested this clip for the contact log.'}</small></span><button type="button" class="rt-btn rt-btn--sm rt-btn--primary" data-ix-log="log">Log it</button><button type="button" class="rt-btn rt-btn--sm" data-ix-log="dismiss">Dismiss</button></div>`).join('');
    acts.insertAdjacentElement('afterend', box);
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-ix-log]');
      if (!b) return;
      const row = b.closest('[data-clip]');
      busy(b, true, b.dataset.ixLog === 'log' ? 'Logging' : 'Dismissing');
      try {
        const res = await api('/api/integrations/clip-log/act', { method: 'POST', json: { clip_id: row.dataset.clip, partner_id: pid, action: b.dataset.ixLog, confirm: b.dataset.ixLog === 'log' } });
        row.remove();
        if (!box.children.length) box.remove();
        toast(b.dataset.ixLog === 'log' ? res.detail || 'Logged on the record.' : 'Dismissed.');
      } catch (err) {
        busy(b, false);
        toast(err.message, 5200);
      }
    });
  }
  // The partner page draws its action row in place; a suggestion shows under it the first time it appears for a partner.
  let ppTimer = 0;
  new MutationObserver(() => {
    if (ppTimer) return;
    ppTimer = setTimeout(() => {
      ppTimer = 0;
      document.querySelectorAll('.pp-acts').forEach((acts) => { seenPartner.add(acts); partnerSuggestions(acts); });
    }, 400);
  }).observe(document.documentElement, { childList: true, subtree: true });

  /* ------------------------------------------------------------------ 4. Meeting prep packs and 5. the follow-up email */

  const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const dayShort = (d) => (d ? new Date(String(d).length <= 10 ? d + 'T12:00:00Z' : d).toLocaleDateString('en-US', { timeZone: String(d).length <= 10 ? 'UTC' : ET, month: 'short', day: 'numeric' }) : '');
  function cardHtml(c) {
    const sec = (title, items) => (items ? `<div class="ix-pcard__sec"><h4>${esc(title)}</h4>${items}</div>` : '');
    const list = (arr, fn) => (arr && arr.length ? `<ul>${arr.map(fn).join('')}</ul>` : '');
    const giving = c.giving
      ? `<div class="ix-pcard__giving"><span>${money(c.giving.lifetime)}<small>Lifetime</small></span><span>${money(c.giving.last12)}<small>Last 12 months</small></span>${c.giving.last ? `<span>${money(c.giving.last.amount)}<small>Last gift, ${esc(dayShort(c.giving.last.date))}</small></span>` : ''}</div>`
      : '';
    return `<article class="ix-pcard">
      <div class="ix-pcard__h">${c.kind === 'staff' ? avatar(c.email) : `<span class="rq-av rq-av--sm" data-c="${c.kind === 'partner' ? 'sun' : 'slate'}">${esc((c.name || '?').slice(0, 1).toUpperCase())}</span>`}<span><b>${c.partnerUrl ? `<a href="${esc(c.partnerUrl)}">${esc(c.name)}</a>` : esc(c.name)}</b><small>${esc(c.sub)}</small></span></div>
      ${giving}
      ${sec('Last contact', c.lastContact ? `<ul><li>${esc(dayShort(c.lastContact.date))}: ${esc(c.lastContact.what)}</li></ul>` : '')}
      ${sec('Open on the record', list(c.open, (o) => `<li>${esc(o.text)}${o.due ? `, due ${esc(dayShort(o.due))}` : ''}</li>`))}
      ${sec('Asked of you', list(c.asked, (a) => `<li><a href="${esc(a.url)}">${esc(a.title)}</a></li>`))}
      ${sec('Open tasks between you', list(c.tasks, (t) => `<li><a href="${esc(t.url)}">${esc(t.title)}</a>${t.due ? `, due ${esc(dayShort(t.due))}` : ''}${t.mine ? '' : ' (theirs)'}</li>`))}
      ${sec('Recent emails', list(c.emails, (m) => `<li><a href="${esc(m.url)}">${esc(m.subject)}</a>${m.at ? `, ${esc(dayShort(m.at))}` : ''}</li>`))}
      ${sec('Recent chats', list(c.chats, (m) => `<li><a href="${esc(m.url)}">${esc(m.who)}: ${esc(m.text)}</a></li>`))}
      ${c.lastMeeting ? sec(`Last meeting, ${dayShort(c.lastMeeting.date)}`, `<ul><li><a href="${esc(c.lastMeeting.url)}">${esc(c.lastMeeting.title)}</a>${c.lastMeeting.summary ? `: ${esc(c.lastMeeting.summary)}` : ''}</li>${c.lastMeeting.actions.map((a) => `<li>${a.owner ? esc(a.owner) + ': ' : ''}${esc(a.text)}</li>`).join('')}</ul>`) : ''}
    </article>`;
  }
  const packHtml = (p) => (p.cards.length ? `<div class="ix-pack">${p.cards.map(cardHtml).join('')}</div>` : '<p class="ix-quiet">Nothing on file with these people yet.</p>');

  function openPack(p) {
    api('/api/integrations/prep/seen', { method: 'POST', json: { key: p.key } }).catch(() => {});
    return open('Meeting prep', (el, done) => {
      el.innerHTML = `${head(p.meeting.title, `${when(p.meeting.start)} ET, ${p.cards.length} ${p.cards.length === 1 ? 'person' : 'people'}`)}
        <div class="ix-body">${packHtml(p)}</div>
        <div class="rt-sheet__foot"><button type="button" class="rt-btn rt-btn--ghost" data-ix-settings>Settings</button>${p.meeting.prepUrl ? `<a class="rt-btn" href="${esc(p.meeting.prepUrl)}">Prep page</a>` : ''}${p.meeting.url ? `<a class="rt-btn rt-btn--primary" href="${esc(p.meeting.url)}"${p.meeting.source === 'google' ? ' target="_blank" rel="noopener"' : ''}>${p.meeting.source === 'google' ? 'Open the event' : 'Join'}</a>` : ''}</div>`;
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-ix-close]')) done(null);
        if (e.target.closest('[data-ix-settings]')) { done(null); setTimeout(meetSettings, 160); }
      });
    }, 'ix-prep');
  }

  /** The person's own switches: prep packs, internal repeating meetings too, and the follow-up email. */
  async function meetSettings() {
    let prefs = null;
    try { prefs = (await api('/api/integrations/prefs')).prefs; } catch (err) { toast(err.message); return null; }
    return open('Meeting prep and follow-up', (el, done) => {
      const draw = () => {
        el.innerHTML = `${head('Meeting prep and follow-up', 'Your own settings')}
          <div class="ix-body">
            <label class="ix-check"><input type="checkbox" data-ix-pref="prep_on" ${prefs.prep_on ? 'checked' : ''} /><span><b>Prep before meetings</b><br />Fifteen minutes before a meeting with partners or staff, a card by the Chat bubble shows each person: giving, last contact, open tasks, recent emails and chats, what they asked you for, and the last meeting's notes.</span></label>
            <label class="ix-check"><input type="checkbox" data-ix-pref="prep_recurring" ${prefs.prep_recurring ? 'checked' : ''} ${prefs.prep_on ? '' : 'disabled'} /><span>Also for repeating meetings with staff only</span></label>
            <label class="ix-check"><input type="checkbox" data-ix-pref="followup_on" ${prefs.followup_on ? 'checked' : ''} /><span><b>Follow-up email drafts</b><br />After a meeting with people outside Favor, a draft to them from the notes and action items opens for you to edit. It never sends by itself.</span></label>
          </div>
          <div class="rt-sheet__foot"><button type="button" class="rt-btn rt-btn--primary" data-ix-close>Done</button></div>`;
      };
      draw();
      el.addEventListener('change', async (e) => {
        const k = e.target.dataset && e.target.dataset.ixPref;
        if (!k) return;
        try {
          prefs = (await api('/api/integrations/prefs', { method: 'POST', json: { [k]: e.target.checked } })).prefs;
          draw();
          toast('Saved.');
          if (k === 'prep_on') checkDock(true);
        } catch (err) { toast(err.message); draw(); }
      });
      el.addEventListener('click', (e) => { if (e.target.closest('[data-ix-close]')) done(prefs); });
    }, 'ix-settings');
  }

  // The card by the Chat bubble: the next meeting's prep, and follow-up drafts. Checked every two minutes while the tab is open.
  let dockEl = null;
  function dockBox() {
    if (dockEl && document.body.contains(dockEl)) return dockEl;
    dockEl = document.createElement('div');
    dockEl.className = 'ix-dock';
    dockEl.setAttribute('role', 'region');
    dockEl.setAttribute('aria-label', 'Meeting prep');
    document.body.appendChild(dockEl);
    dockEl.addEventListener('click', onDockClick);
    return dockEl;
  }
  const DS = { packs: [], follow: [], hidden: new Set((() => { try { return JSON.parse(sessionStorage.getItem('favor.ix.hidden') || '[]'); } catch (_) { return []; } })()) };
  function hide(key) { DS.hidden.add(key); try { sessionStorage.setItem('favor.ix.hidden', JSON.stringify([...DS.hidden].slice(-40))); } catch (_) { /* private mode */ } paintDock(); }
  function paintDock() {
    const packs = DS.packs.filter((p) => !DS.hidden.has('p:' + p.key));
    const follow = DS.follow.filter((f) => !DS.hidden.has('f:' + f.meeting_id));
    if (!packs.length && !follow.length) { if (dockEl) dockEl.remove(); dockEl = null; return; }
    const box = dockBox();
    box.innerHTML = packs.map((p) => {
      const mins = Math.round((Date.parse(p.meeting.start) - Date.now()) / 60000);
      const soon = mins <= 0 ? 'Starting now' : `In ${mins} min`;
      return `<div class="ix-dc" data-key="${esc(p.key)}"><span class="ix-dc__k">${ic('people')}Prep · ${esc(soon)}</span><b>${esc(p.meeting.title)}</b><small>${esc(p.cards.slice(0, 3).map((c) => c.name.split(' ')[0]).join(', '))}${p.cards.length > 3 ? ' and ' + (p.cards.length - 3) + ' more' : ''}</small><span class="ix-dc__a"><button type="button" class="rt-btn rt-btn--sm rt-btn--primary" data-ix-dock="open">Open</button><button type="button" class="rt-btn rt-btn--sm" data-ix-dock="hide">Hide</button></span></div>`;
    }).join('') + follow.map((f) => f.state === 'offer'
      ? `<div class="ix-dc ix-dc--offer" data-mid="${esc(f.meeting_id)}"><span class="ix-dc__k">${ic('mail')}Follow-up email</span><b>Want a follow-up draft after meetings like ${esc(f.title)}?</b><small>How it works: after a meeting with people outside Favor, FavorOS writes a short email to them from the notes and action items. It opens for you to edit and send. Nothing sends by itself.</small><span class="ix-dc__a"><button type="button" class="rt-btn rt-btn--sm rt-btn--primary" data-ix-dock="turnon">Turn on</button><button type="button" class="rt-btn rt-btn--sm" data-ix-dock="nothanks">No thanks</button></span></div>`
      : `<div class="ix-dc" data-mid="${esc(f.meeting_id)}"><span class="ix-dc__k">${ic('mail')}Follow-up ready</span><b>${esc(f.subject || f.title)}</b><small>To ${esc((f.to || []).join(', '))}</small><span class="ix-dc__a"><button type="button" class="rt-btn rt-btn--sm rt-btn--primary" data-ix-dock="compose">Open draft</button><button type="button" class="rt-btn rt-btn--sm" data-ix-dock="dismiss">Dismiss</button></span></div>`).join('');
  }
  async function onDockClick(e) {
    const b = e.target.closest('[data-ix-dock]');
    if (!b) return;
    const card = b.closest('.ix-dc');
    const act = b.dataset.ixDock;
    if (act === 'open' || act === 'hide') {
      const p = DS.packs.find((x) => x.key === card.dataset.key);
      if (act === 'open' && p) openPack(p);
      else if (p) api('/api/integrations/prep/seen', { method: 'POST', json: { key: p.key } }).catch(() => {});
      hide('p:' + card.dataset.key);
      return;
    }
    const mid = card.dataset.mid;
    const f = DS.follow.find((x) => x.meeting_id === mid);
    try {
      if (act === 'turnon') {
        busy(b, true, 'Turning on');
        await api('/api/integrations/prefs', { method: 'POST', json: { followup_on: true } });
        const r = await api(`/api/integrations/followups/${encodeURIComponent(mid)}`, { method: 'POST', json: { action: 'draft' } });
        Object.assign(f, { state: 'ready', to: r.draft.to, subject: r.draft.subject, body: r.draft.body });
        toast('On. Your draft is ready. Turn it off any time in Meeting prep settings.', 5200);
        paintDock();
      } else if (act === 'nothanks') {
        await api('/api/integrations/prefs', { method: 'POST', json: { followup_offer_closed: true } });
        await api(`/api/integrations/followups/${encodeURIComponent(mid)}`, { method: 'POST', json: { action: 'dismiss' } });
        hide('f:' + mid);
      } else if (act === 'dismiss') {
        await api(`/api/integrations/followups/${encodeURIComponent(mid)}`, { method: 'POST', json: { action: 'dismiss' } });
        hide('f:' + mid);
      } else if (act === 'compose') {
        const html = String(f.body || '').split(/\n{2,}/).map((para) => '<p>' + esc(para).replace(/\n/g, '<br>') + '</p>').join('');
        if (window.FavorCompose && window.FavorCompose.open) {
          await window.FavorCompose.open({ mode: 'float', to: (f.to || []).map((x) => ({ email: x, name: '' })), subject: f.subject, body: html });
        } else {
          location.href = `mailto:${encodeURIComponent((f.to || []).join(','))}?subject=${encodeURIComponent(f.subject)}&body=${encodeURIComponent(f.body)}`;
        }
        await api(`/api/integrations/followups/${encodeURIComponent(mid)}`, { method: 'POST', json: { action: 'opened' } });
        hide('f:' + mid);
      }
    } catch (err) {
      busy(b, false);
      toast(err.message, 5200);
    }
  }
  let lastCheck = 0;
  async function checkDock(force) {
    if (document.hidden || (!force && Date.now() - lastCheck < 100000)) return;
    if (/^\/(meet\/(room|g)|login|c)\//.test(location.pathname)) return;
    lastCheck = Date.now();
    try {
      const [pk, fu] = await Promise.all([api('/api/integrations/prep/upcoming').catch(() => ({ packs: [] })), api('/api/integrations/followups').catch(() => ({ items: [] }))]);
      DS.packs = (pk.packs || []).filter((p) => !p.seen);
      DS.follow = fu.items || [];
      paintDock();
    } catch (_) { /* quiet */ }
  }
  setTimeout(() => checkDock(true), 2500);
  setInterval(() => checkDock(false), 120000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDock(false); });

  // The meeting prep page gets the same cards under its own sheet.
  async function prepPage() {
    if (!/^\/meet\/prep\/?$/.test(location.pathname)) return;
    const id = new URLSearchParams(location.search).get('m');
    const root = document.getElementById('mt-prep');
    if (!id || !root || document.getElementById('ix-prep-people')) return;
    const sec = document.createElement('section');
    sec.id = 'ix-prep-people';
    sec.className = 'h-card ix-prep-sec';
    sec.innerHTML = '<div class="ix-prep-sec__h"><h3>People</h3><button type="button" class="rt-btn rt-btn--sm rt-btn--ghost" data-ix-settings>Settings</button></div><div class="ix-skel" aria-hidden="true"><i></i><i></i></div>';
    root.insertAdjacentElement('afterend', sec);
    sec.addEventListener('click', (e) => { if (e.target.closest('[data-ix-settings]')) meetSettings(); });
    try {
      const r = await api(`/api/integrations/prep/meeting?m=${encodeURIComponent(id)}`);
      sec.innerHTML = `<div class="ix-prep-sec__h"><h3>People</h3><button type="button" class="rt-btn rt-btn--sm rt-btn--ghost" data-ix-settings>Settings</button></div>${packHtml(r.pack)}`;
    } catch (_) { sec.remove(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', prepPage); else prepPage();
  document.addEventListener('hub-swapped', prepPage);
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-ix-meetset]')) { e.preventDefault(); meetSettings(); } });

  window.FavorIx = { api, toast, open, close, esc, ic, when, timeOnly, person, avatar, phone, accept, focus, findTime, me, clipReply, recordClip, meetSettings, openPack, checkDock };
  /* ------------------------------------------------------------------ entry points on other pages */

  // Any button with data-ix-ft='{"kind":..., "ref":..., "people":[...], "title":...}' opens Find a time (request panel, partner page).
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-ix-ft]');
    if (!b) return;
    e.preventDefault();
    let ctx = null;
    try { ctx = JSON.parse(b.dataset.ixFt); } catch (_) { ctx = null; }
    if (ctx) findTime(ctx);
  });
  // data-ix-clip='{"kind":..., "ref":..., "people":[...]}' records a clip in place and sends it there (partner page).
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-ix-clip]');
    if (!b) return;
    e.preventDefault();
    let ctx = null;
    try { ctx = JSON.parse(b.dataset.ixClip); } catch (_) { ctx = null; }
    if (ctx) clipReply(ctx);
  });

  // Mail draws an empty slot in each conversation's toolbar and tells us (favor-mail:thread). Two buttons go in it:
  // Find a time with the people on the thread, and a clip reply when clips are ready (clipReply).
  const MAIL_ICON = { cal: ICON.cal, cam: ICON.cam };
  window.addEventListener('favor-mail:thread', (e) => {
    const d = (e && e.detail) || {};
    const slot = d.el;
    if (!slot || !d.threadId) return;
    slot.querySelectorAll('[data-ix-mail]').forEach((x) => x.remove());
    const mk = (kind, label, icon) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ml-iconbtn';
      b.dataset.ixMail = kind;
      b.setAttribute('aria-label', label);
      b.title = label;
      b.innerHTML = `<svg class="ml-i" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${MAIL_ICON[icon]}</svg>`;
      slot.appendChild(b);
      return b;
    };
    const people = (d.participants || []).filter((p) => p && p.email);
    mk('time', 'Find a time', 'cal').addEventListener('click', () => findTime({ kind: 'mail', ref: String(d.threadId), title: String(d.subject || '').replace(/^\s*(re|fwd?):\s*/i, ''), people }));
    if (window.FavorIx.clipReply) mk('clip', 'Reply with a clip', 'cam').addEventListener('click', () => window.FavorIx.clipReply({ kind: 'mail', ref: String(d.threadId), title: d.subject || '', people, mb: d.mb }));
  });

})();
