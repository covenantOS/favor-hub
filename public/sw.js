/* FavorOS service worker. One worker for the whole site (scope "/"), served from the root.
   It does four jobs and nothing else:
     1. keeps the app's own files (scripts, styles, fonts, icons) so the app opens on a weak or missing connection,
     2. keeps the /m/ start page so a home screen app opens offline,
     3. shows web push notices (a direct message or a mention) and opens the right conversation when one is tapped,
     4. forgets everything it kept when the person signs out, so a shared phone leaves nothing behind,
   5. answers a repeat visit to Today (/) with the page it drew for that same person last time, then asks the server for the new one and
      keeps it for the visit after (see "Today, kept per person" below).
   Account data (/api/...) is never stored here. The pages keep what they need for offline reading in their own store. */
// The outbox code, shared with the pages, for background sending.
try { importScripts('/js/phone-core.js?v=2'); } catch { /* sends from the page instead */ }

const VERSION = 'favoros-sw-1';
const STATIC = `${VERSION}-static`;
const SHELL = `${VERSION}-shell`;
const TODAY = `${VERSION}-today`;
const STATIC_PREFIXES = ['/_astro/', '/_app/assets/', '/_w/', '/js/', '/css/', '/fonts/', '/images/'];
const SHELL_PATHS = ['/m/'];
const ICON = '/images/app-icon-192.png';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC, SHELL, TODAY, 'favoros-flags']);
      for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
      // The browser starts the page request itself, in parallel with this worker waking, and hands its streaming answer to fetch below.
      try { if (self.registration.navigationPreload) await self.registration.navigationPreload.enable(); } catch { /* no preload: the worker fetches the page */ }
      await self.clients.claim();
    })()
  );
});

async function forgetEverything() {
  for (const k of await caches.keys()) await caches.delete(k);
}

// Scripts and styles change with every release: ask the network first and fall back to the kept copy only when it fails.
async function networkFirst(request) {
  const cache = await caches.open(STATIC);
  try {
    const res = await Promise.race([fetch(request), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 5000))]);
    if (res.ok && res.type === 'basic') cache.put(request, res.clone());
    return res;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}

// Fonts, images and hashed build files never change under the same address: the kept copy answers at once.
async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic') cache.put(request, res.clone());
  return res;
}

async function shellFirstFromNetwork(request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await Promise.race([fetch(request), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 6000))]);
    // Keep only a real page for the signed-in person, never a redirect to the sign-in page.
    if (res.ok && !res.redirected && new URL(res.url).pathname === new URL(request.url).pathname) cache.put(request, res.clone());
    return res;
  } catch {
    const hit = await cache.match(request, { ignoreSearch: true });
    return hit || new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Offline</title><body style="font:16px system-ui;padding:24px"><h1>No connection</h1><p>FavorOS opens again when the phone is online. Messages you write are kept and sent then.</p>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

// Lite mode (public/js/lite.js) sets /__lite in the favoros-flags cache. While it is set, a versioned script or style (?v=N, the
// address changes when the file does) is answered from the kept copy, and asked of the server again at most every six hours.
let liteAt = 0, liteOn = false;
async function lite() {
  if (Date.now() - liteAt < 30000) return liteOn;
  liteAt = Date.now();
  try { liteOn = !!(await (await caches.open('favoros-flags')).match('/__lite')); } catch { liteOn = false; }
  return liteOn;
}
async function keptFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  const age = hit ? Date.now() - Number(hit.headers.get('x-kept-at') || 0) : Infinity;
  const refresh = async () => {
    const res = await fetch(request);
    if (res.ok && res.type === 'basic') {
      const body = await res.clone().blob();
      const h = new Headers(res.headers); h.set('x-kept-at', String(Date.now()));
      await cache.put(request, new Response(body, { status: res.status, statusText: res.statusText, headers: h }));
    }
    return res;
  };
  if (hit) {
    if (age > 6 * 3600 * 1000) refresh().catch(() => undefined);
    return hit;
  }
  return refresh();
}

