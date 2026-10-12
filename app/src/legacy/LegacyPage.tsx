import { useEffect, useRef, useState } from 'react';
import { useLocation } from '@tanstack/react-router';
import { layoutOf, pageMeta } from '@/shell/meta';
import { leavePage, loadPage, dropPageCss } from './page';

/**
 * A classic page inside the app's frame. The route's HTML is read once per build, its body goes into this host and its scripts run, so a page that
 * is not ported yet still opens without leaving the frame: no reload, the rail, top bar, search and dock stay mounted. A page that cannot live
 * here (it needs a full load) is handed to the browser as a normal navigation, which the middleware serves as the classic page.
 */
export function LegacyPage() {
  const loc = useLocation({ select: (l) => l.pathname + l.searchStr });
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let live = true;
    setBusy(true);
    setFailed(false);
    (async () => {
      try {
        const page = await loadPage(loc);
        if (!live) return;
        if (!page) {
          location.replace(loc + (loc.includes('?') ? '&' : '?') + 'classic=1');
          return;
        }
        pageMeta.set({ nav: page.nav, title: page.title, layout: layoutOf(page.mainClass), actions: page.actions });
        if (host.current) await page.mount(host.current);
        if (live) setBusy(false);
      } catch (e) {
        if (!live) return;
        console.error('[legacy]', e);
        setFailed(true);
        setBusy(false);
      }
    })();
    return () => {
      live = false;
      leavePage();
    };
  }, [loc]);

  useEffect(
    () => () => {
      pageMeta.clear();
      dropPageCss();
    },
    []
  );

  return (
    <>
      <div ref={host} className="app-legacy" style={{ display: 'contents' }} aria-busy={busy} />
      {failed && (
        <div className="h-card r2t-clear" role="alert">
          This page could not load. <a href={loc + (loc.includes('?') ? '&' : '?') + 'classic=1'}>Open it in classic FavorOS</a>
        </div>
      )}
    </>
  );
}
