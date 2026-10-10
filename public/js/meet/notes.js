// One meeting's notes: summary, decisions, action items, the recording in Drive, chapters, what was asked, and the searchable transcript.
import { $, esc, ic, av, api, fmtDay, fmtTime, pump, copy, toast } from './ui.js';

const MID = new URLSearchParams(location.search).get('m') || '';
const root = $('#mt-notes');
const stamp = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
let data = null, q = '';
const ask = { q: '', busy: false, answer: null };

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
const ts = (t) => `<a class="nt-ts" href="#t=${t}" data-t="${t}">${stamp(t)}</a>`;

function transcriptText() {
  const m = data.meeting;
  const head = `${m.title}\n${m.startedAt ? fmtDay(m.startedAt) + ' ' + fmtTime(m.startedAt) : ''}\n\n`;
  return head + (data.transcript || []).map((l) => `[${stamp(l.t)}] ${l.who ? l.who + ': ' : ''}${l.text}`).join('\n') + '\n';
}

function download() {
  if (!(data.transcript || []).length) { toast('This meeting has no transcript'); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([transcriptText()], { type: 'text/plain' }));
  a.download = (data.meeting.title || 'meeting').replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 80) + ' transcript.txt';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function draw() {
  const m = data.meeting; const n = data.notes || {};
  document.title = m.title + ' | Favor Hub';
  const crumb = document.querySelector('.h-top__crumb'); if (crumb) crumb.textContent = m.title;
  const keepFocus = document.activeElement && document.activeElement.id;
  const lines = (data.transcript || []).filter((l) => !q || ((l.who || '') + ' ' + l.text).toLowerCase().includes(q.toLowerCase()));
  const pending = m.notesStatus === 'pending' || m.recState === 'uploading' || m.status === 'live';
  const failed = m.notesStatus === 'failed';
  const ppl = data.people || [];
  const files = data.files || [];
  const mins = m.startedAt && m.endedAt ? Math.max(1, Math.round((Date.parse(m.endedAt) - Date.parse(m.startedAt)) / 60000)) : 0;
  const hasTr = (data.transcript || []).length > 0;
  root.innerHTML = `<div class="nt-head"><div><div class="h-label" style="margin-bottom:6px">Meeting notes</div><h2>${esc(m.title)}</h2>
    <div class="nt-meta"><span>${ic('cal')}${m.startedAt ? fmtDay(m.startedAt) : ''}</span>${m.startedAt && m.endedAt ? `<span>${ic('clock')}${fmtTime(m.startedAt)} to ${fmtTime(m.endedAt)}${mins ? ' (' + mins + ' min)' : ''}</span>` : ''}<span>${ic('users')}${ppl.length} ${ppl.length === 1 ? 'person' : 'people'}</span><span class="mt-avs">${ppl.slice(0, 6).map((p) => av(p.name)).join('')}</span></div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="h-btn h-btn--ghost h-btn--sm" id="nt-dl">${ic('download')}Transcript</button><button class="h-btn h-btn--ghost h-btn--sm" id="nt-copy">${ic('share')}Share</button><a class="h-btn h-btn--primary h-btn--sm" href="/meet/book/">${ic('plus')}Book the next one</a></div></div>
    ${pending ? `<div class="mt-note mt-note--gold" style="margin-bottom:14px"><b>${m.status === 'live' ? 'The meeting is still going.' : 'The notes are being made.'}</b> <span id="nt-prog">${m.recState === 'uploading' ? 'Saving the recording to Google Drive.' : 'Reading the recording.'}</span> This page fills in by itself.</div>` : ''}
    ${failed ? `<div class="mt-note mt-note--gold" style="margin-bottom:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span><b>The notes failed.</b> The recording is safe in Google Drive.</span><button class="h-btn h-btn--primary h-btn--sm" id="nt-retry">Try again</button></div>` : ''}
    <div class="mt-grid"><div class="mt-stack">
      <section class="h-card mt-card"><div class="h-label" style="margin-bottom:8px">Summary</div><p class="nt-sum">${esc(m.summary || (pending ? 'Coming soon.' : failed ? 'No summary yet.' : 'No summary.'))}</p></section>
      ${(n.decisions || []).length ? `<section class="h-card mt-card"><div class="h-label" style="margin-bottom:10px">Decisions</div><ul class="nt-list">${n.decisions.map((d) => `<li><span class="b">${ic('check')}</span><span>${esc(d.text)} ${ts(d.t)}</span></li>`).join('')}</ul></section>` : ''}
      ${(data.actions || []).length ? `<section class="h-card mt-card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:4px"><div class="h-label">Action items</div><span class="mt-sub">${data.actions.filter((a) => a.done).length} of ${data.actions.length} done</span></div>${data.actions.map((a) => `<label class="act${a.done ? ' is-done' : ''}"><input type="checkbox" data-idx="${a.idx}" ${a.done ? 'checked' : ''} /><div><b>${esc(a.text)}</b><span>${[a.owner_name, a.due ? 'due ' + a.due : ''].filter(Boolean).map(esc).join(' · ') || 'No owner named'}${a.t ? ' · ' + ts(a.t) : ''}</span></div><span class="mt-pill ${a.done ? 'mt-pill--ok' : ''}">${a.done ? 'Done' : 'Open'}</span></label>`).join('')}<p class="mt-sub" style="margin:8px 0 0">Each person sees their items on Today in the hub.</p></section>` : ''}
      <section class="h-card mt-card"><div class="h-label" style="margin-bottom:10px">Transcript</div><div class="nt-search">${ic('search')}<input id="trq" placeholder="Search what was said" value="${esc(q)}" /></div>
        <div class="nt-tr">${lines.length ? lines.map((l) => `<div class="nt-l" id="t${l.t}"><time>${stamp(l.t)}</time><div>${l.who ? `<b>${hi(l.who)}</b> ` : ''}${hi(l.text)}</div></div>`).join('') : `<p class="mt-sub">${hasTr ? 'Nothing matches.' : pending ? 'The transcript is on its way.' : 'No transcript. Nobody spoke, or this meeting was not recorded.'}</p>`}</div></section>
    </div><div class="mt-stack">
      ${files.length ? `<section class="h-card mt-card" style="display:grid;gap:12px"><div class="player" id="nt-player"><div class="mini"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><button class="play" id="nt-play" aria-label="Play the recording">${ic('play')}</button></div>
        ${files.map((f) => `<div class="drive">${ic('drive')}<div><b>${files.length > 1 ? esc(f.name) : 'Saved in Google Drive'}</b><span>${esc(files.length > 1 ? 'Google Drive' : f.name)}</span></div><a class="h-btn h-btn--ghost h-btn--sm" href="${esc(f.url)}" target="_blank" rel="noopener">Open</a></div>`).join('')}
        <p class="mt-sub" style="margin:0">${files.length > 1 ? `The recording is in ${files.length} parts because it moved to another person's computer partway through. All are in Meetings in US Team Files.` : 'The file is in Meetings in US Team Files.'}</p></section>` : ''}
      ${(n.chapters || []).length ? `<section class="h-card mt-card"><div class="h-label" style="margin-bottom:6px">Chapters</div>${n.chapters.map((c) => `<a class="chap" href="#t=${c.t}" data-t="${c.t}" style="text-decoration:none;color:inherit"><em>${stamp(c.t)}</em><span>${esc(c.title)}</span></a>`).join('')}</section>` : ''}
      ${(data.asked || []).length ? `<section class="h-card mt-card"><div class="h-label" style="margin-bottom:8px">Asked during the meeting</div><div class="ans"><ul>${data.asked.map((a) => `<li>${ts(a.t)}<span>${a.by ? esc(a.by) + ' asked ' : ''}"${esc(a.q)}"</span></li>`).join('')}</ul></div></section>` : ''}
      ${hasTr ? `<section class="h-card mt-card"><div class="h-label" style="margin-bottom:8px">Ask about this meeting</div><div class="rm-input" style="border:0;padding:0"><input id="nt-ask" placeholder="Who owns the print file?" maxlength="300" value="${esc(ask.q)}" ${ask.busy ? 'disabled' : ''} /><button class="icb send" id="nt-ask-go" aria-label="Ask" ${ask.busy ? 'disabled' : ''}>${ic('send')}</button></div>
        ${ask.busy ? '<p class="mt-sub" style="margin:8px 0 0">Reading the transcript.</p>' : ask.answer ? `<div class="ans" style="margin-top:8px"><p style="margin:0 0 6px;font-size:13.5px">${esc(ask.answer.answer)}</p>${ask.answer.points.length ? `<ul>${ask.answer.points.map((p) => `<li>${ts(p.t)}<span>${esc(p.text)}</span></li>`).join('')}</ul>` : ''}</div>` : ''}</section>` : ''}
    </div></div>`;
  $('#nt-copy').addEventListener('click', () => copy(location.href));
  $('#nt-dl').addEventListener('click', download);
  const retry = $('#nt-retry');
  if (retry) retry.addEventListener('click', async () => {
    retry.disabled = true;
    try {
      await api('meetings/' + MID + '/pump', { method: 'POST', body: { retry: true } });
      data = await api('meetings/' + MID + '/notes'); draw();
      await pump(MID, (st) => { const p = $('#nt-prog'); if (p) p.textContent = st; });
      data = await api('meetings/' + MID + '/notes'); draw();
    } catch (e) { retry.disabled = false; toast(e.message); }
  });
  const play = $('#nt-play');
  if (play) play.addEventListener('click', () => { $('#nt-player').innerHTML = `<iframe src="https://drive.google.com/file/d/${encodeURIComponent(files[0].id)}/preview" allow="autoplay; fullscreen" allowfullscreen title="Recording"></iframe>`; });
  root.querySelectorAll('input[data-idx]').forEach((c) => c.addEventListener('change', async () => {
    try {
      await api('meetings/' + MID + '/action', { method: 'POST', body: { idx: Number(c.dataset.idx), done: c.checked } });
      data.actions.find((a) => a.idx === Number(c.dataset.idx)).done = c.checked ? 1 : 0; draw();
    } catch (e) { c.checked = !c.checked; toast(e.message); }
  }));
  const inp = $('#trq');
  inp.addEventListener('input', () => { q = inp.value.trim(); draw(); const i2 = $('#trq'); i2.focus(); i2.setSelectionRange(q.length, q.length); });
  if (keepFocus === 'trq') { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  const ai = $('#nt-ask');
  if (ai) {
    const go = async () => {
      const v = ai.value.trim(); if (!v || ask.busy) return;
      ask.q = v; ask.busy = true; ask.answer = null; draw();
      try { ask.answer = await api('meetings/' + MID + '/ask', { method: 'POST', body: { q: v } }); } catch (e) { toast(e.message); }
      ask.busy = false; draw();
    };
    ai.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    ai.addEventListener('input', () => { ask.q = ai.value; });
    $('#nt-ask-go').addEventListener('click', go);
    if (keepFocus === 'nt-ask') { ai.focus(); ai.setSelectionRange(ai.value.length, ai.value.length); }
  }
  root.querySelectorAll('[data-t]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const el = document.getElementById('t' + a.dataset.t) || [...document.querySelectorAll('.nt-l')].find((x) => x.id && Number(x.id.slice(1)) >= Number(a.dataset.t));
    if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.style.background = 'var(--h-leaf-soft)'; setTimeout(() => (el.style.background = ''), 1800); }
  }));
}

load();
