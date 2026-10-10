// Clips: the editor (/clips/edit/?id=). Everything here changes the edit list only: the recording is never rewritten.
// The video plays top left, the transcript sits at the right (select words, press Delete), and a waveform timeline of the
// kept stretches runs underneath (drag the handles to trim, press S to split, click a stretch and delete it).
// Ported from ServiceLine Flow's VideoEditor and edit math.
import {
  api, esc, fmtPrecise, fmtTime, hasEdits, keepRanges, longTime, loadPeaks, MIN_SEGMENT, normEdits, peakBetween, rangesLength, SILENCE_DEFAULT, SILENCE_LEVELS,
  subtractRange, toEdited, toast, trimEdge, wordKept, wordsOf, fillerIndexes, skipFrom, withAuto, r2,
} from './core.js';

const root = document.getElementById('ce');
const ID = new URLSearchParams(location.search).get('id') || '';
const $ = (sel, el = document) => el.querySelector(sel);
const GAP = 6;
const HEIGHT = 76;

const IC = {
  back: '<path d="M15 5 8 12l7 7"/>', undo: '<path d="M9 7 4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 12h-3" transform="translate(0 -4)"/>',
  redo: '<path d="m15 7 5 5-5 5"/><path d="M20 12H10a6 6 0 0 0 0 12h3" transform="translate(0 -4)"/>',
  hist: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v5l3 2"/>', scissors: '<circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M8 8.5 20 18M8 15.5 20 6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', wand: '<path d="M5 19 19 5"/><path d="M15 4v3M17.5 5.5h3M19 11v3M8 4v2M7 5h2"/>',
  spark: '<path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>', minus: '<path d="M5 12h14"/>', plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="m5 12 5 5 9-10"/>',
};
const icon = (n) => `<svg class="ce-i" viewBox="0 0 24 24" aria-hidden="true">${IC[n] || ''}</svg>`;

const S = {
  clip: null, lines: [], wordsRaw: [], words: [], committed: normEdits({}), draft: null, past: [], future: [], saving: 'saved',
  sel: null, zoom: 1, peaks: null, peaksDone: false, showWave: true, hideText: false, searching: false, q: '', now: 0, playing: false, menu: false, level: SILENCE_DEFAULT,
  drag: null,
};
let video = null;
let raf = 0;
let saveTimer = 0;
let savedJson = '';

const edits = () => S.draft || S.committed;
// The clip's own length is the one every edit is measured against (the file may run a fraction longer).
const duration = () => (S.clip && S.clip.duration > 0 ? S.clip.duration : video && Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0);
const ranges = () => keepRanges(edits(), duration());
const total = () => {
  const r = ranges();
  return r.length ? rangesLength(r) : duration();
};

/* ------------------------------------------------------------------ history and autosave */

