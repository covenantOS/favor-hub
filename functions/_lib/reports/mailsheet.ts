// A mail file as a Google Sheet in the US Team Files shared drive. The hub signs in to Google as the Favor service account
// (GOOGLE_SA_JSON, a Pages secret) and adds one spreadsheet to the "Hub mail files" folder; staff open it from the link. The
// service account can add files but not move or delete them, so a sheet that failed half way is named as unfinished and left.
// Every cell is written as text (RAW), so a ZIP that starts with 0 and a record id stay as they are.
import { saToken } from '../work/sheetsa';
import { hubGet } from '../admin/settings';
import type { Env } from '../http';
import { HttpError } from '../http';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/drive';
export const FOLDER_NAME = 'Hub mail files';
export const FOLDER_SETTING = 'reports.mail_folder';
const CHUNK = 4000;

export interface MailSheetDeps {
  fetch: typeof fetch;
  token: (env: Env) => Promise<string>;
}

const live: MailSheetDeps = { fetch: (...a) => fetch(...a), token: (env) => saToken(env, fetch, SCOPE) };

async function call(d: MailSheetDeps, env: Env, url: string, init: RequestInit = {}): Promise<Record<string, any>> {
  const token = await d.token(env);
  const r = await d.fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) } });
  const j = (await r.json().catch(() => ({}))) as Record<string, any>;
  if (!r.ok) throw new HttpError(502, 'google', 'Google did not build the sheet. Try again in a minute.');
  return j;
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** The folder the mail files go in: the id an admin saved, else the one folder with this name in the shared drive. */
export async function mailFolder(env: Env, d: MailSheetDeps = live): Promise<string> {
  const saved = (await hubGet(env, FOLDER_SETTING))?.value?.trim() || (env as Env & { REPORTS_MAIL_FOLDER?: string }).REPORTS_MAIL_FOLDER?.trim() || '';
  if (saved) return saved;
  const found = await call(
    d,
    env,
    `${FILES}?q=${encodeURIComponent(`name = '${q(FOLDER_NAME)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`)}&corpora=allDrives&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id)`
  );
  const id = found.files?.[0]?.id as string | undefined;
  if (!id) throw new HttpError(503, 'no_folder', 'The mail files folder is not set up. Tell the technology team through Feedback.');
  return id;
}

export interface MadeSheet {
  id: string;
  url: string;
  title: string;
  rows: number;
}

export async function makeMailSheet(env: Env, title: string, tab: string, header: string[], rows: string[][], d: MailSheetDeps = live): Promise<MadeSheet> {
  const parent = await mailFolder(env, d);
  const file = await call(d, env, `${FILES}?supportsAllDrives=true&fields=id,webViewLink`, {
    method: 'POST',
    body: JSON.stringify({ name: title, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [parent] }),
  });
  const id = String(file.id);
  const url = String(file.webViewLink || `https://docs.google.com/spreadsheets/d/${id}/edit`);
  try {
    await call(d, env, `${SHEETS}/${id}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          { updateSheetProperties: { properties: { sheetId: 0, title: tab.slice(0, 80), gridProperties: { rowCount: Math.max(rows.length + 1, 2), columnCount: header.length, frozenRowCount: 1 } }, fields: 'title,gridProperties(rowCount,columnCount,frozenRowCount)' } },
          { repeatCell: { range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
        ],
      }),
    });
    const all = [header, ...rows];
    for (let at = 0; at < all.length; at += CHUNK) {
      const part = all.slice(at, at + CHUNK);
      await call(d, env, `${SHEETS}/${id}/values/${encodeURIComponent(`'${tab.slice(0, 80).replace(/'/g, "''")}'!A${at + 1}`)}?valueInputOption=RAW`, {
        method: 'PUT',
        body: JSON.stringify({ values: part }),
      });
    }
  } catch (err) {
    // The service account cannot delete the file, so it is renamed and left for a person to remove.
    await call(d, env, `${FILES}/${id}?supportsAllDrives=true`, { method: 'PATCH', body: JSON.stringify({ name: `UNFINISHED ${title}` }) }).catch(() => undefined);
    throw err;
  }
  return { id, url, title, rows: rows.length };
}
