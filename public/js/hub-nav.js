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
    wideBtn.setAttribute('data-tip', label + ' (press the backslash key)');
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
      const tabs = $$('#h-tabs .h-tabs__row a.h-tab[data-nav-id]:not([hidden])');
      const i = tabs.findIndex((t) => t.classList.contains('is-on'));
      if (tabs.length > 1 && i >= 0) { e.preventDefault(); tabs[(i + (e.key === ']' ? 1 : tabs.length - 1)) % tabs.length].click(); }
      return;
    }
    const k = e.key.toLowerCase();
    if (gAt && Date.now() - gAt < 1200) {
      gAt = 0;
      // An area under the rail's More is hidden in the rail and still jumps (nothing there is locked).
      const a = $(`.h-area[data-key="${k}"]:not([hidden]):not(.h-area--pop)`) || $(`.h-area.is-more[data-key="${k}"]`);
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
    if (cur && cur.dataset.area === 'kpi' && !window.__hubKpiWatch) {
      window.__hubKpiWatch = true;
      new MutationObserver(() => { const a = $('.h-tab.is-on[data-nav-id]'); if (a) remember('kpi', a.dataset.navId); }).observe($('#h-tabs') || document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    }
  }

  // The rail toggle's tip shows on hover and keyboard focus only. It hides on mouseleave and blur, and after a press until the pointer leaves.
  const tipOn = (e) => { const b = e.target instanceof Element && e.target.closest('#h-wide'); if (b && e.type === 'mouseover' && !b.contains(e.relatedTarget)) b.classList.remove('is-tipoff'); };
  const tipOff = (e) => { const b = e.target instanceof Element && e.target.closest('#h-wide'); if (b && (e.type === 'focusout' || !b.contains(e.relatedTarget))) b.classList.remove('is-tipoff'); };
  document.addEventListener('mouseover', tipOn);
  document.addEventListener('mouseout', tipOff);
  document.addEventListener('focusout', tipOff);

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    // The tab you pressed lights up at once, before the next page arrives.
    const bb = t.closest('#h-bar a.h-bar__a[data-bar]');
    if (bb && !e.metaKey && !e.ctrlKey && !e.shiftKey) $$('#h-bar .h-bar__a').forEach((x) => { const on = x === bb; x.classList.toggle('is-on', on); if (on) x.setAttribute('aria-current', 'true'); else x.removeAttribute('aria-current'); });
    const wb = t.closest('#h-wide');
    if (wb) { e.preventDefault(); wb.classList.add('is-tipoff'); toggleWide(); return; }
    if (t.closest('#h-scrim')) { setPeek(false); return; }
    const pin = t.closest('.h-pin');
    if (pin) { e.preventDefault(); e.stopPropagation(); togglePin(pin.dataset.pin); return; }
    const tog = t.closest('.h-area__tog');
    if (tog) { e.preventDefault(); toggleGroup(tog.closest('.h-area')); return; }
    const pop = t.closest('.h-area--pop .h-area__link');
    if (pop) {
      e.preventDefault(); e.stopPropagation();
      const a = pop.closest('.h-area'); const on = !a.classList.contains('is-pop');
      // The rail's More opens beside its own button, wherever the rail put it.
      if (on && a.classList.contains('h-area--more')) { const r = pop.getBoundingClientRect(); a.style.setProperty('--more-top', Math.max(8, Math.min(r.top, window.innerHeight - 220)) + 'px'); }
      $$('.h-area--pop.is-pop').forEach((x) => { if (x !== a) x.classList.remove('is-pop'); });
      a.classList.toggle('is-pop', on); if (isFull() || phoneMq.matches) a.classList.toggle('is-open', on); return;
    }
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

  // ---- tab row menus (src/components/NavTabs.astro): a group (Reports, Teams, Learning) and More open under their button.
  let tabMenu = null;
  function closeTabMenu() {
    if (!tabMenu) return;
    tabMenu.menu.hidden = true;
    tabMenu.btn.setAttribute('aria-expanded', 'false');
    tabMenu = null;
  }
  function openTabMenu(btn) {
    const nav = btn.closest('#h-tabs');
    const menu = nav && nav.querySelector(`[data-menu="${btn.dataset.menuFor}"]`);
    if (!menu) return;
    if (tabMenu && tabMenu.btn === btn) { closeTabMenu(); return; }
    closeTabMenu();
    menu.hidden = false;
    const r = btn.getBoundingClientRect();
    const w = menu.offsetWidth;
    menu.style.top = Math.round(r.bottom + 4) + 'px';
    menu.style.left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - w - 8))) + 'px';
    btn.setAttribute('aria-expanded', 'true');
    tabMenu = { btn, menu };
    const first = menu.querySelector('a:not([hidden])');
    if (first && root.classList.contains('kbd')) first.focus();
  }
  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    const btn = t && t.closest('#h-tabs .h-tab--menu');
    if (btn) { e.preventDefault(); openTabMenu(btn); return; }
    if (tabMenu && !(t && t.closest('.h-tabmenu'))) closeTabMenu();
    else if (tabMenu && t && t.closest('.h-tabmenu a')) closeTabMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (!tabMenu) return;
    if (e.key === 'Escape') { const b = tabMenu.btn; closeTabMenu(); b.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = $$('a:not([hidden])', tabMenu.menu);
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1) + (i < 0 && e.key === 'ArrowUp' ? 1 : 0)) % items.length].focus();
    }
  }, true);
  window.addEventListener('resize', closeTabMenu);
  window.addEventListener('scroll', (e) => { if (tabMenu && !(e.target instanceof Element && e.target.closest && e.target.closest('.h-tabmenu'))) closeTabMenu(); }, true);
  document.addEventListener('hub-swapped', closeTabMenu);

  document.addEventListener('keydown', onKey);
  const onMq = () => { if (!app) return; if (wideMq.matches) app.classList.remove('is-peek'); root.classList.toggle('nav-wide', wideMq.matches && !!prefs().wide); sync(); };
  wideMq.addEventListener('change', onMq);
  phoneMq.addEventListener('change', onMq);
  document.addEventListener('favor-hub', () => { applyOpen(); renderPins(); });
  window.addEventListener('hub-nav-toggle', toggleWide);

  window.__hubNav = { init, toggle: toggleWide };
  init();
})();

