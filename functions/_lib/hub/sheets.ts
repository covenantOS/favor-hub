// Google Sheets writer: one contract, two doors (a signed-in hub page, and the Brain connector). A person
// presses "Open in Google Sheets" beside a list; this builds a formatted sheet in their own Drive, in a
// folder called "Favor exports", and takes the link-sharing permission Google adds off it before it says
// the sheet is private. It uses only the permission to create and open its own files (drive.file).
//
// The module has no page or Brain imports. The first half is pure (types, conversions, request bodies) so
// tests run offline; createSheet() takes the Google calls through an injected fetch.
import { accessToken } from './google';
import type { Env } from '../http';

export const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
export const MAX_ROWS = 25000;
export const MAX_COLS = 40;
export const MAX_TOTAL_ROWS = 100000;
export const MAX_BODY = 20 * 1024 * 1024;
const CHUNK_BYTES = 1_800_000;
const CELL_MAX = 50000;
const TZ = 'America/New_York';
const FOLDER = 'Favor exports';

export type ColType = 'id' | 'text' | 'int' | 'money' | 'date' | 'datetime' | 'percent' | 'flag';
const TYPES: ColType[] = ['id', 'text', 'int', 'money', 'date', 'datetime', 'percent', 'flag'];
export interface Col { key: string; label: string; type: ColType }
export interface Tab { name: string; columns: Col[]; rows: Record<string, unknown>[]; more?: boolean; note?: string }
export interface Provenance {
  kind?: 'screen' | 'brain' | 'server';
  page?: string;
  filters?: string;
  asked?: string;
  reading?: string;
  dataAsOf?: string;
}
export interface Spec {
  mode: 'rows' | 'brain';
  title?: string;
  tabs?: Tab[];
  tokens?: string[];
  provenance?: Provenance;
  classes?: string[];
  needs?: string[];
  dedupe?: string;
}

