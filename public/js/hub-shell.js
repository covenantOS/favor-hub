/* The hub frame: who is signed in, the counts beside each tool, the sections only some people see,
   the phone menu, and Sign out. */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

  const app = $('h-app');
  const menu = $('h-menu');
  if (menu && app) {
    menu.addEventListener('click', (e) => {
      e.stopPropagation();
      app.classList.toggle('is-nav');
    });
    document.addEventListener('click', (e) => {
      if (app.classList.contains('is-nav') && !e.target.closest('.h-side')) app.classList.remove('is-nav');
    });
  }

  const out = $('h-out');
  if (out) {
    out.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
      location.href = '/login/?signedout=1';
    });
  }

  fetch('/api/hub/nav', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d || !d.ok) return;
      const u = d.user || {};
      window.FAVOR_HUB = d;
      document.dispatchEvent(new CustomEvent('favor-hub', { detail: d }));
      if (u.via === 'google') {
        $('h-name').textContent = u.name || u.email;
        $('h-email').textContent = u.email;
        $('h-avatar').innerHTML = u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer" />` : esc(initials(u.name || u.email));
        $('h-foot').hidden = false;
      }
      const access = d.access || {};
      document.querySelectorAll('[data-need]').forEach((el) => {
        if (access[el.dataset.need]) el.hidden = false;
      });
      const counts = d.counts || {};
      document.querySelectorAll('[data-count]').forEach((el) => {
        const n = Number(counts[el.dataset.count]) || 0;
        el.hidden = !n;
        el.textContent = n.toLocaleString('en-US');
        el.classList.toggle('h-nav__count--warn', el.dataset.count === 'receiptsLeft');
      });
    })
    .catch(() => {});
})();
