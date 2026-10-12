/* The hub frame: who is signed in, the counts beside each tool, the sections only some people see,
   the phone menu, and Sign out. */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

  // A control with only an icon gets its name as a real tooltip (role=tooltip, linked with aria-describedby) that shows on hover and
  // keyboard focus, on every page and after every page change.
  let tipN = 0;
  const tip = () => document.querySelectorAll('button[aria-label]:not([data-tt]), a[aria-label]:not([data-tt])').forEach((el) => {
    if (el.textContent.trim() || el.closest('#h-content, dialog, .cmdk, [role=dialog]')) return;
    const t = document.createElement('span');
    t.className = 'h-tt'; t.id = 'h-tt' + (++tipN); t.setAttribute('role', 'tooltip'); t.textContent = el.getAttribute('aria-label');
    el.after(t);
    el.dataset.tt = t.id; el.setAttribute('aria-describedby', t.id);
    el.removeAttribute('title');
  });
  const showTip = (e) => {
    const el = e.target.closest && e.target.closest('[data-tt]');
    if (!el) return;
    const t = document.getElementById(el.dataset.tt);
    if (!t) return;
    const r = el.getBoundingClientRect();
    t.style.top = Math.round(r.bottom + 6) + 'px';
    t.style.left = Math.round(Math.max(8, Math.min(innerWidth - t.offsetWidth - 8, r.left + r.width / 2 - t.offsetWidth / 2))) + 'px';
    t.classList.add('is-on');
  };
  const hideTip = (e) => { const el = e.target.closest && e.target.closest('[data-tt]'); if (el) { const t = document.getElementById(el.dataset.tt); if (t) t.classList.remove('is-on'); } };
  document.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') showTip(e); });
  document.addEventListener('pointerout', hideTip);
  document.addEventListener('focusin', (e) => { if (e.target.matches && e.target.matches(':focus-visible')) showTip(e); });
  document.addEventListener('focusout', hideTip);
  document.addEventListener('pointerdown', hideTip, true);
  tip();
  document.addEventListener('hub-swapped', tip);
  new MutationObserver(() => { clearTimeout(tip.t); tip.t = setTimeout(tip, 300); }).observe(document.body, { childList: true, subtree: true });

  const app = $('h-app');
  const menu = $('h-menu');
  if (menu && app) {
    const setNav = (open) => {
      app.classList.toggle('is-nav', open);
      menu.setAttribute('aria-expanded', open ? 'true' : 'false');
      menu.setAttribute('aria-label', open ? 'Close the menu' : 'Open the menu');
    };
    menu.addEventListener('click', (e) => {
      e.stopPropagation();
      setNav(!app.classList.contains('is-nav'));
    });
    document.addEventListener('click', (e) => {
      if (app.classList.contains('is-nav') && !e.target.closest('.h-side')) setNav(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && app.classList.contains('is-nav')) {
        setNav(false);
        menu.focus();
      }
    });
  }

  const sideX = $('h-side-x');
  if (sideX && app && menu) sideX.addEventListener('click', () => {
    app.classList.remove('is-nav');
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-label', 'Open the menu');
    const more = $('h-bar-more');
    if (more) more.setAttribute('aria-expanded', 'false');
  });

  // The account menu: My clips and Record a clip, under the person's own name.
  const acct = $('h-acct');
  const acctMenu = $('h-acctmenu');
  if (acct && acctMenu) {
    const setAcct = (open) => {
      acctMenu.hidden = !open;
      acct.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    acct.addEventListener('click', (e) => {
      e.stopPropagation();
      setAcct(acctMenu.hidden);
    });
    document.addEventListener('click', (e) => {
      if (!acctMenu.hidden && !e.target.closest('#h-acctmenu')) setAcct(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !acctMenu.hidden) {
        setAcct(false);
        acct.focus();
      }
    });
    acctMenu.addEventListener('click', (e) => {
      const rec = e.target.closest('[data-clip-record]');
      setAcct(false);
      if (rec) {
        const cam = $('clip-cam');
        if (cam) cam.click();
      }
    });
  }

  const out = $('h-out');
  if (out) {
    out.addEventListener('click', async () => {
      try {
        localStorage.removeItem('favor.hub.nav.v1');
        sessionStorage.clear();
      } catch {
        // nothing saved to clear
      }
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
      location.href = '/login/?signedout=1';
    });
  }

  // The counts beside each tool, the sections this person may open and who is signed in. Read on load, again after a page changes
  // in place (at most every 20 seconds) and when the tab comes back to the front, so a badge never shows a count from an hour ago.
  let navAt = 0;
  let navBusy = false;
  const readNav = (force) => {
    if (navBusy || (!force && Date.now() - navAt < 20000)) return;
    navBusy = true;
    fetch('/api/hub/nav', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !d.ok) return;
        navAt = Date.now();
        window.FAVOR_HUB = d;
        document.dispatchEvent(new CustomEvent('favor-hub', { detail: d }));
        if (window.hubApplyNav) window.hubApplyNav(d);
        try {
          localStorage.setItem('favor.hub.nav.v1', JSON.stringify({ user: d.user, access: d.access, kpiTeams: d.kpiTeams, counts: d.counts }));
        } catch {
          // storage refused; the menu still fills in from this answer
        }
      })
      .catch(() => {})
      .then(() => { navBusy = false; });
  };
  window.hubNavRefresh = readNav;
  readNav(true);
  // A change made on a page (a request approved, a note answered, a mention read) moves a count: read the counts again a moment after it.
  const realFetch = window.fetch;
  let afterT = 0;
  window.fetch = function (input, init) {
    const p = realFetch.apply(this, arguments);
    const m = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (m !== 'GET' && m !== 'HEAD') {
      const u = String((input && input.url) || input);
      if (/\/api\//.test(u) && !/\/api\/(hub\/nav|auth|clips\/|meet\/|chat\/(?!inbox))/.test(u)) p.then(() => { clearTimeout(afterT); afterT = setTimeout(() => readNav(true), 1500); }, () => {});
    }
    return p;
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') readNav(false); });
})();

