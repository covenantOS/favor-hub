// The addresses of Reports: where a report lives, where its data lives, and how filters travel. No imports, so tests can load it.
export const BASE = '/reports/';
export const API = '/api/reports';

/** The address of a report's data: its filters as the server reads them (an empty value is sent, it means "all"). */
export function apiUrl(id: string, values: Record<string, string>, format?: string): string {
  const p = new URLSearchParams();
  for (const k of Object.keys(values || {})) p.set(k, values[k]);
  if (format) p.set('format', format);
  const q = p.toString();
  return API + '/' + encodeURIComponent(id) + (q ? '?' + q : '');
}

/** The address bar of a report: its filters that are not empty. */
export function pageUrl(id: string, values: Record<string, string>): string {
  const p = new URLSearchParams();
  for (const k of Object.keys(values)) if (values[k] !== '') p.set(k, values[k]);
  const q = p.toString();
  return BASE + '?r=' + id + (q ? '&' + q : '');
}

/** What the address asks for: the report and its filters, as typed in the address. */
export function askedOf(search: string): { id: string | null; asked: Record<string, string> } {
  const p = new URLSearchParams(search);
  const r = p.get('r');
  const asked: Record<string, string> = {};
  p.forEach((v, k) => {
    if (k !== 'r' && k !== 'google') asked[k] = v;
  });
  return { id: r && /^[a-z0-9-]+$/.test(r) ? r : null, asked };
}
