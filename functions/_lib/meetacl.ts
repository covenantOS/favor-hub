// Meetings: who can open a meeting's files in Google Drive (Will, 2026-10-14).
// The Meetings folder in US Team Files is a limited-access folder (inheritedPermissionsDisabled), so drive members do not get
// in by membership. Drive managers still do; Drive gives them every folder. Each notes Doc and recording is shared by name with
// the people the notes rule allows: the host, made hosts, staff invitees, staff who were in the room, the leaders of a team with
// someone on the roster, and hub admins. Host and admins write, the rest read. Never a notification email.
// "Anyone at Favor with the link" grants are removed: the workspace adds one to some files the service account makes.
// FavorOS's own player streams through the service account and keeps its own rule (mayReadNotes).
import { saToken } from './work/sheetsa';
import { emailsOf, type Meeting, type MeetEnv } from './meet';
import { isHiddenAccount, isTester } from './testuser';

const FILES = 'https://www.googleapis.com/drive/v3/files';
/** Only Favor Google accounts get a Drive grant: outside invitees and calendar groups read the notes in FavorOS or not at all. */
const STAFF_RE = /^[^@\s]+@favorintl\.org$/i;

export interface Audience { writers: string[]; readers: string[] }

/** Who gets each file, from the meeting row, the staff who were present, the team leaders and the admins. Pure, for tests. */
export function audienceOf(m: Pick<Meeting, 'host_email' | 'cohosts' | 'invitees'>, present: string[], leaders: string[], admins: string[]): Audience {
  const ok = (e: string) => STAFF_RE.test(e) && !isHiddenAccount(e);
  const norm = (xs: string[]) => [...new Set(xs.map((x) => String(x || '').trim().toLowerCase()).filter(ok))];
  const adminList = norm(admins);
  if (isTester(m.host_email)) return { writers: adminList, readers: [] };
  const staffInvitees = safeList(m.invitees).filter((i) => !i.guest).map((i) => String(i.email || ''));
  const writers = norm([m.host_email, ...adminList]);
  const readers = norm([...emailsOf(m.cohosts), ...staffInvitees, ...present, ...leaders]).filter((e) => !writers.includes(e));
  return { writers, readers };
}

