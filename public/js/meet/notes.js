// One meeting's notes: summary, decisions, action items, the recording in Drive, chapters, and the searchable transcript.
import { $, esc, ic, av, api, fmtDay, fmtTime, pump, copy } from './ui.js';

const MID = new URLSearchParams(location.search).get('m') || '';
const root = $('#mt-notes');
const stamp = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
let data = null, q = '';

async function load() {
  try {
    data = await api('meetings/' + MID + '/notes');
    draw();
    const m = data.meeting;
    if (m.status === 'ended' && (m.notesStatus === 'pending' || m.recState === 'uploading')) { await pump(MID, (st) => { const p = $('#nt-prog'); if (p) p.textContent = st; }); data = await api('meetings/' + MID + '/notes'); draw(); }
  } catch (e) { root.innerHTML = `<div class="h-card mt-card" style="max-width:560px"><h2 class="mt-h2">Notes not available</h2><p class="mt-sub" style="font-size:14px">${esc(e.message)}</p><a class="h-btn h-btn--primary" href="/meet/library/">All meeting notes</a></div>`; }
  root.removeAttribute('aria-busy');
}

const hi = (t) => (q ? esc(t).replace(new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>') : esc(t));

function draw() {
  const m = data.meeting; const n = data.notes || {};
  const keepFocus = document.activeElement && document.activeElement.id === 'trq';
  const lines = (data.transcript || []).filter((l) => !q || l.text.toLowerCase().includes(q.toLowerCase()));
  const pending = m.notesStatus === 'pending' || m.recState === 'uploading' || m.status === 'live';
  const ppl = data.people || [];
  const mins = m.startedAt && m.endedAt ? Math.max(1, Math.round((Date.parse(m.endedAt) - Date.parse(m.startedAt)) / 60000)) : 0;
  root.innerHTML = `<div class="nt-head"><div><div class="h-label" style="margin-bottom:6px">Meeting notes</div><h2>${esc(m.title)}</h2>
    <div class="nt-meta"><span>${ic('cal')}${m.startedAt ? fmtDay(m.startedAt) : ''}</span>${m.startedAt && m.endedAt ? `<span>${ic('clock')}${fmtTime(m.startedAt)} to ${fmtTime(m.endedAt)}${mins ? ' (' + mins + ' min)' : ''}</span>` : ''}<span>${ic('users')}${ppl.length} people</span><span class="mt-avs">${ppl.slice(0, 6).map((p) => av(p.name)).join('')}</span></div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="h-btn h-btn--ghost h-btn--sm" id="nt-copy">${ic('link')}Copy link</button><a class="h-btn h-btn--primary h-btn--sm" href="/meet/book/">${ic('plus')}Book the next one</a></div></div>
    ${pending ? `<div class="mt-note mt-note--gold" style="margin-bottom:14px"><b>${m.status === 'live' ? 'The meeting is still going.' : 'The notes are being made.'}</b> <span id="nt-prog">${m.recState === 'uploading' ? 'Saving the recording to Google Drive.' : 'Reading the recording.'}</span> This page fills in by itself.</div>` : ''}
    <div class="mt-grid"><div class="mt-stack">
      <section class="h-card mt-card"><div class="h-label" style="margin-bottom:8px">Summary</div><p class="nt-sum">${esc(m.summary || (pending ? 'Coming soon.' : 'No summary.'))}</p></section>
      ${(n.decisions || []).length ? `<section class="h-card mt-card"><div class="h-label" style="margin-bottom:10px">Decisions</div><ul class="nt-list">${n.decisions.map((d) => `<li><span class="b">${ic('check')}</span><span>${esc(d.text)} <a href="#t=${d.t}" data-t="${d.t}" style="color:var(--h-brand-ink)">${stamp(d.t)}</a></span></li>`).join('')}</ul></section>` : ''}
      ${(n.actions || []).length ? `<section class="h-card mt-card"><div class="h-label" style="margin-bottom:4px">Action items</div>${n.actions.map((a) => `<div class="act"><span></span><div><b>${esc(a.text)}</b><span>${[a.owner, a.due ? 'due ' + a.due : ''].filter(Boolean).map(esc).join(' · ') || 'No owner named'}${a.t ? ` · <a href="#t=${a.t}" data-t="${a.t}" style="color:var(--h-brand-ink)">${stamp(a.t)}</a>` : ''}</span></div></div>`).join('')}</section>` : ''}
      <section class="h-card mt-card"><div class="h-label" style="margin-bottom:10px">Transcript</div><div class="tr-search">${ic('search')}<input id="trq" placeholder="Search what was said" value="${esc(q)}" /></div>
        <div class="tr">${lines.length ? lines.map((l) => `<div class="tr-l" id="t${l.t}"><time>${stamp(l.t)}</time><div>${hi(l.text)}</div></div>`).join('') : `<p class="mt-sub">${(data.transcript || []).length ? 'Nothing matches.' : pending ? 'The transcript is on its way.' : 'No transcript. Nobody spoke, or this meeting was not recorded.'}</p>`}</div></section>
    </div><div class="mt-stack">
      ${(data.files || []).map((f) => `<section class="h-card mt-card"><div class="drive">${ic('drive')}<div><b>Saved in Google Drive</b><span>${esc(f.name)}</span></div><a class="h-btn h-btn--ghost h-btn--sm" href="${esc(f.url)}" target="_blank" rel="noopener">Open</a></div><p class="mt-sub" style="margin:8px 0 0">Everyone invited can open it.</p></section>`).join('')}
      ${(n.chapters || []).length ? `<section class="h-card mt-card"><div class="h-label" style="margin-bottom:6px">Chapters</div>${n.chapters.map((c) => `<a class="chap" href="#t=${c.t}" data-t="${c.t}" style="text-decoration:none;color:inherit"><em>${stamp(c.t)}</em><span>${esc(c.title)}</span></a>`).join('')}</section>` : ''}
    </div></div>`;
  $('#nt-copy').addEventListener('click', () => copy(location.href));
  const inp = $('#trq');
  inp.addEventListener('input', () => { q = inp.value.trim(); draw(); const i2 = $('#trq'); i2.focus(); i2.setSelectionRange(q.length, q.length); });
  if (keepFocus) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  root.querySelectorAll('[data-t]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); const el = document.getElementById('t' + a.dataset.t) || [...document.querySelectorAll('.tr-l')].find((x) => x.id && Number(x.id.slice(1)) >= Number(a.dataset.t)); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.style.background = 'var(--h-leaf-soft)'; setTimeout(() => (el.style.background = ''), 1800); } }));
}

load();
