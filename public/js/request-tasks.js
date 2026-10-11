/* Request board tasks: the people picker (Send to, Waiting on, @mention, filter by person) and the conversation under a request.
   The conversation is drawn with Favor Chat's own markup and styles (ch-msg, ch-av, ch-comp, ch-pop) and its composer
   (FavorChat.util.composerHtml from chat-ui.js), so a comment reads the same on the board and under the card in Chat.
   Mentions are Chat's tokens: the box shows @Name, the server gets <@email>. Used by requests-board.js. */
(() => {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COLORS = ['sun', 'sky', 'leaf', 'dusk', 'terra', 'teal', 'slate'];
  const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
  const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const ICON = {
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    back: '<path d="m15 5-7 7 7 7"/>',
    send: '<path d="M4 12 20 4l-4 16-4-6z"/><path d="m12 14 8-10"/>',
    at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  };
  const ic = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ''}</svg>`;
  const phone = () => matchMedia('(max-width: 860px)').matches;

  /* ------------------------------------------------------------------ the staff list */
  let peopleP = null;
  const P = { list: [], by: new Map(), me: '' };
  function people() {
    if (!peopleP) {
      peopleP = fetch('/api/requests/people', { credentials: 'same-origin' })
        .then((r) => r.json())
        .then((d) => {
          P.list = (d && d.people) || [];
          P.me = (d && d.me) || '';
          P.by = new Map(P.list.map((p) => [p.email, p]));
          return P;
        })
        .catch(() => { peopleP = null; return P; });
    }
    return peopleP;
  }
  const person = (email) => P.by.get(String(email || '').toLowerCase()) || { email, name: String(email || '').split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), team: '', title: '', picture: '' };
  function avatar(email, size) {
    const p = person(email);
    const inner = p.picture ? `<img src="${esc(p.picture)}" alt="" referrerpolicy="no-referrer" />` : esc(initials(p.name));
    return `<span class="ch-av${size ? ' ch-av--' + size : ''}" data-c="${COLORS[hash(String(email || '')) % 7]}">${inner}</span>`;
  }
  const sub = (p) => [p.team, p.title].filter(Boolean).join(' · ');
  // Every word typed must appear; a first name that starts with it comes first, then any name that does, then the rest.
  function match(q) {
    const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return P.list.slice();
    const rank = (p) => {
      const n = p.name.toLowerCase();
      if (n.startsWith(words[0])) return 0;
      if (n.split(/\s+/).some((w) => w.startsWith(words[0]))) return 1;
      return 2;
    };
    return P.list
      .filter((p) => words.every((w) => `${p.name} ${p.email} ${p.team} ${p.title}`.toLowerCase().includes(w)))
      .map((p, i) => ({ p, i, r: rank(p) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.p);
  }

  /* ------------------------------------------------------------------ a sheet (phone) or dialog (desktop) */
  let sheet = null;
  let sheetTok = null;
  function closeSheet(result) {
    if (!sheet) return;
    const s = sheet;
    sheet = null;
    if (sheetTok && window.hubOv) { const t = sheetTok; sheetTok = null; window.hubOv.off(t); }
    s.el.remove();
    s.scrim.remove();
    document.documentElement.classList.remove('rt-sheet-open');
    s.resolve(result || null);
    if (s.ret && s.ret.focus) { try { s.ret.focus({ preventScroll: true }); } catch (_) { /* gone */ } }
  }
  function openSheet(html, label) {
    closeSheet(null);
    return new Promise((resolve) => {
      const scrim = document.createElement('div');
      scrim.className = 'rt-scrim';
      const el = document.createElement('div');
      el.className = 'rt-sheet';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-label', label);
      el.innerHTML = html;
      document.body.append(scrim, el);
      document.documentElement.classList.add('rt-sheet-open');
      sheet = { el, scrim, resolve, ret: document.activeElement };
      scrim.addEventListener('click', () => closeSheet(null));
      if (window.hubOv) sheetTok = window.hubOv.on(() => { sheetTok = null; closeSheet(null); });
      fitKeyboard();
    });
  }
  // The sheet ends at the top of the on-screen keyboard, never under it.
  function fitKeyboard() {
    const vv = window.visualViewport;
    const bottom = vv ? Math.max(0, Math.round(window.innerHeight - vv.offsetTop - vv.height)) : 0;
    document.documentElement.style.setProperty('--rt-kb', bottom + 'px');
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitKeyboard);
    window.visualViewport.addEventListener('scroll', fitKeyboard);
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheet) { e.stopPropagation(); closeSheet(null); }
  }, true);

  const rowHtml = (p, i, on) => `<button type="button" class="rt-person${on ? ' is-on' : ''}" role="option" data-email="${esc(p.email)}" data-i="${i}" aria-selected="${on ? 'true' : 'false'}">${avatar(p.email, 'sm')}<span class="rt-person__t"><b>${esc(p.name)}</b>${sub(p) ? `<small>${esc(sub(p))}</small>` : ''}</span>${on ? `<span class="rt-person__ok">${ic('check')}</span>` : ''}</button>`;

  /**
   * Pick a person. opts: title, current (email), exclude (emails), note (true: a second step asks for context and returns it),
   * noteLabel, action (button word), clear (a label for "nobody", returns {email: null}). Resolves to {email, note} or null.
   */
  async function pick(opts = {}) {
    await people();
    const exclude = new Set((opts.exclude || []).map((e) => String(e).toLowerCase()));
    const title = opts.title || 'Pick a person';
    const done = openSheet('', title);
    const el = sheet.el;
    let shown = [];
    let hi = 0;
    let picked = null;
    let query = '';
    const listStep = () => {
      picked = null;
      el.classList.remove('rt-sheet--note');
      el.innerHTML = `<div class="rt-sheet__head"><h2>${esc(title)}</h2><button type="button" class="rt-x" data-rt-close aria-label="Close">${ic('x')}</button></div>
        <div class="rt-search">${ic('search')}<input type="search" data-rt-q placeholder="Search by name or team" aria-label="Search by name or team" autocomplete="off" enterkeyhint="search" /></div>
        <div class="rt-people" role="listbox" data-rt-list aria-label="Staff"></div>
        ${opts.clear ? `<div class="rt-sheet__foot"><button type="button" class="rt-btn" data-rt-clear>${esc(opts.clear)}</button></div>` : ''}`;
      const q = el.querySelector('[data-rt-q]');
      const list = el.querySelector('[data-rt-list]');
      q.value = query;
      const draw = () => {
        shown = match(q.value).filter((p) => !exclude.has(p.email));
        hi = Math.min(hi, Math.max(0, shown.length - 1));
        list.innerHTML = shown.length ? shown.map((p, i) => rowHtml(p, i, p.email === opts.current)).join('') : '<p class="rt-none">Nobody on the staff list matches.</p>';
        const cur = list.children[hi];
        if (cur && cur.classList && shown.length && !phone()) cur.classList.add('is-hi');
      };
      draw();
      if (!phone()) setTimeout(() => q.focus(), 0);
      q.addEventListener('input', () => { query = q.value; hi = 0; draw(); });
      q.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          hi = Math.max(0, Math.min(shown.length - 1, hi + (e.key === 'ArrowDown' ? 1 : -1)));
          list.querySelectorAll('.is-hi').forEach((x) => x.classList.remove('is-hi'));
          const cur = list.children[hi];
          if (cur) { cur.classList.add('is-hi'); cur.scrollIntoView({ block: 'nearest' }); }
        }
        if (e.key === 'Enter' && shown[hi]) { e.preventDefault(); chosen(shown[hi].email); }
      });
    };
    const noteStep = (email) => {
      picked = email;
      const p = person(email);
      el.classList.add('rt-sheet--note');
      el.innerHTML = `<div class="rt-sheet__head"><button type="button" class="rt-x" data-rt-back aria-label="Back to the list">${ic('back')}</button><h2>${esc(title)}</h2><button type="button" class="rt-x" data-rt-close aria-label="Close">${ic('x')}</button></div>
        <div class="rt-to">${avatar(email)}<span class="rt-person__t"><b>${esc(p.name)}</b>${sub(p) ? `<small>${esc(sub(p))}</small>` : ''}</span></div>
        <label class="rt-label" for="rt-note">${esc(opts.noteLabel || 'Context')}</label>
        <textarea id="rt-note" class="rt-note" rows="5" maxlength="2000" placeholder="What ${esc(p.name.split(' ')[0])} needs to know"></textarea>
        <div class="rt-sheet__foot"><button type="button" class="rt-btn" data-rt-back>Back</button><button type="button" class="rt-btn rt-btn--primary" data-rt-send>${ic('send')}${esc(opts.action || 'Send')}</button></div>`;
      const ta = el.querySelector('#rt-note');
      setTimeout(() => ta.focus(), 30);
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); closeSheet({ email, note: ta.value.trim() }); } });
    };
    const chosen = (email) => { if (opts.note) noteStep(email); else closeSheet({ email }); };
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-rt-close]')) { closeSheet(null); return; }
      if (e.target.closest('[data-rt-clear]')) { closeSheet({ email: null }); return; }
      if (e.target.closest('[data-rt-back]')) { listStep(); return; }
      if (e.target.closest('[data-rt-send]') && picked) { const ta = el.querySelector('#rt-note'); closeSheet({ email: picked, note: ta ? ta.value.trim() : '' }); return; }
      const b = e.target.closest('[data-email]');
      if (b) chosen(b.dataset.email);
    });
    listStep();
    return done;
  }

  /* ------------------------------------------------------------------ text */
  function fmt(body, me) {
    let t = esc(body || '');
    t = t.replace(/&lt;@([^&\s]+?)&gt;/g, (_, id) => `<span class="ch-at${id === me ? ' ch-at--me' : ''}">@${esc(person(id).name)}</span>`);
    t = t.replace(/(https?:\/\/[^\s<]+[^\s<).,;:!?])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    return t;
  }
  const ET = 'America/New_York';
  const when = (iso) => {
    const d = new Date(iso);
    const day = (x) => x.toLocaleDateString('en-CA', { timeZone: ET });
    const time = d.toLocaleTimeString('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' });
    if (day(d) === day(new Date())) return time;
    return d.toLocaleDateString('en-US', { timeZone: ET, month: 'short', day: 'numeric' }) + ', ' + time;
  };

  /** What happened, in the order it happened: the comments as Chat messages and the hand-offs and changes as lines between them. */
  function activityHtml(req, me) {
    const items = [];
    for (const c of req.comments || []) items.push({ at: c.created_at, c });
    for (const e of req.events || []) if (e.kind !== 'mention') items.push({ at: e.created_at, e });
    items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.e ? -1 : 1));
    let prev = null;
    return items.map((it) => {
      if (it.e) { prev = null; return eventHtml(it.e); }
      const c = it.c;
      const cont = prev && prev.email === c.email && Date.parse(c.created_at) - Date.parse(prev.created_at) < 5 * 60000;
      prev = c;
      const name = c.name && c.name.includes('@') ? person(c.email).name : c.name || person(c.email).name;
      const text = c.deleted ? '<div class="ch-msg__text ch-msg__deleted">This comment was deleted.</div>' : `<div class="ch-msg__text">${fmt(c.body, me)}</div>`;
      const from = c.source === 'chat' ? '<span class="ch-tag rt-tag">Chat</span>' : c.source === 'send' ? '<span class="ch-tag rt-tag">Note</span>' : '';
      const del = !c.deleted && c.email === me ? `<div class="ch-bar" role="toolbar" aria-label="Comment actions"><button type="button" data-rt-del="${esc(c.id)}" aria-label="Delete" title="Delete">${ic('trash')}</button></div>` : '';
      const gut = cont ? `<span class="ch-msg__time">${esc(when(c.created_at).replace(/^.*, /, '').replace(/ (AM|PM)/, ''))}</span>` : avatar(c.email);
      const meta = cont ? '' : `<div class="ch-msg__meta"><span class="ch-msg__name">${esc(name)}</span>${from}<span class="ch-msg__time">${esc(when(c.created_at))}</span></div>`;
      return `<article class="ch-msg${cont ? ' ch-msg--cont' : ''}" data-cid="${esc(c.id)}"><div class="ch-msg__gut">${gut}</div><div class="ch-msg__body">${meta}${text}</div>${del}</article>`;
    }).join('');
  }
  const STATUS = { inbox: 'Inbox', approved: 'Approved', in_progress: 'In motion', done: 'Done', declined: 'Declined' };
  const dayWord = (d) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }) : '');
  function eventHtml(e) {
    const p = e.payload || {};
    const who = esc(e.actor);
    let text = '';
    if (e.kind === 'created') text = `${who} made the request`;
    else if (e.kind === 'status') text = `${who} moved it to ${esc(STATUS[p.to] || p.to)}`;
    else if (e.kind === 'sent') text = `${esc(p.from_name || e.actor)} sent it to <b>${esc(p.to_name || person(p.to).name)}</b>`;
    else if (e.kind === 'due') text = p.to ? `${who} set the due date to ${esc(dayWord(p.to))}` : `${who} cleared the due date`;
    else if (e.kind === 'waiting') text = p.email ? `${who} marked it waiting on <b>${esc(p.name || person(p.email).name)}</b>` : `${who} cleared Waiting on`;
    else text = `${who} · ${esc(e.kind)}`;
    return `<div class="rt-event"><span>${text}</span><time>${esc(when(e.created_at))}</time></div>`;
  }

  /* ------------------------------------------------------------------ the composer */
  // Chat's composer when chat-ui.js is on the page; the same markup otherwise.
  function composerHtml(placeholder) {
    const u = window.FavorChat && window.FavorChat.util;
    if (u && typeof u.composerHtml === 'function') return u.composerHtml('rt', placeholder);
    return `<form class="ch-comp" data-scope="rt" autocomplete="off"><div class="ch-comp__box"><textarea rows="1" data-ta="rt" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" enterkeyhint="send"></textarea><div class="ch-comp__bar"><button type="button" class="ch-iconbtn" data-act="at" data-scope="rt" aria-label="Mention someone" title="Mention someone">${ic('at')}</button><span class="ch-comp__sp"></span><button type="submit" class="ch-send" data-send="rt" disabled aria-label="Send">${ic('send')}<span>Send</span></button></div></div></form>`;
  }

  /** Wires a composer: @ suggestions, the @ button, Enter to send (Shift Enter for a new line), and the tokens on send. */
  function bindComposer(root, onSend) {
    const form = root.querySelector('.ch-comp');
    const ta = root.querySelector('[data-ta="rt"]');
    const btn = root.querySelector('[data-send="rt"]');
    if (!form || !ta) return;
    const map = {};
    let pop = null;
    let st = null;
    const grow = () => { ta.style.height = '0px'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; };
    const sync = () => { if (btn) btn.disabled = !ta.value.trim(); };
    const closePop = () => { if (pop) { pop.remove(); pop = null; } st = null; };
    const insert = (p) => {
      const label = '@' + p.name;
      map[label] = '<@' + p.email + '>';
      const start = st ? st.start : ta.selectionStart;
      const end = st ? st.end : ta.selectionStart;
      const pre = st ? '' : ta.value.slice(0, start).match(/(^|\s)$/) ? '' : ' ';
      ta.value = ta.value.slice(0, start) + pre + label + ' ' + ta.value.slice(end);
      const at = start + pre.length + label.length + 1;
      ta.focus();
      ta.setSelectionRange(at, at);
      closePop();
      grow();
      sync();
    };
    const suggest = () => {
      const pos = ta.selectionStart;
      const m = ta.value.slice(0, pos).match(/(^|\s)@([\w .'-]{0,24})$/);
      if (!m) { closePop(); return; }
      const cands = match(m[2]).filter((p) => p.email !== P.me).slice(0, 6);
      if (!cands.length) { closePop(); return; }
      st = { start: pos - m[2].length - 1, end: pos, cands, i: 0 };
      if (!pop) {
        pop = document.createElement('div');
        pop.className = 'ch-pop ch-pop--mention rt-mention';
        pop.setAttribute('role', 'listbox');
        form.querySelector('.ch-comp__box').appendChild(pop);
        pop.addEventListener('mousedown', (e) => e.preventDefault());
        pop.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b && st) insert(st.cands[+b.dataset.i]); });
      }
      pop.innerHTML = '<div class="ch-pop__h">People</div>' + cands.map((p, i) => `<button type="button" class="ch-pop__i${i === 0 ? ' is-on' : ''}" role="option" data-i="${i}"><b style="background:transparent">${avatar(p.email, 'sm')}</b><span>${esc(p.name)}${sub(p) ? `<small>${esc(sub(p))}</small>` : ''}</span></button>`).join('');
    };
    people();
    ta.addEventListener('input', () => { grow(); sync(); suggest(); });
    ta.addEventListener('blur', () => setTimeout(closePop, 150));
    ta.addEventListener('keydown', (e) => {
      if (st && pop && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        st.i = Math.max(0, Math.min(st.cands.length - 1, st.i + (e.key === 'ArrowDown' ? 1 : -1)));
        pop.querySelectorAll('.ch-pop__i').forEach((b, i) => b.classList.toggle('is-on', i === st.i));
        return;
      }
      if (st && pop && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); insert(st.cands[st.i]); return; }
      if (st && pop && e.key === 'Escape') { e.stopPropagation(); closePop(); return; }
      if (e.key === 'Enter' && !e.shiftKey && !phone()) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true })); }
    });
    root.addEventListener('click', async (e) => {
      const at = e.target.closest('[data-act="at"]');
      if (!at || !root.contains(at)) return;
      e.preventDefault();
      const r = await pick({ title: 'Mention someone', exclude: [P.me] });
      if (r && r.email) { st = null; insert(person(r.email)); }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      let text = ta.value.trim();
      if (!text) return;
      Object.keys(map).sort((a, b) => b.length - a.length).forEach((label) => {
        const re = new RegExp('(^|[^\\w])' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w])', 'g');
        text = text.replace(re, (_, pre) => pre + map[label]);
      });
      const was = ta.value;
      ta.value = '';
      grow();
      sync();
      if (btn) btn.disabled = true;
      try {
        await onSend(text);
      } catch (err) {
        ta.value = was;
        grow();
        sync();
        throw err;
      }
    });
    sync();
  }

  window.ReqTasks = { people, person, avatar, pick, activityHtml, composerHtml, bindComposer, closeSheet, sub, dayWord };
})();
