// Admin > Appeal codes: the small decisions the page makes before it asks the server, kept here so a test can run them.
import type { AppealsAnswer, Prefix } from './api';

export interface Draft {
  letter: string;
  date: string;
  suffix: string;
  title: string;
  description: string;
  category: string;
}

/** The kind the form starts on and what each kind sets: its hint, the date label, the suffix hint, the category and whether the -WS twin starts ticked. */
export function kindFill(d: Pick<AppealsAnswer, 'prefixes' | 'categories'>, letter: string) {
  const p: Prefix = d.prefixes.filter((x) => x.letter === letter)[0] || d.prefixes[0];
  const has = d.categories.some((c) => c.category === p.category);
  return {
    hint: p.hint,
    dateLabel: p.letter === 'N' ? 'Send date' : 'Start date',
    placeholder: p.letter === 'N' ? 'EMW and the week, filled in for you' : p.suffix || '',
    category: has ? (p.category as string) : '',
    online: p.letter === 'L',
  };
}

/** What the create button says happened, one phrase per code, then the wiring lines. */
export function createdText(d: { created: Array<{ ok: boolean; code: string; error?: string }>; wiring: string[] }): string {
  return d.created.map((c) => (c.ok ? 'Created ' + c.code + '.' : c.code + ': ' + c.error)).join(' ') + ' ' + d.wiring.join(' ');
}

/** The create button is live only when the preview built at least one code and none of them is already in Blackbaud. */
export const canCreate = (busy: boolean, built: unknown[], exists: unknown[]) => !busy && built.length > 0 && exists.length === 0;
