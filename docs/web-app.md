# The FavorOS web app (web/)

From 2026-10-15 every new FavorOS screen is built here, in React on TanStack Start, and nothing new is built in Astro. The plan, the
order of routes and the parity checklist are in the vault: `Projects/FavorOS React migration plan.md`.

## How a page reaches people

1. The browser asks dash.favorintl.org for a page. The Pages middleware (`functions/_middleware.ts`) signs the person in and runs
   every guard, then asks `functions/_lib/web.ts` whether the web app serves this route for this person.
2. If yes, the middleware hands the request to the `favoros-web` Worker through the `WEB` service binding, with the person in the
   X-Hub-* headers. The Worker has no public address.
3. The Worker (`web/src/server.ts`) renders the route with TanStack Start and streams it: the frame first, then each part as its
   reads answer.
4. Server reads go through `favoros-relay` (`workers/favoros-relay`), because a Worker called by Pages cannot fetch Pages back
   (Cloudflare answers 522). The relay forwards GET /api with the visitor's own cookie, so every privacy rule applies unchanged. In the
   browser, reads are normal same-origin fetches to /api.

Who gets a route: hub setting `web.routes`, a comma list of `route@audience` (`testers`, `admin` or `all`; testers and Will always
get every listed route). `node scripts/web-routes.mjs` shows it; `set /projects/ all` turns a route on; `off /projects/` is the
rollback (Astro answers again within about a minute, no deploy). A person can leave with `?web=0` (back with `?web=1`), and
`?classic=1` opens the Astro page once.

Classic pages read the `hub_web` cookie, so `hub-swap.js` loads a web route whole instead of swapping its Astro body in. Old and new
pages draw the same shell from the same stylesheets and use the same cross-document view transition.

## Folder layout

```
web/
  package.json, vite.config.ts   Vite 8, React 19, TanStack Start, the Cloudflare plugin; its own node_modules
  wrangler.jsonc                 the favoros-web Worker (no public address)
  scripts/layout-css.mjs         writes src/styles/layout.css from App.astro's style imports (generated, not in git)
  src/server.ts                  the Worker entry
  src/router.tsx                 router and query client (trailing slashes kept, server answers streamed to the browser)
  src/routes/                    FILE ROUTES. One folder per URL: src/routes/projects/index.tsx is /projects/
  src/shell/WebShell.tsx         the frame (app2 rail, top bar, phone bar, Ctrl K, entity cards, dock), drawn on the server
  src/lib/hub.ts                 hubGet(path): one read helper for server and browser
  src/lib/queries.ts             queryOptions for shared reads (navQuery)
  src/features/<name>/           one folder per area: components, hooks, styles
  src/ui/                        design-system components over the hub classes (h-card, h-btn, h-tab, ...)
shared/web.ts                    WEB_ROUTES (what the web app has built) and the setting format
functions/_lib/web.ts            the middleware hand-off
```

Aliases: `@/` is `app/src/` (the app2 shell, hooks and features, reused as they are), `@shared/` is `shared/`, `@hub/` is `src/`
(the menu registry `@hub/data/areas`, icons, release badges, the tour's progress rules and the stylesheets `@hub/styles/x.css`).

## Add a route

1. `web/src/routes/<path>/index.tsx` with `createFileRoute('/<path>/')({ staticData: { nav, title, layout }, loader, component })`.
   `nav` is the nav id the Astro page passed to its layout; it picks the area, the tab row and the help article.
2. Reads: a `queryOptions` per API route with `queryFn: () => hubGet('/api/...')`. In the loader, `void queryClient.prefetchQuery(q)`
   (never await, so the frame streams at once). In the component, `useSuspenseQuery(q)` inside `<Suspense fallback={...}>` whose
   fallback has the final size (CLS about 0). Writes use `fetch` with `X-Hub-Request: 1` and then `queryClient.invalidateQueries`.
3. Styles: import the page's own stylesheets in the order the Astro page imported them (`import '@hub/styles/projects.css'`) in the
   route's feature folder. The frame's stylesheets are already loaded. Reuse the existing class names.
4. Nothing may read `window`, `document`, `localStorage` or `matchMedia` while drawing; read them in `useEffect`. Portals go through
   `BodyPortal` (`app/src/shell/BodyPortal.tsx`). External stores need a server snapshot (`useSyncExternalStore(sub, get, get)`).
5. Add the route to `WEB_ROUTES` in `shared/web.ts` (a route owns the paths under it).
6. Help article and a changelog entry as for any feature. The tour (`web/src/features/tour`) shows the entry to the people who can open the page, and a role's tour needs an edit only when the page becomes one of that job's main screens (`data.ts`). UI copy follows the writing rules (no em dashes, "partners", no mention of AI).

## Work on it

- Build: `npm --prefix web run build`. Local run: put `WEB_KEY=<the key in ~/.claude/secrets/favor-web-key.txt>` in `web/.dev.vars`
  (git ignores it), `cd web && npx vite preview --port <a free port> --strictPort`, then request a page with headers
  `X-Hub-Email: tester@favorintl.org` and `Cookie: favor_hub_session=<a tester session from POST /api/admin/test-session>`.
- On production for testers only: ship (below), then `node scripts/web-routes.mjs set /<route>/ testers` and open the page as the
  tester. `node scripts/live-front.mjs /<route>/=web` says which front answered and whether the rail drew.
- Ship: `MSYS_NO_PATHCONV=1 node scripts/ship-hub.mjs --skip-known-failures --check /<route>/=web` from your worktree with the Marketing
  environment loaded (`source Q:/work/favor-hub/cfenv.sh`). It waits for the shared lock, rebases, runs every test, builds and deploys
  the Worker and Pages together, and reads the route live.

## Parity before a route goes to staff

Every Feature Catalog row for the route works by tapping in from another page and pressing Back; the same data as the Astro page for
tester and for tester2 set to staff (restore admin after); the privacy smoke check clean (`py Q:\work\favor-hub\qa-rebuild\smoke.py`);
screenshots at 1440, 1710 and a phone, reviewed; CLS about 0 on load and on every tab change; the phone field profile no slower than
the Astro page (`Q:\work\favor-hub\react-plan\measure_poc.py` is the harness); old addresses and `?tab=`/`?view=` still land. Then
`web-routes.mjs set /<route>/ all` (Today, Partners and Mail: `admin` for a day first) and check it live as tester2 set to staff.
