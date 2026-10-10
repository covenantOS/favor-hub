// Building the Blackbaud changes for each Work Center operation. Pure: every function takes the plain facts and returns the
// bodies to send, plus the "before" values Undo needs. Nothing here reads a database or calls Blackbaud.
//
// Behaviors proven on the test record on 2026-10-09 (Q:\work\favor-bb-audit\wave2\work-center\sky-probe.json):
//   PATCH { completed: true, completed_date }  closes an action; PATCH { completed: false } reopens it (Undo works).
//   PATCH { category }, { outcome: 'Successful' } and { date, fundraisers } all take effect in place.
//   DELETE removes a created action.

export type OpKind = 'complete' | 'thank' | 'close_thanked' | 'reassign' | 'reschedule' | 'create' | 'undo';
export type StepOp = 'patch' | 'create' | 'tag' | 'delete' | 'call';

/** How a thank-you went out, and the Blackbaud category that records it. */
export const THANK_HOWS: Record<string, { label: string; category: string; tag?: string }> = {
  letter: { label: 'Letter', category: 'Mailing' },
  card: { label: 'Card', category: 'Mailing' },
  call: { label: 'Call', category: 'Phone call' },
  text: { label: 'Text', category: 'Phone call', tag: 'Texted' },
  email: { label: 'Email', category: 'Email' },
  visit: { label: 'Visit', category: 'Meeting' },
};

/** "How did it go?" as Blackbaud stores it. */
export const OUTCOMES = ['', 'Successful', 'Unsuccessful'] as const;

/** The two ways a thank-you can be recorded (a decision for leadership; see act_settings.thank_mode). */
export type ThankMode = 'one' | 'two';

/** Task types that are the fundraiser's own contact record, so a thank-you completes them in place. */
export const IN_PLACE_TYPES = new Set(['RDD Action', 'PC Action', 'CED Action']);

export const stamp = (ymd: string): string => `${ymd}T00:00:00`;

export interface Target {
  id: string;
  cid: string;
  due: string; // YYYY-MM-DD
  type: string | null;
  category?: string | null;
  description: string;
  summary?: string;
  fundraisers: string[];
  /** The completed date of the thank-you already logged on the partner, for Close as thanked. */
  thankedOn?: string | null;
}

export interface CompleteOpts {
  date?: string | null; // YYYY-MM-DD, or null with own = true
  own?: boolean; // each action closes on its own due date
  line?: string;
  outcome?: string;
  how?: string; // a THANK_HOWS key, 'none' or ''
  actor: string;
  today: string; // Eastern date
  thankMode?: ThankMode;
  /** The owner's contact type for a thank-you that needs its own record (RDD Action, CED Action...). */
  ownerType?: string;
}

