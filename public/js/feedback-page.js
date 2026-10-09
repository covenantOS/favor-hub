/* Feedback page. Staff: their own notes and Will's answers. Will (the hub admin): every note, with
   buttons to mark it seen, fixed or not now, and a reply box whose answer the sender reads here. */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const et = (iso, o) => new Date(iso).toLocaleString('en-US', Object.assign({ timeZone: 'America/New_York' }, o));
  const when = (iso) => (iso ? et(iso, { month: 'short', day: 'numeric' }) + ', ' + et(iso, { hour: 'numeric', minute: '2-digit' }) : '');
  const SOURCE = { hub: 'The hub', brain: 'Ask Favor', 'hub-brain': 'Ask Favor', help: 'Help docs', tour: 'The tour', video: 'A video' };
  const RATING = {
    problem: ["Something's wrong", 'bad'], wrong: ['Answer was wrong', 'bad'], 'not-helpful': ['Not helpful', 'bad'],
    confusing: ['Confusing', 'warn'], missing: ['Something missing', 'warn'],
    idea: ['Idea', 'idea'], right: ['Answer was right', 'good'], praise: ['Works well', 'good'], helpful: ['Helpful', 'good'],
  };
  const STATUS = { new: ['Waiting', 'wait'], seen: ['Read', 'seen'], fixed: ['Fixed', 'done'], 'not-now': ['Not now', 'off'] };
  const list = $('fb-list');
  let admin = false;
  let status = 'new';

  const chip = (r) => (RATING[r] ? `<span class="fbp-chip fbp-chip--${RATING[r][1]}">${esc(RATING[r][0])}</span>` : '');
  const pill = (s) => {
    const [label, cls] = STATUS[s] || STATUS.new;
    return `<span class="fbp-status fbp-status--${cls}">${label}</span>`;
  };
  const initials = (n) => String(n || '').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

  function mine(items) {
    list.removeAttribute('aria-busy');
    if (!items.length) {
      list.innerHTML = `<li class="h-card fbp-empty"><b>No notes yet.</b><span>When something in the hub or Ask Favor is wrong, confusing, or could be better, press <b>Feedback</b> at the top of any page.</span></li>`;
      return;
    }
    list.innerHTML = items
      .map(
        (f) => `<li class="h-card fbp-item${f.unread ? ' is-unread' : ''}">
          <div class="fbp-meta">${chip(f.rating)}<span class="fbp-src">${esc(SOURCE[f.source] || f.source)}</span><time>${esc(when(f.at))}</time>${pill(f.status)}</div>
          ${f.question ? `<p class="fbp-q"><span>Your question</span>${esc(f.question)}</p>` : ''}
          ${f.comment ? `<p class="fbp-text">${esc(f.comment)}</p>` : ''}
          ${f.reply ? `<div class="fbp-reply"><b>Will's answer${f.unread ? ' <em class="h-new">New</em>' : ''}</b><p>${esc(f.reply)}</p><time>${esc(when(f.handled_at))}</time></div>` : ''}
        </li>`
      )
      .join('');
  }

  function all(d) {
    list.removeAttribute('aria-busy');
    const counts = d.counts || {};
    document.querySelectorAll('[data-n]').forEach((s) => (s.textContent = counts[s.dataset.n] ? String(counts[s.dataset.n]) : ''));
    const items = d.items || [];
    if (!items.length) {
      list.innerHTML = `<li class="h-card fbp-empty"><b>${status === 'new' ? 'Nothing new.' : 'No notes here.'}</b><span>Notes from the Feedback button, Ask Favor answers, the help docs and the tour land here.</span></li>`;
      return;
    }
    list.innerHTML = items
      .map(
        (f) => `<li class="h-card fbp-item" data-id="${f.id}">
          <div class="fbp-who"><span class="fbp-av" aria-hidden="true">${esc(initials(f.name || f.email))}</span><div><b>${esc(f.name || f.email)}</b><span>${esc(f.email)}</span></div>
            <div class="fbp-meta">${chip(f.rating)}<span class="fbp-src">${esc(SOURCE[f.source] || f.source)}</span><time>${esc(when(f.at))}</time>${pill(f.status)}</div></div>
          ${f.question ? `<p class="fbp-q"><span>Question${f.ref ? ` · ref ${esc(f.ref)}` : ''}</span>${esc(f.question)}</p>` : ''}
          ${f.reading ? `<p class="fbp-q fbp-q--read"><span>How Ask Favor read it</span>${esc(f.reading)}</p>` : ''}
          ${f.comment ? `<p class="fbp-text">${esc(f.comment)}</p>` : '<p class="fbp-text fbp-text--none">No words, only the rating.</p>'}
          ${f.page ? `<p class="fbp-page">From <a href="${esc(f.page.split(' ')[0])}">${esc(f.page)}</a></p>` : ''}
          <form class="fbp-act" data-act="${f.id}">
            <label class="h-label" for="fb-r-${f.id}">Your answer ${f.reply ? '(they can read this)' : '(optional; they read it on this page)'}</label>
            <textarea id="fb-r-${f.id}" rows="2" maxlength="2000" placeholder="Thanks, fixed it. Or: here's why it works that way.">${esc(f.reply || '')}</textarea>
            <div class="fbp-act__go">
              <button type="submit" class="h-btn h-btn--ghost h-btn--sm" data-set="seen">Mark read</button>
              <button type="submit" class="h-btn h-btn--primary h-btn--sm" data-set="fixed">Fixed</button>
              <button type="submit" class="h-btn h-btn--ghost h-btn--sm" data-set="not-now">Not now</button>
              <button type="submit" class="h-btn h-btn--ghost h-btn--sm" data-set="">Save the answer</button>
              <span class="fbp-msg" role="status"></span>
            </div>
          </form>
        </li>`
      )
      .join('');
  }

  async function load() {
    list.setAttribute('aria-busy', 'true');
    try {
      const path = admin ? 'all?status=' + encodeURIComponent(status) : 'mine';
      const res = await fetch('/api/feedback/' + path, { credentials: 'same-origin' });
      const d = await res.json();
      if (!res.ok || d.ok === false) throw new Error(d.message || 'Could not load the notes.');
      admin ? all(d) : mine(d.items || []);
    } catch (err) {
      list.removeAttribute('aria-busy');
      list.innerHTML = `<li class="h-card fbp-empty"><b>${esc(err.message)}</b></li>`;
    }
  }

  list.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target.closest('[data-act]');
    if (!form) return;
    const set = e.submitter ? e.submitter.dataset.set : '';
    const msg = form.querySelector('.fbp-msg');
    form.querySelectorAll('button').forEach((b) => (b.disabled = true));
    msg.textContent = 'Saving...';
    try {
      const res = await fetch('/api/feedback/' + form.dataset.act, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: set || undefined, reply: form.querySelector('textarea').value }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.ok === false) throw new Error(d.message || 'Did not save.');
      document.dispatchEvent(new CustomEvent('favor:cue', { detail: set === 'fixed' ? 'success' : 'droplet' }));
      msg.textContent = 'Saved.';
      setTimeout(load, 500);
    } catch (err) {
      msg.textContent = err.message;
      form.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  });

  document.querySelectorAll('#fb-tabs [data-status]').forEach((t) =>
    t.addEventListener('click', () => {
      status = t.dataset.status;
      document.querySelectorAll('#fb-tabs [data-status]').forEach((x) => {
        x.classList.toggle('is-on', x === t);
        x.setAttribute('aria-selected', x === t ? 'true' : 'false');
      });
      load();
    })
  );

  document.addEventListener('favor:feedback-sent', () => setTimeout(load, 300));

  const start = (d) => {
    admin = !!(d && d.access && d.access.admin);
    if (admin) {
      $('fb-tabs').hidden = false;
      $('fb-lede').textContent = 'Every note from the hub, Ask Favor, the help docs and the tour. Mark each one, and write an answer when it needs one; the sender reads it on their Feedback page.';
    }
    load();
  };
  if (window.FAVOR_HUB) start(window.FAVOR_HUB);
  else {
    let done = false;
    document.addEventListener('favor-hub', (e) => { if (!done) { done = true; start(e.detail); } }, { once: true });
    setTimeout(() => { if (!done) { done = true; start(window.FAVOR_HUB || null); } }, 4000);
  }
})();
