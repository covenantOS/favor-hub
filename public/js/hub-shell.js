/* The hub frame: who is signed in, the counts beside each tool, the sections only some people see,
   the phone menu, and Sign out. */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

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

  fetch('/api/hub/nav', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d || !d.ok) return;
      window.FAVOR_HUB = d;
      document.dispatchEvent(new CustomEvent('favor-hub', { detail: d }));
      if (window.hubApplyNav) window.hubApplyNav(d);
      try {
        localStorage.setItem('favor.hub.nav.v1', JSON.stringify({ user: d.user, access: d.access, kpiTeams: d.kpiTeams, counts: d.counts }));
      } catch {
        // storage refused; the menu still fills in from this answer
      }
    })
    .catch(() => {});
})();
