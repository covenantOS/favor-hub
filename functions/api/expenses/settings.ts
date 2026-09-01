import { requireExpenseAdmin } from '../../_lib/expenses/auth';
import { addOverride, getMileageSettings, getSettings, listOverrides, removeOverride, saveMileageSettings, saveSettings } from '../../_lib/expenses/db';
import { HttpError, asTrimmed, handleError, json, type Env } from '../../_lib/http';
import { isEmail } from '../../_lib/notify';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireExpenseAdmin(env, request);
    return json({
      ok: true,
      settings: await getSettings(env),
      mileage: await getMileageSettings(env),
      overrides: await listOverrides(env),
    });
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireExpenseAdmin(env, request);
    const data = (await request.json()) as Record<string, unknown>;
    const approver_name = asTrimmed(data.approver_name, 'approver_name', 80);
    const approver_email = asTrimmed(data.approver_email, 'approver_email', 120);
    if (!isEmail(approver_email)) throw new HttpError(400, 'bad_email', 'Approver email is not valid.');
    const distribution = (Array.isArray(data.distribution) ? data.distribution : [])
      .map((e) => String(e).trim())
      .filter(Boolean);
    for (const e of distribution) {
      if (!isEmail(e)) throw new HttpError(400, 'bad_email', `Distribution email "${e}" is not valid.`);
    }
    await saveSettings(env, { approver_name, approver_email, distribution });

    const rate_cents = Math.round(Number(data.mileage_rate_cents));
    if (!Number.isFinite(rate_cents) || rate_cents <= 0 || rate_cents > 500) {
      throw new HttpError(400, 'bad_mileage_rate', 'Mileage rate must be in cents, between 1 and 500.');
    }
    const deduction_miles = Math.round(Number(data.mileage_deduction_miles));
    if (!Number.isFinite(deduction_miles) || deduction_miles < 0 || deduction_miles > 500) {
      throw new HttpError(400, 'bad_mileage_deduction', 'Mileage deduction must be between 0 and 500 miles.');
    }
    await saveMileageSettings(env, { rate_cents, deduction_miles });

    return json({ ok: true, settings: await getSettings(env), mileage: await getMileageSettings(env) });
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireExpenseAdmin(env, request);
    const data = (await request.json()) as Record<string, unknown>;
    const start_date = asTrimmed(data.start_date, 'start_date', 10);
    const end_date = asTrimmed(data.end_date, 'end_date', 10);
    const name = asTrimmed(data.name, 'name', 80);
    const email = asTrimmed(data.email, 'email', 120);
    if (!DATE.test(start_date) || !DATE.test(end_date)) throw new HttpError(400, 'bad_date', 'Dates must be YYYY-MM-DD.');
    if (end_date < start_date) throw new HttpError(400, 'bad_date', 'End date is before the start date.');
    if (!isEmail(email)) throw new HttpError(400, 'bad_email', 'Substitute email is not valid.');
    await addOverride(env, { start_date, end_date, name, email });
    return json({ ok: true, overrides: await listOverrides(env) }, 201);
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireExpenseAdmin(env, request);
    const id = new URL(request.url).searchParams.get('id') || '';
    if (!id.startsWith('ovr_')) throw new HttpError(400, 'bad_id', 'Unknown override.');
    await removeOverride(env, id);
    return json({ ok: true, overrides: await listOverrides(env) });
  } catch (err) {
    return handleError(err);
  }
};
