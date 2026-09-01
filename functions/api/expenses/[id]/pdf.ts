import { requireExpenseAdmin } from '../../../_lib/expenses/auth';
import { getExpense } from '../../../_lib/expenses/db';
import { errorJson, handleError, type Env } from '../../../_lib/http';

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    await requireExpenseAdmin(env, request);
    const id = String(params.id || '');
    const row = await getExpense(env, id);
    if (!row || !row.pdf_r2_key) return errorJson('not_found', 'No PDF for that request.', 404);
    const obj = await env.UPLOADS.get(row.pdf_r2_key);
    if (!obj) return errorJson('not_found', 'The PDF is missing from storage.', 404);
    return new Response(obj.body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="FAVOR-${row.doc_number}-signed.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return handleError(err);
  }
};