export function clean(line: string | undefined, max = 200): string {
  return String(line ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Add the shared line to the end of a description, with the day and the person: "Sent thank you letter (Oct 9, Pat Smith)". */
export function appendLine(description: string, line: string, today: string, actor: string): string {
  const text = clean(line);
  if (!text) return description;
  const [y, m, d] = today.split('-').map(Number);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  const tail = `${text} (${mon} ${d}, ${y}${actor ? ', ' + actor : ''})`;
  return description ? `${description}\n${tail}` : tail;
}

export interface Step {
  op: StepOp;
  actionId?: string; // the Blackbaud action the step changes; absent on a create
  body: Record<string, unknown>;
  before?: Record<string, unknown>; // the values this step replaces, for Undo
  dep?: number; // index of an earlier step in the same list whose created action id fills parent_id
  label?: string;
}

function fresh(a: Target, o: CompleteOpts): { date: string; description: string | undefined } {
  const date = a.thankedOn && o.how === 'logged' ? a.thankedOn : o.own ? a.due : o.date || o.today;
  const description = clean(o.line) ? appendLine(a.description, o.line as string, o.today, o.actor) : undefined;
  return { date, description };
}

/** Mark complete, no thank-you handling: one PATCH. */
export function completeStep(a: Target, o: CompleteOpts): Step {
  const { date, description } = fresh(a, o);
  const body: Record<string, unknown> = { completed: true, completed_date: stamp(date) };
  const before: Record<string, unknown> = { completed: false };
  if (description !== undefined) {
    body.description = description;
    before.description = a.description;
  }
  if (o.outcome === 'Successful' || o.outcome === 'Unsuccessful') body.outcome = o.outcome;
  return { op: 'patch', actionId: a.id, body, before, label: 'complete' };
}

/** Close a task whose thank-you is already in Blackbaud. Nothing new is written; the task closes on the thank-you's day. */
export function closeThankedStep(a: Target, o: CompleteOpts): Step {
  return completeStep(a, { ...o, how: 'logged', own: false });
}

/**
 * Mark thanked. Decision 1 (recommended yes, mode 'one'): an RDD, PC or CED task completes in place as the owner's counted
 * contact, with the category the How chip names and the Thanked tag, so it counts once. A Follow Up task, or mode 'two',
 * posts one completed contact of the owner's type with the Thanked tag, then closes the task.
 */
export function thankSteps(a: Target, o: CompleteOpts): Step[] {
  const how = THANK_HOWS[o.how || ''];
  if (!how) return [completeStep(a, o)];
  const { date, description } = fresh(a, o);
  const tags = ['Thanked'].concat(how.tag ? [how.tag] : []);
  const mode = o.thankMode || 'one';
  const inPlace = mode === 'one' && !!a.type && IN_PLACE_TYPES.has(a.type);
  const steps: Step[] = [];
  if (inPlace) {
    const body: Record<string, unknown> = { completed: true, completed_date: stamp(date), category: how.category };
    const before: Record<string, unknown> = { completed: false, category: a.category ?? 'Task/Other' };
    if (description !== undefined) {
      body.description = description;
      before.description = a.description;
    }
    if (o.outcome === 'Successful' || o.outcome === 'Unsuccessful') body.outcome = o.outcome;
    steps.push({ op: 'patch', actionId: a.id, body, before, label: 'thank' });
    for (const t of tags) steps.push({ op: 'tag', actionId: a.id, body: { category: t, date: stamp(date) }, label: 'tag ' + t });
    return steps;
  }
  const type = o.ownerType || a.type || 'RDD Action';
  const contact: Record<string, unknown> = {
    constituent_id: a.cid,
    category: how.category,
    type,
    date: stamp(date),
    summary: clean(`Thank you ${how.label.toLowerCase()}`, 255),
    description: description ?? '',
    completed: true,
    completed_date: stamp(date),
    priority: 'Normal',
  };
  if (['Mailing', 'Phone call', 'Email'].includes(how.category)) contact.direction = 'Outbound';
  if (o.outcome === 'Successful' || o.outcome === 'Unsuccessful') contact.outcome = o.outcome;
  const fr = a.fundraisers.length ? a.fundraisers : [];
  if (fr.length) contact.fundraisers = fr;
  steps.push({ op: 'create', body: contact, label: 'thank contact' });
  for (const t of tags) steps.push({ op: 'tag', dep: 0, body: { category: t, date: stamp(date) }, label: 'tag ' + t });
  steps.push({ op: 'patch', actionId: a.id, body: { completed: true, completed_date: stamp(date) }, before: { completed: false }, label: 'close task' });
  return steps;
}

/** Reassign: the fundraisers array replaces the old one (proven in place on the test record). */
export function reassignStep(a: Target, next: string[]): Step {
  return { op: 'patch', actionId: a.id, body: { fundraisers: next }, before: { fundraisers: a.fundraisers }, label: 'reassign' };
}

export function rescheduleStep(a: Target, due: string): Step {
  return { op: 'patch', actionId: a.id, body: { date: stamp(due) }, before: { date: stamp(a.due) }, label: 'reschedule' };
}

/**
 * The steps that put an outbox row's change back. A create comes back out with DELETE, a tag is removed from its action, a deleted
 * action returns as a copy (a new id; its notes and attachments stay with the old one), and any other call carries its own way back
 * in `before` ({ __call: { method, path }, ...body }, with {id} standing for the id the call created).
 */
export function undoStep(row: { op: string; action_id: string | null; bb_id: string | null; before: Record<string, unknown> | null }): Step | null {
  if (row.op === 'patch' && row.action_id && row.before) {
    const back: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row.before)) if (v !== undefined && !k.startsWith('__')) back[k] = v;
    // A category change is put back by the stored category; when none was stored the task was a Task/Other.
    if (!Object.keys(back).length) return null;
    return { op: 'patch', actionId: row.action_id, body: back, label: 'undo' };
  }
  if (row.op === 'create' && row.bb_id) return { op: 'delete', actionId: row.bb_id, body: {}, label: 'undo create' };
  if (row.op === 'tag' && row.bb_id && row.action_id) {
    return { op: 'call', actionId: row.action_id, body: { __call: { method: 'DELETE', path: `/constituent/v1/actions/customfields/${row.bb_id}?action=${row.action_id}` } }, label: 'undo tag' };
  }
  if (row.op === 'delete' && row.before && row.before.__restore && typeof row.before.__restore === 'object') {
    return { op: 'create', body: { ...(row.before.__restore as Record<string, unknown>) }, label: 'undo delete' };
  }
  if (row.op === 'call' && row.before && row.before.__call && typeof row.before.__call === 'object') {
    const c = row.before.__call as { method: string; path: string };
    if (c.path.includes('{id}') && !row.bb_id) return null;
    const path = c.path.replace('{id}', String(row.bb_id || ''));
    const body: Record<string, unknown> = { __call: { method: c.method, path } };
    for (const [k, v] of Object.entries(row.before)) if (!k.startsWith('__') && v !== undefined) body[k] = v;
    return { op: 'call', actionId: row.action_id ?? undefined, body, label: 'undo' };
  }
  return null;
}

/** Fundraisers after giving an action to its partner's current holder: the departed come off, live co-owners stay. */
export function holderFundraisers(current: string[], holder: string | null, isLive: (id: string) => boolean): string[] | null {
  if (!holder || current.includes(holder)) return null;
  return current.filter(isLive).concat([holder]);
}

/** Replace one fundraiser with another. Returns null when the action does not carry the one being replaced. */
export function replaceFundraiser(current: string[], from: string, to: string): string[] | null {
  if (!to || !current.includes(from)) return null;
  return current.filter((x) => x !== from).concat(current.includes(to) ? [] : [to]);
}

export function addFundraiser(current: string[], add: string): string[] | null {
  if (!add || current.includes(add)) return null;
  return current.concat([add]);
}

export function addDays(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}
