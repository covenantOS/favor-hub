// Meeting notes library: every meeting the person was invited to, with its summary. Search covers titles and summaries.
import { $, esc, api, fmtDay, pump } from './ui.js';
const root = $('#mt-lib');
let list = [], q = '';

function draw() {
  const rows = list.filter((m) => !q || (m.title + ' ' + m.summary + ' ' + m.hostName).toLowerCase().includes(q.toLowerCase()));
  root.innerHTML = `<div class="mt-intro"><div><h2 class="mt-h2">Meeting notes</h2><p>Every meeting you were invited to, with its notes, action items and transcript.</p></div></div>
    <div class="bigsearch"><svg class="h-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="libq" placeholder="Search titles and summaries" value="${esc(q)}" autocomplete="off" /></div>
    <div class="lib">${rows.map((m) => `<a class="libc h-card" href="/meet/notes/?m=${m.id}" style="text-decoration:none"><div class="ft"><span>${esc(m.hostName)}</span><span>${m.endedAt ? fmtDay(m.endedAt) : ''}</span></div><h4>${esc(m.title)}</h4><p>${esc(m.summary || (m.notesStatus === 'pending' ? 'Notes are being made.' : ''))}</p></a>`).join('') || '<p class="mt-sub">No notes yet. They appear after a meeting that records.</p>'}</div>`;
  const i = $('#libq'); i.addEventListener('input', () => { q = i.value; draw(); const n = $('#libq'); n.focus(); n.setSelectionRange(q.length, q.length); });
}

(async () => {
  try { list = (await api('meetings?scope=notes')).meetings; draw(); pump(null, null); } catch (e) { root.innerHTML = `<div class="h-card mt-card"><p>${esc(e.message)}</p></div>`; }
  root.removeAttribute('aria-busy');
})();