/* ------------------------------------------------------------ Today, kept per person
   The web app's Today is drawn on the server, and on a phone the wait for that page (one trip to the server, then its reads) is most of
   the time before anything shows. After a visit the page is kept here under hub_who, the cookie that names the signed-in session
   (functions/_lib/session.ts). The next visit to / is answered from it at once, and the page the browser already asked the server for
   (navigation preload) replaces the kept copy when it arrives; the page's own reads bring the new cards in over the old ones.
   A kept page is used only when hub_who still names the session that drew it, only for a person the server gives the web Today (hub_web
   lists "/", hub_web_off is not set), and for 24 hours (the last visit of a workday is about 15 hours before the first of the next). A server answer that is not the web Today (signed out, switched off) forgets
   the copy and loads the page again. Sign-out empties every cache (forgetEverything). */
const TODAY_MAX_AGE = 24 * 3600 * 1000;
// The page starts its scripts in one of two ways (web/src/lib/defer-entry.ts): a plain async module tag for a browser that ran this build
// before, or a loader script that holds them until the styles arrive (it carries the entry file and the preload list).
const TODAY_PLAIN = /<script type="module" async="" src="(\/_w\/[^"]+\.js)"><\/script>/;
const TODAY_LOADER = /<script>\(function\(u,p\)\{var d=0,t;[\s\S]*?\}\)\(("\/_w\/[^"]+\.js"),(\[[^\]]*\])\)<\/script>/;
/** The entry file the page starts, and the text that starts it, or null when the page is not one the web app drew. */
function todayEntry(html) {
  const plain = TODAY_PLAIN.exec(html);
  if (plain) return { src: plain[1], tag: plain[0], preloads: [] };
  const l = TODAY_LOADER.exec(html);
  if (!l) return null;
  try { return { src: JSON.parse(l[1]), tag: l[0], preloads: JSON.parse(l[2]) }; } catch { return null; }
}
async function cookie(name) {
  try { const c = self.cookieStore ? await self.cookieStore.get(name) : null; return c ? String(c.value) : ''; } catch { return ''; }
}
/** "<cache key>|<who>" when this navigation may be answered from a kept page, else "". */
async function todayKey(url) {
  if (url.pathname !== '/' || url.search || !self.cookieStore) return '';
  const [who, web, off] = await Promise.all([cookie('hub_who'), cookie('hub_web'), cookie('hub_web_off')]);
  if (!/^[0-9a-f]{32}$/.test(who) || off === '1') return '';
  let routes = [];
  try { routes = decodeURIComponent(web).split('~'); } catch { routes = []; }
  return routes.includes('/') ? '/__today/' + who + '|' + who : '';
}
// The kept page starts its scripts once the page has been drawn: the document is complete at once, and React's work of attaching to it
// (a second or more on a slow phone) would otherwise sit in front of the cards that are already in the HTML.
const HOLD = (src) =>
  '<script>(function(u){var d=0;function go(){if(d)return;d=1;var s=document.createElement("script");s.type="module";s.src=u;' +
  's.onload=function(){try{document.cookie="hub_w="+u.slice(u.lastIndexOf("/")+1)+";Path=/;Max-Age=2592000;Secure;SameSite=Lax"}catch(e){}};document.head.appendChild(s)}' +
  'function after(){requestAnimationFrame(function(){setTimeout(go,0)})}' +
  'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",after);else after();setTimeout(go,2500)})(' + JSON.stringify(src) + ')</script>';
async function keptToday(key) {
  try {
    const name = key.split('|')[0];
    const cache = await caches.open(TODAY);
    const hit = await cache.match(name);
    if (!hit) return null;
    if (!(Date.now() - Number(hit.headers.get('x-kept-at') || 0) < TODAY_MAX_AGE)) { await cache.delete(name); return null; }
    let html = await hit.text();
    const e = todayEntry(html);
    if (!e) { await cache.delete(name); return null; }
    const drawn = Number(hit.headers.get('x-drawn-at')) || 0;
    html = html.replace(e.tag, () => (drawn ? '<script>window.__hubNow=' + drawn + '</script>' : '') + e.preloads.map((h) => '<link rel="modulepreload" href="' + h + '"/>').join('') + HOLD(e.src));
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-cache', 'X-Hub-Kept': hit.headers.get('x-kept-at') || '' } });
  } catch { return null; }
}
const isWebToday = (res) => !!res && res.status === 200 && !res.redirected && res.headers.get('x-hub-front') === 'web' && /text\/html/i.test(res.headers.get('content-type') || '');
/** `own` is the server's answer when the page is being loaded from the network (nothing kept yet); null when a kept page was shown. */
async function refreshToday(event, name, own) {
  try {
    const who = name.slice('/__today/'.length);
    let res = own;
    if (!res) {
      try { res = await event.preloadResponse; } catch { res = null; }
      if (!res) res = await pageFetch(event.request);
    }
    const cache = await caches.open(TODAY);
    const before = await cache.match(name);
    if (!isWebToday(res)) {
      // The server no longer gives this person the web Today. Forget the copy; a page shown from it loads again, from the server.
      if (before) await cache.delete(name);
      if (before && !own) await loadAgain(event);
      return;
    }
    const html = await res.text();
    const entry = todayEntry(html);
    if (!entry) {
      if (before) await cache.delete(name);
      if (before && !own) await loadAgain(event);
      return;
    }
    // Only a whole page is kept, and only for the session that asked.
    if (!/<\/html>\s*$/.test(html) || (await cookie('hub_who')) !== who) return;
    await cache.put(name, new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'x-kept-at': String(Date.now()), 'x-drawn-at': String(Date.parse(res.headers.get('date') || '') || Date.now()), 'x-entry': entry.src } }));
    // The shown page came from an older build: its scripts do not match the server's reads any more, so the page loads again from the new copy.
    if (before && !own && before.headers.get('x-entry') !== entry.src) await loadAgain(event);
  } catch { /* the page already answered; the copy is tried again on the next visit */ }
}
async function loadAgain(event) {
  try {
    const c = event.resultingClientId ? await self.clients.get(event.resultingClientId) : null;
    if (c && 'navigate' in c) await c.navigate(event.request.url);
  } catch { /* the page stays as shown */ }
}

