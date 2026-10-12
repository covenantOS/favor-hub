/* Pointer-based drag and drop for rows and cards, with a drop line. Works with a mouse (drag from anywhere on the row),
   a finger (drag from the grip, or press and hold on the row) and a pen. Handlers on `root` are delegated, so the list can redraw freely.

   dnd(root, { item, zone, body, grip, onDrop, canStart, scrollX })
     item    selector of a draggable row or card; it carries data-id
     zone    selector of a drop area (a section, a column); it carries data-zone
     body    selector, inside a zone, of the box that holds the items (the drop line sits there when the zone is empty)
     grip    selector of the handle inside an item (starts a drag at once, also by touch)
     onDrop  ({id, zone, from, beforeId, afterId}) called once on release over a valid place
     scrollX selector of a horizontally scrolling parent to scroll near its edges (the board) */
export function dnd(root, o) {
  let down = null;
  let drag = null;
  let suppress = false;
  const line = document.createElement('div');
  line.className = 'pj-drop';
  line.hidden = true;

  const blocked = (t) => t.closest('input, textarea, select, a, [data-nodrag]') && !t.closest(o.grip || '.nope');

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || down || drag) return;
    const item = e.target.closest(o.item);
    if (!item || !root.contains(item)) return;
    if (blocked(e.target)) return;
    if (o.canStart && !o.canStart(item)) return;
    const onGrip = !!(o.grip && e.target.closest(o.grip));
    const touch = e.pointerType !== 'mouse';
    down = { item, x: e.clientX, y: e.clientY, id: e.pointerId, onGrip, touch, timer: 0 };
    if (touch && !onGrip) down.timer = setTimeout(() => { if (down) begin(); }, 320);
    addEventListener('pointermove', move, { passive: false });
    addEventListener('pointerup', up);
    addEventListener('pointercancel', cancel);
  });

  function begin() {
    if (!down || drag) return;
    clearTimeout(down.timer);
    const item = down.item;
    const r = item.getBoundingClientRect();
    const ghost = item.cloneNode(true);
    ghost.classList.add('pj-ghost');
    ghost.removeAttribute('id');
    ghost.style.width = r.width + 'px';
    ghost.style.left = '0px';
    ghost.style.top = '0px';
    document.body.append(ghost, line);
    item.classList.add('is-dragging');
    document.documentElement.classList.add('pj-dragging');
    drag = { item, ghost, dx: down.x - r.left, dy: down.y - r.top, x: down.x, y: down.y, tgt: null, raf: 0, over: null };
    if (navigator.vibrate && down.touch) { try { navigator.vibrate(8); } catch (_) { /* no haptics */ } }
    addEventListener('keydown', key, true);
    addEventListener('contextmenu', stopMenu, true);
    place();
    tick();
  }
  const stopScroll = (e) => { if (drag) e.preventDefault(); };
  const stopMenu = (e) => { if (drag || down) e.preventDefault(); };

  function move(e) {
    if (!down || e.pointerId !== down.id) return;
    if (!drag) {
      const d = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (down.touch && !down.onGrip) { if (d > 9) cancel(); return; }
      if (d > 5) { begin(); } else return;
    }
    e.preventDefault();
    drag.x = e.clientX; drag.y = e.clientY;
    place();
  }

  function zones() { return [...root.querySelectorAll(o.zone)].filter((z) => z.offsetParent !== null || z.getClientRects().length); }
  function place() {
    const { ghost, x, y } = drag;
    ghost.style.transform = `translate(${Math.round(x - drag.dx)}px, ${Math.round(y - drag.dy)}px)${drag.item.classList.contains('pj-card') ? ' rotate(1.6deg)' : ''}`;
    let best = null; let bd = Infinity;
    for (const z of zones()) {
      const r = z.getBoundingClientRect();
      const cx = Math.max(r.left, Math.min(x, r.right));
      const cy = Math.max(r.top, Math.min(y, r.bottom));
      const d = Math.hypot(x - cx, y - cy);
      if (d < bd) { bd = d; best = z; }
    }
    if (!best || bd > 160) { drag.tgt = null; line.hidden = true; if (drag.over) { drag.over.classList.remove('is-over'); drag.over = null; } return; }
    if (drag.over !== best) { if (drag.over) drag.over.classList.remove('is-over'); best.classList.add('is-over'); drag.over = best; }
    const items = [...best.querySelectorAll(o.item)].filter((i) => i !== drag.item && i.getClientRects().length);
    let before = null;
    for (const it of items) { const r = it.getBoundingClientRect(); if (y < r.top + r.height / 2) { before = it; break; } }
    const last = items[items.length - 1];
    const ref = before || last;
    let top; let left; let width;
    if (ref) {
      const r = ref.getBoundingClientRect();
      const prev = before ? items[items.indexOf(before) - 1] : null;
      top = before ? (prev ? (prev.getBoundingClientRect().bottom + r.top) / 2 : r.top) : r.bottom;
      left = r.left; width = r.width;
    } else {
      const b = (o.body && best.querySelector(o.body)) || best;
      let r = b.getBoundingClientRect();
      if (!r.height) r = best.getBoundingClientRect();
      top = r.top + 6; left = r.left; width = r.width;
    }
    line.style.transform = `translate(${Math.round(left)}px, ${Math.round(top - 1)}px)`;
    line.style.width = Math.round(width) + 'px';
    line.hidden = false;
    drag.tgt = { zone: best, before: before ? before.dataset.id : null, after: !before && last ? last.dataset.id : null };
  }

  function tick() {
    if (!drag) return;
    const { x, y } = drag;
    const edge = 72;
    let dy = 0;
    let moved = false;
    if (y < edge) dy = -Math.ceil((edge - y) / 5);
    else if (y > innerHeight - edge) dy = Math.ceil((y - (innerHeight - edge)) / 5);
    // an inner scroller (a board column) wins over the page when the pointer is inside it
    if (dy) {
      moved = true;
      const zb = drag.over && o.body ? drag.over.querySelector(o.body) : null;
      if (zb && zb.scrollHeight > zb.clientHeight + 1 && getComputedStyle(zb).overflowY !== 'visible') zb.scrollTop += dy; else scrollBy(0, dy);
    }
    if (o.scrollX) {
      const sx = root.closest(o.scrollX) || root.querySelector(o.scrollX);
      if (sx) {
        const r = sx.getBoundingClientRect();
        let dx = 0;
        if (x < r.left + 56) dx = -Math.ceil((r.left + 56 - x) / 4);
        else if (x > r.right - 56) dx = Math.ceil((x - (r.right - 56)) / 4);
        if (dx) { sx.scrollLeft += dx; moved = true; }
      }
    }
    if (moved) place();
    drag.raf = requestAnimationFrame(tick);
  }

  function finish(commit) {
    const d = drag;
    clearTimeout(down && down.timer);
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', cancel);
    removeEventListener('keydown', key, true);
    removeEventListener('contextmenu', stopMenu, true);
    down = null; drag = null;
    if (!d) return;
    cancelAnimationFrame(d.raf);
    d.ghost.remove(); line.remove(); line.hidden = true;
    d.item.classList.remove('is-dragging');
    if (d.over) d.over.classList.remove('is-over');
    document.documentElement.classList.remove('pj-dragging');
    suppress = true;
    setTimeout(() => { suppress = false; }, 60);
    if (commit && d.tgt) {
      const zone = d.tgt.zone;
      const from = d.item.closest(o.zone);
      const sibs = [...from.querySelectorAll(o.item)];
      const i = sibs.indexOf(d.item);
      const same = from === zone;
      const nextId = sibs[i + 1] ? sibs[i + 1].dataset.id : null;
      const prevId = sibs[i - 1] ? sibs[i - 1].dataset.id : null;
      if (same && ((d.tgt.before && d.tgt.before === nextId) || (d.tgt.after && d.tgt.after === prevId && !nextId) || (!d.tgt.before && !d.tgt.after && sibs.length === 1))) return;
      o.onDrop({ id: d.item.dataset.id, zone: zone.dataset.zone, from: from.dataset.zone, beforeId: d.tgt.before, afterId: d.tgt.after });
    }
  }
  const up = (e) => { if (down && e.pointerId === down.id) finish(true); };
  const cancel = () => finish(false);
  const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); finish(false); } };
  // Registered up front: iOS only honors preventDefault on a touchmove listener that existed when the finger went down.
  root.addEventListener('touchmove', stopScroll, { passive: false });
  root.addEventListener('click', (e) => { if (suppress) { e.stopPropagation(); e.preventDefault(); } }, true);
  return () => { finish(false); };
}
