import { HttpError } from '../../_lib/http';
import { adminRoute, readBody } from '../../_lib/admin/route';
import { AUDIENCE_LABEL, applyReportRoles, originalRoles, savedReportRoles } from '../../_lib/admin/reportRoles';
import { audit, hubDel, hubPut } from '../../_lib/admin/settings';
import { ALL_AUDIENCES, CATALOG, GROUPS, isReady } from '../../_lib/reports/registry';

const list = async (env: any) => {
  await applyReportRoles(env);
  const saved = await savedReportRoles(env);
  return {
    audiences: ALL_AUDIENCES.map((a) => ({ value: a, label: AUDIENCE_LABEL[a] })),
    groups: GROUPS,
    reports: CATALOG.map((e) => ({ id: e.id, group: e.group, name: e.name, ready: isReady(e.id), roles: e.audience, original: originalRoles(e.id), saved: !!saved[e.id] })),
  };
};

// Which roles see each report. GET lists the reports with their roles; POST {id, roles: [...]} saves one report's roles, and
// {id, reset: true} puts back the roles the catalog started with. Admins see every report whatever is saved.
export const onRequestGet = adminRoute(async ({ env }) => list(env));

export const onRequestPost = adminRoute(async ({ env, request, user }) => {
  const b = await readBody(request);
  const id = String(b.id || '');
  const entry = CATALOG.find((e) => e.id === id);
  if (!entry) throw new HttpError(404, 'no_report', 'There is no report by that name.');
  await applyReportRoles(env);
  const before = entry.audience.join(', ');
  if (b.reset === true) {
    await hubDel(env, `reports.roles.${id}`);
    await audit(env, { actor: user.email, area: 'reports', key: `reports.roles.${id}`, label: entry.name, before, after: originalRoles(id).join(', '), note: 'reset to the catalog' });
  } else {
    const roles = Array.isArray(b.roles) ? b.roles.map(String) : [];
    if (roles.some((r) => !(ALL_AUDIENCES as string[]).includes(r))) throw new HttpError(400, 'bad_role', 'Pick roles from the list.');
    const clean = ALL_AUDIENCES.filter((a) => roles.includes(a));
    if (clean.join(',') !== entry.audience.join(',')) {
      await hubPut(env, `reports.roles.${id}`, JSON.stringify(clean), user.email);
      await audit(env, { actor: user.email, area: 'reports', key: `reports.roles.${id}`, label: entry.name, before, after: clean.join(', ') });
    }
  }
  return list(env);
});
