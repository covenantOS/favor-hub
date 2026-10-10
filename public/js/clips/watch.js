// Clips: the watch page (/c/<id>). The player applies the clip's edits live (cuts are skipped, the trim is respected),
// with chapters, a searchable transcript, captions, timestamped comments, reactions and view tracking.
// Signed-out viewers through the share link get the player, summary, chapters and transcript. Staff also get the rest.
// Admins can rename, edit, share, download, write a help article and delete.
import {
  api, ask, copyText, esc, et, ago, fmtTime, hasEdits, keepRanges, longTime, normEdits, parseClock, rangesLength, skipFrom, toEdited, toSource,
  toast, transcriptFile, wordKept, wordsOf, fillerIndexes,
} from './core.js';
import { renderEdited } from './render.js';

const root = document.getElementById('cw-main');
const ID = root.dataset.id;
const SPEEDS = [1, 1.25, 1.5, 2];
const EMOJI = ['❤️', '👍', '🔥', '👏', '🙌', '👀'];
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const IC = {
  play: '<path d="M7 4v16l13-8z" fill="currentColor"/>',
  pause: '<path d="M7 5v14M17 5v14"/>',
  vol: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="m17 9 5 6M22 9l-5 6"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  cc: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 10.5a2.2 2.2 0 1 0 0 3M17 10.5a2.2 2.2 0 1 0 0 3"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  replay: '<path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v5h5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  wand: '<path d="M5 19 19 5"/><path d="M15 4v3M17.5 5.5h3M19 11v3M8 4v2M7 5h2"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  dl: '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  scissors: '<circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M8 8.5 20 18M8 15.5 20 6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  lang: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
};
const icon = (n, cls = '') => `<svg class="cw-i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${IC[n] || ''}</svg>`;

const S = {
  info: null, clip: null, user: null, can: { edit: false }, comments: [], reactions: [], viewers: [],
  lines: [], wordsRaw: [], words: [], edits: normEdits({}), ranges: [], srcDur: 0, now: 0, playing: false,
  lang: 'orig', translations: {}, speed: 1, muted: false, cc: localStorage.getItem('favor.clips.cc') === '1', tab: 'transcript', q: '', fixing: false, viewId: null, furthest: 0,
  commentAt: 0, pinned: false, helpDraft: '',
};
let video = null;
let raf = 0;
let pollTimer = 0;
let hideTimer = 0;

const duration = () => S.srcDur || (S.clip ? S.clip.duration : 0);
const total = () => (S.ranges.length ? rangesLength(S.ranges) : duration());
const edited = (t) => (S.ranges.length ? toEdited(t, S.ranges) : t);
const toSrc = (t) => (S.ranges.length ? toSource(t, S.ranges) : t);
/** The transcript lines in the language on screen: the original, or a translation with the same times. */
const shownLines = () => {
  const tr = S.lang !== 'orig' ? S.translations[S.lang] : null;
  return tr && tr.length === S.lines.length ? S.lines.map((l, i) => ({ s: l.s, e: l.e, t: tr[i] })) : S.lines;
};
const translated = () => shownLines() !== S.lines;
const LANG_NAMES = { orig: 'Original', es: 'Spanish', en: 'English' };
const isAdmin = () => !!(S.user && S.user.admin);
const signedIn = () => !!S.user;
const firstName = (n) => String(n || '').split(/\s+/)[0] || 'Someone';
const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const mediaUrl = () => `/api/clips/${ID}/media`;
const shareUrl = () => `${location.origin}/c/${ID}`;

/* ------------------------------------------------------------------ load */