function commit(label, next) {
  S.past.push({ label, edits: S.committed });
  S.committed = next;
  S.future = [];
  S.draft = null;
  scheduleSave();
  repaintAll();
}
function undo() {
  const p = S.past.pop();
  if (!p) return;
  S.future.push({ label: p.label, edits: S.committed });
  S.committed = p.edits;
  S.sel = null;
  scheduleSave();
  repaintAll();
}
function redo() {
  const f = S.future.pop();
  if (!f) return;
  S.past.push({ label: f.label, edits: S.committed });
  S.committed = f.edits;
  S.sel = null;
  scheduleSave();
  repaintAll();
}
function jumpTo(i) {
  // go back to just before step i
  while (S.past.length > i) {
    const p = S.past.pop();
    S.future.push({ label: p.label, edits: S.committed });
    S.committed = p.edits;
  }
  S.sel = null;
  scheduleSave();
  repaintAll();
}
function scheduleSave() {
  setSave('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 700);
}
async function flush() {
  clearTimeout(saveTimer);
  const body = S.committed;
  if (JSON.stringify(body) === savedJson) return setSave('saved'), true;
  setSave('saving');
  try {
    const r = await api(`/api/clips/${ID}`, { method: 'PATCH', json: { edits: body } });
    savedJson = JSON.stringify(body);
    // The server cleans the list (rounding, order); keep what it kept when it is the same edit.
    void r;
    setSave('saved');
    return true;
  } catch (e) {
    setSave('error');
    return false;
  }
}
function setSave(state) {
  S.saving = state;
  const el = $('#ce-save');
  if (!el) return;
  el.dataset.state = state;
  el.innerHTML = `${state === 'saving' ? '<i class="ce-spin"></i>' : icon('check')}${state === 'error' ? 'Could not save. Retrying on the next change.' : state === 'saving' ? 'Saving' : 'Edits are saved automatically'}`;
}

/* ------------------------------------------------------------------ load and build */

async function start() {
  if (!/^[0-9a-f]{32}$/.test(ID)) return fail('That clip does not exist.');
  try {
    const d = await api(`/api/clips/${ID}/info`);
    if (!d.can || !d.can.edit) return fail('Editing is for hub admins.');
    S.clip = d.clip;
    S.lines = d.clip.transcript || [];
    S.wordsRaw = d.clip.words || [];
    S.words = wordsOf(S.lines, S.wordsRaw);
    S.committed = normEdits(d.clip.edits);
    savedJson = JSON.stringify(S.committed);
    S.level = S.committed.silenceMin || SILENCE_DEFAULT;
    build();
    loadPeaks(ID, d.clip.duration).then((p) => {
      S.peaks = p;
      S.peaksDone = true;
      renderTimeline();
    });
  } catch (e) {
    fail(e.status === 404 ? 'That clip does not exist.' : e.status === 403 ? 'Editing is for hub admins.' : e.message);
  }
}

function fail(msg) {
  root.removeAttribute('aria-busy');
  root.innerHTML = `<div class="h-card ce-msg"><h2>Could not open the editor</h2><p>${esc(msg)}</p><a class="h-btn h-btn--primary" href="/clips/">Back to clips</a></div>`;
}

function build() {
  const c = S.clip;
  root.removeAttribute('aria-busy');
  document.title = `Edit ${c.title || 'clip'} - Favor Hub`;
  root.innerHTML = `
  <header class="ce-top">
    <a class="ce-icon" href="/c/${ID}" aria-label="Back to the clip" title="Back to the clip">${icon('back')}</a>
    <h1 class="ce-title" title="${esc(c.title)}">${esc(c.title || 'Untitled clip')}</h1>
    <span class="ce-save" id="ce-save" role="status"></span>
    <span class="ce-menuwrap"><button type="button" class="ce-icon" id="ce-hist" aria-label="Edit history" aria-expanded="false">${icon('hist')}</button><div class="ce-menu" id="ce-histm" hidden></div></span>
    <button type="button" class="ce-icon" id="ce-undo" aria-label="Undo" title="Undo (Ctrl Z)">${icon('undo')}</button>
    <button type="button" class="ce-icon" id="ce-redo" aria-label="Redo" title="Redo (Ctrl Shift Z)">${icon('redo')}</button>
    <button type="button" class="h-btn h-btn--primary" id="ce-finish">Finish</button>
  </header>
  <div class="ce-work">
    <div class="ce-stage"><video id="ce-video" controls playsinline preload="metadata" src="/api/clips/${ID}/media" ${c.hasPoster ? `poster="/api/clips/${ID}/media?poster=1"` : ''}></video><p class="ce-len" id="ce-len"></p></div>
    <div class="ce-tr" id="ce-trwrap">
      <div class="ce-trsearch" id="ce-trs" hidden><label><span class="ce-sr">Search the transcript</span><input id="ce-q" type="search" placeholder="Search the transcript" /></label></div>
      <div class="ce-trbody" id="ce-tr"></div>
      <div class="ce-wordact" id="ce-wordact" hidden></div>
    </div>
    <nav class="ce-rail" aria-label="Quick edits">
      <button type="button" class="ce-rb" id="ce-fillers" aria-pressed="false"><span class="ce-rbi">${icon('spark')}<em id="ce-fcount">0</em></span><span>Remove filler words</span></button>
      <button type="button" class="ce-rb" id="ce-silences" aria-pressed="false"><span class="ce-rbi">${icon('wand')}</span><span>Remove silences</span></button>
      <div class="ce-levels" id="ce-levels" role="group" aria-label="Pause length" hidden>${SILENCE_LEVELS.map((l) => `<button type="button" data-lv="${l.min}">${l.label}<small>${l.min.toFixed(1)}s</small></button>`).join('')}</div>
      <button type="button" class="ce-rb" id="ce-search" aria-pressed="false"><span class="ce-rbi">${icon('search')}</span><span>Search</span></button>
      <button type="button" class="ce-rb" id="ce-hide" aria-pressed="false"><span class="ce-rbi">${icon('panel')}</span><span>Hide transcript</span></button>
    </nav>
  </div>
  <section class="ce-tl" aria-label="Timeline" id="ce-tl">
    <div class="ce-tlbar">
      <button type="button" class="ce-tb" id="ce-wave" aria-pressed="true">Waveform</button>
      <button type="button" class="ce-tb" id="ce-del" disabled>${icon('trash')}Delete selection</button>
      <button type="button" class="ce-tb" id="ce-split" disabled>${icon('scissors')}<span id="ce-splitl">Split at the playhead</span></button>
      <span class="ce-total" id="ce-total" title="Length after edits">0:00.00</span>
      <span class="ce-flex"></span>
      <button type="button" class="ce-tb ce-tb--q" id="ce-fit">Fit</button>
      <button type="button" class="ce-icon ce-icon--s" id="ce-zout" aria-label="Zoom out">${icon('minus')}</button>
      <input type="range" id="ce-zoom" min="1" max="16" step="0.1" value="1" aria-label="Zoom" />
      <button type="button" class="ce-icon ce-icon--s" id="ce-zin" aria-label="Zoom in">${icon('plus')}</button>
    </div>
    <div class="ce-tlbox" id="ce-tlbox"><div class="ce-tlin" id="ce-tlin"></div></div>
    <p class="ce-tip">Drag a handle to trim. Click a part, then Delete selection. Press S to split at the playhead.</p>
  </section>`;
  video = $('#ce-video');
  wire();
  setSave('saved');
  repaintAll();
}

/* ------------------------------------------------------------------ player */

function enforce() {
  const v = video;
  const r = keepRanges(S.committed, duration());
  const t = v.currentTime;
  const skip = r.length ? skipFrom(t, r) : undefined;
  if (skip === null) {
    v.pause();
    v.currentTime = r[r.length - 1][1];
  } else if (skip !== undefined) v.currentTime = skip;
  S.now = v.currentTime;
  paintPlayhead();
}

function seekSource(t) {
  video.currentTime = Math.max(0, t);
  S.now = video.currentTime;
  paintPlayhead();
  paintTranscriptActive();
}

/* ------------------------------------------------------------------ segments */

function segments(ed) {
  const r = keepRanges(ed, duration());
  const out = [];
  const cuts = (ed.splits || []).slice().sort((x, y) => x - y);
  let at = 0;
  for (const [a, b] of r) {
    let from = a;
    for (const s of cuts) {
      if (s > from + 0.2 && s < b - 0.2) {
        out.push({ a: from, b: s, at });
        at += s - from;
        from = s;
      }
    }
    out.push({ a: from, b, at });
    at += b - from;
  }
  return out;
}

function trimBounds(segs, i, side) {
  const s = segs[i];
  if (side === 'start') return { lo: i > 0 ? segs[i - 1].b : 0, hi: s.b - MIN_SEGMENT };
  return { lo: s.a + MIN_SEGMENT, hi: i < segs.length - 1 ? segs[i + 1].a : duration() };
}

/* ------------------------------------------------------------------ painting */

function repaintAll() {
  S.draft = null;
  $('#ce-undo').disabled = !S.past.length;
  $('#ce-redo').disabled = !S.future.length;
  paintLength();
  paintRail();
  paintTranscript();
  renderTimeline();
  paintHistory();
}

function paintLength() {
  const el = $('#ce-len');
  const r = keepRanges(edits(), duration());
  const len = r.length ? rangesLength(r) : duration();
  el.innerHTML = hasEdits(edits()) ? `<s>${longTime(duration())}</s> → <b>${longTime(len)}</b>` : 'Edits never change the original. Switch them off any time.';
  $('#ce-total').textContent = fmtPrecise(len);
}

function paintRail() {
  const e = S.committed;
  const fc = fillerIndexes(S.words).length;
  $('#ce-fcount').textContent = String(fc);
  const f = $('#ce-fillers');
  f.setAttribute('aria-pressed', String(!!(e.fillers && e.fillers.length)));
  f.disabled = !S.words.length;
  const s = $('#ce-silences');
  s.setAttribute('aria-pressed', String(!!(e.silences && e.silences.length)));
  s.disabled = !S.words.length && !S.peaks;
  const lv = $('#ce-levels');
  lv.hidden = !(e.silences && e.silences.length);
  lv.querySelectorAll('[data-lv]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.lv) === (e.silenceMin || S.level))));
  $('#ce-search').setAttribute('aria-pressed', String(S.searching));
  $('#ce-hide').setAttribute('aria-pressed', String(S.hideText));
  $('#ce-hide span:last-child').textContent = S.hideText ? 'Show transcript' : 'Hide transcript';
  $('#ce-trwrap').hidden = S.hideText;
  $('#ce-trs').hidden = !S.searching;
}

function paintHistory() {
  const m = $('#ce-histm');
  m.innerHTML = S.past.length
    ? `<ul>${S.past.map((p, i) => ({ p, i })).reverse().map(({ p, i }) => `<li><button type="button" data-jump="${i}"><span>${esc(p.label)}</span><em>undo</em></button></li>`).join('')}</ul><p>Pick a step to go back to just before it.</p>`
    : '<p>Nothing changed in this visit yet.</p>';
}

function paintTranscript() {
  const box = $('#ce-tr');
  if (!S.lines.length) {
    box.innerHTML = `<p class="ce-empty">${S.clip.status === 'processing' ? 'Writing the transcript.' : 'There is no transcript, so cut on the timeline below.'}</p>`;
    return;
  }
  const r = keepRanges(S.committed, duration());
  const kept = new Set(S.words.filter((w) => !r.length || wordKept(w, r)).map((w) => w.i));
  const fillers = new Set(fillerIndexes(S.words));
  const needle = S.q.trim().toLowerCase();
  const byLine = new Map();
  for (const w of S.words) byLine.set(w.line, [...(byLine.get(w.line) || []), w]);
  const toEd = (t) => (r.length ? toEdited(t, r) : t);
  const rows = [];
  S.lines.forEach((l, i) => {
    const ws = byLine.get(i) || [];
    const text = ws.length ? ws.map((w) => w.t).join(' ') : l.t;
    if (needle && !text.toLowerCase().includes(needle)) return;
    const first = ws.length ? ws[0].s : l.s;
    const body = ws.length
      ? ws.map((w) => `<span data-w="${w.i}"${kept.has(w.i) ? '' : ' data-gone'}${fillers.has(w.i) ? ' data-filler' : ''}${needle && w.t.toLowerCase().includes(needle) ? ' data-hit' : ''}>${esc(w.t)}</span>`).join(' ')
      : esc(l.t);
    rows.push(`<li data-line="${i}" data-s="${first}"><button type="button" class="ce-t" data-seek="${first}" aria-label="Jump to ${fmtTime(toEd(first))}">${fmtTime(toEd(first))}</button><p>${body}</p></li>`);
  });
  box.innerHTML = rows.length ? `<ul>${rows.join('')}</ul>` : `<p class="ce-empty">Nothing matches.</p>`;
  paintWordAct();
}

function paintTranscriptActive() {
  const box = $('#ce-tr');
  if (!box) return;
  let a = -1;
  S.lines.forEach((l, i) => {
    if (l.s <= S.now + 0.05) a = i;
  });
  const prev = box.querySelector('li.is-on');
  const el = box.querySelector(`li[data-line="${a}"]`);
  if (prev && prev !== el) prev.classList.remove('is-on');
  if (el && !el.classList.contains('is-on')) {
    el.classList.add('is-on');
    if (!box.matches(':hover') && !S.q) box.scrollTo({ top: Math.max(0, el.offsetTop - box.offsetTop - box.clientHeight / 3), behavior: 'smooth' });
  }
}

function paintWordAct() {
  const el = $('#ce-wordact');
  const s = S.sel;
  if (!s || s.kind !== 'words') {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.innerHTML = `<button type="button" class="ce-wbtn" data-wordact onmousedown="event.preventDefault()">${icon('trash')}${s.removed ? 'Bring back' : 'Delete'} ${s.count} word${s.count === 1 ? '' : 's'}</button>`;
}

/* ------------------------------------------------------------------ timeline */

function renderTimeline() {
  const inner = $('#ce-tlin');
  if (!inner) return;
  const box = $('#ce-tlbox');
  const width = box.clientWidth || 800;
  const ed = edits();
  const segs = segments(ed);
  const D = S.drag;
  const L = D ? D.frozen : segs;
  const n = L.length;
  const tot = total();
  const fit = Math.max(0.5, (width - 24 - Math.max(0, segs.length - 1) * GAP) / Math.max(tot, 1));
  const pps = D ? D.pps : Math.min(fit * S.zoom, 600);
  const xOf = (i, t) => 12 + i * GAP + t * pps;
  const frozenTotal = L.reduce((x, sg) => x + (sg.b - sg.a), 0);
  const full = 24 + Math.max(0, n - 1) * GAP + frozenTotal * pps;
  const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => s * pps >= 76) || 600;
  const segIndexAt = (e) => {
    const i = L.findIndex((s) => e < s.at + (s.b - s.a) - 0.0001);
    return i < 0 ? Math.max(0, n - 1) : i;
  };
  let html = `<div class="ce-ruler" aria-hidden="true">`;
  for (let t = 0; t <= frozenTotal + 0.01; t += step) {
    const i = segIndexAt(Math.min(t, frozenTotal - 0.001));
    html += `<span class="ce-tick" style="left:${xOf(i, t)}px">${fmtTime(t)}</span>`;
  }
  html += '</div>';
  L.forEach((s, i) => {
    const mine = D && D.i === i;
    const a = mine && D.side === 'start' ? D.to : s.a;
    const b = mine && D.side === 'end' ? D.to : s.b;
    const left = xOf(i, s.at) + (a - s.a) * pps;
    const w = Math.max(6, (b - a) * pps);
    const on = mine || (S.sel && Math.abs(S.sel.a - s.a) < 0.05 && Math.abs(S.sel.b - s.b) < 0.05);
    html += `<div class="ce-seg${on ? ' is-on' : ''}" data-seg="${i}" style="left:${left}px;width:${w}px;height:${HEIGHT}px;z-index:${mine ? 5 : 1}">${S.showWave ? `<canvas data-wave data-a="${a}" data-b="${b}" data-w="${w}" aria-hidden="true"></canvas>` : ''}</div>`;
    for (const side of ['start', 'end']) {
      const active = mine && D.side === side;
      const reach = Math.round(Math.min(25, Math.max(8, w * 0.3)));
      const x = side === 'start' ? left - 3 : left + w - reach;
      const val = side === 'start' ? a : b;
      html += `<button type="button" role="slider" class="ce-handle ce-handle--${side}${active || on ? ' is-on' : ''}" aria-label="${side === 'start' ? 'Trim the start' : 'Trim the end'} of part ${i + 1}" aria-valuemin="0" aria-valuemax="${duration()}" aria-valuenow="${r2(val)}" data-trim="${i}-${side}" style="left:${x}px;width:${reach + 3}px;height:${HEIGHT}px;z-index:${active ? 9 : on ? 7 : 6}"><span></span></button>`;
    }
  });
  if (D) {
    const dragged = L[D.i];
    const x = xOf(D.i, dragged.at) + (D.to - dragged.a) * pps;
    const delta = D.to - (D.side === 'start' ? D.a0 : D.b0);
    html += `<div class="ce-tiptag" style="left:${Math.max(70, Math.min(x, full - 90))}px">${fmtPrecise(D.to)} <em>${delta >= 0 ? '+' : '-'}${Math.abs(delta).toFixed(2)}s</em></div>`;
  }
  html += `<div class="ce-playhead" id="ce-ph"><i></i></div>`;
  inner.style.width = full + 'px';
  inner.style.height = HEIGHT + 34 + 'px';
  inner.innerHTML = html;
  inner.__L = L;
  inner.__pps = pps;
  inner.__xOf = xOf;
  inner.__segIndexAt = segIndexAt;
  inner.__full = full;
  // waveform canvases
  inner.querySelectorAll('canvas[data-wave]').forEach((c) => drawWave(c));
  const del = $('#ce-del');
  del.disabled = !(S.sel && !S.sel.removed);
  paintPlayhead();
  paintSplit();
}

function drawWave(c) {
  const a = Number(c.dataset.a);
  const b = Number(c.dataset.b);
  const wpx = Math.max(1, Math.round(Number(c.dataset.w) - 4));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const h = HEIGHT - 4;
  c.width = Math.min(wpx * dpr, 16000);
  c.height = h * dpr;
  c.style.width = wpx + 'px';
  c.style.height = h + 'px';
  const g = c.getContext('2d');
  const k = c.width / wpx;
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = '#5a7250';
  const barW = 2 * k;
  const stride = 3.5 * k;
  const span = b - a;
  for (let x = 0; x < c.width; x += stride) {
    const t0 = a + (x / c.width) * span;
    const t1 = a + ((x + stride) / c.width) * span;
    const peak = S.peaks ? peakBetween(S.peaks, t0, t1) : 0;
    const bh = Math.max(2 * k, peak * (c.height - 14 * k));
    g.beginPath();
    if (g.roundRect) g.roundRect(x, (c.height - bh) / 2, barW, bh, barW / 2);
    else g.rect(x, (c.height - bh) / 2, barW, bh);
    g.fill();
  }
}

function paintPlayhead() {
  const inner = $('#ce-tlin');
  const ph = $('#ce-ph');
  if (!inner || !ph || !inner.__L) return;
  const r = keepRanges(edits(), duration());
  const e = r.length ? toEdited(S.now, r) : S.now;
  const i = inner.__segIndexAt(e);
  const x = inner.__L.length ? inner.__xOf(i, e) : 12;
  ph.style.left = x + 'px';
  ph.style.height = HEIGHT + 14 + 'px';
  // keep it in view while it moves
  const box = $('#ce-tlbox');
  if (S.playing && (x < box.scrollLeft + 24 || x > box.scrollLeft + box.clientWidth - 40)) box.scrollTo({ left: Math.max(0, x - box.clientWidth / 3), behavior: 'smooth' });
  paintSplit();
}

function paintSplit() {
  const segs = segments(S.committed);
  const seg = segs.find((s) => S.now >= s.a - 0.001 && S.now < s.b);
  const can = !!(seg && S.now - seg.a > 0.3 && seg.b - S.now > 0.3);
  const btn = $('#ce-split');
  if (btn) btn.disabled = !can;
  const r = keepRanges(S.committed, duration());
  $('#ce-splitl').textContent = `Split at ${fmtTime(r.length ? toEdited(S.now, r) : S.now)}`;
}

/* ------------------------------------------------------------------ actions */

function deleteRange(a, b, label) {
  commit(label, { ...S.committed, cuts: [...S.committed.cuts, [a, b]] });
  S.sel = null;
  window.getSelection().removeAllRanges();
  repaintAll();
}
function deleteSelection() {
  const s = S.sel;
  if (!s || s.removed) return;
  deleteRange(s.a, s.b, s.kind === 'words' ? `Deleted ${s.count} word${s.count === 1 ? '' : 's'}` : 'Deleted a section');
}
function restoreSelection() {
  const s = S.sel;
  if (!s) return;
  const c = S.committed;
  commit('Brought words back', { ...c, cuts: subtractRange(c.cuts, s.a, s.b), ...(c.silences ? { silences: subtractRange(c.silences, s.a, s.b) } : {}), ...(c.fillers ? { fillers: subtractRange(c.fillers, s.a, s.b) } : {}) });
  S.sel = null;
  window.getSelection().removeAllRanges();
  repaintAll();
}
function split() {
  const segs = segments(S.committed);
  const seg = segs.find((s) => S.now >= s.a - 0.001 && S.now < s.b);
  if (!(seg && S.now - seg.a > 0.3 && seg.b - S.now > 0.3)) return;
  const r = keepRanges(S.committed, duration());
  commit(`Split at ${fmtTime(r.length ? toEdited(S.now, r) : S.now)}`, { ...S.committed, splits: [...(S.committed.splits || []), r2(S.now)] });
}
function toggleAuto(kind, minOverride) {
  const c = S.committed;
  const on = minOverride ? true : !(c[kind] && c[kind].length);
  const next = withAuto(c, kind, on, S.words, duration(), { peaks: S.peaks, silenceMin: minOverride });
  if (on && !(next[kind] && next[kind].length)) return toast(kind === 'silences' ? 'No pauses that long were found.' : 'No filler words found.');
  commit(kind === 'silences' ? (on ? (minOverride ? 'Changed the pause length' : 'Removed silences') : 'Brought silences back') : on ? 'Removed filler words' : 'Brought filler words back', next);
}
function nudge(i, side, delta) {
  const segs = segments(S.committed);
  const s = segs[i];
  if (!s) return;
  const { lo, hi } = trimBounds(segs, i, side);
  const cur = side === 'start' ? s.a : s.b;
  const to = r2(Math.min(hi, Math.max(lo, cur + delta)));
  if (Math.abs(to - cur) < 0.005) return;
  const next = trimEdge(S.committed, side, cur, to, duration(), side === 'start' ? s.b : s.a);
  commit(`${delta > 0 === (side === 'start') ? 'Trimmed' : 'Extended'} the ${side} of part ${i + 1}`, next);
  S.sel = { a: side === 'start' ? to : s.a, b: side === 'end' ? to : s.b, kind: 'segment' };
  repaintAll();
}

/* ------------------------------------------------------------------ wiring */

function wire() {
  const v = video;
  v.addEventListener('loadedmetadata', () => {
    if (!(S.clip.duration > 0) && (!Number.isFinite(v.duration) || v.duration <= 0)) {
      v.currentTime = 1e7;
      v.addEventListener('timeupdate', function f() {
        v.removeEventListener('timeupdate', f);
        v.currentTime = 0;
        repaintAll();
      });
    } else repaintAll();
  });
  v.addEventListener('play', () => {
    S.playing = true;
    cancelAnimationFrame(raf);
    const loop = () => {
      enforce();
      paintTranscriptActive();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  });
  v.addEventListener('pause', () => {
    S.playing = false;
    cancelAnimationFrame(raf);
  });
  v.addEventListener('timeupdate', enforce);
  v.addEventListener('seeked', () => {
    S.now = v.currentTime;
    paintPlayhead();
    paintTranscriptActive();
  });

  $('#ce-undo').addEventListener('click', undo);
  $('#ce-redo').addEventListener('click', redo);
  $('#ce-finish').addEventListener('click', async () => {
    const ok = await flush();
    if (!ok) return toast('Could not save the edits. Try Finish again.', 'bad');
    location.href = `/c/${ID}`;
  });
  $('#ce-hist').addEventListener('click', () => {
    const m = $('#ce-histm');
    m.hidden = !m.hidden;
    $('#ce-hist').setAttribute('aria-expanded', String(!m.hidden));
  });
  $('#ce-histm').addEventListener('click', (e) => {
    const b = e.target.closest('[data-jump]');
    if (!b) return;
    jumpTo(Number(b.dataset.jump));
    $('#ce-histm').hidden = true;
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.ce-menuwrap')) $('#ce-histm').hidden = true;
  });
  $('#ce-fillers').addEventListener('click', () => toggleAuto('fillers'));
  $('#ce-silences').addEventListener('click', () => toggleAuto('silences'));
  $('#ce-levels').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lv]');
    if (!b) return;
    S.level = Number(b.dataset.lv);
    toggleAuto('silences', S.level);
  });
  $('#ce-search').addEventListener('click', () => {
    S.searching = !S.searching;
    S.hideText = false;
    paintRail();
    if (S.searching) $('#ce-q').focus();
  });
  $('#ce-hide').addEventListener('click', () => {
    S.hideText = !S.hideText;
    paintRail();
  });
  $('#ce-q').addEventListener('input', (e) => {
    S.q = e.target.value;
    paintTranscript();
  });
  $('#ce-wave').addEventListener('click', () => {
    S.showWave = !S.showWave;
    $('#ce-wave').setAttribute('aria-pressed', String(S.showWave));
    renderTimeline();
  });
  $('#ce-del').addEventListener('click', deleteSelection);
  $('#ce-split').addEventListener('click', split);
  const setZoom = (z) => {
    S.zoom = Math.min(16, Math.max(1, +z.toFixed(1)));
    $('#ce-zoom').value = String(S.zoom);
    renderTimeline();
  };
  $('#ce-fit').addEventListener('click', () => setZoom(1));
  $('#ce-zout').addEventListener('click', () => setZoom(S.zoom - 1));
  $('#ce-zin').addEventListener('click', () => setZoom(S.zoom + 1));
  $('#ce-zoom').addEventListener('input', (e) => setZoom(Number(e.target.value)));
  window.addEventListener('resize', () => renderTimeline());

  // transcript: click a time or a word to seek, select words to delete them
  const tr = $('#ce-tr');
  tr.addEventListener('click', (e) => {
    const t = e.target.closest('[data-seek]');
    if (t) return seekSource(Number(t.dataset.seek));
    const w = e.target.closest('[data-w]');
    if (w && !window.getSelection().toString()) {
      const word = S.words[Number(w.dataset.w)];
      if (word) seekSource(word.s);
    }
  });
  let selTimer = 0;
  document.addEventListener('selectionchange', () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(readSelection, 100);
  });
  $('#ce-wordact').addEventListener('click', (e) => {
    if (!e.target.closest('[data-wordact]')) return;
    if (S.sel && S.sel.removed) restoreSelection();
    else deleteSelection();
  });

  // timeline
  const tlbox = $('#ce-tlbox');
  tlbox.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('[data-trim]');
    if (h) return beginTrim(e, h);
    const inner = $('#ce-tlin');
    if (!inner.__L || !inner.__L.length) return;
    const { s, t } = pick(e.clientX);
    S.sel = { a: s.a, b: s.b, kind: 'segment' };
    window.getSelection().removeAllRanges();
    seekSource(t);
    renderTimeline();
    paintWordAct();
  });
  tlbox.addEventListener('pointermove', moveTrim);
  tlbox.addEventListener('pointerup', () => endTrim(false));
  tlbox.addEventListener('pointercancel', () => endTrim(true));
  tlbox.addEventListener('keydown', (e) => {
    const h = e.target.closest('[data-trim]');
    if (!h || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const [i, side] = h.dataset.trim.split('-');
    nudge(Number(i), side, (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 0.1));
  });

  document.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', () => {
    if (S.saving === 'saving') flush();
  });
}

