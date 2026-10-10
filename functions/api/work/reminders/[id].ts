import { HttpError } from '../../../_lib/http';
import { dueFor, finishReminder, laterReminder, listReminders } from '../../../_lib/work/remind';
import { body, param, work } from '../../../_lib/work/route';

// Done, or Later (in an hour, this afternoon, tomorrow morning, next week, or a picked day). Only the person's own reminders.
export const onRequestPatch = work(async ({ request, params, ctx }) => {
  const id = param(params, 'id');
  const b = await body(request);
  let ok = false;
  if (b.action === 'done') ok = await finishReminder(ctx.env, ctx.email, id);
  else if (b.action === 'later') ok = await laterReminder(ctx.env, ctx.email, id, dueFor(b.when || {}));
  else throw new HttpError(400, 'bad_action', 'A reminder is marked done or moved to later.');
  if (!ok) throw new HttpError(404, 'no_reminder', 'That reminder is already done or is not yours.');
  return (await listReminders(ctx.env, ctx.email)) as any;
});
