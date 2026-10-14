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

  window.FavorIx = { api, toast, open, close, esc, ic, when, timeOnly, person, avatar, phone, accept, focus, findTime, me };
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
