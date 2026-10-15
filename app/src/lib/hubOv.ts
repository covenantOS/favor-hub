// The back gesture closes whatever is open on top (search, help, the phone menu, a sheet) instead of leaving the page.
// Opening an overlay adds one history entry; closing it any other way removes that entry. A port of the hubOv object in
// public/js/hub-shell.js, kept on window.hubOv because the classic helper scripts the app still loads (drill.js, wc-bell.js) call it.
type Token = { close: () => void };
type Flagged = { __hubOvHandled?: boolean };

const stack: Token[] = [];
let quiet = 0;

const pop = () => {
  try {
    quiet++;
    history.back();
  } catch {
    quiet--;
  }
};

export const hubOv = {
  depth: () => stack.length,
  /** True while a Back step this module started is still on its way (page scripts must let that popstate reach it). */
  busy: () => quiet > 0,
  on(close: () => void): Token {
    const t = { close };
    stack.push(t);
    try {
      history.pushState({ ...(history.state || {}), hubov: stack.length }, '');
    } catch {
      // no history entry; the overlay still closes the usual ways
    }
    return t;
  },
  off(t: Token | null | undefined) {
    if (!t) return;
    const i = stack.indexOf(t);
    if (i < 0) return;
    stack.splice(i, 1);
    if (i === stack.length && history.state && history.state.hubov) pop();
  },
  /** Remove every overlay entry, then run fn once the browser has settled. */
  unwind(fn: () => void) {
    if (!stack.length || !(history.state && history.state.hubov)) {
      stack.length = 0;
      fn();
      return;
    }
    const n = stack.length;
    let left = n;
    stack.length = 0;
    const step = () => {
      if (--left <= 0) {
        removeEventListener('popstate', step);
        setTimeout(fn, 0);
      }
    };
    addEventListener('popstate', step);
    for (let k = 0; k < n; k++) {
      quiet++;
      history.back();
    }
  },
  whenIdle(fn: () => void) {
    if (quiet <= 0) {
      fn();
      return;
    }
    let n = 0;
    const t = setInterval(() => {
      if (quiet <= 0 || ++n > 40) {
        clearInterval(t);
        fn();
      }
    }, 25);
  },
  /** Track an element that opens and closes by itself (an attribute or class change). */
  watch(el: HTMLElement, isOpen: (e: HTMLElement) => boolean, close: (e: HTMLElement) => void) {
    let tok: Token | null = null;
    const sync = () => {
      const open = !!isOpen(el);
      if (tok && stack.indexOf(tok) < 0) tok = null;
      if (open && !tok) {
        tok = hubOv.on(() => {
          tok = null;
          close(el);
        });
      } else if (!open && tok) {
        const t = tok;
        tok = null;
        hubOv.off(t);
      }
    };
    new MutationObserver(sync).observe(el, { attributes: true, attributeFilter: ['hidden', 'open', 'class'] });
    sync();
  },
};

let installed = false;
export function installHubOv() {
  if (installed) return;
  installed = true;
  addEventListener('popstate', () => {
    (window as unknown as Flagged).__hubOvHandled = true;
    if (quiet > 0) {
      quiet--;
      return;
    }
    const t = stack.pop();
    if (t) t.close();
    else (window as unknown as Flagged).__hubOvHandled = false;
  });
  (window as unknown as { hubOv: typeof hubOv }).hubOv = hubOv;
}
