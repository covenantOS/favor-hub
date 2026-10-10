/* Favor Brain page: a full-window chat. Your chats on the left (kept 30 days), the conversation in the
   middle, a side panel for large tables. The Brain answers in blocks (public/js/brain-blocks.js draws
   them); every call goes through /api/brain, so the Brain keeps the access rules and this page only
   says who is asking. */
(() => {
  const B = window.BrainBlocks;
  const $ = (id) => document.getElementById(id);
  const { esc, ic } = B;
  const cue = (name) => document.dispatchEvent(new CustomEvent('favor:cue', { detail: name }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DAY = 864e5;

  // ---- State -----------------------------------------------------------------------------------------
  let me = null; // /api/brain/me
  let convs = []; // the chat list
  let cur = null; // { id, title, turns: [] }
  let busy = null; // { conv, ctl, stop }
  let answered = 0;
  let searchSeq = 0;
  let found = null; // chat ids matching the search box (questions included)
  const SHEETS = [];
  const app = $('bc-app');
  const hubApp = $('h-app');

  const api = async (path, opt = {}) => {
    const res = await fetch('/api/brain/' + path, {
      method: opt.method || (opt.body ? 'POST' : 'GET'),
      credentials: 'same-origin',
      headers: opt.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opt.body ? JSON.stringify(opt.body) : undefined,
      signal: opt.signal,
      keepalive: !!opt.keepalive,
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.ok === false) {
      const err = new Error(d.message || d.error || 'The Brain did not answer (' + res.status + ').');
      err.ref = d.ref;
      err.status = res.status;
      throw err;
    }
    return d;
  };
  const has = (k) => !!(me && (me.packages || []).some((p) => p.key === k && p.has));
  const canRequest = (k) => !!(me && (me.packages || []).some((p) => p.key === k && !p.has && p.requestable));
  const pending = (k) => !!(me && (me.requests || []).some((r) => r.package === k && r.status === 'pending'));
  const canSheets = () => has('sheets') && !!window.FavorSheets;
  const firstName = () => {
    const n = (window.FAVOR_HUB && window.FAVOR_HUB.user && window.FAVOR_HUB.user.name) || (() => { try { return (JSON.parse(localStorage.getItem('favor.hub.nav.v1') || '{}').user || {}).name; } catch { return ''; } })() || '';
    return String(n || '').split(/\s+/)[0] || '';
  };
  const hourET = () => Number(new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false })) % 24;

  // ---- Toast, dialog, popover ---------------------------------------------------------------------------
  function toast(msg, link) {
    const t = $('bc-toast');
    t.innerHTML = ic('check') + esc(msg) + (link ? ` <a href="${esc(link.href)}" target="_blank" rel="noopener" style="color:#d7e8cc;font-weight:600;margin-left:6px">${esc(link.label)}</a>` : '');
    t.classList.add('is-on');
    t.style.pointerEvents = link ? 'auto' : 'none';
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('is-on'), link ? 6000 : 2400);
  }
  let dlgFrom = null;
  function dlg(html) {
    dlgFrom = document.activeElement;
    $('bc-dlg').innerHTML = html;
    $('bc-dlg').classList.add('is-on');
    $('bc-scrim').classList.add('is-on');
    setTimeout(() => { const f = $('bc-dlg').querySelector('textarea, button'); if (f) f.focus(); }, 60);
  }
  function closeDlg() {
    $('bc-dlg').classList.remove('is-on');
    $('bc-scrim').classList.remove('is-on');
    if (dlgFrom && dlgFrom.focus) dlgFrom.focus();
  }
  let popEl = null;
  function pop(anchor, html, onPick) {
    closePop();
    popEl = document.createElement('div');
    popEl.className = 'pop';
    popEl.setAttribute('role', 'menu');
    popEl.innerHTML = html;
    $('bc-portal').appendChild(popEl);
    const r = anchor.getBoundingClientRect(), pw = popEl.offsetWidth, ph = popEl.offsetHeight;
    const x = Math.min(r.left, innerWidth - pw - 10);
    let y = r.bottom + 6;
    if (y + ph > innerHeight - 10) y = r.top - ph - 6 >= 10 ? r.top - ph - 6 : Math.max(10, innerHeight - ph - 10);
    popEl.style.left = Math.max(10, x) + 'px';
    popEl.style.top = Math.max(10, y) + 'px';
    popEl.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      const v = b.dataset.v;
      closePop();
      onPick(v, b);
    });
    popEl.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const bs = [...popEl.querySelectorAll('button')], i = bs.indexOf(document.activeElement);
      bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length].focus();
    });
    const first = popEl.querySelector('button.is-on') || popEl.querySelector('button');
    if (first) first.focus();
    popEl._anchor = anchor;
    anchor.setAttribute('aria-expanded', 'true');
  }
  function closePop(refocus) {
    if (!popEl) return;
    const a = popEl._anchor;
    if (a) a.setAttribute('aria-expanded', 'false');
    popEl.remove();
    popEl = null;
    if (refocus && a && a.focus) a.focus();
  }

  // ---- Turns ---------------------------------------------------------------------------------------------
  // A new chat gets its id here, so the server can save the question under it the moment it is sent.
  const newId = () => 'c_' + Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
  const newCur = () => ({ id: newId(), title: 'New chat', turns: [] });
  const LAST = 'favor.brain.last';
  const remember = (id) => { try { localStorage.setItem(LAST, JSON.stringify({ id, at: Date.now() })); } catch { /* not kept */ } };
  /** A turn from the Brain's reply to a question asked now. */
  function fromReply(q, d) {
    return {
      q, ref: d.ref, at: new Date().toISOString(), blocks: d.blocks || [], reading: Array.isArray(d.reading) ? d.reading : [], follow: d.follow || [], lists: d.lists || [],
      markdown: d.markdown || d.text || '', intent: d.intent, outcome: d.outcome, asked_as: d.asked_as || q, hint: d.hint === 'connect', extras: [], rated: null,
    };
  }
  /** A turn from a stored thread (answer_json is the Brain's StoredAnswer). */
  function fromStored(t) {
    const a = t.answer || {};
    if (a.pending) return { q: t.question, ref: null, at: t.at, blocks: null, reading: [], follow: [], lists: [], markdown: '', pending: true, extras: [], rated: null, stored: true };
    if (a.error) return { q: t.question, ref: t.ref, at: t.at, blocks: null, error: a.error, reading: [], follow: [], lists: [], markdown: '', extras: [], rated: null, stored: true };
    return { q: t.question, ref: t.ref, at: t.at, blocks: a.blocks || [], reading: Array.isArray(a.reading) ? a.reading : [], follow: a.follow || [], lists: a.lists || [], markdown: '', intent: a.intent, outcome: a.outcome, asked_as: a.asked_as || t.question, hint: false, extras: [], rated: null, stored: true };
  }
  const fresh = (t) => !t.stored || Date.now() - new Date(t.at).getTime() < DAY;
  const lastGood = () => {
    if (!cur) return '';
    for (let i = cur.turns.length - 1; i >= 0; i--) {
      const t = cur.turns[i];
      if (t.blocks && t.outcome === 'ok') return t.asked_as || t.q;
    }
    return '';
  };

  function answerHTML(t, ti, latest) {
    const ok = !fresh(t);
    let h = '';
    if (t.error) h += `<div class="blk-text"><p class="bc-err">${esc(t.error)}</p></div>`;
    else if (t.stopped) h += '<div class="blk-text"><p>Stopped. Ask again when you are ready.</p></div>';
    else if (!t.blocks || !t.blocks.length) h += B.fallback(t.markdown || 'No answer was kept for this one. Ask again.');
    else
      h += t.blocks.map((b, bi) => B.render(b, { ti, bi, canSheets: canSheets(), canRequest: (k) => canRequest(k) && !pending(k), expired: ok })).join('');
    for (const x of t.extras || []) h += B.render(x, { ti, bi: -1, canSheets: canSheets() });
    h += B.reading(t.reading, ti);
    if (latest && t.follow && t.follow.length && !t.error) h += `<div class="blk-follow" aria-label="Follow-up questions">${t.follow.map((q) => `<button type="button" class="fu" data-act="ask" data-q="${esc(q)}">${ic('arrow')}${esc(q)}</button>`).join('')}</div>`;
    if (t.connectCard && connected === false && promptsOn()) h += `<div class="bc-cardline">${ic('link')}<span>Ask this in Claude next time.</span><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-act="connect">Connect</button><button type="button" class="ib ib--sm ib--bare x" data-act="card-x" data-turn="${ti}" aria-label="Hide this">${ic('close')}</button></div>`;
    if (t.hint) h += `<div class="hintline">${ic('spark')}<span>You can ask the same questions from another app you already use.</span><button type="button" class="lnk" data-act="connect">Show me how</button><button type="button" class="ib ib--sm ib--bare x" data-act="hint-x" data-turn="${ti}" aria-label="Hide this">${ic('close')}</button></div>`;
    const r = t.rated;
    // An answer with figures in it says when the Blackbaud copy it read was last synced.
    const nums = !t.error && !t.stopped && (t.blocks || []).some((b) => ['tiles', 'money', 'int', 'pct', 'score', 'chart', 'team', 'table'].includes(b.type));
    h += `<div class="m-foot"><button type="button" class="ib ib--sm ib--bare tip" data-act="acopy" data-turn="${ti}" aria-label="Copy the answer" data-tip="Copy">${ic('copy')}</button>
      <button type="button" class="ib ib--sm ib--bare tip" data-act="alink" data-turn="${ti}" aria-label="Copy link to this chat" data-tip="Copy link">${ic('link')}</button>
      <button type="button" class="ib ib--sm ib--bare tip${r === 'right' ? ' is-done' : ''}" data-act="aup" data-turn="${ti}" aria-label="Right" data-tip="Right" aria-pressed="${r === 'right'}"${t.ref ? '' : ' disabled'}>${ic('up')}</button>
      <button type="button" class="ib ib--sm ib--bare tip${r === 'wrong' ? ' is-done' : ''}" data-feedback="hub-brain" data-rating="wrong" data-ref="${esc(t.ref || '')}" data-question="${esc(t.q)}" aria-label="Not right" data-tip="Not right" aria-pressed="${r === 'wrong'}"${t.ref ? '' : ' disabled'}>${ic('down')}</button>
      <button type="button" class="ib ib--sm ib--bare tip" data-act="again" data-turn="${ti}" aria-label="Ask again" data-tip="Ask again">${ic('redo')}</button>
      ${nums ? '<span class="copy-stamp" data-copy-stamp></span>' : ''}${r === 'wrong' ? '<span class="told">Will has your note</span>' : r === 'right' ? '<span class="told">Thanks</span>' : ''}${t.ref ? `<span class="ref">Answer ref ${esc(t.ref)}</span>` : ''}</div>`;
    return h;
  }
  function qHTML(t, ti, latest) {
    if (t.editing)
      return `<div class="m-q" style="width:min(80%,620px)"><div class="bc-compose" style="width:100%;border-radius:20px"><textarea data-edit="${ti}" aria-label="Edit your question" style="height:auto" maxlength="600">${esc(t.q)}</textarea></div><div style="display:flex;gap:6px"><button type="button" class="h-btn h-btn--ghost h-btn--xs" data-act="edit-cancel" data-turn="${ti}">Cancel</button><button type="button" class="h-btn h-btn--primary h-btn--xs" data-act="edit-save" data-turn="${ti}">Ask</button></div></div>`;
    return `<div class="m-q"><div class="m-q__b">${esc(t.q)}</div><div class="m-q__acts"><button type="button" class="ib ib--sm ib--bare tip" data-act="qcopy" data-turn="${ti}" aria-label="Copy the question" data-tip="Copy">${ic('copy')}</button>${latest && !busy ? `<button type="button" class="ib ib--sm ib--bare tip" data-act="edit" data-turn="${ti}" aria-label="Edit the question" data-tip="Edit">${ic('edit')}</button>` : ''}</div></div>`;
  }
  const thinkHTML = (status) => `<div class="m-think" id="bc-think"><div class="m-a__av" aria-hidden="true">${ic('spark')}</div><div><div class="m-think__st"><i></i><i></i><i></i><span id="bc-think-st">${esc(status)}</span></div><div class="sk"><i style="width:72%"></i><i style="width:54%"></i><div class="t"><i></i><i></i><i></i></div><i class="r"></i></div></div></div>`;

  const STARTERS = () => {
    const s = [];
    const role = String((me && me.role) || '').toLowerCase();
    if (has('iwave')) s.push(['spark', 'Can you pull iWave data?', 'Ratings, coverage and credits', 1], ['gauge', 'High capacity partners who are not yet major', 'Strong capacity band, never $1,000 at once', 1]);
    s.push(['coin', 'How is Favor doing this year?', 'Raised, goal and the same date last year']);
    s.push(['chart', role.includes('partner care') ? 'How is Partner Care doing against goal?' : 'How is the RDD team doing this year?', 'Quarters, months and goal']);
    if (has('partners')) s.push(['list', 'List lapsed major partners in Texas', 'Last gift 12 to 24 months ago']);
    s.push(['book', 'How do I enter a check gift?', 'Steps from the Operations Manual']);
    if (has('iwave')) s.push(['users', 'Screen active major partners who have no iWave rating', 'See the count and the credits first', 1]);
    s.push(['info', 'What can you do?', 'Everything you can ask about']);
    return s.slice(0, 6);
  };
  function emptyHTML() {
    const hr = hourET();
    const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    const n = firstName();
    return `<div class="bc-empty"><div class="bc-mark">${ic('spark')}</div><h1>${greet}${n ? ', ' + esc(n) : ''}</h1><p>Ask about partners, giving, every team's numbers, iWave ratings, actions and the manuals.</p>
      <div class="bc-starters">${STARTERS().map(([i, q, s, g], k) => `<button type="button" class="bc-starter" data-act="ask" data-q="${esc(q)}" style="animation-delay:${80 + k * 50}ms"><span class="bc-starter__i${g ? ' g' : ''}">${ic(i)}</span><b>${esc(q)}</b><span>${esc(s)}</span></button>`).join('')}</div>
      <div class="bc-cando">Not sure what to ask? <button type="button" data-act="ask" data-q="What can you do?">See everything you can ask about</button></div></div>`;
  }

  function renderThread(opts = {}) {
    const th = $('bc-thread');
    if (!cur || !cur.turns.length) {
      th.innerHTML = busy ? thinkHTML(busy.status) : emptyHTML();
      $('bc-title').textContent = 'New chat';
      return;
    }
    $('bc-title').textContent = cur.title;
    const working = !!(busy && busy.conv === cur) || cur.turns.some((t) => t.pending);
    th.innerHTML = cur.turns.map((t, ti) => {
      const latest = ti === cur.turns.length - 1;
      const waiting = (t.pending || (busy && busy.conv === cur)) && latest && !t.blocks && !t.error && !t.stopped;
      return `<div class="turn" style="display:contents">${qHTML(t, ti, latest)}${waiting ? '' : `<div class="m-a"><div class="m-a__av" aria-hidden="true">${ic('spark')}</div><div class="m-a__body" data-abody="${ti}">${answerHTML(t, ti, latest)}</div></div>`}</div>`;
    }).join('') + (working ? thinkHTML(busy ? busy.status : 'Looking at the records') : '');
    if (opts.noAnim) th.querySelectorAll('.m-q, .m-a, .m-a__body > *').forEach((e) => (e.style.animation = 'none'));
    B.drawCharts(th);
    B.countUp(th, opts.noAnim);
  }
  function rerenderTurn(ti, opts = {}) {
    const el = document.querySelector(`[data-abody="${ti}"]`);
    if (!el) return renderThread(opts);
    el.innerHTML = answerHTML(cur.turns[ti], ti, ti === cur.turns.length - 1);
    if (opts.noAnim) el.querySelectorAll(':scope > *').forEach((e) => (e.style.animation = 'none'));
    B.drawCharts(el);
    B.countUp(el, opts.noAnim);
  }
  function scrollToQ() {
    const sc = $('bc-scroll'), qs = sc.querySelectorAll('.m-q'), last = qs[qs.length - 1];
    if (last) sc.scrollTop += last.getBoundingClientRect().top - sc.getBoundingClientRect().top - 16;
  }
  function setSend() {
    const b = $('bc-send'), v = $('bc-input').value.trim();
    if (busy) {
      b.classList.add('is-stop');
      b.disabled = false;
      b.innerHTML = ic('stop');
      b.setAttribute('aria-label', 'Stop');
    } else {
      b.classList.remove('is-stop');
      b.disabled = v.length < 2;
      b.innerHTML = ic('send');
      b.setAttribute('aria-label', 'Send');
    }
  }
  const titleOf = (q) => {
    const t = q.replace(/[?.!]+$/, '');
    return t.length > 44 ? t.slice(0, 42) + '...' : t.charAt(0).toUpperCase() + t.slice(1);
  };

  // ---- Connect prompts: a banner until connected, a card on every tenth answer, and the account menu ----------
  // Only people who have not authorized the Favor Brain connector see them. The Brain says whether they have
  // (the connector route); while that is unknown, nothing shows. "Not now" hides the banner for 24 hours.
  // PROMPTS_LIVE stays false until Will has seen the screens; ?prompts=1 previews them.
  const PROMPTS_LIVE = false;
  // The preview flag is read once: asking a question rewrites the URL to ?c=, which would drop it.
  const PREVIEW = /[?&]prompts=1\b/.test(location.search);
  const promptsOn = () => PROMPTS_LIVE || PREVIEW;
  const LATER = 'favor.brain.connect.later';
  const ANSWERS = 'favor.brain.answers';
  const DAY_MS = 24 * 3600 * 1000;
  let connected = null; // true, false, or null while the Brain has not said
  async function loadConnector() {
    try {
      const d = await api('connector');
      connected = !!d.connected;
    } catch {
      connected = null;
    }
    renderBanner();
  }
  function notNowAgain() {
    try {
      const t = Number(localStorage.getItem(LATER) || 0);
      return !!t && Date.now() - t < DAY_MS;
    } catch {
      return false;
    }
  }
  function renderBanner() {
    const b = $('bc-connect');
    if (!b) return;
    b.hidden = !(promptsOn() && connected === false && !notNowAgain());
  }
  function connectNotNow() {
    try { localStorage.setItem(LATER, String(Date.now())); } catch { /* not kept */ }
    renderBanner();
  }
  /** Counts a good answer in this browser; true on every tenth one. */
  function tenthAnswer() {
    try {
      const n = Number(localStorage.getItem(ANSWERS) || 0) + 1;
      localStorage.setItem(ANSWERS, String(n));
      return n % 10 === 0;
    } catch {
      return false;
    }
  }

  // ---- Asking ---------------------------------------------------------------------------------------------
  /** opt: { intent, rerun: { ref, key, value }, at: turn index to replace in place, fromBox } */
  async function ask(q, opt = {}) {
    q = String(q || '').trim();
    if ((q.length < 2 && !opt.rerun) || busy) return;
    if (!cur) cur = newCur();
    const conv = cur;
    const replacing = opt.at != null;
    let turn;
    if (replacing) {
      turn = conv.turns[opt.at];
      turn.blocks = null; turn.error = null; turn.stopped = false; turn.extras = []; turn.rated = null;
    } else {
      turn = { q, blocks: null, extras: [], reading: [], follow: [] };
      conv.turns.push(turn);
      if (conv.turns.length === 1) conv.title = titleOf(q);
    }
    const mine = (busy = { conv, ctl: new AbortController(), status: 'Reading your question', stop: false });
    setSend();
    renderThread({ noAnim: true });
    const t1 = setTimeout(() => { mine.status = 'Looking at the records'; const s = $('bc-think-st'); if (s && busy === mine) s.textContent = mine.status; }, 1800);
    const t2 = setTimeout(() => { mine.status = 'Putting the answer together'; const s = $('bc-think-st'); if (s && busy === mine) s.textContent = mine.status; }, 5000);
    if (!replacing) scrollToQ();
    const body = { question: q, v: 2 };
    body.conv = conv.id;
    remember(conv.id);
    if (cur === conv) history.replaceState(null, '', '?c=' + encodeURIComponent(conv.id));
    const prev = replacing ? (conv.turns.slice(0, opt.at).reverse().find((x) => x.blocks && x.outcome === 'ok') || {}).asked_as : lastGoodBefore(conv, conv.turns.length - 1);
    if (prev) body.previous = prev;
    if (opt.intent) body.intent = opt.intent;
    if (opt.rerun) body.rerun = opt.rerun;
    try {
      const d = await api('ask', { body, signal: mine.ctl.signal, keepalive: true });
      if (!d.ref) d.ref = '';
      const t = fromReply(q || turn.q, d);
      Object.assign(turn, t, { q: turn.q || q });
      turn.hint = false;
      if (d.outcome === 'ok' && !(d.blocks || []).some((b) => b.type === 'choice')) {
        answered++;
        if (tenthAnswer()) turn.connectCard = true;
      }
      cue('droplet');
    } catch (err) {
      if (err.name === 'AbortError') turn.stopped = true;
      else {
        turn.error = err.message;
        turn.ref = err.ref;
      }
    } finally {
      clearTimeout(t1);
      clearTimeout(t2);
    }
    if (busy === mine) busy = null;
    setSend();
    if (cur === conv) {
      renderThread({ noAnim: replacing });
      if (!replacing) scrollToQ();
    } else if (!cur || cur.id !== conv.id) {
      // The person is in another chat. The answer is saved on this one; tell them it landed.
      if (!turn.stopped) toast('Your answer is ready in "' + conv.title + '"');
    }
    loadHistory();
  }
  const lastGoodBefore = (conv, n) => {
    for (let i = n - 1; i >= 0; i--) {
      const t = conv.turns[i];
      if (t.blocks && t.outcome === 'ok') return t.asked_as || t.q;
    }
    return '';
  };
  function stop() {
    if (busy) busy.ctl.abort();
  }
  /** A chat opened while its last answer is still being made: read the stored chat until the answer lands. */
  function pollPending(c) {
    const mine = (busy = { conv: c, ctl: new AbortController(), status: 'Looking at the records', stop: false });
    setSend();
    const end = () => { if (busy === mine) busy = null; setSend(); };
    (async () => {
      for (let i = 0; i < 150; i++) {
        await sleep(i < 3 ? 1200 : 2500);
        if (cur !== c || busy !== mine) return;
        if (mine.ctl.signal.aborted) {
          const t = c.turns[c.turns.length - 1];
          if (t && t.pending) { t.pending = false; t.stopped = true; }
          end();
          renderThread({ noAnim: true });
          return;
        }
        try {
          const d = await api('thread/' + encodeURIComponent(c.id));
          if (cur !== c || busy !== mine) return;
          const turns = (d.turns || []).map(fromStored);
          if (turns.length >= c.turns.length) c.turns = turns;
          if (!c.turns.some((t) => t.pending)) {
            end();
            renderThread({ noAnim: false });
            scrollToQ();
            cue('droplet');
            loadHistory();
            return;
          }
        } catch (err) {
          if (err.status === 404) { end(); return; }
        }
      }
      if (cur === c && busy === mine) {
        const t = c.turns[c.turns.length - 1];
        if (t && t.pending) { t.pending = false; t.error = 'This answer is taking too long. Ask again.'; }
        end();
        renderThread({ noAnim: true });
      }
    })();
  }

  async function rerun(ti, key, value) {
    const t = cur.turns[ti];
    const body = document.querySelector(`[data-abody="${ti}"]`);
    if (body) {
      const keep = body.querySelector('.blk-read');
      body.querySelectorAll(':scope > :not(.blk-read):not(.m-foot)').forEach((n) => n.remove());
      if (keep) {
        keep.insertAdjacentHTML('beforebegin', '<div class="sk" style="margin:0"><i style="width:66%"></i><div class="t"><i></i><i></i><i></i></div><i class="r"></i></div>');
        keep.querySelectorAll('.chip').forEach((c) => (c.disabled = true));
      }
    }
    await ask(t.q, { at: ti, rerun: { ref: t.ref || '', key, value }, intent: undefined });
  }

  // ---- Chat list (history) ------------------------------------------------------------------------------
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  function groupOf(c) {
    if (c.pinned) return 'Pinned';
    const d = new Date(c.changed_at), today = startOfDay(new Date());
    const day = startOfDay(d);
    if (day >= today) return 'Today';
    if (day >= today - DAY) return 'Yesterday';
    if (day >= today - 7 * DAY) return 'Previous 7 days';
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  }
  function renderRail() {
    const q = $('bc-find').value.trim().toLowerCase();
    let list = convs;
    if (q) list = convs.filter((c) => c.title.toLowerCase().includes(q) || (found && found.has(c.id)));
    const order = [];
    const groups = new Map();
    for (const c of list) {
      const g = groupOf(c);
      if (!groups.has(g)) { groups.set(g, []); order.push(g); }
      groups.get(g).push(c);
    }
    const pri = ['Pinned', 'Today', 'Yesterday', 'Previous 7 days'];
    order.sort((a, b) => (pri.indexOf(a) < 0 ? 99 : pri.indexOf(a)) - (pri.indexOf(b) < 0 ? 99 : pri.indexOf(b)));
    let h = '';
    for (const g of order) {
      h += `<div class="bc-grp">${esc(g)}</div>`;
      h += groups.get(g).map((c) => c.renaming
        ? `<div class="bc-conv" role="listitem"><input data-rename="${esc(c.id)}" value="${esc(c.title)}" aria-label="Rename the chat" maxlength="80" /></div>`
        : `<div class="bc-conv${cur && cur.id === c.id ? ' is-on' : ''}" role="listitem"><button type="button" class="bc-conv__go" data-act="conv" data-id="${esc(c.id)}">${c.pending || (cur && cur.id === c.id && busy && busy.conv === cur) ? '<i class="bc-conv__work" role="img" aria-label="Answering"></i>' : ''}${c.pinned ? ic('pin', 'h-i bc-conv__pin') + ' ' : ''}${esc(c.title)}</button><button type="button" class="bc-conv__more" data-act="convmore" data-id="${esc(c.id)}" aria-label="Options for ${esc(c.title)}" aria-haspopup="menu">${ic('more')}</button></div>`).join('');
    }
    if (!h) h = `<div class="bc-norail">${q ? 'No chats match.' : 'Your chats show here for 30 days.'}</div>`;
    $('bc-convs').innerHTML = h;
    $('bc-sheets').innerHTML = SHEETS.length ? SHEETS.slice(0, 3).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${ic('sheet')}<span style="overflow:hidden;text-overflow:ellipsis">${esc(s.title)}</span></a>`).join('') : '<div class="bc-sheets-empty">Sheets you make show here.</div>';
    const inp = document.querySelector('[data-rename]');
    if (inp) { inp.focus(); inp.select(); }
  }
  async function loadHistory() {
    try {
      const d = await api('history');
      const renaming = convs.find((c) => c.renaming);
      convs = (d.threads || []).map((c) => ({ ...c, renaming: renaming && renaming.id === c.id }));
      // The Brain may have titled the open chat after its answer; the header follows the list.
      const open = cur && convs.find((c) => c.id === cur.id);
      if (open && open.title !== cur.title && !cur.renaming) { cur.title = open.title; $('bc-title').textContent = open.title; }
      renderRail();
      clearTimeout(loadHistory.t);
      if (convs.some((c) => c.pending)) loadHistory.t = setTimeout(loadHistory, 3500);
    } catch {
      /* the list stays as it was */
    }
  }
  async function loadSheets() {
    try {
      const res = await fetch('/api/sheets/recent', { credentials: 'same-origin' });
      const d = await res.json();
      if (d.ok) { SHEETS.splice(0, SHEETS.length, ...(d.sheets || [])); renderRail(); }
    } catch {
      /* nothing to list */
    }
  }
  async function searchChats(q) {
    const seq = ++searchSeq;
    if (q.length < 2) { found = null; renderRail(); return; }
    try {
      const d = await api('history?q=' + encodeURIComponent(q));
      if (seq !== searchSeq) return;
      found = new Set((d.threads || []).map((c) => c.id));
      renderRail();
    } catch {
      /* keep the title matches */
    }
  }
  async function openConv(id) {
    // An answer still being made keeps going on the server; this chat just stops waiting for it.
    busy = null;
    setSend();
    closePop();
    try {
      const d = await api('thread/' + encodeURIComponent(id));
      cur = { id: d.thread.id, title: d.thread.title, turns: (d.turns || []).map(fromStored) };
      history.replaceState(null, '', '?c=' + encodeURIComponent(id));
      remember(id);
      renderRail();
      renderThread({ noAnim: false });
      $('bc-scroll').scrollTop = 0;
      if (cur.turns.some((t) => t.pending)) { pollPending(cur); renderThread({ noAnim: true }); }
      closeRailOver();
      closePanel();
    } catch (err) {
      toast(err.status === 404 ? 'That chat is gone.' : err.message);
      if (err.status === 404) { convs = convs.filter((c) => c.id !== id); renderRail(); }
    }
  }
  function startNew() {
    busy = null;
    cur = null;
    history.replaceState(null, '', location.pathname);
    renderRail();
    renderThread();
    setSend();
    $('bc-input').focus();
    closeRailOver();
    closePanel();
  }
  async function convAction(c, v, anchor) {
    if (v === 'rename') { c.renaming = true; renderRail(); return; }
    if (v === 'pin') {
      c.pinned = !c.pinned;
      renderRail();
      toast(c.pinned ? 'Pinned' : 'Unpinned');
      try { await api('thread/' + encodeURIComponent(c.id), { method: 'PATCH', body: { pinned: c.pinned } }); } catch (e) { c.pinned = !c.pinned; renderRail(); toast(e.message); }
      return;
    }
    if (v === 'del') {
      pop(anchor, `<div class="pop__h">Delete this chat?</div><button type="button" role="menuitem" data-v="yes" class="danger">${ic('trash')}Delete &ldquo;${esc(c.title.slice(0, 24))}&rdquo;</button><button type="button" role="menuitem" data-v="no">Keep it</button>`, async (w) => {
        if (w !== 'yes') return;
        const row = anchor.closest('.bc-conv');
        if (row) row.classList.add('is-gone');
        try { await api('thread/' + encodeURIComponent(c.id), { method: 'DELETE' }); } catch (e) { toast(e.message); renderRail(); return; }
        setTimeout(() => {
          convs = convs.filter((x) => x !== c);
          if (cur && cur.id === c.id) startNew();
          renderRail();
          toast('Chat deleted');
        }, 240);
      });
    }
  }
  async function finishRename(c, value, save) {
    c.renaming = false;
    const t = value.trim();
    if (save && t && t !== c.title) {
      const old = c.title;
      c.title = t.slice(0, 80);
      if (cur && cur.id === c.id) { cur.title = c.title; $('bc-title').textContent = c.title; }
      try { await api('thread/' + encodeURIComponent(c.id), { method: 'PATCH', body: { title: c.title } }); } catch (e) { c.title = old; toast(e.message); }
    }
    renderRail();
  }

  // ---- Rail, panel and focus -------------------------------------------------------------------------------
  const wide = () => innerWidth >= 1360;
  function closeRailOver() { app.classList.remove('rail-over'); syncRailBtn(); }
  function syncRailBtn() {
    const open = wide() ? !app.classList.contains('no-rail') : app.classList.contains('rail-over');
    $('bc-railbtn').setAttribute('aria-expanded', String(open));
    $('bc-rail-x').style.display = !wide() ? '' : 'none';
  }
  function setFocus(on) {
    hubApp.classList.toggle('is-focus', on);
    $('bc-focus').setAttribute('aria-pressed', String(on));
    const m = $('h-menu');
    if (m) m.setAttribute('aria-expanded', String(!on));
    setTimeout(() => B.drawCharts($('bc-thread')), 340);
  }
  let panelKind = null;
  async function openPanel(kind, id) {
    const inn = $('bc-panel-in');
    panelKind = kind;
    if (kind === 'table') {
      const tb = B.TB[id];
      inn.innerHTML = `<div class="bc-panel__h"><div style="min-width:0;flex:1"><div class="t">${esc(tb.title)}</div><div class="s" data-pcnt="${id}"></div></div><button type="button" class="ib" data-act="pclose" aria-label="Close the panel">${ic('close')}</button></div>
        <div class="bc-panel__tools"><div class="tbl__find">${ic('search')}<input type="search" placeholder="Filter these rows" data-tfind="${id}" aria-label="Filter these rows" value="${esc(tb.q)}" /></div>${tb.expired ? '' : B.toolsHTML(tb, true, tb.canSheets)}</div>
        ${tb.chips && tb.chips.length ? `<div style="padding:10px 18px 0">${B.chipsHTML(tb, `data-pchips="${id}" style="padding:0"`)}</div>` : ''}
        <div class="bc-panel__body" style="margin-top:10px;border-top:1px solid var(--h-line)"><div class="tbl__scroll" data-tbbody="${id}">${B.tableInner(tb, true)}</div></div>`;
      B.refreshTable(id);
      if (wide() && !app.classList.contains('no-rail')) { app.classList.add('no-rail'); app.dataset.railBack = '1'; syncRailBtn(); }
      if (tb.partial && tb.token && !tb.expired && !tb.loaded) fullRows(tb);
    } else if (kind === 'access') {
      inn.innerHTML = `<div class="bc-panel__h"><div style="flex:1"><div class="t">What you can ask about</div><div class="s">${esc((me && me.role) || '')}</div></div><button type="button" class="ib" data-act="pclose" aria-label="Close the panel">${ic('close')}</button></div><div class="bc-panel__body access">${accessHTML()}</div>`;
    } else if (kind === 'connect') {
      inn.innerHTML = `<div class="bc-panel__h"><div style="flex:1"><div class="t">Connect Claude or ChatGPT</div><div class="s">The same answers, inside the app you already use</div></div><button type="button" class="ib" data-act="pclose" aria-label="Close the panel">${ic('close')}</button></div><div class="bc-panel__body access">${connectHTML()}</div>`;
    }
    app.classList.toggle('panel-full', kind === 'table');
    app.classList.add('has-panel');
    const f = inn.querySelector('button, input');
    setTimeout(() => f && f.focus(), 60);
  }
  function closePanel() {
    app.classList.remove('has-panel', 'panel-full');
    panelKind = null;
    if (app.dataset.railBack) { delete app.dataset.railBack; app.classList.remove('no-rail'); syncRailBtn(); }
  }
  async function fullRows(tb) {
    const el = document.querySelector(`.bc-panel [data-tbbody="${tb.id}"]`);
    if (el) el.insertAdjacentHTML('afterbegin', '<div class="bc-empty-note" data-loading>Loading the full list...</div>');
    try {
      const d = await api('list/read', { body: { tokens: [tb.token] } });
      const l = (d.lists || [])[0];
      if (l && l.rows) {
        tb.rows = l.rows.map((r) => (r.place || !(r.city || r.state) ? r : { ...r, place: [r.city, r.state].filter(Boolean).join(', ') }));
        tb.count = tb.rows.length;
        tb.more = !!l.more;
        tb.partial = false;
        tb.loaded = true;
        B.refreshTable(tb.id);
      }
    } catch (e) {
      tb.expired = true;
      toast(e.status === 410 ? 'That list expired. Ask again.' : e.message);
    }
    document.querySelectorAll('[data-loading]').forEach((n) => n.remove());
  }
  const PKG_ROWS = [['partners', 'user', 'Partners and giving', 'Records, lists, gifts and who holds them'], ['contacts', 'mail', 'Contact details', 'Emails, phones and addresses in lists'], ['iwave', 'gauge', 'iWave ratings', 'Capacity, propensity, coverage, screening'], ['all_teams', 'chart', 'Every team\'s numbers', 'Every team tab, not only yours'], ['sheets', 'sheet', 'Google Sheets', 'Open any list as a sheet in your Drive'], ['basics', 'book', 'The manuals and your team', 'Every procedure, definitions and your team\'s numbers']];
  function accessHTML() {
    const pk = (me && me.packages) || [];
    const rows = PKG_ROWS.map(([k, i, l, s]) => {
      const p = pk.find((x) => x.key === k);
      if (!p) return '';
      return `<div class="pk"><div class="pk__i${p.has ? '' : ' off'}">${k === 'sheets' ? '<svg class="h-i"><use href="#bci-sheet"/></svg>' : ic(i)}</div><b>${esc(l)}</b><small>${esc(s)}${p.until ? ' &middot; until ' + esc(B.dlong(String(p.until).slice(0, 10))) : ''}</small>${p.has ? '<span class="tag l">Yours</span>' : pending(k) ? '<span class="state wait"><i></i>Waiting for Will</span>' : p.requestable ? `<button type="button" class="h-btn h-btn--ghost h-btn--xs" data-act="access-form" data-pkg="${esc(k)}">Ask Will</button>` : '<span class="tag">Not part of your access</span>'}</div>`;
    }).join('');
    return rows + `<form class="bc-pkgform" id="bc-pkgform" hidden><label for="bc-pkg">Ask Will for</label><select id="bc-pkg"></select><label for="bc-why">Why your work needs it</label><input id="bc-why" maxlength="300" placeholder="For example: I call lapsed partners in my region" required /><label for="bc-days">For how long</label><select id="bc-days"><option value="7">A week</option><option value="30" selected>A month</option><option value="90">Three months</option><option value="365">A year</option></select><div style="display:flex;gap:8px"><button type="submit" class="h-btn h-btn--primary h-btn--sm">Send the request</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-act="access-cancel">Cancel</button></div><p class="bc-msg" id="bc-pkgmsg" role="status"></p></form>`;
  }
  function connectHTML() {
    return `<div class="bc-apps" role="tablist"><button type="button" role="tab" class="is-on" aria-selected="true" data-act="apptab" data-app="claude">Claude</button><button type="button" role="tab" aria-selected="false" data-act="apptab" data-app="chatgpt">ChatGPT</button></div>
      <div class="bc-addr"><code id="bc-url">https://mcp.favorintl.org/mcp</code><button type="button" class="h-btn h-btn--primary h-btn--sm" data-act="copy-url">Copy</button></div>
      <div class="steps" style="padding:12px 0 0" data-app-panel="claude"><ol>
        <li><div>Favor has a Claude organization. Ask the technology team for a Favor Claude seat first.</div></li>
        <li><div>Open <b>claude.ai</b> or the Claude app, then <b>Customize</b> and <b>Connectors</b>.</div></li>
        <li><div>In the Favor organization, <b>Favor</b> is already listed under <b>Yours</b>: press <b>Connect</b>. On your own account, press <b>+ Add</b>, then <b>Add custom connector</b>, name it <b>Favor</b>, paste the address and press <b>Continue</b>.</div></li>
        <li><div>Press <b>Continue with Google</b> and sign in with your Favor Google account.</div></li>
        <li><div>Press <b>Favor</b> in your list and change <b>Read-only tools</b> from <b>Needs approval</b> to <b>Always allow</b>. Then ask a question.</div></li></ol></div>
      <div class="steps" style="padding:12px 0 0" data-app-panel="chatgpt" hidden><ol>
        <li><div>This needs ChatGPT Business, Enterprise or Edu, or a Pro plan. On the free and Plus plans, use Claude.</div></li>
        <li><div>Turn on <b>Developer mode</b> under <b>Settings</b>, <b>Apps</b>, <b>Advanced settings</b>.</div></li>
        <li><div>Under <b>Apps</b>, press <b>Create</b>. Name it <b>Favor</b>, paste the address, choose <b>OAuth</b>, press <b>Scan Tools</b>, sign in with your Favor Google account, then <b>Create</b>.</div></li>
        <li><div>In a chat, pick <b>Favor</b> from the tools menu.</div></li></ol></div>
      <p style="margin:14px 0 0;font-size:12.5px;color:var(--h-ink-3)">Claude's free plan allows one custom connector, which is all you need. <a href="/help/connect-your-ai/" style="color:var(--h-brand-ink)">Step by step, with pictures</a></p>`;
  }

  // ---- Sheets ----------------------------------------------------------------------------------------------------
  function tableTurn(id) {
    for (let i = cur.turns.length - 1; i >= 0; i--) if (document.querySelector(`[data-abody="${i}"] [data-tbwrap="${id}"]`)) return i;
    return cur.turns.length - 1;
  }
  const sheetBtns = (id) => document.querySelectorAll(`[data-sheetbtn="${id}"]`);
  async function doSheet(id, ti, granted) {
    const tb = B.TB[id];
    if (!tb || !window.FavorSheets) return;
    sheetBtns(id).forEach((b) => { b.disabled = true; b.innerHTML = '<span class="spin d"></span><span>Creating the sheet</span>'; });
    const filtered = Object.keys(tb.f).length || tb.q;
    const turn = cur.turns[ti];
    const spec = tb.token && !filtered && !tb.expired
      ? { mode: 'brain', tokens: [tb.token], dedupe: 'brain:' + tb.token, title: tb.sheet_title || tb.title, provenance: { kind: 'brain', page: '/brain/', asked: turn ? turn.q : '' } }
      : { mode: 'rows', tabs: [B.sheetTab(tb)], title: tb.sheet_title || tb.title, provenance: { kind: 'screen', page: '/brain/', asked: turn ? turn.q : '', filters: filtered ? 'Filtered: ' + Object.entries(tb.f).map(([k, v]) => k + ' ' + v).concat(tb.q ? ['search ' + tb.q] : []).join(', ') : '' } };
    const r = await window.FavorSheets.run(spec, { navigate: false });
    const restore = () => sheetBtns(id).forEach((b) => { b.disabled = false; b.innerHTML = `${ic('sheet')}<span>Open in Google Sheets</span>`; });
    if (r.ok) {
      restore();
      sheetBtns(id).forEach((b) => { const a = document.createElement('a'); a.className = 'h-btn h-btn--primary h-btn--xs'; a.href = r.url; a.target = '_blank'; a.rel = 'noopener'; a.innerHTML = ic('ext') + '<span>Open the sheet</span>'; b.replaceWith(a); });
      if (turn) {
        turn.extras = (turn.extras || []).filter((x) => x.type !== 'consent');
        turn.extras.push({ type: 'sheet', title: r.title, url: r.url, rows: (r.tabs || []).reduce((n, t) => n + t.rows, 0), private: r.private !== false });
        rerenderTurn(ti, { noAnim: true });
      }
      SHEETS.unshift({ title: r.title, url: r.url });
      renderRail();
      toast('Your sheet is ready in Google Drive', { href: r.url, label: 'Open it' });
      cue('success');
      return;
    }
    restore();
    if (r.error === 'consent' || r.error === 'not_connected') {
      if (turn) {
        turn.extras = (turn.extras || []).filter((x) => x.type !== 'consent');
        turn.extras.push({ type: 'consent', consent_url: r.consentUrl || r.connectUrl, _spec: spec });
        closePanel();
        rerenderTurn(ti, { noAnim: true });
        const c = document.querySelector(`[data-abody="${ti}"] [data-extra="consent"]`);
        if (c) c.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
      }
      return;
    }
    toast(r.message || 'The sheet did not build. The CSV still works.');
  }

  // ---- Events ----------------------------------------------------------------------------------------------------
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } };
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (popEl && !e.target.closest('.pop') && !popEl._anchor.contains(e.target)) closePop();
    if (!el || !app.contains(el) && !el.closest('#bc-portal')) return;
    const act = el.dataset.act;
    const ti = el.dataset.turn != null ? +el.dataset.turn : null;
    if (el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault();
    switch (act) {
      case 'ask': ask(el.dataset.q, { intent: el.dataset.intent || undefined }); break;
      case 'ask-again': { const t = cur.turns[ti]; ask(t.asked_as || t.q, { at: ti }); break; }
      case 'choose': {
        const b = cur.turns[ti].blocks[+el.dataset.bi];
        if (b) b._picked = +el.dataset.k;
        rerenderTurn(ti, { noAnim: true });
        ask(el.dataset.q, { intent: el.dataset.intent || undefined });
        break;
      }
      case 'else': $('bc-input').focus(); break;
      case 'sort': {
        const tb = B.TB[el.dataset.tb], k = el.dataset.k;
        if (tb.sort === k) tb.dir = tb.dir === 'asc' ? 'desc' : 'asc';
        else { tb.sort = k; const c = tb.cols.find((c) => c.key === k); tb.dir = c && ['name', 'text', 'date'].includes(c.type) && c.type !== 'date' ? 'asc' : 'desc'; }
        B.refreshTable(tb.id);
        const nb = document.querySelector(`.bc-panel [data-act="sort"][data-tb="${tb.id}"][data-k="${k}"]`) || document.querySelector(`[data-act="sort"][data-tb="${tb.id}"][data-k="${k}"]`);
        if (nb) nb.focus();
        break;
      }
      case 'fchip': {
        const tb = B.TB[el.dataset.tb], k = el.dataset.k;
        const label = (tb.chips.find((c) => c.key === k) || {}).label || k;
        pop(el, `<div class="pop__h">${esc(label)}</div>` + B.chipValues(tb, k).slice(0, 40).map(([v, n]) => `<button type="button" role="menuitem" data-v="${esc(v)}">${esc(v)}<span style="margin-left:auto;color:var(--h-ink-3);font-size:12px">${n}</span></button>`).join(''), (v) => { tb.f[k] = v; B.refreshTable(tb.id); });
        break;
      }
      case 'fclear': { const tb = B.TB[el.dataset.tb]; delete tb.f[el.dataset.k]; B.refreshTable(tb.id); break; }
      case 'tclear': { const tb = B.TB[el.dataset.tb]; tb.f = {}; tb.q = ''; B.refreshTable(tb.id); break; }
      case 'tcopy': { const tb = B.TB[el.dataset.tb]; const ok = await copy(B.tsv(tb)); toast(ok ? `Copied ${B.tableRows(tb).length} rows. Paste into any sheet.` : 'Your browser would not copy. Use CSV.'); break; }
      case 'tcsv': {
        const tb = B.TB[el.dataset.tb];
        if (tb.csv && tb.partial && !Object.keys(tb.f).length && !tb.q) { const a = document.createElement('a'); a.href = tb.csv; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); toast('Downloading the CSV. The link works for 24 hours.'); break; }
        const url = URL.createObjectURL(new Blob(['﻿' + B.csv(tb)], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url; a.download = String(tb.sheet_title || tb.title || 'list').replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-') + '.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        toast('Downloading the rows you see.');
        break;
      }
      case 'tsheet': doSheet(el.dataset.tb, tableTurn(el.dataset.tb)); break;
      case 'pexport': {
        const b = cur.turns[ti].blocks[+el.dataset.bi];
        if (!b || !window.FavorSheets) break;
        el.disabled = true;
        const s = b.stats || {};
        const rows = [{ partner: b.name, place: b.place || '', holder: b.holder ? b.holder.name : '', lifetime: s.lifetime || 0, last_gift: s.last_gift ? s.last_gift.amount : null, last_gift_date: s.last_gift ? s.last_gift.date : null, largest_gift: s.largest ? s.largest.amount : null }];
        const spec = { mode: 'rows', title: 'Partner ' + b.name, tabs: [{ name: 'Partner', columns: [{ key: 'partner', label: 'Partner', type: 'text' }, { key: 'place', label: 'Place', type: 'text' }, { key: 'holder', label: 'Held by', type: 'text' }, { key: 'lifetime', label: 'Lifetime giving', type: 'money' }, { key: 'last_gift', label: 'Last gift', type: 'money' }, { key: 'last_gift_date', label: 'Last gift date', type: 'date' }, { key: 'largest_gift', label: 'Largest gift', type: 'money' }].concat((b.years || []).map((y) => ({ key: 'y' + y.y, label: 'Given in ' + y.y, type: 'money' }))), rows: rows.map((r) => Object.assign(r, Object.fromEntries((b.years || []).map((y) => ['y' + y.y, y.amount])))) }], provenance: { kind: 'screen', page: '/brain/', asked: cur.turns[ti].q } };
        const r = await window.FavorSheets.run(spec, { navigate: false });
        el.disabled = false;
        if (r.ok) { toast('Partner exported to a sheet in your Drive', { href: r.url, label: 'Open it' }); SHEETS.unshift({ title: r.title, url: r.url }); renderRail(); }
        else if (r.error === 'consent' || r.error === 'not_connected') { const t = cur.turns[ti]; t.extras = (t.extras || []).filter((x) => x.type !== 'consent'); t.extras.push({ type: 'consent', consent_url: r.consentUrl || r.connectUrl, _spec: spec }); rerenderTurn(ti, { noAnim: true }); }
        else toast(r.message || 'The sheet did not build.');
        break;
      }
      case 'consent-go': {
        const t = cur.turns[ti];
        const x = (t.extras || []).find((x) => x.type === 'consent') || (t.blocks || [])[+el.dataset.bi];
        if (!x) break;
        el.disabled = true;
        el.innerHTML = '<span class="spin"></span>Opening Google';
        const toks = (t.lists || []).map((l) => l.token).filter(Boolean).slice(0, 3);
        window.FavorSheets.consent(x._spec || (toks.length ? { mode: 'brain', tokens: toks, dedupe: 'brain:' + toks.join(','), title: 'Favor Brain list', provenance: { kind: 'brain', page: '/brain/', asked: t.q } } : null), x.consent_url);
        break;
      }
      case 'consent-no': {
        const t = cur.turns[ti];
        t.extras = (t.extras || []).filter((x) => x.type !== 'consent');
        const bi = +el.dataset.bi;
        if (bi >= 0 && t.blocks[bi] && t.blocks[bi].type === 'consent') t.blocks.splice(bi, 1);
        rerenderTurn(ti, { noAnim: true });
        toast('No sheet made. The CSV still works.');
        break;
      }
      case 'topen': openPanel('table', el.dataset.tb); break;
      case 'pclose': closePanel(); break;
      case 'rchip': {
        const t = cur.turns[ti], r = t.reading[+el.dataset.k];
        pop(el, `<div class="pop__h">${esc(r.label)}</div>` + r.options.map((o) => `<button type="button" role="menuitem" data-v="${esc(o)}" class="${o === r.value ? 'is-on' : ''}">${esc(o)}</button>`).join(''), (v) => { if (v !== r.value) rerun(ti, r.key, v); });
        break;
      }
      case 'cf': {
        const t = cur.turns[ti], b = t.blocks[+el.dataset.bi];
        if (!b || b._busy) break;
        b._busy = el.dataset.do;
        rerenderTurn(ti, { noAnim: true });
        try {
          const d = await api('confirm', { body: { id: b.id, action: el.dataset.do } });
          const was = b.kind;
          t.blocks.splice(+el.dataset.bi, 1, ...(d.blocks || []));
          if (was === 'iwave_refresh' && (d.blocks || []).some((x) => x.type === 'confirm' && x.status === 'done')) {
            const p = t.blocks.find((x) => x.type === 'partner');
            t.follow = p ? ['Show the new rating for ' + p.name] : t.follow;
            if (p && p.lookup) t.follow = ['Tell me about lookup ' + p.lookup];
          }
          cue(el.dataset.do === 'approve' ? 'success' : 'droplet');
        } catch (err) {
          b._busy = null;
          toast(err.message);
        }
        rerenderTurn(ti, { noAnim: true });
        break;
      }
      case 'access-ask': {
        const t = cur.turns[ti], b = t.blocks[+el.dataset.bi];
        el.disabled = true;
        try {
          await api('request', { body: { package: el.dataset.pkg, reason: 'Asked from an answer: ' + String(t.q).slice(0, 200), days: 30 } });
          if (b) b._state = 'asked';
          if (me) me.requests = (me.requests || []).concat([{ package: el.dataset.pkg, status: 'pending' }]);
          toast('Sent to Will');
          cue('success');
        } catch (err) { toast(err.message); }
        rerenderTurn(ti, { noAnim: true });
        break;
      }
      case 'access-form': {
        const f = $('bc-pkgform');
        if (!f) break;
        $('bc-pkg').innerHTML = ((me && me.packages) || []).filter((p) => !p.has && p.requestable && !pending(p.key)).map((p) => `<option value="${esc(p.key)}"${p.key === el.dataset.pkg ? ' selected' : ''}>${esc(p.label)}</option>`).join('');
        f.hidden = false;
        $('bc-why').focus();
        break;
      }
      case 'access-cancel': $('bc-pkgform').hidden = true; break;
      case 'apptab': {
        document.querySelectorAll('[data-act="apptab"]').forEach((b) => { const on = b === el; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', String(on)); });
        document.querySelectorAll('[data-app-panel]').forEach((p) => (p.hidden = p.dataset.appPanel !== el.dataset.app));
        break;
      }
      case 'copy-url': { const ok = await copy($('bc-url').textContent.trim()); el.textContent = ok ? 'Copied' : 'Press Ctrl C'; if (!ok) { const r = document.createRange(); r.selectNodeContents($('bc-url')); getSelection().removeAllRanges(); getSelection().addRange(r); } setTimeout(() => (el.textContent = 'Copy'), 2000); break; }
      case 'acopy': {
        const t = cur.turns[ti];
        const body = document.querySelector(`[data-abody="${ti}"]`);
        const ok = await copy(t.markdown || (body ? body.innerText : ''));
        toast(ok ? 'Answer copied' : 'Your browser would not copy.');
        break;
      }
      case 'alink': {
        if (!cur || !cur.id) { toast('The link is ready once this answer is saved.'); break; }
        const ok = await copy(location.origin + '/brain/?c=' + encodeURIComponent(cur.id));
        toast(ok ? 'Link copied. Only you can open it.' : 'Your browser would not copy.');
        break;
      }
      case 'qcopy': { const ok = await copy(cur.turns[ti].q); toast(ok ? 'Question copied' : 'Your browser would not copy.'); break; }
      case 'aup': {
        const t = cur.turns[ti];
        if (!t.ref || t.rated) break;
        try {
          const res = await fetch('/api/feedback', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'hub-brain', rating: 'right', ref: t.ref, page: '/brain/' }) });
          if (!res.ok) throw new Error();
          t.rated = 'right';
          cue('droplet');
        } catch { toast('That did not send. Try again.'); }
        rerenderTurn(ti, { noAnim: true });
        break;
      }
      case 'again': { const t = cur.turns[ti]; if (!busy) ask(t.asked_as || t.q, { at: ti }); break; }
      case 'edit': cur.turns[ti].editing = true; renderThread({ noAnim: true }); { const ta = document.querySelector(`[data-edit="${ti}"]`); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } break;
      case 'edit-cancel': cur.turns[ti].editing = false; renderThread({ noAnim: true }); break;
      case 'edit-save': saveEdit(ti); break;
      case 'hint-x': cur.turns[ti].hint = false; rerenderTurn(ti, { noAnim: true }); break;
      case 'connect': openPanel('connect'); closeRailOver(); break;
      case 'connect-later': connectNotNow(); break;
      case 'card-x': { if (cur && cur.turns[ti]) cur.turns[ti].connectCard = false; renderThread({ noAnim: true }); break; }
      case 'conv': openConv(el.dataset.id); break;
      case 'convmore': {
        const c = convs.find((x) => x.id === el.dataset.id);
        pop(el, `<button type="button" role="menuitem" data-v="rename">${ic('edit')}Rename</button><button type="button" role="menuitem" data-v="pin">${ic('pin')}${c.pinned ? 'Unpin' : 'Pin'}</button><hr><button type="button" role="menuitem" data-v="del" class="danger">${ic('trash')}Delete</button>`, (v) => convAction(c, v, el));
        break;
      }
      case 'dlg-x': closeDlg(); break;
      case 'connect-go': closeDlg(); openPanel('connect'); closeRailOver(); break;
      case 'connect-gpt': closeDlg(); openPanel('connect'); closeRailOver(); setTimeout(() => { const t = document.querySelector('[data-act="apptab"][data-app="chatgpt"]'); if (t) t.click(); }, 0); break;
    }
  });
  function saveEdit(ti) {
    const ta = document.querySelector(`[data-edit="${ti}"]`);
    const q = ta && ta.value.trim();
    if (!q) return;
    cur.turns.splice(ti);
    renderThread({ noAnim: true });
    ask(q);
  }

  // A note sent from the Not right form marks that answer.
  document.addEventListener('favor:feedback-sent', (e) => {
    const ref = e.detail && e.detail.ref;
    if (!ref || !cur) return;
    cur.turns.forEach((t, i) => { if (t.ref === ref) { t.rated = e.detail.rating === 'right' ? 'right' : 'wrong'; rerenderTurn(i, { noAnim: true }); } });
  });

  document.addEventListener('submit', async (e) => {
    if (e.target.id !== 'bc-pkgform') return;
    e.preventDefault();
    const btn = e.submitter;
    if (btn) btn.disabled = true;
    $('bc-pkgmsg').textContent = 'Sending...';
    try {
      await api('request', { body: { package: $('bc-pkg').value, reason: $('bc-why').value, days: Number($('bc-days').value) } });
      cue('success');
      await loadMe();
      if (panelKind === 'access') openPanel('access');
      toast('Sent to Will');
    } catch (err) {
      $('bc-pkgmsg').textContent = err.message;
    } finally { if (btn) btn.disabled = false; }
  });

  document.addEventListener('input', (e) => {
    const f = e.target.closest('[data-tfind]');
    if (f) { B.TB[f.dataset.tfind].q = f.value; B.refreshTable(f.dataset.tfind); }
  });
  document.addEventListener('keydown', (e) => {
    const ed = e.target.closest && e.target.closest('[data-edit]');
    if (ed && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(+ed.dataset.edit); return; }
    if (ed && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const ti = +ed.dataset.edit; cur.turns[ti].editing = false; renderThread({ noAnim: true }); return; }
    const rn = e.target.closest && e.target.closest('[data-rename]');
    if (rn && (e.key === 'Enter' || e.key === 'Escape')) { e.preventDefault(); const c = convs.find((x) => x.id === rn.dataset.rename); if (c) finishRename(c, rn.value, e.key === 'Enter'); return; }
    if (e.key === 'Escape') {
      if (popEl) closePop(true);
      else if ($('bc-dlg').classList.contains('is-on')) closeDlg();
      else if (app.classList.contains('has-panel')) closePanel();
      else if (app.classList.contains('rail-over')) closeRailOver();
      else if (busy) stop();
    } else if (e.ctrlKey && e.shiftKey && (e.key === 'O' || e.key === 'o')) { e.preventDefault(); startNew(); }
    else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '')) && !e.target.isContentEditable) { e.preventDefault(); $('bc-input').focus(); }
  });
  document.addEventListener('focusout', (e) => {
    const rn = e.target.closest && e.target.closest('[data-rename]');
    if (rn) setTimeout(() => { const c = convs.find((x) => x.id === rn.dataset.rename); if (c && c.renaming) finishRename(c, rn.value, true); }, 0);
  });

  // The composer
  const inp = $('bc-input');
  function grow() { inp.style.height = '40px'; inp.style.height = Math.min(inp.scrollHeight, 192) + 'px'; }
  inp.addEventListener('input', () => { grow(); setSend(); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  $('bc-compose').addEventListener('submit', (e) => { e.preventDefault(); if (busy) stop(); else send(); });
  $('bc-send').addEventListener('mousedown', (e) => e.preventDefault());
  function send() {
    const q = inp.value.trim();
    if (q.length < 2 || busy) return;
    inp.value = '';
    grow();
    setSend();
    inp.focus({ preventScroll: true });
    ask(q);
  }
  function fitPlaceholder() {
    const w = inp.clientWidth;
    inp.placeholder = w > 520 ? 'Ask about partners, giving, team numbers, iWave or the manuals' : w > 330 ? 'Ask about partners, giving or iWave' : 'Ask the Brain';
  }
  new ResizeObserver(fitPlaceholder).observe(inp);

  // Rail, bar and menu
  $('bc-find').addEventListener('input', (e) => { renderRail(); clearTimeout(e.target._h); const v = e.target.value.trim(); e.target._h = setTimeout(() => searchChats(v), 280); });
  $('bc-new').addEventListener('click', startNew);
  $('bc-new2').addEventListener('click', startNew);
  $('bc-title').addEventListener('click', () => {
    if (!cur || !cur.id) return;
    const c = convs.find((x) => x.id === cur.id);
    if (!c) return;
    c.renaming = true;
    if (app.classList.contains('no-rail') || !wide()) app.classList.add('rail-over');
    syncRailBtn();
    renderRail();
  });
  $('bc-railbtn').addEventListener('click', () => { if (wide()) app.classList.toggle('no-rail'); else app.classList.toggle('rail-over'); syncRailBtn(); });
  $('bc-rail-x').addEventListener('click', closeRailOver);
  $('bc-focus').addEventListener('click', () => setFocus(!hubApp.classList.contains('is-focus')));
  // On a wide screen the hub's menu button hides the hub sidebar; on a phone it opens the menu as everywhere.
  document.addEventListener('click', (e) => {
    const m = e.target.closest('#h-menu');
    if (m && innerWidth > 860) { e.stopPropagation(); setFocus(!hubApp.classList.contains('is-focus')); }
  }, true);
  // A tap outside the open phone menu only closes the menu.
  document.addEventListener('click', (e) => {
    if (innerWidth <= 860 && hubApp.classList.contains('is-nav') && !e.target.closest('.h-side') && !e.target.closest('#h-menu')) { e.preventDefault(); e.stopPropagation(); hubApp.classList.remove('is-nav'); }
  }, true);
  $('bc-scrim').addEventListener('click', closeDlg);
  const soundOn = () => { try { return localStorage.getItem('favor.hub.sound') !== 'off'; } catch { return true; } };
  $('bc-menu').addEventListener('click', (e) => {
    const n = Number((window.FAVOR_HUB && window.FAVOR_HUB.counts && window.FAVOR_HUB.counts.brainRequests) || 0);
    const items = `${me && me.admin ? `<button type="button" role="menuitem" data-v="admin">${ic('gear')}Brain admin${n ? `<span class="badge">${n}</span>` : ''}</button>` : ''}<button type="button" role="menuitem" data-v="access">${ic('shield')}What you can ask about</button><button type="button" role="menuitem" data-v="connect">${ic('link')}Connect Claude or ChatGPT</button><button type="button" role="menuitem" data-v="intro">${ic('play')}Watch the one-minute intro</button><button type="button" role="menuitem" data-v="help">${ic('book')}Help: asking well</button><button type="button" role="menuitem" data-v="keys">${ic('list')}Keyboard shortcuts</button><hr><button type="button" role="menuitem" data-v="sound">${ic(soundOn() ? 'volume' : 'mute')}Sounds ${soundOn() ? 'on' : 'off'}</button>`;
    pop(e.currentTarget, items, (v) => {
      if (v === 'access') openPanel('access');
      else if (v === 'connect') openPanel('connect');
      else if (v === 'sound') { const sw = document.querySelector('[data-sound-switch]'); if (sw) sw.click(); toast(soundOn() ? 'Sounds on' : 'Sounds off'); }
      else if (v === 'admin') location.href = '/brain/admin/';
      else if (v === 'intro') location.href = '/help/videos/meet-the-brain/';
      else if (v === 'help') location.href = '/help/asking-well/';
      else if (v === 'keys') dlg(`<h2 id="bc-dlg-h">Keyboard shortcuts</h2><p><span class="kbd">Enter</span> sends. <span class="kbd">Shift Enter</span> adds a line. <span class="kbd">Esc</span> stops an answer or closes what is open. <span class="kbd">Ctrl Shift O</span> starts a new chat. <span class="kbd">/</span> jumps to the question box.</p><div class="acts"><button type="button" class="h-btn h-btn--primary" data-act="dlg-x">Done</button></div>`);
    });
  });
  $('bc-scroll').addEventListener('scroll', () => {
    const s = $('bc-scroll');
    $('bc-jump').classList.toggle('is-on', s.scrollHeight - s.scrollTop - s.clientHeight > 250);
  });
  $('bc-jump').addEventListener('click', () => { const s = $('bc-scroll'); s.scrollTop = s.scrollHeight; });
  addEventListener('resize', () => { syncRailBtn(); B.drawCharts($('bc-thread')); });

  // ---- Start -----------------------------------------------------------------------------------------------------
  async function loadMe() {
    try {
      me = await api('me');
      $('bc-menudot').hidden = !(me.admin && Number((window.FAVOR_HUB && window.FAVOR_HUB.counts && window.FAVOR_HUB.counts.brainRequests) || 0));
      if (!cur || !cur.turns.length) renderThread();
    } catch (err) {
      $('bc-thread').innerHTML = `<div class="bc-empty-note">${esc(err.message)}</div>`;
    }
  }
  document.addEventListener('favor-hub', () => { if (!cur || !cur.turns.length) renderThread(); });
  // Back from Google's one-time step: the sheet the person asked for is built by sheets.js; show it here.
  document.addEventListener('favor:sheet-ready', (e) => {
    const r = e.detail || {};
    e.preventDefault();
    if (r.url) { SHEETS.unshift({ title: r.title, url: r.url }); renderRail(); toast('Your sheet is ready in Google Drive', { href: r.url, label: 'Open it' }); }
  });
  document.addEventListener('favor:sheet-failed', (e) => { e.preventDefault(); toast((e.detail && e.detail.message) || 'The sheet did not build.'); });

  syncRailBtn();
  setSend();
  renderRail();
  renderThread();
  fitPlaceholder();
  app.dataset.ready = '1';
  (async () => {
    await Promise.all([loadMe(), loadHistory(), loadConnector()]);
    loadSheets();
    if (new URLSearchParams(location.search).get('connect') === '1') openPanel('connect');
    const c = new URLSearchParams(location.search).get('c');
    if (c && /^c_[a-z0-9]{4,16}$/.test(c)) openConv(c);
    else {
      // Back from another hub page: reopen the chat that was being answered (or answered a moment ago).
      let last = null;
      try { last = JSON.parse(localStorage.getItem(LAST) || 'null'); } catch { last = null; }
      const row = last && convs.find((x) => x.id === last.id);
      if (row && (row.pending || Date.now() - new Date(row.changed_at).getTime() < 10 * 60 * 1000) && Date.now() - last.at < 10 * 60 * 1000) openConv(row.id);
    }
  })();
  // For the screenshot and QA scripts.
  // show() puts a made-up answer in the chat, for the render checks.
  function show(q, blocks, extra = {}) {
    if (!cur) cur = newCur();
    cur.turns.push(Object.assign({ q, ref: 'demo01', at: new Date().toISOString(), blocks, reading: [], follow: [], lists: [], markdown: '', intent: 'demo', outcome: 'ok', asked_as: q, hint: false, extras: [], rated: null }, extra));
    if (cur.turns.length === 1) cur.title = titleOf(q);
    renderThread({ noAnim: true });
  }
  window.BrainPage = { show, ask, startNew, openPanel, closePanel, openConv, state: () => ({ cur, convs, me }) };
})();
