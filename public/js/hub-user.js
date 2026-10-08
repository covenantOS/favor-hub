/* The signed-in person in the header: photo or initials, name, and Sign out. */
(() => {
  const slot = document.getElementById('hub-user');
  if (!slot) return;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then((r) => r.json())
    .then((me) => {
      if (!me || !me.signedIn || !me.user || me.user.via !== 'google') return;
      const u = me.user;
      const name = u.name || u.email;
      const face = u.picture
        ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer" />`
        : `<span>${esc(initials(name))}</span>`;
      slot.innerHTML =
        `<button type="button" class="hub-user__btn" aria-haspopup="true" aria-expanded="false">` +
        `<span class="hub-user__face">${face}</span><span class="hub-user__name">${esc(name.split(' ')[0])}</span></button>` +
        `<div class="hub-user__menu" hidden>` +
        `<div class="hub-user__who"><b>${esc(name)}</b><span>${esc(u.email)}</span></div>` +
        `<button type="button" class="hub-user__out">Sign out</button></div>`;
      slot.hidden = false;

      const btn = slot.querySelector('.hub-user__btn');
      const menu = slot.querySelector('.hub-user__menu');
      const close = () => {
        menu.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
      };
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.hidden = !menu.hidden;
        btn.setAttribute('aria-expanded', String(!menu.hidden));
      });
      document.addEventListener('click', (e) => {
        if (!slot.contains(e.target)) close();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close();
      });
      slot.querySelector('.hub-user__out').addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
        location.href = '/login/?signedout=1';
      });
    })
    .catch(() => {});
})();
