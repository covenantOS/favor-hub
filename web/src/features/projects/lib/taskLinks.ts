// A link to a task (/projects/p/?p=KEY&t=CODE or /projects/?t=ID) clicked inside a Projects page opens the drawer in place. Modified
// clicks and new-tab links keep their normal behavior. The same rules as app/src/features/entity/taskPanel.ts, which handles the
// links on every other page.
import { useEffect } from 'react';

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

export function useTaskLinks(openTask: (ref: string) => void): void {
  // Chat's task cards open a task through PJLinks.openTask, which uses the page's drawer when window.PJDrawer is there.
  useEffect(() => {
    const w = window as unknown as { PJDrawer?: { open: (ref: string) => void } };
    w.PJDrawer = { open: openTask };
    return () => {
      delete w.PJDrawer;
    };
  }, [openTask]);
  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const ref = taskRefOf(a.getAttribute('href') || '');
      if (!ref) return;
      e.preventDefault();
      openTask(ref);
    };
    document.addEventListener('click', click, true);
    return () => document.removeEventListener('click', click, true);
  }, [openTask]);
}
