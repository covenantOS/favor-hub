import { route } from '../../_lib/statements/route';
import { buildPdf } from '../../_lib/statements/pdf';
import { sampleStatement } from '../../_lib/statements/sample';
import { pdfAssets, todayEastern } from '../../_lib/statements/service';
import { getCopy } from '../../_lib/statements/store';

// A sample statement for an invented partner, in the wording now saved in Admin, for reading and approving the words.
export const onRequestGet = route(async ({ env }) => {
  const year = Number(todayEastern().slice(0, 4)) - 1;
  const pdf = await buildPdf({
    statements: [sampleStatement(year)],
    copy: await getCopy(env),
    yearEnd: true,
    issued: todayEastern(),
    ...(await pdfAssets(env)),
    title: `Sample giving statement ${year}`,
  });
  return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="sample-giving-statement.pdf"', 'Cache-Control': 'no-store' } });
});
