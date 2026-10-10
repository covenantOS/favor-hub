import { HttpError } from '../../../_lib/http';
import { selfTest } from '../../../_lib/work/digest';
import { personOf } from '../../../_lib/work/mailme';
import { work } from '../../../_lib/work/route';

// Send me a test: the email goes to the person's own address and nowhere else. A role test by the agent key (acting as someone) is
// refused, so no test of this route can reach a staff member.
export const onRequestPost = work(async ({ env, wu }) => {
  if (wu.user.via !== 'google') throw new HttpError(403, 'not_yours', 'Sign in with your Favor Google account to send yourself a test.');
  if (wu.testCid) throw new HttpError(403, 'test_only', 'A role test cannot send mail to the person it acts as.');
  const person = await personOf(env, wu);
  if (person.email.toLowerCase() !== wu.user.email.toLowerCase()) throw new HttpError(403, 'not_yours', 'A test goes only to your own address.');
  const out = await selfTest(env, person);
  if (!out.ok) throw new HttpError(502, 'mail_failed', 'The mail service did not take the test. Try again in a minute.');
  return { sent: true, to: person.email, subject: out.subject } as any;
});
