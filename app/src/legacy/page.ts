// Bringing a classic (Astro) page into the app's frame. This is the engine in public/js/hub-swap.js, kept to what a page inside the React shell needs:
// read the page's HTML once per build, take its body, its page-only stylesheets and its scripts, and run the scripts the way a full load would.
// The frame (rail, top bar, search, dock) stays the app's own; only #h-content's contents come from the classic page.
import { layoutAssets, loadScript as loadShellScript } from '@/lib/legacy';

declare const __BUILD__: string;

type Own = { state: { sync: boolean; held: Array<[string, (e: Event) => void]> }; cleanup(): void };
const own = (): Own => (window as unknown as { __hubOwn?: Own }).__hubOwn || { state: { sync: false, held: [] }, cleanup() {} };

const SKEY = 'hub.app.pg.' + __BUILD__ + ':';
const mem = new Map<string, Promise<string>>();
const scripts = new Map<string, Promise<string>>();

const keep = (k: string, h: string) => {
  try {
    sessionStorage.setItem(SKEY + k, h);
  } catch {
    // storage full or refused; the memory copy still serves this visit
  }
};
const kept = (k: string) => {
  try {
    return sessionStorage.getItem(SKEY + k);
  } catch {
    return null;
  }
};
try {
  Object.keys(sessionStorage).forEach((x) => {
    if (x.indexOf('hub.app.pg.') === 0 && x.indexOf(SKEY) !== 0) sessionStorage.removeItem(x);
  });
} catch {
  // no storage
}

export const keyOf = (u: string) => {
  const x = new URL(u, location.href);
  return x.pathname.replace(/\/?$/, '/') + x.search;
};

function loadText(src: string): Promise<string> {
  if (!scripts.has(src)) {
    scripts.set(
      src,
      fetch(src, { credentials: 'same-origin' })
        .then((r) => {
          if (!r.ok) throw new Error('script');
          return r.text();
        })
        .catch((e) => {
          scripts.delete(src);
          throw e;
        })
    );
  }
  return scripts.get(src)!;
}

const scriptSrcs = (root: ParentNode) =>
  Array.from(root.querySelectorAll<HTMLScriptElement>('script[src]'))
    .filter((s) => !s.getAttribute('type') || s.getAttribute('type') === 'text/javascript')
    .map((s) => s.src);

/** The page's HTML, from this session's copy when there is one. Copies are the same for everyone and change only with a build. */
export function fetchPage(u: string): Promise<string> {
  const k = keyOf(u);
  if (!mem.has(k)) {
    const copy = kept(k);
    if (copy) mem.set(k, Promise.resolve(copy));
    else {
      mem.set(
        k,
        fetch(u, { credentials: 'same-origin', headers: { 'X-Hub-Request': '1', Accept: 'text/html' } })
          .then((r) => {
            if (!r.ok || r.redirected || !/text\/html/.test(r.headers.get('content-type') || '')) throw new Error('not a page');
            return r.text();
          })
          .then((h) => {
            if (h.length < 600000 && h.indexOf('id="h-content"') > 0) keep(k, h);
            return h;
          })
          .catch((e) => {
            mem.delete(k);
            throw e;
          })
      );
    }
    setTimeout(() => mem.delete(k), 300_000);
  }
  return mem.get(k)!;
}

/** Read a page and its scripts ahead of the press (hover, touch, idle). */
export function warmPage(u: string) {
  void fetchPage(u)
    .then((h) => {
      const d = new DOMParser().parseFromString(h, 'text/html');
      const main = d.getElementById('h-content');
      if (main) scriptSrcs(main).forEach((s) => void loadText(s).catch(() => undefined));
    })
    .catch(() => undefined);
}

/* ------------------------------------------------------------------ stylesheets */

// Stylesheets every classic page carries because its layout does (the frame). The app bundles those itself, so they are not fetched again.
const layoutSheets = async () => new Set((await layoutAssets()).css);

const managed = new Set<string>();
const keyEl = (el: Element) => (el.tagName === 'LINK' ? 'L' + el.getAttribute('href') : 'S' + el.textContent);

async function applyHead(doc: Document) {
  const skip = await layoutSheets();
  const wanted = Array.from(doc.head.querySelectorAll('link[rel=stylesheet], style')).filter((el) => !(el.tagName === 'LINK' && skip.has(el.getAttribute('href') || '')));
  const want = new Set(wanted.map(keyEl));
  document.head.querySelectorAll('link[rel=stylesheet], style').forEach((el) => {
    const k = keyEl(el);
    if (managed.has(k) && !want.has(k)) {
      el.remove();
      managed.delete(k);
    }
  });
  const have = new Set(Array.from(document.head.querySelectorAll('link[rel=stylesheet], style')).map(keyEl));
  const added: HTMLLinkElement[] = [];
  for (const el of wanted) {
    const k = keyEl(el);
    if (have.has(k)) continue;
    const copy = el.cloneNode(true) as HTMLElement;
    document.head.appendChild(copy);
    managed.add(k);
    if (copy.tagName === 'LINK') added.push(copy as HTMLLinkElement);
  }
  await Promise.all(
    added.map(
      (l) =>
        new Promise<void>((ok) => {
          if (l.sheet) return ok();
          l.addEventListener('load', () => ok(), { once: true });
          l.addEventListener('error', () => ok(), { once: true });
          setTimeout(ok, 1500);
        })
    )
  );
}

/** Take the page's stylesheets off again (leaving for a native route). */
export function dropPageCss() {
  document.head.querySelectorAll('link[rel=stylesheet], style').forEach((el) => {
    const k = keyEl(el);
    if (managed.has(k)) {
      el.remove();
      managed.delete(k);
    }
  });
}

/* ------------------------------------------------------------------ scripts */

