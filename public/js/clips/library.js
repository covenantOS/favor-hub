// Clips: the library page (/clips/). A quiet grid of clips with search over titles, summaries and what was said.
import { api, copyText, esc, et, fmtTime, toast } from './core.js';

const $ = (id) => document.getElementById(id);
const linkFor = (id) => `${location.origin}/c/${id}`;
const HOVER_SECONDS = 6;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let rows = [];
let who = 'all';
let q = '';
let timer = 0;
let poll = 0;

function cardHtml(c) {
  const when = et(c.created_at, { month: 'short', day: 'numeric', year: 'numeric' });
  const views = Number(c.views) === 1 ? '1 view' : `${Number(c.views).toLocaleString('en-US')} views`;
  const thumb = c.has_poster ? `<img src="/api/clips/${c.id}/media?poster=1" alt="" loading="lazy" />` : '';
  const dur = c.duration_ms ? `<b>${fmtTime(c.duration_ms / 1000)}</b>` : '';
  const naming = c.status === 'processing' ? '<span class="cl-badge">Writing the title</span>' : '';
  const sum = c.summary ? `<p class="cl-sum">${esc(c.summary)}</p>` : '';
  const hit = c.match ? `<a class="cl-hit" href="/c/${c.id}?t=${Math.floor(c.match.at)}"><span>${fmtTime(c.match.at)}</span>${esc(c.match.text)}</a>` : '';
  return `<article class="h-card cl-card" data-id="${c.id}">
    <a class="cl-thumb" href="/c/${c.id}" aria-label="Open ${esc(c.title || 'clip')}" data-thumb>${thumb}${dur}${naming}</a>
    <div class="cl-body">
      <div class="cl-name"><a href="/c/${c.id}">${esc(c.title || 'Untitled clip')}</a></div>
      <div class="cl-meta"><span>${esc(c.owner_name)}</span><span>${esc(when)}</span><span>${views}</span></div>
      ${sum}${hit}
    </div>
    <div class="cl-acts">
      <label class="cl-switch"><input type="checkbox" data-act="share" ${c.share ? 'checked' : ''} /><i></i><span>Anyone with the link</span></label>
      <span class="cl-btns">
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-act="copy">Copy link</button>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-act="rename">Rename</button>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm cl-danger" data-act="delete">Delete</button>
      </span>
    </div>
  </article>`;
}

function paint() {
  const box = $('cl-rows');
  box.removeAttribute('aria-busy');
  $('cl-count-label').textContent = rows.length ? (rows.length === 1 ? '1 clip' : `${rows.length} clips`) : '';
  if (rows.length) {
    box.className = 'cl-grid';
    box.innerHTML = rows.map(cardHtml).join('');
  } else {
    box.className = '';
    box.innerHTML = `<div class="h-card cl-empty">${q ? 'No clip matches that search.' : who === 'mine' ? 'You have not recorded a clip yet. Press the camera at the top right of any page.' : 'No clips yet. Press the camera at the top right of any page to record the first one.'}</div>`;
  }
  clearTimeout(poll);
  if (rows.some((c) => c.status === 'processing')) poll = setTimeout(() => load(true), 4000);
}

async function load(quiet) {
  try {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (who === 'mine') p.set('mine', '1');
    const d = await api(`/api/clips?${p}`);
    rows = d.clips || [];
    paint();
  } catch (e) {
    $('cl-rows').removeAttribute('aria-busy');
    if (e.status === 403) {
      $('cl-rows').innerHTML = '<div class="h-card cl-empty">Clips is for hub admins for now.</div>';
      $('cl-new').hidden = true;
    } else if (!quiet) {
      $('cl-rows').innerHTML = '<div class="h-card cl-empty">Your clips did not load. Refresh the page to try again.</div>';
    }
  }
}

