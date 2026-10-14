// One task panel for the whole app. The panel is the Projects drawer (public/js/projects/drawer.js), loaded by PJLinks.openTask on first use.
// A link to a task (/projects/p/?p=KEY&t=CODE or /projects/?t=ID) clicked anywhere outside Projects (Chat cards, the bell, Today, meeting notes,
// entity cards) opens that panel in place. Modified clicks and new-tab links keep their normal behavior.
import { loadScript } from '@/lib/legacy';

/** The task reference inside a link to a task, or '' when the link points anywhere else. */
export function taskRefOf(href: string): string {
  let u: URL;
  try {
    u = new URL(href, location.origin);
  } catch {
    return '';
  }
  if (u.origin !== location.origin || !/^\/projects(\/p)?\/?$/.test(u.pathname)) return '';
  return (u.searchParams.get('t') || '').trim();
}

export async function openTaskPanel(ref: string): Promise<void> {
  await loadScript('/js/projects/links.js?v=1');
  (window as unknown as { PJLinks?: { openTask(ref: string): void } }).PJLinks?.openTask(ref);
}

/** Listens for clicks on task links. Capture phase and default prevented only, so the link's own handlers (marking a notice read, closing the bell) still run. */
export function installTaskLinks(): () => void {
  const click = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (location.pathname.startsWith('/projects')) return;
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    const ref = taskRefOf(a.getAttribute('href') || '');
    if (!ref) return;
    e.preventDefault();
    void openTaskPanel(ref);
  };
  document.addEventListener('click', click, true);
  return () => document.removeEventListener('click', click, true);
}
