import { loadPartner, mirrorQ, SYSTEM_ID } from '../../../_lib/work/partner';
import { factsOf, nbaFromFacts } from '../../../_lib/brief/story';
import { longDay, plural } from '../../../_lib/brief/text';
import { whole } from '../../../../shared/giving';
import { work } from '../../../_lib/work/route';
import { todayEt } from '../../../_lib/work/service';

// One line of prep per partner for a meeting on Today (household credited giving, soft credits included): what they give, when anyone last spoke to them and what to do.
//   GET /api/brief/prep/lines?cids=1,2,3   (at most 6)
//   -> { ok, lines: { "<id>": { name, line, nba } } }
export const onRequestGet = work(async ({ ctx, env, url }) => {
  const today = todayEt();
  const ids = [...new Set((url.searchParams.get('cids') || '').split(',').map((s) => s.trim()).filter((s) => SYSTEM_ID.test(s)))].slice(0, 6);
  const lines: Record<string, unknown> = {};
  await Promise.all(
    ids.map(async (id) => {
      const p = await loadPartner(mirrorQ(env), id, today).catch(() => null);
      if (!p) return;
      const f = await factsOf(ctx, id, p, today);
      const nba = nbaFromFacts(f, p, today);
      const bits = [
        f.count ? `${whole(f.l12)} in 12 months, ${whole(f.life)} lifetime` : f.passedOn > 0 ? 'no gifts of its own, it passes gifts on for others' : 'No gifts yet',
        f.quiet === null ? 'no contact on record' : `last contact ${plural(f.quiet, 'day')} ago`,
        f.owed ? `${plural(f.owed.n, 'gift')} not thanked` : f.last ? `last gift ${longDay(f.last.date, today)}` : '',
      ].filter(Boolean);
      lines[id] = { name: p.name, line: bits.join(', ') + '.', nba };
    })
  );
  return { lines };
});
