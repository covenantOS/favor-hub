import { WORDING } from '../../_lib/statements/copy';
import { route } from '../../_lib/statements/route';
import { todayEastern } from '../../_lib/statements/service';
import { batchSize, driveFolder, emailOn, getCopy } from '../../_lib/statements/store';

// What the page needs to open: who is signed in, the wording in force, and which switches are on.
export const onRequestGet = route(async ({ env, user }) => {
  const today = todayEastern();
  const year = Number(today.slice(0, 4));
  return {
    name: user.name,
    admin: user.role === 'admin',
    today,
    // The year-end run covers a closed year, so it opens on last year.
    defaultYear: year - 1,
    thisYear: year,
    emailOn: await emailOn(env),
    driveOn: Boolean(await driveFolder(env)),
    size: await batchSize(env),
    copy: await getCopy(env),
    fields: WORDING.map((w) => ({ key: w.key, label: w.label })),
  };
});
