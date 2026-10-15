// The web routes this person gets, read from the hub_web cookie the middleware sets on every web page (functions/_lib/web.ts webCookie).
// A link inside the web app moves in the app only to one of these. A route held to testers or admins in the hub setting web.routes is not
// in the cookie of anyone else, so it never opens for them by tapping from another web page, and `web-routes.mjs off <route>` takes effect
// on the next page load for everyone. The server draws the same links with no list; only the click changes once the browser has read the cookie.
import { useSyncExternalStore } from 'react';

const NONE: string[] = [];
let lastRaw: string | null = null;
let lastList: string[] = NONE;

function snapshot(): string[] {
  const m = /(?:^|;\s*)hub_web=([^;]*)/.exec(document.cookie);
  const raw = m ? m[1] : '';
  if (raw !== lastRaw) {
    lastRaw = raw;
    try {
      lastList = raw ? decodeURIComponent(raw).split('~').filter(Boolean) : NONE;
    } catch {
      lastList = NONE;
    }
  }
  return lastList;
}

export const parseServed = (raw: string): string[] => (raw ? decodeURIComponent(raw).split('~').filter(Boolean) : []);

/** Routes the web app serves this person, for NavLink. Empty on the server and before hydration. */
export function useWebServed(): string[] {
  return useSyncExternalStore(
    () => () => undefined,
    snapshot,
    () => NONE,
  );
}