function safeList(s: string): Array<{ email?: string; guest?: boolean }> {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function audienceFor(env: MeetEnv, m: Meeting): Promise<Audience> {
  const present = (await env.DB.prepare(`SELECT DISTINCT lower(email) AS email FROM hub_meeting_presence WHERE meeting_id = ? AND role != 'guest' AND removed = 0`).bind(m.id).all<{ email: string }>()).results || [];
  const roster = [...new Set([m.host_email, ...emailsOf(m.cohosts), ...emailsOf(m.invitees)].map((e) => e.toLowerCase()))];
  const leaders = roster.length
    ? (await env.DB.prepare(
        `SELECT DISTINCT lower(l.email) AS email FROM meet_directory l WHERE l.lead = 1 AND l.active = 1 AND l.team != ''
            AND l.team IN (SELECT d.team FROM meet_directory d WHERE d.active = 1 AND d.team != '' AND lower(d.email) IN (${roster.map(() => '?').join(', ')}))`
      ).bind(...roster).all<{ email: string }>()).results || []
    : [];
  const admins = (await env.DB.prepare(`SELECT lower(email) AS email FROM hub_users WHERE role = 'admin'`).all<{ email: string }>()).results || [];
  return audienceOf(m, present.map((r) => r.email), leaders.map((r) => r.email), admins.map((r) => r.email));
}

interface Perm { id: string; type: string; role: string; emailAddress?: string; inheritedPermissionsDisabled?: boolean; permissionDetails?: Array<{ inherited?: boolean }> }

const direct = (p: Perm) => !(p.permissionDetails || []).length || (p.permissionDetails || []).some((d) => !d.inherited);

/** Remove "anyone with the link" and domain grants that sit on this file or folder itself. Returns how many went. */
export async function closeLinks(token: string, fileId: string, fetchFn: typeof fetch = fetch): Promise<number> {
  const perms = await listPerms(token, fileId, fetchFn);
  let n = 0;
  for (const p of perms) {
    if ((p.type === 'domain' || p.type === 'anyone') && direct(p)) {
      const r = await fetchFn(`${FILES}/${encodeURIComponent(fileId)}/permissions/${p.id}?supportsAllDrives=true`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (r.ok || r.status === 404) n++;
    }
  }
  return n;
}

async function listPerms(token: string, fileId: string, fetchFn: typeof fetch): Promise<Perm[]> {
  const r = await fetchFn(`${FILES}/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true&pageSize=100&fields=permissions(id,type,role,emailAddress,inheritedPermissionsDisabled,permissionDetails)`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`drive perms ${r.status}`);
  return ((await r.json()) as { permissions?: Perm[] }).permissions || [];
}

export interface FileSync { added: number; changed: number; removed: number; closed: number; failed: string[] }

/** Make one file's direct grants match the audience. Grants held only through the drive (managers) are left alone. */
export async function syncFile(token: string, fileId: string, aud: Audience, saEmail: string, fetchFn: typeof fetch = fetch): Promise<FileSync> {
  const out: FileSync = { added: 0, changed: 0, removed: 0, closed: 0, failed: [] };
  const want = new Map<string, 'writer' | 'reader'>([...aud.readers.map((e) => [e, 'reader'] as const), ...aud.writers.map((e) => [e, 'writer'] as const)]);
  const perms = await listPerms(token, fileId, fetchFn);
  const auth = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const base = `${FILES}/${encodeURIComponent(fileId)}/permissions`;
  const have = new Map<string, Perm>();
  // Drive managers keep access through the drive; Drive folds a grant for them into that one, so none is added.
  const covered = new Set<string>();
  for (const p of perms) {
    if (!direct(p)) {
      if (!p.inheritedPermissionsDisabled && p.emailAddress) covered.add(p.emailAddress.toLowerCase());
      continue;
    }
    if (p.type === 'domain' || p.type === 'anyone') {
      const r = await fetchFn(`${base}/${p.id}?supportsAllDrives=true`, { method: 'DELETE', headers: auth });
      if (r.ok || r.status === 404) out.closed++;
      else out.failed.push(`close ${p.type}`);
      continue;
    }
    const e = String(p.emailAddress || '').toLowerCase();
    if (!e || e === saEmail.toLowerCase()) continue;
    if (p.type === 'user' && !want.has(e)) {
      const r = await fetchFn(`${base}/${p.id}?supportsAllDrives=true`, { method: 'DELETE', headers: auth });
      if (r.ok || r.status === 404) out.removed++;
      else out.failed.push(`remove ${e}`);
      continue;
    }
    have.set(e, p);
  }
  for (const [e, role] of want) {
    const p = have.get(e);
    if (covered.has(e) || (p && p.role === role)) continue;
    if (p && (p.role === 'reader' || p.role === 'writer' || p.role === 'commenter')) {
      const r = await fetchFn(`${base}/${p.id}?supportsAllDrives=true`, { method: 'PATCH', headers: auth, body: JSON.stringify({ role }) });
      if (r.ok) out.changed++;
      else out.failed.push(`role ${e}`);
      continue;
    }
    if (p) continue;
    const r = await fetchFn(`${base}?supportsAllDrives=true&sendNotificationEmail=false`, { method: 'POST', headers: auth, body: JSON.stringify({ type: 'user', role, emailAddress: e }) });
    if (r.ok) out.added++;
    else out.failed.push(`add ${e} ${r.status}`);
  }
  return out;
}

/** Every Drive file a meeting has: the notes Doc and each recording part. */
export async function meetingFiles(env: MeetEnv, m: Meeting): Promise<string[]> {
  const rec = (await env.DB.prepare(`SELECT file_id FROM hub_meeting_drive WHERE meeting_id = ? AND file_id != ''`).bind(m.id).all<{ file_id: string }>()).results || [];
  return [...new Set([m.notes_doc_id, m.drive_file_id, ...rec.map((r) => r.file_id)].filter(Boolean))];
}

/** Share every file of this meeting with its audience. Safe to call again; it only changes what differs. Never throws. */
export async function syncMeetingAcl(env: MeetEnv & { GOOGLE_SA_JSON?: string }, meetingId: string): Promise<FileSync & { files: number }> {
  const total: FileSync & { files: number } = { files: 0, added: 0, changed: 0, removed: 0, closed: 0, failed: [] };
  try {
    const m = await env.DB.prepare('SELECT * FROM hub_meetings WHERE id = ?').bind(meetingId).first<Meeting>();
    if (!m) return total;
    const files = await meetingFiles(env, m);
    if (!files.length) return total;
    const aud = await audienceFor(env, m);
    const token = await saToken(env as never, fetch, 'https://www.googleapis.com/auth/drive');
    const saEmail = saEmailOf(env);
    for (const f of files) {
      try {
        const r = await syncFile(token, f, aud, saEmail);
        total.files++;
        total.added += r.added; total.changed += r.changed; total.removed += r.removed; total.closed += r.closed;
        total.failed.push(...r.failed);
      } catch (err) {
        total.failed.push(`${f}: ${(err as Error).message}`);
      }
    }
    if (total.failed.length) console.warn('[meet] drive acl', meetingId, total.failed.slice(0, 5));
  } catch (err) {
    console.warn('[meet] drive acl', meetingId, err);
  }
  return total;
}

function saEmailOf(env: { GOOGLE_SA_JSON?: string }): string {
  try {
    return String(JSON.parse(env.GOOGLE_SA_JSON || '{}').client_email || '');
  } catch {
    return '';
  }
}
