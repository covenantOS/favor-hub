/* Hub navigation behavior: the slim rail and the full sidebar, collapsible groups, pinned pages, the last
   tab of each area, the Tools pop-up, the phone bar's More button and the keyboard shortcuts.
   The areas, pages and gates live in src/data/areas.ts. This file only reads the markup it renders.
   Per-person choices are stored in localStorage under favor.hub.nav.prefs.v1, keyed by email. */
(() => {
  if (window.__hubNav) { window.__hubNav.init(); return; }
  const KEY = 'favor.hub.nav.prefs.v1';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const root = document.documentElement;
  const wideMq = window.matchMedia('(min-width: 1280px)');
  const phoneMq = window.matchMedia('(max-width: 860px)');

  const who = () => {
    try { const n = JSON.parse(localStorage.getItem('favor.hub.nav.v1') || 'null'); return (n && n.user && n.user.email) || '_'; } catch { return '_'; }
  };
  const readAll = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } };
  const prefs = () => { const all = readAll(); return all[who()] || all._ || {}; };
  const save = (fn) => {
    try { const all = readAll(); const k = who(); const p = all[k] || {}; fn(p); all[k] = p; localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage refused; the menu still works this visit */ }
  };

  let app, side, wideBtn;

  const setWide = (on, persist) => {
    root.classList.toggle('nav-wide', on && wideMq.matches);
    if (persist) save((p) => { p.wide = on; });
    sync();
  };
  const peek = () => app.classList.contains('is-peek');
  const setPeek = (on) => { app.classList.toggle('is-peek', on); sync(); };
  const isFull = () => (phoneMq.matches ? app.classList.contains('is-nav') : wideMq.matches ? root.classList.contains('nav-wide') : peek());

  function sync() {
    if (!wideBtn) return;
    const full = phoneMq.matches ? false : wideMq.matches ? root.classList.contains('nav-wide') : peek();
    wideBtn.setAttribute('aria-pressed', full ? 'true' : 'false');
    const label = full ? 'Collapse the menu' : 'Expand the menu';
    wideBtn.setAttribute('aria-label', label);
    wideBtn.title = label + ' (press the backslash key)';
    app.classList.toggle('is-open-full', full);
  }

  function toggleWide() {
    if (phoneMq.matches) return;
    if (wideMq.matches) setWide(!root.classList.contains('nav-wide'), true);
    else setPeek(!peek());
  }

  // ---- groups
  function applyOpen() {
    const open = prefs().open || {};
    $$('.h-area').forEach((a) => {
      const id = a.dataset.area;
      const on = a.classList.contains('is-cur') ? true : open[id] === true;
      a.classList.toggle('is-open', on);
      const t = $('.h-area__tog', a);
      if (t) t.setAttribute('aria-expanded', on ? 'true' : 'false');
    });
  }
  function toggleGroup(a) {
    const on = !a.classList.contains('is-open');
    a.classList.toggle('is-open', on);
    const t = $('.h-area__tog', a);
    if (t) t.setAttribute('aria-expanded', on ? 'true' : 'false');
    save((p) => { p.open = p.open || {}; p.open[a.dataset.area] = on; });
  }

  // ---- pins
  const pins = () => (prefs().pins || []).slice(0, 5);
  function renderPins() {
    const box = $('#h-pins'); const list = $('#h-pins-list');
    if (!box || !list) return;
    const ids = pins();
    list.innerHTML = '';
    let shown = 0;
    ids.forEach((id) => {
      const src = $(`.h-pg:not([hidden]) a[data-nav-id="${id}"]`);
      if (!src || src.closest('.h-area[hidden]')) return;
      const a = document.createElement('a');
      a.className = 'h-nav__item h-pinrow' + (src.classList.contains('is-on') ? ' is-on' : '');
      a.href = src.getAttribute('href');
      a.dataset.pinned = id;
      if (src.dataset.kpiPage) a.dataset.kpiPage = src.dataset.kpiPage;
      const area = src.closest('.h-area');
      const lab = $('.h-area__label', area);
      a.innerHTML = '<span></span><em></em>';
      a.firstChild.textContent = src.dataset.label || src.textContent.trim();
      a.lastChild.textContent = lab ? lab.textContent : '';
      list.appendChild(a);
      shown++;
    });
    box.hidden = !shown;
    $$('.h-pin').forEach((b) => {
      const on = ids.includes(b.dataset.pin);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('aria-label', (on ? 'Unpin ' : 'Pin ') + (b.closest('.h-pg')?.querySelector('[data-label]')?.dataset.label || ''));
    });
  }
  function togglePin(id) {
    save((p) => {
      const cur = (p.pins || []).slice();
      const i = cur.indexOf(id);
      if (i >= 0) cur.splice(i, 1); else { cur.push(id); while (cur.length > 5) cur.shift(); }
      p.pins = cur;
    });
    renderPins();
  }

  // ---- last tab of each area
  function remember(areaId, pageId) {
    if (!areaId || !pageId) return;
    save((p) => { p.last = p.last || {}; p.last[areaId] = pageId; });
    if (window.hubNavLayout) window.hubNavLayout();
  }

  // ---- shortcuts
  let gAt = 0;
  const typing = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  function onKey(e) {
    if (e.defaultPrevented || e.altKey) return;
    const cmdk = $('#cmdk');
    if (cmdk && !cmdk.hidden) return;
    if (e.ctrlKey && e.key === '\\') { e.preventDefault(); toggleWide(); return; }
    if (e.metaKey || e.ctrlKey || typing(e.target)) return;
    if (e.key === 'Escape') {
      if (peek()) setPeek(false);
      $$('.h-area--pop.is-pop').forEach((a) => a.classList.remove('is-pop'));
      return;
    }
    if (e.key === '\\') { e.preventDefault(); toggleWide(); return; }
    if (e.key === '[' || e.key === ']') {
      const tabs = $$('#h-tabs .h-tab:not([hidden])');
      const i = tabs.findIndex((t) => t.classList.contains('is-on'));
      if (tabs.length > 1 && i >= 0) { e.preventDefault(); tabs[(i + (e.key === ']' ? 1 : tabs.length - 1)) % tabs.length].click(); }
      return;
    }
    const k = e.key.toLowerCase();
    if (gAt && Date.now() - gAt < 1200) {
      gAt = 0;
      const a = $(`.h-area[data-key="${k}"]:not([hidden]):not(.h-area--pop)`);
      if (a) { e.preventDefault(); const l = $('.h-area__link', a); location.href = l.getAttribute('href'); }
      return;
    }
    if (k === 'g' && !e.shiftKey) gAt = Date.now();
  }

  function init() {
    app = $('#h-app'); side = $('#h-side'); wideBtn = $('#h-wide');
    if (!app || !side) return;
    applyOpen();
    renderPins();
    sync();
    // remember this page as the area's last tab
    const on = $('.h-tab.is-on[data-nav-id]') || $('.h-pg__a.is-on[data-nav-id]');
    const cur = $('.h-area.is-cur');
    if (on && cur && $$('.h-pg', cur).length > 1) remember(cur.dataset.area, on.dataset.navId);
    // the dashboard swaps tabs inside the page: follow its marks
    if (cur && cur.dataset.area === 'dashboards') {
      new MutationObserver(() => { const a = $('.h-tab.is-on[data-nav-id]'); if (a) remember('dashboards', a.dataset.navId); }).observe($('#h-tabs') || document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    }
  }

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const wb = t.closest('#h-wide');
    if (wb) { e.preventDefault(); toggleWide(); return; }
    if (t.closest('#h-scrim')) { setPeek(false); return; }
    const pin = t.closest('.h-pin');
    if (pin) { e.preventDefault(); e.stopPropagation(); togglePin(pin.dataset.pin); return; }
    const tog = t.closest('.h-area__tog');
    if (tog) { e.preventDefault(); toggleGroup(tog.closest('.h-area')); return; }
    const pop = t.closest('.h-area--pop .h-area__link');
    if (pop) { e.preventDefault(); e.stopPropagation(); const a = pop.closest('.h-area'); const on = !a.classList.contains('is-pop'); a.classList.toggle('is-pop', on); if (isFull() || phoneMq.matches) a.classList.toggle('is-open', on); return; }
    if (!t.closest('.h-area--pop')) $$('.h-area--pop.is-pop').forEach((a) => a.classList.remove('is-pop'));
    const more = t.closest('#h-bar-more');
    if (more) {
      e.stopPropagation();
      const open = !app.classList.contains('is-nav');
      app.classList.toggle('is-nav', open);
      more.setAttribute('aria-expanded', open ? 'true' : 'false');
      const m = $('#h-menu'); if (m) m.setAttribute('aria-expanded', open ? 'true' : 'false');
      return;
    }
    const link = t.closest('.h-tab[data-nav-id], .h-pg__a[data-nav-id]');
    if (link) {
      const area = link.closest('.h-area') || (link.closest('#h-tabs') && $(`.h-area[data-area="${link.closest('#h-tabs').dataset.area}"]`));
      if (area) remember(area.dataset.area, link.dataset.navId);
      if (peek() && !link.dataset.kpiPage) setPeek(false);
    }
    const al = t.closest('.h-area__link');
    if (al && peek()) setPeek(false);
  }, true);

  document.addEventListener('keydown', onKey);
  const onMq = () => { if (!app) return; if (wideMq.matches) app.classList.remove('is-peek'); root.classList.toggle('nav-wide', wideMq.matches && !!prefs().wide); sync(); };
  wideMq.addEventListener('change', onMq);
  phoneMq.addEventListener('change', onMq);
  document.addEventListener('favor-hub', () => { applyOpen(); renderPins(); });
  window.addEventListener('hub-nav-toggle', toggleWide);

  window.__hubNav = { init, toggle: toggleWide };
  init();
})();
