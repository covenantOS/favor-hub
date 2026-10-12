// Scripts from public/js that are self-contained and keyed on ids and data attributes, loaded as they are. The app mounts the markup they
// look for (the Clips camera button, the bell) and loads the script once that markup exists. They are not rewritten here; a route that
// replaces one retires it from this list. See docs/porting-to-react.md.
const loaded = new Map<string, Promise<void>>();

export function loadScript(src: string): Promise<void> {
  const hit = loaded.get(src);
  if (hit) return hit;
  const p = new Promise<void>((ok, bad) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = () => ok();
    s.onerror = () => {
      loaded.delete(src);
      bad(new Error('Could not load ' + src));
    };
    document.head.appendChild(s);
  });
  loaded.set(src, p);
  return p;
}

export function loadStyle(href: string) {
  if (document.querySelector('link[href="' + href + '"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  document.head.appendChild(l);
}

export interface LayoutAssets {
  css: string[];
  js: string[];
  brief?: string;
}

let assets: Promise<LayoutAssets> | null = null;
/** The stylesheets and scripts the classic layout carries, read from the build (scripts/app-layout-css.mjs), so versions never drift from the pages. */
export function layoutAssets(): Promise<LayoutAssets> {
  if (!assets) {
    assets = fetch('/_app/layout-assets.json', { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<LayoutAssets>) : { css: [], js: [] }))
      .catch(() => ({ css: [], js: [] }));
  }
  return assets;
}

/** Helper scripts the frame itself uses, found in the layout's list by name so the version is always the one the pages use. */
const FRAME_HELPERS = ['mention-input', 'drill'] as const;

/** Load the shell's helper scripts once the first frame has painted. */
export async function mountShellScripts(): Promise<void> {
  const { js } = await layoutAssets();
  const list = ['/js/clips-launch.js?v=5', '/js/copy-stamp.js?v=1', ...FRAME_HELPERS.map((n) => js.find((s) => s.includes('/' + n + '.js'))).filter((x): x is string => !!x)];
  await Promise.all(list.map((src) => loadScript(src).catch((e) => console.warn('[legacy]', (e as Error).message))));
}

/** A frame after paint, so scripts never sit between the first render and what people see. */
export function afterPaint(fn: () => void) {
  const idle = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  requestAnimationFrame(() => (idle ? idle(fn, { timeout: 1500 }) : setTimeout(fn, 60)));
}
