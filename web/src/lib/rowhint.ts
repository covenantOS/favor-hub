// The top bar's tab row decides how tall the bar is on a phone (a second line), and the bar is drawn before the menu answer arrives.
// The server knows the person's role from the request and which areas had a row the last time this browser drew one, from a cookie
// the page writes. Both reach the held top bar through the root route's loader, so the server copy and the browser's copy are the same.
import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequestHeader } from '@tanstack/react-start/server';
import { NO_HINT, type RowHint } from '@/shell/model';

const COOKIE = 'hub_rows';

function parse(cookie: string): Record<string, 0 | 1> {
  const m = cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith(COOKIE + '='));
  const rows: Record<string, 0 | 1> = {};
  if (!m) return rows;
  for (const part of decodeURIComponent(m.slice(COOKIE.length + 1)).split(',')) {
    const [area, v] = part.split(':');
    if (area && /^[\w-]+$/.test(area) && (v === '1' || v === '0')) rows[area] = v === '1' ? 1 : 0;
  }
  return rows;
}

export const readRowHint = createIsomorphicFn()
  .server((): RowHint => ({ admin: getRequestHeader('x-hub-role') === 'admin', rows: parse(getRequestHeader('cookie') || '') }))
  .client((): RowHint => ({ ...NO_HINT, rows: parse(document.cookie) }));

/** Remember, in this browser, whether an area drew a tab row for this person. */
export function rememberRow(areaId: string, drawn: boolean): void {
  const rows = parse(document.cookie);
  const v = drawn ? 1 : 0;
  if (rows[areaId] === v) return;
  rows[areaId] = v;
  const value = Object.entries(rows).map(([a, n]) => a + ':' + n).join(',');
  document.cookie = COOKIE + '=' + encodeURIComponent(value) + ';Path=/;Max-Age=31536000;Secure;SameSite=Lax';
}
