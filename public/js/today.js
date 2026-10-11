/* Today: what is waiting on the person signed in, the year against goal (leadership), their own
   requests, and recent activity. Runs the moment it loads, so a page swapped in place works too. */
(() => {
  const $ = (id) => document.getElementById(id);
  if (!$('t-cards')) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money0 = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const money2 = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const compact = (n) => (n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + Math.round(n / 1e3) + 'K' : '$' + Math.round(n));
  const et = (iso, opts) => new Date(iso).toLocaleString('en-US', Object.assign({ timeZone: 'America/New_York' }, opts));
  const clock = (iso) => et(iso, { hour: 'numeric', minute: '2-digit' });
  const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  const ICON = {
    meetings: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
    requests: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
    expenses: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6"/><path d="M9 11h6"/><path d="M9 15h4"/>',
    receipts: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    feedback: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8"/><path d="M8 12h5"/>',
    brain: '<path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z"/>',
    foundations: '<path d="M3 21h18"/><path d="M5 21V10"/><path d="M19 21V10"/><path d="M9 21V10"/><path d="M15 21V10"/><path d="m2 10 10-6 10 6z"/>',
    dot: '<circle cx="12" cy="12" r="3"/>',
    arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  };
  const icon = (n) => `<svg class="h-i" viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ICON.dot}</svg>`;
  // Each tool keeps one color: tile tint and ink come from the shared tool tokens.
  const TOOL = { requests: 'sky', expenses: 'sky', receipts: 'sky', brain: 'dusk', meetings: 'teal', feedback: 'sun', foundations: 'leaf' };
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

  function cards(list) {
    $('t-cards').removeAttribute('aria-busy');
    const meta = $('t-needs-meta');
    if (!list.length) {
      meta.textContent = '';
      $('t-cards').innerHTML = '<div class="h-card r2t-clear r2t-span" data-tool="leaf"><span class="r2t-ico"><svg class="h-i" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg></span>Nothing is waiting on you right now.</div>';
      return;
    }
    const total = list.reduce((s, c) => s + (Number(c.n) || 0), 0);
    meta.textContent = `${total.toLocaleString('en-US')} ${total === 1 ? 'item' : 'items'} across ${list.length} ${list.length === 1 ? 'tool' : 'tools'}`;
    $('t-cards').innerHTML = list
      .map((c) => {
        const note = c.note ? `<span class="r2t-chip ${c.warn ? 'r2t-chip--due' : /past due|overdue|late/i.test(c.note) ? 'r2t-chip--late' : ''}" title="${esc(c.note)}"><i></i>${esc(c.note)}</span>` : '';
        return `<div class="r2t-snzwrap"><a class="r2t-tile${c.warn ? ' r2t-tile--urgent' : ''}" data-tool="${tool(c.id)}" href="${esc(c.href)}" aria-label="${esc(c.label)}: ${esc(c.cta)}">
          <span class="r2t-tile__h"><span class="r2t-ico">${icon(c.id)}</span>${esc(c.label)}</span>
          <span class="r2t-tile__n"><span data-countup>${Number(c.n).toLocaleString('en-US')}</span>${c.amount != null ? `<small>${money2(c.amount)}</small>` : ''}</span>
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
      .map((m) => `<li><a class="r2t-lr" href="${esc(m.href)}" title="${esc(m.title)}"><span class="r2t-lr__t"><b>${esc(m.title)}</b></span><span class="r2t-chip ${cls(m.status)}">${esc(m.status)}</span></a></li>`)
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
        return `${g}<div class="r2t-fr" data-tool="${tool(a.app)}"><span class="r2t-ico r2t-ico--sm">${icon(String(a.app || '').toLowerCase())}</span><p>${esc(a.text)}</p><time>${esc(clock(a.at))}</time></div>`;
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

  // The welcome card shows until the person hides it or opens Help.
  const WELCOME = 'favor.hub.welcome.v1';
  try {
    if (!localStorage.getItem(WELCOME)) $('t-welcome').hidden = false;
  } catch {
    // Private windows can refuse storage; the card stays hidden there.
  }
  const hideWelcome = () => {
    $('t-welcome').hidden = true;
    document.documentElement.classList.remove('show-welcome');
    try {
      localStorage.setItem(WELCOME, String(Date.now()));
    } catch {
      // nothing to do
    }
  };
  $('t-welcome-x').addEventListener('click', hideWelcome);
  $('t-welcome').querySelector('[data-tour-start]').addEventListener('click', hideWelcome);

  const SLICE_OF = { rdd: 'rdds', pc: 'pc', ce: 'ce', mk: 'marketing' };

  function year(s) {
    const pct = s.goal ? (s.raised / s.goal) * 100 : 0;
    let delta = '';
    if (s.raisedLastYear) {
      const d = ((s.raised - s.raisedLastYear) / s.raisedLastYear) * 100;
      delta = `<span class="r2t-chip ${d >= 0 ? 'r2t-chip--ok' : 'r2t-chip--late'}">${d >= 0 ? '+' : ''}${d.toFixed(1)}%</span><span class="r2t-sub">vs. this day last year</span>`;
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
    $('t-year').innerHTML = `
      <div>
        <div class="r2t-lab">Raised so far this year</div>
        <div class="r2t-hero" data-countup data-drill="year" data-drill-label="Raised so far this year" data-drill-value="${Number(s.raised) || 0}" data-drill-def="Which gifts count|Whose gift it is">${money0(s.raised)}</div>
        <div class="r2t-bar r2t-bar--lg"><i style="width:${Math.min(100, pct).toFixed(1)}%"></i></div>
        <div class="r2t-goal"><span>${pct.toFixed(1)}% of the ${money0(s.goal)} goal</span>${delta ? `<span class="r2t-delta">${delta}</span>` : ''}</div>
        <a class="h-link r2t-open" href="/dashboard/">Open the KPI dashboard ${icon('arrow')}</a><span class="copy-stamp" data-copy-stamp></span>
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
      const first = String((d.user && d.user.name) || '').split(' ')[0];
      $('t-hello').textContent = first && d.user.via === 'google' ? `${part}, ${first}` : part;
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

/* Your day: Blackbaud actions assigned to you, and (once connected) today's meetings, files and mail. */
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
  const initials = (s) => String(s || '?').replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  const hue = (s) => { let n = 0; for (const c of String(s)) n = (n * 31 + c.charCodeAt(0)) % 8; return n; };
  const card = (title, meta, body, extra) =>
    `<div class="h-card r2t-card"><div class="r2t-ch"><h3>${title}${extra || ''}</h3><span>${meta}</span></div>${body}</div>`;
  const empty = (t) => `<p class="r2t-empty">${esc(t)}</p>`;

  // A small mark per meeting provider: simple drawn stand-ins.
  const PV = {
    favor: ['pv-favor', '<path d="M12 4c3 3 5 5 5 8a5 5 0 0 1-10 0c0-3 2-5 5-8z"/>', 'Favor Meetings'],
    zoom: ['pv-zoom', '<rect x="4" y="7" width="10" height="10" rx="2"/><path d="m14 11 6-3v8l-6-3"/>', 'Zoom'],
    meet: ['pv-meet', '<rect x="4" y="7" width="10" height="10" rx="2"/><path d="m14 11 6-3v8l-6-3"/>', 'Google Meet'],
    teams: ['pv-teams', '<path d="M6 8h12"/><path d="M12 8v9"/>', 'Microsoft Teams'],
    webex: ['pv-webex', '<circle cx="12" cy="12" r="5"/>', 'Webex'],
  };
  const mark = (p) => {
    const m = PV[p];
    return m ? `<span class="r2t-pv ${m[0]}" title="${m[2]}"><svg viewBox="0 0 24 24" aria-hidden="true">${m[1]}</svg></span>` : '<span class="r2t-pv pv-none"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="6" width="14" height="13" rx="2"/><path d="M5 10h14"/></svg></span>';
  };
  const isLive = (e) => !e.allDay && Date.now() >= new Date(e.start) && Date.now() < new Date(e.end);

  const note = new URLSearchParams(location.search).get('google');
  const notes = { connected: 'Your meetings, files and mail now show here.', declined: 'Google was not connected.', 'wrong-account': 'Pick your Favor account when Google asks.', failed: 'Google did not connect. Try again.', expired: 'That took too long. Try again.', 'no-token': 'Google did not hand back access. Try again.' };
  if (note && notes[note]) {
    $('d-sub').textContent = notes[note];
    $('d-sub').hidden = false;
    history.replaceState(null, '', '/');
  }

  const livePill = (events) => {
    const box = $('t-now');
    if (!box) return;
    const e = (events || []).find(isLive);
    box.innerHTML = e
      ? `<div class="r2t-now"><span class="r2t-pv pv-favor-on">${PV[e.provider] ? `<svg viewBox="0 0 24 24" aria-hidden="true">${PV[e.provider][1]}</svg>` : ''}</span><span>${esc(e.title)}<small>Live, until ${time(e.end)}</small></span><a class="r2t-join" href="${esc(e.meet || e.link)}" target="_blank" rel="noopener">Join</a></div>`
      : '';
  };

  const showDay = (d) => {
      grid.removeAttribute('aria-busy');
      const bb = d.blackbaud || {};
      const g = d.google || {};
      const partners = g.partners || {};
      const partnerTag = (email) => (partners[email] ? `<span class="r2t-chip r2t-chip--plain" title="In Blackbaud">${esc(partners[email].name)}</span>` : '');
      livePill(g.events);

      let actions;
      const cid = (a) => `https://host.nxt.blackbaud.com/constituent/records/${esc(a.cid)}?envid=p-5_k5FlbubEyEQnUJw7C9Rw`;
      if (!bb.linked) actions = card('Blackbaud actions', '', empty('Your account is not linked to a fundraiser record in Blackbaud.'));
      else if (!bb.actions.length) actions = card('Blackbaud actions', 'Next 7 days', empty('No open actions due this week.'));
      else
        actions = card(
          'Blackbaud actions',
          '<a class="h-link" href="/work/">Work Center</a>',
          `<ul class="r2t-list">${bb.actions
            .map(
              (a) => `<li class="r2t-snzrow" data-row="${esc(a.id)}"><a class="r2t-lr" href="${cid(a)}" target="_blank" rel="noopener" title="${esc(a.summary || a.type)}"><span class="r2t-chk" aria-hidden="true"></span><span class="r2t-lr__t"><b>${esc(a.partner || 'Partner')}</b><span>${esc(a.summary || a.type || a.category)}</span></span><span class="r2t-chip ${a.due < today ? 'r2t-chip--late' : 'r2t-chip--plain'}" data-chip>${esc(et(a.due + 'T12:00:00Z', { month: 'short', day: 'numeric' }))}</span></a>${window.hubSnoozeButton ? window.hubSnoozeButton('bb', a.id, a.partner || 'Partner', 'r2t-snz--row') : ''}</li>`
            )
            .join('')}</ul>${bb.total > bb.actions.length ? `<p class="r2t-more-n">${bb.total - bb.actions.length} more in Blackbaud</p>` : ''}`,
          bb.overdue ? `<span class="r2t-chip r2t-chip--late"><i></i>${bb.overdue} overdue</span>` : ''
        );

      if (!g.connected) {
        grid.innerHTML =
          actions +
          `<div class="h-card r2t-connect"><b>Calendar, files and mail</b>
            <p>Shows today's meetings, files shared with you and who emailed you. Reads titles and names only. Disconnect any time.</p>
            <a class="h-btn h-btn--primary h-btn--sm" href="/api/google/connect">Connect my Google</a></div>`;
        return;
      }
      const events = g.events
        ? g.events.length
          ? `<ul class="r2t-list">${g.events
              .map((e) => {
                const live = isLive(e);
                const who = (e.people || []).map(partnerTag).join('');
                return `<li><a class="r2t-lr${live ? ' is-now' : ''}" href="${esc(e.meet || e.link)}" target="_blank" rel="noopener"><span class="r2t-time">${live ? 'Now' : e.allDay ? 'All day' : esc(time(e.start))}</span>${mark(e.provider)}<span class="r2t-lr__t"><b>${esc(e.title)}</b></span>${who}${live ? '<span class="r2t-chip r2t-chip--live"><i></i>Live</span>' : ''}</a></li>`;
              })
              .join('')}</ul>`
          : empty('Nothing on your calendar today.')
        : empty('Your calendar could not be read just now.');
      const mail = g.mail
        ? g.mail.length
          ? `<ul class="r2t-list">${g.mail.slice(0, 6).map((m) => `<li><a class="r2t-lr" href="${esc(m.link)}" target="_blank" rel="noopener" title="${esc(m.subject)}"><span class="r2t-av" data-h="${hue(m.from)}">${esc(initials(m.from))}</span><span class="r2t-lr__t"><b>${esc(m.from)}</b><span>${esc(m.subject)}</span></span>${partnerTag(m.fromEmail)}${m.date ? `<time class="r2t-when">${esc(time(m.date))}</time>` : ''}</a></li>`).join('')}</ul>`
          : empty('No unread mail from the last three days.')
        : empty('Your inbox could not be read just now.');
      const files = g.files && g.files.length
        ? card('Shared with you', 'This week', `<ul class="r2t-list">${g.files.map((f) => `<li><a class="r2t-lr" href="${esc(f.link)}" target="_blank" rel="noopener"><span class="r2t-lr__t"><b>${esc(f.name)}</b><span>${esc(f.by)} ${ago(f.modified)}</span></span></a></li>`).join('')}</ul>`)
        : '';
      const nMail = g.mail ? g.mail.length : 0;
      grid.innerHTML =
        actions +
        card('Today’s meetings', '<a class="h-link" href="/meet/">Day view</a>', events) +
        card('Unread mail', '<a class="h-link" href="https://mail.google.com" target="_blank" rel="noopener">Gmail</a>', mail, nMail ? `<span class="r2t-count">${nMail}</span>` : '') +
        files;
  };
  // What this tab last saw shows at once; the fresh answer replaces it.
  let shown = false;
  try {
    const hit = JSON.parse(sessionStorage.getItem('favor.hub.day.v1') || 'null');
    if (hit) {
      showDay(hit);
      shown = true;
    }
  } catch {
    // unreadable copy; the fetch below still runs
  }
  fetch('/api/hub/day', { credentials: 'same-origin' })
    .then((r) => r.json())
    .then((d) => {
      try {
        sessionStorage.setItem('favor.hub.day.v1', JSON.stringify(d));
      } catch {
        // refused; fine
      }
      showDay(d);
    })
    .catch(() => {
      if (!shown) grid.innerHTML = '<div class="h-card r2t-clear r2t-span">Your day could not load. Refresh to try again.</div>';
    });
})();
