/* Keeps the menu, tab row and header in place while a page changes. Only the page body is replaced.
   Pages on the allow list swap in place; every other link loads normally. A link hovered or touched is
   fetched ahead, so the swap is instant. The allow list is built from `swap` in src/data/areas.ts. */
(() => {
  if (window.__hubSwap) return;
  const allow = new Set(window.__hubSwapPaths || []);
  if (!allow.size || !window.fetch || !window.DOMParser) return;
  const HEAVY = new Set(window.__hubFullLoad || ['/work/', '/brain/', '/meet/book/', '/meet/library/', '/meet/notes/', '/dashboard/']);
  const cache = new Map();
  const pathOf = (u) => { const x = new URL(u, location.href); return x.origin === location.origin ? x.pathname.replace(/\/?$/, '/') : null; };
  const swappable = (u) => { const p = pathOf(u); return !!p && allow.has(p) && !new URL(u, location.href).search; };
  // A page that was loaded whole and keeps global state (the Work Center, the dashboard) is left by a full load too.
  // The page you are on may carry a query (a Projects tab, an open deposit); leaving it can still swap. Only the destination must be a plain address.
  const here = () => { const p = pathOf(location.href); return !!p && allow.has(p) && !HEAVY.has(p); };
  // Page HTML is the same for everyone and changes only with a new build, so a copy read once is kept for the browser session
  // (keyed by the build) and a tap finds it already here. Anything the person's data fills in arrives from the API afterwards.
  const BUILD = (document.querySelector('meta[name="hub-build"]') || {}).content || '';
  const SKEY = 'hub.pg.' + BUILD + ':';
  const keep = (k, h) => { try { sessionStorage.setItem(SKEY + k, h); } catch (e) { /* storage full or refused; the memory copy still serves this visit */ } };
  const kept = (k) => { try { return sessionStorage.getItem(SKEY + k); } catch (e) { return null; } };
  try { Object.keys(sessionStorage).forEach((x) => { if (x.indexOf('hub.pg.') === 0 && x.indexOf(SKEY) !== 0) sessionStorage.removeItem(x); }); } catch (e) { /* no storage */ }
  const warmAssets = (h) => {
    const d = new DOMParser().parseFromString(h, 'text/html');
    const m = d.getElementById('h-content');
    if (m) { scriptSrcs(m).forEach((x) => loadScript(x).catch(() => {})); moduleSrcs(m).forEach((x) => fetch(x, { credentials: 'same-origin' }).catch(() => {})); }
    d.head.querySelectorAll('link[rel=stylesheet]').forEach((l) => {
      const ref = l.getAttribute('href');
      if (!ref || document.head.querySelector('link[href="' + ref + '"]')) return;
      const pl = document.createElement('link'); pl.rel = 'preload'; pl.as = 'style'; pl.href = ref;
      document.head.appendChild(pl);
    });
  };
  const fetchPage = (u) => {
    const k = pathOf(u);
    if (!cache.has(k)) {
      const copy = BUILD ? kept(k) : null;
      if (copy) {
        cache.set(k, Promise.resolve(copy));
      } else {
        cache.set(k, fetch(u, { credentials: 'same-origin' }).then((r) => {
          if (!r.ok || r.redirected || !/text\/html/.test(r.headers.get('content-type') || '')) throw new Error('not a page');
          return r.text();
        }).then((h) => { if (BUILD && h.length < 600000 && h.indexOf('id="h-content"') > 0) keep(k, h); return h; }).catch((e) => { cache.delete(k); throw e; }));
      }
      setTimeout(() => cache.delete(k), 300000);
      cache.get(k).then(warmAssets).catch(() => {});
    }
    return cache.get(k);
  };
  const $ = (s, r) => (r || document).querySelector(s);
  let viaSwap = false;

  // Timers, listeners, observers and body nodes a page made are noted by hub-own.js (inlined in the head) and removed
  // before the next page arrives, for a page that loaded normally and for one swapped in.
  const own = window.__hubOwn || { state: { sync: false, held: [] }, cleanup() {} };
  let epoch = 0;
  const scripts = new Map();
  const loadScript = (src) => {
    if (!scripts.has(src)) scripts.set(src, fetch(src, { credentials: 'same-origin' }).then((r) => { if (!r.ok) throw new Error('script'); return r.text(); }).catch((e) => { scripts.delete(src); throw e; }));
    return scripts.get(src);
  };
  const scriptSrcs = (root) => Array.from(root.querySelectorAll('script[src]')).filter((s) => !s.getAttribute('type') || s.getAttribute('type') === 'text/javascript').map((s) => s.src);
  const moduleSrcs = (root) => Array.from(root.querySelectorAll('script[type="module"][src]')).map((s) => s.src);

  async function runScripts(root, ready) {
    const list = Array.from(root.querySelectorAll('script'));
    const parts = [];
    const mods = [];
    for (const s of list) {
      const type = s.getAttribute('type') || '';
      if (type === 'module' && s.src) { mods.push(s.src); s.remove(); continue; }
      if (type && type !== 'text/javascript') continue;
      if (s.src) {
        try { parts.push('// ' + s.src + '\n' + await (ready ? ready.get(s.src) : loadScript(s.src))); } catch (e) { /* the page shows its own error */ }
      } else if (s.textContent.trim()) parts.push(s.textContent);
      s.remove();
    }
    own.state.held.length = 0;
    own.state.sync = true;
    try { (0, eval)(parts.join('\n;\n') + '\n//# sourceURL=hub-page-' + (++epoch) + '.js'); } catch (e) { console.error('page script', e); }
    own.state.sync = false;
    // the document is already loaded, so the load and DOMContentLoaded handlers the page asked for run now
    const run = own.state.held.splice(0);
    run.forEach(([ty, fn]) => { try { fn.call(ty === 'load' ? window : document, new Event(ty)); } catch (e) { console.error(e); } });
    // Module scripts run once per address, so each visit asks for a fresh copy of the page's own module (what it imports stays shared).
    for (const m of mods) { try { await import(m + (m.indexOf('?') < 0 ? '?' : '&') + 'sw=' + epoch); } catch (e) { console.error('page module', e); } }
  }

  // Page stylesheets come and go with their page. Styles a script added at run time are left alone; only the
  // links and style blocks a page's own HTML carried are managed, so one page's rules never restyle the next.
  // Managed: the built stylesheets (/_astro/) and style blocks copied in from a swapped page. Style blocks the first page
  // carried cannot be told apart from ones hub scripts add at run time, so those stay.
  const keyOf = (el) => (el.tagName === 'LINK' ? 'L' + el.getAttribute('href') : 'S' + el.textContent);
  const pageCss = new Set(Array.from(document.head.querySelectorAll('link[rel=stylesheet][href^="/_astro/"]')).map(keyOf));
  // A new stylesheet goes in at the same place it sits in the new page, before the next one both pages share. Appended at the
  // end it would outrank the shared sheets and older rules would win (the Brain mark drew as a small purple square).
  function mergeHead(doc) {
    const cur = new Map(Array.from(document.head.querySelectorAll('link[rel=stylesheet], style')).map((el) => [keyOf(el), el]));
    const list = Array.from(doc.head.querySelectorAll('link[rel=stylesheet], style'));
    list.forEach((el, i) => {
      const k = keyOf(el);
      if (el.tagName === 'LINK' ? (el.getAttribute('href') || '').startsWith('/_astro/') : true) pageCss.add(k);
      if (cur.has(k)) return;
      let next = null;
      for (let j = i + 1; j < list.length && !next; j++) next = cur.get(keyOf(list[j])) || null;
      const copy = el.cloneNode(true);
      if (next) document.head.insertBefore(copy, next); else document.head.appendChild(copy);
      cur.set(k, copy);
    });
    // Sheets both pages share sit in the order the new page has them (a shared sheet can come before the layout's sheet on one page and after it on another).
    const els = list.map((el) => cur.get(keyOf(el))).filter(Boolean);
    const slots = els.slice().sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    if (slots.some((s, i) => s !== els[i])) {
      const marks = slots.map((s) => { const m = document.createComment(''); s.parentNode.insertBefore(m, s); return m; });
      els.forEach((el, i) => marks[i].parentNode.insertBefore(el, marks[i]));
      marks.forEach((m) => m.remove());
    }
  }
  function dropOldCss(doc) {
    const want = new Set(Array.from(doc.head.querySelectorAll('link[rel=stylesheet], style')).map(keyOf));
    document.head.querySelectorAll('link[rel=stylesheet], style').forEach((el) => { const k = keyOf(el); if (pageCss.has(k) && !want.has(k)) el.remove(); });
    // Sheets both pages share can sit in a different order on the new page; put the managed ones in its order.
    const order = Array.from(doc.head.querySelectorAll('link[rel=stylesheet], style')).map(keyOf).filter((k) => pageCss.has(k));
    const now = Array.from(document.head.querySelectorAll('link[rel=stylesheet], style')).filter((el) => pageCss.has(keyOf(el)));
    if (now.map(keyOf).join('|') !== order.join('|')) {
      const byKey = new Map(now.map((el) => [keyOf(el), el]));
      const last = now[now.length - 1];
      const anchor = last ? last.nextSibling : null;
      order.forEach((k) => { const el = byKey.get(k); if (el) document.head.insertBefore(el, anchor); });
    }
  }

  // A thin line under the status bar shows a page is on its way, but only when it takes longer than a blink.
  let progT = 0;
  const progress = (on) => {
    clearTimeout(progT);
    let el = document.getElementById('h-prog');
    if (!on) { if (el) { el.style.width = '100%'; el.style.opacity = '0'; setTimeout(() => el && el.remove(), 250); } return; }
    progT = setTimeout(() => {
      if (!el) { el = document.createElement('div'); el.id = 'h-prog'; document.body.appendChild(el); }
      el.style.cssText = ''; void el.offsetWidth; el.style.width = '78%';
    }, 140);
  };

  let noticeT = 0;
  function notice(text) {
    let el = document.getElementById('h-notice');
    if (!el) { el = document.createElement('div'); el.id = 'h-notice'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = text; el.classList.add('is-on');
    clearTimeout(noticeT); noticeT = setTimeout(() => el.classList.remove('is-on'), 4000);
  }
  let seq = 0;
  async function go(u, push) {
    const my = ++seq;
    const T = (window.__swapT = [['go', Math.round(performance.now())]]);
    // Pages that run a lot of their own script keep a full load: they start from a clean page.
    if (HEAVY.has(pathOf(u))) { location.href = u; return; }
    let html;
    progress(true);
    try { html = await fetchPage(u); } catch (e) {
      // No connection: the page stays where it is and says so, instead of handing the screen to the browser's error page.
      if (navigator.onLine === false) { progress(false); const m = document.getElementById('h-content'); if (m) m.classList.remove('is-leaving'); notice('No connection. Try again when you are back online.'); return; }
      location.href = u; return;
    }
    if (my !== seq) return;
    T.push(['html', Math.round(performance.now())]);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const newMain = doc.getElementById('h-content');
    const oldMain = document.getElementById('h-content');
    if (!newMain || !oldMain || !doc.body.classList.contains('h-body')) { location.href = u; return; }
    // A page built on module scripts starts itself only on a real load, so it gets one. Swapped in, it would sit on its placeholder.
    if (Array.from(newMain.querySelectorAll('script[type="module"]')).some((x) => !x.src)) { location.href = u; return; }
    // The page's scripts are read before the change, so the new page and its code arrive together.
    const ready = new Map();
    try { await Promise.all(scriptSrcs(newMain).map((src) => loadScript(src).then((t) => ready.set(src, t)))); } catch (e) { location.href = u; return; }
    if (my !== seq) return;
    T.push(['scripts', Math.round(performance.now())]);
    const stamp = performance.now();
    progress(false);
    mergeHead(doc);
    await Promise.all(Array.from(document.head.querySelectorAll('link[rel=stylesheet]')).filter((l) => !l.sheet).map((l) => new Promise((r) => { l.addEventListener('load', r, { once: true }); l.addEventListener('error', r, { once: true }); setTimeout(r, 1500); })));
    if (my !== seq) return;
    T.push(['css', Math.round(performance.now())]);
    const apply = () => {
      T.push(['apply', Math.round(performance.now())]);
      own.cleanup();
      document.title = doc.title;
      const nav = doc.body.dataset.nav || '';
      document.body.dataset.nav = nav;
      const t = (sel) => { const a = $(sel, doc); const b = $(sel); if (a && b) b.textContent = a.textContent; };
      // The breadcrumb is a link to the area; a page named for its area has none.
      { const a = $('.h-top__crumb', doc); const b = $('.h-top__crumb'); if (a && b) { b.innerHTML = a.innerHTML; b.hidden = a.hidden; } }
      { const a = $('.h-top__title', doc); const b = $('.h-top__title'); if (a && b) { b.innerHTML = a.innerHTML; if (window.hubRelApply) window.hubRelApply(); } }
      const newArea = $('.h-area.is-cur', doc);
      document.body.dataset.area = doc.body.dataset.area || '';
      const tile = document.getElementById('h-tile'); const ntile = $('#h-tile', doc);
      if (tile && ntile) tile.innerHTML = ntile.innerHTML; else if (tile && !ntile) tile.remove();
      const act = document.getElementById('h-actions'); const nact = $('#h-actions', doc);
      if (act && nact) act.innerHTML = nact.innerHTML;
      const slot = document.getElementById('h-tabs-slot'); const nslot = $('#h-tabs-slot', doc);
      const oldTabs = document.getElementById('h-tabs'); const newTabs = doc.getElementById('h-tabs');
      if (slot && oldTabs && newTabs && oldTabs.dataset.area === newTabs.dataset.area) {
        const onId = (newTabs.querySelector('.h-tab.is-on') || { dataset: {} }).dataset.navId;
        oldTabs.querySelectorAll('a.h-tab[data-nav-id]').forEach((a) => { const on = a.dataset.navId === onId; a.classList.toggle('is-on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
      } else if (slot && nslot) {
        slot.innerHTML = nslot.innerHTML;
        // The new tab row is the build's copy: apply the admin's saved badges to it too.
        if (window.hubRelApply) window.hubRelApply();
      }
      const onPg = $('.h-pg__a.is-on', doc);
      const onId = onPg ? onPg.dataset.navId : null;
      document.querySelectorAll('.h-area').forEach((a) => a.classList.toggle('is-cur', !!newArea && a.dataset.area === newArea.dataset.area));
      document.querySelectorAll('.h-pg__a[data-nav-id], .h-pinrow').forEach((a) => { const id = a.dataset.navId || a.dataset.pinned; const on = !!onId && id === onId; a.classList.toggle('is-on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
      document.querySelectorAll('#h-bar .h-bar__a[data-bar]').forEach((a) => a.classList.toggle('is-on', !!newArea && a.dataset.bar === newArea.dataset.area));
      document.getElementById('h-app').classList.remove('is-nav', 'is-peek');
      dropOldCss(doc);
      oldMain.className = newMain.className;
      oldMain.innerHTML = '';
      Array.from(newMain.childNodes).forEach((n) => oldMain.appendChild(document.importNode(n, true)));
      document.querySelectorAll('dialog[open]').forEach((d) => { try { d.close(); } catch (e) { /* already closed */ } });
      if (window.FavorDrill) window.FavorDrill.close();
      viaSwap = true;
      // The new page's frame paints first; its scripts run right after, so the tap is answered before they are read and run.
      settle(oldMain);
      requestAnimationFrame(() => setTimeout(() => { if (my === seq) runScripts(oldMain, ready); }, 0));
      if (push) history.pushState({ hubSwap: 1 }, '', u);
      window.scrollTo(0, 0);
      // The new tab row arrives with its gated tabs hidden: show the ones this person may open, as a full load does.
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem('favor.hub.nav.v1') || 'null'); } catch (e) {}
      if (saved && window.hubApplyNav) window.hubApplyNav(saved); else if (window.hubNavLayout) window.hubNavLayout();
      if (window.__hubNav) window.__hubNav.init();
      T.push(['applied', Math.round(performance.now())]);
      if (window.hubNavRefresh) window.hubNavRefresh(false);
      document.dispatchEvent(new CustomEvent('hub-swapped', { detail: { path: pathOf(u), ms: Math.round(performance.now() - stamp) } }));
    };
    // One frame, no cross-fade: a view transition waits a frame for its snapshot (130 ms on a slow phone) and its aborts threw on quick taps.
    apply();
  }

  // A swapped page draws its parts as its reads answer, and each part used to push the ones under it down (layout shift on a tab).
  // The new body stays hidden behind one skeleton until the reads it starts in its first moments have answered and the page has stopped
  // drawing for a beat, then shows at its final size in one frame. Never longer than 1.5 seconds.
  let settling = null;
  function settle(main) {
    if (settling) settling.finish();
    main.classList.add('is-settling');
    const t0 = performance.now();
    const of = window.fetch;
    let pending = 0, done = false, quietT = 0;
    const finish = () => {
      if (done) return;
      done = true; clearTimeout(quietT); clearTimeout(capT); mo.disconnect();
      if (window.fetch === wrapped) window.fetch = of;
      if (RP) Object.keys(body).forEach((k) => { RP[k] = body[k]; });
      main.classList.remove('is-settling');
      settling = null;
      document.dispatchEvent(new CustomEvent('hub-settled'));
    };
    const quiet = () => { clearTimeout(quietT); if (!pending) quietT = setTimeout(finish, 120); };
    const wrapped = function (input, init) {
      let ours = false;
      try { const u = new URL(typeof input === 'string' ? input : (input && input.url) || '', location.href); ours = !done && u.origin === location.origin && u.pathname.indexOf('/api/') === 0; } catch (e) { ours = false; }
      const p = of.apply(this, arguments);
      // Only the reads a page starts in its first moments hold it, each for at most 900 ms: a long poll or a presence read (Chat) never does.
      if (ours && performance.now() - t0 < 600) { pending++; clearTimeout(quietT); let ended = false; const end = () => { if (ended) return; ended = true; pending = Math.max(0, pending - 1); quiet(); }; p.then(end, end); setTimeout(end, 900); }
      return p;
    };
    window.fetch = wrapped;
    // A read counts until its body has been read: a long answer (the expense log) arrives in pieces after its headers.
    const RP = window.Response && Response.prototype;
    const body = {};
    if (RP) ['json', 'text'].forEach((k) => {
      body[k] = RP[k];
      RP[k] = function () {
        const q = body[k].apply(this, arguments);
        if (!done && performance.now() - t0 < 1200) { pending++; clearTimeout(quietT); let ended = false; const end = () => { if (ended) return; ended = true; pending = Math.max(0, pending - 1); quiet(); }; q.then(end, end); setTimeout(end, 900); }
        return q;
      };
    });
    const mo = new MutationObserver(() => { if (!pending) quiet(); });
    mo.observe(main, { childList: true, subtree: true, attributes: true, characterData: true });
    const capT = setTimeout(finish, 1500);
    // A page with no reads shows as soon as its script has drawn.
    setTimeout(quiet, 60);
    settling = { finish };
  }

  // The press is answered at once, before the next page arrives: the tab or menu entry lights up and the old page steps back.
  function answer(a) {
    const tab = a.closest('.h-tab');
    if (tab && tab.matches('a[data-nav-id]')) { (tab.closest('#h-tabs') || tab.parentElement).querySelectorAll('.h-tab').forEach((x) => x.classList.toggle('is-on', x === tab)); }
    const m = document.getElementById('h-content');
    if (m) m.classList.add('is-leaving');
  }
  const warm = (e) => { const a = e.target instanceof Element && e.target.closest('a[href]'); if (a && !a.target && swappable(a.href)) fetchPage(a.href).catch(() => {}); };
  document.addEventListener('pointerover', warm, { passive: true });
  document.addEventListener('touchstart', warm, { passive: true });
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target instanceof Element && e.target.closest('a[href]');
    if (!a || a.target || a.hasAttribute('download') || !here() || !swappable(a.href)) return;
    if (pathOf(a.href) === pathOf(location.href)) return;
    answer(a);
    if (HEAVY.has(pathOf(a.href))) return;
    e.preventDefault();
    const href = a.href;
    if (window.hubOv && window.hubOv.depth()) window.hubOv.unwind(() => go(href, true));
    else go(href, true);
  });
  window.addEventListener('popstate', () => { if (window.__hubPopOwn && window.__hubPopOwn()) return; if (window.__hubOvHandled) { window.__hubOvHandled = false; return; } if (here() && viaSwap && !HEAVY.has(pathOf(location.href))) go(location.href, false); else location.reload(); });
  // Soon after a page is up, the phone bar's pages and this area's other tabs are read ahead (page and scripts), bar first,
  // so a tap finds them here. Skipped when the person asked their phone to save data.
  function warmArea() {
    if ((navigator.connection && navigator.connection.saveData) || (window.FavorLite && window.FavorLite.on)) return;
    const seen = new Set();
    const links = Array.from(document.querySelectorAll('#h-bar a[data-bar], #h-tabs a.h-tab:not([hidden]), .h-side a.h-area__link[data-area-link]')).filter((a) => {
      const k = pathOf(a.href);
      if (seen.has(k) || !swappable(a.href) || HEAVY.has(k) || k === pathOf(location.href)) return false;
      seen.add(k); return true;
    });
    // Three at a time, in order of likelihood, and paused while a tap is being answered.
    let i = 0;
    const next = () => {
      if (i >= links.length) return;
      if (document.getElementById('h-content').classList.contains('is-leaving')) { setTimeout(next, 600); return; }
      const a = links[i++];
      fetchPage(a.href).then(next, next);
    };
    setTimeout(() => { next(); next(); next(); }, 1200);
  }
  document.addEventListener('hub-swapped', warmArea);
  if (here()) { if (document.readyState === 'complete') warmArea(); else window.addEventListener('load', warmArea, { once: true }); }
  window.addEventListener('pageshow', (e) => { if (e.persisted) { const m = document.getElementById('h-content'); if (m) m.classList.remove('is-leaving'); } });
  window.__hubSwap = { go, cache, fetchPage };
})();
