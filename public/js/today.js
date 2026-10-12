/* Today: what is waiting on the person signed in, the year against goal (leadership), their own
   requests, and recent activity. Runs the moment it loads, so a page swapped in place works too. */
(() => {
  const $ = (id) => document.getElementById(id);
  if (!$('t-cards')) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const neg = (n) => (Number(n) < 0 ? '-' : '');
  const money0 = (n) => neg(Math.round(Number(n) || 0)) + '$' + Math.abs(Math.round(Number(n) || 0)).toLocaleString('en-US');
  const money2 = (n) => neg(n) + '$' + Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const compact = (v) => { const n = Number(v) || 0, a = Math.abs(n), s = n < 0 ? '-' : ''; return a >= 1e9 ? s + '$' + (a / 1e9).toFixed(2) + 'B' : a >= 999500 ? s + '$' + (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? s + '$' + Math.round(a / 1e3) + 'K' : s + '$' + Math.round(a); };
  const et = (iso, opts) => new Date(iso).toLocaleString('en-US', Object.assign({ timeZone: 'America/New_York' }, opts));
  const clock = (iso) => et(iso, { hour: 'numeric', minute: '2-digit' });
  const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  const ICON = {
    meetings: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
    requests: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
    tasks: '<path d="M4 12 20 4l-4 16-4-6z"/><path d="m12 14 8-10"/>',
    'tasks-waiting': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    'tasks-news': '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
    expenses: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6"/><path d="M9 11h6"/><path d="M9 15h4"/>',
    receipts: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    feedback: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8"/><path d="M8 12h5"/>',
    learn: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21a2 2 0 0 1 2-2h13v2"/><path d="M8 7h7"/><path d="M8 11h5"/>',
    foundations: '<path d="M3 21h18"/><path d="M5 21V10"/><path d="M19 21V10"/><path d="M9 21V10"/><path d="M15 21V10"/><path d="m2 10 10-6 10 6z"/>',
    'projects-due': '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12.5 2.5 2.5 4.5-5.5"/>',
    'projects-assigned': '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    'projects-news': '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h8"/>',
    dot: '<circle cx="12" cy="12" r="3"/>',
    arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  };
  // Favor Brain shows its own mark, the ring of light (styles in src/styles/round2.css, .fbr).
  const icon = (n) => n === 'brain' ? '<span class="fbr" data-state="still" aria-hidden="true"><i class="fbr__halo"></i><i class="fbr__in"><i class="fbr__lit"></i><i class="fbr__rg"></i><i class="fbr__cm"></i></i></span>' : `<svg class="h-i" viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ICON.dot}</svg>`;
  // Each tool keeps one color: tile tint and ink come from the shared tool tokens.
  const TOOL = { requests: 'sky', 'projects-due': 'leaf', 'projects-assigned': 'leaf', 'projects-news': 'leaf', tasks: 'sky', 'tasks-waiting': 'sun', 'tasks-news': 'sky', expenses: 'sky', receipts: 'sky', brain: 'dusk', meetings: 'teal', feedback: 'sun', foundations: 'leaf', learn: 'sun' };
  const tool = (id) => TOOL[String(id || '').toLowerCase()] || 'slate';

  // Show what this tab last saw at once, then refresh it, so a page change never starts from empty.
  // Kept per tab (sessionStorage); the hub clears it on sign out.
  const swr = (key, url, apply, bad) => {
    try {
      const hit = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (hit) apply(hit);
    } catch {
      // storage refused or the copy is unreadable; the fetch below still runs
    }
    return fetch(url, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => {
        if (!d || !d.ok) throw new Error((d && d.message) || 'Could not load.');
        try {
          sessionStorage.setItem(key, JSON.stringify(d));
        } catch {
          // too big or refused; fine
        }
        apply(d);
      })
      .catch(bad || (() => {}));
  };

  const hour = Number(et(new Date().toISOString(), { hour: 'numeric', hour12: false }));
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  $('t-date').textContent = et(new Date().toISOString(), { weekday: 'long', month: 'long', day: 'numeric' });
  // The greeting is final text from the first paint (part of day, and the first name this browser last saw), so the heading never changes under the eye.
  const NAME_KEY = 'favor.hub.first.v1';
  const CARDS_KEY = 'favor.hub.cards.v1';
  let knownFirst = '';
  try { knownFirst = localStorage.getItem(NAME_KEY) || ''; } catch { /* storage refused */ }
  $('t-hello').textContent = knownFirst ? `${part}, ${knownFirst}` : part;
  // The Needs you placeholders match the number of cards this browser last saw.
  try {
    const n = Math.min(4, Math.max(0, Number(localStorage.getItem(CARDS_KEY) || 4)));
    const box = $('t-cards');
    if (box && box.querySelectorAll('.r2t-skel').length !== n && n > 0) box.innerHTML = '<div class="r2t-skel"></div>'.repeat(n);
  } catch { /* storage refused */ }

  function cards(list) {
    $('t-cards').removeAttribute('aria-busy');
    const meta = $('t-needs-meta');
    if (!list.length) {
      meta.textContent = '';
      $('t-cards').innerHTML = '<div class="h-card r2t-clear r2t-span" data-tool="leaf"><span class="r2t-ico"><svg class="h-i" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg></span>Nothing is waiting on you right now.</div>';
      return;
    }
    // Each card carries its own count; a total of the totals beside the heading said the same thing twice.
    meta.textContent = '';
    $('t-cards').innerHTML = list
      .map((c) => {
        const note = c.note ? `<span class="r2t-chip ${c.warn ? 'r2t-chip--due' : /past due|overdue|late/i.test(c.note) ? 'r2t-chip--late' : ''}" title="${esc(c.note)}"><span class="r2t-chip__t">${esc(c.note)}</span></span>` : '';
        return `<div class="r2t-snzwrap"><a class="r2t-tile${c.warn ? ' r2t-tile--urgent' : ''}" data-tool="${tool(c.id)}" href="${esc(c.href)}">
          <span class="r2t-tile__h"><span class="r2t-ico">${icon(c.id)}</span>${esc(c.label)}</span>
          <span class="r2t-tile__n${String(Math.round(Number(c.n) || 0)).length > 5 ? ' is-long' : ''}"><span data-countup>${(Number(c.n) || 0).toLocaleString('en-US')}</span>${c.amount != null ? `<small>${money2(c.amount)}</small>` : ''}</span>
          <span class="r2t-tile__w">${esc(c.what)}</span>
          <span class="r2t-tile__f">${note}<span class="r2t-go">${icon('arrow')}</span></span>
        </a>${window.hubSnoozeButton ? window.hubSnoozeButton('hub', 'card:' + c.id, c.label) : ''}</div>`;
      })
      .join('');
  }

  function mine(list) {
    if (!list.length) return;
    const cls = (s) => (/Done|Approved/.test(s) ? 'r2t-chip--ok' : /Declined/.test(s) ? 'r2t-chip--late' : 'r2t-chip--due');
    $('t-mine').innerHTML = list
      .map((m) => `<li><a class="r2t-lr" href="${esc(m.href)}" title="${esc(m.title)}"><span class="r2t-lr__t"><b>${esc(String(m.title || '').trim() || 'Untitled')}</b></span><span class="r2t-chip ${cls(m.status)}" title="${esc(m.status)}"><span class="r2t-chip__t">${esc(m.status)}</span></span></a></li>`)
      .join('');
    $('t-mine-card').hidden = false;
  }

  // Eight lines at first; the rest one press away, so the page stays short. Grouped by day.
  const FEED_FIRST = 8;
  function feedHtml(list) {
    const today = dayKey(new Date().toISOString());
    const yest = dayKey(new Date(Date.now() - 864e5).toISOString());
    let last = '';
    return list
      .map((a) => {
        const k = dayKey(a.at);
        let g = '';
        if (k !== last) {
          last = k;
          g = `<div class="r2t-feed__g">${k === today ? 'Today' : k === yest ? 'Yesterday' : esc(et(a.at, { weekday: 'long', month: 'short', day: 'numeric' }))}</div>`;
        }
        const inner = `<span class="r2t-ico r2t-ico--sm">${icon(String(a.app || '').toLowerCase())}</span><p>${esc(a.text)}</p><time>${esc(clock(a.at))}</time>`;
        return a.href ? `${g}<a class="r2t-fr" data-tool="${tool(a.app)}" href="${esc(a.href)}">${inner}</a>` : `${g}<div class="r2t-fr" data-tool="${tool(a.app)}">${inner}</div>`;
      })
      .join('');
  }
  function feed(list) {
    $('t-feed').innerHTML = list.length ? feedHtml(list.slice(0, FEED_FIRST)) : '<p class="r2t-empty">Nothing in the last two weeks.</p>';
    const more = $('t-feed-more');
    if (list.length > FEED_FIRST) {
      more.textContent = `Show ${list.length - FEED_FIRST} more`;
      more.hidden = false;
      more.onclick = () => {
        $('t-feed').innerHTML = feedHtml(list);
        more.hidden = true;
      };
    } else more.hidden = true;
  }

  // The tour card stays until the tour and the new walkthroughs are done (src/scripts/tour.ts shows and hides it).

  const SLICE_OF = { rdd: 'rdds', pc: 'pc', ce: 'ce', mk: 'marketing' };

  function year(s) {
    const pct = s.goal ? (s.raised / s.goal) * 100 : 0;
    let delta = '';
    if (s.raisedLastYear) {
      const d = ((s.raised - s.raisedLastYear) / s.raisedLastYear) * 100;
      delta = `<span class="r2t-chip ${d >= 0 ? 'r2t-chip--ok' : 'r2t-chip--late'}">${d >= 0 ? '+' : ''}${d.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span><span class="r2t-sub">vs. this day last year</span>`;
    }
    const teams = s.teams
      .map((t) => {
        const p = t.goal ? (t.amount / t.goal) * 100 : 0;
        const slice = SLICE_OF[t.key];
        const amt = slice && t.measure !== 'awarded'
          ? `<span data-drill="slice:${slice}" data-drill-label="${esc(t.name)}, this year" data-drill-value="${Number(t.amount) || 0}" data-drill-def="Team revenue">${compact(t.amount)}</span>`
          : compact(t.amount);
        return `<div class="r2t-team"><div><b>${esc(t.name)}</b><small>${amt} of ${compact(t.goal)}${t.measure === 'awarded' ? ' awarded' : ''}</small></div><span>${Math.round(p)}%</span>
          <div class="r2t-bar"><i style="width:${Math.min(100, p).toFixed(1)}%"></i></div></div>`;
      })
      .join('');
    const left = Math.max(0, (s.goal || 0) - (s.raised || 0));
    const yr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const days = Math.max(0, Math.round((Date.UTC(+yr.slice(0, 4), 11, 31) - Date.UTC(+yr.slice(0, 4), +yr.slice(5, 7) - 1, +yr.slice(8, 10))) / 864e5));
    const strip = s.goal ? `<div class="r2t-strip"><div><b>${money0(left)}</b><span>to goal</span></div><div><b>${days.toLocaleString('en-US')}</b><span>days left</span></div><div><b>${days ? money0(left / days) : money0(left)}</b><span>needed a day</span></div></div>` : '';
    $('t-year').innerHTML = `
      <div>
        <div class="r2t-lab">Raised so far this year</div>
        <div class="r2t-hero" data-countup data-drill="year" data-drill-label="Raised so far this year" data-drill-value="${Number(s.raised) || 0}" data-drill-def="Which gifts count|Whose gift it is">${money0(s.raised)}</div>
        <div class="r2t-bar r2t-bar--lg"><i style="width:${Math.min(100, pct).toFixed(1)}%"></i></div>
        <div class="r2t-goal"><span>${pct.toFixed(1)}% of the ${money0(s.goal)} goal</span>${delta ? `<span class="r2t-delta">${delta}</span>` : ''}</div>
        ${strip}
        <div class="r2t-open"><a class="h-btn h-btn--primary h-btn--sm" href="/dashboard/">Open the KPI dashboard</a><span class="copy-stamp" data-copy-stamp></span></div>
      </div>
      <div><div class="r2t-lab">Team goals</div><div class="r2t-teams">${teams}</div></div>`;
    if (s.lastUpdated) $('t-fresh').textContent = `KPI dashboard, Raiser's Edge as of ${clock(s.lastUpdated)}`;
    $('t-year-wrap').hidden = false;
  }

  // A snoozed card leaves the list at once; the hub hides it until its day.
  document.addEventListener('hub:snoozed', (e) => {
    if (!e.detail || e.detail.kind !== 'hub') return;
    fetch('/api/hub/today', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => {
        if (d && d.ok) cards(d.cards || []);
      })
      .catch(() => {});
  });

  let kpiAsked = false;
  swr('favor.hub.today.v1', '/api/hub/today', (d) => {
      const first = String((d.user && d.user.name) || '').trim().split(/\s+/)[0];
      const shownName = first && d.user.via === 'google' ? first : '';
      $('t-hello').textContent = shownName ? `${part}, ${shownName}` : part;
      try { shownName ? localStorage.setItem(NAME_KEY, shownName) : localStorage.removeItem(NAME_KEY); localStorage.setItem(CARDS_KEY, String((d.cards || []).length || 1)); } catch { /* storage refused */ }
      cards(d.cards || []);
      mine(d.mine || []);
      feed(d.activity || []);
      if (!d.access || !d.access.kpi) {
        // No KPI numbers for this person: the mission card moves to the side column.
        const card = document.querySelector('[data-mission]');
        const column = $('t-mine-card').parentElement;
        if (card && column && card.parentElement !== column) {
          card.classList.add('r2t-mission--side');
          column.insertBefore(card, column.firstChild);
          $('t-year-wrap').hidden = true;
        }
      } else if (!kpiAsked) {
        kpiAsked = true;
        swr('favor.hub.kpi.v1', '/api/hub/kpi', (k) => {
          if (k.ok && k.summary) year(k.summary);
        });
      }
    }, (err) => {
      $('t-cards').innerHTML = `<div class="h-card r2t-clear">${esc(err.message)}</div>`;
    });
})();

/* Your day: Blackbaud actions assigned to you, and (once connected) today's meetings, files and mail.
   Every row opens a place inside FavorOS: an action opens in the Work Center, a meeting opens its room, an outside meeting opens a
   sheet with Join and Move to FavorOS, a shared file opens in the file viewer Chat uses. The outside site is always the second choice. */
(() => {
  const $ = (id) => document.getElementById(id);
  const grid = $('d-grid');
  if (!grid) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const et = (iso, o) => new Date(iso).toLocaleString('en-US', Object.assign({ timeZone: 'America/New_York' }, o));
  const time = (iso) => et(iso, { hour: 'numeric', minute: '2-digit' });
  const ago = (iso) => {
    const h = (Date.now() - new Date(iso)) / 36e5;
    return h < 1 ? 'just now' : h < 24 ? Math.round(h) + 'h ago' : Math.round(h / 24) + 'd ago';
  };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const initials = (s) => { const w = String(s || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((x) => x && !/^(mr|mrs|ms|dr|rev|and)$/i.test(x)); const pick = w.length > 1 ? [w[0], w[w.length - 1]] : w; return pick.map((x) => Array.from(x)[0]).join('').toUpperCase() || '?'; };
  const hue = (s) => { let n = 0; for (const c of String(s)) n = (n * 31 + c.charCodeAt(0)) % 8; return n; };
  const card = (title, meta, body, extra) =>
    `<div class="h-card r2t-card"><div class="r2t-ch"><h3>${title}${extra || ''}</h3><span>${meta}</span></div>${body}</div>`;
  const empty = (t) => `<p class="r2t-empty">${esc(t)}</p>`;
  const ROOM = (id) => '/meet/room/?m=' + encodeURIComponent(id);
  const phoneHref = (n) => 'tel:' + String(n).replace(/[^0-9+]/g, '');

  // A small mark per meeting provider: simple drawn stand-ins.
  const PV = {
    favor: ['pv-favor', '<path d="M12 4c3 3 5 5 5 8a5 5 0 0 1-10 0c0-3 2-5 5-8z"/>', 'FavorOS'],
    zoom: ['pv-zoom', '<rect x="4" y="7" width="10" height="10" rx="2"/><path d="m14 11 6-3v8l-6-3"/>', 'Zoom'],
    meet: ['pv-meet', '<rect x="4" y="7" width="10" height="10" rx="2"/><path d="m14 11 6-3v8l-6-3"/>', 'Google Meet'],
    teams: ['pv-teams', '<path d="M6 8h12"/><path d="M12 8v9"/>', 'Microsoft Teams'],
    webex: ['pv-webex', '<circle cx="12" cy="12" r="5"/>', 'Webex'],
    phone: ['pv-none', '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>', 'Phone call'],
  };
  const mark = (p) => {
    const m = PV[p];
    return m ? `<span class="r2t-pv ${m[0]}" title="${m[2]}"><svg viewBox="0 0 24 24" aria-hidden="true">${m[1]}</svg></span>` : '<span class="r2t-pv pv-none"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="6" width="14" height="13" rx="2"/><path d="M5 10h14"/></svg></span>';
  };
  const isLive = (e) => !e.allDay && Date.now() >= new Date(e.start) && Date.now() < new Date(e.end);
  const isOver = (e) => !e.allDay && Date.now() >= new Date(e.end);

  const note = new URLSearchParams(location.search).get('google');
  const notes = { connected: 'Your meetings, files and mail now show here.', declined: 'Google was not connected.', 'wrong-account': 'Pick your Favor account when Google asks.', failed: 'Google did not connect. Try again.', expired: 'That took too long. Try again.', 'no-token': 'Google did not hand back access. Try again.' };
  if (note && notes[note]) {
    $('d-sub').textContent = notes[note];
    $('d-sub').hidden = false;
    history.replaceState(null, '', '/');
  }

  let DATA = null;
  const evs = () => (DATA && DATA.google && DATA.google.events) || [];
  const partnerOf = (email) => ((DATA && DATA.google && DATA.google.partners) || {})[email];
  // A partner is a link to the partner page, never a bare label.
  const partnerLink = (email) => {
    const p = partnerOf(email);
    return p ? `<a class="r2t-chip r2t-chip--plain" href="/work/partner/${esc(p.id)}" title="Partner page">${esc(p.name)}</a>` : '';
  };
  const joinOf = (e) => (e.hub ? { href: ROOM(e.hub), label: 'Join', inside: true } : e.meet ? { href: e.meet, label: 'Join', inside: false } : e.phone ? { href: phoneHref(e.phone), label: 'Call', inside: false } : null);
  const canMove = (e) => !e.hub && !!e.id && !e.allDay && !e.declined && !isOver(e) && e.provider !== 'favor';

  const livePill = (events) => {
    const box = $('t-now');
    if (!box) return;
    const e = (events || []).find((x) => isLive(x) && !x.declined);
    const j = e && joinOf(e);
    box.innerHTML = e
      ? `<div class="r2t-now"><span class="r2t-pv pv-favor-on">${PV[e.provider] ? `<svg viewBox="0 0 24 24" aria-hidden="true">${PV[e.provider][1]}</svg>` : ''}</span><span>${esc(e.title)}<small>Live, until ${time(e.end)}</small></span>${j ? `<a class="r2t-join" href="${esc(j.href)}"${j.inside ? '' : ' target="_blank" rel="noopener"'}>Join</a>` : ''}</div>`
      : '';
  };

  /* ------------------------------------------------------------------ the meeting rows */
  const evRow = (e, i) => {
    const live = isLive(e);
    const over = isOver(e);
    const sub = esc(e.source || 'Meeting') + (e.declined ? ' · Declined' : '');
    const inner = `<span class="r2t-time">${live ? 'Now' : e.allDay ? 'All day' : esc(time(e.start))}</span>${mark(e.provider)}<span class="r2t-lr__t"><b>${esc(e.title)}</b><span>${sub}</span></span>${live ? '<span class="r2t-chip r2t-chip--live">Live</span>' : ''}`;
    const cls = `r2t-lr${live ? ' is-now' : ''}`;
    const open = e.hub ? `<a class="${cls}" href="${ROOM(e.hub)}">${inner}</a>` : `<button type="button" class="${cls} t2-rowbtn" data-ev="${i}" aria-haspopup="dialog">${inner}</button>`;
    const j = !e.declined && !over ? joinOf(e) : null;
    const acts = [];
    if (!e.hub && j) acts.push(`<a class="h-btn h-btn--sm ${live ? 'h-btn--primary' : 'h-btn--ghost'}" href="${esc(j.href)}"${j.inside ? '' : ' target="_blank" rel="noopener"'}>${j.label}</a>`);
    if (canMove(e)) acts.push(`<button type="button" class="h-btn h-btn--sm h-btn--ghost" data-move="${i}">Move to FavorOS</button>`);
    (e.people || []).forEach((p) => { const l = partnerLink(p); if (l) acts.push(l); });
    return `<li class="r2t-ev${over ? ' is-over' : ''}${e.declined ? ' is-declined' : ''}">${open}${acts.length ? `<div class="r2t-ev__a">${acts.join('')}</div>` : ''}</li>`;
  };

  /* ------------------------------------------------------------------ the sheets (one at a time, same layer) */
  let layer = null;
  let layerTok = null;
  let pending = null;
  let lastFocus = null;
  const closeLayer = (fromBack) => {
    if (!layer) return;
    const l = layer;
    layer = null;
    l.classList.remove('is-in');
    setTimeout(() => l.remove(), 160);
    document.removeEventListener('keydown', onKey, true);
    if (layerTok && window.hubOv && !fromBack) window.hubOv.off(layerTok);
    layerTok = null;
    if (pending) { DATA = pending; pending = null; remember(); draw(); }
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  };
  const onKey = (e) => {
    if (!layer) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLayer(); return; }
    if (e.key !== 'Tab') return;
    const f = Array.from(layer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled])')).filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const openLayer = (label, html) => {
    if (layer) { layer.remove(); layer = null; }
    else lastFocus = document.activeElement;
    const l = document.createElement('div');
    l.className = 't2-layer';
    l.innerHTML = `<div class="t2-scrim" data-t2-close></div><div class="t2-sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}"><div class="t2-grab" aria-hidden="true"></div>${html}</div>`;
    document.body.appendChild(l);
    layer = l;
    if (!layerTok && window.hubOv) layerTok = window.hubOv.on(() => closeLayer(true));
    document.addEventListener('keydown', onKey, true);
    requestAnimationFrame(() => {
      l.classList.add('is-in');
      const f = l.querySelector('[data-t2-first]');
      if (f && !matchMedia('(pointer: coarse)').matches) f.focus({ preventScroll: true });
    });
    return l;
  };
  document.addEventListener('click', (ev) => {
    if (layer && ev.target.closest('[data-t2-close]')) { ev.preventDefault(); closeLayer(); }
  });

  const whenLine = (e) => et(e.start, { weekday: 'long', month: 'short', day: 'numeric' }) + ', ' + time(e.start) + ' to ' + time(e.end) + ' ET';
  const guests = (e) => (e.people || []).length;
  const closeBtn = '<button type="button" class="t2-x" data-t2-close aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';

  const eventSheet = (i) => {
    const e = evs()[i];
    if (!e) return;
    const j = !e.declined && !isOver(e) ? joinOf(e) : null;
    const n = guests(e);
    const partners = (e.people || []).map(partnerLink).filter(Boolean).join('');
    const body =
      `<div class="t2-h">${mark(e.provider)}<div><h3>${esc(e.title)}</h3><p>${e.allDay ? 'All day' : esc(whenLine(e))}</p></div>${closeBtn}</div>` +
      `<dl class="t2-facts"><div><dt>Held on</dt><dd>${esc(e.source || 'Meeting')}${e.declined ? ', declined' : ''}</dd></div>` +
      `<div><dt>With</dt><dd>${n ? `${n} ${n === 1 ? 'person' : 'people'}` : 'Just you'}</dd></div>` +
      (partners ? `<div><dt>Partners</dt><dd class="t2-chips">${partners}</dd></div>` : '') +
      '</dl>' +
      `<div class="t2-acts">${j ? `<a class="h-btn h-btn--primary" data-t2-first href="${esc(j.href)}" target="_blank" rel="noopener">${j.label}</a>` : ''}` +
      `${canMove(e) ? `<button type="button" class="h-btn ${j ? 'h-btn--ghost' : 'h-btn--primary'}" data-move="${i}"${j ? '' : ' data-t2-first'}>Move to FavorOS</button>` : ''}</div>` +
      (e.link ? `<a class="t2-sec" href="${esc(e.link)}" target="_blank" rel="noopener">Open in Google Calendar</a>` : '');
    openLayer(e.title, body);
  };

  const moveSheet = (i) => {
    const e = evs()[i];
    if (!e) return;
    const g = (DATA && DATA.google) || {};
    const n = guests(e);
    let write;
    if (!e.canEdit) write = '<p class="t2-note">Only the organizer can add the FavorOS link to this calendar event, so the event stays as it is.</p>';
    else if (!g.mayWrite) write = '<p class="t2-note">To put the FavorOS link on the calendar event, FavorOS needs your permission to edit your calendar events.</p><a class="h-btn h-btn--ghost h-btn--sm" href="/api/google/connect?add=meetings&amp;next=%2F">Allow calendar edits</a>';
    else write = '<label class="t2-check"><input type="checkbox" id="t2-write" /><span>Add the FavorOS link to this event on my Google Calendar</span></label><p class="t2-note" id="t2-write-note" hidden>Adds one line, Join in FavorOS and the link, to the end of the notes of this event on your calendar. Guests see it on their copy of the event. Google sends no email. Nothing else on the event changes, and the ' + esc(e.source || 'meeting') + ' details stay.</p>';
    const body =
      `<div class="t2-h"><div><h3>Move to FavorOS</h3><p>${esc(e.title)}</p></div>${closeBtn}</div>` +
      '<ul class="t2-list">' +
      `<li>Makes a FavorOS meeting on ${esc(whenLine(e))}.</li>` +
      `<li>${n ? `Invites the same ${n} ${n === 1 ? 'person' : 'people'} in FavorOS. FavorOS sends no email.` : 'Only you are on it.'}</li>` +
      '<li>It is not recorded. The host can change that in the meeting.</li>' +
      '<li id="t2-stays">Your calendar event is not changed.</li></ul>' +
      write +
      '<p class="t2-err" id="t2-err" role="alert" hidden></p>' +
      `<div class="t2-acts"><button type="button" class="h-btn h-btn--primary" id="t2-go" data-t2-first>Move to FavorOS</button><button type="button" class="h-btn h-btn--ghost" data-ev="${i}">Back</button></div>`;
    const l = openLayer('Move to FavorOS', body);
    const box = l.querySelector('#t2-write');
    if (box) box.addEventListener('change', () => {
      l.querySelector('#t2-write-note').hidden = !box.checked;
      l.querySelector('#t2-stays').textContent = box.checked ? 'Your calendar event gets one new line in its notes.' : 'Your calendar event is not changed.';
    });
    l.querySelector('#t2-go').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      const err = l.querySelector('#t2-err');
      btn.disabled = true;
      btn.textContent = 'Moving';
      err.hidden = true;
      try {
        const res = await fetch('/api/hub/day-move', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'X-Hub-Request': '1' }, body: JSON.stringify({ eventId: e.id, writeLink: !!(box && box.checked) }) });
        const d = await res.json().catch(() => ({}));
        if (res.status === 409 && d.error === 'already' && d.id) { e.hub = d.id; remember(); draw(); closeLayer(); return; }
        if (!res.ok || d.ok === false) throw new Error(d.message || 'Could not move it. Try again.');
        e.hub = d.id;
        e.source = 'FavorOS';
        e.provider = 'favor';
        remember();
        draw();
        const done =
          `<div class="t2-h"><div><h3>Moved to FavorOS</h3><p>${esc(e.title)}</p></div>${closeBtn}</div>` +
          `<ul class="t2-list"><li>${esc(whenLine(e))}.</li><li>${d.linked ? 'The FavorOS link is on your calendar event.' : 'Your calendar event is not changed.'}</li></ul>` +
          (d.linkError ? `<p class="t2-note">${esc(d.linkError)}</p>` : '') +
          `<div class="t2-acts"><a class="h-btn h-btn--primary" data-t2-first href="${esc(d.room)}">Open the meeting</a><button type="button" class="h-btn h-btn--ghost" data-t2-close>Done</button></div>`;
        openLayer('Moved to FavorOS', done);
      } catch (x) {
        err.textContent = x.message;
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Move to FavorOS';
      }
    });
  };

  /* ------------------------------------------------------------------ shared files, in the viewer Chat uses */
  const fileItem = (f) => {
    const m = String(f.mime || '');
    const enc = encodeURIComponent(f.id);
    const base = '/api/hub/day-file?id=' + enc;
    const common = { name: f.name, sub: f.by ? 'Shared by ' + f.by : 'Google Drive', external: f.link, externalShort: 'Drive', externalLabel: 'Open in Google Drive' };
    if (/^image\//.test(m)) return Object.assign({ kind: 'image', url: base + '&v=thumb&s=2000', download: '' }, common);
    return Object.assign({ kind: 'drive', url: base + '&v=content', page: base + '&v=thumb&s=1600', embed: /folder$/.test(m) ? '' : 'https://drive.google.com/file/d/' + enc + '/preview' }, common);
  };
  let viewTok = null;
  const openFile = (i) => {
    const f = ((DATA && DATA.google && DATA.google.files) || [])[i];
    if (!f) return;
    const V = window.FavorChatView;
    if (!V) { location.href = f.link; return; }
    V.onClose = () => { if (viewTok && window.hubOv) { const t = viewTok; viewTok = null; window.hubOv.off(t); } };
    V.open(fileItem(f));
    if (window.hubOv) { if (viewTok) window.hubOv.off(viewTok); viewTok = window.hubOv.on(() => { viewTok = null; V.close(); }); }
  };

  /* ------------------------------------------------------------------ the cards */
  const remember = () => { try { sessionStorage.setItem('favor.hub.day.v2', JSON.stringify(DATA)); } catch { /* refused; fine */ } };

  const meetingsCard = (g) => {
    const list = g.events;
    let body;
    if (!list) body = empty('Your calendar could not be read just now.');
    else if (!list.length) body = empty('Nothing on your calendar today.');
    else body = `<ul class="r2t-list">${list.map(evRow).join('')}</ul>`;
    const outside = (list || []).filter(canMove).length;
    const nudge = outside ? `<p class="t2-nudge">${outside} ${outside === 1 ? 'meeting is' : 'meetings are'} held outside FavorOS.</p>` : '';
    // data-td marks this card for the walkthrough step about meetings.
    return card('Today’s meetings', '<a class="h-link" href="/meet/">Day view</a>', body + nudge).replace('class="h-card r2t-card"', 'class="h-card r2t-card" data-td="meetings"');
  };

  const draw = () => {
    const d = DATA;
    grid.removeAttribute('aria-busy');
    const bb = d.blackbaud || {};
    const g = d.google || {};
    livePill(g.events);

    let actions;
    if (!bb.linked) actions = card('Blackbaud actions', '', empty('Your account is not linked to a fundraiser record in Blackbaud.'));
    else if (!bb.actions.length) actions = card('Blackbaud actions', 'Next 7 days', empty('No open actions due this week.'));
    else
      actions = card(
        'Blackbaud actions',
        '<a class="h-link" href="/work/">Work Center</a>',
        `<ul class="r2t-list">${bb.actions
          .map(
            (a) => `<li class="r2t-snzrow" data-row="${esc(a.id)}"><a class="r2t-lr" href="/work/?action=${encodeURIComponent(a.id)}" title="${esc(a.summary || a.type)}"><span class="r2t-chk" aria-hidden="true"></span><span class="r2t-lr__t"><b>${esc(a.partner || 'Partner')}</b><span>${esc(a.summary || a.type || a.category)}</span></span><span class="r2t-chip ${a.due < today ? 'r2t-chip--late' : 'r2t-chip--plain'}" data-chip>${esc(et(a.due + 'T12:00:00Z', { month: 'short', day: 'numeric' }))}</span></a>${window.hubSnoozeButton ? window.hubSnoozeButton('bb', a.id, a.partner || 'Partner', 'r2t-snz--row') : ''}</li>`
          )
          .join('')}</ul>${bb.total > bb.actions.length ? `<a class="r2t-more-n" href="/work/">${bb.total - bb.actions.length} more in the Work Center</a>` : ''}`,
        bb.overdue ? `<span class="r2t-chip r2t-chip--late">${bb.overdue} overdue</span>` : ''
      );

    if (!g.connected) {
      grid.innerHTML =
        actions +
        (g.events && g.events.length ? meetingsCard(g) : '') +
        `<div class="h-card r2t-connect"><b>Calendar, files and mail</b>
          <p>Today's meetings, files shared with you and who emailed you. Reads titles and names only.</p>
          <a class="h-btn h-btn--primary h-btn--sm" href="/api/google/connect">Connect my Google</a></div>`;
      return;
    }
    // With Mail open to this person, an unread message opens in FavorOS at that conversation; otherwise in Gmail.
    let inMail = false;
    try { inMail = !!((JSON.parse(localStorage.getItem('favor.hub.nav.v1') || 'null') || {}).access || {}).mail; } catch (e) { /* private mode */ }
    const mail = g.mail
      ? g.mail.length
        ? `<ul class="r2t-list">${g.mail.slice(0, 6).map((m) => `<li><a class="r2t-lr" ${inMail && m.threadId ? `href="/mail/#/INBOX/${esc(m.threadId)}"` : `href="${esc(m.link)}" target="_blank" rel="noopener"`} title="${esc(m.subject)}"><span class="r2t-av" data-h="${hue(m.from)}">${esc(initials(m.from))}</span><span class="r2t-lr__t"><b>${esc(m.from)}</b><span>${esc(m.subject)}</span></span>${m.date ? `<time class="r2t-when">${esc(time(m.date))}</time>` : ''}</a></li>`).join('')}</ul>`
        : empty('No unread mail from the last three days.')
      : empty('Your inbox could not be read just now.');
    const files = g.files && g.files.length
      ? card('Shared with you', 'This week', `<ul class="r2t-list">${g.files.map((f, i) => `<li><button type="button" class="r2t-lr t2-rowbtn" data-file="${i}" aria-haspopup="dialog"><span class="r2t-lr__t"><b>${esc(f.name)}</b><span>${esc(f.by)} ${ago(f.modified)}</span></span></button></li>`).join('')}</ul>`)
      : '';
    const nMail = g.mail ? g.mail.length : 0;
    grid.innerHTML =
      actions +
      meetingsCard(g) +
      card('Unread mail', inMail ? '<a class="h-link" href="/mail/">Mail</a>' : '<a class="h-link" href="https://mail.google.com" target="_blank" rel="noopener">Gmail</a>', mail, nMail ? `<span class="r2t-count">${nMail}</span>` : '') +
      files;
  };

  // One listener for every row, so a redraw never loses a handler.
  grid.addEventListener('click', (ev) => {
    const mv = ev.target.closest('[data-move]');
    if (mv) { ev.preventDefault(); moveSheet(Number(mv.dataset.move)); return; }
    const row = ev.target.closest('[data-ev]');
    if (row) { ev.preventDefault(); eventSheet(Number(row.dataset.ev)); return; }
    const file = ev.target.closest('[data-file]');
    if (file) { ev.preventDefault(); openFile(Number(file.dataset.file)); }
  });
  // The sheets live on the body, not in the grid.
  document.addEventListener('click', (ev) => {
    if (!layer || !layer.contains(ev.target)) return;
    const mv = ev.target.closest('[data-move]');
    if (mv) { ev.preventDefault(); moveSheet(Number(mv.dataset.move)); return; }
    const back = ev.target.closest('[data-ev]');
    if (back) { ev.preventDefault(); eventSheet(Number(back.dataset.ev)); }
  });

  const show = (d) => { DATA = d; draw(); };
  // What this tab last saw shows at once; the fresh answer replaces it.
  let shown = false;
  try {
    const hit = JSON.parse(sessionStorage.getItem('favor.hub.day.v2') || 'null');
    if (hit && hit.ok) {
      show(hit);
      shown = true;
    }
  } catch {
    // unreadable copy; the fetch below still runs
  }
  fetch('/api/hub/day', { credentials: 'same-origin' })
    .then((r) => r.json())
    .then((d) => {
      if (!d || !d.ok) throw new Error('day');
      // A sheet that is open keeps its event: only redraw the list when no sheet is up.
      if (layer) { pending = d; return; }
      DATA = d;
      remember();
      draw();
    })
    .catch(() => {
      if (!shown) grid.innerHTML = '<div class="h-card r2t-clear r2t-span">Your day could not load. Refresh to try again.</div>';
    });
})();
