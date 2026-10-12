/* Pickers: owner, due date, priority, status, section, codes and tasks. Each returns a promise; undefined means dismissed. */
import { choose, openSheet, esc, icon, todayStr, addDays, mondayOf, dueLabel, PRIORITY, STATUS, debounce, phone } from './ui-util.js';
import { codes, CODE_KINDS, api } from './ui-data.js';
import { pickPerson, ready } from './ui-mentions.js';

/** Resolves to {email} (email null clears) or null when dismissed. */
export async function pickOwner({ title = 'Assign to', current, clear = 'No owner', exclude } = {}) {
  await ready();
  return pickPerson({ title, current, clear, exclude });
}

/** Resolves to a YYYY-MM-DD string, null for "no date", undefined when dismissed. */
export async function pickDate({ anchor, value, title = 'Due date' }) {
  const t = todayStr();
  const items = [
    { value: t, label: 'Today', hint: dueLabel(t).length ? '' : '' },
    { value: addDays(t, 1), label: 'Tomorrow' },
    { value: addDays(mondayOf(t), 7), label: 'Next Monday' },
    { value: addDays(t, 7), label: 'In a week' },
    { value: '__pick', label: 'Pick a date' },
  ];
  if (value) items.push({ value: null, label: 'No date' });
  items.forEach((i) => { if (i.value === value) i.on = true; });
  const v = await choose({ anchor, title, items });
  if (v === undefined || v === null || v !== '__pick') return v;
  return new Promise((resolve) => {
    let out;
    const s = openSheet({ title, cls: 'pj-sheet--date', html: `<input type="date" class="pj-date" data-d value="${esc(value || t)}" aria-label="${esc(title)}" /><div class="pj-sheet__foot"><button type="button" class="pj-btn" data-sheet-x>Cancel</button><button type="button" class="pj-btn pj-btn--primary" data-set>Set date</button></div>`, onClose: () => resolve(out) });
    const d = s.body.querySelector('[data-d]');
    setTimeout(() => { d.focus(); if (d.showPicker && !phone()) { try { d.showPicker(); } catch (_) { /* needs a gesture */ } } }, 30);
    const set = () => { if (d.value) { out = d.value; s.close(); } };
    s.body.querySelector('[data-set]').addEventListener('click', set);
    d.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); set(); } });
  });
}

export const pickPriority = ({ anchor, value }) => choose({ anchor, title: 'Priority', items: Object.entries(PRIORITY).reverse().map(([v, l]) => ({ value: v, label: l, on: v === value, icon: v === 'high' ? 'flag' : undefined })) });

export const pickStatus = ({ anchor, value }) => choose({ anchor, title: 'Status', items: ['open', 'doing', 'waiting', 'done'].map((v) => ({ value: v, label: STATUS[v], on: v === value })) });

export function pickSection({ anchor, sections, value, none = 'No section' }) {
  const items = sections.map((s) => ({ value: s.id, label: s.name, on: s.id === value }));
  items.push({ value: null, label: none, on: !value });
  return choose({ anchor, title: 'Section', items });
}

/** Choose a Blackbaud code of one kind from the searchable list. Resolves to a code, null to remove it, undefined when dismissed. */
export function pickCode({ anchor, kind, value }) {
  const k = CODE_KINDS.find((x) => x.kind === kind);
  const build = (list, q) => {
    const items = list.map((c) => ({ value: c.code, label: c.code, hint: c.description, on: c.code === value }));
    if (value && !items.some((i) => i.value === value)) items.unshift({ value, label: value, hint: 'Current code', on: true });
    const typed = String(q || '').trim().toUpperCase().slice(0, 40);
    if (typed && !list.some((c) => c.code.toUpperCase() === typed)) items.push({ value: typed, label: 'Use ' + typed, hint: 'Not in the list', icon: 'plus' });
    if (value) items.push({ value: null, label: 'Remove ' + k.label.toLowerCase() + ' code', icon: 'x' });
    return items;
  };
  return choose({ anchor, title: k.label + ' code', search: true, placeholder: 'Search ' + k.label.toLowerCase() + ' codes', items: [], source: async (q) => build(await codes(kind, q), q) });
}

/** Find a task to link (blockers). Resolves to a task ref or undefined. */
export function pickTask({ anchor, title = 'Find a task', exclude = [] }) {
  const map = new Map();
  return choose({
    anchor, title, search: true, placeholder: 'Search by title or code', items: [],
    source: async (q) => {
      const d = await api.tasks({ q, status: 'open', limit: 25 });
      return (d.tasks || []).filter((t) => !exclude.includes(t.id)).map((t) => { map.set(t.id, t); return { value: t.id, label: t.title, hint: t.code || 'Personal task' }; });
    },
  }).then((id) => (id ? map.get(id) : undefined));
}

export { debounce, icon };
