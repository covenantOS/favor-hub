// Clips: the library page (/clips/). A quiet grid of clips with search over titles, summaries and what was said.
import { api, ask, copyText, esc, et, fmtTime, toast } from './core.js';
import { openShare, levelLabel, levelOfClip, publicBadge } from './sharesheet.js';

const $ = (id) => document.getElementById(id);
const linkFor = (id) => `${location.origin}/c/${id}`;
// A clip as an item for the email composer (public/js/compose/compose.js): "Send to email" and dragging a card onto a draft.
const emailItem = (c) => ({ kind: 'clip', title: c.title || 'Clip', url: linkFor(c.id), sub: c.duration_ms ? fmtTime(c.duration_ms / 1000) : '', text: c.summary || '' });
document.addEventListener('dragstart', (e) => {
  const card = e.target.closest && e.target.closest('.cl-card[draggable="true"]');
  if (!card || !e.dataTransfer) return;
  const clip = rows.find((c) => c.id === card.dataset.id);
  if (!clip) return;
  e.dataTransfer.setData('application/x-favoros-item', JSON.stringify(emailItem(clip)));
  e.dataTransfer.setData('text/uri-list', linkFor(clip.id));
  e.dataTransfer.setData('text/plain', linkFor(clip.id));
  e.dataTransfer.effectAllowed = 'copy';
});
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
let peopleCap = 0;
let usage = null;
let q = '';
let timer = 0;
let poll = 0;
let sort = 'new';
let filter = 'all';
let picking = false;
// A long library draws 60 clips at a time.
const PAGE = 60;
let limit = PAGE;
const picked = new Set();

const SORTS = {
  new: (a, b) => String(b.created_at).localeCompare(String(a.created_at)),
  old: (a, b) => String(a.created_at).localeCompare(String(b.created_at)),
  views: (a, b) => Number(b.views) - Number(a.views) || String(b.created_at).localeCompare(String(a.created_at)),
  title: (a, b) => String(a.title || 'Untitled clip').localeCompare(String(b.title || 'Untitled clip'), 'en', { sensitivity: 'base' }),
  size: (a, b) => Number(b.size_bytes) - Number(a.size_bytes),
  person: (a, b) => String(a.owner_name || '').localeCompare(String(b.owner_name || ''), 'en', { sensitivity: 'base' }) || String(b.created_at).localeCompare(String(a.created_at)),
};
/** The rows on screen: the search result, narrowed by the Shared / Private chip, in the chosen order. */
const shown = () => rows.filter((c) => (filter === 'shared' ? levelOfClip(c) !== 'private' : filter === 'private' ? levelOfClip(c) === 'private' : true)).sort(SORTS[sort] || SORTS.new);

