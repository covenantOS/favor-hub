/* The tab row under a page title, organised so no tab is ever cut off (loaded on every hub page and inside the app).
   Wide screens: the area's own tabs are grouped (Reporting: Executive, Highlights, a Reports menu, a Teams menu, Definitions), and any tab
   that still does not fit moves under a More menu. Phones keep the scrolling row and bring the current tab into view.
   The real tabs stay in the page, hidden; every tab and menu item here forwards its click to the real one, so counts, routing and
   the page swap behave as before. */
(function () {
  if (window.__tabOrg) return;
  window.__tabOrg = true;

  var GROUPS = {
    kpi: [
      { label: 'Reports', ids: ['reports', 'lists', 'list-reports', 'list-credit'] },
      { label: 'Teams', ids: ['kpi-rdds', 'kpi-pc', 'kpi-ce', 'kpi-grants', 'kpi-marketing'] },
    ],
  };

  var css = [
    '.h-tabs.has-org .h-tabs__row{display:none}',
    '.h-tabs__org{display:flex;align-items:center;gap:2px;min-width:0;overflow:hidden;width:100%}',
    '.h-tabs__org[hidden]{display:none}',
    '.h-tabs__org .h-tab{background:none;border-top:0;border-left:0;border-right:0;cursor:pointer}',
    '.h-tabs__org .h-tab svg{width:12px;height:12px;flex:none;opacity:.7}',
    '.h-tabmenu{position:fixed;z-index:200;min-width:200px;max-width:280px;padding:6px;background:var(--h-cream,#fffdf8);border:1px solid var(--h-line,#e6e0d2);border-radius:12px;box-shadow:0 14px 34px -14px rgba(42,39,34,.35)}',
    '.h-tabmenu[hidden]{display:none}',
    '.h-tabmenu a{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:36px;padding:0 12px;border-radius:8px;font:600 14px var(--h-font,Inter,sans-serif);color:var(--h-ink-2,#4a453d);text-decoration:none;white-space:nowrap}',
    '.h-tabmenu a:hover{background:var(--h-leaf-soft,#eef3e8);color:var(--h-ink,#2a2722)}',
    '.h-tabmenu a.is-on{color:var(--h-brand-ink,#1f4d2b);background:var(--h-leaf-soft,#eef3e8)}',
    '.h-tabmenu__h{padding:8px 12px 4px;font:600 12px var(--h-font,Inter,sans-serif);letter-spacing:.04em;text-transform:uppercase;color:var(--h-ink-3,#8a8478)}',
  ].join('');
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  var narrow = window.matchMedia('(max-width: 860px)');
  var CARET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  var curNav = null, curRow = null, org = null, menu = null, menuFor = null, mo = null, raf = 0;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function readTabs(row) {
    return Array.prototype.slice.call(row.querySelectorAll('a.h-tab:not([hidden])')).map(function (a) {
      var c = a.querySelector('.h-nav__count:not([hidden])');
      var clone = a.cloneNode(true);
      Array.prototype.forEach.call(clone.querySelectorAll('.h-nav__count'), function (n) { n.remove(); });
      return { id: a.getAttribute('data-nav-id') || '', el: a, label: clone.textContent.trim(), on: a.classList.contains('is-on'), count: c ? c.textContent.trim() : '', warn: !!(c && c.classList.contains('h-nav__count--warn')) };
    });
  }

  /** Top level items: plain tabs and menus, in the order of their first tab. */
  function arrange(areaId, tabs) {
    var groups = GROUPS[areaId] || [];
    var byId = {};
    tabs.forEach(function (t) { byId[t.id] = t; });
    var used = {}, out = [];
    tabs.forEach(function (t) {
      if (used[t.id]) return;
      var g = groups.filter(function (x) { return x.ids.indexOf(t.id) >= 0; })[0];
      if (!g) { used[t.id] = 1; out.push({ tab: t }); return; }
      var members = g.ids.filter(function (id) { return byId[id]; }).map(function (id) { used[id] = 1; return byId[id]; });
      out.push(members.length === 1 ? { tab: members[0] } : { label: g.label, members: members });
    });
    return out;
  }

  function item(it) {
    if (it.tab) {
      var a = document.createElement('a');
      a.className = 'h-tab' + (it.tab.on ? ' is-on' : '');
      a.href = it.tab.el.getAttribute('href') || '#';
      a.setAttribute('data-org-id', it.tab.id);
      if (it.tab.on) a.setAttribute('aria-current', 'page');
      a.innerHTML = esc(it.tab.label) + (it.tab.count ? '<span class="h-nav__count' + (it.tab.warn ? ' h-nav__count--warn' : '') + '">' + esc(it.tab.count) + '</span>' : '');
      a.addEventListener('click', function (e) { forward(e, it.tab.el); });
      return a;
    }
    var on = it.members.filter(function (m) { return m.on; })[0];
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'h-tab' + (on ? ' is-on' : '');
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-expanded', 'false');
    b.innerHTML = esc(on ? it.label + ' · ' + on.label : it.label) + CARET;
    b.addEventListener('click', function (e) { e.stopPropagation(); toggle(b, [{ members: it.members }]); });
    return b;
  }

  function forward(e, real) {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    closeMenu();
    real.click();
  }

  function closeMenu() {
    if (!menu) return;
    menu.hidden = true;
    if (menuFor) menuFor.setAttribute('aria-expanded', 'false');
    menuFor = null;
  }

  function toggle(btn, sections) {
    if (menuFor === btn) { closeMenu(); return; }
    closeMenu();
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'h-tabmenu';
      menu.setAttribute('role', 'menu');
      menu.hidden = true;
      document.body.appendChild(menu);
    }
    menu.innerHTML = '';
    sections.forEach(function (s) {
      if (s.label) { var h = document.createElement('div'); h.className = 'h-tabmenu__h'; h.textContent = s.label; menu.appendChild(h); }
      s.members.forEach(function (m) {
        var a = document.createElement('a');
        a.href = m.el.getAttribute('href') || '#';
        a.className = m.on ? 'is-on' : '';
        a.setAttribute('role', 'menuitem');
        a.innerHTML = '<span>' + esc(m.label) + '</span>' + (m.count ? '<span class="h-nav__count">' + esc(m.count) + '</span>' : '');
        a.addEventListener('click', function (e) { forward(e, m.el); });
        menu.appendChild(a);
      });
    });
    var r = btn.getBoundingClientRect();
    menu.hidden = false;
    var w = menu.offsetWidth;
    menu.style.top = Math.round(r.bottom + 4) + 'px';
    menu.style.left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - w - 8))) + 'px';
    btn.setAttribute('aria-expanded', 'true');
    menuFor = btn;
  }

  function sync() {
    raf = 0;
    var nav = document.getElementById('h-tabs');
    if (!nav) return;
    var row = nav.querySelector('.h-tabs__row');
    if (!row) return;
    if (nav !== curNav || row !== curRow) attach(nav, row);
    if (narrow.matches) {
      nav.classList.remove('has-org');
      if (org) org.hidden = true;
      var on = row.querySelector('.h-tab.is-on');
      if (on) { var want = on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2; if (Math.abs(row.scrollLeft - want) > 4) row.scrollLeft = Math.max(0, want); }
      return;
    }
    var tabs = readTabs(row);
    if (tabs.length < 2) { nav.classList.remove('has-org'); if (org) org.hidden = true; return; }
    nav.classList.add('has-org');
    org.hidden = false;
    var items = arrange(nav.getAttribute('data-area') || '', tabs);
    var nodes = items.map(item);
    org.innerHTML = '';
    nodes.forEach(function (n) { org.appendChild(n); });
    var moved = [];
    var moreBtn = null;
    while (items.length && org.scrollWidth > org.clientWidth + 1) {
      if (!moreBtn) {
        moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.className = 'h-tab';
        moreBtn.setAttribute('aria-haspopup', 'menu');
        moreBtn.setAttribute('aria-expanded', 'false');
        org.appendChild(moreBtn);
      }
      moved.unshift(items.pop());
      nodes.pop().remove();
      moreBtn.innerHTML = 'More' + CARET;
    }
    if (moreBtn) {
      var sections = moved.map(function (it) { return it.tab ? { members: [it.tab] } : { label: it.label, members: it.members }; });
      var flat = [];
      moved.forEach(function (it) { (it.tab ? [it.tab] : it.members).forEach(function (m) { flat.push(m); }); });
      var act = flat.filter(function (m) { return m.on; })[0];
      moreBtn.className = 'h-tab' + (act ? ' is-on' : '');
      moreBtn.innerHTML = esc(act ? 'More · ' + act.label : 'More') + CARET;
      moreBtn.addEventListener('click', function (e) { e.stopPropagation(); toggle(moreBtn, sections); });
      // A menu that still does not fit leaves its first moved tab out of view: keep dropping from the end only until it fits.
      while (items.length && org.scrollWidth > org.clientWidth + 1) {
        moved.unshift(items.pop());
        nodes.pop().remove();
        sections.unshift(moved[0].tab ? { members: [moved[0].tab] } : { label: moved[0].label, members: moved[0].members });
      }
    }
  }

  function attach(nav, row) {
    curNav = nav;
    curRow = row;
    if (mo) mo.disconnect();
    org = nav.querySelector('.h-tabs__org');
    if (!org) {
      org = document.createElement('div');
      org.className = 'h-tabs__org';
      org.hidden = true;
      row.insertAdjacentElement('afterend', org);
    }
    mo = new MutationObserver(schedule);
    mo.observe(row, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class', 'href'], characterData: true });
    if (window.ResizeObserver) new ResizeObserver(schedule).observe(nav);
  }

  function schedule() { if (!raf) raf = requestAnimationFrame(sync); }

  document.addEventListener('click', function (e) { if (menu && !menu.hidden && !menu.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('resize', function () { closeMenu(); schedule(); });
  window.addEventListener('scroll', closeMenu, true);
  new MutationObserver(function () {
    var nav = document.getElementById('h-tabs');
    if (nav && (nav !== curNav || (nav.querySelector('.h-tabs__row') !== curRow))) schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();
