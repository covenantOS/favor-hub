import { driveContent, driveThumb } from '../../_lib/chat/preview';
import { accessToken } from '../../_lib/hub/google';
import { errorJson, handleError, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

// A file from Shared with you on Today, drawn in the FavorOS file viewer (the one Chat uses). Google confirms first that this person
// can see the file with their own connection; the pages and the picture then come from the same preview code Chat uses.
//   GET /api/hub/day-file?id=<drive id>&v=content|thumb[&s=<size>]
const DRIVE = 'https://www.googleapis.com/drive/v3/files/';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user || user.via !== 'google') return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const url = new URL(request.url);
    const id = url.searchParams.get('id') || '';
    if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return errorJson('not_found', 'That file is gone.', 404);
    const t = await accessToken(env, user.email.toLowerCase()).catch(() => null);
    if (!t) return errorJson('consent', 'Connect your Google account first.', 409);
    const seen = await fetch(`${DRIVE}${id}?fields=id&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${t.token}` } });
    if (!seen.ok) return errorJson('not_found', 'That file is gone.', 404);
    const size = Math.max(200, Math.min(2000, Number(url.searchParams.get('s')) || 1600));
    if (url.searchParams.get('v') === 'thumb') {
      // The shared-drive reader first; a file only this person can see falls back to the picture Drive draws for them.
      const viaHub = await driveThumb(env, id, size).catch(() => null);
      if (viaHub && viaHub.ok) return viaHub;
      const meta = await fetch(`${DRIVE}${id}?fields=thumbnailLink&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${t.token}` } });
      const link = meta.ok ? ((await meta.json().catch(() => ({}))) as { thumbnailLink?: string }).thumbnailLink : '';
      if (!link) return errorJson('no_preview', 'No picture for this file.', 404);
      const pic = await fetch(link.replace(/=s\d+$/, `=s${size}`), { headers: { Authorization: `Bearer ${t.token}` } });
      if (!pic.ok) return errorJson('no_preview', 'No picture for this file.', 404);
      return new Response(pic.body, { headers: { 'Cache-Control': 'private, max-age=600', 'Content-Type': pic.headers.get('Content-Type') || 'image/png', 'X-Content-Type-Options': 'nosniff' } });
    }
    // The viewer reads a 404 as "this file is gone"; a file the hub cannot read answers 502 so the viewer offers Drive instead.
    return await driveContent(env, id).catch(() => errorJson('no_preview', 'FavorOS cannot show this file. Open it in Drive.', 502));
  } catch (err) {
    return handleError(err);
  }
};
