import { work, body } from '../../../_lib/work/route';
import { lettersFor, pickRows } from '../../../_lib/work/hqty';
import { lettersPdf } from '../../../_lib/work/letters-pdf';
import { cleanLetterText } from '../../../_lib/work/letters';
import { todayEt } from '../../../_lib/work/service';


// The print file: one page per gift named in ?ids=1,2,3 (100 or fewer). Printing is not a step; the page marks Printed itself.
export const onRequestGet = work(async ({ ctx, url }) => {
  const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean);
  const { raw, rows } = await pickRows(ctx, ids);
  const today = todayEt();
  const bytes = await lettersPdf(lettersFor(raw, rows, today), `HQTY letters, ${today}`);
  return new Response(bytes as BodyInit, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="hqty-letters-${today}.pdf"`, 'Cache-Control': 'no-store' } });
});

// The merged pages as data, for the preview. A month's text that is being edited can ride along as { text } and is not saved.
export const onRequestPost = work(async ({ request, ctx }) => {
  const b = await body(request);
  const { raw, rows } = await pickRows(ctx, b.ids);
  const today = todayEt();
  const override = typeof b.text === 'string' && b.text.trim() ? cleanLetterText(b.text) : undefined;
  return { letters: lettersFor(raw, rows, today, override).map((l, i) => ({ giftId: rows[i].giftId, ...l })) };
});
