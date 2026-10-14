// Scripts and styles whose address carries the build stamp (b=, added by scripts/stamp-build.mjs) never change under that address: a new
// deploy gives every one a new address. The browser keeps them a year instead of asking again on every page (about 50 requests a page).
// An address without the stamp keeps no-cache from _headers, so a script loaded by a hand-built address is never held stale.
// Astro's own build files carry a content hash in the name and are kept a year too.
export function withAssetCache(res: Response, path: string, url: URL): Response {
  const stamped = (path.startsWith('/js/') || path.startsWith('/css/')) && /^\d+$/.test(url.searchParams.get('b') || '');
  if (!stamped && !path.startsWith('/_astro/')) return res;
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return out;
}