function onKey(e) {
  const el = e.target;
  if (el && (/^(INPUT|TEXTAREA|SELECT|VIDEO)$/.test(el.tagName) || el.isContentEditable)) {
    if (!(el.tagName === 'VIDEO' && (e.key === 'Delete' || e.key.toLowerCase() === 's' || e.key === 'Backspace'))) return;
  }
  const inner = $('#ce-tlin');
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel) {
    e.preventDefault();
    if (S.sel.removed) restoreSelection();
    else deleteSelection();
  } else if (e.key.toLowerCase() === 's' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    split();
  } else if (['[', ']', '{', '}'].includes(e.key) && S.sel && S.sel.kind === 'segment' && inner && !e.metaKey && !e.ctrlKey) {
    const segs = segments(S.committed);
    const i = segs.findIndex((x) => Math.abs(x.a - S.sel.a) < 0.05 && Math.abs(x.b - S.sel.b) < 0.05);
    if (i < 0) return;
    e.preventDefault();
    const out = e.shiftKey || e.key === '{' || e.key === '}';
    if (e.key === '[' || e.key === '{') nudge(i, 'start', out ? -0.1 : 0.1);
    else nudge(i, 'end', out ? 0.1 : -0.1);
  }
}

/** Read the words the person selected in the transcript. */
function readSelection() {
  const c = $('#ce-tr');
  const s = window.getSelection();
  if (!s || s.isCollapsed || !s.rangeCount || !c || !c.contains(s.anchorNode) || !c.contains(s.focusNode)) {
    if (S.sel && S.sel.kind === 'words') {
      S.sel = null;
      paintWordAct();
    }
    return;
  }
  const r = s.getRangeAt(0);
  let lo = Infinity;
  let hi = -1;
  c.querySelectorAll('[data-w]').forEach((el) => {
    if (r.intersectsNode(el)) {
      const i = Number(el.dataset.w);
      lo = Math.min(lo, i);
      hi = Math.max(hi, i);
    }
  });
  if (hi < 0) return;
  const sel = S.words.slice(lo, hi + 1);
  const next = S.words[hi + 1];
  const kr = keepRanges(S.committed, duration());
  S.sel = {
    a: sel[0].s,
    b: next ? Math.max(sel[sel.length - 1].e, next.s - 0.01) : sel[sel.length - 1].e,
    kind: 'words',
    removed: sel.every((w) => kr.length && !wordKept(w, kr)),
    count: sel.length,
  };
  renderTimeline();
  paintWordAct();
}

