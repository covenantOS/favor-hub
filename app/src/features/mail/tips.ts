// Text tooltips for icon-only buttons, the way the classic Mail page draws them (and Projects): the label, shown on mouse hover and on keyboard focus.
// The native title attribute is taken off so the browser's own tip does not show twice.
const SCOPE = '.ml, .ml-sheet, .ml-c';

export function installTips(): () => void {
  const bubble = document.createElement('div');
  bubble.className = 'ml-tip';
  bubble.hidden = true;
  bubble.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bubble);
  let timer = 0;
  const scan = (scope: ParentNode) => {
    scope.querySelectorAll?.('button[aria-label]:not([data-ui-tooltip]), a[aria-label]:not([data-ui-tooltip])').forEach((b) => {
      if (/[A-Za-z0-9]/.test(b.textContent || '')) return;
      b.setAttribute('data-ui-tooltip', '1');
    });
  };
  const show = (b: Element) => {
    // Read when shown, because React reuses a button for another action and changes its label and title.
    const text = b.getAttribute('title') || b.getAttribute('aria-label') || '';
    b.removeAttribute('title');
    if (!text) return;
    bubble.textContent = text;
    bubble.hidden = false;
    const r = b.getBoundingClientRect();
    const w = bubble.offsetWidth;
    let top = r.bottom + 6;
    if (top + 30 > innerHeight) top = r.top - 32;
    bubble.style.top = top + 'px';
    bubble.style.left = Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2)) + 'px';
  };
  const hide = () => {
    clearTimeout(timer);
    bubble.hidden = true;
  };
  const mo = new MutationObserver((list) =>
    list.forEach((m) => {
      m.addedNodes.forEach((n) => {
        if (n.nodeType === 1 && ((n as Element).closest?.(SCOPE) || (n as Element).matches?.(SCOPE) || (n as Element).querySelector?.(SCOPE))) scan((n as Element).parentNode || (n as Element));
      });
    })
  );
  mo.observe(document.body, { childList: true, subtree: true });
  scan(document.body);
  const over = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const b = (e.target as Element).closest?.('[data-ui-tooltip]');
    if (!b || !b.closest(SCOPE)) return;
    clearTimeout(timer);
    // The browser's own tip waits on the title attribute, so it comes off as soon as the pointer arrives.
    if (b.getAttribute('title')) b.setAttribute('data-tip-text', b.getAttribute('title') || '');
    timer = window.setTimeout(() => show(b), 450);
  };
  const out = (e: PointerEvent) => {
    if ((e.target as Element).closest?.('[data-ui-tooltip]')) hide();
  };
  const focus = (e: FocusEvent) => {
    const b = (e.target as Element).closest?.('[data-ui-tooltip]');
    if (b && document.documentElement.classList.contains('kbd') && b.closest(SCOPE)) show(b);
    else hide();
  };
  document.addEventListener('pointerover', over);
  document.addEventListener('pointerout', out);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('focusin', focus);
  return () => {
    mo.disconnect();
    document.removeEventListener('pointerover', over);
    document.removeEventListener('pointerout', out);
    document.removeEventListener('pointerdown', hide, true);
    document.removeEventListener('focusin', focus);
    bubble.remove();
  };
}