export class SheetError extends Error {
  code: string;
  status: number;
  extra: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// ---- Pure helpers ------------------------------------------------------------------------------------

/** Order differs per person, so the scope list is split, never compared as one string. */
export const hasDriveFile = (scopes: string) => String(scopes || '').split(/\s+/).includes(DRIVE_FILE);

export function cleanTitle(t: unknown, fallback = 'Favor list'): string {
  const s = String(t ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  return s || fallback;
}
const cleanTab = (t: unknown, i: number) => String(t ?? '').replace(/[\u0000-\u001f\u007f\[\]*?:\\/]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || `Tab ${i + 1}`;

/** Days since 1899-12-30 for an ISO date (the date part only). */
export function dateSerial(iso: unknown): number | null {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (!Number.isFinite(ms) || new Date(ms).getUTCMonth() !== +m[2] - 1) return null;
  return Math.round((ms - Date.UTC(1899, 11, 30)) / 864e5);
}
/** Eastern wall time for an ISO instant, as a serial number with a fraction for the time of day. */
export function etSerial(iso: unknown): number | null {
  const t = new Date(String(iso ?? ''));
  if (!Number.isFinite(t.getTime())) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(t).map((x) => [x.type, x.value]));
  const day = dateSerial(`${p.year}-${p.month}-${p.day}`);
  if (day == null) return null;
  return day + (+p.hour * 3600 + +p.minute * 60 + +p.second) / 86400;
}
/** Plain date and time for the source line, Eastern. */
export function etText(d = new Date()): string {
  return d.toLocaleString('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(',', '') + ' ET';
}
const isoDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);

/** One cell as written: strings stay strings (RAW), numbers stay numbers. */
export function cellValue(v: unknown, type: ColType): string | number {
  if (v == null || v === '') return '';
  switch (type) {
    case 'int':
    case 'money': {
      const n = Number(v);
      return Number.isFinite(n) ? n : '';
    }
    case 'percent': {
      const n = Number(v);
      return Number.isFinite(n) ? n / 100 : '';
    }
    case 'date': return dateSerial(v) ?? '';
    case 'datetime': return etSerial(v) ?? '';
    case 'flag': return v === true || v === 1 || /^(1|yes|true|y)$/i.test(String(v)) ? 'Yes' : '';
    default: {
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return s.length > CELL_MAX ? s.slice(0, CELL_MAX - 1) + '…' : s;
    }
  }
}

/** Width in pixels: 8 per character of the longest of the header and the first 300 rows, plus 18, from 70 to 360. Dates are 96. */
export function colWidth(c: Col, rows: Record<string, unknown>[]): number {
  if (c.type === 'date') return 96;
  let n = c.label.length;
  for (const r of rows.slice(0, 300)) {
    const v = r[c.key];
    if (v == null) continue;
    const len = c.type === 'money' ? String(Math.round(Number(v))).length + 4 : String(v).length;
    if (len > n) n = len;
  }
  return Math.min(360, Math.max(70, n * 8 + 18));
}

/** Checks and trims the tabs a caller sent. Throws a SheetError the door turns into a plain answer. */
export function normalizeTabs(tabs: unknown): Tab[] {
  if (!Array.isArray(tabs) || !tabs.length || tabs.length > 6) throw new SheetError(400, 'bad_rows', 'Send between one and six tabs.');
  let total = 0;
  const out: Tab[] = [];
  tabs.forEach((raw, i) => {
    const t = raw as Partial<Tab>;
    const cols = Array.isArray(t.columns) ? t.columns : [];
    if (!cols.length || !Array.isArray(t.rows)) throw new SheetError(400, 'bad_rows', 'Each tab needs columns and rows.');
    if (cols.length > MAX_COLS) throw new SheetError(413, 'too_big', `A tab can have ${MAX_COLS} columns.`, { limit: MAX_COLS });
    if (t.rows.length > MAX_ROWS) throw new SheetError(413, 'too_big', `A tab can have ${MAX_ROWS.toLocaleString('en-US')} rows.`, { limit: MAX_ROWS });
    total += t.rows.length;
    if (total > MAX_TOTAL_ROWS) throw new SheetError(413, 'too_big', `A sheet can have ${MAX_TOTAL_ROWS.toLocaleString('en-US')} rows in all.`, { limit: MAX_TOTAL_ROWS });
    const seen = new Set<string>();
    const columns: Col[] = cols.map((c) => {
      const key = String((c as Col).key ?? '');
      const type = (c as Col).type;
      if (!key || seen.has(key) || !TYPES.includes(type)) throw new SheetError(400, 'bad_rows', `Column "${key || '?'}" is missing, repeated or of an unknown type.`);
      seen.add(key);
      return { key, label: String((c as Col).label ?? key).slice(0, 120), type };
    });
    out.push({ name: cleanTab(t.name, i), columns, rows: t.rows as Record<string, unknown>[], more: !!t.more, note: typeof t.note === 'string' ? t.note.slice(0, 300) : '' });
  });
  // Tab names must differ, case aside.
  const names = new Set<string>();
  out.forEach((t, i) => {
    let n = t.name;
    while (names.has(n.toLowerCase()) || n.toLowerCase() === 'about this sheet') n = `${t.name} ${i + 1}`.slice(0, 95);
    t.name = n;
    names.add(n.toLowerCase());
  });
  return out;
}

export interface Meta {
  title: string;
  who: string;
  name: string;
  via: 'session' | 'service';
  provenance: Provenance;
  classes: string[];
  now: Date;
}

/** Row 1 of a data tab. */
export function sourceLine(m: Meta, t: Tab): string {
  const p = m.provenance;
  const where = p.kind === 'brain' ? `Favor Brain${p.asked ? `, asked by ${m.name}` : ''}` : p.kind === 'server' ? 'Favor Hub' : `Copied from your screen${p.page ? `: ${p.page}` : ''}${m.via === 'service' ? ', Favor Brain' : ''}`;
  const bits = [`Source: ${where} on ${etText(m.now)}.`];
  if (p.dataAsOf) bits.push(`Blackbaud data as of ${etText(new Date(p.dataAsOf))}.`);
  if (p.filters) bits.push(p.filters.replace(/\.?$/, '.'));
  bits.push(`${t.rows.length.toLocaleString('en-US')} ${t.rows.length === 1 ? 'row' : 'rows'}.`);
  if (t.more) bits.push('The list was cut at its limit.');
  if (t.note) bits.push(t.note.replace(/\.?$/, '.'));
  return bits.join(' ');
}

/** The "About this sheet" tab: who made it, from what, and the keep-it-inside-Favor line for partner information. */
export function aboutRows(m: Meta, tabs: Tab[]): string[][] {
  const p = m.provenance;
  const rows: string[][] = [
    ['Created', `${etText(m.now)} by ${m.name} (${m.who})`],
    ['Made from', p.kind === 'brain' ? 'A list in Favor Brain' : p.kind === 'server' ? 'A list in Favor Hub' : `The rows on screen${p.page ? ` at ${p.page}` : ''}`],
  ];
  if (p.asked) rows.push(['Question asked', p.asked]);
  if (p.reading) rows.push(['How it was read', p.reading]);
  if (p.filters) rows.push(['Filters', p.filters]);
  if (p.dataAsOf) rows.push(['Blackbaud data as of', etText(new Date(p.dataAsOf))]);
  rows.push(['Rows', tabs.map((t) => `${t.name}: ${t.rows.length.toLocaleString('en-US')}`).join('; ')]);
  if (tabs.some((t) => t.more)) rows.push(['Cut at its limit', 'Yes. The full list is longer than this sheet holds.']);
  if (m.classes.includes('partner')) rows.push(['Partner information', 'This sheet holds partner information. Keep it inside Favor. Do not share it outside Favor, and delete it when you are done.']);
  if (m.classes.includes('staff')) rows.push(['Staff information', 'This sheet holds staff information. Share it only with the people who need it.']);
  rows.push(['Sharing', 'Only you can open this sheet until you share it.']);
  return rows;
}

const rgb = (hex: string) => ({ red: parseInt(hex.slice(1, 3), 16) / 255, green: parseInt(hex.slice(3, 5), 16) / 255, blue: parseInt(hex.slice(5, 7), 16) / 255 });
const NUM_FORMAT: Partial<Record<ColType, { type: string; pattern: string }>> = {
  id: { type: 'TEXT', pattern: '@' },
  text: { type: 'TEXT', pattern: '@' },
  int: { type: 'NUMBER', pattern: '#,##0' },
  money: { type: 'NUMBER', pattern: '$#,##0.00' },
  date: { type: 'DATE', pattern: 'yyyy-mm-dd' },
  datetime: { type: 'DATE_TIME', pattern: 'yyyy-mm-dd h:mm AM/PM' },
  percent: { type: 'PERCENT', pattern: '0.0%' },
  flag: { type: 'TEXT', pattern: '@' },
};

/** The one format request for a data tab: header, source line, number formats, widths, filter. */
export function formatRequests(sheetId: number, t: Tab): unknown[] {
  const nCols = t.columns.length;
  const nRows = t.rows.length;
  const reqs: unknown[] = [
    // Row 1: the source line, small grey italic, running across the screen.
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols }, cell: { userEnteredFormat: { textFormat: { italic: true, fontSize: 9, foregroundColor: rgb('#6b6760') }, wrapStrategy: 'OVERFLOW_CELL' } }, fields: 'userEnteredFormat(textFormat,wrapStrategy)' } },
    // Row 2: the header, bold white on Favor green.
    { repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: nCols }, cell: { userEnteredFormat: { backgroundColor: rgb('#2b4d24'), textFormat: { bold: true, foregroundColor: rgb('#ffffff') }, verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy)' } },
  ];
  t.columns.forEach((c, i) => {
    const f = NUM_FORMAT[c.type]!;
    const right = c.type === 'int' || c.type === 'money' || c.type === 'percent';
    if (nRows)
      reqs.push({ repeatCell: { range: { sheetId, startRowIndex: 2, endRowIndex: 2 + nRows, startColumnIndex: i, endColumnIndex: i + 1 }, cell: { userEnteredFormat: { numberFormat: { type: f.type, pattern: f.pattern }, horizontalAlignment: right ? 'RIGHT' : 'LEFT' } }, fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' } });
    if (right) reqs.push({ repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: i, endColumnIndex: i + 1 }, cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT' } }, fields: 'userEnteredFormat.horizontalAlignment' } });
    reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: colWidth(c, t.rows) }, fields: 'pixelSize' } });
  });
  reqs.push({ setBasicFilter: { filter: { range: { sheetId, startRowIndex: 1, endRowIndex: 2 + Math.max(nRows, 1), startColumnIndex: 0, endColumnIndex: nCols } } } });
  return reqs;
}