function cardHtml(c) {
  const when = et(c.created_at, { month: 'short', day: 'numeric', year: 'numeric' });
  const views = Number(c.views) === 1 ? '1 view' : `${Number(c.views).toLocaleString('en-US')} views`;
  const thumb = c.has_poster ? `<img src="/api/clips/${c.id}/media?poster=1" alt="" loading="lazy" onerror="this.remove()" />` : '';
  const dur = c.duration_ms ? `<b>${fmtTime(c.duration_ms / 1000)}</b>` : '';
  const naming = c.status === 'processing' ? '<span class="cl-badge">Writing the title</span>' : '';
  const sum = c.summary ? `<p class="cl-sum">${esc(c.summary)}</p>` : '';
  const hit = c.match ? `<a class="cl-hit" href="/c/${c.id}?t=${Math.floor(c.match.at)}"><span>${fmtTime(c.match.at)}</span><span class="cl-hit__t">${esc(c.match.text)}</span></a>` : '';
  const on = picked.has(c.id);
  return `<article class="h-card cl-card${picking ? ' is-picking' : ''}${on ? ' is-picked' : ''}" data-id="${c.id}"${picking ? '' : ' draggable="true"'}>
    ${picking ? `<button type="button" class="cl-pick" data-act="pick" role="checkbox" aria-checked="${on}" aria-label="Select ${esc(c.title || 'clip')}"><i></i></button>` : ''}
    <a class="cl-thumb" href="/c/${c.id}" aria-label="Open ${esc(c.title || 'clip')}" data-thumb>${thumb}${dur}${naming}${levelOfClip(c) === 'public' ? `<span class="cl-pubmark">${publicBadge('public')}</span>` : ''}</a>
    <div class="cl-body">
      <div class="cl-name"><a href="/c/${c.id}">${esc(c.title || 'Untitled clip')}</a></div>
      <div class="cl-meta">${ADMIN_VIEW ? `<span><b>${esc(c.owner_name)}</b>${c.owner_team ? ` (${esc(c.owner_team)})` : ''}</span>` : ''}<span>${esc(when)}</span><span>${views}</span>${c.size_bytes ? `<span>${esc(fmtBytes(c.size_bytes))}</span>` : ''}</div>
      ${sum}${hit}
    </div>
    <div class="cl-acts">
      ${c.mine ? `<button type="button" class="cl-lvl cl-lvl--${levelOfClip(c)}" data-act="share" aria-label="Who can watch: ${esc(levelLabel(levelOfClip(c)))}. Change" title="Change who can watch">${esc(levelLabel(levelOfClip(c)))}</button>` : `<span class="cl-lvl cl-lvl--${levelOfClip(c)}">${esc(levelLabel(levelOfClip(c)))}</span>`}
      <span class="cl-btns">
        ${c.status === 'ready' && window.FavorCompose && document.documentElement.classList.contains('has-mail') ? '<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-act="email" title="Add this clip to an email (or drag the card onto one)">Send to email</button>' : ''}
        ${c.mine ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-act="copy">Copy link</button>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-act="rename">Rename</button>
        ${c.status === 'ready' ? `<a class="h-btn h-btn--ghost h-btn--sm" href="/c/${c.id}?make=article" title="Draft a help article from this clip">Help article</a><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-act="lesson" title="Make a draft Learn course from this clip">Learn lesson</button>` : ''}` : `<a class="h-btn h-btn--ghost h-btn--sm" href="/c/${c.id}">Open</a>`}
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
    const cap = peopleCap || 10 * 1024 ** 3;
    box.innerHTML = people.length
      ? `<div class="cl-ppl" role="table" aria-label="Storage by person"><div class="cl-ppl__h" role="row"><span>Person</span><span>Clips</span><span>Storage</span><span>Of ${esc(fmtBytes(cap))}</span></div>${people
          .map((p) => `<div class="cl-ppl__r" role="row"><span><b>${esc(p.name || p.email)}</b>${p.team ? ` <em>${esc(p.team)}</em>` : ''}${p.blocked ? ' <i class="cl-tag">Blocked</i>' : ''}<small>${esc(p.email)}</small></span><span>${Number(p.clips).toLocaleString('en-US')}</span><span>${esc(fmtBytes(p.bytes))}</span><span><i class="cl-meter${p.bytes >= cap * 0.8 ? ' is-warn' : ''}"><u style="width:${Math.min(100, Math.round((p.bytes / cap) * 100))}%"></u></i></span></div>`)
          .join('')}</div>`
      : '';
    return;
  }
  if (!usage || !usage.clips) return (box.hidden = true);
  box.hidden = false;
  const old = (usage.oldestUnwatched || [])
    .map((c) => `<li data-id="${c.id}"><a href="/c/${c.id}">${esc(c.title || 'Untitled clip')}</a><span>${esc(et(c.created_at, { month: 'short', day: 'numeric', year: 'numeric' }))} · ${esc(fmtBytes(c.size_bytes))}</span><button type="button" class="h-btn h-btn--ghost h-btn--sm cl-danger" data-act="delete-old">Delete</button></li>`)
    .join('');
  box.innerHTML = `<div class="cl-use${usage.warn ? ' is-warn' : ''}"><div class="cl-use__t"><b>${esc(fmtBytes(usage.used))}</b> of ${esc(fmtBytes(usage.cap))} used</div><i class="cl-meter${usage.warn ? ' is-warn' : ''}" role="progressbar" aria-label="Storage used" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${usage.pct}"><u style="width:${usage.pct}%"></u></i>
    ${usage.warn ? `<p class="cl-use__w">${usage.full ? 'Your clips use all of your space, so new recordings wait until you delete some.' : 'You are past 80% of your space.'} These are your oldest clips that nobody has watched.</p>${old ? `<ul class="cl-old">${old}</ul>` : '<p class="cl-use__w">Every clip you have was watched. Delete the ones you no longer need.</p>'}` : ''}</div>`;
}

