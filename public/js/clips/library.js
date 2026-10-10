// Clips: the library page (/clips/). A quiet grid of clips with search over titles, summaries and what was said.
import { api, ask, copyText, esc, et, fmtTime, toast } from './core.js';

const $ = (id) => document.getElementById(id);
const linkFor = (id) => `${location.origin}/c/${id}`;
const HOVER_SECONDS = 6;
const fmtBytes = (n) => {
  const b = Number(n) || 0;
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  if (b >= 1024 ** 2) return `${Math.round(b / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
};
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const SCOPE = ($('cl') && $('cl').dataset.scope) || 'mine';
const ADMIN_VIEW = SCOPE === 'all';
let rows = [];
let people = [];
let usage = null;
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
      <div class="cl-meta">${ADMIN_VIEW ? `<span><b>${esc(c.owner_name)}</b>${c.owner_team ? ` (${esc(c.owner_team)})` : ''}</span>` : ''}<span>${esc(when)}</span><span>${views}</span>${c.size_bytes ? `<span>${esc(fmtBytes(c.size_bytes))}</span>` : ''}</div>
      ${sum}${hit}
    </div>
    <div class="cl-acts">
      ${c.mine ? `<label class="cl-switch"><input type="checkbox" data-act="share" ${c.share ? 'checked' : ''} /><i></i><span>Anyone with the link</span></label>` : ''}
      <span class="cl-btns">
        ${c.mine ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-act="copy">Copy link</button>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-act="rename">Rename</button>` : `<a class="h-btn h-btn--ghost h-btn--sm" href="/c/${c.id}">Open</a>`}
        <button type="button" class="h-btn h-btn--ghost h-btn--sm cl-danger" data-act="delete">Delete</button>
      </span>
    </div>
  </article>`;
}

function paintUsage() {
  const box = $('cl-usage');
  if (!box) return;
  if (ADMIN_VIEW) {
    box.hidden = !people.length;
    const cap = 10 * 1024 ** 3;
    box.innerHTML = people.length
      ? `<div class="cl-ppl" role="table" aria-label="Storage by person"><div class="cl-ppl__h" role="row"><span>Person</span><span>Clips</span><span>Storage</span><span>Of 10 GB</span></div>${people
          .map((p) => `<div class="cl-ppl__r" role="row"><span><b>${esc(p.name || p.email)}</b>${p.team ? ` <em>${esc(p.team)}</em>` : ''}${p.blocked ? ' <i class="cl-tag">Blocked</i>' : ''}<small>${esc(p.email)}</small></span><span>${Number(p.clips)}</span><span>${esc(fmtBytes(p.bytes))}</span><span><i class="cl-meter${p.bytes >= cap * 0.8 ? ' is-warn' : ''}"><u style="width:${Math.min(100, Math.round((p.bytes / cap) * 100))}%"></u></i></span></div>`)
          .join('')}</div>`
      : '';
    return;
  }
  if (!usage) return (box.hidden = true);
  box.hidden = false;
  const old = (usage.oldestUnwatched || [])
    .map((c) => `<li data-id="${c.id}"><a href="/c/${c.id}">${esc(c.title || 'Untitled clip')}</a><span>${esc(et(c.created_at, { month: 'short', day: 'numeric', year: 'numeric' }))} · ${esc(fmtBytes(c.size_bytes))}</span><button type="button" class="h-btn h-btn--ghost h-btn--sm cl-danger" data-act="delete-old">Delete</button></li>`)
    .join('');
  box.innerHTML = `<div class="cl-use${usage.warn ? ' is-warn' : ''}"><div class="cl-use__t"><b>${esc(fmtBytes(usage.used))}</b> of ${esc(fmtBytes(usage.cap))} used by ${usage.clips === 1 ? '1 clip' : `${usage.clips} clips`}</div><i class="cl-meter${usage.warn ? ' is-warn' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${usage.pct}"><u style="width:${usage.pct}%"></u></i>
    ${usage.warn ? `<p class="cl-use__w">${usage.full ? 'Your clips use all of your space, so new recordings wait until you delete some.' : 'You are past 80% of your space.'} These are your oldest clips that nobody has watched.</p>${old ? `<ul class="cl-old">${old}</ul>` : '<p class="cl-use__w">Every clip you have was watched. Delete the ones you no longer need.</p>'}` : ''}</div>`;
}

function paint() {
  paintUsage();
  const box = $('cl-rows');
  box.removeAttribute('aria-busy');
  $('cl-count-label').textContent = rows.length ? (rows.length === 1 ? '1 clip' : `${rows.length} clips`) : '';
  if (rows.length) {
    box.className = 'cl-grid';
    box.innerHTML = rows.map(cardHtml).join('');
  } else {
    box.className = '';
    box.innerHTML = `<div class="h-card cl-empty">${q ? 'No clip matches that search.' : ADMIN_VIEW ? 'No clips have been recorded yet.' : 'You have not recorded a clip yet. Press the camera at the top right of any page to record your first one.'}</div>`;
  }
  clearTimeout(poll);
  if (rows.some((c) => c.status === 'processing')) poll = setTimeout(() => load(true), 4000);
}

async function load(quiet) {
  try {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (ADMIN_VIEW) p.set('scope', 'all');
    const d = await api(`/api/clips?${p}`);
    rows = d.clips || [];
    people = d.people || [];
    usage = d.usage || null;
    paint();
  } catch (e) {
    $('cl-rows').removeAttribute('aria-busy');
    if (e.status === 403) {
      $('cl-rows').innerHTML = '<div class="h-card cl-empty">This view is for hub admins.</div>';
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
    if (!card) return;
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
      if (!(await ask({ title: clip.mine ? 'Delete this clip?' : `Delete ${clip.owner_name}'s clip?`, body: `"${clip.title || 'Untitled clip'}" is removed for good. The link stops working, and its comments go with it.`, ok: 'Delete clip' }))) return;
      try {
        await api(`/api/clips/${clip.id}`, { method: 'DELETE' });
        rows = rows.filter((c) => c.id !== clip.id);
        paint();
        toast('Clip deleted');
        load(true);
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
  const nb = $('cl-new');
  if (nb) {
    nb.addEventListener('click', () => {
      const b = document.getElementById('clip-cam');
      if (b && !b.hidden) b.click();
      else toast('The camera button at the top right opens the recorder.');
    });
  }
  // Deleting one of the oldest clips nobody watched, from the storage note.
  const useBox = $('cl-usage');
  if (useBox) {
    useBox.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-act=delete-old]');
      if (!b) return;
      const li = b.closest('li');
      const c = (usage.oldestUnwatched || []).find((x) => x.id === li.dataset.id);
      if (!c) return;
      if (!(await ask({ title: 'Delete this clip?', body: `"${c.title || 'Untitled clip'}" is removed for good. The link stops working, and its comments go with it.`, ok: 'Delete clip' }))) return;
      try {
        await api(`/api/clips/${c.id}`, { method: 'DELETE' });
        toast('Clip deleted');
        load(true);
      } catch (e) {
        toast(e.message, 'bad');
      }
    });
  }
  window.addEventListener('clips:changed', () => load(true));
}

wire();
load();
