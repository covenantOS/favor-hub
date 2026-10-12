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

/** Helper scripts the whole shell uses. Each reads markup the shell already rendered. Order matters (hubOv first, set by lib/hubOv). */
export const SHELL_SCRIPTS = [
  '/js/chat/mention-input.js?v=1', // the Chat and Brain dock panel builds on it
  '/js/clips-launch.js?v=5', // the camera button (#clip-cam) and the recording pill
  '/js/wc-bell.js?v=8', // the reminders bell (#wm-bell), until the notifications endpoint replaces it
  '/js/drill.js?v=5', // the rows behind a number (data-drill)
  '/js/copy-stamp.js?v=1', // the "as of" stamp (data-copy-stamp)
] as const;

/** Load the shell's helper scripts once the first frame has painted. */
export function mountShellScripts(): Promise<unknown> {
  return SHELL_SCRIPTS.reduce<Promise<unknown>>(
    (chain, src) => chain.then(() => loadScript(src)).catch((e) => console.warn('[legacy]', (e as Error).message)),
    Promise.resolve()
  );
}

/** A frame after paint, so scripts never sit between the first render and what people see. */
export function afterPaint(fn: () => void) {
  const idle = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  requestAnimationFrame(() => (idle ? idle(fn, { timeout: 1500 }) : setTimeout(fn, 60)));
}
