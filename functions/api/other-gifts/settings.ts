import { og, jsonBody } from '../../_lib/other-gifts/route';
import { ogMode, setOgMode } from '../../_lib/other-gifts/access';

// Admins: the one switch. off (staff do not see Other gifts), admins, or on (everyone who can open Gift entry). Will turns it on after Michael agrees.
export const onRequestGet = og(async ({ env }) => ({ mode: await ogMode(env) }), { adminOnly: true });

export const onRequestPut = og(
  async ({ env, request, actor }) => {
    const b = await jsonBody(request);
    return { mode: await setOgMode(env, actor, String(b.mode || '')) };
  },
  { adminOnly: true }
);
