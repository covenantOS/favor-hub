import { requireExpenseAdmin, setExpenseCode } from '../../_lib/expenses/auth';
import { HttpError, asTrimmed, errorJson, handleError, json, type Env } from '../../_lib/http';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireExpenseAdmin(env, request);
    const body = (await request.json()) as { code?: unknown; confirm?: unknown };
    const code = asTrimmed(body.code, 'code', 64);
    const confirm = asTrimmed(body.confirm, 'confirm', 64);
    if (code.length < 4) throw new HttpError(400, 'short_code', 'The code needs at least 4 characters.');
    if (code.length > 64) throw new HttpError(400, 'long_code', 'Keep the code under 64 characters.');
    if (code !== confirm) throw new HttpError(400, 'code_mismatch', 'The two codes do not match.');
    await setExpenseCode(env, code);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
};
