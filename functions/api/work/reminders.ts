import { HttpError } from '../../_lib/http';
import { addReminders, checkInput, dueFor, listReminders } from '../../_lib/work/remind';
import { body, work } from '../../_lib/work/route';

// Reminders for the signed-in person: the bell in the header lists them, and Remind me, Left a message and Plan calls add them.
// Nothing here goes to Blackbaud.
export const onRequestGet = work(async ({ ctx }) => (await listReminders(ctx.env, ctx.email)) as any);

export const onRequestPost = work(async ({ request, ctx }) => {
  const b = await body(request);
  const list: Record<string, any>[] = Array.isArray(b.items) ? b.items : [b];
  if (!list.length) throw new HttpError(400, 'missing_field', 'Nothing to remind about.');
  if (list.length > 200) throw new HttpError(400, 'too_many', 'Add 200 reminders or fewer at a time.');
  const items = list.map((x) => checkInput({ ...x, due_at: x.due_at || dueFor(x.when || {}) }));
  const ids = await addReminders(ctx.env, ctx.email, items);
  return { ids, ...(await listReminders(ctx.env, ctx.email)) } as any;
});
