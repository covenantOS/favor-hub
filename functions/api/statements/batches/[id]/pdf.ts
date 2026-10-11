import { HttpError } from '../../../../_lib/http';
import { route } from '../../../../_lib/statements/route';
import { getBatch, markDownloaded } from '../../../../_lib/statements/store';

// The print file as made.
export const onRequestGet = route(async ({ env, params, url }) => {
  const b = await getBatch(env, params.id);
  const obj = await env.UPLOADS.get(b.pdf_key);
  if (!obj) throw new HttpError(404, 'gone', 'The print file is missing from storage.');
  await markDownloaded(env, b.id);
  const name = b.kind === 'single' ? `giving-statement-${b.from_date}-${b.to_date}` : `year-end-statements-${b.year}-${b.list}-${b.seq}`;
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${url.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="${name}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
});