/** Values for a data tab, as rows of cells, starting at row 1 (the source line) and row 2 (the header). */
export function tabValues(m: Meta, t: Tab): { head: (string | number)[][]; body: (string | number)[][] } {
  return {
    head: [[sourceLine(m, t)], t.columns.map((c) => c.label)],
    body: t.rows.map((r) => t.columns.map((c) => cellValue(r[c.key], c.type))),
  };
}

/** Rows grouped so one request stays under the size Google recommends. */
export function chunkBySize<T>(rows: T[][], maxBytes = CHUNK_BYTES): T[][][] {
  const out: T[][][] = [];
  let cur: T[][] = [];
  let size = 0;
  for (const r of rows) {
    const n = JSON.stringify(r).length + 2;
    if (cur.length && size + n > maxBytes) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(r);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

const colLetter = (n: number) => {
  let s = '';
  for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const q = (name: string) => `'${name.replace(/'/g, "''")}'`;

// ---- Google calls --------------------------------------------------------------------------------------

export interface Deps {
  fetch: typeof fetch;
  now?: () => Date;
}
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3';

async function call(d: Deps, token: string, step: string, url: string, init: RequestInit = {}): Promise<any> {
  const res = await d.fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } });
  if (res.status === 429) throw new SheetError(429, 'rate', 'Google is busy. Try again in a minute.', { retryAfter: Number(res.headers.get('Retry-After')) || 60 });
  if (res.status === 204) return {};
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const reason = body?.error?.message || `status ${res.status}`;
    throw new SheetError(502, 'google', 'Google did not build the sheet. Nothing was left in your Drive. Try again in a minute.', { step, detail: String(reason).slice(0, 200) });
  }
  return body;
}

