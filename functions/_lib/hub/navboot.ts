// The menu's first paint. A page used to draw the menu from the copy the browser saved last time, and a browser with no copy (a first
// visit, a cleared cache, a new phone) or an old copy drew a short menu that grew when /api/hub/nav answered. The server already knows
// who is asking, so it writes this person's access flags into the page head (window.__hubBoot), and the layout script stores them as the
// saved copy before the menu is drawn. A short cookie keeps the lookup off every page load; /api/hub/nav refreshes it.
import type { HubUser } from '../session';

export const BOOT_COOKIE = 'hub_navboot';
const BOOT_SECONDS = 600;

export type NavBoot = { user: HubUser; access: object; kpiTeams: string[]; jobs: string[] };

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

export function bootCookie(boot: NavBoot): string {
  const body = b64(JSON.stringify({ e: boot.user.email.toLowerCase(), a: boot.access, k: boot.kpiTeams, j: boot.jobs }));
  return `${BOOT_COOKIE}=${body}; Path=/; Max-Age=${BOOT_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

/** The saved answer for this person, or null when there is none, it names someone else or it does not read. */
export function readBoot(request: Request, user: HubUser): NavBoot | null {
  const m = /(?:^|;\s*)hub_navboot=([^;]+)/.exec(request.headers.get('Cookie') || '');
  if (!m) return null;
  try {
    const d = JSON.parse(unb64(m[1]));
    if (!d || d.e !== user.email.toLowerCase() || !d.a || typeof d.a !== 'object') return null;
    return { user, access: d.a, kpiTeams: Array.isArray(d.k) ? d.k : [], jobs: Array.isArray(d.j) ? d.j : [] };
  } catch {
    return null;
  }
}

/** Writes the boot data into the head, ahead of every other script on the page. */
export function injectBoot(res: Response, boot: NavBoot): Response {
  const data = JSON.stringify({ user: boot.user, access: boot.access, kpiTeams: boot.kpiTeams, jobs: boot.jobs }).split('<').join('\\u003c').split('\u2028').join('').split('\u2029').join('');
  // Stored as the saved menu copy before any other script reads it (the partner-tools check, the menu layout and the command palette
  // all read favor.hub.nav.v1). The counts stay from the last copy for the same person; the menu's own answer refreshes them.
  const tag = `<script>(function(){try{var d=${data};window.__hubBoot=d;var o=JSON.parse(localStorage.getItem('favor.hub.nav.v1')||'null');var k=o&&o.user&&o.user.email===d.user.email;localStorage.setItem('favor.hub.nav.v1',JSON.stringify({user:d.user,access:d.access,kpiTeams:d.kpiTeams,jobs:d.jobs,counts:k&&o.counts||{}}));}catch(e){}})();</script>`;
  return new HTMLRewriter().on('head', { element(el) { el.prepend(tag, { html: true }); } }).transform(res);
}

