import { expensePdfResponse } from '../../../_lib/expenses/pdfroute';
import { handleError, type Env } from '../../../_lib/http';

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    return await expensePdfResponse(env, request, String(params.id || ''));
  } catch (err) {
    return handleError(err);
  }
};