const LITE_PAGES = ['/', '/chat/'];
// A page load the worker passes on goes out as a script fetch, and the server tells pages from script reads by the browser's own
// Sec-Fetch-Dest header, which a script fetch does not carry as "document". Without a word from here, every repeat visit to a page the web app
// serves came back as the classic page. X-Hub-Doc says it is a page load (functions/_lib/app2.ts isPageLoad); redirects go back to the browser.
function pageFetch(request) {
  const h = new Headers();
  h.set('X-Hub-Doc', '1');
  const a = request.headers.get('Accept');
  if (a) h.set('Accept', a);
  return fetch(request.url, { credentials: 'same-origin', headers: h, redirect: 'manual', cache: 'no-cache' });
}
// Today and Chat open from the browser's own page request (navigation preload), so the page streams to the screen as the server sends it.
// A page the worker fetches itself (pageFetch) reached the screen only once it was complete, which held the web app's Today back by the
// whole time its server reads took. Without a preload answer (an old browser, or offline) the worker's own fetch and the kept copy answer.
async function openPage(event) {
  const request = event.request;
  const key = await todayKey(new URL(request.url));
  if (key) {
    const hit = await keptToday(key);
    if (hit) { event.waitUntil(refreshToday(event, key.split('|')[0], null)); return hit; }
  }
  let pre = null;
  try { pre = await event.preloadResponse; } catch { pre = null; }
  if (key && pre) event.waitUntil(refreshToday(event, key.split('|')[0], pre.clone()));
  const on = await lite();
  if (!pre) return on ? litePage(request) : pageFetch(request);
  if (on && pre.ok && !pre.redirected && pre.type === 'basic') {
    const keep = pre.clone();
    caches.open(SHELL).then((cache) => cache.put(new URL(request.url).pathname, keep)).catch(() => undefined);
  }
  return pre;
}
async function litePage(request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await pageFetch(request);
    if (res.ok && !res.redirected && res.type === 'basic') cache.put(new URL(request.url).pathname, res.clone());
    return res;
  } catch {
    return (await cache.match(new URL(request.url).pathname)) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/api/auth/logout') {
    event.respondWith(fetch(req).finally(forgetEverything));
    return;
  }
  if (req.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;
  if (STATIC_PREFIXES.some((p) => url.pathname.startsWith(p)) && !url.pathname.endsWith('/version.json')) {
    const code = url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/');
    event.respondWith(code ? (url.searchParams.has('v') ? lite().then((on) => (on ? keptFirst(req) : networkFirst(req))) : networkFirst(req)) : cacheFirst(req));
    return;
  }
  if (req.mode === 'navigate' && SHELL_PATHS.includes(url.pathname)) { event.respondWith(shellFirstFromNetwork(req)); return; }
  // Lite mode: Today and Chat are kept too, so they open with no signal (Chat then reads its kept messages, chat.js).
  if (req.mode === 'navigate' && LITE_PAGES.includes(url.pathname)) event.respondWith(openPage(event));
});

