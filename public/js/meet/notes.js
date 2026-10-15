// One meeting's notes: summary, decisions, action items, the recording in Drive, chapters, what was asked, and the searchable transcript.
import { $, esc, ic, av, api, fmtDay, fmtTime, pump, copy, toast, confirmCard } from './ui.js';

const MID = new URLSearchParams(location.search).get('m') || '';
const root = $('#mt-notes');
// 75 minutes in reads 1:15:03.
const stamp = (t) => { const s = Math.max(0, Math.floor(Number(t) || 0)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), p = (n) => String(n).padStart(2, '0'); return h ? `${h}:${p(m)}:${p(s % 60)}` : `${m}:${p(s % 60)}`; };
let data = null, q = '';
const ask = { q: '', busy: false, answer: null };
const pt = { busy: '', find: '', hits: [], err: '' };
// Privacy: remove parts of a finished meeting (or keep only one part), from the notes and the recording, or delete the recording.
// rows are the parts, as typed (minutes and seconds); cur is the row a tapped transcript time fills.
const pv = { open: false, mode: 'remove', rows: [{ from: '', to: '' }], cur: 0, rec: 'trim', busy: false, err: '' };
const secs = (v) => { const p = String(v || '').trim().split(':').map((x) => Number(x)); if (!p.length || p.some((x) => !Number.isFinite(x) || x < 0)) return NaN; return p.reduce((a, x) => a * 60 + x, 0); };
// Fix who spoke (host or admin): pick a line, or a first and last line, then the person. The notes are written again.
const sp = { open: false, a: -1, b: -1, who: '', busy: false, err: '' };
const span = (from, to) => `${stamp(from)} to ${to == null ? 'the end' : stamp(to)}`;

// ---- the recording player. One media element per file, kept between redraws so typing in the search box never stops playback.
const players = new Map();
const clock = (t) => (Number.isFinite(t) && t >= 0 ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : '0:00');
function playerNode(f, label, mins) {
  const key = f.src;
  if (players.has(key)) return players.get(key);
  const video = f.kind === 'video';
  const wrap = document.createElement('div');
  wrap.className = 'player is-' + (video ? 'video' : 'sound');
  wrap.setAttribute('role', 'button'); wrap.tabIndex = 0;
  wrap.setAttribute('aria-label', (video ? 'Play the video recording' : 'Play the sound recording') + (label ? ', ' + label : ''));
  const media = document.createElement(video ? 'video' : 'audio');
  media.preload = 'metadata'; media.src = f.src; media.playsInline = true; media.setAttribute('playsinline', '');
  const bars = Array.from({ length: 28 }, (_, i) => `<i style="--h:${22 + ((i * 37) % 58)}%;--d:${(i % 7) * 0.11}s"></i>`).join('');
  wrap.innerHTML = `${video ? '' : `<div class="pl-top">${ic('mic')}<span>Sound only${label ? ', ' + esc(label) : ''}</span></div><div class="pl-bars" aria-hidden="true">${bars}</div>`}
    <span class="pl-btn" aria-hidden="true">${ic('play')}</span><span class="pl-spin" aria-hidden="true"></span><p class="pl-err" hidden>The recording did not load.</p>
    <div class="pl-bar" role="slider" aria-label="Position" tabindex="0"><i></i></div><div class="pl-time"><b>0:00</b><span>${mins ? clock(mins * 60) : ''}</span></div>`;
  if (video) wrap.insertBefore(media, wrap.firstChild); else wrap.appendChild(media);
  const btn = wrap.querySelector('.pl-btn');
  const PLAY = btn.innerHTML, PAUSE = '<svg class="h-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7z"/><path d="M13 5h4v14h-4z"/></svg>';
  const bar = wrap.querySelector('.pl-bar'), fill = bar.firstElementChild, now = wrap.querySelector('.pl-time b'), total = wrap.querySelector('.pl-time span'), err = wrap.querySelector('.pl-err');
  const length = () => (Number.isFinite(media.duration) && media.duration > 0 ? media.duration : (mins || 0) * 60);
  const paint = () => { const L = length(); fill.style.width = L ? Math.min(100, (media.currentTime / L) * 100) + '%' : '0%'; now.textContent = clock(media.currentTime); if (L) total.textContent = clock(L); };
  const toggle = () => { if (media.paused || media.ended) { wrap.classList.add('is-loading'); err.hidden = true; media.play().catch(() => { wrap.classList.remove('is-loading'); wrap.classList.add('is-error'); err.hidden = false; }); } else media.pause(); };
  wrap.addEventListener('click', (e) => { if (e.target.closest('.pl-bar')) return; toggle(); });
  wrap.addEventListener('keydown', (e) => { if (e.target === wrap && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); toggle(); } });
  const seek = (x) => { const r = bar.getBoundingClientRect(); const L = length(); if (L && r.width) { media.currentTime = Math.max(0, Math.min(1, (x - r.left) / r.width)) * L; paint(); } };
  bar.addEventListener('click', (e) => { e.stopPropagation(); seek(e.clientX); });
  bar.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { media.currentTime += 10; e.preventDefault(); } else if (e.key === 'ArrowLeft') { media.currentTime = Math.max(0, media.currentTime - 10); e.preventDefault(); } });
  for (const ev of ['timeupdate', 'durationchange', 'seeked']) media.addEventListener(ev, paint);
  media.addEventListener('playing', () => { wrap.classList.remove('is-loading', 'is-error'); wrap.classList.add('is-playing'); btn.innerHTML = PAUSE; });
  for (const ev of ['pause', 'ended']) media.addEventListener(ev, () => { wrap.classList.remove('is-playing', 'is-loading'); btn.innerHTML = PLAY; });
  for (const ev of ['waiting', 'seeking']) media.addEventListener(ev, () => { if (!media.paused) wrap.classList.add('is-loading'); });
  media.addEventListener('canplay', () => wrap.classList.remove('is-loading'));
  media.addEventListener('error', () => { wrap.classList.remove('is-loading', 'is-playing'); wrap.classList.add('is-error'); err.hidden = false; });
  players.set(key, wrap);
  return wrap;
}

