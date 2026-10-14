// Clips: the Share window. One place to choose who can watch a clip (Private, Specific people, Anyone at Favor, Everybody), add
// people by name, see which Chat conversations it was posted in, and copy the link. A change saves the moment it is made and
// takes effect on the next request (the server reads the level on every watch, info, comment, viewers, thumbnail, transcript and
// download request). Used by the watch page, the library and the recorder's saved card.
import { api, ask, copyText, esc, toast } from './core.js';

const ICON = {
  private: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3.2 2.7-5.2 6-5.2s6 2 6 5.2"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.2c1.8.7 3 2.3 3 4.8"/>',
  staff: '<path d="M4 20V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15M14 9h5a1 1 0 0 1 1 1v10M3 20h18"/><path d="M8 8h2M8 12h2M8 16h2"/>',
  public: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
};
const svg = (n) => `<svg class="cs-i" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;

export const LEVELS = [
  { id: 'private', label: 'Private', line: 'Only you and FavorOS admins can watch this clip.' },
  { id: 'people', label: 'Specific people', line: 'You, admins, the people you add below, and members of any Chat conversation where you post it.' },
  { id: 'staff', label: 'Anyone at Favor', line: 'Any Favor staff member who is signed in to FavorOS and has the link.' },
  { id: 'public', label: 'Everybody', line: 'Anyone with the link can watch, including people outside Favor. No sign-in is needed, and anyone who has the link can pass it on.' },
];
export const levelLabel = (id) => (LEVELS.find((l) => l.id === id) || LEVELS[1]).label;
/** The level of a clip from either shape the API uses (library row or watch data). */
export const levelOfClip = (c) => (c && (c.level || c.access)) || (c && c.share ? 'public' : c && c.staffLink ? 'staff' : 'people');
/** The badge that marks a public clip. Empty for every other level. */
export const publicBadge = (level) => (level === 'public' ? `<span class="cs-pub" title="Anyone with the link can watch, signed in or not">${svg('public')}Public</span>` : '');

const CSS = `.cs-back{position:fixed;inset:0;z-index:3000;display:grid;place-items:center;background:rgba(42,39,34,.42);padding:16px}
.cs{width:min(520px,100%);max-height:calc(100dvh - 32px);overflow:auto;box-sizing:border-box;padding:22px;border-radius:22px;background:#fffdf9;border:1px solid #e8e4dc;box-shadow:0 28px 64px -18px rgba(42,39,34,.45);font:400 14px/1.5 Inter,ui-sans-serif,system-ui,sans-serif;color:#2a2722}
.cs *{box-sizing:border-box}
.cs-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:4px}
.cs-head h2{margin:0;font:500 22px/1.2 'Playfair Display',Georgia,serif}
.cs-x{flex:none;width:36px;height:36px;border-radius:50%;border:1px solid #ddd7cb;background:#fff;color:#57524a;font:400 20px/1 Inter,system-ui,sans-serif;cursor:pointer}
.cs-name{margin:0 0 16px;color:#6a6259;overflow-wrap:anywhere}
.cs-i{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex:none}
.cs-lvl{display:flex;align-items:center;gap:10px;border:1px solid #ddd7cb;border-radius:14px;background:#fff;padding:0 12px;height:48px}
.cs-lvl.is-public{border-color:#b4432a;background:#fdf3f0;color:#7d2a17}
.cs-lvl select{flex:1;min-width:0;height:46px;border:0;background:transparent;font:600 15px Inter,system-ui,sans-serif;color:inherit;cursor:pointer;outline:none}
.cs-lvl:focus-within{outline:2px solid #3f5233;outline-offset:2px}
.cs-line{margin:10px 2px 0;color:#57524a}
.cs-line.is-public{color:#7d2a17;font-weight:500}
.cs-sec{margin-top:18px}
.cs-sec h3{margin:0 0 8px;font:600 12px Inter,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#6a6259}
.cs-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.cs-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;min-height:34px;padding:4px 4px 4px 12px;border-radius:999px;background:#e7ece3;color:#2b4d24;font-weight:500}
.cs-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cs-chip button{flex:none;width:26px;height:26px;border-radius:50%;border:0;background:rgba(43,77,36,.12);color:#2b4d24;cursor:pointer;font:400 16px/1 Inter,system-ui,sans-serif}
.cs-find{position:relative}
.cs-find input,.cs-link input{width:100%;height:44px;padding:0 14px;border:1px solid #ddd7cb;border-radius:12px;background:#fff;font:400 15px Inter,system-ui,sans-serif;color:#2a2722}
.cs-find input:focus,.cs-link input:focus{outline:2px solid #3f5233;outline-offset:1px}
.cs-res{position:absolute;left:0;right:0;top:48px;z-index:2;margin:0;padding:4px;list-style:none;background:#fff;border:1px solid #ddd7cb;border-radius:12px;box-shadow:0 14px 30px -12px rgba(42,39,34,.3)}
.cs-res button{display:block;width:100%;text-align:left;border:0;background:transparent;padding:8px 10px;border-radius:8px;cursor:pointer;font:400 14px Inter,system-ui,sans-serif;color:#2a2722}
.cs-res button:hover,.cs-res button:focus-visible{background:#f1ede2;outline:none}
.cs-res small{display:block;color:#6a6259}
.cs-note{margin:8px 2px 0;color:#6a6259;font-size:13px}
.cs-link{display:flex;gap:8px}
.cs-copy{flex:none;height:44px;display:inline-flex;align-items:center;gap:6px;padding:0 18px;border-radius:999px;border:1px solid #5a7250;background:#5a7250;color:#fff;font:600 14px Inter,system-ui,sans-serif;cursor:pointer}
.cs-copy:focus-visible,.cs-x:focus-visible{outline:2px solid #3f5233;outline-offset:2px}
.cs-pub{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 10px 0 7px;border-radius:999px;background:#b4432a;color:#fff;font:600 12px Inter,system-ui,sans-serif;white-space:nowrap}
.cs-pub .cs-i{width:14px;height:14px}
.cs-save{margin:14px 2px 0;min-height:18px;color:#6a6259;font-size:13px}
.cs-load{padding:30px 0;text-align:center;color:#57524a}
@media (max-width:560px){.cs-back{align-items:end;padding:0}.cs{width:100%;max-height:92dvh;border-radius:22px 22px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom))}.cs-link{flex-direction:column}.cs-copy{justify-content:center}}`;

// The badge styles are needed wherever a clip is listed, so they load with this file.
function ensureCss() {
  if (typeof document === 'undefined' || document.getElementById('cs-css')) return;
  const st = document.createElement('style');
  st.id = 'cs-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}
ensureCss();

const chatName = (c) => (c.name ? '#' + c.name : c.kind === 'dm' ? 'a direct message' : 'a group conversation');

/**
 * Opens the Share window for a clip the signed-in person made. `onChange({ level, people })` runs after each saved change.
 * Resolves when the window closes.
 */
export function openShare(id, { onChange } = {}) {
  return new Promise((resolve) => {
    ensureCss();
    const prev = document.activeElement;
    const back = document.createElement('div');
    back.className = 'cs-back';
    back.innerHTML = `<div class="cs" role="dialog" aria-modal="true" aria-labelledby="cs-t"><div class="cs-head"><h2 id="cs-t">Share clip</h2><button type="button" class="cs-x" data-x aria-label="Close">&times;</button></div><div class="cs-load" data-body>Loading</div></div>`;
    document.body.appendChild(back);
    const box = back.querySelector('.cs');
    const S = { title: '', level: 'people', people: [], posted: [], q: '', hits: [] };
    let timer = 0;
    let closed = false;

    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey, true);
      back.remove();
      if (prev && prev.focus) prev.focus();
      resolve();
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const res = box.querySelector('.cs-res');
      if (res) { S.hits = []; res.remove(); return; }
      e.preventDefault();
      close();
    };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    box.querySelector('[data-x]').addEventListener('click', close);

    const link = `${location.origin}/c/${id}`;
    const body = () => box.querySelector('[data-body]');
    const say = (t) => { const n = box.querySelector('[data-save]'); if (n) n.textContent = t; };
    const changed = () => { if (onChange) onChange({ level: S.level, people: S.people }); window.dispatchEvent(new CustomEvent('clips:changed', { detail: { id } })); };

    function paint(keepFocus) {
      const lv = LEVELS.find((l) => l.id === S.level) || LEVELS[1];
      const pub = S.level === 'public';
      const posted = S.posted.map(chatName);
      const chatNote = !posted.length
        ? 'Posting this clip in a Chat conversation lets the people in that conversation watch it.'
        : S.level === 'private'
          ? `Posted in ${esc(posted.join(', '))}. The clip is Private, so those people cannot open it.`
          : `Posted in ${esc(posted.join(', '))}. Members of those conversations count as specific people and can watch.`;
      const people = S.level === 'people'
        ? `<div class="cs-sec"><h3>People</h3>
            <div class="cs-chips" data-chips>${S.people.map((p) => `<span class="cs-chip"><span title="${esc(p.email)}">${esc(p.name || p.email)}</span><button type="button" data-rm="${esc(p.email)}" aria-label="Stop sharing with ${esc(p.name || p.email)}">&times;</button></span>`).join('')}</div>
            <div class="cs-find"><input type="text" data-add placeholder="Add a Favor staff member by name or email" aria-label="Add a Favor staff member" autocomplete="off" value="${esc(S.q)}"></div>
            <p class="cs-note">${chatNote} Only Favor staff can be added here. To share outside Favor, choose Everybody.</p></div>`
        : S.level === 'private' && posted.length ? `<p class="cs-note">${chatNote}</p>` : '';
      box.querySelector('[data-body]').outerHTML = `<div data-body>
        <p class="cs-name">${esc(S.title || 'Untitled clip')}</p>
        <div class="cs-lvl${pub ? ' is-public' : ''}">${svg(S.level)}<select data-level aria-label="Who can watch">${LEVELS.map((l) => `<option value="${l.id}"${l.id === S.level ? ' selected' : ''}>${l.label}</option>`).join('')}</select></div>
        <p class="cs-line${pub ? ' is-public' : ''}" data-line aria-live="polite">${esc(lv.line)}</p>
        ${people}
        <div class="cs-sec"><h3>Link</h3><div class="cs-link"><input type="text" readonly value="${esc(link)}" aria-label="Clip link" data-linkin><button type="button" class="cs-copy" data-copy>${svg('link')}Copy link</button></div></div>
        <p class="cs-save" data-save role="status"></p></div>`;
      if (keepFocus) {
        const t = box.querySelector(keepFocus);
        if (t) { t.focus(); if (t.setSelectionRange && t.value) t.setSelectionRange(t.value.length, t.value.length); }
      }
    }

    async function patch(json) {
      return api(`/api/clips/${id}`, { method: 'PATCH', json });
    }

    box.addEventListener('change', async (e) => {
      if (!e.target.matches('[data-level]')) return;
      const next = e.target.value;
      const was = S.level;
      if (next === was) return;
      if (next === 'public' && !(await ask({ title: 'Make this clip public?', body: 'Anyone with the link can watch it, including people outside Favor, with no sign-in. Anyone who has the link can pass it on. You can change this back at any time.', ok: 'Make it public', danger: true }))) {
        e.target.value = was;
        return;
      }
      try {
        say('Saving');
        const r = await patch({ access: next });
        S.level = r.access || next;
        say(`Saved. ${levelLabel(S.level)} is on now.`);
        paint('[data-level]');
        changed();
      } catch (err) {
        e.target.value = was;
        say('');
        toast(err.message, 'bad');
      }
    });

    box.addEventListener('click', async (e) => {
      const rm = e.target.closest('[data-rm]');
      if (rm) {
        try {
          const r = await patch({ removePeople: [rm.dataset.rm] });
          S.people = r.people || S.people.filter((p) => p.email !== rm.dataset.rm);
          paint('[data-add]');
          say('Saved');
          changed();
        } catch (err) { toast(err.message, 'bad'); }
        return;
      }
      if (e.target.closest('[data-copy]')) {
        const ok = await copyText(link);
        say(ok ? (S.level === 'public' ? 'Link copied. Anyone can open it.' : 'Link copied. It opens for the people the level above allows.') : 'Could not copy the link');
        const b = box.querySelector('[data-copy]');
        if (b && ok) { const old = b.innerHTML; b.textContent = 'Copied'; setTimeout(() => { if (b.isConnected) b.innerHTML = old; }, 1600); }
        return;
      }
      const hit = e.target.closest('[data-pick]');
      if (hit) await add(hit.dataset.pick);
    });
    box.addEventListener('focusin', (e) => { if (e.target.matches('[data-linkin]')) e.target.select(); });

    async function add(email) {
      try {
        const r = await patch({ addPeople: [email] });
        S.people = r.people || S.people;
        S.q = '';
        S.hits = [];
        paint('[data-add]');
        say('Saved');
        changed();
      } catch (err) { toast(err.message, 'bad'); }
    }

    box.addEventListener('keydown', (e) => {
      if (e.target.matches('[data-add]') && e.key === 'Enter') {
        e.preventDefault();
        const v = e.target.value.trim().toLowerCase();
        if (S.hits[0]) add(S.hits[0].email);
        else if (/^[^@\s]+@[^@\s]+$/.test(v)) add(v);
      }
    });
    box.addEventListener('input', (e) => {
      if (!e.target.matches('[data-add]')) return;
      const input = e.target;
      S.q = input.value;
      // Results from an earlier keystroke never answer Enter for this one.
      S.hits = [];
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = S.q.trim();
        const old = box.querySelector('.cs-res');
        if (old) old.remove();
        if (q.length < 2) { S.hits = []; return; }
        try {
          const r = await api(`/api/clips/people?q=${encodeURIComponent(q)}`);
          const have = new Set(S.people.map((p) => p.email));
          S.hits = (r.people || []).filter((p) => !have.has(p.email));
          if (!input.isConnected || input.value.trim() !== q) return;
          const ul = document.createElement('ul');
          ul.className = 'cs-res';
          ul.innerHTML = S.hits.length ? S.hits.map((p) => `<li><button type="button" data-pick="${esc(p.email)}">${esc(p.name)}<small>${esc(p.email)}</small></button></li>`).join('') : `<li><button type="button" disabled>No Favor staff member matches that.</button></li>`;
          input.parentElement.appendChild(ul);
        } catch (err) { /* the list stays closed */ }
      }, 180);
    });

    (async () => {
      try {
        const d = await api(`/api/clips/${id}/info`);
        if (!(d.can && d.can.share)) throw Object.assign(new Error('Only the person who made this clip can change who watches it.'), { status: 403 });
        S.title = (d.clip && d.clip.title) || '';
        S.level = d.level || levelOfClip(d.clip);
        S.people = d.people || [];
        S.posted = d.postedIn || [];
        if (closed) return;
        paint('[data-level]');
      } catch (err) {
        if (closed) return;
        body().textContent = err.message || 'Could not load the sharing choices.';
      }
    })();
  });
}
