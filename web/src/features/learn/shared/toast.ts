// A short message. The hub's own toast (window.hubToast) draws it when the classic helpers are loaded; otherwise a small element does.
// Browser only.
let el: HTMLDivElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(msg: string): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { hubToast?: (m: string) => void };
  if (w.hubToast) {
    w.hubToast(msg);
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.className = 'ln-toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(timer);
  const t = el;
  timer = setTimeout(() => {
    t.hidden = true;
  }, 3200);
}
