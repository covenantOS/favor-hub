/* Today: what is waiting on the person signed in, the year against goal (leadership), their own
   requests, and recent activity. */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money0 = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const money2 = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const compact = (n) => (n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + Math.round(n / 1e3) + 'K' : '$' + Math.round(n));
  const et = (iso, opts) => new Date(iso).toLocaleString('en-US', Object.assign({ timeZone: 'America/New_York' }, opts));
  const when = (iso) => et(iso, { month: 'short', day: 'numeric' }) + ', ' + et(iso, { hour: 'numeric', minute: '2-digit' });

  const ICON = {
    requests: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
    expenses: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6"/><path d="M9 11h6"/><path d="M9 15h4"/>',
    receipts: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  };
  const icon = (n) => `<svg class="h-i" viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ''}</svg>`;

  const hour = Number(et(new Date().toISOString(), { hour: 'numeric', hour12: false }));
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  $('t-date').textContent = et(new Date().toISOString(), { weekday: 'long', month: 'long', day: 'numeric' }) + '.';

  function cards(list) {
    $('t-cards').removeAttribute('aria-busy');
    if (!list.length) {
      $('t-cards').innerHTML =
        '<div class="h-card h-allclear"><span class="h-start__icon"><svg class="h-i" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg></span>Nothing is waiting on you right now.</div>';
      return;
    }
    $('t-cards').innerHTML = list
      .map(
        (c) => `<div class="h-card h-todo${c.warn ? ' h-todo--warn' : ''}">
          <div class="h-todo__app"><span class="h-todo__icon">${icon(c.id)}</span>${esc(c.label)}</div>
          <div class="h-todo__n">${Number(c.n).toLocaleString('en-US')}${c.amount != null ? ` <small>${money2(c.amount)}</small>` : ''}</div>
          <div class="h-todo__what">${esc(c.what)}</div>
          ${c.note ? `<div class="h-todo__note${c.warn ? ' h-todo__note--warn' : ''}">${esc(c.note)}</div>` : ''}
          <a class="h-btn ${c.warn ? 'h-btn--warn' : 'h-btn--ghost'} h-btn--sm" href="${esc(c.href)}">${esc(c.cta)} ${icon('arrow')}</a>
        </div>`
      )
      .join('');
  }

  function mine(list) {
    if (!list.length) return;
    const cls = (s) => (/Done|Approved/.test(s) ? 'h-status--done' : /Declined/.test(s) ? 'h-status--declined' : 'h-status--wait');
    $('t-mine').innerHTML = list
      .map((m) => `<li><a href="${esc(m.href)}" title="${esc(m.title)}">${esc(m.title)}</a><span class="h-status ${cls(m.status)}">${esc(m.status)}</span></li>`)
      .join('');
    $('t-mine-card').hidden = false;
  }

  // Eight lines at first; the rest one press away, so the page stays short.
  const FEED_FIRST = 8;
  function feed(list) {
    const row = (a) => `<li><span><span class="h-chip h-chip--${esc(a.app)}">${esc(a.app)}</span></span><span>${esc(a.text)}</span><time>${esc(when(a.at))}</time></li>`;
    $('t-feed').innerHTML = list.length
      ? list.slice(0, FEED_FIRST).map(row).join('')
      : '<li><span></span><span class="h-sub">Nothing in the last two weeks.</span><span></span></li>';
    const more = $('t-feed-more');
    if (list.length > FEED_FIRST) {
      more.textContent = `Show ${list.length - FEED_FIRST} more`;
      more.hidden = false;
      more.onclick = () => {
        $('t-feed').innerHTML = list.map(row).join('');
        more.hidden = true;
      };
    }
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
    try {
      localStorage.setItem(WELCOME, String(Date.now()));
    } catch {
      // nothing to do
    }
  };
  $('t-welcome-x').addEventListener('click', hideWelcome);
  $('t-welcome').querySelector('a').addEventListener('click', hideWelcome);

  function year(s) {
    const pct = s.goal ? (s.raised / s.goal) * 100 : 0;
    let delta = '';
    if (s.raisedLastYear) {
      const d = ((s.raised - s.raisedLastYear) / s.raisedLastYear) * 100;
      delta = `<span class="h-delta ${d >= 0 ? 'h-delta--up' : 'h-delta--down'}">${d >= 0 ? '+' : ''}${d.toFixed(1)}%</span> <span class="h-sub">vs. this day last year</span>`;
    }
    const teams = s.teams
      .map((t) => {
        const p = t.goal ? (t.amount / t.goal) * 100 : 0;
        return `<div class="h-team"><div><b>${esc(t.name)}</b><small>${compact(t.amount)} of ${compact(t.goal)}${t.measure === 'awarded' ? ' awarded' : ''}</small></div>
          <div class="h-bar"><i style="width:${Math.min(100, p).toFixed(1)}%"></i></div><span>${Math.round(p)}%</span></div>`;
      })
      .join('');
    $('t-year').innerHTML = `
      <div>
        <div class="h-label">Raised so far this year</div>
        <div class="h-big" style="margin-top:6px">${money0(s.raised)}</div>
        <div class="h-bar h-bar--leaf"><i style="width:${Math.min(100, pct).toFixed(1)}%"></i></div>
        <div class="h-sub">${pct.toFixed(1)}% of the ${money0(s.goal)} goal</div>
        <div style="margin-top:10px">${delta}</div>
        <div style="margin-top:16px"><a class="h-link" href="/dashboard/">Open the KPI dashboard ${icon('arrow')}</a></div>
      </div>
      <div><div class="h-label" style="margin-bottom:12px">Team goals</div><div class="h-teams">${teams}</div></div>`;
    if (s.lastUpdated) $('t-fresh').textContent = `The KPI dashboard's own numbers, from Raiser's Edge as of ${et(s.lastUpdated, { hour: 'numeric', minute: '2-digit' })}`;
    $('t-year-wrap').hidden = false;
  }

  fetch('/api/hub/today', { credentials: 'same-origin' })
    .then((r) => r.json())
    .then((d) => {
      if (!d.ok) throw new Error(d.message || 'Could not load.');
      const first = String((d.user && d.user.name) || '').split(' ')[0];
      $('t-hello').textContent = first && d.user.via === 'google' ? `${part}, ${first}` : part;
      cards(d.cards || []);
      mine(d.mine || []);
      feed(d.activity || []);
      if (!d.access || !d.access.kpi) {
        // No KPI numbers for this person: the mission card moves to the side column.
        const card = document.querySelector('[data-mission]');
        const column = $('t-mine-card').parentElement;
        if (card && column) column.insertBefore(card, column.firstChild);
      } else {
        fetch('/api/hub/kpi', { credentials: 'same-origin' })
          .then((r) => r.json())
          .then((k) => {
            if (k.ok && k.summary) year(k.summary);
          })
          .catch(() => {});
      }
    })
    .catch((err) => {
      $('t-cards').innerHTML = `<div class="h-card h-empty" style="grid-column:1 / -1">${esc(err.message)}</div>`;
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
  const card = (title, meta, body) =>
    `<div class="h-card h-day__card"><div class="h-card__head"><div class="h-card__title">${title}</div><div class="h-card__meta">${meta}</div></div><div class="h-card__body">${body}</div></div>`;
  const empty = (t) => `<p class="h-sub">${esc(t)}</p>`;

  const note = new URLSearchParams(location.search).get('google');
  const notes = { connected: 'Google is connected. Your meetings, files and mail now show here.', declined: 'Google was not connected.', 'wrong-account': 'Pick your Favor account when Google asks.', failed: 'Google did not connect. Try again.', expired: 'That took too long. Try again.', 'no-token': 'Google did not hand back access. Try again.' };
  if (note && notes[note]) {
    $('d-sub').textContent = notes[note];
    history.replaceState(null, '', '/');
  }

  fetch('/api/hub/day', { credentials: 'same-origin' })
    .then((r) => r.json())
    .then((d) => {
      grid.removeAttribute('aria-busy');
      const bb = d.blackbaud || {};
      const g = d.google || {};
      const partners = g.partners || {};
      const partnerTag = (email) => (partners[email] ? ` <span class="h-chip h-chip--Foundations" title="In Blackbaud">${esc(partners[email].name)}</span>` : '');

      let actions;
      if (!bb.linked) actions = card('Blackbaud actions', '', empty('Your account is not linked to a fundraiser record in Blackbaud.'));
      else if (!bb.actions.length) actions = card('Blackbaud actions', 'Next 7 days', empty('No open actions due this week.'));
      else
        actions = card(
          'Blackbaud actions',
          bb.overdue ? `<span class="h-status h-status--declined">${bb.overdue} overdue</span>` : 'Next 7 days',
          `<ul class="h-mine">${bb.actions
            .map(
              (a) => `<li><a href="https://host.nxt.blackbaud.com/constituent/records/${esc(a.cid)}?envid=p-5_k5FlbubEyEQnUJw7C9Rw" target="_blank" rel="noopener" title="${esc(a.summary || a.type)}">${esc(a.partner || 'Partner')} · ${esc(a.summary || a.type || a.category)}</a><span class="h-status ${a.due < today ? 'h-status--declined' : 'h-status--wait'}">${esc(et(a.due + 'T12:00:00Z', { month: 'short', day: 'numeric' }))}</span></li>`
            )
            .join('')}</ul>${bb.total > bb.actions.length ? `<p class="h-sub" style="margin-top:8px">${bb.total - bb.actions.length} more in Blackbaud</p>` : ''}`
        );

      if (!g.connected) {
        grid.innerHTML =
          actions +
          `<div class="h-card h-day__connect" style="grid-column:span 2"><div class="h-card__body"><b>See your meetings, files and mail here</b>
            <p class="h-sub" style="margin:6px 0 12px">Connect your Favor Google account once. The hub reads today's calendar, the names of files shared with you, and who emailed you. It never opens an email or a file, and you can disconnect any time.</p>
            <a class="h-btn h-btn--primary h-btn--sm" href="/api/google/connect">Connect my Google</a></div></div>`;
        return;
      }
      const events = g.events
        ? g.events.length
          ? `<ul class="h-mine">${g.events
              .map((e) => {
                const who = e.people.map(partnerTag).join('');
                return `<li><a href="${esc(e.meet || e.link)}" target="_blank" rel="noopener">${e.allDay ? 'All day' : esc(time(e.start))} · ${esc(e.title)}</a>${who}</li>`;
              })
              .join('')}</ul>`
          : empty('Nothing on your calendar today.')
        : empty('Your calendar could not be read just now.');
      const mail = g.mail
        ? g.mail.length
          ? `<ul class="h-mine">${g.mail.slice(0, 6).map((m) => `<li><a href="${esc(m.link)}" target="_blank" rel="noopener" title="${esc(m.subject)}">${esc(m.from)} · ${esc(m.subject)}</a>${partnerTag(m.fromEmail)}</li>`).join('')}</ul>`
          : empty('No unread mail from the last three days.')
        : empty('Your inbox could not be read just now.');
      const files = g.files
        ? g.files.length
          ? `<ul class="h-mine">${g.files.map((f) => `<li><a href="${esc(f.link)}" target="_blank" rel="noopener">${esc(f.name)}</a><span class="h-sub">${esc(f.by)} ${ago(f.modified)}</span></li>`).join('')}</ul>`
          : empty('Nothing new shared with you this week.')
        : empty('Drive could not be read just now.');
      grid.innerHTML =
        actions +
        card('Today’s meetings', '<a class="h-link" href="https://calendar.google.com" target="_blank" rel="noopener">Calendar</a>', events) +
        card('Unread mail', '<a class="h-link" href="https://mail.google.com" target="_blank" rel="noopener">Gmail</a>', mail) +
        card('Shared with you', 'This week', files) +
        `<p class="h-sub h-day__foot" style="grid-column:1 / -1">Google connected. <button type="button" class="h-more" id="d-disconnect">Disconnect</button></p>`;
      $('d-disconnect').addEventListener('click', () =>
        fetch('/api/google/disconnect', { method: 'POST', credentials: 'same-origin' }).then(() => location.reload())
      );
    })
    .catch(() => {
      grid.innerHTML = '<div class="h-card h-empty" style="grid-column:1 / -1">Your day could not load. Refresh to try again.</div>';
    });
})();
