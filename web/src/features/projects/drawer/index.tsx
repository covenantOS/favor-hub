// The task drawer: one panel for every task. A sheet on a phone (Back closes it), a panel on the right on a desktop that opens over the
// page without moving it. Ported from public/js/projects/drawer.js, public/js/projects/links.js and the mention composer.
//
// Contract the pages rely on:
//   <DrawerHost />                                mounted once on every Projects page (inside the staff provider, with <OverlayHost />)
//   openDrawer(ctx, ref, opts?) : Promise<void>   ref is a task id or code; ctx is the page's TaskCtx (list order, [ and ] step through it)
//   closeDrawer() : void
//   drawerOpen() : boolean
//   setDrawerHooks({ open(task), close(id) })     the page puts ?t=CODE in the address on open and clears it on close
//   taskUrl(task), copyTaskLink(task)             the address of a task, as a link / copied to the clipboard
//   useTaskLinks(openTask)                        a link to a task clicked on the page opens the drawer in place
import { useEffect, useRef } from 'react';

export { DrawerHost } from './Drawer';
export { closeDrawer, copyTaskLink, currentTaskId, drawerOpen, openDrawer, projectUrl, setDrawerHooks, taskItem, taskUrl } from './state';
export type { DrawerHooks } from './state';
export { openPrefs } from './links';

/** The task reference inside a link to a task (/projects/p/?p=KEY&t=CODE or /projects/?t=ID), or '' when the link points anywhere else. */
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

/**
 * Installs a capture-phase click listener while the page is mounted: a plain click on a link to a task opens that task through
 * openTask instead of loading the page again. Modified clicks, links that open in a new tab and downloads keep their normal behavior.
 */
export function useTaskLinks(openTask: (ref: string) => void): void {
  const open = useRef(openTask);
  open.current = openTask;
  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const ref = taskRefOf(a.getAttribute('href') || '');
      if (!ref) return;
      e.preventDefault();
      open.current(ref);
    };
    document.addEventListener('click', click, true);
    return () => document.removeEventListener('click', click, true);
  }, []);
}