self.addEventListener('message', (event) => {
  if (event.data === 'forget') event.waitUntil(forgetEverything());
  if (event.data === 'skip-waiting') self.skipWaiting();
});

/* ---------------------------------------------------------------- web push */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'FavorOS', body: event.data ? event.data.text() : '' };
  }
  const title = String(data.title || 'FavorOS').slice(0, 120);
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // The app is open and in front: it shows the message itself, so no second notice on top of it.
      if (wins.some((w) => w.visibilityState === 'visible' && w.focused)) {
        wins.forEach((w) => w.postMessage({ type: 'push', data }));
        return;
      }
      // A huddle ring (functions/_lib/chat/ring.ts): Join and Decline on the notice, and it stays until answered. The missed notice
      // that follows has the same tag, so it takes the ringing one's place.
      const ring = typeof data.ring === 'string' && /^[0-9a-f]{24}$/.test(data.ring) ? data.ring : '';
      await self.registration.showNotification(title, {
        body: String(data.body || '').slice(0, 240),
        tag: data.tag || undefined,
        renotify: !!data.tag,
        icon: ICON,
        badge: ICON,
        requireInteraction: !!ring && !data.ringEnd,
        vibrate: ring && !data.ringEnd ? [400, 200, 400, 200, 400] : undefined,
        actions: ring && !data.ringEnd ? [{ action: 'join', title: 'Join' }, { action: 'decline', title: 'Decline' }] : undefined,
        data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/m/', ring: data.ringEnd ? '' : ring },
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const ring = (event.notification.data && event.notification.data.ring) || '';
  if (ring && event.action === 'decline') {
    event.waitUntil(fetch('/api/chat/ring/' + ring, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' }, body: JSON.stringify({ action: 'decline' }) }).catch(() => undefined));
    return;
  }
  const url = (event.notification.data && event.notification.data.url) || '/m/';
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) {
        if ('focus' in w) {
          await w.focus();
          if ('navigate' in w) await w.navigate(url).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});

// Chromium can wake the app to send queued messages once the connection returns.
self.addEventListener('sync', (event) => {
  if (event.tag === 'favor-outbox') {
    // The worker sends the waiting messages itself, so they go even when FavorOS is closed (phone-core.js, loaded at the top).
    const P = self.FavorPhone;
    event.waitUntil((P ? P.createOutbox(P.idbStore(), P.chatTransport()).flush().catch(() => undefined) : Promise.resolve()).then(() =>
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => wins.forEach((w) => w.postMessage({ type: 'flush-outbox' })))));
  }
});
