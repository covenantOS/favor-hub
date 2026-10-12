/* Where a request is. Draws the four stops (Sent, Approved, In progress, Done), who has it, when it is due and what moved last,
   from GET /api/requests/mine, and refreshes while the page is open so a status change shows without a reload. */
(() => {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ET = 'America/New_York';
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: ET, month: 'short', day: 'numeric' }) : '');
  const dueDay = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }) : '');
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: ET });

  function steps(r) {
    return `<ol class="ot-steps" aria-label="Where this request is">${r.steps
      .map((s) => `<li class="ot-step is-${s.state}"${s.state === 'now' ? ' aria-current="step"' : ''}><i class="ot-dot" aria-hidden="true"></i><span class="ot-lab">${esc(s.label)}</span><small>${esc(day(s.at))}</small></li>`)
      .join('')}</ol>`;
  }

  function html(r, opts = {}) {
    const late = r.due_date && r.status !== 'done' && r.status !== 'declined' && r.due_date < today();
    const facts = [
      r.owner ? `<span><b>${esc(r.owner.name)}</b> has it</span>` : r.status === 'inbox' ? '<span>Waiting for review</span>' : '',
      r.due_date && r.status !== 'done' ? `<span class="${late ? 'is-late' : ''}">Due ${esc(dueDay(r.due_date))}${late ? ', past due' : ''}</span>` : '',
      r.waiting_on ? `<span>Waiting on <b>${esc(r.waiting_on.name)}</b></span>` : '',
    ].filter(Boolean);
    const move = r.moves && r.moves[0] ? `<p class="ot-move">${esc(r.moves[0].text)}, ${esc(day(r.moves[0].at))}</p>` : '';
    const declined = `<p class="ot-declined">Declined${r.declined_reason ? `: ${esc(r.declined_reason)}` : ''}</p>`;
    const pill = r.status === 'done' ? 'h-status--done' : r.status === 'declined' ? 'h-status--declined' : r.status === 'inbox' ? 'h-status--wait' : 'h-status--approved';
    return `<article class="ot-req" data-id="${esc(r.id)}">
      <header><a href="${esc(r.href)}">${esc(r.title)}</a><span class="h-status ${pill}">${esc(r.statusWord)}</span></header>
      ${r.status === 'declined' ? declined : steps(r)}
      ${facts.length ? `<p class="ot-facts">${facts.join('')}</p>` : ''}
      ${opts.moves === false ? '' : move}
    </article>`;
  }

  async function load() {
    const res = await fetch('/api/requests/mine', { credentials: 'same-origin' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) throw new Error(d.message || 'Could not read your requests.');
    return d.requests || [];
  }

  /** Draws into `el`. `only` limits it to one request id. Refreshes every 30 seconds while the tab is visible. */
  function mount(el, opts = {}) {
    let timer = 0;
    let stopped = false;
    const paint = async () => {
      try {
        let list = await load();
        if (opts.only) list = list.filter((r) => r.id === opts.only);
        if (opts.limit) list = list.slice(0, opts.limit);
        if (stopped) return;
        el.innerHTML = list.map((r) => html(r, opts)).join('');
        el.hidden = !list.length;
        if (opts.onload) opts.onload(list);
      } catch (_) {
        // a dropped connection keeps what is on screen
      }
    };
    const tick = () => {
      clearTimeout(timer);
      if (stopped) return;
      timer = setTimeout(async () => {
        if (document.visibilityState === 'visible') await paint();
        tick();
      }, 30000);
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !stopped) paint();
    });
    paint();
    tick();
    return { refresh: paint, stop: () => { stopped = true; clearTimeout(timer); } };
  }

  window.FavorReqTrack = { load, html, mount, steps };
})();