/* The back gesture closes whatever is open on top (search, feedback, help, the phone menu, a number's rows, the tour)
   instead of leaving the page. Opening an overlay adds one history entry; closing it any other way removes that entry.
   hub-swap.js asks hubOv to unwind before it changes pages, and ignores the popstate this causes. */
(() => {
  const stack = [];
  let quiet = 0;
  const pop = () => { try { quiet++; history.back(); } catch (e) { quiet--; } };
  const hubOv = {
    depth: () => stack.length,
    on(close) {
      const t = { close };
      stack.push(t);
      try { history.pushState({ hubov: stack.length }, ''); } catch (e) { /* no history entry; the overlay still closes the usual ways */ }
      return t;
    },
    off(t) {
      const i = stack.indexOf(t);
      if (i < 0) return;
      stack.splice(i, 1);
      if (i === stack.length && history.state && history.state.hubov) pop();
    },
    /** Remove every overlay entry, then run fn once the browser has settled. */
    unwind(fn) {
      if (!stack.length || !(history.state && history.state.hubov)) { stack.length = 0; fn(); return; }
      const n = stack.length;
      stack.length = 0;
      let left = n;
      const step = () => { if (--left <= 0) { removeEventListener('popstate', step); setTimeout(fn, 0); } };
      addEventListener('popstate', step);
      for (let k = 0; k < n; k++) { quiet++; history.back(); }
    },
    /** Run fn once any history step this module started has finished (a navigation started sooner would be cancelled by it). */
    whenIdle(fn) {
      if (quiet <= 0) { fn(); return; }
      let n = 0;
      const t = setInterval(() => { if (quiet <= 0 || ++n > 40) { clearInterval(t); fn(); } }, 25);
    },
    /** Track an element that opens and closes by itself (an attribute or class change). */
    watch(el, isOpen, close) {
      let tok = null;
      const sync = () => {
        const open = !!isOpen(el);
        if (tok && stack.indexOf(tok) < 0) tok = null;
        if (open && !tok) tok = hubOv.on(() => { tok = null; close(el); });
        else if (!open && tok) { const t = tok; tok = null; hubOv.off(t); }
      };
      new MutationObserver(sync).observe(el, { attributes: true, attributeFilter: ['hidden', 'open', 'class'] });
      sync();
    },
  };
  addEventListener('popstate', () => {
    window.__hubOvHandled = true;
    if (quiet > 0) { quiet--; return; }
    const t = stack.pop();
    if (t) t.close(); else window.__hubOvHandled = false;
  });
  window.hubOv = hubOv;
  const phone = matchMedia('(max-width: 860px)');
  const cmdk = document.getElementById('cmdk');
  if (cmdk) hubOv.watch(cmdk, (e) => !e.hidden, (e) => { const x = e.querySelector('[data-cmdk-close]'); if (x) x.click(); else e.hidden = true; });
  const lp = document.getElementById('lp-dlg');
  if (lp) hubOv.watch(lp, (e) => e.open, (e) => e.close());
  const app = document.getElementById('h-app');
  if (app) hubOv.watch(app, (e) => phone.matches && e.classList.contains('is-nav'), () => { const x = document.getElementById('h-side-x'); if (x) x.click(); else app.classList.remove('is-nav'); });
})();
