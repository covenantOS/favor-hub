import { HttpError } from '../../_lib/http';
import { acceptable, HOUSE, scrub, twoSentences, writeText } from '../../_lib/brief/text';
import { SYSTEM_ID } from '../../_lib/work/partner';
import { body, work } from '../../_lib/work/route';

// Call mode: turns what the person said out loud after a call into the action that gets logged.
//   POST /api/brief/call-summary   { cid, transcript, partner? }
//   -> { ok, summary (one line, 140 characters at most, the action's summary), notes (the fuller record), followUp: { days, what } | null }
// The words are the person's own dictation. Nothing is saved here; the page shows the result and the person presses Log it.
export const onRequestPost = work(async ({ request, env }) => {
  const b = await body(request);
  const cid = String(b.cid || '');
  if (!SYSTEM_ID.test(cid)) throw new HttpError(400, 'no_partner', 'Open a partner first.');
  const said = String(b.transcript || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
  if (said.length < 3) throw new HttpError(400, 'nothing_said', 'Say or type what happened on the call first.');
  const out = await writeText(env, {
    system: `${HOUSE} You turn a staff member's spoken notes after a phone call with a ministry partner into a record. Answer with one line of JSON only: {"summary":"","notes":"","followUpDays":0,"followUp":""}. summary is one plain sentence of at most 120 characters saying what happened ("Thanked for the September gift and prayed for his wife's surgery"). notes is two to four plain sentences with every concrete detail said: prayer requests, family news, giving plans, questions. followUp is a short task if the person said they would do something later, else empty, and followUpDays is how many days from now, else 0. Keep the partner's own words for names and details. First person is fine in notes.`,
    raw: true,
    user: said,
    max: 380,
    temperature: 0.2,
    timeoutMs: 14000,
  });
  let summary = '';
  let notes = '';
  let followDays = 0;
  let follow = '';
  const m = out && out.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      summary = scrub(String(j.summary || ''));
      notes = scrub(String(j.notes || ''));
      followDays = Math.min(120, Math.max(0, Math.floor(Number(j.followUpDays) || 0)));
      follow = scrub(String(j.followUp || ''));
    } catch {
      // the plain fallback below takes over
    }
  }
  if (!summary) {
    const first = said.split(/(?<=[.!?])\s+/)[0] || said;
    summary = scrub(first).slice(0, 140);
  }
  if (summary.length > 140) summary = summary.slice(0, 137).replace(/\s+\S*$/, '') + '...';
  if (!acceptable(summary)) summary = scrub(twoSentences(said.split(/(?<=[.!?])\s+/)[0] || said)).slice(0, 140);
  if (!notes || notes.length > 700) notes = scrub(said);
  return { summary, notes, followUp: follow && followDays ? { days: followDays, what: follow.slice(0, 120) } : null, heard: said };
});