async function load(first) {
  try {
    const d = await api(`/api/clips/${ID}/info`);
    S.info = d;
    S.clip = d.clip;
    S.user = d.user;
    S.can = d.can || { edit: false };
    S.comments = d.comments || [];
    S.reactions = d.reactions || [];
    S.viewers = d.viewers || [];
    S.helpDraft = d.helpDraft || '';
    S.lines = d.clip.transcript || [];
    S.wordsRaw = d.clip.words || [];
    S.words = wordsOf(S.lines, S.wordsRaw);
    S.translations = d.clip.translations || {};
    S.edits = normEdits(d.clip.edits);
    S.srcDur = d.clip.duration || 0;
    S.ranges = keepRanges(S.edits, duration());
    if (first) build();
    else refresh();
    schedulePoll();
  } catch (e) {
    if (e.status === 401) {
      location.href = `/login/?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    root.innerHTML = `<div class="cw-sheet cw-msg"><h1>That clip is gone</h1><p class="cw-sub">It was deleted, or the link is wrong. Ask the person who shared it for a new one.</p></div>`;
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (S.clip && S.clip.status === 'processing') pollTimer = setTimeout(() => load(false), 3500);
}

/* ------------------------------------------------------------------ skeleton */

function build() {
  const c = S.clip;
  document.title = `${c.title || 'Clip'} - Favor Hub`;
  const admin = isAdmin();
  root.innerHTML = `
  <div class="cw-grid">
    <section class="cw-left" aria-label="Clip">
      <div class="cw-titlebar">
        <h1 id="cw-title" ${admin ? 'tabindex="0" title="Click to rename"' : ''}></h1>
        <div class="cw-acts" id="cw-acts"></div>
      </div>
      <p class="cw-sub" id="cw-meta"></p>
      <div class="cw-player" id="cw-player" tabindex="-1">
        <video id="cw-video" playsinline preload="metadata" ${c.hasPoster ? `poster="/api/clips/${ID}/media?poster=1"` : ''} src="${mediaUrl()}"></video>
        <div class="cw-cc" id="cw-cc" hidden></div>
        <button type="button" class="cw-bigplay" id="cw-big" aria-label="Play" hidden>${icon('play')}</button>
        <div class="cw-buf" id="cw-buf" hidden><i></i>Loading</div>
        <div class="cw-pmsg" id="cw-pmsg" hidden></div>
        <div class="cw-ctl" id="cw-ctl">
          <div class="cw-seek" id="cw-seek" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">
            <div class="cw-track" id="cw-track"><div class="cw-fill" id="cw-fill"></div><div class="cw-knob" id="cw-knob"></div></div>
            <span class="cw-tip" id="cw-tip" hidden></span>
          </div>
          <div class="cw-crow">
            <button type="button" class="cw-ib" id="cw-pp" aria-label="Play" title="Play (space)">${icon('play')}</button>
            <span class="cw-clock" id="cw-clock">0:00 / 0:00</span>
            <span class="cw-flex"></span>
            <button type="button" class="cw-ib" id="cw-ccb" aria-pressed="false" aria-label="Captions" title="Captions (c)">${icon('cc')}</button>
            <span class="cw-menuwrap"><button type="button" class="cw-ib cw-ib--txt" id="cw-spd" aria-haspopup="menu" aria-expanded="false" aria-label="Speed 1x" title="Speed">1x</button><ul class="cw-menu" id="cw-spdm" role="menu" hidden>${SPEEDS.map((s) => `<li role="none"><button type="button" role="menuitemradio" data-r="${s}" aria-checked="${s === 1}">${s}x</button></li>`).join('')}</ul></span>
            <button type="button" class="cw-ib" id="cw-mute" aria-label="Mute" title="Mute (m)">${icon('vol')}</button>
            <button type="button" class="cw-ib" id="cw-fs" aria-label="Full screen" title="Full screen (f)">${icon('full')}</button>
          </div>
        </div>
      </div>
      <p class="cw-edlen" id="cw-edlen" hidden></p>
      <div id="cw-react"></div>
      <div id="cw-composer"></div>
      <section class="cw-block" aria-label="Summary"><div class="cw-bhead"><h2>Summary</h2><span class="cw-bacts" id="cw-sumacts"></span></div><div id="cw-sum"></div></section>
      <section class="cw-block" aria-label="Chapters"><div class="cw-bhead"><h2>Chapters</h2><span class="cw-bacts" id="cw-chacts"></span></div><div id="cw-chap"></div></section>
    </section>
    <aside class="cw-right" aria-label="Transcript and discussion"><div class="cw-tabs" id="cw-tabs" role="tablist"></div><div class="cw-panel" id="cw-panel"></div></aside>
  </div>`;
  video = $('#cw-video');
  wirePlayer();
  wireTop();
  refresh();
  const t = Number(new URLSearchParams(location.search).get('t'));
  if (t > 0) {
    S.startAt = t;
  }
}

/** Repaint everything that depends on the data (not the player). */
function refresh() {
  const c = S.clip;
  const admin = isAdmin();
  const title = $('#cw-title');
  if (title && !title.querySelector('input')) title.textContent = c.title || (c.status === 'processing' ? 'Writing a title' : 'Untitled clip');
  const views = S.info && typeof S.info.views === 'number' && signedIn() ? ` · ${S.info.views} ${S.info.views === 1 ? 'view' : 'views'}` : '';
  $('#cw-meta').innerHTML = `${esc(c.ownerName)} · ${esc(et(c.createdAt, { month: 'long', day: 'numeric', year: 'numeric' }))}${views}${c.status === 'processing' ? ' · <span class="cw-proc"><i></i>Writing the transcript and a title</span>' : ''}`;
  S.ranges = keepRanges(S.edits, duration());
  paintActs();
  paintEdLen();
  paintReact();
  paintComposer();
  paintSummary();
  paintChapters();
  paintTabs();
  paintPanel();
  paintMarkers();
  paintClock();
  void admin;
}

function paintEdLen() {
  const el = $('#cw-edlen');
  if (!el) return;
  if (hasEdits(S.edits)) {
    el.hidden = false;
    el.innerHTML = `<s>${longTime(duration())}</s> → <b>${longTime(total())}</b>`;
  } else el.hidden = true;
}

/* ------------------------------------------------------------------ top actions */

function paintActs() {
  const box = $('#cw-acts');
  if (!box) return;
  if (isAdmin()) {
    box.innerHTML = `<button type="button" class="cw-btn" id="cw-share">${icon('link')}<span>Share</span></button>
      <span class="cw-menuwrap"><button type="button" class="cw-btn cw-btn--ghost cw-btn--ic" id="cw-more" aria-haspopup="menu" aria-expanded="false" aria-label="More">${icon('more')}</button>
      <ul class="cw-menu cw-menu--r" id="cw-morem" role="menu" hidden>
        <li role="none"><label class="cw-mi cw-mi--sw"><input type="checkbox" id="cw-sw" ${S.clip.share ? 'checked' : ''}><i></i><span>Anyone with the link</span></label></li>
        <li role="none"><a class="cw-mi" role="menuitem" href="/clips/edit/?id=${ID}">${icon('scissors')}Edit the clip</a></li>
        <li role="none"><button type="button" class="cw-mi" role="menuitem" data-m="copy">${icon('copy')}Copy link</button></li>
        <li role="none"><a class="cw-mi" role="menuitem" href="${mediaUrl()}?dl=1" download>${icon('dl')}Download original</a></li>
        <li role="none" ${hasEdits(S.edits) ? '' : 'hidden'}><button type="button" class="cw-mi" role="menuitem" data-m="edited">${icon('dl')}Download edited version</button></li>
        <li role="none"><button type="button" class="cw-mi" role="menuitem" data-m="title">${icon('wand')}Write the title again</button></li>
        <li role="none"><button type="button" class="cw-mi" role="menuitem" data-m="again">${icon('wand')}Redo the transcript</button></li>
        <li role="none"><button type="button" class="cw-mi cw-mi--danger" role="menuitem" data-m="delete">${icon('trash')}Delete</button></li>
      </ul></span>`;
  } else {
    box.innerHTML = `<button type="button" class="cw-btn" id="cw-copy">${icon('link')}<span>Copy link</span></button>
      <span class="cw-menuwrap"><button type="button" class="cw-btn cw-btn--ghost cw-btn--ic" id="cw-more" aria-haspopup="menu" aria-expanded="false" aria-label="More">${icon('more')}</button>
      <ul class="cw-menu cw-menu--r" id="cw-morem" role="menu" hidden>
        <li role="none"><a class="cw-mi" role="menuitem" href="${mediaUrl()}?dl=1" download>${icon('dl')}Download</a></li>
      </ul></span>`;
  }
}

async function shareAndCopy() {
  const btn = $('#cw-share') || $('#cw-copy');
  try {
    if (isAdmin() && !S.clip.share) {
      await api(`/api/clips/${ID}`, { method: 'PATCH', json: { share: true } });
      S.clip.share = true;
      const sw = $('#cw-sw');
      if (sw) sw.checked = true;
    }
    const ok = await copyText(shareUrl());
    const label = btn && btn.querySelector('span');
    if (label) {
      label.textContent = ok ? 'Link copied' : 'Copy failed';
      setTimeout(() => (label.textContent = isAdmin() ? 'Share' : 'Copy link'), 1800);
    }
    toast(ok ? (isAdmin() ? 'Link copied. Anyone with the link can watch.' : 'Link copied') : 'Could not copy the link', ok ? 'ok' : 'bad');
  } catch (e) {
    toast(e.message, 'bad');
  }
}

function wireTop() {
  const box = $('#cw-acts');
  const closeMenus = () => $$('.cw-menu').forEach((m) => {
    m.hidden = true;
    const b = m.previousElementSibling;
    if (b) b.setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.cw-menuwrap')) closeMenus();
  });
  box.addEventListener('click', async (e) => {
    const t = e.target.closest('button, a');
    if (!t) return;
    if (t.id === 'cw-share' || t.id === 'cw-copy') return shareAndCopy();
    if (t.id === 'cw-more') {
      const m = $('#cw-morem');
      const open = m.hidden;
      closeMenus();
      m.hidden = !open;
      t.setAttribute('aria-expanded', String(open));
      return;
    }
    const act = t.dataset.m;
    if (!act) return;
    closeMenus();
    if (act === 'copy') toast((await copyText(shareUrl())) ? 'Link copied' : 'Could not copy the link');
    if (act === 'edited') downloadEdited();
    if (act === 'title') {
      try {
        toast('Writing a title');
        const r = await api(`/api/clips/${ID}/generate`, { method: 'POST', json: { what: 'title' } });
        S.clip.title = r.title;
        $('#cw-title').textContent = r.title;
        document.title = `${r.title} - Favor Hub`;
      } catch (err) {
        toast(err.message, 'bad');
      }
    }
    if (act === 'again') {
      try {
        toast('Writing the transcript again. This takes a minute.');
        S.clip.status = 'processing';
        refresh();
        const r = await api(`/api/clips/${ID}/process`, { method: 'POST', json: { again: true } });
        void r;
        await load(false);
        toast('Done');
      } catch (err) {
        toast(err.message, 'bad');
      }
    }
    if (act === 'delete') {
      if (!(await ask({ title: 'Delete this clip?', body: 'The video, transcript and comments are removed for good, and the link stops working.', ok: 'Delete clip' }))) return;
      try {
        await api(`/api/clips/${ID}`, { method: 'DELETE' });
        location.href = '/clips/';
      } catch (err) {
        toast(err.message, 'bad');
      }
    }
  });
  box.addEventListener('change', async (e) => {
    if (e.target.id !== 'cw-sw') return;
    const on = e.target.checked;
    try {
      await api(`/api/clips/${ID}`, { method: 'PATCH', json: { share: on } });
      S.clip.share = on;
      toast(on ? 'Anyone with the link can watch' : 'Only signed-in Favor staff can watch');
    } catch (err) {
      e.target.checked = !on;
      toast(err.message, 'bad');
    }
  });
  const title = $('#cw-title');
  if (isAdmin()) {
    const edit = () => {
      if (title.querySelector('input')) return;
      const cur = S.clip.title || '';
      title.innerHTML = `<input class="cw-tin" type="text" maxlength="120" value="${esc(cur)}" aria-label="Clip title" />`;
      const inp = title.querySelector('input');
      inp.focus();
      inp.select();
      const done = async (save) => {
        const v = inp.value.trim();
        title.textContent = S.clip.title;
        if (save && v && v !== cur) {
          try {
            await api(`/api/clips/${ID}`, { method: 'PATCH', json: { title: v } });
            S.clip.title = v;
            title.textContent = v;
            document.title = `${v} - Favor Hub`;
            toast('Renamed');
          } catch (err) {
            toast(err.message, 'bad');
          }
        }
      };
      inp.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') done(true);
        if (ev.key === 'Escape') done(false);
      });
      inp.addEventListener('blur', () => done(true));
    };
    title.addEventListener('click', edit);
    title.addEventListener('keydown', (e) => e.key === 'Enter' && edit());
  }
}

async function downloadEdited() {
  const bar = document.createElement('div');
  bar.className = 'cw-render';
  bar.innerHTML = `<p>Making the edited video as it plays. Keep this tab open. <b data-p>0%</b></p><div class="cw-prog"><i></i></div><button type="button" class="cw-btn cw-btn--ghost">Cancel</button>`;
  document.body.appendChild(bar);
  const sig = { cancelled: false };
  bar.querySelector('button').addEventListener('click', () => (sig.cancelled = true));
  try {
    const { blob, ext } = await renderEdited(`${mediaUrl()}`, S.ranges, {
      signal: sig,
      onProgress: (f) => {
        bar.querySelector('[data-p]').textContent = Math.round(f * 100) + '%';
        bar.querySelector('.cw-prog i').style.width = Math.round(f * 100) + '%';
      },
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(S.clip.title || 'Clip').replace(/[^\w\- ]+/g, '').trim() || 'Clip'} (edited).${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    toast('Edited video downloaded');
  } catch (e) {
    if (!(e instanceof Error && e.message === 'cancelled')) toast(e instanceof Error ? e.message : 'Could not make the video', 'bad');
  } finally {
    bar.remove();
  }
}

/* ------------------------------------------------------------------ player */

function wirePlayer() {
  const v = video;
  const wrap = $('#cw-player');
  const seekEl = $('#cw-seek');
  let scrub = null;
  let hover = null;

  const atX = (x) => {
    const b = $('#cw-track').getBoundingClientRect();
    return Math.min(1, Math.max(0, (x - b.left) / b.width)) * total();
  };
  const jumpEdited = (e) => seekSource(toSrc(e));

  v.addEventListener('loadedmetadata', () => {
    // The clip's own length (what the recorder counted) is the one every edit is measured against, so a cut to the end
    // always means the end. The file's length only fills in when the clip has none.
    if (!(S.clip.duration > 0)) {
      if (Number.isFinite(v.duration) && v.duration > 0) S.srcDur = v.duration;
      else {
        // A recording carries no length. Asking for the far end makes the browser work it out.
        v.currentTime = 1e7;
        v.addEventListener('timeupdate', function f() {
          v.removeEventListener('timeupdate', f);
          if (Number.isFinite(v.duration) && v.duration > 0) S.srcDur = v.duration;
          S.ranges = keepRanges(S.edits, duration());
          v.currentTime = S.startAt || (S.ranges.length ? S.ranges[0][0] : 0);
          paintClock();
          paintMarkers();
        });
      }
      S.ranges = keepRanges(S.edits, duration());
    }
    if (S.startAt) v.currentTime = S.startAt;
    else if (S.ranges.length && S.ranges[0][0] > 0.05) v.currentTime = S.ranges[0][0];
    $('#cw-big').hidden = false;
    paintClock();
    paintMarkers();
  });
  v.addEventListener('play', () => {
    S.playing = true;
    $('#cw-big').hidden = true;
    setPlayIcons();
    startViewTracking();
    cancelAnimationFrame(raf);
    const loop = () => {
      enforce();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    poke();
  });
  v.addEventListener('pause', () => {
    S.playing = false;
    cancelAnimationFrame(raf);
    setPlayIcons();
    wrap.classList.remove('is-idle');
    if (!v.ended) $('#cw-big').hidden = false;
    flushView();
  });
  v.addEventListener('ended', () => {
    $('#cw-big').innerHTML = icon('replay');
    $('#cw-big').setAttribute('aria-label', 'Replay');
    $('#cw-big').hidden = false;
  });
  v.addEventListener('timeupdate', enforce);
  v.addEventListener('waiting', () => ($('#cw-buf').hidden = false));
  v.addEventListener('seeking', () => ($('#cw-buf').hidden = false));
  v.addEventListener('canplay', () => ($('#cw-buf').hidden = true));
  v.addEventListener('playing', () => ($('#cw-buf').hidden = true));
  v.addEventListener('seeked', () => {
    $('#cw-buf').hidden = true;
    S.now = v.currentTime;
    paintClock();
  });
  v.addEventListener('error', () => {
    const m = $('#cw-pmsg');
    m.hidden = false;
    m.textContent = 'This video could not be played. Try the download in the menu.';
  });
  v.addEventListener('click', toggle);
  $('#cw-big').addEventListener('click', () => {
    if (v.ended) seekSource(S.ranges.length ? S.ranges[0][0] : 0);
    $('#cw-big').innerHTML = icon('play');
    $('#cw-big').setAttribute('aria-label', 'Play');
    play();
  });
  $('#cw-pp').addEventListener('click', toggle);

  // scrubber
  seekEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.cw-mk')) return;
    seekEl.setPointerCapture(e.pointerId);
    scrub = atX(e.clientX);
    paintClock(scrub);
  });
  seekEl.addEventListener('pointermove', (e) => {
    if (scrub !== null) {
      scrub = atX(e.clientX);
      paintClock(scrub);
    } else {
      hover = atX(e.clientX);
      const tip = $('#cw-tip');
      tip.hidden = false;
      tip.textContent = fmtTime(hover);
      tip.style.left = (hover / (total() || 1)) * 100 + '%';
    }
  });
  seekEl.addEventListener('pointerup', (e) => {
    if (scrub !== null) {
      jumpEdited(atX(e.clientX));
      scrub = null;
      paintClock();
    }
  });
  seekEl.addEventListener('pointerleave', () => ($('#cw-tip').hidden = true));
  seekEl.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' ? 5 : e.key === 'ArrowLeft' ? -5 : 0;
    if (step) {
      e.preventDefault();
      jumpEdited(Math.min(Math.max(toEdited(v.currentTime, S.ranges) + step, 0), total()));
    }
  });

  // speed, mute, captions, fullscreen
  const spd = $('#cw-spd');
  const spdm = $('#cw-spdm');
  spd.addEventListener('click', () => {
    spdm.hidden = !spdm.hidden;
    spd.setAttribute('aria-expanded', String(!spdm.hidden));
  });
  spdm.addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    setSpeed(Number(b.dataset.r));
    spdm.hidden = true;
    spd.setAttribute('aria-expanded', 'false');
  });
  $('#cw-mute').addEventListener('click', () => toggleMute());
  $('#cw-ccb').addEventListener('click', () => setCc(!S.cc));
  $('#cw-fs').addEventListener('click', fullscreen);
  setCc(S.cc);
  document.addEventListener('fullscreenchange', () => wrap.classList.toggle('is-fs', !!document.fullscreenElement));
  wrap.addEventListener('pointermove', poke);
  wrap.addEventListener('pointerleave', () => S.playing && wrap.classList.add('is-idle'));

  document.addEventListener('keydown', (e) => {
    const el = e.target;
    if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const step = (s) => jumpEdited(Math.min(Math.max(toEdited(v.currentTime, S.ranges) + s, 0), total()));
    let used = true;
    switch (e.key) {
      case ' ':
      case 'k': toggle(); break;
      case 'ArrowLeft': step(-5); break;
      case 'ArrowRight': step(5); break;
      case 'j': step(-10); break;
      case 'l': step(10); break;
      case 'ArrowUp': v.volume = Math.min(1, v.volume + 0.1); break;
      case 'ArrowDown': v.volume = Math.max(0, v.volume - 0.1); break;
      case 'm': toggleMute(); break;
      case 'f': fullscreen(); break;
      case 'c': setCc(!S.cc); break;
      case '>': setSpeed(SPEEDS[Math.min(SPEEDS.indexOf(S.speed) + 1, SPEEDS.length - 1)]); break;
      case '<': setSpeed(SPEEDS[Math.max(SPEEDS.indexOf(S.speed) - 1, 0)]); break;
      case 'Home': jumpEdited(0); break;
      case 'End': jumpEdited(total()); break;
      default:
        if (/^[0-9]$/.test(e.key)) jumpEdited((Number(e.key) / 10) * total());
        else used = false;
    }
    if (used) e.preventDefault();
  });
  window.addEventListener('pagehide', flushView);
}

function poke() {
  const wrap = $('#cw-player');
  if (!wrap) return;
  wrap.classList.remove('is-idle');
  clearTimeout(hideTimer);
  if (S.playing) hideTimer = setTimeout(() => wrap.classList.add('is-idle'), 2600);
}

function setPlayIcons() {
  const pp = $('#cw-pp');
  pp.innerHTML = icon(S.playing ? 'pause' : 'play');
  pp.setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
}

function seekSource(t) {
  const v = video;
  const r = S.ranges;
  const skip = skipFrom(t, r);
  const target = skip === null ? (r[r.length - 1] ? r[r.length - 1][1] : t) : skip === undefined ? t : skip;
  v.currentTime = Math.max(0, target);
  S.now = v.currentTime;
  paintClock();
}

function play() {
  const v = video;
  const r = S.ranges;
  const skip = r.length ? skipFrom(v.currentTime, r) : undefined;
  if (skip === null) seekSource(r[0][0]);
  else if (skip !== undefined) seekSource(skip);
  v.play().catch(() => undefined);
}
function toggle() {
  if (video.paused) play();
  else video.pause();
}
function toggleMute() {
  S.muted = !S.muted;
  video.muted = S.muted;
  $('#cw-mute').innerHTML = icon(S.muted ? 'mute' : 'vol');
  $('#cw-mute').setAttribute('aria-label', S.muted ? 'Unmute' : 'Mute');
}
function setSpeed(s) {
  S.speed = s;
  video.playbackRate = s;
  const b = $('#cw-spd');
  b.textContent = `${s}x`;
  b.setAttribute('aria-label', `Speed ${s}x`);
  $$('#cw-spdm [data-r]').forEach((x) => x.setAttribute('aria-checked', String(Number(x.dataset.r) === s)));
}
function setCc(on) {
  S.cc = on;
  try {
    localStorage.setItem('favor.clips.cc', on ? '1' : '0');
  } catch (e) {
    /* not remembered */
  }
  const b = $('#cw-ccb');
  b.setAttribute('aria-pressed', String(on));
  b.classList.toggle('is-on', on);
  paintCaption();
}
async function fullscreen() {
  const el = $('#cw-player');
  if (document.fullscreenElement) await document.exitFullscreen();
  else if (el.requestFullscreen) await el.requestFullscreen();
  else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
}

/** Apply the edits while playing: jump over cuts, stop at the trim. */
function enforce() {
  const v = video;
  if (!v) return;
  const r = S.ranges;
  const t = v.currentTime;
  const skip = r.length ? skipFrom(t, r) : undefined;
  if (skip === null) {
    v.pause();
    v.currentTime = r[r.length - 1][1];
    $('#cw-big').innerHTML = icon('replay');
    $('#cw-big').setAttribute('aria-label', 'Replay');
    $('#cw-big').hidden = false;
  } else if (skip !== undefined) v.currentTime = skip;
  S.now = v.currentTime;
  if (S.now > S.furthest) S.furthest = S.now;
  paintClock();
  paintCaption();
  highlightTranscript();
}

function paintClock(scrubTo) {
  const clock = $('#cw-clock');
  if (!clock) return;
  const shown = scrubTo !== undefined ? scrubTo : edited(S.now);
  const tot = total();
  clock.textContent = `${fmtTime(shown)} / ${fmtTime(tot)}`;
  const pct = tot ? Math.min(100, (shown / tot) * 100) : 0;
  $('#cw-fill').style.width = pct + '%';
  $('#cw-knob').style.left = pct + '%';
  const sk = $('#cw-seek');
  sk.setAttribute('aria-valuemax', String(Math.round(tot)));
  sk.setAttribute('aria-valuenow', String(Math.round(shown)));
  sk.setAttribute('aria-valuetext', `${fmtTime(shown)} of ${fmtTime(tot)}`);
}

function paintCaption() {
  const el = $('#cw-cc');
  if (!el) return;
  if (!S.cc) {
    el.hidden = true;
    return;
  }
  const t = S.now;
  const line = shownLines().find((l) => t >= l.s - 0.05 && t <= l.e + 0.4);
  if (!line) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  if (el.dataset.s !== S.lang + line.s) {
    el.dataset.s = S.lang + line.s;
    el.textContent = line.t;
  }
}

/** Chapter ticks and comment markers on the scrubber. */
function paintMarkers() {
  const track = $('#cw-track');
  if (!track) return;
  $$('.cw-mk, .cw-tick', track).forEach((n) => n.remove());
  const tot = total() || 1;
  for (const ch of S.clip.chapters || []) {
    if (ch.at <= 0.5) continue;
    const t = document.createElement('i');
    t.className = 'cw-tick';
    t.style.left = Math.min(99, (edited(ch.at) / tot) * 100) + '%';
    t.title = ch.title;
    track.appendChild(t);
  }
  if (!signedIn()) return;
  for (const c of S.comments) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cw-mk';
    b.dataset.id = c.id;
    b.style.left = Math.min(97, Math.max(3, (edited(c.at_seconds) / tot) * 100)) + '%';
    b.setAttribute('aria-label', `${firstName(c.author_name)} commented at ${fmtTime(edited(c.at_seconds))}`);
    b.innerHTML = `<span class="cw-av">${esc(initials(c.author_name))}</span><span class="cw-mktip"><b>${esc(firstName(c.author_name))} · ${fmtTime(edited(c.at_seconds))}</b>${esc(c.body)}</span>`;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      seekSource(c.at_seconds);
      b.classList.add('is-open');
      setTimeout(() => b.classList.remove('is-open'), 3500);
    });
    track.appendChild(b);
  }
}

/* ------------------------------------------------------------------ view tracking */

function startViewTracking() {
  if (S.viewId !== null || S.viewStarted || !S.clip) return;
  S.viewStarted = true;
  api(`/api/clips/${ID}/views`, { method: 'POST', json: { seconds: Math.round(S.furthest) } })
    .then((r) => {
      S.viewId = r.viewId || false;
      S.viewTimer = setInterval(flushView, 6000);
    })
    .catch(() => {
      S.viewId = false;
    });
}
function flushView() {
  if (!S.viewId) return;
  const body = JSON.stringify({ viewId: S.viewId, seconds: Math.round(S.furthest) });
  try {
    if (navigator.sendBeacon) navigator.sendBeacon(`/api/clips/${ID}/views`, new Blob([body], { type: 'application/json' }));
    else fetch(`/api/clips/${ID}/views`, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true });
  } catch (e) {
    /* a view count is not worth an error */
  }
}

/* ------------------------------------------------------------------ reactions and comments */

function paintReact() {
  const box = $('#cw-react');
  if (!box) return;
  if (!signedIn()) {
    box.innerHTML = '';
    return;
  }
  const me = S.user.email;
  box.innerHTML = `<div class="cw-reacts" role="group" aria-label="Reactions">${EMOJI.map((e) => {
    const all = S.reactions.filter((r) => r.emoji === e);
    const mine = all.some((r) => r.person_email === me);
    const names = all.map((r) => (r.person_email === me ? 'You' : firstName(r.person_name)));
    return `<span class="cw-rx"><button type="button" data-emoji="${e}" aria-pressed="${mine}" aria-label="${e} ${all.length}${names.length ? ', ' + esc(names.join(', ')) : ''}" class="${mine ? 'is-mine' : all.length ? 'has' : ''}"><span aria-hidden="true">${e}</span>${all.length ? `<em>${all.length}</em>` : ''}</button>${all.length ? `<span class="cw-rxtip" role="tooltip">${esc(names.join(', '))}</span>` : ''}</span>`;
  }).join('')}<span class="cw-rsep"></span><button type="button" class="cw-cbtn" id="cw-cbtn">${icon('chat')}<span>Comment${S.comments.length ? ` (${S.comments.length})` : ''}</span></button></div>`;
}

function paintComposer() {
  const box = $('#cw-composer');
  if (!box) return;
  if (!signedIn()) {
    box.innerHTML = '';
    return;
  }
  if (box.dataset.ready) return;
  box.dataset.ready = '1';
  box.innerHTML = `<div class="cw-comp"><span class="cw-av cw-av--me">${esc(initials(S.user.name))}</span><div class="cw-comp__f"><textarea id="cw-cin" rows="1" maxlength="2000" placeholder="Add a comment at 0:00" aria-label="Comment"></textarea><div class="cw-comp__b" id="cw-cb" hidden><span class="cw-hint">Enter to post, Shift and Enter for a new line</span><button type="button" class="cw-btn cw-btn--ghost" id="cw-pin" aria-pressed="false">Pin time</button><button type="button" class="cw-btn" id="cw-post">Comment</button></div></div></div>`;
  const ta = $('#cw-cin');
  const placeholder = () => {
    ta.placeholder = `Add a comment at ${fmtTime(edited(S.pinned ? S.commentAt : S.now))}`;
  };
  setInterval(() => {
    if (!ta.value && !S.pinned) placeholder();
    const post = $('#cw-post');
    if (post && ta.value.trim() && !S.pinned) post.textContent = `Comment at ${fmtTime(edited(S.now))}`;
  }, 500);
  placeholder();
  ta.addEventListener('input', () => {
    $('#cw-cb').hidden = !ta.value.trim();
    if (!ta.value.trim()) S.pinned = false;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
    if (!S.pinned) S.commentAt = S.now;
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      post();
    }
  });
  $('#cw-pin').addEventListener('click', () => {
    S.pinned = !S.pinned;
    if (S.pinned) S.commentAt = S.now;
    $('#cw-pin').setAttribute('aria-pressed', String(S.pinned));
    $('#cw-pin').textContent = S.pinned ? `Pinned at ${fmtTime(edited(S.commentAt))}` : 'Pin time';
  });
  $('#cw-post').addEventListener('click', post);
  async function post() {
    const text = ta.value.trim();
    if (!text) return;
    const at = S.pinned ? S.commentAt : S.now;
    try {
      const r = await api(`/api/clips/${ID}/comments`, { method: 'POST', json: { at, text } });
      S.comments.push(r.comment);
      S.comments.sort((a, b) => a.at_seconds - b.at_seconds);
      ta.value = '';
      ta.style.height = 'auto';
      S.pinned = false;
      $('#cw-pin').setAttribute('aria-pressed', 'false');
      $('#cw-pin').textContent = 'Pin time';
      $('#cw-cb').hidden = true;
      paintReact();
      paintMarkers();
      paintTabs();
      paintPanel();
      toast('Comment added');
    } catch (e) {
      toast(e.message, 'bad');
    }
  }
}

document.addEventListener('click', async (e) => {
  const rx = e.target.closest('[data-emoji]');
  if (rx && signedIn()) {
    try {
      const r = await api(`/api/clips/${ID}/reactions`, { method: 'POST', json: { emoji: rx.dataset.emoji, at: S.now } });
      if (r.removed) S.reactions = S.reactions.filter((x) => x.id !== r.removed);
      else if (r.reaction) S.reactions.push(r.reaction);
      paintReact();
      paintPanel();
    } catch (err) {
      toast(err.message, 'bad');
    }
    return;
  }
  if (e.target.closest('#cw-cbtn')) {
    S.tab = 'comments';
    S.commentAt = S.now;
    paintTabs();
    paintPanel();
    const ta = $('#cw-cin');
    if (ta) ta.focus();
  }
});

/* ------------------------------------------------------------------ summary and chapters */

function paintSummary() {
  const box = $('#cw-sum');
  const acts = $('#cw-sumacts');
  if (!box) return;
  const c = S.clip;
  if (box.querySelector('textarea')) return;
  box.innerHTML = c.summary ? `<p class="cw-sumtxt">${esc(c.summary)}</p>` : `<p class="cw-empty">${c.status === 'processing' ? 'Writing a summary' : isAdmin() ? 'No summary yet.' : 'No summary.'}</p>`;
  acts.innerHTML = isAdmin() && S.lines.length ? `<button type="button" class="cw-ib2" data-sum="edit" aria-label="Edit the summary" title="Edit">${icon('pencil')}</button><button type="button" class="cw-ib2" data-sum="again" aria-label="Write the summary again" title="Write it again">${icon('wand')}</button>` : isAdmin() ? `<button type="button" class="cw-ib2" data-sum="edit" aria-label="Edit the summary">${icon('pencil')}</button>` : '';
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-sum]');
  if (!b) return;
  if (b.dataset.sum === 'again') {
    try {
      const r = await api(`/api/clips/${ID}/generate`, { method: 'POST', json: { what: 'summary' } });
      S.clip.summary = r.summary;
      paintSummary();
      toast('Summary written');
    } catch (err) {
      toast(err.message, 'bad');
    }
  }
  if (b.dataset.sum === 'edit') {
    const box = $('#cw-sum');
    box.innerHTML = `<textarea class="cw-edit" id="cw-sumin" rows="4" maxlength="1500" aria-label="Summary">${esc(S.clip.summary)}</textarea><div class="cw-editb"><button type="button" class="cw-btn" id="cw-sumsave">Save</button><button type="button" class="cw-btn cw-btn--ghost" id="cw-sumcancel">Cancel</button></div>`;
    $('#cw-sumin').focus();
    $('#cw-sumcancel').addEventListener('click', () => {
      box.innerHTML = '';
      paintSummary();
    });
    $('#cw-sumsave').addEventListener('click', async () => {
      const v = $('#cw-sumin').value.trim();
      try {
        await api(`/api/clips/${ID}`, { method: 'PATCH', json: { summary: v } });
        S.clip.summary = v;
        box.innerHTML = '';
        paintSummary();
      } catch (err) {
        toast(err.message, 'bad');
      }
    });
  }
});

function activeChapterIndex() {
  const ch = S.clip.chapters || [];
  let a = -1;
  ch.forEach((c, i) => {
    if (c.at <= S.now + 0.2) a = i;
  });
  return a;
}

function paintChapters() {
  const box = $('#cw-chap');
  const acts = $('#cw-chacts');
  if (!box) return;
  const ch = S.clip.chapters || [];
  const admin = isAdmin();
  acts.innerHTML = admin ? `${S.lines.length ? `<button type="button" class="cw-ib2 cw-ib2--txt" data-ch="again">${icon('wand')}<span>${ch.length ? 'Regenerate' : 'Make chapters'}</span></button>` : ''}<button type="button" class="cw-ib2" data-ch="add" aria-label="Add a chapter" title="Add a chapter at this moment">${icon('plus')}</button>` : '';
  if (!ch.length) {
    box.innerHTML = `<p class="cw-empty">${S.clip.status === 'processing' ? 'Writing the chapters' : S.lines.length ? 'No chapters yet.' : 'Chapters appear once the transcript is ready.'}</p>`;
    return;
  }
  const act = activeChapterIndex();
  box.innerHTML = `<ol class="cw-chlist">${ch.map((c, i) => `<li class="${i === act ? 'is-on' : ''}" data-i="${i}"><button type="button" class="cw-ch" data-seek="${c.at}"><span class="cw-t">${fmtTime(edited(c.at))}</span><span class="cw-ct">${esc(c.title)}</span></button>${admin ? `<span class="cw-chb"><button type="button" data-ch="edit" data-i="${i}" aria-label="Edit chapter ${i + 1}">${icon('pencil')}</button><button type="button" data-ch="del" data-i="${i}" aria-label="Delete chapter ${i + 1}">${icon('x')}</button></span>` : ''}</li>`).join('')}</ol>`;
}

async function saveChapters(next) {
  const sorted = next.filter((c) => c.title.trim()).sort((a, b) => a.at - b.at);
  try {
    const r = await api(`/api/clips/${ID}`, { method: 'PATCH', json: { chapters: sorted } });
    S.clip.chapters = r.chapters;
  } catch (err) {
    toast(err.message, 'bad');
  }
  paintChapters();
  paintMarkers();
}

document.addEventListener('click', async (e) => {
  const sk = e.target.closest('[data-seek]');
  if (sk && video) {
    seekSource(Number(sk.dataset.seek));
    play();
    return;
  }
  const b = e.target.closest('[data-ch]');
  if (!b) return;
  const ch = [...(S.clip.chapters || [])];
  if (b.dataset.ch === 'again') {
    try {
      b.disabled = true;
      const r = await api(`/api/clips/${ID}/generate`, { method: 'POST', json: { what: 'chapters' } });
      S.clip.chapters = r.chapters;
      paintChapters();
      paintMarkers();
    } catch (err) {
      toast(err.message, 'bad');
      b.disabled = false;
    }
  }
  if (b.dataset.ch === 'add') {
    let at = Math.round(S.now * 100) / 100;
    while (ch.some((c) => Math.abs(c.at - at) < 1) && at < duration()) at += 1.5;
    const title = prompt('Name this chapter', '');
    if (title && title.trim()) saveChapters([...ch, { at: Math.min(at, duration()), title: title.trim().slice(0, 90) }]);
  }
  if (b.dataset.ch === 'del') {
    const i = Number(b.dataset.i);
    saveChapters(ch.filter((_, k) => k !== i));
  }
  if (b.dataset.ch === 'edit') {
    const i = Number(b.dataset.i);
    const c = ch[i];
    const li = b.closest('li');
    li.innerHTML = `<div class="cw-chedit"><input class="cw-tin cw-tin--t" value="${esc(fmtTime(edited(c.at)))}" aria-label="Chapter time" inputmode="numeric" /><input class="cw-tin" value="${esc(c.title)}" maxlength="90" aria-label="Chapter name" /><button type="button" class="cw-btn" data-chsave="${i}">Save</button><button type="button" class="cw-btn cw-btn--ghost" data-chcancel>Cancel</button></div>`;
    li.querySelector('input:last-of-type').focus();
  }
  const sv = e.target.closest('[data-chsave]');
  if (sv) {
    const i = Number(sv.dataset.chsave);
    const li = sv.closest('li');
    const [tIn, nIn] = $$('input', li);
    const t = parseClock(tIn.value);
    const ch2 = [...(S.clip.chapters || [])];
    ch2[i] = { at: t === null ? ch2[i].at : Math.max(0, Math.round(toSrc(t) * 100) / 100), title: nIn.value.trim() };
    saveChapters(ch2);
  }
  if (e.target.closest('[data-chcancel]')) paintChapters();
});

/* ------------------------------------------------------------------ the right panel */

function tabsFor() {
  const t = [{ id: 'transcript', label: 'Transcript' }];
  if (signedIn()) t.push({ id: 'comments', label: S.comments.length ? `Comments (${S.comments.length})` : 'Comments' });
  if (signedIn()) t.push({ id: 'activity', label: 'Activity' });
  if (isAdmin()) t.push({ id: 'article', label: 'Help article' });
  return t;
}

function paintTabs() {
  const box = $('#cw-tabs');
  if (!box) return;
  const tabs = tabsFor();
  if (!tabs.some((t) => t.id === S.tab)) S.tab = 'transcript';
  box.innerHTML = tabs.map((t) => `<button type="button" role="tab" aria-selected="${t.id === S.tab}" data-tab="${t.id}">${esc(t.label)}</button>`).join('');
}
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (!t) return;
  S.tab = t.dataset.tab;
  paintTabs();
  paintPanel();
});

function paintPanel() {
  const box = $('#cw-panel');
  if (!box) return;
  if (S.tab === 'transcript') return paintTranscript(box);
  if (S.tab === 'comments') return paintComments(box);
  if (S.tab === 'activity') return paintActivity(box);
  if (S.tab === 'article') return paintArticle(box);
}

/* ---- transcript ---- */

function paintTranscript(box) {
  const proc = S.clip.status === 'processing';
  if (!S.lines.length) {
    box.innerHTML = `<p class="cw-empty cw-empty--pad">${proc ? 'Writing the transcript. It appears here in a moment.' : S.clip.error ? esc(S.clip.error) : 'There is no transcript. Nothing was said, or the sound could not be read.'}</p>`;
    return;
  }
  const admin = isAdmin();
  box.innerHTML = `<div class="cw-trtools">
      <label class="cw-trsearch"><span class="cw-sr">Search the transcript</span><input id="cw-trq" type="search" placeholder="Search the transcript" value="${esc(S.q)}" /></label>
      <div class="cw-trbtns" role="toolbar" aria-label="Transcript tools">
        <button type="button" class="cw-btn cw-btn--ghost cw-btn--sm" data-tr="copy">${icon('copy')}Copy</button>
        <span class="cw-menuwrap"><button type="button" class="cw-btn cw-btn--ghost cw-btn--sm" data-tr="dlm" aria-haspopup="menu" aria-expanded="false">${icon('dl')}Download</button><ul class="cw-menu" role="menu" hidden id="cw-dlm"><li role="none"><button type="button" class="cw-mi" role="menuitem" data-tr="txt">Plain text (.txt)</button></li><li role="none"><button type="button" class="cw-mi" role="menuitem" data-tr="srt">Subtitles (.srt)</button></li></ul></span>
        ${langMenu()}
        ${admin && S.lang === 'orig' ? `<button type="button" class="cw-btn cw-btn--ghost cw-btn--sm${S.fixing ? ' is-on' : ''}" data-tr="fix" aria-pressed="${S.fixing}">${icon('pencil')}Fix the text</button>` : ''}
      </div></div>
    <div class="cw-lines" id="cw-lines">${linesHtml()}</div>${S.fixing ? `<div class="cw-fixbar"><button type="button" class="cw-btn" data-tr="fixsave">Save the text</button><button type="button" class="cw-btn cw-btn--ghost" data-tr="fixcancel">Cancel</button></div>` : ''}`;
  $('#cw-trq').addEventListener('input', (e) => {
    S.q = e.target.value;
    $('#cw-lines').innerHTML = linesHtml();
  });
}

function langMenu() {
  const have = Object.keys(S.translations).filter((k) => S.translations[k] && S.translations[k].length === S.lines.length);
  if (!isAdmin() && !have.length) return '';
  const items = ['orig', 'es', 'en'].filter((k) => k === 'orig' || isAdmin() || have.includes(k));
  return `<span class="cw-menuwrap"><button type="button" class="cw-btn cw-btn--ghost cw-btn--sm${S.lang !== 'orig' ? ' is-on' : ''}" data-tr="langm" aria-haspopup="menu" aria-expanded="false">${icon('lang')}${esc(LANG_NAMES[S.lang])}</button><ul class="cw-menu" role="menu" hidden id="cw-langm">${items.map((k) => `<li role="none"><button type="button" class="cw-mi" role="menuitemradio" aria-checked="${k === S.lang}" data-lang="${k}">${LANG_NAMES[k]}${k !== 'orig' && !have.includes(k) ? ' (write it)' : ''}</button></li>`).join('')}</ul></span>`;
}

function linesHtml() {
  const needle = S.q.trim().toLowerCase();
  const kept = new Set(S.words.filter((w) => !S.ranges.length || wordKept(w, S.ranges)).map((w) => w.i));
  const fillers = new Set(fillerIndexes(S.words));
  const byLine = new Map();
  for (const w of S.words) byLine.set(w.line, [...(byLine.get(w.line) || []), w]);
  const out = [];
  if (translated()) {
    shownLines().forEach((l, i) => {
      if (needle && !l.t.toLowerCase().includes(needle)) return;
      out.push(`<li data-line="${i}" class="cw-line"><button type="button" class="cw-t" data-seek="${l.s}" aria-label="Jump to ${fmtTime(edited(l.s))}">${fmtTime(edited(l.s))}</button><p><span data-seek="${l.s}">${esc(l.t)}</span></p></li>`);
    });
    return out.length ? `<ul>${out.join('')}</ul>` : '<p class="cw-empty cw-empty--pad">Nothing matches.</p>';
  }
  S.lines.forEach((l, i) => {
    const ws = byLine.get(i) || [];
    const text = ws.length ? ws.map((w) => w.t).join(' ') : l.t;
    if (needle && !text.toLowerCase().includes(needle)) return;
    if (S.fixing) {
      out.push(`<li data-line="${i}" class="cw-line cw-line--fix"><button type="button" class="cw-t" data-seek="${l.s}">${fmtTime(edited(l.s))}</button><textarea data-fix="${i}" rows="2" aria-label="Line at ${fmtTime(edited(l.s))}">${esc(l.t)}</textarea></li>`);
      return;
    }
    const body = ws.length
      ? ws.map((w) => `<span data-w="${w.i}" data-seek="${w.s}"${kept.has(w.i) ? '' : ' data-gone'}${fillers.has(w.i) ? ' data-filler' : ''}${needle && w.t.toLowerCase().includes(needle) ? ' data-hit' : ''}>${esc(w.t)}</span>`).join(' ')
      : `<span data-seek="${l.s}">${esc(l.t)}</span>`;
    out.push(`<li data-line="${i}" class="cw-line"><button type="button" class="cw-t" data-seek="${l.s}" aria-label="Jump to ${fmtTime(edited(l.s))}">${fmtTime(edited(l.s))}</button><p>${body}</p></li>`);
  });
  return out.length ? `<ul>${out.join('')}</ul>` : '<p class="cw-empty cw-empty--pad">Nothing matches.</p>';
}

let lastActive = -1;
let lastWord = -1;
function highlightTranscript() {
  if (S.tab !== 'transcript' || S.fixing) return;
  const box = $('#cw-lines');
  if (!box) return;
  const t = S.now;
  let a = -1;
  S.lines.forEach((l, i) => {
    if (l.s <= t + 0.05) a = i;
  });
  if (a !== lastActive) {
    const prev = box.querySelector('.cw-line.is-on');
    if (prev) prev.classList.remove('is-on');
    const el = box.querySelector(`[data-line="${a}"]`);
    if (el) {
      el.classList.add('is-on');
      if (!box.matches(':hover') && !S.q) {
        const top = el.offsetTop - box.clientHeight / 3;
        box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      }
    }
    lastActive = a;
  }
  const w = S.words.find((x) => x.s <= t && t < x.e);
  const wi = w ? w.i : -1;
  if (wi !== lastWord) {
    const prev = box.querySelector('[data-w].is-now');
    if (prev) prev.classList.remove('is-now');
    if (wi >= 0) {
      const el = box.querySelector(`[data-w="${wi}"]`);
      if (el) el.classList.add('is-now');
    }
    lastWord = wi;
  }
  // chapter highlight
  const ai = activeChapterIndex();
  const lis = $$('.cw-chlist li');
  lis.forEach((li, i) => li.classList.toggle('is-on', i === ai));
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-tr]');
  if (!b) return;
  const kind = b.dataset.tr;
  if (kind === 'copy') {
    const ok = await copyText(shownLines().map((l) => `${fmtTime(edited(l.s))}  ${l.t}`).join('\n'));
    toast(ok ? 'Transcript copied' : 'Could not copy', ok ? 'ok' : 'bad');
  }
  if (kind === 'dlm') {
    const m = $('#cw-dlm');
    const open = m.hidden;
    m.hidden = !open;
    b.setAttribute('aria-expanded', String(open));
  }
  if (kind === 'txt' || kind === 'srt') {
    $('#cw-dlm').hidden = true;
    const text = transcriptFile(shownLines(), S.ranges, kind);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: kind === 'txt' ? 'text/plain' : 'application/x-subrip' }));
    a.download = `${(S.clip.title || 'Transcript').replace(/[^\w\- ]+/g, '').trim() || 'Transcript'}.${kind}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  if (kind === 'langm') {
    const m = $('#cw-langm');
    const open = m.hidden;
    m.hidden = !open;
    b.setAttribute('aria-expanded', String(open));
  }
  if (kind === 'fix') {
    S.fixing = !S.fixing;
    paintPanel();
  }
  if (kind === 'fixcancel') {
    S.fixing = false;
    paintPanel();
  }
  if (kind === 'fixsave') {
    const lines = S.lines.map((l, i) => {
      const ta = $(`[data-fix="${i}"]`);
      return ta ? ta.value : l.t;
    });
    try {
      const r = await api(`/api/clips/${ID}`, { method: 'PATCH', json: { lines } });
      S.lines = r.transcript;
      S.wordsRaw = r.words;
      S.words = wordsOf(S.lines, S.wordsRaw);
      S.translations = {};
      S.lang = 'orig';
      S.fixing = false;
      paintPanel();
      toast('Transcript saved');
    } catch (err) {
      toast(err.message, 'bad');
    }
  }
});

document.addEventListener('click', async (e) => {
  const l = e.target.closest('[data-lang]');
  if (!l) return;
  const lang = l.dataset.lang;
  const have = S.translations[lang] && S.translations[lang].length === S.lines.length;
  const menu = $('#cw-langm');
  if (menu) menu.hidden = true;
  if (lang === 'orig' || have) {
    S.lang = lang;
    paintPanel();
    paintCaption();
    return;
  }
  if (!isAdmin()) return;
  try {
    toast('Writing the ' + LANG_NAMES[lang] + ' transcript. This takes a moment.');
    const r = await api(`/api/clips/${ID}/translate`, { method: 'POST', json: { lang } });
    S.translations[lang] = r.lines;
    S.lang = lang;
    paintPanel();
    paintCaption();
  } catch (err) {
    toast(err.message, 'bad');
  }
});

/* ---- comments tab ---- */

function paintComments(box) {
  const list = [...S.comments].sort((a, b) => a.at_seconds - b.at_seconds || a.created_at.localeCompare(b.created_at));
  box.innerHTML = list.length
    ? `<ul class="cw-comments">${list.map((c) => `<li data-c="${c.id}"><span class="cw-av">${esc(initials(c.author_name))}</span><div><p class="cw-cmeta"><b>${esc(firstName(c.author_name))}</b> · ${esc(ago(c.created_at))} <button type="button" class="cw-t" data-seek="${c.at_seconds}" aria-label="Jump to ${fmtTime(edited(c.at_seconds))}">${fmtTime(edited(c.at_seconds))}</button></p><p class="cw-cbody">${esc(c.body)}</p></div>${c.author_email === S.user.email || isAdmin() ? `<button type="button" class="cw-ib2" data-cdel="${c.id}" aria-label="Delete comment">${icon('x')}</button>` : ''}</li>`).join('')}</ul>`
    : '<p class="cw-empty cw-empty--pad">No comments yet. Pause where you want to say something, then write it under the video.</p>';
}
document.addEventListener('click', async (e) => {
  const d = e.target.closest('[data-cdel]');
  if (!d) return;
  try {
    await api(`/api/clips/${ID}/comments?cid=${d.dataset.cdel}`, { method: 'DELETE' });
    S.comments = S.comments.filter((c) => c.id !== d.dataset.cdel);
    paintReact();
    paintMarkers();
    paintTabs();
    paintPanel();
  } catch (err) {
    toast(err.message, 'bad');
  }
});

/* ---- activity tab ---- */

function paintActivity(box) {
  const len = duration() || 1;
  const viewers = S.viewers;
  const reacts = [...S.reactions].sort((a, b) => b.created_at.localeCompare(a.created_at));
  box.innerHTML = `<div class="cw-act">
    <h3>Who watched</h3>
    ${viewers.length ? `<ul class="cw-vlist">${viewers.map((v) => {
      const pct = Math.min(100, Math.round((v.seconds / len) * 100));
      return `<li><span class="cw-av">${esc(initials(v.name))}</span><div><b>${esc(v.name)}</b><p>Watched ${pct}% (${fmtTime(v.seconds)})${v.plays > 1 ? `, ${v.plays} times` : ''} · ${esc(ago(v.at))}</p><div class="cw-vbar"><i style="width:${pct}%"></i></div></div></li>`;
    }).join('')}</ul>` : '<p class="cw-empty">Nobody else has watched this yet.</p>'}
    <h3>Reactions${reacts.length ? ` <em>${reacts.length}</em>` : ''}</h3>
    ${reacts.length ? `<ul class="cw-vlist">${reacts.map((r) => `<li><span class="cw-av">${esc(initials(r.person_name))}</span><div><p><b>${r.person_email === S.user.email ? 'You' : esc(firstName(r.person_name))}</b> reacted <span aria-hidden="true">${r.emoji}</span> · ${esc(ago(r.created_at))}</p></div><button type="button" class="cw-t" data-seek="${r.at_seconds}">${fmtTime(edited(r.at_seconds))}</button></li>`).join('')}</ul>` : '<p class="cw-empty">No reactions yet.</p>'}
  </div>`;
}

/* ---- help article tab ---- */

function paintArticle(box) {
  const have = S.helpDraft;
  box.innerHTML = `<div class="cw-art">
    <p class="cw-sub">Writes a draft help article from what was said.</p>
    <div class="cw-editb"><button type="button" class="cw-btn" id="cw-artmake" ${S.lines.length ? '' : 'disabled'}>${icon('wand')}<span>${have ? 'Write it again' : 'Draft a help article'}</span></button></div>
    ${have ? `<textarea class="cw-edit cw-edit--art" id="cw-artin" rows="18" aria-label="Help article draft">${esc(have)}</textarea>
    <div class="cw-editb"><button type="button" class="cw-btn cw-btn--ghost" id="cw-artcopy">${icon('copy')}Copy</button><button type="button" class="cw-btn cw-btn--ghost" id="cw-artdl">${icon('dl')}Download .md</button><button type="button" class="cw-btn cw-btn--ghost" id="cw-artsave">Save changes</button></div>` : ''}
    ${S.lines.length ? '' : '<p class="cw-empty">There is no transcript to write from yet.</p>'}
  </div>`;
  const make = $('#cw-artmake');
  if (make)
    make.addEventListener('click', async () => {
      make.disabled = true;
      make.querySelector('span').textContent = 'Writing the article';
      try {
        const r = await api(`/api/clips/${ID}/article`, { method: 'POST', json: {} });
        S.helpDraft = r.markdown;
        paintArticle(box);
      } catch (err) {
        toast(err.message, 'bad');
        make.disabled = false;
        make.querySelector('span').textContent = have ? 'Write it again' : 'Draft a help article';
      }
    });
  const cp = $('#cw-artcopy');
  if (cp) {
    cp.addEventListener('click', async () => toast((await copyText($('#cw-artin').value)) ? 'Article copied' : 'Could not copy', 'ok'));
    $('#cw-artdl').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([$('#cw-artin').value], { type: 'text/markdown' }));
      const slug = (S.clip.title || 'clip').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'clip';
      a.download = `${slug}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
    $('#cw-artsave').addEventListener('click', async () => {
      try {
        await api(`/api/clips/${ID}/article`, { method: 'PUT', json: { markdown: $('#cw-artin').value } });
        S.helpDraft = $('#cw-artin').value;
        toast('Draft saved');
      } catch (err) {
        toast(err.message, 'bad');
      }
    });
  }
}

load(true);
