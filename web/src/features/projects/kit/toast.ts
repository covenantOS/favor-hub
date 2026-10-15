// A toast with an optional Undo. The hub's own stacked toasts (window.hubToast, public/js/favor-ui.js) draw it when they are loaded;
// otherwise a small fallback does. Browser only.
export interface ToastOpts {
  error?: boolean;
  ms?: number;
  undo?: () => void;
  action?: { label: string; fn: () => void };
}

let el: HTMLDivElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(msg: string, opts: ToastOpts = {}): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { hubToast?: (m: string, o: Record<string, unknown>) => void };
  if (w.hubToast) {
    const fn = opts.action ? opts.action.fn : opts.undo;
    w.hubToast(msg, { tone: opts.error ? 'bad' : '', ms: opts.ms, action: fn ? { label: opts.action ? opts.action.label : 'Undo', fn } : null });
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.className = 'pj-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  const t = el;
  clearTimeout(timer);
  t.className = 'pj-toast' + (opts.error ? ' is-error' : '');
  t.textContent = '';
  const span = document.createElement('span');
  span.textContent = msg;
  t.appendChild(span);
  const fn = opts.action ? opts.action.fn : opts.undo;
  if (fn) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pj-toast__b';
    b.textContent = opts.action ? opts.action.label : 'Undo';
    b.onclick = () => {
      t.classList.remove('is-on');
      fn();
    };
    t.appendChild(b);
  }
  requestAnimationFrame(() => t.classList.add('is-on'));
  timer = setTimeout(() => t.classList.remove('is-on'), opts.ms || (fn ? 6000 : 3200));
}
