import { HttpError, handleError, json, type Env } from '../../../_lib/http';
import { hubUserOf } from '../../../_lib/session';
import { listDevices } from '../../../_lib/mobile/device';

// The signed-in phones for the caller. An admin may pass ?email= to see another person's.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user || user.via === 'agent') throw new HttpError(401, 'signin', 'Sign in first.');
    const asked = (new URL(request.url).searchParams.get('email') || '').trim().toLowerCase();
    if (asked && asked !== user.email.toLowerCase() && user.role !== 'admin') throw new HttpError(403, 'admin_only', 'Only an admin can list another person’s phones.');
    return json({ ok: true, devices: await listDevices(env, asked || user.email) });
  } catch (err) {
    return handleError(err);
  }
};
