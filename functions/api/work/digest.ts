import { HttpError } from '../../_lib/http';
import { adminAddresses, dryRun, run } from '../../_lib/work/digest';
import { body, work } from '../../_lib/work/route';
import { dailyPass as projectsDailyPass } from '../../_lib/projects/links/email'; // projects hook
import { dailyPass } from '../../_lib/requests/mail';

// The morning email run. The small drain Worker calls POST with {} several times each weekday morning (the run sends nothing before a
// person's 7:30 or 8:00 Eastern, nothing after 10:30, and never twice a day to one person). An admin may send a dry run:
// {"dry": true, "as": "<staff email>"} renders that person's email and sends it to an admin address, never to the person.
export const onRequestPost = work(
  async ({ request, env, ctx }) => {
    const b = await body(request);
    if (b.dry) {
      const asEmail = String(b.as || '').toLowerCase();
      if (!asEmail) throw new HttpError(400, 'missing_field', 'Say whose email to render.');
      const to = String(b.to || adminAddresses(env)[0] || '').toLowerCase();
      const out = await dryRun(env, asEmail, to);
      return out as any;
    }
    void ctx;
    // The same weekday morning cron carries the request board's pass: due notices and the daily summary email.
    const requests = await dailyPass(env).catch((err) => ({ notes: [String(err).slice(0, 120)] }));
    // projects hook: due-soon notices, the daily summary email and the calendar upkeep for tasks.
    const projects = await projectsDailyPass(env).catch((err) => ({ notes: [String(err).slice(0, 120)] }));
    return { ...(await run(env)), requests, projects } as any;
  },
  { adminOnly: true }
);
