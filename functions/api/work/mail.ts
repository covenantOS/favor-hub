import { savePrefs, SECTION_KEYS } from '../../_lib/work/digest';
import { mailView, personOf } from '../../_lib/work/mailme';
import { body, work } from '../../_lib/work/route';

// The signed-in person's morning email settings: which sections, 7:30 or 8:00 or off, and whether to skip an empty day.
export const onRequestGet = work(async ({ env, wu }) => (await mailView(env, await personOf(env, wu))) as any);

export const onRequestPut = work(async ({ request, env, wu }) => {
  const b = await body(request);
  const person = await personOf(env, wu);
  const sections: Record<string, boolean> = {};
  if (b.sections && typeof b.sections === 'object') for (const k of SECTION_KEYS) if (k in b.sections) sections[k] = !!b.sections[k];
  await savePrefs(env, person.email, { sections: sections as any, send_time: b.send_time, skip_empty: b.skip_empty });
  return (await mailView(env, person)) as any;
});
