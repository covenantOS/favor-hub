import { requireReceiptsUser } from '../../../../_lib/receipts/auth';
import { cleanCopy } from '../../../../_lib/receipts/letter';
import { buildPdf } from '../../../../_lib/receipts/pdf';
import { fonts, getBatch, paper, signature } from '../../../../_lib/receipts/store';
import { HttpError, handleError, type Env } from '../../../../_lib/http';

/** The print file as made. ?proof=1 draws the same pages on a picture of the receipt paper, for checking on screen. */
export const onRequestGet: PagesFunction<Env, 'id'> = async ({ request, env, params }) => {
  try {
    await requireReceiptsUser(env, request);
    const batch = await getBatch(env, String(params.id));
    const url = new URL(request.url);
    const name = `thank-you-receipts-${batch.letter_date}${batch.kind === 'reprint' ? '-reprint' : ''}`;
    if (url.searchParams.get('proof') === '1') {
      const pdf = await buildPdf({
        letters: JSON.parse(batch.letters),
        letterDate: batch.letter_date,
        appealCode: batch.appeal_code,
        copy: cleanCopy(JSON.parse(batch.copy)),
        fonts: await fonts(env),
        signature: await signature(env),
        paper: await paper(env),
        title: `Proof: thank-you receipts, ${batch.letter_date}`,
      });
      return new Response(pdf, {
        headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}-proof.pdf"`, 'Cache-Control': 'no-store' },
      });
    }
    const obj = await env.UPLOADS.get(batch.pdf_key);
    if (!obj) throw new HttpError(404, 'gone', 'The print file is missing from storage.');
    const download = url.searchParams.get('download') === '1';
    return new Response(obj.body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return handleError(err);
  }
};
