// Drive and Clips for tasks.
//   a folder   every project can have a folder in US Team Files (ensureProjectFolder). It sits in a "Projects" folder next to the
//              Meetings folder (or under the folder an admin names in the setting projects.drive_parent), one folder per project.
//   a list     the files in that folder, to attach (folderFiles).
//   clips      the person's own clips, to attach as the brief or as proof (myClips).
// The folder is made with the Favor service account, inside the shared drive, never in anyone's personal Drive.
import { HttpError, nowIso, type Env } from '../../http';
import { effective } from '../../admin/settings';
import { saToken } from '../../work/sheetsa';
import { lower, type ProjectRow } from '../db';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';
type DriveEnv = Env & { MEET_DRIVE_FOLDER?: string; DRIVE_API_URL?: string };
const api = (env: DriveEnv) => env.DRIVE_API_URL || FILES;

async function gjson(env: DriveEnv, url: string, init: RequestInit = {}): Promise<Record<string, any>> {
  const t = await saToken(env, fetch, 'https://www.googleapis.com/auth/drive');
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${t}`, 'content-type': 'application/json', ...(init.headers || {}) } });
  const j = (await r.json().catch(() => ({}))) as Record<string, any>;
  if (!r.ok) throw new HttpError(502, 'drive', `Google Drive said ${r.status}${j?.error?.message ? ': ' + j.error.message : ''}`);
  return j;
}
const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function findOrMake(env: DriveEnv, parent: string, name: string): Promise<string> {
  const found = await gjson(env, `${api(env)}?q=${encodeURIComponent(`'${parent}' in parents and name = '${q(name)}' and mimeType = '${FOLDER}' and trashed = false`)}&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id)`);
  if (found.files?.[0]?.id) return found.files[0].id as string;
  const made = await gjson(env, `${api(env)}?supportsAllDrives=true&fields=id`, { method: 'POST', body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) });
  return made.id as string;
}

async function meetingsParent(env: DriveEnv): Promise<string> {
  const mf = String(await effective(env, 'meet.drive_folder', 'MEET_DRIVE_FOLDER', '').catch(() => '')).trim();
  if (!mf) throw new HttpError(409, 'no_drive', 'Set the Meetings folder (Admin > Meetings) or the Projects folder (setting projects.drive_parent) first.');
  const f = await gjson(env, `${api(env)}/${encodeURIComponent(mf)}?supportsAllDrives=true&fields=parents`);
  const p = (f.parents as string[] | undefined)?.[0];
  if (!p) throw new HttpError(409, 'no_drive', 'The Meetings folder has no parent folder to put Projects in. Set projects.drive_parent.');
  return p;
}

/** The folder the project folders live in: the admin's setting, else the folder that holds the Meetings folder. */
async function projectsRoot(env: DriveEnv): Promise<string> {
  const set = String(await effective(env, 'projects.drive_parent', undefined, '').catch(() => '')).trim();
  return findOrMake(env, set || (await meetingsParent(env)), 'Projects');
}

export interface FolderInfo { id: string; url: string; created: boolean }

export async function ensureProjectFolder(env: DriveEnv, project: ProjectRow): Promise<FolderInfo> {
  if (project.drive_folder_id) return { id: project.drive_folder_id, url: `https://drive.google.com/drive/folders/${project.drive_folder_id}`, created: false };
  const root = await projectsRoot(env);
  const id = await findOrMake(env, root, `${project.key} ${project.name}`.replace(/[\\/]/g, '-').slice(0, 120));
  await env.DB.prepare('UPDATE hub_projects SET drive_folder_id = ?, updated_at = ? WHERE id = ?').bind(id, nowIso(), project.id).run();
  return { id, url: `https://drive.google.com/drive/folders/${id}`, created: true };
}

export interface DriveFile { name: string; kind: string; path: string; indexed: string; url: string }

const kindOf = (mime: string, name: string) => {
  const t = `${mime} ${name}`.toLowerCase();
  if (/spreadsheet|sheet|excel|csv|xls/.test(t)) return 'sheet';
  if (/presentation|slide|ppt/.test(t)) return 'slides';
  if (/pdf/.test(t)) return 'pdf';
  if (/image|jpe?g|png/.test(t)) return 'photo';
  if (/document|word|docx?/.test(t)) return 'doc';
  return 'file';
};

export async function folderFiles(env: DriveEnv, project: ProjectRow, query = ''): Promise<DriveFile[]> {
  if (!project.drive_folder_id) return [];
  const term = query.trim() ? ` and name contains '${q(query.trim().slice(0, 60))}'` : '';
  const j = await gjson(env, `${api(env)}?q=${encodeURIComponent(`'${project.drive_folder_id}' in parents and trashed = false${term}`)}&supportsAllDrives=true&includeItemsFromAllDrives=true&orderBy=modifiedTime desc&pageSize=40&fields=files(id,name,mimeType,modifiedTime,webViewLink)`);
  return ((j.files as Array<{ name: string; mimeType: string; modifiedTime: string; webViewLink: string }>) || [])
    .filter((f) => f.mimeType !== FOLDER && /^https:\/\/(drive|docs)\.google\.com\//.test(f.webViewLink || ''))
    .map((f) => ({ name: f.name, kind: kindOf(f.mimeType, f.name), path: project.name, indexed: f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '', url: f.webViewLink }));
}

export interface ClipItem { id: string; title: string; duration: string; when: string; status: string }

export async function myClips(env: Env, email: string): Promise<ClipItem[]> {
  const r = await env.DB.prepare(`SELECT id, title, duration_ms, created_at, status FROM hub_clips WHERE lower(owner_email) = ? AND status IN ('ready', 'processing') ORDER BY created_at DESC LIMIT 30`)
    .bind(lower(email)).all<{ id: string; title: string; duration_ms: number; created_at: string; status: string }>().catch(() => ({ results: [] as never[] }));
  return (r.results || []).map((c) => {
    const s = Math.round((c.duration_ms || 0) / 1000);
    return { id: c.id, title: c.title || 'Untitled clip', duration: s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '', when: new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), status: c.status };
  });
}