async function folderId(env: Env, d: Deps, token: string, email: string): Promise<string> {
  const row = await env.DB.prepare('SELECT folder_id FROM hub_sheets_folder WHERE email = ?').bind(email).first<{ folder_id: string }>().catch(() => null);
  if (row) {
    const ok = await d.fetch(`${DRIVE}/files/${row.folder_id}?fields=id,trashed`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as any;
    if (ok && ok.id && !ok.trashed) return row.folder_id;
  }
  // The folder may exist from an earlier export whose record was lost: find it by name before making another.
  const found = await d.fetch(`${DRIVE}/files?q=${encodeURIComponent(`name = '${FOLDER}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`)}&fields=files(id)&pageSize=1`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { files?: { id: string }[] } | null;
  const f = found?.files?.[0] || await call(d, token, 'create', `${DRIVE}/files?fields=id`, { method: 'POST', body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }) });
  await dropLinkPermissions(d, token, f.id).catch(() => undefined);
  await env.DB.prepare('INSERT INTO hub_sheets_folder (email, folder_id, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET folder_id = excluded.folder_id, created_at = excluded.created_at').bind(email, f.id, new Date().toISOString()).run().catch(() => undefined);
  return f.id;
}

interface Perm { id: string; type: string; permissionDetails?: { inherited?: boolean; inheritedFrom?: string }[] }
/** Removes the domain and anyone-with-the-link permissions from a file, going to the folder for inherited ones. */
export async function dropLinkPermissions(d: Deps, token: string, fileId: string): Promise<void> {
  for (let round = 0; round < 3; round++) {
    const perms = await call(d, token, 'share', `${DRIVE}/files/${fileId}/permissions?fields=permissions(id,type,permissionDetails(inherited,inheritedFrom))&supportsAllDrives=true`);
    const links = ((perms.permissions || []) as Perm[]).filter((p) => p.type === 'domain' || p.type === 'anyone');
    if (!links.length) return;
    for (const p of links) {
      const from = (p.permissionDetails || []).find((x) => x.inherited && x.inheritedFrom)?.inheritedFrom;
      await call(d, token, 'share', `${DRIVE}/files/${from || fileId}/permissions/${p.id}?supportsAllDrives=true`, { method: 'DELETE' });
    }
  }
}

export interface Made { id: string; url: string; title: string; tabs: { name: string; rows: number }[]; private: true; ms: number }

