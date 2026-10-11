import { HttpError } from '../../_lib/http';
import { adminRoute, readBody } from '../../_lib/admin/route';
import { audit } from '../../_lib/admin/settings';
import { addOverride, listOverrides, removeOverride } from '../../_lib/expenses/db';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

const view = async (env: any) => (await listOverrides(env)).map((o) => ({ id: o.id, start: o.start_date, end: o.end_date, name: o.name, email: o.email }));

// Substitute approvers for a date range. POST {start, end, name, email} adds one; POST {remove: id} deletes one. Each change is audited.
export const onRequestPost = adminRoute(async ({ env, request, user }) => {
  const b = await readBody(request);
  if (b.remove) {
    const id = String(b.remove);
    const row = (await listOverrides(env)).find((o) => o.id === id);
    if (!row) throw new HttpError(404, 'no_sub', 'That substitute is already gone.');
    await removeOverride(env, id);
    await audit(env, { actor: user.email, area: 'expenses', key: 'expenses.substitute', label: 'Substitute approver', before: `${row.name}, ${row.start_date} to ${row.end_date}`, after: '(removed)' });
    return { subs: await view(env) };
  }
  const start = String(b.start || '').trim();
  const end = String(b.end || '').trim();
  const name = String(b.name || '').trim().slice(0, 80);
  const email = String(b.email || '').trim().toLowerCase();
  if (!DATE.test(start) || !DATE.test(end)) throw new HttpError(400, 'bad_date', 'Dates are YYYY-MM-DD.');
  if (end < start) throw new HttpError(400, 'bad_date', 'The end date is before the start date.');
  if (!name) throw new HttpError(400, 'bad_value', 'The substitute needs a name.');
  if (!MAIL.test(email)) throw new HttpError(400, 'bad_value', 'Use a full email address for the substitute.');
  await addOverride(env, { start_date: start, end_date: end, name, email });
  await audit(env, { actor: user.email, area: 'expenses', key: 'expenses.substitute', label: 'Substitute approver', before: '(none)', after: `${name}, ${start} to ${end}` });
  return { subs: await view(env) };
});
