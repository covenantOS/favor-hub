/* Make a request: one box for every ask. The hub suggests where it goes (the request board, the Marketing
   team's Asana form, or an expense request) and the person confirms or picks another. */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MARKETING_FORM = 'https://form.asana.com/?k=ZLVP4wa-hVh36WUjOH4FyQ&d=1200803238481574';

  const text = $('route-text');
  const go = $('route-go');
  const wait = $('route-wait');
  const msg = $('route-msg');
  const result = $('route-result');
  const route = $('route');
  const board = $('route-board');
  const form = $('req-form');
  if (!text || !go) return;

  let state = { id: '', words: '', suggested: '', fill: null };

  const COPY = {
    board: {
      title: 'This goes to the request board',
      body: 'You get an email when it is done.',
      button: 'Continue',
    },
    marketing: {
      title: 'This goes to the Marketing team',
      body: 'Your words are copied. Paste them into the form when it opens.',
      button: 'Open the Marketing request form',
    },
    expense: {
      title: 'This looks like an expense or a purchase',
      body: 'Purchases, travel and reimbursements go on an expense request.',
      button: 'Start an expense request',
    },
  };
  const PROJECT_COPY = (p) => ({
    title: 'This goes to the Marketing team',
    body: `Your words become a task in ${p.name}, and the team sees it right away.`,
    button: 'Send to Marketing',
  });
  const OTHER = { board: "It's for the request board", marketing: "It's for the Marketing team", expense: "It's an expense" };

  function say(text) {
    msg.textContent = text || '';
    msg.hidden = !text;
  }

  function show(where) {
    state.suggested = where;
    const c = COPY[where];
    const others = Object.keys(COPY).filter((k) => k !== where);
    result.dataset.route = where;
    result.innerHTML =
      `<h3>${esc(c.title)}</h3><p>${esc(c.body)}</p>` +
      `<div class="h-route__row"><button type="button" class="h-btn h-btn--primary" data-choose="${where}">${esc(c.button)}</button></div>` +
      `<div class="h-route__alt">Not right?${others.map((k) => `<button type="button" data-switch="${k}">${esc(OTHER[k])}</button>`).join(' or')}</div>`;
    const f = state.fill;
    if (f && f.owner && where !== 'board') {
      result.querySelector('h3').insertAdjacentHTML('afterend', '<p class="h-sub" id="route-owner">Likely owner: <b>' + esc(f.owner.name) + '</b>' + (f.due_date ? ', suggested due ' + esc(dayLong(f.due_date)) : '') + '. ' + esc(f.owner.why) + '.</p>');
    }
    result.hidden = false;
    result.querySelector('[data-choose]').addEventListener('click', () => choose(where));
    result.querySelectorAll('[data-switch]').forEach((b) => b.addEventListener('click', () => show(b.dataset.switch)));
    result.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function record(chosen) {
    if (!state.id) return;
    fetch('/api/requests/route', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: state.id, chosen }),
    }).catch(() => {});
  }

  const radio = (name, value) => {
    const nodes = [...form.querySelectorAll('input[name="' + name + '"]')];
    const hit = nodes.find((n) => n.value === value);
    if (!hit) return;
    nodes.forEach((n) => { n.checked = n === hit; });
    hit.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const KIND = { change: 'Change something', add: 'Add something new', other: 'Other' };
  const SURFACE = { website: 'Website', portal: 'Portal', dashboard: 'FavorOS', app: 'App' };
  const dayLong = (d) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }) : '');

  /** Puts the suggested answers into the form and lists them beside it. The person changes anything that is wrong. */
  function applyFill(f) {
    const card = $('of-card');
    if (!f || !form) { if (card) card.hidden = true; return; }
    const set = (name, value) => {
      const el = form.elements.namedItem(name);
      if (el && !el.length && value) el.value = value;
    };
    radio('kind', f.kind);
    radio('surface', f.surface);
    set('title', f.title);
    set('page_url', f.page_url);
    set('now', f.now);
    if (f.should) set('should', f.should);
    set('details', f.details);
    radio('audience', f.audience);
    radio('needed', f.needed);
    if (f.needed === 'By a date') set('needed_date', f.needed_date);
    if (!card) return;
    const row = (k, v, small) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + (small ? '<small>' + esc(small) + '</small>' : '') + '</dd></div>';
    card.innerHTML =
      '<h3>Filled in from your words</h3><dl>' +
      row('Kind', KIND[f.kind] || f.kind, f.why && f.why.kind ? 'Because ' + f.why.kind : '') +
      row('Where', SURFACE[f.surface] || f.surface, f.why && f.why.surface ? 'Because ' + f.why.surface : '') +
      row('Needed', f.needed === 'By a date' ? 'By ' + dayLong(f.needed_date) : f.needed, f.why && f.why.needed ? 'Because ' + f.why.needed : '') +
      (f.owner ? row('Likely owner', f.owner.name, (f.due_date ? 'Due ' + dayLong(f.due_date) + '. ' : '') + f.owner.why) : f.due_date ? row('Due', dayLong(f.due_date)) : '') +
      '</dl>';
    card.hidden = false;
  }

  function fillBoardForm() {
    const words = state.words;
    const firstLine = words.split(/\n/)[0].slice(0, 160);
    const set = (name, value) => {
      const el = form && form.elements.namedItem(name);
      if (el && !el.length) el.value = value;
    };
    set('title', firstLine);
    if (words.length > firstLine.length || words.length > 60) set('should', words);
    applyFill(state.fill);
    if (form) form.dataset.routeId = state.id || '';
    const hub = window.FAVOR_HUB;
    const user = hub && hub.user;
    if (user && user.via === 'google') {
      set('name', user.name || '');
      set('email', user.email || '');
      ['name', 'email'].forEach((n) => {
        const el = form.elements.namedItem(n);
        const wrap = el && el.closest('.req-field');
        if (wrap) wrap.hidden = true;
      });
    }
  }

  async function choose(where) {
    record(where);
    if (where === 'board') {
      fillBoardForm();
      route.hidden = true;
      board.hidden = false;
      window.scrollTo({ top: 0 });
      return;
    }
    if (where === 'marketing') {
      try {
        await navigator.clipboard.writeText(state.words);
      } catch {
        // The form still opens; the words stay in the box above to copy by hand.
      }
      window.open(MARKETING_FORM, '_blank', 'noopener');
      result.insertAdjacentHTML(
        'beforeend',
        '<p class="h-sub" style="margin-top:12px">The Marketing form opened in a new tab, and your words are copied. Paste them into the form there.</p>'
      );
      return;
    }
    location.href = '/expenses/new/?reason=' + encodeURIComponent(state.words);
  }

  async function ask() {
    const words = text.value.trim();
    say('');
    if (words.length < 2) {
      say('Say a little about what you need.');
      text.focus();
      return;
    }
    go.disabled = true;
    wait.hidden = false;
    try {
      const res = await fetch('/api/requests/route', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: words }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.message || 'Something went wrong. Try again.');
      state = { id: data.id, words, suggested: data.route, fill: data.fill || null };
      show(data.route);
      go.hidden = true;
    } catch (err) {
      say(err.message);
    } finally {
      go.disabled = false;
      wait.hidden = true;
    }
  }

  go.addEventListener('click', ask);
  text.addEventListener('input', () => {
    if (go.hidden) {
      go.hidden = false;
      result.hidden = true;
    }
  });
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ask();
  });
  // On a phone the keyboard's Go key reads the words, like Send in Messages.
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && window.matchMedia('(pointer: coarse)').matches) {
      e.preventDefault();
      if (!go.hidden && !go.disabled) ask();
    }
  });

  function restart() {
    board.hidden = true;
    route.hidden = false;
    result.hidden = true;
    text.value = '';
    go.hidden = false;
    state = { id: '', words: '', suggested: '', fill: null };
    if ($('of-card')) $('of-card').hidden = true;
    text.focus();
  }
  const restartBtn = $('route-restart');
  if (restartBtn) restartBtn.addEventListener('click', restart);
  const again = $('req-again');
  if (again) again.addEventListener('click', () => setTimeout(restart, 0));

  // Example asks fill the box, so a first-time user sees how much to write.
  document.querySelectorAll('[data-eg]').forEach((b) =>
    b.addEventListener('click', () => {
      text.value = b.dataset.eg;
      text.focus();
    })
  );

  // The person's own requests, beside the box, with where each one is. It refreshes while the page is open.
  const mineList = $('mine-list');
  if (mineList && window.FavorReqTrack) {
    window.FavorReqTrack.mount(mineList, { limit: 6, onload: (list) => { const card = $('mine-card'); if (card) card.hidden = !list.length; } });
  }

  // A link can carry the words: /requests/new?text=...
  const preset = new URLSearchParams(location.search).get('text');
  if (preset) text.value = preset;
  // A phone opens its keyboard on focus, which would cover the page before anyone has read it.
  if (!window.matchMedia('(pointer: coarse)').matches) text.focus();
})();