/* hover preview: the first few seconds of the file, muted, in a loop, over the poster */
let current = null;
function stopPreview() {
  if (!current) return;
  clearTimeout(current.t);
  if (current.v) current.v.remove();
  current = null;
}
function startPreview(thumb) {
  if (reduced()) return;
  const id = thumb.closest('[data-id]').dataset.id;
  stopPreview();
  const t = setTimeout(() => {
    const v = document.createElement('video');
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.className = 'cl-prev';
    v.src = `/api/clips/${id}/media#t=0,${HOVER_SECONDS}`;
    v.addEventListener('timeupdate', () => {
      if (v.currentTime >= HOVER_SECONDS) v.currentTime = 0;
    });
    v.addEventListener('playing', () => v.classList.add('is-on'));
    thumb.prepend(v);
    v.play().catch(() => undefined);
    current.v = v;
  }, 280);
  current = { t, v: null };
}

function wire() {
  const box = $('cl-rows');
  box.addEventListener('pointerover', (e) => {
    const th = e.target.closest('[data-thumb]');
    if (th && (!current || !th.contains(current.v))) startPreview(th);
  });
  box.addEventListener('pointerout', (e) => {
    const th = e.target.closest('[data-thumb]');
    if (th && !th.contains(e.relatedTarget)) stopPreview();
  });
  box.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const card = btn.closest('.cl-card');
    const clip = rows.find((c) => c.id === card.dataset.id);
    if (!clip) return;
    if (btn.dataset.act === 'copy') toast((await copyText(linkFor(clip.id))) ? 'Link copied' : 'Could not copy the link');
    if (btn.dataset.act === 'rename') {
      const slot = card.querySelector('.cl-name');
      slot.innerHTML = `<input class="cl-rename" type="text" maxlength="120" value="${esc(clip.title)}" aria-label="Clip title" /><button type="button" class="h-btn h-btn--primary h-btn--sm" data-act="save">Save</button>`;
      const input = slot.querySelector('input');
      input.focus();
      input.select();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') slot.querySelector('[data-act=save]').click();
        if (e.key === 'Escape') paint();
      });
    }
    if (btn.dataset.act === 'save') {
      const title = card.querySelector('.cl-rename').value.trim();
      if (!title) return;
      try {
        await api(`/api/clips/${clip.id}`, { method: 'PATCH', json: { title } });
        clip.title = title;
        paint();
        toast('Renamed');
      } catch (e) {
        toast(e.message, 'bad');
      }
    }
    if (btn.dataset.act === 'delete') {
      if (!confirm(`Delete "${clip.title}"? The link stops working and the video is removed for good.`)) return;
      try {
        await api(`/api/clips/${clip.id}`, { method: 'DELETE' });
        rows = rows.filter((c) => c.id !== clip.id);
        paint();
        toast('Clip deleted');
      } catch (e) {
        toast(e.message, 'bad');
      }
    }
  });
  box.addEventListener('change', async (ev) => {
    const sw = ev.target.closest('[data-act=share]');
    if (!sw) return;
    const clip = rows.find((c) => c.id === sw.closest('.cl-card').dataset.id);
    const on = sw.checked;
    try {
      await api(`/api/clips/${clip.id}`, { method: 'PATCH', json: { share: on } });
      clip.share = on ? 1 : 0;
      toast(on ? 'Anyone with the link can watch' : 'Only signed-in Favor staff can watch');
    } catch (e) {
      sw.checked = !on;
      toast(e.message, 'bad');
    }
  });
  $('cl-q').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      q = $('cl-q').value.trim();
      load();
    }, 250);
  });
  document.querySelectorAll('.cl-chip').forEach((b) =>
    b.addEventListener('click', () => {
      who = b.dataset.who;
      document.querySelectorAll('.cl-chip').forEach((x) => {
        x.classList.toggle('is-on', x === b);
        x.setAttribute('aria-pressed', String(x === b));
      });
      load();
    })
  );
  $('cl-new').addEventListener('click', () => {
    const b = document.getElementById('clip-cam');
    if (b && !b.hidden) b.click();
    else toast('The camera button at the top right opens the recorder.');
  });
  window.addEventListener('clips:changed', () => load(true));
}

wire();
load();
