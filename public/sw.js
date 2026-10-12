/* FavorOS service worker. One worker for the whole site (scope "/"), served from the root.
   It does four jobs and nothing else:
     1. keeps the app's own files (scripts, styles, fonts, icons) so the app opens on a weak or missing connection,
     2. keeps the /m/ start page so a home screen app opens offline,
     3. shows web push notices (a direct message or a mention) and opens the right conversation when one is tapped,
     4. forgets everything it kept when the person signs out, so a shared phone leaves nothing behind.
   Account data (/api/...) is never stored here. The pages keep what they need for offline reading in their own store. */
const VERSION = 'favoros-sw-1';
const STATIC = `${VERSION}-static`;
const SHELL = `${VERSION}-shell`;
const STATIC_PREFIXES = ['/_astro/', '/_app/assets/', '/js/', '/css/', '/fonts/', '/images/'];
const SHELL_PATHS = ['/m/'];
const ICON = '/images/app-icon-192.png';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC, SHELL]);
      for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
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
    event.respondWith(url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/') ? networkFirst(req) : cacheFirst(req));
    return;
  }
  if (req.mode === 'navigate' && SHELL_PATHS.includes(url.pathname)) event.respondWith(shellFirstFromNetwork(req));
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
      await self.registration.showNotification(title, {
        body: String(data.body || '').slice(0, 240),
        tag: data.tag || undefined,
        renotify: !!data.tag,
        icon: ICON,
        badge: ICON,
        data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/m/' },
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
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
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => wins.forEach((w) => w.postMessage({ type: 'flush-outbox' }))));
  }
});
