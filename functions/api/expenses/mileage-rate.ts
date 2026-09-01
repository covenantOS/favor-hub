import { getMileageSettings } from '../../_lib/expenses/db';
import { handleError, json, type Env } from '../../_lib/http';

// Public and unauthenticated on purpose: the request form needs this before anyone has signed in,
// and a per-mile rate plus a deduction figure aren't sensitive.
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const mileage = await getMileageSettings(env);
    return json({ ok: true, ...mileage });
  } catch (err) {
    return handleError(err);
  }
};
