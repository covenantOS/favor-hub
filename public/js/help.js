/* Help docs: search across every article and video caption, the "For your work" picks, the video
   topic filter, and "Was this helpful?". Search loads /help/search.json the first time someone types. */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cue = (n) => document.dispatchEvent(new CustomEvent('favor:cue', { detail: n }));

  // ---- Who is reading -------------------------------------------------------------------------
  const tagsOf = (d) => {
    const a = (d && d.access) || {};
    const teams = (d && d.kpiTeams) || [];
    const t = new Set(['all', ...teams]);
    if (a.admin) t.add('admin');
    if (a.approver || a.expenseLog) t.add('approver');
    if (a.kpi) t.add('kpi');
    if (teams.length >= 5) t.add('leader');
    return t;
  };
  const ADMIN_ONLY = (f) => f.length && f.every((x) => x === 'admin' || x === 'approver');
  const whenHub = (fn) => {
    if (window.FAVOR_HUB) return fn(window.FAVOR_HUB);
    let done = false;
    document.addEventListener('favor-hub', (e) => { if (!done) { done = true; fn(e.detail); } }, { once: true });
    setTimeout(() => { if (!done) { done = true; fn(window.FAVOR_HUB || null); } }, 4000);
  };

  whenHub((d) => {
    const tags = tagsOf(d);
    // Admin-only articles stay out of everyone else's lists.
    document.querySelectorAll('[data-for]').forEach((el) => {
      const f = el.dataset.for.split(' ').filter(Boolean);
      if (ADMIN_ONLY(f) && !f.some((x) => tags.has(x))) el.hidden = true;
    });
    const box = $('hd-foryou');
    if (!box) return;
    const NAMES = { rdd: 'RDDs', pc: 'Partner Care', ce: 'Church Engagement', grants: 'Grants', marketing: 'Marketing', admin: 'the hub admin', approver: 'expense approvers', leader: 'leadership', kpi: 'dashboard users' };
    const picks = [];
    document.querySelectorAll('.hd-topic li[data-for]').forEach((li) => {
      const f = li.dataset.for.split(' ');
      if (li.hidden || f.includes('all')) return;
      if (f.some((x) => tags.has(x))) picks.push(li.querySelector('a'));
    });
    const starters = ['getting-started', 'ask-favor', 'feedback'].map((id) => document.querySelector(`[data-doc="${id}"]`)).filter(Boolean);
    const list = [...picks, ...starters].slice(0, 6);
    if (!list.length) return;
    const mine = [...tags].filter((t) => NAMES[t] && t !== 'kpi');
    $('hd-foryou-who').textContent = mine.length ? 'Picked for ' + mine.map((t) => NAMES[t]).slice(0, 3).join(', ') : 'Good places to start';
    $('hd-foryou-list').innerHTML = list
      .map((a) => `<a class="h-card hd-card" href="${esc(a.getAttribute('href'))}"><b>${esc(a.textContent)}</b><span>${esc(a.dataset.summary || '')}</span></a>`)
      .join('');
    box.hidden = false;
  });

  // ---- Search ---------------------------------------------------------------------------------
  const q = $('hd-q');
  const out = $('hd-results');
  let index = null;
  let loading = null;
  let picked = 0;
  const load = () =>
    loading ||
    (loading = fetch('/help/search.json', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => (index = d.map((x) => ({ ...x, _t: x.title.toLowerCase(), _s: x.summary.toLowerCase(), _h: x.heads.join(' ').toLowerCase(), _x: x.text.toLowerCase() }))))
      .catch(() => (index = [])));

  const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'on', 'how', 'do', 'i', 'my', 'is', 'and', 'or', 'for', 'what', 'can', 'it', 'with', 'where']);
  const words = (s) => s.toLowerCase().replace(/[^a-z0-9$.' ]+/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));

  function score(item, ws) {
    let total = 0;
    for (const w of ws) {
      let s = 0;
      if (item._t.includes(w)) s += item._t.split(/\W+/).some((t) => t.startsWith(w)) ? 12 : 8;
      if (item._h.includes(w)) s += 5;
      if (item._s.includes(w)) s += 4;
      const n = item._x.split(w).length - 1;
      if (n) s += Math.min(6, 1 + n * 0.6);
      if (!s) return 0;
      total += s;
    }
    if (item.kind === 'doc') total += 0.5;
    return total;
  }

  function snippet(item, ws) {
    const t = item.text;
    const low = item._x;
    let at = -1;
    for (const w of ws) {
      at = low.indexOf(w);
      if (at >= 0) break;
    }
    if (at < 0) return esc(item.summary);
    const start = Math.max(0, at - 60);
    let s = (start ? '...' : '') + t.slice(start, at + 140) + (at + 140 < t.length ? '...' : '');
    s = esc(s);
    for (const w of ws) s = s.replace(new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>');
    return s;
  }

  async function search() {
    const text = q.value.trim();
    if (text.length < 2) {
      out.hidden = true;
      out.innerHTML = '';
      return;
    }
    await load();
    const ws = words(text);
    if (!ws.length) return;
    const hits = index
      .map((x) => [x, score(x, ws)])
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    picked = 0;
    out.hidden = false;
    out.innerHTML = hits.length
      ? hits
          .map(
            ([x], i) => `<a class="hd-hit${i === 0 ? ' is-on' : ''}" href="${esc(x.url)}">
              <span class="hd-hit__kind hd-hit__kind--${x.kind}">${x.kind === 'video' ? 'Video' : 'Article'}</span>
              <b>${esc(x.title)}</b><small>${esc(x.topic)}</small>
              <span class="hd-hit__snip">${snippet(x, ws)}</span></a>`
          )
          .join('')
      : `<div class="hd-nohit"><b>Nothing matches "${esc(text)}".</b><span>Try another word, or <button type="button" class="hd-linkbtn" data-feedback="help" data-title="What were you looking for?">tell us what you were looking for</button>.</span></div>`;
  }

  if (q && out) {
    let t = 0;
    q.addEventListener('focus', load, { once: true });
    q.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(search, 90);
    });
    q.addEventListener('keydown', (e) => {
      const hits = [...out.querySelectorAll('.hd-hit')];
      if (!hits.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        picked = (picked + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
        hits.forEach((h, i) => h.classList.toggle('is-on', i === picked));
        hits[picked].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        location.href = hits[picked].getAttribute('href');
      } else if (e.key === 'Escape') {
        q.value = '';
        search();
      }
    });
    // On the help page, / goes to this search box instead of opening the hub search.
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && !e.target.closest('input,textarea,select,[contenteditable]')) {
        e.preventDefault();
        e.stopPropagation();
        q.focus();
      }
    }, true);
    const pre = new URLSearchParams(location.search).get('q');
    if (pre) {
      q.value = pre;
      search();
    }
  }

  // ---- Video topics ---------------------------------------------------------------------------
  document.querySelectorAll('.hd-chips [data-topic]').forEach((chip) =>
    chip.addEventListener('click', () => {
      const t = chip.dataset.topic;
      document.querySelectorAll('.hd-chips [data-topic]').forEach((c) => {
        c.classList.toggle('is-on', c === chip);
        c.setAttribute('aria-selected', c === chip ? 'true' : 'false');
      });
      document.querySelectorAll('.hd-vids--lib .hd-vid').forEach((v) => (v.hidden = !!t && v.dataset.topic !== t));
    })
  );

  // ---- Was this helpful? ----------------------------------------------------------------------
  document.querySelectorAll('[data-rate]').forEach((box) =>
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-rate-v]');
      if (!b) return;
      const rating = b.dataset.rateV;
      const what = box.dataset.rate;
      const source = what.startsWith('video:') ? 'video' : 'help';
      const send = (comment) =>
        fetch('/api/feedback', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source, rating, comment: comment || '', page: location.pathname }),
        });
      if (rating === 'helpful') {
        box.innerHTML = '<span>Thanks. Glad it helped.</span>';
        cue('droplet');
        send('').catch(() => {});
        return;
      }
      box.innerHTML = `<form class="hd-why"><label for="hd-why">What was missing or unclear?</label><textarea id="hd-why" rows="3" maxlength="1200" placeholder="A step that's missing, a word that doesn't match the screen, a question it didn't answer"></textarea><div><button type="submit" class="h-btn h-btn--primary h-btn--sm">Send</button></div></form>`;
      const f = box.querySelector('form');
      f.querySelector('textarea').focus();
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        f.querySelector('button').disabled = true;
        try {
          const r = await send(f.querySelector('textarea').value.trim());
          if (!r.ok) throw new Error();
          box.innerHTML = '<span>Thanks. Will reads every note and fixes the article.</span>';
          cue('success');
        } catch {
          f.querySelector('button').disabled = false;
          box.insertAdjacentHTML('beforeend', '<p class="hd-err">Did not send. Try again.</p>');
        }
      });
    })
  );
})();
