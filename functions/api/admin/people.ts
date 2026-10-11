import { adminRoute, readBody } from '../../_lib/admin/route';
import { ENTRY_TYPES, listPeople, previewFor, savePerson, TEAMS, TEAM_LABEL, type SaveInput } from '../../_lib/admin/people';

// People and roles. GET lists everyone with what they see; GET ?preview=<email> answers what that person would see.
// POST saves one person (only the fields sent change) and writes each changed field to the audit log.
export const onRequestGet = adminRoute(async ({ env, url }) => {
  const who = url.searchParams.get('preview');
  if (who) return { preview: await previewFor(env, who) };
  return { people: await listPeople(env), teams: TEAMS.map((t) => ({ value: t, label: TEAM_LABEL[t] })), entryTypes: ENTRY_TYPES };
});

export const onRequestPost = adminRoute(async ({ env, request, user }) => {
  const b = (await readBody(request)) as SaveInput;
  return { person: await savePerson(env, { email: user.email, name: user.name }, b) };
});
