import { HttpError } from '../../_lib/http';
import { adminRoute, readBody } from '../../_lib/admin/route';
import { changeSetting, readArea, type Area } from '../../_lib/admin/settings';
import { areaExtras } from '../../_lib/admin/extras';

const AREAS = new Set(['work', 'meetings', 'brain', 'clips', 'reports', 'expenses', 'receipts']);

// One tab of settings: GET ?area=work|meetings|brain|clips|reports returns each setting with its value, default and where it lives,
// plus read-only facts for the tab. POST {id, value, confirm?, reset?} saves one and records it in the audit log.
export const onRequestGet = adminRoute(async ({ env, url }) => {
  const area = url.searchParams.get('area') || '';
  if (!AREAS.has(area)) throw new HttpError(400, 'bad_area', 'Pick work, meetings, brain, clips, reports, expenses or receipts.');
  return { area, settings: await readArea(env, area as Area), extras: await areaExtras(env, area as Area) };
});

export const onRequestPost = adminRoute(async ({ env, request, user }) => {
  const b = await readBody(request);
  const id = String(b.id || '');
  const setting = await changeSetting(env, user.email, id, b.value, { confirm: b.confirm === true, reset: b.reset === true });
  return { setting };
});
