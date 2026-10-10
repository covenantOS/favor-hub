import { buildFor, gather, getPrefs } from '../../../_lib/work/digest';
import { personOf } from '../../../_lib/work/mailme';
import { work } from '../../../_lib/work/route';

// The email as this person would get it right now, for the settings dialog. Nothing is sent.
export const onRequestGet = work(async ({ env, wu }) => {
  const person = await personOf(env, wu);
  const data = await gather(env, [person]);
  const b = await buildFor(env, person, data, await getPrefs(env, person.email));
  return { subject: b.subject, html: b.html, empty: b.empty, counts: b.counts, to: person.email, name: person.name } as any;
});
