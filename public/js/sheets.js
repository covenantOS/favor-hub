/* Open in Google Sheets, for every list in the hub. A page registers what its button sends
   (FavorSheets.register('name', () => ({ mode: 'rows', tabs, provenance }))) and puts
   data-sheets="name" on a button; this file runs the call, shows the progress, and handles the one-time
   Google step. The Favor Brain page calls FavorSheets.run() itself and draws its own cards.

   The first export asks Google for one permission, to create and open only the sheets the hub makes. The
   request is saved in this tab, the person goes to Google once, and the export runs again by itself when
   they come back (the address then carries ?google=sheets). */
(() => {
  const KEY = 'favor.sheets.pending';
  const SHEET_ICON = '<svg class="h-i" viewBox="0 0 24 24" aria-hidden="true" style="width:16px;height:16px"><path d="M6 2.5h8.5L19 7v13.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1z" fill="#0f9d58" stroke="none"/><path d="M14.5 2.5V7H19" fill="#87ceac" stroke="none"/><rect x="8" y="10.5" width="8" height="7" rx=".5" fill="#fff" stroke="none"/><path d="M8 13h8M8 15.3h8M11 10.5v7" stroke="#0f9d58" stroke-width=".9" fill="none"/></svg>';
  const sources = {};
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const style = document.createElement('style');
  style.textContent = `.fs-msg{display:block;margin:6px 0 0;font-size:12.5px;color:var(--h-ink-2,#57524a)}.fs-msg.is-err{color:var(--h-red,#a8573a)}
.fs-toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,20px);opacity:0;z-index:300;background:#2a2722;color:#fff;padding:10px 16px;border-radius:14px;font:500 13px Inter,system-ui,sans-serif;box-shadow:0 12px 40px -10px rgba(0,0,0,.4);transition:opacity .2s,transform .25s;display:flex;gap:10px;align-items:center}
.fs-toast.is-on{opacity:1;transform:translate(-50%,0)}.fs-toast a{color:#d7e8cc;font-weight:600}
.fs-spin{display:inline-block;width:13px;height:13px;border-radius:50%;border:2px solid rgba(42,39,34,.18);border-top-color:#57524a;animation:fs-spin .8s linear infinite;vertical-align:-2px;margin-right:6px}
@keyframes fs-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.fs-spin{animation:none}}
[data-sheets] svg{flex:none}`;
  document.head.appendChild(style);

  let toastEl = null;
  function toast(msg, link) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'fs-toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.innerHTML = esc(msg) + (link ? ` <a href="${esc(link)}" target="_blank" rel="noopener">Open it</a>` : '');
    toastEl.classList.add('is-on');
    clearTimeout(toastEl._h);
    toastEl._h = setTimeout(() => toastEl.classList.remove('is-on'), link ? 8000 : 4000);
  }

  async function run(spec) {
    try {
      const res = await fetch('/api/sheets/create', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec) });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.ok) return d;
      return { ok: false, error: d.error || 'failed', message: d.message || 'The sheet did not build. Try again in a minute.', ...d };
    } catch {
      return { ok: false, error: 'network', message: 'The hub could not be reached. Check the connection and try again.' };
    }
  }

  /** Saves what the person was doing, then goes to Google's one screen. The address says where to come back to. */
  function consent(spec, url) {
    try {
      const body = JSON.stringify({ spec, at: Date.now(), page: location.pathname + location.search });
      sessionStorage.setItem(KEY, body.length > 4 * 1024 * 1024 ? JSON.stringify({ big: true, at: Date.now() }) : body);
    } catch {
      /* storage refused; the person presses the button again when they come back */
    }
    const u = new URL(url, location.origin);
    u.searchParams.set('next', location.pathname);
    location.href = u.pathname + u.search;
  }

  function finish(d, btn) {
    const detail = d;
    const own = new CustomEvent(d.ok ? 'favor:sheet-ready' : 'favor:sheet-failed', { detail, cancelable: true });
    const showHere = document.dispatchEvent(own);
    if (showHere) toast(d.ok ? `Your sheet is ready (${(d.tabs || []).reduce((n, t) => n + t.rows, 0).toLocaleString('en-US')} rows).` : d.message, d.ok ? d.url : null);
    if (btn) paint(btn, d);
  }

  function paint(btn, d) {
    if (d.ok) {
      const a = document.createElement('a');
      a.className = btn.className;
      a.href = d.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.dataset.sheetsDone = '1';
      a.innerHTML = `${SHEET_ICON}Your sheet is ready. Open it`;
      btn.replaceWith(a);
      a.title = 'Only you can open it. Keep it inside Favor.';
      return;
    }
    btn.disabled = false;
    btn.innerHTML = btn.dataset.label;
    let m = btn.nextElementSibling;
    if (!m || !m.classList.contains('fs-msg')) {
      m = document.createElement('span');
      m.className = 'fs-msg';
      btn.after(m);
    }
    m.className = 'fs-msg is-err';
    m.textContent = d.message || 'The sheet did not build.';
  }

  async function press(btn) {
    const name = btn.dataset.sheets;
    const build = sources[name];
    if (!build) return;
    if (!btn.dataset.label) btn.dataset.label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="fs-spin"></span>Building your sheet';
    const old = btn.nextElementSibling;
    if (old && old.classList.contains('fs-msg')) old.remove();
    let spec;
    try {
      spec = await build(btn);
    } catch (e) {
      return paint(btn, { ok: false, message: (e && e.message) || 'There is nothing to put in a sheet yet.' });
    }
    if (!spec) return paint(btn, { ok: false, message: 'There is nothing to put in a sheet yet.' });
    const d = await run(spec);
    if (!d.ok && (d.error === 'consent' || d.error === 'not_connected')) {
      btn.innerHTML = '<span class="fs-spin"></span>Opening Google';
      return consent(spec, d.consentUrl || d.connectUrl);
    }
    finish(d, btn);
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-sheets]');
    if (b && !b.disabled) {
      e.preventDefault();
      press(b);
    }
  });

  /** Back from Google: run the saved export again, once. */
  async function resume() {
    const u = new URL(location.href);
    const g = u.searchParams.get('google');
    if (g !== 'sheets' && g !== 'connected') return;
    let pending = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      sessionStorage.removeItem(KEY);
    } catch {
      pending = null;
    }
    if (g === 'sheets') {
      u.searchParams.delete('google');
      history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
    }
    if (!pending || Date.now() - pending.at > 30 * 60 * 1000) {
      if (g === 'sheets') toast('You are set. Press Open in Google Sheets again.');
      return;
    }
    if (pending.big || !pending.spec) return toast('You are set. Press Open in Google Sheets again.');
    toast('Building your sheet');
    const d = await run(pending.spec);
    if (!d.ok && (d.error === 'consent' || d.error === 'not_connected')) return toast('Google did not give the permission. Press Open in Google Sheets to try again.');
    finish(d, null);
  }

  window.FavorSheets = {
    run,
    consent,
    resume,
    register(name, fn) { sources[name] = fn; },
    /** A rows-mode request from what a page shows: tabs of { name, columns, rows }, the filter in words, and the kind of information. */
    screen(title, tabs, opts = {}) {
      return { mode: 'rows', title, tabs, provenance: { kind: 'screen', page: location.pathname, filters: opts.filters || '' }, classes: opts.classes || [] };
    },
    /** A ghost button with the Google Sheets icon, for a page that builds its header in script. */
    buttonHtml(name, label = 'Open in Google Sheets') {
      return `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-sheets="${esc(name)}">${SHEET_ICON}${esc(label)}</button>`;
    },
    icon: SHEET_ICON,
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', resume);
  else setTimeout(resume, 0);
})();