// Tab rows that hold more tabs than fit get a fade on the right, and the active tab scrolls into view.
(function () {
  function fit() {
    document.querySelectorAll('.h-tabs__row').forEach(function (row) {
      var on = row.querySelector('.h-tab.is-on');
      if (on && (on.offsetLeft + on.offsetWidth > row.scrollLeft + row.clientWidth - 8 || on.offsetLeft < row.scrollLeft)) row.scrollLeft = Math.max(0, on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2);
      row.classList.toggle('is-over', row.scrollWidth > row.clientWidth + 2 && row.scrollLeft + row.clientWidth < row.scrollWidth - 2);
      row.classList.toggle('is-over-l', row.scrollLeft > 2);
    });
  }
  window.__hubFit = fit;
  window.addEventListener('resize', fit);
  document.addEventListener('scroll', function (e) { if (e.target && e.target.classList && e.target.classList.contains('h-tabs__row')) fit(); }, true);
  document.addEventListener('astro:page-load', fit);
  document.addEventListener('hub:swapped', fit);
  document.addEventListener('hub-swapped', fit);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fit); else fit();
})();

// Re-measure the tab rows whenever the header changes width (a stamp or button appearing after load), not only on resize.
(function () {
  if (!window.ResizeObserver) return;
  var ro = new ResizeObserver(function () { if (window.__hubFit) window.__hubFit(); });
  function watch() { document.querySelectorAll('.h-tabs__row, .h-top').forEach(function (el) { ro.observe(el); }); }
  watch();
  document.addEventListener('hub:swapped', watch);
  document.addEventListener('hub-swapped', watch);
  document.addEventListener('astro:page-load', watch);
})();
