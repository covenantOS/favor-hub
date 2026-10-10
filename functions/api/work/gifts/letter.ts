import { work, body } from '../../../_lib/work/route';
import { lettersResponse } from '../../../_lib/work/letters-svc';
import { lettersPdf } from '../../../_lib/work/letters-pdf';
import { todayEt } from '../../../_lib/work/service';

// A thank-you letter from a director for a gift on Gifts to thank (Support and admins). POST { items, from, said, designation, words,
// invitation } answers with the merged pages; add pdf: true for the print file. Nothing is written: the page logs the letter through
// /api/work/gifts/thank with how = letter.
export const onRequestPost = work(async ({ request, ctx }) => {
  const b = await body(request);
  const out = await lettersResponse(ctx, b as any);
  if (b.pdf === true) {
    const today = todayEt();
    const bytes = await lettersPdf(out.docs, `Thank-you letters, ${today}`);
    return new Response(bytes as BodyInit, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="thank-you-letters-${today}.pdf"`, 'Cache-Control': 'no-store' } });
  }
  return { letters: out.docs, froms: out.froms, from: out.from };
});
