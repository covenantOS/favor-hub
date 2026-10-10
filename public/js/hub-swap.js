/* Keeps the menu, tab row and header in place while a page changes. Only the page body is replaced.
   Pages on the allow list swap in place; every other link loads normally. A link hovered or touched is
   fetched ahead, so the swap is instant. The allow list is built from `swap` in src/data/areas.ts. */
(() => {
  if (window.__hubSwap) return;
  const allow = new Set(window.__hubSwapPaths || []);
  if (!allow.size || !window.fetch || !window.DOMParser) return;
  const cache = new Map();
  const pathOf = (u) => { const x = new URL(u, location.href); return x.origin === location.origin ? x.pathname.replace(/\/?$/, '/') : null; };
  const swappable = (u) => { const p = pathOf(u); return !!p && allow.has(p) && !new URL(u, location.href).search; };
  const here = () => swappable(location.href);
  const fetchPage = (u) => {
    const k = pathOf(u);
    if (!cache.has(k)) {
      cache.set(k, fetch(u, { credentials: 'same-origin' }).then((r) => {
        if (!r.ok || !/text\/html/.test(r.headers.get('content-type') || '')) throw new Error('not a page');
        return r.text();
      }).catch((e) => { cache.delete(k); throw e; }));
      setTimeout(() => cache.delete(k), 60000);
    }
    return cache.get(k);
  };
  const $ = (s, r) => (r || document).querySelector(s);
  const HEAVY = new Set(['/work/', '/brain/', '/meet/', '/meet/book/', '/meet/library/', '/meet/notes/', '/dashboard/']);
  let viaSwap = false;

  // Listeners a swapped-in page adds to document or window are removed when the next swap starts.
  const mine = [];
  let tracking = false;
  const held = [];
  const origDoc = document.addEventListener.bind(document);
  const origWin = window.addEventListener.bind(window);
  const wrap = (target, orig) => function (type, fn, opts) {
    if (tracking && (type === 'DOMContentLoaded' || type === 'load') && target !== window.__none) { held.push([type, fn]); return; }
    if (tracking) mine.push([target, type, fn, opts]);
    return orig(type, fn, opts);
  };
  document.addEventListener = wrap(document, origDoc);
  window.addEventListener = wrap(window, origWin);
  const cleanup = () => { while (mine.length) { const [t, ty, fn, o] = mine.pop(); t.removeEventListener(ty, fn, o); } };

  async function runScripts(root) {
    const list = Array.from(root.querySelectorAll('script'));
    const parts = [];
    for (const s of list) {
      const type = s.getAttribute('type') || '';
      if (type && type !== 'text/javascript') continue;
      if (s.src) {
        try { parts.push('// ' + s.src + '\n' + await (await fetch(s.src, { credentials: 'same-origin' })).text()); } catch (e) { /* the page shows its own error */ }
      } else if (s.textContent.trim()) parts.push(s.textContent);
      s.remove();
    }
    held.length = 0;
    tracking = true;
    setTimeout(() => { tracking = false; }, 2500);
    try { (0, eval)(parts.join('\n;\n')); } catch (e) { console.error('page script', e); }
    // the document is already loaded, so the load and DOMContentLoaded handlers the page asked for run now
    const run = held.splice(0);
    run.forEach(([ty, fn]) => { try { fn.call(ty === 'load' ? window : document, new Event(ty)); } catch (e) { console.error(e); } });
  }

  function mergeHead(doc) {
    const have = new Set(Array.from(document.head.querySelectorAll('link[rel=stylesheet]')).map((l) => l.getAttribute('href')));
    doc.head.querySelectorAll('link[rel=stylesheet]').forEach((l) => { if (!have.has(l.getAttribute('href'))) document.head.appendChild(l.cloneNode(true)); });
    const sty = new Set(Array.from(document.head.querySelectorAll('style')).map((s) => s.textContent));
    doc.head.querySelectorAll('style').forEach((s) => { if (!sty.has(s.textContent)) document.head.appendChild(s.cloneNode(true)); });
  }

  async function go(u, push) {
    let html;
    try { html = await fetchPage(u); } catch (e) { location.href = u; return; }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const newMain = doc.getElementById('h-content');
    const oldMain = document.getElementById('h-content');
    if (!newMain || !oldMain || !doc.body.classList.contains('h-body')) { location.href = u; return; }
    const stamp = performance.now();
    cleanup();
    mergeHead(doc);
    await Promise.all(Array.from(document.head.querySelectorAll('link[rel=stylesheet]')).filter((l) => !l.sheet).map((l) => new Promise((r) => { l.addEventListener('load', r, { once: true }); l.addEventListener('error', r, { once: true }); setTimeout(r, 1500); })));
    const apply = () => {
      document.title = doc.title;
      const nav = doc.body.dataset.nav || '';
      document.body.dataset.nav = nav;
      const t = (sel) => { const a = $(sel, doc); const b = $(sel); if (a && b) b.textContent = a.textContent; };
      t('.h-top__crumb'); t('.h-top__title');
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
        oldTabs.querySelectorAll('.h-tab').forEach((a) => { const on = a.dataset.navId === onId; a.classList.toggle('is-on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
      } else if (slot && nslot) {
        slot.innerHTML = nslot.innerHTML;
      }
      const onPg = $('.h-pg__a.is-on', doc);
      const onId = onPg ? onPg.dataset.navId : null;
      document.querySelectorAll('.h-area').forEach((a) => a.classList.toggle('is-cur', !!newArea && a.dataset.area === newArea.dataset.area));
      document.querySelectorAll('.h-pg__a[data-nav-id], .h-pinrow').forEach((a) => { const id = a.dataset.navId || a.dataset.pinned; const on = !!onId && id === onId; a.classList.toggle('is-on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
      document.querySelectorAll('#h-bar .h-bar__a[data-bar]').forEach((a) => a.classList.toggle('is-on', !!newArea && a.dataset.bar === newArea.dataset.area));
      document.getElementById('h-app').classList.remove('is-nav', 'is-peek');
      oldMain.className = newMain.className;
      oldMain.innerHTML = '';
      Array.from(newMain.childNodes).forEach((n) => oldMain.appendChild(document.importNode(n, true)));
      viaSwap = true;
      runScripts(oldMain);
      if (push) history.pushState({ hubSwap: 1 }, '', u);
      window.scrollTo(0, 0);
      if (window.hubNavLayout) window.hubNavLayout();
      if (window.__hubNav) window.__hubNav.init();
      document.dispatchEvent(new CustomEvent('hub-swapped', { detail: { path: pathOf(u), ms: Math.round(performance.now() - stamp) } }));
    };
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(apply); else apply();
  }

  const warm = (e) => { const a = e.target instanceof Element && e.target.closest('a[href]'); if (a && !a.target && swappable(a.href)) fetchPage(a.href).catch(() => {}); };
  document.addEventListener('pointerover', warm, { passive: true });
  document.addEventListener('touchstart', warm, { passive: true });
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target instanceof Element && e.target.closest('a[href]');
    if (!a || a.target || a.hasAttribute('download') || !here() || !swappable(a.href)) return;
    if (!viaSwap && HEAVY.has(pathOf(location.href))) return;
    if (pathOf(a.href) === pathOf(location.href)) return;
    e.preventDefault();
    go(a.href, true);
  });
  origWin('popstate', () => { if (here() && viaSwap) go(location.href, false); else location.reload(); });
  window.__hubSwap = { go, cache };
})();