function paint() {
  paintUsage();
  const box = $('cl-rows');
  box.removeAttribute('aria-busy');
  const list = shown();
  for (const id of [...picked]) if (!rows.some((c) => c.id === id)) picked.delete(id);
  $('cl-count-label').textContent = list.length ? (list.length === 1 ? '1 clip' : `${list.length.toLocaleString('en-US')} clips`) : '';
  if (list.length) {
    box.className = 'cl-grid';
    const left = list.length - limit;
    box.innerHTML = list.slice(0, limit).map(cardHtml).join('') + (left > 0 ? `<div class="cl-more"><button type="button" class="h-btn h-btn--ghost" data-act="more">Show ${Math.min(PAGE, left)} more</button><span>${left.toLocaleString('en-US')} not shown</span></div>` : '');
  } else {
    box.className = '';
    box.innerHTML = rows.length
      ? `<div class="h-card cl-empty">No ${filter} clips.</div>`
      : `<div class="h-card cl-empty">${q ? 'No clip matches that search.' : ADMIN_VIEW ? 'No clips have been recorded yet.' : 'No clips yet.'}</div>`;
  }
  paintSel();
  clearTimeout(poll);
  if (rows.some((c) => c.status === 'processing')) poll = setTimeout(() => load(true), 4000);
}

function paintSel() {
  const bar = $('cl-selbar');
  const btn = $('cl-select');
  if (btn) {
    btn.textContent = picking ? 'Done' : 'Select';
    btn.setAttribute('aria-pressed', String(picking));
  }
  if (!bar) return;
  bar.hidden = !picking;
  if (!picking) return;
  const n = picked.size;
  const mineOnly = [...picked].every((id) => (rows.find((c) => c.id === id) || {}).mine);
  $('cl-selcount').textContent = n ? (n === 1 ? '1 selected' : `${n} selected`) : 'Nothing selected';
  bar.querySelectorAll('button[data-sel]').forEach((b) => {
    const s = b.dataset.sel;
    b.disabled = s === 'all' ? false : !n || (b.hasAttribute('data-need-mine') && !mineOnly);
    if (s === 'all') b.textContent = n && n >= shown().length ? 'Select none' : 'Select all';
  });
}

async function bulk(kind) {
  const ids = [...picked];
  if (!ids.length) return;
  if (kind === 'delete') {
    const n = ids.length;
    if (!(await ask({ title: n === 1 ? 'Delete this clip?' : `Delete ${n} clips?`, body: n === 1 ? 'The clip is removed for good. The link stops working, and its comments go with it.' : `These ${n} clips are removed for good. Their links stop working, and their comments go with them.`, ok: n === 1 ? 'Delete clip' : `Delete ${n} clips` }))) return;
  }
  let failed = 0;
  for (const id of ids) {
    try {
      if (kind === 'delete') await api(`/api/clips/${id}`, { method: 'DELETE' });
      else await api(`/api/clips/${id}`, { method: 'PATCH', json: { access: kind } });
      const c = rows.find((x) => x.id === id);
      if (kind === 'delete') {
        rows = rows.filter((x) => x.id !== id);
        picked.delete(id);
      } else if (c) { c.level = kind; c.share = 0; c.staff_link = kind === 'staff' ? 1 : 0; }
    } catch (e) {
      failed += 1;
    }
  }
  if (kind === 'delete' && !picked.size) picking = false;
  paint();
  toast(failed ? `${failed} could not be changed` : kind === 'delete' ? (ids.length === 1 ? 'Clip deleted' : `${ids.length} clips deleted`) : `Who can watch is now ${levelLabel(kind)}`, failed ? 'bad' : undefined);
  if (kind === 'delete') load(true);
}