/* ---- trim handles ---- */

function pick(clientX) {
  const box = $('#ce-tlbox');
  const inner = $('#ce-tlin');
  const L = inner.__L;
  const pps = inner.__pps;
  const x = clientX - box.getBoundingClientRect().left + box.scrollLeft;
  let i = L.findIndex((_, k) => x < inner.__xOf(k, L[k].at + (L[k].b - L[k].a)) + GAP / 2);
  if (i < 0) i = L.length - 1;
  const s = L[i];
  const local = Math.min(s.b - s.a, Math.max(0, (x - inner.__xOf(i, s.at)) / pps));
  return { s, t: s.a + local };
}

function beginTrim(e, h) {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  e.stopPropagation();
  e.preventDefault();
  const [iStr, side] = h.dataset.trim.split('-');
  const i = Number(iStr);
  const inner = $('#ce-tlin');
  const segs = segments(S.committed);
  const s = segs[i];
  if (!s) return;
  const { lo, hi } = trimBounds(segs, i, side);
  try {
    h.setPointerCapture(e.pointerId);
  } catch (err) {
    /* the pointer ended */
  }
  S.sel = { a: s.a, b: s.b, kind: 'segment' };
  S.drag = { i, side, frozen: segs, pps: inner.__pps, a0: s.a, b0: s.b, lo, hi, startX: e.clientX, to: side === 'start' ? s.a : s.b, next: S.committed, id: e.pointerId };
}

