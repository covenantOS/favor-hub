/* Make a request: one box for every ask. The hub suggests where it goes (Will's board, the Marketing
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

  let state = { id: '', words: '', suggested: '' };

  const COPY = {
    board: {
      title: "This goes to Will's request board",
      body: 'Website, portal, hub, dashboard and Blackbaud work goes to Will. A few quick details and it lands in his Inbox, and you get an email when it is done.',
      button: 'Continue',
    },
    marketing: {
      title: 'This goes to the Marketing team',
      body: "Design, print, social, video and newsletter work runs through the Marketing team's request form. Your words are copied, so paste them into the form when it opens.",
      button: 'Open the Marketing request form',
    },
    expense: {
      title: 'This looks like an expense or a purchase',
      body: 'Purchases, travel and reimbursements go on an expense request, so Michael Hinton and Rachel Cox can approve and sign it.',
      button: 'Start an expense request',
    },
  };
  const OTHER = { board: "It's for Will", marketing: "It's for the Marketing team", expense: "It's an expense" };

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

  function fillBoardForm() {
    const words = state.words;
    const firstLine = words.split(/\n/)[0].slice(0, 160);
    const set = (name, value) => {
      const el = form && form.elements.namedItem(name);
      if (el && !el.length) el.value = value;
    };
    set('title', firstLine);
    if (words.length > firstLine.length || words.length > 60) set('should', words);
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
    location.href = '/expenses/new?reason=' + encodeURIComponent(state.words);
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
      state = { id: data.id, words, suggested: data.route };
      show(data.route);
    } catch (err) {
      say(err.message);
    } finally {
      go.disabled = false;
      wait.hidden = true;
    }
  }

  go.addEventListener('click', ask);
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ask();
  });

  function restart() {
    board.hidden = true;
    route.hidden = false;
    result.hidden = true;
    text.value = '';
    state = { id: '', words: '', suggested: '' };
    text.focus();
  }
  const restartBtn = $('route-restart');
  if (restartBtn) restartBtn.addEventListener('click', restart);
  const again = $('req-again');
  if (again) again.addEventListener('click', () => setTimeout(restart, 0));

  // A link can carry the words: /requests/new?text=...
  const preset = new URLSearchParams(location.search).get('text');
  if (preset) text.value = preset;
  text.focus();
})();
