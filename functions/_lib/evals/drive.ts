// Files the signed evaluation in Google Drive: a folder for the employee under the folder an admin names (US Executive Drive, Operations,
// US Talent), a Google Doc made from the document, and the PDF beside it. The hub signs in as the Favor service account.
// When the folder is not named, or the account cannot write there, nothing is lost: doc_error says why and the PDF still downloads.
import type { Env } from '../http';
import { effective, hubDel, hubPut } from '../admin/settings';
import { saToken } from '../work/sheetsa';
import { buildDocument, docHtml } from './doc';
import { evalPdf } from './pdf';
import { caseOf } from './service';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export async function evalFolder(env: Env): Promise<string> {
  return (await effective(env, 'evals.folder', 'EVAL_DRIVE_FOLDER', '')).trim();
}

export async function setEvalFolder(env: Env, actor: string, raw: string): Promise<string> {
  // Accept a pasted Drive link or a bare id.
  const m = String(raw || '').match(/folders\/([A-Za-z0-9_-]{10,})/) || String(raw || '').match(/^([A-Za-z0-9_-]{10,})$/);
  if (!m && String(raw || '').trim()) throw new Error('Paste the folder link or its id.');
  if (!m) {
    await hubDel(env, 'evals.folder');
    return '';
  }
  await hubPut(env, 'evals.folder', m[1], actor);
  return m[1];
}

export interface Deps {
  token: () => Promise<string>;
  fetch: typeof fetch;
  assets: (path: string) => Promise<Uint8Array | null>;
}

function defaults(env: Env): Deps {
  return {
    token: () => saToken(env, fetch, 'https://www.googleapis.com/auth/drive'),
    fetch: (u, i) => fetch(u, i),
    assets: async (path) => {
      try {
        const r = await env.ASSETS.fetch(new Request(`https://hub.local${path}`));
        return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
      } catch {
        return null;
      }
    },
  };
}

export async function pdfFor(env: Env, caseId: string, deps: Deps = defaults(env)): Promise<{ bytes: Uint8Array; name: string }> {
  const d = await buildDocument(env, caseId);
  const font = await deps.assets('/receipts/fonts/Arimo-Regular.ttf');
  if (!font) throw new Error('The font for the PDF is missing from FavorOS.');
  const logo = await deps.assets('/images/favor-logo-color.png');
  return { bytes: await evalPdf(d, font, logo || undefined), name: `${d.fileName}.pdf` };
}

async function gj(deps: Deps, url: string, init: RequestInit = {}): Promise<Record<string, any>> {
  const t = await deps.token();
  const r = await deps.fetch(url, { ...init, headers: { Authorization: `Bearer ${t}`, ...(init.headers || {}) } });
  const j = (await r.json().catch(() => ({}))) as Record<string, any>;
  if (!r.ok) throw new Error(`Drive said ${r.status}${j?.error?.message ? `: ${j.error.message}` : ''}`);
  return j;
}

async function multipart(deps: Deps, meta: Record<string, unknown>, mime: string, body: Uint8Array | string): Promise<Record<string, any>> {
  const boundary = 'fav' + Math.random().toString(16).slice(2);
  const enc = new TextEncoder();
  const bytes = typeof body === 'string' ? enc.encode(body) : body;
  const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = enc.encode(`\r\n--${boundary}--`);
  const all = new Uint8Array(head.length + bytes.length + tail.length);
  all.set(head, 0);
  all.set(bytes, head.length);
  all.set(tail, head.length + bytes.length);
  return gj(deps, `${UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: all });
}

async function personFolder(deps: Deps, root: string, name: string): Promise<string> {
  const found = await gj(deps, `${FILES}?q=${encodeURIComponent(`'${root}' in parents and name = '${q(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`)}&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id)`);
  if (found.files?.[0]?.id) return found.files[0].id as string;
  const made = await gj(deps, `${FILES}?supportsAllDrives=true&fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [root] }) });
  return made.id as string;
}

/** Makes the Google Doc and the PDF in the employee's folder and records the result on the case. Never throws. */
export async function publish(env: Env, caseId: string, deps: Deps = defaults(env)): Promise<{ url: string; error: string }> {
  const c = await caseOf(env, caseId);
  try {
    const root = await evalFolder(env);
    if (!root) throw new Error('No evaluation folder is named yet. Name it on the Evaluations admin page, then retry.');
    const d = await buildDocument(env, caseId);
    const folder = await personFolder(deps, root, d.meta[0][1] || c.employee_email);
    const doc = await multipart(deps, { name: d.fileName, mimeType: 'application/vnd.google-apps.document', parents: [folder] }, 'text/html', docHtml(d));
    const pdf = await pdfFor(env, caseId, deps);
    await multipart(deps, { name: pdf.name, parents: [folder] }, 'application/pdf', pdf.bytes);
    const url = String(doc.webViewLink || `https://docs.google.com/document/d/${doc.id}/edit`);
    await env.DB.prepare('UPDATE eval_cases SET doc_url = ?, doc_error = NULL WHERE id = ?').bind(url, caseId).run();
    return { url, error: '' };
  } catch (err) {
    const msg = String((err as Error)?.message || err).slice(0, 300);
    await env.DB.prepare('UPDATE eval_cases SET doc_error = ? WHERE id = ?').bind(msg, caseId).run();
    return { url: '', error: msg };
  }
}