let epoch = 0;

/** Scripts the classic layout loads on every page, which page scripts expect to find. Read from the build, loaded once, in the layout's order. */
let shellReady: Promise<void> | null = null;

function stubs() {
  const w = window as unknown as Record<string, unknown>;
  // Functions the classic layout defines inline and page scripts call. The frame owns what they used to do.
  if (!w.hubGate) {
    let p: Promise<unknown> | null = null;
    w.hubGate = () => {
      if (!p)
        p = fetch('/api/work/gate', { credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } })
          .then((r) => r.json().then((j: { ok?: boolean; message?: string }) => {
            if (!r.ok || j.ok === false) throw new Error(j.message || 'gate');
            return j;
          }))
          .catch((e) => {
            p = null;
            throw e;
          });
      return p;
    };
  }
  w.hubApplyNav = w.hubApplyNav || (() => undefined);
  w.hubNavLayout = w.hubNavLayout || (() => undefined);
}

export function ensureClassicShell(): Promise<void> {
  stubs();
  if (!shellReady) {
    shellReady = (async () => {
      const { js } = await layoutAssets();
      const list = ['/js/hub-own.js', ...js];
      await list.reduce<Promise<unknown>>((chain, src) => chain.then(() => loadShellScript(src)).catch((e) => console.warn('[legacy]', (e as Error).message)), Promise.resolve());
    })();
  }
  return shellReady;
}

async function runScripts(root: HTMLElement, ready: Map<string, string>) {
  const o = own();
  const list = Array.from(root.querySelectorAll('script'));
  const parts: string[] = [];
  const mods: string[] = [];
  for (const s of list) {
    const type = s.getAttribute('type') || '';
    if (type === 'module' && s.src) {
      mods.push(s.src);
      s.remove();
      continue;
    }
    if (type && type !== 'text/javascript') continue;
    if (s.src) {
      try {
        parts.push('// ' + s.src + '\n' + (ready.get(s.src) ?? (await loadText(s.src))));
      } catch {
        // the page shows its own error
      }
    } else if (s.textContent && s.textContent.trim()) parts.push(s.textContent);
    s.remove();
  }
  o.state.held.length = 0;
  o.state.sync = true;
  // document.write after the page has loaded would wipe it. The one use on a page (Mail's sample mailbox) writes a script tag; run that script instead.
  const write = document.write;
  document.write = (html: string) => {
    const m = /<script[^>]+src="([^"]+)"/.exec(String(html));
    if (!m) return;
    const x = new XMLHttpRequest();
    x.open('GET', m[1], false);
    x.send();
    if (x.status === 200) (0, eval)(x.responseText);
  };
  try {
    (0, eval)(parts.join('\n;\n') + '\n//# sourceURL=hub-page-' + ++epoch + '.js');
  } catch (e) {
    console.error('page script', e);
  }
  document.write = write;
  o.state.sync = false;
  // The document is already loaded, so the load and DOMContentLoaded handlers the page asked for run now.
  o.state.held.splice(0).forEach(([ty, fn]) => {
    try {
      fn.call(ty === 'load' ? window : document, new Event(ty));
    } catch (e) {
      console.error(e);
    }
  });
  for (const m of mods) {
    try {
      await import(/* @vite-ignore */ m + (m.indexOf('?') < 0 ? '?' : '&') + 'sw=' + epoch);
    } catch (e) {
      console.error('page module', e);
    }
  }
}

export interface Loaded {
  nav: string;
  title: string;
  mainClass: string;
  actions: string;
  /** Put the page's body in `host` and run its scripts. */
  mount(host: HTMLElement): Promise<void>;
}

/** Read a page and get it ready; null when the page cannot live inside the frame (it needs a full load). */
export async function loadPage(u: string): Promise<Loaded | null> {
  const [html] = await Promise.all([fetchPage(u), ensureClassicShell()]);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const main = doc.getElementById('h-content');
  if (!main || !doc.body.classList.contains('h-body')) {
    console.warn('[legacy] ' + u + ' has no frame body; loading it whole');
    return null;
  }
  // A page built on inline module scripts starts itself only on a real load.
  if (Array.from(main.querySelectorAll('script[type="module"]')).some((x) => !x.getAttribute('src'))) {
    console.warn('[legacy] ' + u + ' starts itself from an inline module; loading it whole');
    return null;
  }
  const ready = new Map<string, string>();
  try {
    await Promise.all(scriptSrcs(main).map((src) => loadText(src).then((t) => ready.set(src, t))));
  } catch {
    console.warn('[legacy] ' + u + ' scripts did not load; loading it whole');
    return null;
  }
  await applyHead(doc);
  const act = doc.getElementById('h-actions');
  return {
    nav: doc.body.dataset.nav || '',
    title: (doc.title || '').replace(/\s*-\s*FavorOS\s*$/, ''),
    mainClass: main.className,
    actions: act ? act.innerHTML : '',
    async mount(host) {
      own().cleanup();
      host.textContent = '';
      Array.from(main.childNodes).forEach((n) => host.appendChild(document.importNode(n, true)));
      // The new page's frame paints first; its scripts run right after.
      await new Promise<void>((ok) => requestAnimationFrame(() => setTimeout(ok, 0)));
      await runScripts(host, ready);
      document.dispatchEvent(new CustomEvent('hub-swapped', { detail: { path: keyOf(u) } }));
    },
  };
}

/** Everything a classic page made goes away when it leaves. */
export function leavePage() {
  own().cleanup();
  document.querySelectorAll('dialog[open]').forEach((d) => {
    try {
      (d as HTMLDialogElement).close();
    } catch {
      // already closed
    }
  });
  (window as unknown as { FavorDrill?: { close(): void } }).FavorDrill?.close();
}
