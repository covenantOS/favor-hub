import { requireReceiptsUser } from '../../_lib/receipts/auth';
import { cleanCopy } from '../../_lib/receipts/letter';
import { buildPdf } from '../../_lib/receipts/pdf';
import { appealCode, type Letter } from '../../_lib/receipts/rules';
import { fonts, getCopy, paper, signature, todayEastern } from '../../_lib/receipts/store';
import { handleError, type Env } from '../../_lib/http';

const SAMPLE = {
  giftId: '0',
  giftLookup: '0',
  constituentLookup: '0',
  sortName: 'Partner, Sample',
  addressee: 'Sample Partner',
  greetingFull: 'Sample Partner',
  greetingFirst: 'Sample',
  addressLines: ['1234 Example Street'],
  cityLine: 'Valrico, FL 33596-0000',
  fund: 'Where Needed Most',
};

/** One page on a picture of the receipt paper with made-up details. POST a wording to see it before saving. */
async function sample(request: Request, env: Env, copyIn: unknown): Promise<Response> {
  await requireReceiptsUser(env, request);
  const kind = new URL(request.url).searchParams.get('kind') || 'regular';
  const today = todayEastern();
  const letter: Letter = {
    ...SAMPLE,
    giftDate: today,
    segment: kind === 'major' ? 'major' : kind === 'recurring' ? 'recurring' : 'regular',
    amount: kind === 'major' ? 500 : kind === 'recurring' ? 50 : 25,
    giftType: kind === 'recurring' ? 'Recurring Gift Payment' : 'One-Time Gift',
  };
  const copy = copyIn ? cleanCopy(copyIn) : await getCopy(env);
  const pdf = await buildPdf({
    letters: [letter],
    letterDate: today,
    appealCode: appealCode(today),
    copy,
    fonts: await fonts(env),
    signature: await signature(env),
    paper: await paper(env),
    title: 'Sample thank-you receipt',
  });
  return new Response(pdf, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="sample-receipt.pdf"', 'Cache-Control': 'no-store' },
  });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    return await sample(request, env, null);
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as { copy?: unknown };
    return await sample(request, env, body.copy ?? null);
  } catch (err) {
    return handleError(err);
  }
};