async function load(quiet) {
  try {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (ADMIN_VIEW) p.set('scope', 'all');
    const d = await api(`/api/clips?${p}`);
    rows = d.clips || [];
    people = d.people || [];
    peopleCap = Number(d.cap) || 0;
    usage = d.usage || null;
    paint();
  } catch (e) {
    $('cl-rows').removeAttribute('aria-busy');
    if (e.status === 403) {
      $('cl-rows').innerHTML = '<div class="h-card cl-empty">This view is for FavorOS admins.</div>';
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
  // A poster that is missing leaves the plain dark tile, never a broken-picture mark.
  box.addEventListener('error', (e) => {
    if (e.target && e.target.tagName === 'IMG') e.target.remove();
  }, true);
  box.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act=more]')) return;
    limit += PAGE;
    paint();
  });
  box.addEventListener('pointerover', (e) => {
    const th = e.target.closest('[data-thumb]');
    if (th && (!current || !th.contains(current.v))) startPreview(th);
  });
  box.addEventListener('pointerout', (e) => {
    const th = e.target.closest('[data-thumb]');
    if (th && !th.contains(e.relatedTarget)) stopPreview();
  });
  box.addEventListener('click', (ev) => {
    if (!picking) return;
    const card = ev.target.closest('.cl-card');
    if (!card || ev.target.closest('.cl-rename, [data-act=save]')) return;
    if (ev.target.closest('.cl-switch, button[data-act]:not([data-act=pick])')) return;
    // In selection mode a tap on the card, its picture or its title selects it instead of opening it.
    ev.preventDefault();
    ev.stopImmediatePropagation();
    const id = card.dataset.id;
    if (picked.has(id)) picked.delete(id);
    else picked.add(id);
    card.classList.toggle('is-picked', picked.has(id));
    const pk = card.querySelector('.cl-pick');
    if (pk) pk.setAttribute('aria-checked', String(picked.has(id)));
    paintSel();
  }, true);
  const selBtn = $('cl-select');
  if (selBtn) selBtn.addEventListener('click', () => {
    picking = !picking;
    if (!picking) picked.clear();
    paint();
  });
  const bar = $('cl-selbar');
  if (bar) bar.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-sel]');
    if (!b || b.disabled) return;
    if (b.dataset.sel === 'all') {
      const list = shown();
      if (picked.size >= list.length) picked.clear();
      else list.forEach((c) => picked.add(c.id));
      paint();
    } else bulk(b.dataset.sel);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && picking && !ev.defaultPrevented && !document.querySelector('.cl-askback')) {
      picking = false;
      picked.clear();
      paint();
    }
  });
  const sortEl = $('cl-sort');
  if (sortEl) sortEl.addEventListener('change', () => {
    sort = sortEl.value;
    limit = PAGE;
    paint();
  });
  document.querySelectorAll('.cl-chip[data-f]').forEach((chip) => chip.addEventListener('click', () => {
    filter = chip.dataset.f;
    limit = PAGE;
    document.querySelectorAll('.cl-chip[data-f]').forEach((x) => {
      x.classList.toggle('is-on', x === chip);
      x.setAttribute('aria-pressed', String(x === chip));
    });
    paint();
  }));
  box.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const card = btn.closest('.cl-card');
    if (!card) return;
    const clip = rows.find((c) => c.id === card.dataset.id);
    if (!clip) return;
    if (btn.dataset.act === 'share') return openShare(clip.id, { onChange: ({ level }) => { clip.level = level; clip.share = level === 'public' ? 1 : 0; clip.staff_link = level === 'staff' ? 1 : 0; paint(); } });
    if (btn.dataset.act === 'copy') toast((await copyText(linkFor(clip.id))) ? 'Link copied' : 'Could not copy the link');
    if (btn.dataset.act === 'email' && window.FavorCompose) {
      await window.FavorCompose.add(emailItem(clip));
      if (!clip.share) toast('People outside FavorOS need "Anyone with the link" on to watch it');
    }
    if (btn.dataset.act === 'lesson') {
      btn.disabled = true;
      try {
        const r = await api(`/api/clips/${clip.id}/lesson`, { method: 'POST', json: {} });
        toast(`Draft course made. It opens in Learn.`);
        setTimeout(() => { location.href = r.url; }, 700);
      } catch (err) {
        toast(err.message, 'bad');
        btn.disabled = false;
      }
    }
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
  $('cl-q').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      q = $('cl-q').value.trim();
      limit = PAGE;
      load();
    }, 250);
  });
  document.addEventListener('click', (ev) => { if (ev.target.closest('[data-act=empty-record]')) { const n = $('cl-new'); if (n) n.click(); } });
  const nb = $('cl-new');
  if (nb) {
    nb.addEventListener('click', () => {
      const b = document.getElementById('clip-cam');
      if (b && !b.hidden) b.click();
      else window.open('/clips/rec/', 'clip-recorder', 'popup,width=440,height=700') || (location.href = '/clips/rec/');
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
