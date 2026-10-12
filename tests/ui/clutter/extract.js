// Runs inside the page. Lists every visible text, shape, image and box with its
// bounding box, the way ClutterBench's scripts/shot.cjs does, so a grader can label
// elements by id. Two additions for an app screen:
//   rootSel  limits the list to parts of the screen (the page body, or an open panel);
//   an element is cut to the scroll boxes it sits in, so rows scrolled out of a pane are left out.
function extractInPage(W, H, rootSel) {
  const out = [];
  const seen = new Set();
  const roots = rootSel ? [...document.querySelectorAll(rootSel)] : [];
  if (!rootSel) roots.push(document.body);
  const visible = (el) => {
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.02;
  };
  // The part of a rectangle that is on the canvas and inside every clipping ancestor.
  // Text is also cut by the element that owns it (self), which is how screen-reader-only labels drop out.
  const clip = (el, r, self) => {
    let x = Math.max(0, r.left), y = Math.max(0, r.top), x2 = Math.min(W, r.right), y2 = Math.min(H, r.bottom);
    for (let p = self ? el : el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      // display: contents and inline boxes have no box of their own and clip nothing
      if ((cs.overflowX === 'visible' && cs.overflowY === 'visible') || cs.display === 'contents' || cs.display === 'inline') continue;
      const q = p.getBoundingClientRect();
      if (cs.overflowX !== 'visible') { x = Math.max(x, q.left); x2 = Math.min(x2, q.right); }
      if (cs.overflowY !== 'visible') { y = Math.max(y, q.top); y2 = Math.min(y2, q.bottom); }
    }
    return { x: Math.round(x), y: Math.round(y), w: Math.round(x2 - x), h: Math.round(y2 - y) };
  };
  const transparent = (c) => !c || c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c);
  const push = (kind, el, rect, extra) => {
    const b = clip(el, rect, kind === 'text');
    if (b.w < 2 || b.h < 2) return;
    const key = `${kind}:${b.x}:${b.y}:${b.w}:${b.h}:${extra.text || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, tag: el.tagName.toLowerCase(), ...b, ...extra });
  };
  const SHAPES = new Set(['rect', 'circle', 'ellipse', 'path', 'line', 'polyline', 'polygon']);
  for (const el of roots.flatMap((r) => [r, ...r.querySelectorAll('*')])) {
    if (!visible(el)) continue;
    let hidden = false;
    for (let p = el.parentElement; p; p = p.parentElement) if (!visible(p)) { hidden = true; break; }
    if (hidden) continue;
    const tag = el.tagName.toLowerCase();
    const cs = getComputedStyle(el);
    if (['script', 'style', 'defs', 'clippath', 'lineargradient', 'pattern', 'mask', 'title', 'option'].includes(tag)) continue;
    if (el.closest('defs, clipPath, pattern, mask, linearGradient')) continue;

    // text units: one per element that directly owns text
    const ownText = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (ownText.length) {
      const range = document.createRange();
      let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
      for (const n of ownText) {
        range.selectNodeContents(n);
        for (const q of range.getClientRects()) {
          l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom);
        }
      }
      if (r > l) {
        push('text', el, { left: l, top: t, right: r, bottom: b }, {
          text: ownText.map((n) => n.textContent.trim()).join(' ').replace(/\s+/g, ' ').slice(0, 160),
          fontSize: Math.round(parseFloat(cs.fontSize)),
          color: cs.fill && el instanceof SVGElement ? cs.fill : cs.color,
        });
      }
    }
    // a field's placeholder or value is text the person reads
    if ((tag === 'input' || tag === 'textarea') && (el.value || el.placeholder) && !['checkbox', 'radio', 'hidden', 'file'].includes(el.type)) {
      push('text', el, el.getBoundingClientRect(), {
        text: (el.value ? el.value : 'placeholder: ' + el.placeholder).replace(/\s+/g, ' ').slice(0, 160),
        fontSize: Math.round(parseFloat(cs.fontSize)), color: cs.color,
      });
    }
    const rect = el.getBoundingClientRect();
    if (el instanceof SVGElement) {
      if (SHAPES.has(tag)) {
        const fill = transparent(cs.fill) || cs.fill === 'none' ? null : cs.fill;
        const stroke = transparent(cs.stroke) || cs.stroke === 'none' ? null : cs.stroke;
        if (fill || stroke) push('shape', el, rect, { color: fill || stroke });
      }
      continue;
    }
    if (tag === 'img') { push('image', el, rect, { text: el.alt || '' }); continue; }
    const hasBg = !transparent(cs.backgroundColor) || cs.backgroundImage !== 'none';
    const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none');
    if (hasBg || hasBorder) {
      const area = rect.width * rect.height;
      if (area > W * H * 0.9) continue; // page background
      // "box" = container with children; "shape" = leaf mark such as a bar
      push(el.children.length ? 'box' : 'shape', el, rect, { color: hasBg ? cs.backgroundColor : cs.borderTopColor });
    }
  }
  out.sort((a, b) => a.y - b.y || a.x - b.x);
  return out.map((e, i) => ({ id: `e${i}`, ...e }));
}
