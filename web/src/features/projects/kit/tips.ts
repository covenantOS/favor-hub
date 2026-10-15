// One shared tooltip for buttons that have only an icon. Each such button carries data-ui-tooltip="pj-tip"; the element shows the
// button's label under it after a short hover, at once on keyboard focus. Coarse pointers (phones) never show it. Ported from
// installTips() in public/js/projects/ui-util.js. Browser only; call it from an effect. It returns a function that removes it.
export function installTips(): () => void {
  if (document.getElementById('pj-tip')) return () => undefined;
  const tip = document.createElement('div');
  tip.id = 'pj-tip';
  tip.setAttribute('role', 'tooltip');
  tip.textContent = 'Label';
  document.body.appendChild(tip);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cur: Element | null = null;
  const hide = () => {
    clearTimeout(timer);
    tip.classList.remove('is-on');
    cur = null;
  };
  const show = (b: Element) => {
    const text = (b.getAttribute('aria-label') || '').trim();
    if (!text || !document.contains(b)) return;
    tip.textContent = text;
    const r = b.getBoundingClientRect();
    const w = tip.offsetWidth;
    tip.style.left = Math.round(Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))) + 'px';
    const below = r.bottom + 8 + 28 < innerHeight;
    tip.style.top = Math.round(below ? r.bottom + 8 : r.top - 36) + 'px';
    tip.classList.add('is-on');
    cur = b;
  };
  const target = (e: Event) => ((e.target as Element)?.closest ? (e.target as Element).closest('[data-ui-tooltip]') : null);
  const over = (e: MouseEvent) => {
    const b = target(e);
    if (!b || b === cur) return;
    hide();
    timer = setTimeout(() => show(b), 450);
  };
  const out = (e: MouseEvent) => {
    const b = target(e);
    if (b && !b.contains(e.relatedTarget as Node)) hide();
  };
  const focusin = (e: FocusEvent) => {
    const b = target(e);
    if (b && document.documentElement.classList.contains('kbd')) show(b);
  };
  const esc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') hide();
  };
  document.addEventListener('mouseover', over);
  document.addEventListener('mouseout', out);
  document.addEventListener('focusin', focusin);
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('scroll', hide, true);
  document.addEventListener('keydown', esc, true);
  const mark = (root: Node) => {
    if (!root || root.nodeType !== 1) return;
    const el = root as Element;
    const list: Element[] = el.matches && el.matches('button[aria-label]') ? [el] : [];
    if (el.querySelectorAll) list.push(...el.querySelectorAll('button[aria-label]:not([data-ui-tooltip])'));
    for (const b of list) if (!(b.textContent || '').trim() && !b.hasAttribute('data-ui-tooltip')) b.setAttribute('data-ui-tooltip', 'pj-tip');
  };
  const mo = new MutationObserver((recs) => {
    for (const r of recs) r.addedNodes.forEach(mark);
  });
  mo.observe(document.body, { childList: true, subtree: true });
  mark(document.body);
  return () => {
    mo.disconnect();
    document.removeEventListener('mouseover', over);
    document.removeEventListener('mouseout', out);
    document.removeEventListener('focusin', focusin);
    document.removeEventListener('focusout', hide);
    document.removeEventListener('pointerdown', hide, true);
    document.removeEventListener('scroll', hide, true);
    document.removeEventListener('keydown', esc, true);
    tip.remove();
  };
}
