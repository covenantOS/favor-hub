// Photo triage for gift entry. Clef sorts each photo before any reader runs: a check, a reply slip, an envelope, another document, or
// an unreadable photo. An envelope is skipped. An unreadable photo asks for a retake. Everything else goes on to the readers as before.
// Measured 2026-10-10 on 103 photos from the mail (55 checks): @cf/cloudflare/clef called 97 of 103 right (94.2%), 0 checks missed,
// 6 non-checks called checks. The same run of @cf/cloudflare/clef-omni scored 73 of 103 (70.9%) and missed 4 checks, so the
// model here is the large Clef. A low-confidence envelope or unreadable call never skips or stops a photo: it goes to the readers.
import type { Env } from '../http';

export const TRIAGE_MODEL = '@cf/cloudflare/clef';
/** Below this probability an envelope or unreadable call is not trusted, and the photo is read. */
export const TRIAGE_MIN_P = 0.5;

export type PhotoKind = 'check' | 'reply_slip' | 'envelope' | 'other' | 'unreadable';

export interface Triage {
  kind: PhotoKind;
  p: number;
  secs: number;
  error: string | null;
}

const CRITERIA: Record<string, string> = {
  check: 'A bank check, personal, business, DAF or foundation check, showing a pay-to line and an amount',
  reply_slip: 'A printed reply slip, coupon or response card from a mailing, with giving options or a return address block',
  envelope: 'A mailing envelope, front or back, with no check or slip visible',
  other_document: 'A letter, check stub, remittance advice, email, chat screenshot or statement that is not itself a check',
  unreadable: 'Too blurry, dark, cropped or empty to tell what it is',
};

const KIND_OF: Record<string, PhotoKind> = {
  check: 'check',
  reply_slip: 'reply_slip',
  envelope: 'envelope',
  other_document: 'other',
  unreadable: 'unreadable',
};

export function triageInput(dataUrl: string) {
  return {
    model: TRIAGE_MODEL.split('/').pop(),
    state: 'Photo of one item from the mail.',
    questions: {
      kind: {
        type: 'choice',
        instructions: 'What kind of item is shown in this photo of mail received at a ministry office?',
        criteria: CRITERIA,
      },
      card: { type: 'noul', instructions: 'Does the photo show a credit or debit card number?' },
    },
    images: [dataUrl],
  };
}

type Runner = (model: string, input: unknown) => Promise<unknown>;

/** Reads Clef's answer for the kind question. Any failure answers 'other', so the photo goes on to the readers. */
export async function triageWith(run: Runner, dataUrl: string): Promise<Triage> {
  const started = Date.now();
  const secs = () => Math.round((Date.now() - started)) / 1000;
  try {
    const out: any = await run(TRIAGE_MODEL, triageInput(dataUrl));
    const body = out && typeof out === 'object' && out.result && typeof out.result === 'object' ? out.result : out;
    const choice: unknown = body?.answers?.kind?.choice;
    const probs: Record<string, unknown> = body?.answers?.kind?.probabilities || {};
    if (typeof choice !== 'string' || !(choice in KIND_OF)) return { kind: 'other', p: 0, secs: secs(), error: 'no kind answer' };
    const p = Number(probs[choice]);
    const pp = Number.isFinite(p) ? p : 0;
    let kind = KIND_OF[choice];
    if ((kind === 'envelope' || kind === 'unreadable') && pp < TRIAGE_MIN_P) kind = 'other';
    return { kind, p: pp, secs: secs(), error: null };
  } catch (e: any) {
    return { kind: 'other', p: 0, secs: secs(), error: String(e && e.message ? e.message : e).slice(0, 200) };
  }
}

export async function triagePhoto(env: Pick<Env, 'AI'>, dataUrl: string): Promise<Triage> {
  const ai = env.AI;
  if (!ai) return { kind: 'other', p: 0, secs: 0, error: 'The triage model is not connected.' };
  return triageWith((m, i) => ai.run(m as any, i as any), dataUrl);
}
