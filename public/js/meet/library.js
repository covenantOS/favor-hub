// Meeting notes library: every meeting the person was invited to. Search runs on the server (titles, summaries, hosts and
// what was said). Team chips filter the results in place. The search box is drawn once, so typing never repaints it.
import { $, esc, ic, api, fmtDay, pump } from './ui.js';
const root = $('#mt-lib');
let list = [], acts = [], people = new Map(), team = '', q = '', seq = 0, timer = 0;
const clip = (t, n = 220) => { t = (t || '').trim(); if (t.length <= n) return t; const c = t.slice(0, n); return c.slice(0, c.lastIndexOf(' ')) + '...'; };
const teamOf = (m) => people.get(String(m.hostEmail || '').toLowerCase())?.team || '';
const mins = (m) => {
  if (!m.startedAt || !m.endedAt) return '';
  const n = Math.round((Date.parse(m.endedAt) - Date.parse(m.startedAt)) / 60000);
  return n > 0 ? `${n} min` : '';
};

function card(m) {
  const body = clip(m.summary) || (m.notesStatus === 'pending' ? 'Notes are being made.' : 'Notes are not ready yet. Open the meeting to read the transcript.');
  const n = m.actionCount || 0;
  return `<a class="libc h-card" href="/meet/notes/?m=${m.id}" style="text-decoration:none"><div class="ft"><span>${esc(teamOf(m) || m.hostName || '')}</span><span>${m.endedAt ? fmtDay(m.endedAt) : ''}${mins(m) ? ' · ' + mins(m) : ''}</span></div><h4>${esc(m.title)}</h4><p>${esc(body)}</p><div class="ft"><span>${n ? `${n} action item${n === 1 ? '' : 's'}` : ''}</span>${m.recState === 'stored' ? `<span>${ic('drive')}Saved in Drive</span>` : '<span></span>'}</div></a>`;
}

function paint() {
  const teams = [...new Set(list.map(teamOf).filter(Boolean))].sort();
  if (team && !teams.includes(team)) team = '';
  $('#libchips').innerHTML = teams.length > 1 ? ['', ...teams].map((t) => `<button class="mt-chip${team === t ? ' is-on' : ''}" data-team="${esc(t)}">${esc(t || 'Everything')}</button>`).join('') : '';
  const shown = team ? list.filter((m) => teamOf(m) === team) : list;
  $('#liblist').innerHTML = shown.map(card).join('') || (q ? `<p class="mt-sub">Nothing matches "${esc(q)}".</p>` : team ? '<p class="mt-sub">No notes from this team yet.</p>' : '<p class="mt-sub">No notes yet. They appear after a meeting that records.</p>');
}

function paintActs() {
  $('#libacts').innerHTML = acts.length ? `<div class="h-card mt-card" style="margin-bottom:14px"><div class="h-label" style="margin-bottom:4px">Your action items</div>${acts.map((a) => `<label class="act"><input type="checkbox" data-m="${a.meeting_id}" data-i="${a.idx}" /><div><b>${esc(a.text)}</b><span>${esc(a.title)}${a.due ? ' · due ' + esc(a.due) : ''}</span></div><a class="h-btn h-btn--ghost h-btn--sm" href="/meet/notes/?m=${a.meeting_id}">Notes</a></label>`).join('')}</div>` : '';
}

async function search() {
  const mine = ++seq;
  try {
    const r = await api('meetings?scope=notes' + (q ? '&q=' + encodeURIComponent(q) : ''));
    if (mine !== seq) return;
    list = r.meetings;
    paint();
  } catch (e) {
    if (mine === seq) $('#liblist').innerHTML = `<p class="mt-sub">${esc(e.message)}</p>`;
  }
}

function shell() {
  root.innerHTML = `<div class="mt-intro"><div><h2 class="mt-h2">Meeting notes</h2><p>Every meeting you were invited to, with its notes, action items and transcript.</p></div></div>
    <div id="libacts"></div>
    <div class="bigsearch"><svg class="h-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="libq" placeholder="Search what was said, titles and summaries" value="${esc(q)}" autocomplete="off" /></div>
    <div class="mt-chips" id="libchips" style="margin-bottom:14px"></div>
    <div class="lib" id="liblist"><div class="h-card h-skel" style="min-height:200px"></div></div>`;
  root.addEventListener('input', (e) => {
    if (e.target.id !== 'libq') return;
    q = e.target.value.trim();
    clearTimeout(timer);
    timer = setTimeout(search, 250);
  });
  root.addEventListener('click', (e) => {
    const c = e.target.closest('[data-team]');
    if (c) { team = c.dataset.team; paint(); }
  });
  root.addEventListener('change', async (e) => {
    const c = e.target.closest('input[data-m]');
    if (!c) return;
    try {
      await api('meetings/' + c.dataset.m + '/action', { method: 'POST', body: { idx: Number(c.dataset.i), done: c.checked } });
      acts = acts.filter((a) => !(a.meeting_id === c.dataset.m && String(a.idx) === c.dataset.i));
      c.closest('label').remove();
      if (!acts.length) $('#libacts').innerHTML = '';
    } catch { c.checked = !c.checked; }
  });
}

(async () => {
  shell();
  try {
    const [r, a, d] = await Promise.all([api('meetings?scope=notes'), api('meetings/actions'), api('meetings/directory').catch(() => ({ people: [] }))]);
    list = r.meetings;
    acts = a.actions;
    people = new Map((d.people || []).map((p) => [String(p.email).toLowerCase(), p]));
    paintActs();
    paint();
    pump(null, null);
  } catch (e) {
    root.innerHTML = `<div class="h-card mt-card"><p>${esc(e.message)}</p></div>`;
  }
  root.removeAttribute('aria-busy');
})();