function moveTrim(e) {
  const d = S.drag;
  if (!d) return;
  const edge = d.side === 'start' ? d.a0 : d.b0;
  let to = Math.min(d.hi, Math.max(d.lo, edge + (e.clientX - d.startX) / d.pps));
  if (!e.altKey) {
    // Word boundaries pull the edge in when it comes within about 8 pixels. Hold Alt to turn that off.
    const reach = 8 / d.pps;
    let best = reach;
    for (const w of S.words) {
      for (const t of [w.s, w.e]) {
        const dist = Math.abs(t - to);
        if (dist < best && t >= d.lo && t <= d.hi) {
          best = dist;
          to = t;
        }
      }
    }
  }
  to = r2(to);
  if (to === d.to) return;
  d.to = to;
  d.next = trimEdge(S.committed, d.side, edge, to, duration(), d.side === 'start' ? d.b0 : d.a0);
  S.draft = d.next;
  paintLength();
  renderTimeline();
  // keep the handle under the pointer: the capture target was replaced by the re-render, so capture the new one
  const nh = $(`[data-trim="${d.i}-${d.side}"]`);
  if (nh && d.id !== undefined) {
    try {
      nh.setPointerCapture(d.id);
    } catch (err) {
      /* already captured */
    }
  }
}

function endTrim(cancel) {
  const d = S.drag;
  if (!d) return;
  S.drag = null;
  S.draft = null;
  const moved = Math.abs(d.to - (d.side === 'start' ? d.a0 : d.b0)) >= 0.005;
  if (cancel || !moved) {
    repaintAll();
    return;
  }
  const inward = d.side === 'start' ? d.to > d.a0 : d.to < d.b0;
  const label = `${inward ? 'Trimmed' : 'Extended'} the ${d.side} of part ${d.i + 1}`;
  commit(label, d.next);
  S.sel = { a: d.side === 'start' ? d.to : d.a0, b: d.side === 'end' ? d.to : d.b0, kind: 'segment' };
  repaintAll();
}

start();
