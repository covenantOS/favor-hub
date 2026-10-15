// Meetings > the lobby and the room (/meet/room/?m=<id>). Served by the FavorOS web app; the room itself is the classic room code, run as it
// is (public/js/meet/room.js and the modules it imports: lobby, SFU session, sync loop, recording guard, ring, hostless start, effects,
// stage). This page is the frame: the same container the Astro page drew (#meet-root inside .meet-room), the brain icon sprite, and the
// scripts in the order the Astro page loaded them. Nothing here touches the call. The page is always loaded whole (links to it are plain
// links, shared/app2.ts FULL_LOAD), and it reloads the browser if the router ever moves away from it, so a call never keeps running behind
// another page.
import { memo, useEffect } from 'react';
import { SPRITE } from '@hub/pages/brain/_icons';
import '@hub/styles/meet.css';
import '@hub/styles/qa2-meet.css';
import '@hub/styles/crit-meet.css';
import '@hub/styles/brain.css';
import '@hub/styles/lint-fix.css';
import '@hub/styles/meet-auto.css';

const MODULES = ['ui', 'rtc', 'devices', 'effects', 'rec', 'stage'];

// The container is drawn once. The room script replaces what is inside #meet-root, so React must never write there again.
const Frame = memo(function Frame() {
  return (
    <>
      <div className="bc-root" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: SPRITE }} />
      <div className="meet-room" id="meet-root">
        <div className="h-card h-skel" style={{ minHeight: 360, margin: 14 }} />
      </div>
    </>
  );
});

function add(tag: 'script' | 'link', attrs: Record<string, string>): HTMLElement {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  el.setAttribute('data-meet-room', '1');
  (tag === 'link' ? document.head : document.body).appendChild(el);
  return el;
}

export function RoomPage() {
  useEffect(() => {
    document.getElementById('h-app')?.classList.add('is-lobby');
    // The room's modules download together with room.js instead of after it (one round trip less on a phone). Favor Brain answers and Send
    // the link are not needed to join, so they load on the side.
    MODULES.forEach((m) => add('link', { rel: 'modulepreload', href: `/js/meet/${m}.js` }));
    add('script', { src: '/js/brain-blocks.js?v=18', async: '' });
    add('script', { src: '/js/meet/send.js?v=1', defer: '' });
    add('script', { type: 'module', src: '/js/meet/room.js?v=17' });
    return () => {
      // The router moved to another page while the room was open: load that page whole, which closes the call the way leaving a page always
      // has. (A plain link to another page already loads whole; this covers the shortcut keys and Back.)
      if (location.pathname.replace(/\/?$/, '/') !== '/meet/room/') location.reload();
    };
  }, []);
  return <Frame />;
}
