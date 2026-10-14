// A repeating meeting's one link (/meet/s/?id=<series>): the calendar event for the whole series carries it, and it opens the
// occurrence that is on now or next, each with its own room and notes. With &k= it opens the guest door for that occurrence.
import { currentOf } from '../../_lib/meetseries';
import type { MeetEnv } from '../../_lib/meet';

export const onRequestGet: PagesFunction<MeetEnv> = async ({ request, env }) => {
  const url = new URL(request.url);
  const sid = url.searchParams.get('id') || '';
  const k = url.searchParams.get('k') || '';
  if (!/^[0-9a-f]{24}$/.test(sid)) return Response.redirect(`${url.origin}/meet/`, 302);
  const id = await currentOf(env, sid).catch(() => '');
  if (!id) return Response.redirect(`${url.origin}/meet/`, 302);
  if (k && /^[0-9a-f]{32}$/.test(k)) return Response.redirect(`${url.origin}/meet/g/?m=${id}&k=${k}`, 302);
  return Response.redirect(`${url.origin}/meet/room/?m=${id}`, 302);
};