/** Builds the sheet. Any failure after the file exists deletes the file before it throws. */
export async function buildSheet(env: Env, d: Deps, token: string, email: string, meta: Meta, tabs: Tab[], onCreated?: (id: string, url: string) => Promise<void>): Promise<Made> {
  const t0 = Date.now();
  const parent = await folderId(env, d, token, email);
  const file = await call(d, token, 'create', `${DRIVE}/files?fields=id,webViewLink`, { method: 'POST', body: JSON.stringify({ name: meta.title, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [parent] }) });
  const id: string = file.id;
  const drop = () => d.fetch(`${DRIVE}/files/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
  try {
    // The caller records the file the moment Drive has made it, so a sheet is never unknown to the hub.
    if (onCreated) await onCreated(id, file.webViewLink || `https://docs.google.com/spreadsheets/d/${id}/edit`);
    const about = aboutRows(meta, tabs);
    const setup: unknown[] = [
      { updateSpreadsheetProperties: { properties: { locale: 'en_US', timeZone: TZ }, fields: 'locale,timeZone' } },
      { updateSheetProperties: { properties: { sheetId: 0, title: tabs[0].name, gridProperties: { rowCount: Math.max(tabs[0].rows.length + 2, 3), columnCount: tabs[0].columns.length, frozenRowCount: 2 } }, fields: 'title,gridProperties(rowCount,columnCount,frozenRowCount)' } },
    ];
    tabs.slice(1).forEach((t, i) => setup.push({ addSheet: { properties: { sheetId: i + 1, title: t.name, gridProperties: { rowCount: Math.max(t.rows.length + 2, 3), columnCount: t.columns.length, frozenRowCount: 2 } } } }));
    setup.push({ addSheet: { properties: { sheetId: 100, title: 'About this sheet', gridProperties: { rowCount: about.length + 1, columnCount: 2 } } } });
    await call(d, token, 'setup', `${API}/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: setup }) });

    // The header, the source line and the rows, in requests under about 1.8 MB. RAW keeps "=1+1" and long ids as text.
    const data: { range: string; values: (string | number)[][] }[] = [];
    for (const t of tabs) {
      const v = tabValues(meta, t);
      data.push({ range: `${q(t.name)}!A1`, values: v.head });
      let row = 3;
      for (const chunk of chunkBySize(v.body)) {
        data.push({ range: `${q(t.name)}!A${row}`, values: chunk });
        row += chunk.length;
      }
    }
    data.push({ range: `${q('About this sheet')}!A1`, values: about });
    let batch: typeof data = [];
    let bytes = 0;
    const flush = async () => {
      if (!batch.length) return;
      await call(d, token, 'values', `${API}/${id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: batch }) });
      batch = [];
      bytes = 0;
    };
    for (const part of data) {
      const n = JSON.stringify(part.values).length;
      if (batch.length && bytes + n > CHUNK_BYTES) await flush();
      batch.push(part);
      bytes += n;
    }
    await flush();

    const fmt: unknown[] = tabs.flatMap((t, i) => formatRequests(i, t));
    fmt.push(
      { updateDimensionProperties: { range: { sheetId: 100, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 190 }, fields: 'pixelSize' } },
      { updateDimensionProperties: { range: { sheetId: 100, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 640 }, fields: 'pixelSize' } },
      { repeatCell: { range: { sheetId: 100, startRowIndex: 0, endRowIndex: about.length, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat(textFormat,verticalAlignment)' } },
      { repeatCell: { range: { sheetId: 100, startRowIndex: 0, endRowIndex: about.length, startColumnIndex: 1, endColumnIndex: 2 }, cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat(wrapStrategy,verticalAlignment)' } },
    );
    await call(d, token, 'format', `${API}/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: fmt }) });

    // Google shares a new file with the whole domain by link, and a file in a shared folder inherits the
    // folder's permission, which only the folder can drop. Take every link permission off, then check.
    await dropLinkPermissions(d, token, id);
    const chk = await call(d, token, 'share', `${DRIVE}/files/${id}?fields=shared`);
    if (chk.shared) throw new SheetError(502, 'google', 'Google would not make that sheet private, so it was removed.', { step: 'share' });
  } catch (e) {
    await drop();
    throw e;
  }
  return { id, url: file.webViewLink || `https://docs.google.com/spreadsheets/d/${id}/edit`, title: meta.title, tabs: tabs.map((t) => ({ name: t.name, rows: t.rows.length })), private: true, ms: Date.now() - t0 };
}

// ---- The service ---------------------------------------------------------------------------------------

/** A hash of what is in the sheet, so a double click or a retry within a minute does not make two. */
async function digest(tabs: Tab[]): Promise<string> {
  const buf = new TextEncoder().encode(JSON.stringify(tabs.map((t) => [t.name, t.columns, t.rows.length, t.rows.slice(0, 20), t.rows.slice(-5)])));
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(h.slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface Caller { email: string; name: string; via: 'session' | 'service' }
export interface Result extends Made { ok: true; reused: boolean }

/** Brain list tokens, read through the Brain's own route (owner, expiry and packages checked there). */
export async function readBrainLists(env: Env & { BRAIN_HUB_KEY?: string; BRAIN_URL?: string }, d: Deps, c: Caller, tokens: string[]): Promise<{ tabs: Tab[]; prov: Provenance; contacts: boolean }> {
  if (!env.BRAIN_HUB_KEY) throw new SheetError(503, 'not_set_up', 'The Brain is not connected to the hub yet.');
  const res = await d.fetch(`${(env.BRAIN_URL || 'https://mcp.favorintl.org').replace(/\/$/, '')}/hub/list/read`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.BRAIN_HUB_KEY}`, 'X-Acting-Email': c.email, 'X-Acting-Name': encodeURIComponent(c.name), 'Content-Type': 'application/json', 'User-Agent': 'favor-hub' },
    body: JSON.stringify({ tokens: tokens.slice(0, 5) }),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (res.status === 410 || body.error === 'expired') throw new SheetError(410, 'expired', body.message || 'That list expired. Lists last 24 hours; ask the question again.');
  if (res.status === 403) throw new SheetError(403, 'forbidden', body.message || 'That list is not yours to export.');
  if (!res.ok || !body.ok) throw new SheetError(502, 'google', body.message || 'The Brain did not give the list. Try again in a minute.', { step: 'list' });
  const lists = (body.lists || []) as any[];
  const tabs = normalizeTabs(lists.map((l) => ({ name: l.title, columns: (l.columns || []).map((k: any) => ({ key: k.key, label: k.label, type: TYPES.includes(k.type) ? k.type : 'text' })), rows: l.rows || [], more: !!l.more })));
  return { tabs, prov: { kind: 'brain', reading: lists[0]?.reading || '', dataAsOf: lists[0]?.dataAsOf || undefined }, contacts: lists.some((l) => l.contacts) };
}

/** Rate limit: ten exports in ten minutes for one person. */
async function rateOk(env: Env, email: string): Promise<boolean> {
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM hub_sheets WHERE email = ? AND at > ?').bind(email, since).first<{ n: number }>().catch(() => ({ n: 0 }));
  return (r?.n ?? 0) < 10;
}

/** The part of an execution context createSheet needs: keep working after the client has gone. */
export interface Ctx { waitUntil(p: Promise<unknown>): void }

// The default fetch calls the global from inside an arrow. Passing the bare global as a property of an object
// throws "Illegal invocation" in the Workers runtime (fixed in 1226696); keep it wrapped.
export async function createSheet(env: Env & { BRAIN_HUB_KEY?: string; BRAIN_URL?: string }, c: Caller, spec: Spec, d: Deps = { fetch: (input, init) => fetch(input, init) }, ctx?: Ctx): Promise<Result> {
  const t0 = Date.now();
  const email = c.email.toLowerCase();
  if (spec.mode !== 'rows' && spec.mode !== 'brain') throw new SheetError(400, 'bad_rows', 'Unknown way to build a sheet.');
  if (c.via === 'service' && spec.mode !== 'rows') throw new SheetError(400, 'bad_rows', 'The connector sends rows.');
  const g = await accessToken(env, email);
  if (!g) throw new SheetError(409, 'not_connected', 'Connect your Google account to the hub first.', { connectUrl: '/api/google/connect?next=' + encodeURIComponent('/brain/') });
  if (!hasDriveFile(g.scopes)) throw new SheetError(409, 'consent', 'Allow Favor to make Google Sheets for you. Google asks once.', { consentUrl: '/api/google/connect?add=sheets&next=' + encodeURIComponent('/brain/') });
  if (!(await rateOk(env, email))) throw new SheetError(429, 'rate', 'That is a lot of sheets in a few minutes. Try again shortly.', { retryAfter: 120 });

  // Everything below runs as one job. With a context it is handed to waitUntil, so closing the page during
  // the 15 to 20 second first press does not stop it halfway and leave a finished sheet nobody recorded.
  const job = buildAndRecord(env, c, spec, d, g.token, email, t0);
  if (ctx) ctx.waitUntil(job.catch(() => undefined));
  return job;
}

async function buildAndRecord(env: Env & { BRAIN_HUB_KEY?: string; BRAIN_URL?: string }, c: Caller, spec: Spec, d: Deps, token: string, email: string, t0: number): Promise<Result> {
  let tabs: Tab[];
  let prov: Provenance = { ...(spec.provenance || {}) };
  const classes = new Set(spec.classes || []);
  if (spec.mode === 'brain') {
    const lists = await readBrainLists(env, d, c, Array.isArray(spec.tokens) ? spec.tokens.map(String) : []);
    tabs = lists.tabs;
    prov = { ...prov, kind: 'brain', reading: lists.prov.reading || prov.reading, dataAsOf: lists.prov.dataAsOf || prov.dataAsOf };
    classes.add('partner');
  } else {
    tabs = normalizeTabs(spec.tabs);
    prov.kind = c.via === 'service' ? 'brain' : prov.kind === 'brain' ? 'screen' : prov.kind || 'screen';
  }
  const now = (d.now || (() => new Date()))();
  const title = cleanTitle(spec.title || tabs[0].name).replace(/ \d{4}-\d{2}-\d{2}$/, '') + ' ' + isoDay(now);
  const key = spec.dedupe ? String(spec.dedupe).slice(0, 120) : 'h:' + (await digest(tabs));
  const window = spec.dedupe ? 24 * 3600_000 : 60_000;

  const prior = await env.DB.prepare("SELECT sheet_id, url, title, tabs, rows, at FROM hub_sheets WHERE email = ? AND dedupe = ? AND state = 'ready'").bind(email, key).first<{ sheet_id: string; url: string; title: string; tabs: number; rows: number; at: string }>().catch(() => null);
  if (prior && Date.now() - new Date(prior.at).getTime() < window) {
    const ok = await d.fetch(`${DRIVE}/files/${prior.sheet_id}?fields=id,trashed`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as any;
    if (ok && ok.id && !ok.trashed) return { ok: true, reused: true, id: prior.sheet_id, url: prior.url, title: prior.title, tabs: tabs.map((t) => ({ name: t.name, rows: t.rows.length })), private: true, ms: Date.now() - t0 };
  }
  const meta: Meta = { title, who: email, name: c.name || email, via: c.via, provenance: prov, classes: [...classes], now };
  const rows = tabs.reduce((n, t) => n + t.rows.length, 0);
  let rowId: number | null = null;
  // Recorded as 'creating' the moment Drive has the file. A repeat of the same key replaces the old row; no
  // row values are ever logged.
  const record = async (id: string, url: string) => {
    await env.DB.prepare('DELETE FROM hub_sheets WHERE email = ? AND dedupe = ?').bind(email, key).run().catch(() => undefined);
    const r = await env.DB.prepare("INSERT INTO hub_sheets (at, email, sheet_id, url, title, source, via, tabs, rows, classes, needs, dedupe, private, ms, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, 'creating')")
      .bind(now.toISOString(), email, id, url, title, `${spec.mode}:${prov.page || prov.kind || ''}`.slice(0, 80), c.via, tabs.length, rows, [...classes].join(','), (spec.needs || []).join(','), key)
      .run()
      .catch(() => null);
    rowId = (r?.meta?.last_row_id as number | undefined) ?? null;
  };
  let made: Made;
  try {
    made = await buildSheet(env, d, token, email, meta, tabs, record);
  } catch (e) {
    // buildSheet has already trashed the file; the row stays as the record that it was tried.
    if (rowId != null) await env.DB.prepare("UPDATE hub_sheets SET state = 'failed' WHERE id = ?").bind(rowId).run().catch(() => undefined);
    throw e;
  }
  if (rowId != null) await env.DB.prepare("UPDATE hub_sheets SET state = 'ready', ms = ?, url = ?, private = 1 WHERE id = ?").bind(made.ms, made.url, rowId).run().catch(() => undefined);
  return { ok: true, reused: false, ...made };
}