async function load() {
  try {
    data = await api('meetings/' + MID + '/notes');
    draw();
    const m = data.meeting;
    if (m.status === 'ended' && (m.notesStatus === 'pending' || m.recState === 'uploading' || m.recState === 'trimming')) { await pump(MID, (st) => { const p = $('#nt-prog'); if (p) p.textContent = st; }); data = await api('meetings/' + MID + '/notes'); draw(); }
  } catch (e) { root.innerHTML = `<div class="h-card mt-card" style="max-width:560px"><h2 class="mt-h2">Notes not available</h2><p class="mt-sub" style="font-size:14px">${esc(e.message)}</p><a class="h-btn h-btn--primary" href="/meet/library/">All meeting notes</a></div>`; }
  root.removeAttribute('aria-busy');
}

// The match is found in the words as spoken, then each piece is escaped, so a search for "amp" never lands inside an entity.
const hi = (t) => { if (!q) return esc(t); const rx = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'); return String(t == null ? '' : t).split(rx).map((part, i) => (i % 2 ? '<mark>' + esc(part) + '</mark>' : esc(part))).join(''); };
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

const PSTATE = { proposed: 'Waiting for you', sending: 'Logging', logged: 'Logged', failed: 'Did not go through' };
function partnersCard() {
  const list = data.partners || [];
  const rows = list.map((p) => `<div class="pt-row"><div><b><a href="${esc(p.url)}">${esc(p.name || 'Partner ' + p.cid)}</a></b><span>${esc(PSTATE[p.state] || p.state)}${p.state === 'logged' ? (p.detail ? ', ' + esc(p.detail) : '') : p.detail ? ': ' + esc(p.detail) : ''}${p.confirmedBy && p.state === 'logged' ? ' by ' + esc(p.confirmedBy) : ''}</span></div>
    <div class="pt-acts">${p.state === 'logged' || p.state === 'sending' ? '' : `<button class="h-btn h-btn--primary h-btn--sm" data-pt="log" data-cid="${esc(p.cid)}" ${pt.busy ? 'disabled' : ''}>${pt.busy === p.cid ? 'Logging' : 'Log in Blackbaud'}</button><button class="h-btn h-btn--ghost h-btn--sm" data-pt="dismiss" data-cid="${esc(p.cid)}" ${pt.busy ? 'disabled' : ''}>Not a partner meeting</button>`}</div></div>`).join('');
  return `<section class="h-card mt-card" id="partners"><div class="h-label" style="margin-bottom:4px">Log on a partner record</div>
    <p class="mt-sub" style="margin:0 0 6px">${list.some((p) => p.state === 'proposed' || p.state === 'failed') ? 'A partner was on the invite. Logging adds one completed Meeting action to their record in Blackbaud, with the date, who was there, the summary, decisions and follow-ups.' : 'Add a partner this meeting should be logged on. Nothing goes to Blackbaud until you press Log in Blackbaud.'}</p>
    ${rows}${pt.err ? `<p class="mt-sub" style="color:#8a3f24;margin:6px 0 0">${esc(pt.err)}</p>` : ''}
    <div class="pt-find"><input id="ptq" placeholder="Find a partner by name, email or phone" value="${esc(pt.find)}" aria-label="Find a partner" /><button class="h-btn h-btn--ghost h-btn--sm" data-pt="find">Find</button></div>
    ${pt.hits.map((h) => `<div class="pt-row"><div><b>${esc(h.name)}</b><span>${esc(h.place)}</span></div><div class="pt-acts"><button class="h-btn h-btn--ghost h-btn--sm" data-pt="add" data-cid="${esc(h.id)}" data-name="${esc(h.name)}">Add</button></div></div>`).join('')}</section>`;
}
async function partnerClick(b) {
  const act = b.dataset.pt; const cid = b.dataset.cid;
  pt.err = '';
  try {
    if (act === 'find') {
      const q = ($('#ptq') || {}).value || ''; pt.find = q;
      pt.hits = q.trim().length < 2 ? [] : (await api('meetings/' + MID + '/partners?q=' + encodeURIComponent(q.trim()))).hits || [];
    } else if (act === 'add') {
      data.partners = (await api('meetings/' + MID + '/partners', { method: 'POST', body: { action: 'add', cid, name: b.dataset.name } })).partners; pt.hits = []; pt.find = '';
    } else if (act === 'dismiss') {
      data.partners = (await api('meetings/' + MID + '/partners', { method: 'POST', body: { action: 'dismiss', cid } })).partners;
    } else if (act === 'log') {
      const row = (data.partners || []).find((p) => p.cid === cid);
      if (!(await confirmCard({ title: 'Log this meeting in Blackbaud?', body: `One completed Meeting action goes on ${row ? row.name : 'the partner'}'s record, dated ${fmtDay(data.meeting.startedAt)}. Nobody is emailed.`, ok: 'Log in Blackbaud' }))) return;
      pt.busy = cid; draw();
      data.partners = (await api('meetings/' + MID + '/partners', { method: 'POST', body: { action: 'log', cid, confirm: true } })).partners;
      toast('Logged on the record');
    }
  } catch (e) { pt.err = e.message; try { data.partners = (await api('meetings/' + MID + '/notes')).partners; } catch { /* keep the list */ } }
  pt.busy = ''; draw();
}

function privacyCard() {
  const p = data.privacy; if (!p) return '';
  const files = data.files || [];
  const show = p.canEdit || (p.paused || []).length || (p.cuts || []).length;
  if (!show) return '';
  const hist = [
    ...(p.paused || []).map((r) => ({ t: r.from, text: `Recording paused ${span(r.from, r.to)}. Nothing was recorded.` })),
    ...(p.cuts || []).map((c) => ({ t: c.kind === 'cut' ? c.from : 1e9, text: c.kind === 'cut' ? `Removed ${span(c.from, c.to)} on ${fmtDay(c.at)}.` : `Recording deleted on ${fmtDay(c.at)}.` })),
  ].sort((a, b) => a.t - b.t);
  const sug = p.canEdit && p.suggestion && !pv.open ? `<div class="pv-sug"><div><b>${esc(p.suggestion.label)} start at ${stamp(p.suggestion.from)}.</b><span>Remove that part from the recording, transcript, notes and Doc?</span></div><button class="h-btn h-btn--ghost h-btn--sm" data-pv="sug">Remove ${esc(span(p.suggestion.from, p.suggestion.to))}</button></div>` : '';
  const trimming = p.trim && p.trim.running;
  const keep = pv.mode === 'keep';
  const rowHtml = (r, i) => `<div class="pv-row${pv.cur === i ? ' is-cur' : ''}" data-row="${i}"><label>${keep ? 'Keep from' : 'From'}<input class="pv-from" data-i="${i}" inputmode="numeric" placeholder="53:37" value="${esc(r.from)}" aria-label="${keep ? 'Keep from' : 'From'}, minutes and seconds" /></label><label>To<input class="pv-to" data-i="${i}" inputmode="numeric" placeholder="The end" value="${esc(r.to)}" aria-label="To, minutes and seconds, empty for the end" /></label>${!keep && pv.rows.length > 1 ? `<button class="icb" data-pv="droprow" data-i="${i}" aria-label="Take this part off the list">${ic('x')}</button>` : ''}</div>`;
  const form = pv.open ? `<div class="pv-form">
      <div class="pv-mode" role="radiogroup" aria-label="What to do"><label><input type="radio" name="pv-mode" value="remove" ${keep ? '' : 'checked'} /> Remove parts</label><label><input type="radio" name="pv-mode" value="keep" ${keep ? 'checked' : ''} /> Keep only one part</label></div>
      ${(keep ? pv.rows.slice(0, 1) : pv.rows).map(rowHtml).join('')}
      ${keep ? '' : `<button class="h-btn h-btn--ghost h-btn--sm" data-pv="addrow" ${pv.rows.length >= 10 ? 'disabled' : ''}>Add another part</button>`}
      <p class="mt-sub">${keep ? 'Everything before and after this part is removed.' : 'Tap a time in the transcript to fill these in. Leave To empty to remove everything to the end.'}</p>
      ${files.length ? `<div class="pv-mode" role="radiogroup" aria-label="The recording"><label><input type="radio" name="pv-rec" value="trim" ${pv.rec === 'trim' ? 'checked' : ''} /> Cut ${keep ? 'the rest' : 'these parts'} from the recording too</label><label><input type="radio" name="pv-rec" value="delete" ${pv.rec === 'delete' ? 'checked' : ''} /> Delete the whole recording</label></div>${pv.rec === 'trim' ? '<p class="mt-sub">The recording in Drive is made again without them and the old file goes to the Drive trash. A video cut ends on the next full picture, so up to two more seconds can go.</p>' : ''}` : ''}
      ${pv.err ? `<p class="mt-sub pv-warn">${esc(pv.err)}</p>` : ''}
      <div class="pv-acts"><button class="h-btn h-btn--ghost h-btn--sm" data-pv="cancel" ${pv.busy ? 'disabled' : ''}>Cancel</button><button class="h-btn h-btn--danger h-btn--sm" data-pv="cut" ${pv.busy || trimming ? 'disabled' : ''}>${pv.busy ? 'Removing' : keep ? 'Keep only this part' : pv.rows.length > 1 ? 'Remove these parts' : 'Remove this part'}</button></div></div>` : '';
  const status = trimming ? `<p class="mt-sub pv-status" role="status">Cutting the recording in Drive. It plays as it was until the new file is ready.</p>` : p.trim && p.trim.failed ? '<p class="mt-sub pv-warn">The recording could not be cut. The notes are cut. Remove the same part again to try the recording again, or delete the recording.</p>' : '';
  const acts = p.canEdit && !pv.open ? `<div class="pv-acts"><button class="h-btn h-btn--ghost h-btn--sm" data-pv="open" ${trimming ? 'disabled' : ''}>${ic('x')}Edit the recording and notes</button>${files.length ? `<button class="h-btn h-btn--ghost h-btn--sm" data-pv="delrec" ${pv.busy ? 'disabled' : ''}>Delete the recording</button>` : ''}</div>` : '';
  const trash = (p.toTrash || []).length ? `<div class="pv-trash"><b>Emptied in Drive, waiting for the trash</b><span>FavorOS cannot trash files in US Team Files. A content manager opens each one and moves it to the trash.</span>${p.toTrash.map((f) => `<a href="${esc(f.url)}" target="_blank" rel="noopener">${f.kind === 'notes' ? 'Old notes Doc' : 'Old recording'}</a>`).join('')}</div>` : '';
  return `<section class="h-card mt-card" id="privacy"><div class="h-label" style="margin-bottom:6px">Privacy</div>
    ${hist.length ? `<ul class="pv-hist">${hist.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul>` : p.canEdit ? '<p class="mt-sub" style="margin:0 0 8px">Remove a private part, such as prayer requests, or keep only the part you need. The recording, transcript, summary, action items, their tasks, the Chat post, the Google Doc and Favor Brain all follow.</p>' : ''}
    ${status}${sug}${form}${acts}${trash}</section>`;
}

async function privacyClick(b) {
  const act = b.dataset.pv;
  const p = data.privacy || {};
  pv.err = '';
  readRows();
  if (act === 'open') { Object.assign(pv, { open: true, mode: 'remove', rows: [{ from: '', to: '' }], cur: 0, rec: 'trim' }); draw(); const f = $('.pv-from'); if (f) f.focus(); return; }
  if (act === 'cancel') { pv.open = false; draw(); return; }
  if (act === 'sug') { Object.assign(pv, { open: true, mode: 'remove', rows: [{ from: stamp(p.suggestion.from), to: p.suggestion.to == null ? '' : stamp(p.suggestion.to) }], cur: 0, rec: 'trim' }); draw(); return; }
  if (act === 'addrow') { pv.rows.push({ from: '', to: '' }); pv.cur = pv.rows.length - 1; draw(); const f = document.querySelectorAll('.pv-from')[pv.cur]; if (f) f.focus(); return; }
  if (act === 'droprow') { pv.rows.splice(Number(b.dataset.i), 1); pv.cur = Math.min(pv.cur, pv.rows.length - 1); draw(); return; }
  if (act === 'delrec') {
    if (!(await confirmCard({ title: 'Delete the recording?', body: 'The recording leaves FavorOS and Google Drive. The transcript and notes stay. This cannot be undone.', ok: 'Delete the recording', danger: true }))) return;
    pv.busy = true; draw();
    try { await api('meetings/' + MID + '/privacy', { method: 'POST', body: { op: 'delete-recording' } }); players.clear(); data = await api('meetings/' + MID + '/notes'); toast('Recording deleted'); } catch (e) { toast(e.message); }
    pv.busy = false; draw(); return;
  }
  if (act === 'cut') {
    const keep = pv.mode === 'keep';
    const typed = (keep ? pv.rows.slice(0, 1) : pv.rows).map((r) => ({ from: secs(r.from), to: String(r.to).trim() ? secs(r.to) : null })).filter((r, i) => i === 0 || Number.isFinite(r.from));
    for (const r of typed) {
      if (!Number.isFinite(r.from)) { pv.err = 'Type the start as minutes and seconds, like 53:37.'; draw(); return; }
      if (r.to != null && (!Number.isFinite(r.to) || r.to <= r.from)) { pv.err = 'The end has to come after the start.'; draw(); return; }
    }
    // Keep only one part: what comes before it and after it are the parts removed.
    const ranges = keep ? [...(typed[0].from > 0 ? [{ from: 0, to: typed[0].from }] : []), ...(typed[0].to != null ? [{ from: typed[0].to, to: null }] : [])] : typed;
    if (!ranges.length) { pv.err = 'That keeps the whole meeting. Pick where the part starts or ends.'; draw(); return; }
    const rec = (data.files || []).length ? pv.rec : 'keep';
    const what = keep ? `Keep only ${span(typed[0].from, typed[0].to)}?` : ranges.length > 1 ? `Remove ${ranges.length} parts?` : `Remove ${span(ranges[0].from, ranges[0].to)}?`;
    const recText = rec === 'trim' ? ' The recording in Drive is made again without it, and the old file goes to the Drive trash.' : rec === 'delete' ? ' The recording is deleted.' : '';
    if (!(await confirmCard({ title: what, body: `What was said and typed ${keep ? 'outside that part' : 'in ' + (ranges.length > 1 ? 'those parts' : 'that part')} leaves the transcript, the action items from it and their tasks go, the summary and Chat post are written again, and the Google Doc is replaced.${recText} This cannot be undone.`, ok: keep ? 'Keep only this part' : 'Remove', danger: true }))) return;
    pv.busy = true; draw();
    try {
      const r = await api('meetings/' + MID + '/privacy', { method: 'POST', body: { op: 'cut', ranges, recording: rec } });
      if (rec === 'delete') players.clear();
      data = await api('meetings/' + MID + '/notes'); pv.open = false; pv.busy = false; draw();
      if (r.recording === 'trimming') {
        toast('Removed from the notes. Cutting the recording now.');
        await pump(MID, (st) => { const el = $('.pv-status'); if (el && st) el.textContent = st; });
        players.clear();
        data = await api('meetings/' + MID + '/notes'); draw();
        toast(data.privacy && data.privacy.trim && data.privacy.trim.failed ? 'The recording could not be cut' : 'The recording is cut');
      } else toast('Removed');
      return;
    } catch (e) { pv.err = e.message; }
    pv.busy = false; draw();
  }
}

/** The times typed in the form, kept across redraws. */
function readRows() {
  document.querySelectorAll('.pv-from').forEach((el) => { const r = pv.rows[Number(el.dataset.i)]; if (r) r.from = el.value; });
  document.querySelectorAll('.pv-to').forEach((el) => { const r = pv.rows[Number(el.dataset.i)]; if (r) r.to = el.value; });
}

// The names offered: everyone who was there, the names already in the transcript, and the action item owners.
function speakerNames() {
  const out = new Map();
  const add = (n) => { const v = String(n || '').trim(); if (v && !/ or /.test(v) && !out.has(v.toLowerCase())) out.set(v.toLowerCase(), v); };
  (data.people || []).forEach((p) => add(p.name)); (data.transcript || []).forEach((l) => add(l.who)); (data.actions || []).forEach((a) => add(a.owner_name));
  return [...out.values()].sort((a, b) => a.localeCompare(b));
}
function speakerBar() {
  const tr = data.transcript || [];
  const has = sp.a >= 0;
  const i0 = Math.min(sp.a, sp.b), i1 = Math.max(sp.a, sp.b);
  const what = !has ? 'Tap the line that has the wrong name. Tap a second line to take every line between them.' : i0 === i1 ? `One line at ${stamp(tr[i0].t)}${tr[i0].who ? ', now ' + esc(tr[i0].who) : ''}.` : `${i1 - i0 + 1} lines, ${stamp(tr[i0].t)} to ${stamp(tr[i1].t)}.`;
  return `<div class="sp-bar" id="sp-bar"><p>${what}</p>
    ${has ? `<label class="sp-who"><span>Who was speaking</span><input id="sp-who" list="sp-names" autocomplete="off" maxlength="80" placeholder="Type or pick a name" value="${esc(sp.who)}" /></label><datalist id="sp-names">${speakerNames().map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>` : ''}
    ${sp.err ? `<p class="mt-sub pv-warn">${esc(sp.err)}</p>` : ''}
    <div class="pv-acts"><button class="h-btn h-btn--ghost h-btn--sm" data-sp="cancel" ${sp.busy ? 'disabled' : ''}>Cancel</button>${has ? `<button class="h-btn h-btn--primary h-btn--sm" data-sp="save" ${sp.busy ? 'disabled' : ''}>${sp.busy ? 'Writing the notes again' : 'Change the speaker'}</button>` : ''}</div>
    ${has ? '<p class="mt-sub" style="margin:0">The summary, action items and their tasks are written again with the right names.</p>' : ''}</div>`;
}
async function speakerClick(act) {
  if (act === 'open') { Object.assign(sp, { open: true, a: -1, b: -1, who: '', err: '' }); draw(); const b = $('#sp-bar'); if (b) b.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
  if (act === 'cancel') { sp.open = false; draw(); return; }
  if (act !== 'save' || sp.busy) return;
  sp.who = (($('#sp-who') || {}).value || sp.who).trim();
  if (!sp.who) { sp.err = 'Type or pick who was speaking.'; draw(); return; }
  const tr = data.transcript || [];
  const i0 = Math.min(sp.a, sp.b), i1 = Math.max(sp.a, sp.b);
  sp.busy = true; sp.err = ''; draw();
  try {
    const r = await api('meetings/' + MID + '/privacy', { method: 'POST', body: { op: 'speaker', i0, i1, t0: tr[i0].t, t1: tr[i1].t, who: sp.who } });
    data = await api('meetings/' + MID + '/notes');
    sp.open = false;
    toast(r.rewritten ? 'Speaker changed. The notes were written again.' : 'Speaker changed. The notes could not be written again yet.');
  } catch (e) { sp.err = e.message; }
  sp.busy = false; draw();
}

// The notes as an item for the email composer (public/js/compose/compose.js): summary, decisions and action items, and the
// meeting's people on the To line when it starts a new email.
function emailItem() {
  const m = data.meeting; const n = data.notes || {};
  const li = (t) => `<li>${esc(t)}</li>`;
  const html = (m.summary ? `<p>${esc(m.summary)}</p>` : '') +
    ((n.decisions || []).length ? `<p><b>Decisions</b></p><ul>${n.decisions.map((d) => li(d.text)).join('')}</ul>` : '') +
    ((data.actions || []).length ? `<p><b>Action items</b></p><ul>${data.actions.map((a) => li(a.text + (String(a.owner_name || '').trim() ? ' (' + String(a.owner_name).trim() + (a.due ? ', due ' + a.due : '') + ')' : a.due ? ' (due ' + a.due + ')' : ''))).join('')}</ul>` : '');
  const to = (data.people || []).filter((p) => p.email && !p.me).map((p) => ({ email: p.email, name: p.name || '' }));
  return { kind: 'meeting', title: (String(m.title || '').trim() || 'Meeting') + (m.startedAt ? ', ' + fmtDay(m.startedAt) : ''), html, url: location.origin + '/meet/notes/?m=' + encodeURIComponent(MID), to, subject: 'Notes: ' + (String(m.title || '').trim() || 'Meeting') };
}

function draw() {
  const m = data.meeting; const n = data.notes || {};
  document.title = m.title + ' - FavorOS';
  const crumb = document.querySelector('.h-top__crumb'); if (crumb) crumb.textContent = m.title;
  const keepFocus = document.activeElement && document.activeElement.id;
  const marks = q ? [] : [...((data.privacy || {}).paused || []).map((r) => ({ t: r.from, mark: `Recording paused, nothing recorded (${span(r.from, r.to)})` })), ...((data.privacy || {}).cuts || []).filter((c) => c.kind === 'cut').map((c) => ({ t: c.from, mark: `Part removed (${span(c.from, c.to)})` }))];
  const qq = sp.open ? '' : q;
  const lines = [...(data.transcript || []).map((l, i) => ({ ...l, i })).filter((l) => !qq || ((l.who || '') + ' ' + l.text).toLowerCase().includes(qq.toLowerCase())), ...(sp.open ? [] : marks)].sort((a, b) => a.t - b.t || (a.mark ? -1 : 1) || (a.i || 0) - (b.i || 0));
  const canFix = !!(data.privacy && data.privacy.canEdit) && (data.transcript || []).length > 0;
  const sel = (i) => sp.open && sp.a >= 0 && i >= Math.min(sp.a, sp.b) && i <= Math.max(sp.a, sp.b);
  const pending = m.notesStatus === 'pending' || m.recState === 'uploading' || m.status === 'live';
  const failed = m.notesStatus === 'failed';
  const ppl = data.people || [];
  const files = data.files || [];
  const mins = m.startedAt && m.endedAt ? Math.max(1, Math.round((Date.parse(m.endedAt) - Date.parse(m.startedAt)) / 60000)) : 0;
  const hasTr = (data.transcript || []).length > 0;
  root.innerHTML = `<div class="nt-head"><div><div class="h-label" style="margin-bottom:6px">Meeting notes</div><h2>${esc(String(m.title || '').trim() || 'Meeting')}</h2>
    <div class="nt-meta"><span>${ic('cal')}${m.startedAt ? fmtDay(m.startedAt) : ''}</span>${m.startedAt && m.endedAt ? `<span>${ic('clock')}${fmtTime(m.startedAt)} to ${fmtTime(m.endedAt)}${mins ? ' (' + mins + ' min)' : ''}</span>` : ''}<span>${ic('users')}${ppl.length} ${ppl.length === 1 ? 'person' : 'people'}</span><span class="mt-avs">${ppl.slice(0, 6).map((p) => av(p.name)).join('')}${ppl.length > 6 ? `<span class="mt-av mt-av--more" title="${esc(ppl.slice(6).map((p) => p.name || p.email).join(', '))}">+${(ppl.length - 6).toLocaleString('en-US')}</span>` : ''}</span></div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="h-btn h-btn--ghost h-btn--sm" id="nt-dl">${ic('download')}Transcript</button><button class="h-btn h-btn--ghost h-btn--sm" id="nt-copy">${ic('share')}Share</button>${window.FavorCompose && document.documentElement.classList.contains('has-mail') && !pending ? `<button class="h-btn h-btn--ghost h-btn--sm" id="nt-email" draggable="true" title="Email the summary, decisions and action items (or drag this into an email)">${ic('send')}Send to email</button>` : ''}<a class="h-btn h-btn--primary h-btn--sm" href="/meet/book/?follow=${encodeURIComponent(MID)}">${ic('plus')}Book the follow-up</a></div></div>
    ${pending ? `<div class="mt-note mt-note--gold" style="margin-bottom:14px"><b>${m.status === 'live' ? 'The meeting is still going.' : 'The notes are being made.'}</b> <span id="nt-prog">${m.recState === 'uploading' ? 'Saving the recording to Google Drive.' : 'Reading the recording.'}</span></div>` : ''}
    ${failed ? `<div class="mt-note mt-note--gold" style="margin-bottom:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span><b>The notes failed.</b> The recording is safe in Google Drive.</span><button class="h-btn h-btn--primary h-btn--sm" id="nt-retry">Try again</button></div>` : ''}
    <div class="mt-grid"><div class="mt-stack">
      <section class="h-card mt-card"><div class="h-label" style="margin-bottom:8px">Summary</div>${!m.summary && pending && m.status !== 'live' ? `<p class="nt-sum nt-wait" role="status"><span class="nt-spin" aria-hidden="true"></span>Writing the summary</p>` : `<p class="nt-sum">${esc(m.summary || (pending ? 'The meeting is still going.' : failed ? 'No summary yet.' : 'No summary.'))}</p>`}</section>
      ${(n.decisions || []).length ? `<section class="h-card mt-card"><div class="h-label" style="margin-bottom:10px">Decisions</div><ul class="nt-list">${n.decisions.map((d) => `<li><span class="b">${ic('check')}</span><span>${esc(d.text)} ${ts(d.t)}</span></li>`).join('')}</ul></section>` : ''}
      ${(data.actions || []).length ? `<section class="h-card mt-card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:4px"><div class="h-label">Action items</div><span class="mt-sub">${data.actions.filter((a) => a.done).length} of ${data.actions.length} done</span></div>${data.actions.map((a) => `<label class="act${a.done ? ' is-done' : ''}"><input type="checkbox" data-idx="${a.idx}" ${a.done ? 'checked' : ''} /><div><b>${esc(a.text)}</b><span>${String(a.owner_name || '').trim() ? `<span data-entity="person:${esc(String(a.owner_name).trim())}" data-label="${esc(String(a.owner_name).trim())}">${esc(String(a.owner_name).trim())}</span>` : 'No owner named'}${a.due ? ' · due ' + esc(a.due) : ''}${a.t ? ' · ' + ts(a.t) : ''}</span></div><span class="mt-pill ${a.done ? 'mt-pill--ok' : ''}">${a.done ? 'Done' : 'Open'}</span></label>`).join('')}<p class="mt-sub" style="margin:8px 0 0">Each person sees their items on Today in FavorOS.</p></section>` : ''}
      <section class="h-card mt-card"><div class="nt-trh"><div class="h-label">Transcript</div>${canFix && !sp.open ? `<button class="h-btn h-btn--ghost h-btn--sm" data-sp="open">${ic('users')}Fix who spoke</button>` : ''}</div>${sp.open ? speakerBar() : `<div class="nt-search">${ic('search')}<input id="trq" aria-label="Search the transcript" placeholder="Search what was said" value="${esc(q)}" /></div>`}
        <div class="nt-tr">${lines.length ? lines.map((l) => l.mark ? `<div class="nt-l nt-mark"><time>${stamp(l.t)}</time><div>${esc(l.mark)}</div></div>` : `<div class="nt-l${sp.open ? ' sp-on' : ''}${sel(l.i) ? ' is-sel' : ''}" id="t${l.t}"${sp.open ? ` data-li="${l.i}" role="button" tabindex="0" aria-pressed="${sel(l.i)}"` : ''}><time${pv.open ? ` class="pv-pick" data-pick="${l.t}" role="button" tabindex="0" title="Use this time"` : ''}>${stamp(l.t)}</time><div>${l.who ? `<b>${hi(l.who)}</b> ` : ''}${hi(l.text)}</div></div>`).join('') : `<p class="mt-sub">${hasTr ? 'Nothing matches.' : pending ? 'The transcript is on its way.' : 'No transcript. Nobody spoke, or this meeting was not recorded.'}</p>`}</div></section>
    </div><div class="mt-stack">
      ${files.length || data.doc ? `<section class="h-card mt-card" style="display:grid;gap:12px">${files.map((f, i) => `<div class="nt-slot" data-slot="${i}"></div>`).join('')}
        ${files.map((f) => `<div class="drive">${ic('drive')}<div><b>${files.length > 1 ? esc(f.name) : 'Saved in Google Drive'}</b><span>${esc(files.length > 1 ? 'Google Drive' : f.name)}</span></div><a class="h-btn h-btn--ghost h-btn--sm" href="${esc(f.url)}" target="_blank" rel="noopener">Open</a></div>`).join('')}
        ${data.doc ? `<div class="drive">${ic('doc')}<div><b>Notes in Google Docs</b><span>Google Docs</span></div><a class="h-btn h-btn--ghost h-btn--sm" href="${esc(data.doc.url)}" target="_blank" rel="noopener">Open</a></div>` : ''}
        ${files.length ? `<p class="mt-sub" style="margin:0">Meetings in US Team Files${files.length > 1 ? ', ' + files.length + ' parts' : ''}</p>` : ''}</section>` : ''}
      ${privacyCard()}
      ${(data.partners || []).length || (data.meeting.mine && data.meeting.status === 'ended') ? partnersCard() : ''}
      ${(n.chapters || []).length ? `<section class="h-card mt-card"><div class="h-label" style="margin-bottom:6px">Chapters</div>${n.chapters.map((c) => `<a class="chap" href="#t=${c.t}" data-t="${c.t}" style="text-decoration:none;color:inherit"><em>${stamp(c.t)}</em><span>${esc(c.title)}</span></a>`).join('')}</section>` : ''}
      ${(data.asked || []).length ? `<section class="h-card mt-card"><div class="h-label" style="margin-bottom:8px">Asked during the meeting</div><div class="ans"><ul>${data.asked.map((a) => `<li>${ts(a.t)}<span>${a.by ? esc(a.by) + ' asked ' : ''}"${esc(a.q)}"</span></li>`).join('')}</ul></div></section>` : ''}
      ${hasTr ? `<section class="h-card mt-card"><div class="h-label" style="margin-bottom:8px">Ask about this meeting</div><div class="rm-input" style="border:0;padding:0"><input id="nt-ask" aria-label="Ask about this meeting" placeholder="Who owns the print file?" maxlength="300" value="${esc(ask.q)}" ${ask.busy ? 'disabled' : ''} /><button class="icb send" id="nt-ask-go" aria-label="Ask" ${ask.busy ? 'disabled' : ''}>${ic('send')}</button></div>
        ${ask.busy ? '<p class="mt-sub" style="margin:8px 0 0">Reading the transcript.</p>' : ask.answer ? `<div class="ans" style="margin-top:8px"><p style="margin:0 0 6px;font-size:14px">${esc(ask.answer.answer)}</p>${ask.answer.points.length ? `<ul>${ask.answer.points.map((p) => `<li>${ts(p.t)}<span>${esc(p.text)}</span></li>`).join('')}</ul>` : ''}</div>` : ''}</section>` : ''}
    </div></div>`;
  $('#nt-copy').addEventListener('click', () => copy(location.href));
  const em = $('#nt-email');
  if (em) {
    em.addEventListener('click', () => window.FavorCompose.add(emailItem(), { anchor: em, from: em }));
    em.addEventListener('dragstart', (e) => {
      const it = emailItem();
      if (window.FavorCompose && window.FavorCompose.dragStart) window.FavorCompose.dragStart(e, it);
      else e.dataTransfer.setData('application/x-favoros-item', JSON.stringify(it));
      e.dataTransfer.setData('text/uri-list', it.url);
      e.dataTransfer.setData('text/plain', it.url);
      e.dataTransfer.effectAllowed = 'copy';
    });
  }
  root.querySelectorAll('[data-pt]').forEach((b) => b.addEventListener('click', () => partnerClick(b)));
  root.querySelectorAll('[data-pv]').forEach((b) => b.addEventListener('click', () => privacyClick(b)));
  root.querySelectorAll('[data-sp]').forEach((b) => b.addEventListener('click', () => speakerClick(b.dataset.sp)));
  root.querySelectorAll('[data-li]').forEach((el) => { const pick = () => { const i = Number(el.dataset.li); if (sp.a < 0 || sp.a !== sp.b) { sp.a = i; sp.b = i; } else sp.b = i; sp.err = ''; draw(); }; el.addEventListener('click', pick); el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }); });
  const sw = $('#sp-who'); if (sw) { sw.addEventListener('input', () => { sp.who = sw.value; }); sw.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); speakerClick('save'); } }); if (keepFocus === 'sp-who') { sw.focus(); sw.setSelectionRange(sw.value.length, sw.value.length); } }
  root.querySelectorAll('input[name="pv-mode"], input[name="pv-rec"]').forEach((el) => el.addEventListener('change', () => { readRows(); if (el.name === 'pv-mode') { pv.mode = el.value; pv.cur = 0; } else pv.rec = el.value; draw(); }));
  root.querySelectorAll('.pv-from, .pv-to').forEach((el) => { el.addEventListener('input', readRows); el.addEventListener('focus', () => { pv.cur = Number(el.dataset.i); }); });
  root.querySelectorAll('[data-pick]').forEach((el) => { const pick = () => { if (!pv.open) return; readRows(); const r = pv.rows[pv.cur] || pv.rows[0]; const v = stamp(Number(el.dataset.pick)); if (!r.from || r.to) { r.from = v; r.to = ''; } else r.to = v; draw(); const pf = $('#privacy'); if (pf) pf.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }; el.addEventListener('click', pick); el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }); });
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
  root.querySelectorAll('.nt-slot').forEach((slot) => { const f = files[Number(slot.dataset.slot)]; if (f) slot.replaceWith(playerNode(f, files.length > 1 ? 'part ' + (Number(slot.dataset.slot) + 1) : '', mins)); });
  root.querySelectorAll('input[data-idx]').forEach((c) => c.addEventListener('change', async () => {
    try {
      await api('meetings/' + MID + '/action', { method: 'POST', body: { idx: Number(c.dataset.idx), done: c.checked } });
      data.actions.find((a) => a.idx === Number(c.dataset.idx)).done = c.checked ? 1 : 0; draw();
    } catch (e) { c.checked = !c.checked; toast(e.message); }
  }));
  const inp = $('#trq');
  if (inp) inp.addEventListener('input', () => { q = inp.value.trim(); draw(); const i2 = $('#trq'); i2.focus(); i2.setSelectionRange(q.length, q.length); });
  if (inp && keepFocus === 'trq') { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
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
