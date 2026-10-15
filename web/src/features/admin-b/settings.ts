// The small decisions the settings rows make, kept out of the component so a test can run them (tests/admin-b-web.test.mjs reads this file).
import type { Setting } from './api';

/** The control id the classic rows use, so a label's for= and a test's selector match. */
export const controlId = (settingId: string) => 'f-' + settingId.replace(/\W/g, '-');

/** A value as the confirm box names it: the option's label, "blank", or the number with its unit. */
export function shown(s: Setting, v: string): string {
  const o = (s.options || []).filter((x) => x.value === v)[0];
  return o ? o.label : v === '' ? 'blank' : v + (s.unit ? ' ' + s.unit : '');
}

/** Whether a save asks first: it changes what FavorOS sends to Blackbaud, emails partners, or can add model charges. */
export const needsConfirm = (s: Setting) => !!(s.bb || s.contact || s.spend);

/** The sentence that opens the confirm box, before the two values. */
export function confirmLead(s: Setting): string {
  return s.label + (s.spend ? ' can add model charges past the free allowance. It is ' : s.contact ? ' changes whether FavorOS emails partners. It is ' : ' changes what FavorOS sends to Blackbaud. It is ');
}

/** The reset button's words: a meeting setting or the receipt line falls back to the Pages value, the rest to the default. */
export const resetWord = (s: Setting) => (s.id.indexOf('meet.') === 0 || s.id === 'receipts.report' ? 'the Pages value' : 'the default');

/** Rows of a settings tab grouped in the order their groups first appear. */
export function grouped(list: Setting[]): Array<{ group: string; rows: Setting[] }> {
  const order: string[] = [];
  const by: Record<string, Setting[]> = {};
  list.forEach((s) => {
    const g = s.group || '';
    if (!by[g]) {
      by[g] = [];
      order.push(g);
    }
    by[g].push(s);
  });
  return order.map((g) => ({ group: g, rows: by[g] }));
}
