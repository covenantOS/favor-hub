/* Today, redesigned 2026-10-14. One screen that answers two things: what needs me right now, and how Favor is doing.
     #t-cards        Needs you: one ranked list. The Inbox, Waiting on you, the Needs you counts, actions due, gifts to thank,
                     moments worth a call, and what you wait on from others, each row with a type chip and its one action.
     #td-sched       Today's schedule from /api/hub/day (FavorOS and Google meetings), with Join and Move to FavorOS.
     #t-year-wrap    How Favor is doing: raised against goal and team goals (KPI people), new gifts and thank-yous.
     #wh             Role modules from work-home.js and today-giftday.js (Entry queue or Your week, Gift day, Team, Undo).
     #td-more        What changed and Shared with you.
   Every source paints from this tab's last copy first, then from the server. Runs again on a swapped page (it binds to the new root). */
(() => {
  'use strict';
  const root = document.getElementById('td-root');
  if (!root || root.dataset.on) return;
  root.dataset.on = '1';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TZ = 'America/New_York';
  const et = (iso, o) => new Date(iso).toLocaleString('en-US', Object.assign({ timeZone: TZ }, o));
  const clock = (iso) => et(iso, { hour: 'numeric', minute: '2-digit' });
  const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
  const TODAY = dayKey(new Date().toISOString());
  const n0 = (n) => (Number(n) || 0).toLocaleString('en-US');
  const plural = (n, one, many) => n0(n) + ' ' + (Number(n) === 1 ? one : many || one + 's');
  const neg = (n) => (Number(n) < 0 ? '-' : '');
  const money0 = (n) => neg(Math.round(Number(n) || 0)) + '$' + Math.abs(Math.round(Number(n) || 0)).toLocaleString('en-US');
  const money = (n) => { const v = Number(n) || 0; return neg(v) + '$' + (Math.round(v) === v ? Math.abs(v).toLocaleString('en-US') : Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })); };
  const compact = (v) => { const n = Number(v) || 0, a = Math.abs(n), s = n < 0 ? '-' : ''; return a >= 1e9 ? s + '$' + (a / 1e9).toFixed(2) + 'B' : a >= 999500 ? s + '$' + (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? s + '$' + Math.round(a / 1e3) + 'K' : s + '$' + Math.round(a); };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fd = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); if (!m || !d) return ''; return MON[m - 1] + ' ' + d + (y === Number(TODAY.slice(0, 4)) ? '' : ', ' + y); };
  const ago = (iso) => {
    const t = Date.parse(iso); if (!t) return '';
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'now';
    if (m < 60) return m + 'm';
    const h = Math.round(m / 60);
    if (h < 24) return h + 'h';
    const d = Math.round(h / 24);
    if (d < 7) return d + 'd';
    return et(t, { month: 'short', day: 'numeric' });
  };
  const store = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* full or refused */ } },
    lget(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
    lset(k, v) { try { localStorage.setItem(k, v); } catch { /* refused */ } },
  };
  async function get(url) {
    const r = await fetch(url, { credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.ok === false) { const e = new Error(d.message || 'Could not load.'); e.status = r.status; throw e; }
    return d;
  }
  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'X-Hub-Request': '1' }, body: JSON.stringify(body || {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.ok === false) throw new Error(d.message || 'That did not work. Try again.');
    return d;
  }

  const P = {
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    chat: '<path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7.2L7 21v-3.5H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z"/>',
    task: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12.5 2.5 2.5 4.5-5.5"/>',
    request: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
    meeting: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
    handoff: '<path d="M4 12h12"/><path d="m12 6 6 6-6 6"/><path d="M20 5v14"/>',
    expense: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6"/><path d="M9 11h6"/>',
    gift: '<rect x="3" y="9" width="18" height="12" rx="1"/><path d="M12 9v12"/><path d="M3 13h18"/><path d="M12 9c-2-4-6-4-6-1s6 1 6 1 6 2 6-1-4-3-6 1"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    star: '<path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    leaf: '<path d="M12 4c3 3 5 5 5 8a5 5 0 0 1-10 0c0-3 2-5 5-8z"/>',
    cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16"/><path d="M9 3v4"/><path d="M15 3v4"/>',
    doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
    note: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8"/><path d="M8 12h5"/>',
    learn: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M8 7h7"/><path d="M8 11h5"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  };
  const ic = (n, cls) => `<svg class="h-i${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || P.flag}</svg>`;

  /* ================================================================ state */
  const S = {
    today: null, kpi: null, day: store.get('favor.hub.day.v2'), brief: null, away: null, home: window.__whData || null,
    inbox: store.get('favor.td.inbox.v1') || { fast: null, mail: null }, waiting: store.get('favor.td.waiting.v1') || { fast: null, mail: null },
    gifts: store.get('favor.today.gifts.v1'), next: null,
    tab: 'all', all: false, open: new Set(), gone: new Set(), owner: store.lget('favor.hub.brief.owner', ''), feedAll: false, pastOpen: false,
    settled: false,
  };
  window.__td = S;
  // The Team table opens sorted by the most overdue, five people at first (work-home.js reads this sort).
  if (!window.__whTeamSort) window.__whTeamSort = { key: 'overdue', dir: -1 };
  let teamAll = false;
  function fitTeam() {
    const card = $('wh-team');
    const btn = $('td-team-all');
    if (!card || !btn) return;
    const n = card.querySelectorAll('tbody tr').length;
    card.classList.toggle('is-short', n > 5 && !teamAll);
    btn.hidden = n <= 5;
    btn.textContent = teamAll ? 'Show fewer' : `Show all ${n0(n)} people`;
  }

  /* ================================================================ the ranked list */
  // The tone is the type chip's color; the category is which tab it falls under.
  const TYPE = {
    approval: ['Approval', 'terra', 'expense', 'work'], review: ['Request', 'sun', 'request', 'work'], request: ['Request', 'sun', 'request', 'work'],
    handoff: ['Hand-off', 'dusk', 'handoff', 'work'], reply: ['Reply', 'terra', 'chat', 'msg'], chat: ['Chat', 'sky', 'chat', 'msg'],
    mail: ['Mail', 'sky', 'mail', 'msg'], task: ['Task', 'leaf', 'task', 'work'], meeting: ['Meeting', 'teal', 'meeting', 'work'],
    flag: ['Flag', 'sun', 'flag', 'work'], actions: ['Actions', 'leaf', 'task', 'work'], thank: ['Thank', 'gold', 'phone', 'partners'],
    moment: ['Call', 'gold', 'star', 'partners'], eval: ['Evaluation', 'dusk', 'note', 'work'], feedback: ['Feedback', 'slate', 'note', 'work'],
    learn: ['Course', 'sun', 'learn', 'work'], receipts: ['Receipts', 'sky', 'mail', 'work'], waiting: ['Waiting', 'slate', 'clock', 'waiting'],
    project: ['Task', 'leaf', 'task', 'work'],
  };
  const TABS = [['all', 'All'], ['msg', 'Messages'], ['work', 'Work'], ['partners', 'Partners'], ['waiting', 'Waiting on others']];
  const SHOW = 8;

  const inboxKind = (k) => ({ mention: 'chat', dm: 'chat', reply: 'chat', task: 'task', request: 'request', review: 'review', meeting: 'meeting', handoff: 'handoff', pickup: 'handoff', expense: 'approval', mail: 'mail', flag: 'flag' }[k] || 'chat');
  const INBOX_RANK = { approval: 86, review: 84, handoff: 84, chat: 68, task: 66, request: 62, meeting: 60, flag: 58, mail: 55 };
  // Hub counts that repeat a kind the Inbox already lists one by one are left out (a request to review shows as its own row).
  const CARD_DUPE = { requests: ['review', 'request'], expenses: ['approval'], 'projects-assigned': ['task'] };
  const CARD_TYPE = { requests: 'review', expenses: 'approval', 'projects-due': 'project', 'projects-assigned': 'project', 'projects-news': 'project', tasks: 'project', 'tasks-waiting': 'project', 'tasks-news': 'project', meetings: 'meeting', evals: 'eval', feedback: 'feedback', learn: 'learn', receipts: 'receipts', foundations: 'task', brain: 'feedback' };
  const CARD_RANK = { 'projects-due': 80, evals: 74, requests: 76, expenses: 82, 'projects-assigned': 64, tasks: 64, receipts: 52, learn: 46, meetings: 44, 'projects-news': 40, 'tasks-news': 40, 'tasks-waiting': 38, feedback: 34, foundations: 30, brain: 30 };

  function thanksList() {
    // Gifts on the 24-hour clock from the briefing, and the newest gifts on this person's partners (today/gifts), one row per gift.
    const by = new Map();
    const b = S.brief;
    const clockOf = (due) => (window.FavorWG && window.FavorWG.clock && due ? window.FavorWG.clock(due) : { label: '', late: false });
    if (b && b.thanks) for (const g of (b.thanks.rows || []).concat(b.thanks.older || [])) {
      const c = clockOf(g.due);
      by.set(String(g.giftId), { g, src: 'brief', late: !!c.late || (g.due && Date.parse(g.due) < Date.now()), soon: !!c.soon, label: c.label, due: g.due });
    }
    const tg = S.gifts && S.gifts.gifts;
    if (tg) for (const g of tg) {
      if (!g.thank || g.thank.state === 'done' || g.thank.state === 'task') continue;
      const k = String(g.giftId);
      if (by.has(k)) continue;
      const due = g.thank.due;
      const late = !!g.thank.late || (due && Date.parse(due) < Date.now());
      by.set(k, { g: { giftId: g.giftId, cid: g.cid, name: g.name, amount: g.amount, date: g.date, fund: g.fund, phone: g.phone, team: g.team, through: g.soft && g.through ? g.through : '', tasks: (g.taskIds || []).length, left: g.thank.state === 'left' ? { date: g.thank.on, by: g.thank.by, how: g.thank.how } : null, due }, src: 'gifts', late, label: '', due });
    }
    return [...by.values()].filter((t) => !S.gone.has('gift:' + t.g.giftId)).sort((a, b2) => (Date.parse(a.due) || 9e15) - (Date.parse(b2.due) || 9e15));
  }

  function items() {
    const out = [];
    const T = S.today;
    // 1. Inbox, one row each.
    const ib = [].concat(S.inbox.fast || [], S.inbox.mail || []);
    const seen = new Set();
    const kinds = new Set();
    for (const it of ib) {
      if (seen.has(it.id) || S.gone.has(it.id)) continue;
      seen.add(it.id);
      const t = inboxKind(it.kind);
      kinds.add(t);
      out.push({ id: it.id, t, title: it.title, sub: [it.who && it.app === 'Mail' ? it.who : '', it.text].filter(Boolean).join(' · '), when: ago(it.at), ts: Date.parse(it.at) || 0, rank: INBOX_RANK[t] || 55, href: it.href, src: it, kind: 'inbox' });
    }
    // 2. Waiting on you (someone wants an answer) ranks high; what you wait on folds into one row at the end.
    const wl = [].concat(S.waiting.fast || [], S.waiting.mail || []);
    const wseen = new Set();
    const outs = [];
    for (const it of wl) {
      if (wseen.has(it.id) || S.gone.has(it.id)) continue;
      wseen.add(it.id);
      const age = it.days >= 1 ? plural(it.days, 'day') : ago(it.since);
      if (it.dir === 'in') out.push({ id: it.id, t: 'reply', title: it.title, sub: [it.who && it.who.name, it.app, age + ' waiting'].filter(Boolean).join(' · '), when: '', ts: Date.parse(it.since) || 0, rank: 88, href: it.href, src: it, kind: 'wait-in' });
      else outs.push({ id: it.id, t: 'waiting', title: it.title, sub: [it.app, age, it.text].filter(Boolean).join(' · '), when: '', ts: Date.parse(it.since) || 0, href: it.href, src: it, kind: 'wait-out' });
    }
    // Your own requests still waiting on someone (expenses, the board) sit with what you wait on.
    for (const m of (T && T.mine) || []) {
      if (/Done|Approved|Declined|Closed|Cancel/i.test(m.status || '')) continue;
      outs.push({ id: 'mine:' + m.href + m.title, t: 'waiting', title: String(m.title || '').trim() || 'Untitled', sub: m.status, when: '', ts: 0, href: m.href, kind: 'mine' });
    }
    // 3. The hub's counts (requests to review, tasks due, evaluations, feedback ...), one row per kind, unless the Inbox lists them.
    for (const c of (T && T.cards) || []) {
      if (!(Number(c.n) > 0)) continue;
      if ((CARD_DUPE[c.id] || []).some((k) => kinds.has(k))) continue;
      if (S.gone.has('card:' + c.id)) continue;
      const t = CARD_TYPE[c.id] || 'task';
      out.push({ id: 'card:' + c.id, t, title: `${n0(c.n)} ${c.what}`, sub: c.note || '', when: '', ts: 0, rank: c.warn ? 84 : CARD_RANK[c.id] || 40, href: c.href, kind: 'card', card: c, late: !!c.warn || /past due|overdue|late/i.test(c.note || '') });
    }
    // 4. Blackbaud actions due today or late, one row that opens to the list.
    const due = S.home && S.home.work && S.home.work.due;
    if (due && (due.overdue || due.today)) {
      const n = (due.overdue || 0) + (due.today || 0);
      const fr = due.fr ? '&fr=' + encodeURIComponent(due.fr) : '';
      const what = (r) => r.summary || (r.type && r.type !== 'No type' ? r.type : '') || 'Action';
      out.push({
        id: 'grp:actions', t: 'actions', title: `${plural(n, 'action')} ${due.scope === 'mine' ? 'of yours ' : ''}due today or late`,
        sub: [due.overdue ? n0(due.overdue) + ' late' : '', due.today ? n0(due.today) + ' due today' : ''].filter(Boolean).join(' · '),
        rank: due.overdue ? 82 : 72, ts: 0, href: '/work/?view=open' + fr, kind: 'group', late: !!due.overdue,
        rows: (due.rows || []).map((r) => ({ title: r.partner, sub: what(r) + (r.place ? ' · ' + r.place : ''), chip: r.late > 0 ? (r.late <= 60 ? plural(r.late, 'day') + ' late' : Math.round(r.late / 7) + ' wk late') : 'Today', late: r.late > 0, href: '/work/?action=' + encodeURIComponent(r.id), pid: r.cid })),
        more: { href: '/work/?view=open' + fr, text: 'Open all in Actions' },
      });
    }
    // 5. Gifts to thank: up to three rows of their own; more than three fold into one row.
    const th = thanksList();
    const thankRow = (x, i) => ({
      id: 'gift:' + x.g.giftId, t: 'thank', title: x.g.name || 'Partner ' + x.g.cid, sub: [money(x.g.amount), x.g.through ? 'through ' + x.g.through : '', x.g.fund, x.g.date ? fd(x.g.date) : ''].filter(Boolean).join(' · '),
      when: '', chip: x.label || (x.late ? 'Overdue' : ''), late: x.late, rank: x.late ? 92 : x.soon ? 90 : 78, ts: Date.parse(x.due) || 0, href: '/work/partner/' + encodeURIComponent(x.g.cid), kind: 'thank', gi: i, pid: x.g.cid,
    });
    S.thanks = th;
    if (th.length && th.length <= 3) th.forEach((x, i) => out.push(thankRow(x, i)));
    else if (th.length) {
      const late = th.filter((x) => x.late).length;
      out.push({ id: 'grp:thank', t: 'thank', title: `${plural(th.length, 'gift')} to thank`, sub: [late ? n0(late) + ' past the 24-hour clock' : '', 'Oldest from ' + (th[0].g.name || 'a partner')].filter(Boolean).join(' · '), rank: late ? 92 : 80, ts: 0, href: '/work/?view=gifts', kind: 'group', late: !!late, rows: th.slice(0, 12).map((x, i) => Object.assign(thankRow(x, i), { chip: x.label || (x.late ? 'Overdue' : fd(x.g.date)) })), more: { href: '/work/?view=gifts', text: 'All gifts to thank' } });
    }
    // 6. Moments worth a call.
    const ms = ((S.brief && S.brief.moments) || []).filter((m) => !S.gone.has('moment:' + m.id));
    if (ms.length) {
      const KIND = { largest: 'Largest gift', first: 'First gift', quiet: 'Gone quiet', anniversary: 'Anniversary' };
      out.push({ id: 'grp:moments', t: 'moment', title: `${plural(ms.length, 'partner')} worth a call`, sub: ms.slice(0, 3).map((m) => m.name).join(', ') + (ms.length > 3 ? ' and ' + (ms.length - 3) + ' more' : ''), rank: 36, ts: 0, kind: 'group',
        rows: ms.map((m) => ({ title: m.name, sub: (KIND[m.kind] || m.kind) + ': ' + m.line, href: m.href, pid: m.cid, moment: m })) });
    }
    // 7. What you wait on from others, at the end.
    if (outs.length) {
      outs.sort((a, b) => a.ts - b.ts);
      out.push({ id: 'grp:waiting', t: 'waiting', title: `You are waiting on ${plural(outs.length, 'reply', 'replies')}`, sub: [...new Set(outs.map((o) => (o.src && o.src.who && o.src.who.name) || '').filter(Boolean))].slice(0, 3).join(', '), rank: 20, ts: 0, kind: 'group', rows: outs.map((o) => ({ title: o.title, sub: [o.src && o.src.who && o.src.who.name, o.sub].filter(Boolean).join(' · '), href: o.href, wait: o })) });
    }
    out.sort((a, b) => b.rank - a.rank || (a.late === b.late ? 0 : a.late ? -1 : 1) || (a.kind === 'inbox' && b.kind === 'inbox' ? b.ts - a.ts : a.ts - b.ts));
    return out;
  }
  const catOf = (it) => (TYPE[it.t] || TYPE.task)[3];

  /* ---------------------------------------------------------------- rows */
  const chip = (t) => { const d = TYPE[t] || TYPE.task; return `<span class="td-type" data-tone="${d[1]}">${ic(d[2])}<span>${d[0]}</span></span>`; };
  function acts(it) {
    const s = it.src || {};
    if (it.kind === 'inbox') {
      if (s.kind === 'handoff') return `<button type="button" class="td-btn td-btn--primary" data-td-handoff="${esc(s.id.slice(3))}">Pick up</button>`;
      if (s.clear) return `<a class="td-btn td-btn--quiet" href="${esc(s.href)}">${esc(s.open || 'Open')}</a><button type="button" class="td-btn" data-td-clear="${esc(s.id)}" title="${esc(s.clear)}">${ic('check')}<span>${esc(s.clear)}</span></button>`;
      return `<a class="td-btn" href="${esc(s.href)}">${esc(s.open || 'Open')}</a>`;
    }
    if (it.kind === 'wait-in') return `<a class="td-btn td-btn--primary" href="${esc(it.href)}">Reply</a><button type="button" class="td-x" data-td-stop="${esc(it.id)}" aria-label="Take it off the list" title="Take it off the list">${ic('x')}</button>`;
    if (it.kind === 'card') return `<a class="td-btn" href="${esc(it.href)}">${esc(it.card.cta || 'Open')}</a>${window.hubSnoozeButton ? window.hubSnoozeButton('hub', 'card:' + it.card.id, it.card.label, 'td-snz') : ''}`;
    if (it.kind === 'thank') return `<button type="button" class="td-btn td-btn--primary" data-td-thank="${it.gi}">Thank</button>`;
    if (it.kind === 'group') return `<span class="td-count" data-flow="today-${esc(it.id)}">${it.rows.length > 99 ? '99+' : n0(it.id === 'grp:actions' ? ((S.home.work.due.overdue || 0) + (S.home.work.due.today || 0)) : it.rows.length)}</span>`;
    return '';
  }
  function row(it) {
    const open = S.open.has(it.id);
    const hit = it.kind === 'group'
      ? `<button type="button" class="td-row__hit" data-td-grp="${esc(it.id)}" aria-expanded="${open}" aria-label="${esc(it.title)}"></button>`
      : it.src && it.src.kind === 'handoff' ? `<button type="button" class="td-row__hit" data-td-handoff="${esc(it.src.id.slice(3))}" aria-label="${esc(it.title)}"></button>`
      : `<a class="td-row__hit" href="${esc(it.href || '#')}"${it.pid ? ` data-partner-id="${esc(it.pid)}"` : ''} aria-label="${esc(it.title)}"></a>`;
    const when = it.chip ? `<span class="td-when${it.late ? ' is-late' : ''}">${esc(it.chip)}</span>` : it.when ? `<span class="td-when">${esc(it.when)}</span>` : it.late ? '<span class="td-when is-late">Late</span>' : '<span class="td-when"></span>';
    const sub = it.kind === 'group' ? '' : '';
    return `<li class="td-row${it.late ? ' is-late' : ''}${it.kind === 'group' ? ' td-row--grp' : ''}${open ? ' is-open' : ''}" data-td-id="${esc(it.id)}">${hit}${chip(it.t)}<span class="td-row__t"><b>${esc(it.title)}</b>${it.sub ? `<span>${esc(it.sub)}</span>` : ''}</span>${when}<span class="td-row__a">${acts(it)}${it.kind === 'group' ? ic('chev', 'td-chev') : ''}</span>${sub}${open && it.kind === 'group' ? groupBody(it) : ''}</li>`;
  }
  function groupBody(it) {
    const rows = it.rows.map((r, i) => {
      let a = '';
      if (r.moment) a = `<a class="td-btn" href="${esc(r.moment.href)}" data-br-call="${esc(r.moment.cid)}">${esc(r.moment.step.label)}</a><button type="button" class="td-btn td-btn--quiet" data-td-dismiss="${esc(r.moment.id)}">Not now</button>`;
      else if (r.wait) {
        const w = r.wait.src;
        if (w && w.nudge) a = w.nudged ? `<span class="td-when">Nudged ${esc(ago(w.nudged))} ago</span>` : `<button type="button" class="td-btn" data-td-nudge="${esc(w.id)}" title="${esc(w.nudge.label || 'Nudge')}">Nudge</button>`;
        if (w) a += `<button type="button" class="td-x" data-td-stop="${esc(w.id)}" aria-label="Stop waiting on this" title="Stop waiting">${ic('x')}</button>`;
      } else if (r.kind === 'thank') a = `<button type="button" class="td-btn td-btn--primary" data-td-thank="${r.gi}">Thank</button>`;
      const c = r.chip ? `<span class="td-when${r.late ? ' is-late' : ''}">${esc(r.chip)}</span>` : '';
      return `<li class="td-sr"><a class="td-row__hit" href="${esc(r.href || '#')}"${r.pid ? ` data-partner-id="${esc(r.pid)}"` : ''} aria-label="${esc(r.title)}"></a><span class="td-sr__t"><b>${esc(r.title)}</b><span>${esc(r.sub || '')}</span></span>${c}<span class="td-row__a">${a}</span></li>`;
    }).join('');
    return `<ul class="td-sub">${rows}${it.more ? `<li class="td-sr td-sr--more"><a class="h-link" href="${esc(it.more.href)}">${esc(it.more.text)}</a></li>` : ''}</ul>`;
  }

  // The foot of Needs you shows only when something in it does (Show all, the quick buttons, whose partners, the Blackbaud time).
  function fitFoot() {
    const f = root.querySelector('.td-foot');
    if (!f) return;
    f.hidden = !Array.from(f.children).some((c) => !c.hidden && c.offsetParent !== null && c.textContent.trim());
    requestAnimationFrame(fitSched);
  }
  function paintNeeds() {
    const box = $('t-cards');
    if (!box) return;
    const all = items();
    S.items = all;
    const counted = all.filter((x) => x.t !== 'waiting');
    const by = {};
    all.forEach((x) => { const c = catOf(x); by[c] = (by[c] || 0) + 1; });
    const tabs = TABS.filter(([k]) => k === 'all' || by[k]);
    if (!by[S.tab] && S.tab !== 'all') S.tab = 'all';
    const tabBox = $('td-tabs');
    if (tabBox) tabBox.innerHTML = tabs.length > 2 ? tabs.map(([k, l]) => `<button type="button" role="tab" class="td-tab${S.tab === k ? ' is-on' : ''}" aria-selected="${S.tab === k}" data-td-tab="${k}">${l}${k === 'all' ? '' : ` <span>${by[k]}</span>`}</button>`).join('') : '';
    const n = $('td-needs-n');
    if (n) { n.textContent = counted.length ? n0(counted.length) : ''; n.hidden = !counted.length; }
    const shown = S.tab === 'all' ? all : all.filter((x) => catOf(x) === S.tab);
    const cut = S.all ? shown : shown.slice(0, SHOW);
    box.removeAttribute('aria-busy');
    if (!shown.length) {
      box.innerHTML = `<li class="td-clear">${ic('check')}<div><b>Nothing needs you right now.</b><span>Mentions, replies owed, approvals, tasks due and gifts to thank land here.</span></div></li>`;
    } else box.innerHTML = cut.map(row).join('');
    const more = $('td-all');
    if (more) {
      more.hidden = shown.length <= SHOW;
      more.textContent = S.all ? 'Show fewer' : `Show all ${n0(shown.length)}`;
    }
    fitFoot();
    paintStatus();
  }

  /* ================================================================ greeting and status */
  const hour = Number(et(new Date().toISOString(), { hour: 'numeric', hour12: false })) % 24;
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  function paintHello() {
    const T = S.today;
    let first = store.lget('favor.hub.first.v1', '');
    if (T) {
      const f = String((T.user && T.user.name) || '').trim().split(/\s+/)[0];
      first = f && T.user.via === 'google' ? f : '';
      if (first) store.lset('favor.hub.first.v1', first); else { try { localStorage.removeItem('favor.hub.first.v1'); } catch { /* refused */ } }
    }
    const h = $('t-hello');
    if (h) h.textContent = first ? `${part}, ${first}` : part;
  }
  function todaysEvents() {
    const g = S.day && S.day.google;
    return ((g && g.events) || []).filter((e) => !e.declined && (e.allDay ? String(e.start).slice(0, 10) <= TODAY && String(e.end || e.start).slice(0, 10) >= TODAY : dayKey(e.start) === TODAY));
  }
  function paintStatus() {
    const box = $('td-status');
    if (!box) return;
    const parts = [`<span>${esc(et(new Date().toISOString(), { weekday: 'long', month: 'long', day: 'numeric' }))}</span>`];
    if (S.items) {
      const c = S.items.filter((x) => x.t !== 'waiting').length;
      const late = S.items.filter((x) => x.late).length;
      parts.push(c ? `<a href="#t-cards" data-td-jump>${plural(c, 'thing needs you', 'things need you')}${late ? `, ${n0(late)} late` : ''}</a>` : '<span>Nothing needs you</span>');
    }
    if (S.day) {
      const left = todaysEvents().filter((e) => !e.allDay && Date.parse(e.end) > Date.now());
      const nx = left[0];
      parts.push(left.length ? `<span>${plural(left.length, 'meeting')} left today, next at ${esc(clock(nx.start))}</span>` : '<span>No more meetings today</span>');
    }
    box.innerHTML = parts.join('<i aria-hidden="true">·</i>');
  }
  function paintAway() {
    const box = $('td-away');
    if (!box) return;
    const a = S.away;
    if (!a || !a.parts || !a.parts.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.innerHTML = `<span class="td-away__l">Since you were away</span>${a.parts.map((p) => `<a href="${esc(p.href)}">${esc(p.line)}</a>`).join('')}<button type="button" class="td-x" data-td-away-x aria-label="Close">${ic('x')}</button>`;
    box.hidden = false;
  }

  /* ================================================================ schedule */
  const PV = {
    favor: ['pv-favor', P.leaf, 'FavorOS'], zoom: ['pv-zoom', P.meeting, 'Zoom'], meet: ['pv-meet', P.meeting, 'Google Meet'],
    teams: ['pv-teams', '<path d="M6 8h12"/><path d="M12 8v9"/>', 'Microsoft Teams'], webex: ['pv-webex', '<circle cx="12" cy="12" r="5"/>', 'Webex'], phone: ['pv-none', P.phone, 'Phone call'],
  };
  const mark = (p) => { const m = PV[p]; return `<span class="td-pv ${m ? m[0] : 'pv-none'}" title="${m ? m[2] : 'Calendar'}">${ic(m ? '' : 'cal').replace(P.flag, m ? m[1] : P.cal)}</span>`; };
  const ROOM = (id) => '/meet/room/?m=' + encodeURIComponent(id);
  const phoneHref = (n) => 'tel:' + String(n).replace(/[^0-9+]/g, '');
  const isLive = (e) => !e.allDay && Date.now() >= Date.parse(e.start) && Date.now() < Date.parse(e.end);
  const isOver = (e) => !e.allDay && Date.now() >= Date.parse(e.end);
  const joinOf = (e) => (e.hub ? { href: ROOM(e.hub), label: 'Join', inside: true } : e.meet ? { href: e.meet, label: 'Join', inside: false } : e.phone ? { href: phoneHref(e.phone), label: 'Call', inside: false } : null);
  const canMove = (e) => !e.hub && !!e.id && !e.allDay && !e.declined && !isOver(e) && e.provider !== 'favor';
  const evs = () => (S.day && S.day.google && S.day.google.events) || [];
  const partnerOf = (email) => ((S.day && S.day.google && S.day.google.partners) || {})[email];

  function livePill() {
    const box = $('t-now');
    if (!box) return;
    const e = todaysEvents().find((x) => isLive(x));
    const j = e && joinOf(e);
    box.innerHTML = e ? `<div class="td-live"><span class="td-live__dot" aria-hidden="true"></span><span class="td-live__t"><b>${esc(e.title)}</b><small>Live until ${esc(clock(e.end))}</small></span>${j ? `<a class="td-btn td-btn--live" href="${esc(j.href)}"${j.inside ? '' : ' target="_blank" rel="noopener"'}>Join</a>` : ''}</div>` : '';
  }
  function evRow(e) {
    const i = evs().indexOf(e);
    const live = isLive(e);
    const over = isOver(e);
    const people = (e.people || []).map(partnerOf).filter(Boolean);
    // A partner on the meeting is a chip that opens the partner card (FavorEntity), never a bare name.
    const chipOf = (p) => (window.FavorEntity ? window.FavorEntity.chip('partner', p.id, p.name) : `<a href="/work/partner/${esc(p.id)}" data-partner-id="${esc(p.id)}">${esc(p.name)}</a>`);
    const sub = [esc(e.source || (PV[e.provider] && PV[e.provider][2]) || ''), people.length ? people.slice(0, 2).map(chipOf).join(', ') : (e.people || []).length ? plural(e.people.length, 'guest') : ''].filter(Boolean).join(' · ');
    const j = !over ? joinOf(e) : null;
    const a = [];
    if (j && (live || Date.parse(e.start) - Date.now() < 15 * 60000)) a.push(`<a class="td-btn${live ? ' td-btn--primary' : ''}" href="${esc(j.href)}"${j.inside ? '' : ' target="_blank" rel="noopener"'}>${j.label}</a>`);
    else if (canMove(e)) a.push(`<button type="button" class="td-btn td-btn--quiet" data-move="${i}">Move to FavorOS</button>`);
    const hit = e.hub ? `<a class="td-row__hit" href="${ROOM(e.hub)}" aria-label="${esc(e.title)}"></a>` : `<button type="button" class="td-row__hit" data-ev="${i}" aria-haspopup="dialog" aria-label="${esc(e.title)}"></button>`;
    return `<li class="td-evr${live ? ' is-live' : ''}${over ? ' is-over' : ''}">${hit}<span class="td-evr__time">${live ? 'Now' : e.allDay ? 'All day' : esc(clock(e.start))}</span>${mark(e.provider)}<span class="td-evr__t"><b>${esc(e.title)}</b><span>${sub}</span></span><span class="td-row__a">${a.join('')}</span></li>`;
  }
  function paintSched() {
    const box = $('td-sched-list');
    if (!box) return;
    if (!S.day) return;
    box.removeAttribute('aria-busy');
    const g = S.day.google || {};
    const list = todaysEvents().sort((a, b) => (a.allDay ? -1 : 0) - (b.allDay ? -1 : 0) || Date.parse(a.start) - Date.parse(b.start));
    const past = list.filter(isOver);
    const rest = list.filter((e) => !isOver(e));
    let html = '';
    if (past.length) {
      html += S.pastOpen || !rest.length ? past.map(evRow).join('') : `<li class="td-evr td-evr--earlier"><button type="button" class="td-row__hit" data-td-past aria-label="Show earlier meetings"></button><span class="td-evr__time">Earlier</span><span class="td-pv" aria-hidden="true">${ic('clock')}</span><span class="td-evr__t"><span>${plural(past.length, 'earlier meeting')}</span></span></li>`;
    }
    html += rest.map(evRow).join('');
    if (!list.length) html += `<li class="td-empty">${g.events === null ? 'Your calendar could not be read just now.' : 'Nothing on your calendar today.'}</li>`;
    else if (!rest.length) html += '<li class="td-empty">No more meetings today.</li>';
    // Coming up: the next days' meetings fill the room the card has left (fitSched drops the ones that do not fit).
    const soon = evs().filter((e) => !e.declined && !e.allDay && dayKey(e.start) > TODAY && Date.parse(e.start) - Date.now() < 8 * 864e5).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    if (S.next && !soon.some((e) => e.hub && e.hub === S.next.id)) soon.push({ title: S.next.title, start: S.next.startsAt, end: S.next.endsAt || S.next.startsAt, hub: S.next.id, provider: 'favor', source: 'FavorOS', prep: true, people: [] });
    soon.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    if (soon.length) {
      html += '<li class="td-evh" data-soon>Coming up</li>' + soon.slice(0, 8).map((e) => `<li class="td-evr td-evr--next" data-soon><a class="td-row__hit" href="${e.hub ? (e.prep ? '/meet/prep/?m=' + encodeURIComponent(e.hub) : ROOM(e.hub)) : '/meet/'}" aria-label="${esc(e.title)}"></a><span class="td-evr__time">${esc(et(e.start, { weekday: 'short' }))}<small>${esc(clock(e.start))}</small></span>${mark(e.provider)}<span class="td-evr__t"><b>${esc(e.title)}</b><span>${esc(e.source || (PV[e.provider] && PV[e.provider][2]) || '')}</span></span></li>`).join('');
    }
    if (!g.connected) html += `<li class="td-connect"><span>Connect Google to see your calendar here.</span><a class="td-btn" href="/api/google/connect">Connect my Google</a></li>`;
    const outside = list.filter(canMove).length;
    box.innerHTML = html;
    fitSched();
    const foot = $('td-sched-f');
    if (foot) { foot.textContent = outside ? `${plural(outside, 'meeting')} held outside FavorOS. Open one to move it.` : ''; foot.hidden = !outside; }
    livePill();
    paintStatus();
  }

  // The schedule card is as tall as Needs you beside it: Coming up rows that would run past its bottom come off, the last first.
  function fitSched() {
    const box = $('td-sched-list');
    if (!box || getComputedStyle(box).overflow !== 'hidden') return;
    // The row is never shorter than today's meetings need, so none of them is cut off when Needs you is short.
    const card = $('td-sched');
    const main = root.querySelector('.td-main');
    if (card && main) {
      let need = 0;
      for (const el of card.children) if (el !== box && !el.hidden) need += el.offsetHeight;
      for (const li of box.children) if (!li.hasAttribute('data-soon')) need += li.offsetHeight;
      main.style.setProperty('--sched-min', Math.ceil(need + 2) + 'px');
    }
    box.querySelectorAll('[data-soon]').forEach((x) => { x.hidden = false; });
    const soon = Array.from(box.querySelectorAll('.td-evr[data-soon]'));
    while (soon.length && box.scrollHeight > box.clientHeight + 1) soon.pop().hidden = true;
    const head = box.querySelector('.td-evh[data-soon]');
    if (head) head.hidden = !box.querySelector('.td-evr[data-soon]:not([hidden])');
  }
  if (window.ResizeObserver) { let rt = 0; new ResizeObserver(() => { cancelAnimationFrame(rt); rt = requestAnimationFrame(fitSched); }).observe(root.querySelector('.td-needs') || root); }

  /* ---------------------------------------------------------------- the meeting sheets (one at a time) */
  let layer = null; let layerTok = null; let pending = null; let lastFocus = null;
  const closeLayer = (fromBack) => {
    if (!layer) return;
    const l = layer; layer = null;
    l.classList.remove('is-in');
    setTimeout(() => l.remove(), 160);
    document.removeEventListener('keydown', onKey, true);
    if (layerTok && window.hubOv && !fromBack) window.hubOv.off(layerTok);
    layerTok = null;
    if (pending) { S.day = pending; pending = null; store.set('favor.hub.day.v2', S.day); paintSched(); }
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  };
  const onKey = (e) => {
    if (!layer) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLayer(); return; }
    if (e.key !== 'Tab') return;
    const f = Array.from(layer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled])')).filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  };
  const openLayer = (label, html) => {
    if (layer) { layer.remove(); layer = null; } else lastFocus = document.activeElement;
    const l = document.createElement('div');
    l.className = 't2-layer';
    l.innerHTML = `<div class="t2-scrim" data-t2-close></div><div class="t2-sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}"><div class="t2-grab" aria-hidden="true"></div>${html}</div>`;
    document.body.appendChild(l);
    layer = l;
    l.addEventListener('click', onLayerClick);
    if (!layerTok && window.hubOv) layerTok = window.hubOv.on(() => closeLayer(true));
    document.addEventListener('keydown', onKey, true);
    requestAnimationFrame(() => { l.classList.add('is-in'); const f = l.querySelector('[data-t2-first]'); if (f && !matchMedia('(pointer: coarse)').matches) f.focus({ preventScroll: true }); });
    return l;
  };
  const onLayerClick = (ev) => {
    if (ev.target.closest('[data-t2-close]')) { ev.preventDefault(); closeLayer(); return; }
    const mv = ev.target.closest('[data-move]'); if (mv) { ev.preventDefault(); moveSheet(Number(mv.dataset.move)); return; }
    const back = ev.target.closest('[data-ev]'); if (back) { ev.preventDefault(); eventSheet(Number(back.dataset.ev)); }
  };
  const whenLine = (e) => et(e.start, { weekday: 'long', month: 'short', day: 'numeric' }) + ', ' + clock(e.start) + ' to ' + clock(e.end) + ' ET';
  const closeBtn = `<button type="button" class="t2-x" data-t2-close aria-label="Close">${ic('x')}</button>`;
  const partnerLink = (email) => { const p = partnerOf(email); return p ? `<a class="r2t-chip r2t-chip--plain" href="/work/partner/${esc(p.id)}" title="Partner page">${esc(p.name)}</a>` : ''; };
  function eventSheet(i) {
    const e = evs()[i];
    if (!e) return;
    const j = !e.declined && !isOver(e) ? joinOf(e) : null;
    const n = (e.people || []).length;
    const partners = (e.people || []).map(partnerLink).filter(Boolean).join('');
    openLayer(e.title,
      `<div class="t2-h">${mark(e.provider)}<div><h3>${esc(e.title)}</h3><p>${e.allDay ? 'All day' : esc(whenLine(e))}</p></div>${closeBtn}</div>` +
      `<dl class="t2-facts"><div><dt>Held on</dt><dd>${esc(e.source || 'Meeting')}${e.declined ? ', declined' : ''}</dd></div><div><dt>With</dt><dd>${n ? plural(n, 'person', 'people') : 'Only you'}</dd></div>` +
      (partners ? `<div><dt>Partners</dt><dd class="t2-chips">${partners}</dd></div>` : '') + '</dl>' +
      `<div class="t2-acts">${j ? `<a class="h-btn h-btn--primary" data-t2-first href="${esc(j.href)}" target="_blank" rel="noopener">${j.label}</a>` : ''}${canMove(e) ? `<button type="button" class="h-btn ${j ? 'h-btn--ghost' : 'h-btn--primary'}" data-move="${i}"${j ? '' : ' data-t2-first'}>Move to FavorOS</button>` : ''}</div>` +
      (e.link ? `<a class="t2-sec" href="${esc(e.link)}" target="_blank" rel="noopener">Open in Google Calendar</a>` : ''));
  }
  function moveSheet(i) {
    const e = evs()[i];
    if (!e) return;
    const g = (S.day && S.day.google) || {};
    const n = (e.people || []).length;
    let write = '';
    if (!e.canEdit) write = '<p class="t2-note">Someone else organizes this event, so Google does not let you change it. The FavorOS meeting is made and the calendar event keeps its video link. The organizer has to add the FavorOS link.</p>';
    else if (!g.mayWrite) write = '<p class="t2-note">To put the FavorOS link on the calendar event, FavorOS needs your permission to edit your calendar events.</p><a class="h-btn h-btn--ghost h-btn--sm" href="/api/google/connect?add=meetings&amp;next=%2F">Allow calendar edits</a>';
    const l = openLayer('Move to FavorOS',
      `<div class="t2-h"><div><h3>Move to FavorOS</h3><p>${esc(e.title)}</p></div>${closeBtn}</div><ul class="t2-list">` +
      `<li>Makes a FavorOS meeting on ${esc(whenLine(e))}.</li><li>${n ? `Invites the same ${plural(n, 'person', 'people')} in FavorOS. FavorOS sends no email.` : 'Only you are on it.'}</li>` +
      '<li>It is not recorded. The host can change that in the meeting.</li>' +
      `<li>${e.canEdit ? 'Your calendar event gets the FavorOS link in its location and at the top of its notes, and the old video link comes off.' : 'Your calendar event is not changed.'}</li></ul>` + write +
      `<p class="t2-err" id="t2-err" role="alert" hidden></p><div class="t2-acts"><button type="button" class="h-btn h-btn--primary" id="t2-go" data-t2-first>Move to FavorOS</button><button type="button" class="h-btn h-btn--ghost" data-ev="${i}">Back</button></div>`);
    l.querySelector('#t2-go').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      const err = l.querySelector('#t2-err');
      btn.disabled = true; btn.textContent = 'Moving'; err.hidden = true;
      try {
        const res = await fetch('/api/hub/day-move', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'X-Hub-Request': '1' }, body: JSON.stringify({ eventId: e.id }) });
        const d = await res.json().catch(() => ({}));
        if (res.status === 409 && d.error === 'already' && d.id) { e.hub = d.id; store.set('favor.hub.day.v2', S.day); paintSched(); closeLayer(); return; }
        if (!res.ok || d.ok === false) throw new Error(d.message || 'Could not move it. Try again.');
        e.hub = d.id; e.source = 'FavorOS'; e.provider = 'favor';
        store.set('favor.hub.day.v2', S.day); paintSched();
        openLayer('Moved to FavorOS',
          `<div class="t2-h"><div><h3>Moved to FavorOS</h3><p>${esc(e.title)}</p></div>${closeBtn}</div><ul class="t2-list"><li>${esc(whenLine(e))}.</li><li>${d.linked ? 'The FavorOS link is on your calendar event.' : d.created ? `A new event with the FavorOS link is on your calendar${d.invited ? `, and Google invited ${plural(d.invited, 'person', 'people')} to it` : ''}.` : 'No calendar has this meeting yet.'}</li>${d.created && d.organizer && d.organizer.email ? `<li>The original event from ${esc(d.organizer.name || d.organizer.email)} is still on calendars. The organizer can delete it.</li>` : ''}</ul>` +
          (d.linkError ? `<p class="t2-note">${esc(d.linkError)}</p>` : '') + `<div class="t2-acts"><a class="h-btn h-btn--primary" data-t2-first href="${esc(d.room)}">Open the meeting</a><button type="button" class="h-btn h-btn--ghost" data-t2-close>Done</button></div>`);
      } catch (x) { err.textContent = x.message; err.hidden = false; btn.disabled = false; btn.textContent = 'Move to FavorOS'; }
    });
  }

  /* ================================================================ How Favor is doing */
  const SLICE_OF = { rdd: 'rdds', pc: 'pc', ce: 'ce', mk: 'marketing' };
  function paintDoing() {
    const wrap = $('t-year-wrap');
    const box = $('t-year');
    if (!wrap || !box) return;
    const T = S.today;
    const k = S.kpi;
    const b = S.brief;
    const cells = [];
    if (k) {
      const pct = k.goal ? (k.raised / k.goal) * 100 : 0;
      let delta = '';
      if (k.raisedLastYear) { const d = ((k.raised - k.raisedLastYear) / k.raisedLastYear) * 100; delta = `<span class="td-delta ${d >= 0 ? 'is-up' : 'is-down'}">${d >= 0 ? '+' : ''}${d.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% vs. this day last year</span>`; }
      const p = k.pace && k.pace.year;
      const est = (v) => (window.FavorUI ? window.FavorUI.short(v) : compact(v));
      const pace = p && p.goal ? `<button type="button" class="td-pace is-${esc(p.status)}" data-drill="explain:year" data-drill-label="Raised so far this year" data-drill-value="${Number(k.raised) || 0}" data-drill-shown-label="Raised so far this year">${p.status === 'ahead' ? 'On pace to pass the goal' : p.status === 'close' ? 'Close to goal pace' : 'Behind goal pace'}: ${p.projectedLow === p.projectedHigh ? 'about ' + est(p.projectedHigh) : est(p.projectedLow) + ' to ' + est(p.projectedHigh)} at year end</button>` : '';
      cells.push(`<div class="td-dc td-dc--raised"><span class="td-lab">Raised this year</span><b class="td-hero" data-countup data-drill="year" data-drill-label="Raised so far this year" data-drill-value="${Number(k.raised) || 0}" data-drill-def="Which gifts count|Whose gift it is">${money0(k.raised)}</b><span class="td-bar td-bar--lg"><i style="width:${Math.min(100, pct).toFixed(1)}%"></i></span><span class="td-goal">${pct.toFixed(1)}% of the ${money0(k.goal)} goal</span>${delta}${pace}</div>`);
      const teams = (k.teams || []).map((t) => {
        const tp = t.goal ? (t.amount / t.goal) * 100 : 0;
        const slice = SLICE_OF[t.key];
        const amt = slice && t.measure !== 'awarded'
          ? `<span data-drill="slice:${slice}" data-drill-label="${esc(t.name)}, this year" data-drill-value="${Number(t.amount) || 0}" data-drill-def="Team revenue">${compact(t.amount)}</span>`
          : t.measure === 'awarded' ? `<span data-drill="explain:${esc(t.key)}" data-drill-label="${esc(t.name)}, awarded this year" data-drill-value="${Number(t.amount) || 0}" data-drill-shown-label="Awarded this year">${compact(t.amount)}</span>` : compact(t.amount);
        return `<div class="td-goalrow"><span class="td-goalrow__n">${esc(String(t.name).replace(/ team$/i, ''))}</span><span class="td-goalrow__p">${Math.round(tp)}%</span><span class="td-bar"><i style="width:${Math.min(100, tp).toFixed(1)}%"></i></span><span class="td-goalrow__a">${amt} of ${compact(t.goal)}${t.measure === 'awarded' ? ' awarded' : ''}</span></div>`;
      }).join('');
      if (teams) cells.push(`<div class="td-dc td-dc--teams"><span class="td-lab">Team goals</span><div class="td-teams">${teams}</div></div>`);
    }
    const o = b && b.overnight;
    const th = S.thanks || [];
    if (o || th.length) {
      const late = th.filter((x) => x.late).length;
      cells.push(`<div class="td-dc td-dc--gifts"><span class="td-lab">New gifts${b && b.since ? ' since ' + esc(et(b.since + 'T12:00:00Z', { weekday: 'long' })) : ''}${b && b.partners && S.owner ? '' : ''}</span>` +
        `<a class="td-big" href="/work/?view=gifts"><b data-flow="today-newgifts">${n0(o ? o.count : 0)}</b><span>${o && o.count ? money0(o.total) : 'None yet'}</span></a>` +
        `<a class="td-mini" href="/work/?view=gifts">${th.length ? `${plural(th.length, 'gift')} to thank${late ? `, <em>${n0(late)} overdue</em>` : ''}` : 'Every gift thanked'}</a></div>`);
    }
    // Until the sources it waits on have answered, the card keeps its placeholders rather than drawing and then hiding.
    const ready = !!T && (!(T.access && T.access.kpi) || !!k || S.kpiDone) && S.briefDone;
    if (!cells.length && !ready) return;
    box.innerHTML = cells.join('');
    box.dataset.n = String(cells.length);
    box.removeAttribute('aria-busy');
    const fresh = $('t-fresh');
    if (fresh) fresh.textContent = k && k.lastUpdated ? `Raiser's Edge as of ${clock(k.lastUpdated)}` : '';
    const link = $('td-kpi-link');
    if (link) link.hidden = !k;
    wrap.hidden = !cells.length;
    // A card hidden on purpose lets go of the room hub-motion held for it (it would otherwise show a placeholder while it holds).
    if (wrap.hidden && wrap.__kh && window.hubMotion && window.hubMotion.letGo) window.hubMotion.letGo(wrap);
    if (T && !(T.access && T.access.kpi)) wrap.classList.add('is-nokpi');
  }

  /* ================================================================ What changed and Shared with you */
  const FEED_FIRST = 6;
  const APPICON = { expenses: 'expense', receipts: 'mail', requests: 'request', meetings: 'meeting', projects: 'task', tasks: 'task', chat: 'chat', feedback: 'note', learn: 'learn' };
  function paintFeed() {
    const box = $('t-feed');
    if (!box || !S.today) return;
    const list = S.today.activity || [];
    const cut = S.feedAll ? list : list.slice(0, FEED_FIRST);
    let last = '';
    const yest = dayKey(new Date(Date.now() - 864e5).toISOString());
    box.innerHTML = list.length ? cut.map((a) => {
      const k = dayKey(a.at);
      const g = k !== last ? `<li class="td-fg">${k === TODAY ? 'Today' : k === yest ? 'Yesterday' : esc(et(a.at, { weekday: 'long', month: 'short', day: 'numeric' }))}</li>` : '';
      last = k;
      const inner = `${ic(APPICON[String(a.app || '').toLowerCase()] || 'flag', 'td-fi')}<span>${esc(a.text)}</span><time>${esc(clock(a.at))}</time>`;
      return g + `<li class="td-fr">${a.href ? `<a href="${esc(a.href)}">${inner}</a>` : `<div>${inner}</div>`}</li>`;
    }).join('') : '<li class="td-empty">Nothing in the last two weeks.</li>';
    const more = $('t-feed-more');
    if (more) { more.hidden = list.length <= FEED_FIRST; more.textContent = S.feedAll ? 'Show fewer' : `Show ${n0(list.length - FEED_FIRST)} more`; }
  }
  function paintFiles() {
    const card = $('td-files');
    const box = $('td-files-list');
    if (!card || !box) return;
    const files = (S.day && S.day.google && S.day.google.files) || [];
    card.hidden = !files.length;
    box.innerHTML = files.slice(0, 6).map((f, i) => `<li class="td-fr"><button type="button" data-file="${i}">${ic('doc', 'td-fi')}<span><b>${esc(f.name)}</b><small>${esc([f.by, ago(f.modified) + (ago(f.modified) === 'now' ? '' : ' ago')].filter(Boolean).join(' · '))}</small></span></button></li>`).join('');
  }
  const fileItem = (f) => {
    const m = String(f.mime || '');
    const enc = encodeURIComponent(f.id);
    const base = '/api/hub/day-file?id=' + enc;
    const common = { name: f.name, sub: f.by ? 'Shared by ' + f.by : 'Google Drive', external: f.link, externalShort: 'Drive', externalLabel: 'Open in Google Drive' };
    if (/^image\//.test(m)) return Object.assign({ kind: 'image', url: base + '&v=thumb&s=2000', download: '' }, common);
    return Object.assign({ kind: 'drive', url: base + '&v=content', page: base + '&v=thumb&s=1600', embed: /folder$/.test(m) ? '' : 'https://drive.google.com/file/d/' + enc + '/preview' }, common);
  };
  let viewTok = null;
  function openFile(i) {
    const f = ((S.day && S.day.google && S.day.google.files) || [])[i];
    if (!f) return;
    const V = window.FavorChatView;
    if (!V) { location.href = f.link; return; }
    V.onClose = () => { if (viewTok && window.hubOv) { const t = viewTok; viewTok = null; window.hubOv.off(t); } };
    V.open(fileItem(f));
    if (window.hubOv) { if (viewTok) window.hubOv.off(viewTok); viewTok = window.hubOv.on(() => { viewTok = null; V.close(); }); }
  }

  /* ================================================================ painting, batched */
  let raf = 0;
  const paint = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      paintHello();
      if (S.settled) paintNeeds();
      paintSched();
      paintDoing();
      paintFeed();
      paintFiles();
      paintAway();
      paintStatus();
    });
  };

  /* ================================================================ actions */
  const toast = (msg, undo) => {
    const I = window.FavorTodayInbox;
    if (I && I.toast) I.toast(msg, undo);
  };
  function gone(id) {
    const li = root.querySelector(`[data-td-id="${window.CSS && CSS.escape ? CSS.escape(id) : id}"]`);
    S.gone.add(id);
    if (li) { li.classList.add('is-gone'); setTimeout(paintNeeds, 180); } else paintNeeds();
  }
  root.addEventListener('click', (e) => {
    const t = e.target;
    if (!t.closest) return;
    const tab = t.closest('[data-td-tab]');
    if (tab) { S.tab = tab.dataset.tdTab; S.all = false; paintNeeds(); return; }
    if (t.closest('#td-all')) { S.all = !S.all; paintNeeds(); return; }
    const grp = t.closest('[data-td-grp]');
    if (grp) { const id = grp.dataset.tdGrp; if (S.open.has(id)) S.open.delete(id); else S.open.add(id); paintNeeds(); return; }
    const I = window.FavorTodayInbox;
    const cl = t.closest('[data-td-clear]');
    if (cl && I) {
      e.preventDefault();
      const id = cl.dataset.tdClear;
      cl.disabled = true;
      I.clear(id).then(() => {
        gone(id);
        const undoable = /^(chat|tn|mm|hp|mail|star):/.test(id);
        toast('Cleared.', undoable ? () => I.unclear(id).then(() => { S.gone.delete(id); paintNeeds(); }).catch((x) => toast(x.message)) : null);
      }).catch((x) => { cl.disabled = false; toast(x.message); });
      return;
    }
    const st = t.closest('[data-td-stop]');
    if (st && I) {
      e.preventDefault();
      const id = st.dataset.tdStop;
      I.stop(id).then(() => { gone(id); toast('Off the list.', () => I.unstop(id).then(() => { S.gone.delete(id); paintNeeds(); }).catch((x) => toast(x.message))); }).catch((x) => toast(x.message));
      return;
    }
    const nd = t.closest('[data-td-nudge]');
    if (nd && I) {
      e.preventDefault();
      const id = nd.dataset.tdNudge;
      const it = [].concat(S.waiting.fast || [], S.waiting.mail || []).find((x) => x.id === id);
      if (it) I.nudge(it, () => { store.set('favor.td.waiting.v1', S.waiting); paintNeeds(); });
      return;
    }
    const ho = t.closest('[data-td-handoff]');
    if (ho && I) { e.preventDefault(); I.openHandoff(ho.dataset.tdHandoff); return; }
    const thk = t.closest('[data-td-thank]');
    if (thk) {
      e.preventDefault();
      const x = (S.thanks || [])[Number(thk.dataset.tdThank)];
      if (!x) return;
      if (!window.FavorWG || !window.FavorWG.pop) { location.href = '/work/?view=gifts'; return; }
      const g = x.g;
      window.FavorWG.pop(thk, { giftId: g.giftId, cid: g.cid, name: g.name, amount: g.amount, date: g.date, fund: g.fund, phone: g.phone, left: g.left, tasks: g.tasks, team: g.team }, { owner: g.owner, done: () => { gone('gift:' + g.giftId); setTimeout(() => { loadBrief(true); loadGifts(); }, 1500); } });
      return;
    }
    const call = t.closest('[data-br-call]');
    if (call && window.FavorCall && !e.metaKey && !e.ctrlKey) { e.preventDefault(); window.FavorCall.open(call.dataset.brCall); return; }
    const dm = t.closest('[data-td-dismiss]');
    if (dm) {
      e.preventDefault();
      const id = dm.dataset.tdDismiss;
      const until = new Date(Date.now() + 14 * 864e5).toLocaleDateString('en-CA', { timeZone: TZ });
      S.gone.add('moment:' + id); paintNeeds();
      post('/api/hub/snooze', { key: 'moment:' + id, until }).catch(() => {});
      return;
    }
    if (t.closest('[data-td-away-x]')) { S.away = null; paintAway(); post('/api/brief/seen', {}).catch(() => {}); return; }
    if (t.closest('[data-td-past]')) { S.pastOpen = true; paintSched(); return; }
    if (t.closest('#t-feed-more')) { S.feedAll = !S.feedAll; paintFeed(); return; }
    if (t.closest('#td-team-all')) { teamAll = !teamAll; fitTeam(); return; }
    const mv = t.closest('[data-move]'); if (mv) { e.preventDefault(); moveSheet(Number(mv.dataset.move)); return; }
    const ev = t.closest('[data-ev]'); if (ev) { e.preventDefault(); eventSheet(Number(ev.dataset.ev)); return; }
    const fl = t.closest('[data-file]'); if (fl) { e.preventDefault(); openFile(Number(fl.dataset.file)); return; }
    const jump = t.closest('[data-td-jump]');
    if (jump) { e.preventDefault(); const c = $('td-needs'); if (c && c.scrollIntoView) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  root.addEventListener('change', (e) => {
    if (!e.target.matches || !e.target.matches('[data-td-owner]')) return;
    S.owner = e.target.value; store.lset('favor.hub.brief.owner', S.owner); loadBrief(false);
  });
  function paintScope() {
    const box = $('td-scope');
    const b = S.brief;
    if (!box) return;
    const ds = (b && b.directors) || [];
    if (!b || !b.partners || ds.length < 1) { box.innerHTML = ''; return; }
    const own = ds.find((d) => d.fid === b.me);
    const opts = [...(own ? [] : [['', 'All partners']]), ...ds.map((d) => [d.fid, d.fid === b.me ? 'My partners' : d.name])];
    if (opts.length < 2) { box.innerHTML = ''; return; }
    const cur = S.owner || b.owner || '';
    box.innerHTML = `<label class="td-scope"><span class="sr-only">Whose partners</span><select data-td-owner>${opts.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  }

  /* ================================================================ loading */
  function loadToday() {
    const apply = (d) => { S.today = d; paint(); if (d.access && d.access.kpi && !S.kpiAsked) { S.kpiAsked = true; loadKpi(); } };
    if (window.FavorData) {
      return new Promise((resolve) => window.FavorData.watch('today', '/api/hub/today', { stale: 20000 }, (d, meta) => { if (!meta.error) apply(d); resolve(); }));
    }
    const hit = store.get('favor.hub.today.v1');
    if (hit && hit.ok) apply(hit);
    return get('/api/hub/today').then((d) => { store.set('favor.hub.today.v1', d); apply(d); }).catch(() => {});
  }
  function loadKpi() {
    const apply = (k) => { S.kpiDone = true; if (k && k.summary) S.kpi = k.summary; paint(); };
    if (window.FavorData) { window.FavorData.watch('kpi', '/api/hub/kpi', { stale: 120000 }, (d, meta) => { if (!meta.error) apply(d); else { S.kpiDone = true; paint(); } }); return; }
    const hit = store.get('favor.hub.kpi.v1'); if (hit) apply(hit);
    get('/api/hub/kpi').then((d) => { store.set('favor.hub.kpi.v1', d); apply(d); }).catch(() => { S.kpiDone = true; paint(); });
  }
  function loadList(name) {
    const key = name === 'inbox' ? 'favor.td.inbox.v1' : 'favor.td.waiting.v1';
    const path = '/api/today/' + name;
    const box = S[name];
    const fast = get(path + '?part=fast').then((d) => { box.fast = d.items || []; }).catch((e) => { if (box.fast === null) box.fast = []; if (e.status === 401 || e.status === 403) box.fast = []; });
    const mail = get(path + '?part=mail').then((d) => { if (d.slow && box.mail) return; box.mail = d.items || []; }).catch(() => { if (box.mail === null) box.mail = []; });
    fast.then(() => { store.set(key, box); paint(); });
    mail.then(() => { store.set(key, box); paint(); });
    return fast;
  }
  function loadGifts() {
    return get('/api/today/gifts').then((d) => { if (d.slow && S.gifts) return; S.gifts = { gifts: d.gifts || [], owed: d.owed || 0 }; store.set('favor.today.gifts.v1', S.gifts); paint(); }).catch(() => { if (!S.gifts) S.gifts = { gifts: [] }; });
  }
  async function loadBrief(fresh) {
    try {
      const q = [S.owner ? 'owner=' + encodeURIComponent(S.owner) : '', fresh ? 'fresh=1' : ''].filter(Boolean).join('&');
      const d = await get('/api/brief/today' + (q ? '?' + q : ''));
      if (d.stale && !fresh) { const ok = await loadBrief(true); if (ok) return true; }
      S.brief = d.briefing || null;
      if (d.away) S.away = d.away;
      store.set('favor.td.brief.v1', { brief: S.brief, owner: S.owner });
      S.briefDone = true;
      paintScope();
      paint();
      return true;
    } catch { S.briefDone = true; paint(); return false; }
  }
  function loadDay() {
    return get('/api/hub/day').then((d) => {
      if (layer) { pending = d; return; }
      S.day = d; store.set('favor.hub.day.v2', d);
      window.__hubDay = d; document.dispatchEvent(new CustomEvent('hub:day', { detail: d }));
      paint();
    }).catch(() => { if (!S.day) { const box = $('td-sched-list'); if (box) { box.removeAttribute('aria-busy'); box.innerHTML = '<li class="td-empty">Your day could not load. Refresh to try again.</li>'; } } });
  }
  function loadNext() {
    try { const nv = JSON.parse(localStorage.getItem('favor.hub.nav.v1') || 'null'); if (nv && nv.access && nv.access.meetings === false) return; } catch { /* no saved menu */ }
    get('/api/meet/meetings?scope=upcoming').then((d) => {
      const now = Date.now();
      const list = (d.meetings || []).filter((m) => m.status !== 'cancelled' && m.status !== 'ended' && m.startsAt && Date.parse(m.endsAt || m.startsAt) > now && Date.parse(m.startsAt) - now < 8 * 864e5 && dayKey(m.startsAt) !== TODAY);
      list.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
      S.next = list[0] || null;
      paint();
    }).catch(() => {});
  }

  // What this tab saw last paints at once.
  { const c = store.get('favor.td.brief.v1'); if (c && c.owner === S.owner) S.brief = c.brief; }
  const cached = S.inbox.fast !== null && S.waiting.fast !== null;
  if (cached) S.settled = true;
  // The ranked list draws once its main sources are in (or after 1.5 s), so rows do not shuffle while they arrive.
  const core = Promise.all([loadToday(), loadList('inbox'), loadList('waiting'), loadBrief(false), loadGifts()]);
  Promise.race([core, new Promise((r) => setTimeout(r, 1500))]).then(() => { S.settled = true; paint(); });
  loadDay();
  loadNext();
  document.addEventListener('wh:data', (e) => { if (!root.isConnected) return; S.home = e.detail; paint(); requestAnimationFrame(() => { fitTeam(); fitFoot(); }); });
  if (S.home) requestAnimationFrame(fitTeam);
  // A sort press redraws the table: keep the five-row fold.
  new MutationObserver(() => fitTeam()).observe($('wh-team-table') || document.createElement('i'), { childList: true });
  document.addEventListener('hub:snoozed', (e) => { if (!root.isConnected || !e.detail || e.detail.kind !== 'hub') return; if (window.FavorData) window.FavorData.invalidate('today'); else loadToday(); });
  document.addEventListener('favor-handoff', () => { if (root.isConnected) loadList('inbox'); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && root.isConnected) { loadList('inbox'); loadList('waiting'); } });
  { const g = new URLSearchParams(location.search).get('google'); const notes = { connected: 'Your meetings, files and mail now show here.', declined: 'Google was not connected.', 'wrong-account': 'Pick your Favor account when Google asks.', failed: 'Google did not connect. Try again.', expired: 'That took too long. Try again.', 'no-token': 'Google did not hand back access. Try again.' };
    if (g && notes[g]) { const m = $('d-sub'); if (m) { m.textContent = notes[g]; m.hidden = false; } history.replaceState(null, '', '/'); } }
  { const q = new URLSearchParams(location.search).get('handoff');
    if (q && /^ho_[a-z0-9]{6,20}$/.test(q)) { try { const u = new URL(location.href); u.searchParams.delete('handoff'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch { /* old browser */ } const go = () => window.FavorTodayInbox && window.FavorTodayInbox.openHandoff(q); setTimeout(go, 400); } }
  paint();
})();
