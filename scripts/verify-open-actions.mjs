// Read-only check of the open-action definition against the live RE NXT mirror (SELECT only).
//
//   MIRROR_API_KEY=...            node scripts/verify-open-actions.mjs   (the sync worker's /d1/query)
//   D1_EMAIL=... D1_KEY=...       node scripts/verify-open-actions.mjs   (Cloudflare REST, Tech account)
//
// Prints, for each person asked about (default: michael@ and will@favorintl.org), the count the
// old rule (completed date empty) gave and the count the shared rule gives, then runs the exact
// Your day query and checks that no row it returns is already completed. Exits 1 on a failure.
import { DAY_WINDOW_DAYS, openActionSql, shapeYourDay, yourDayActionsSql } from '../functions/_lib/hub/actions.ts';

const MIRROR_URL = process.env.MIRROR_QUERY_URL || 'https://re-nxt-cloud-sync.super-paper-a785.workers.dev/d1/query';
const D1_REST = 'https://api.cloudflare.com/client/v4/accounts/c1296fbe1d211d8c1e14cccb7c1d6f9f/d1/database/f5a02941-2655-414f-aaa3-4039ba8b6bd2/query';

async function q(sql, params = []) {
  if (process.env.MIRROR_API_KEY) {
    const res = await fetch(MIRROR_URL, { method: 'POST', headers: { Authorization: `Bearer ${process.env.MIRROR_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }) });
    const data = await res.json();
    if (!res.ok || !Array.isArray(data)) throw new Error(`mirror ${res.status}`);
    return data;
  }
  if (process.env.D1_EMAIL && process.env.D1_KEY) {
    const res = await fetch(D1_REST, { method: 'POST', headers: { 'X-Auth-Email': process.env.D1_EMAIL, 'X-Auth-Key': process.env.D1_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }) });
    const data = await res.json();
    if (!data.success) throw new Error(JSON.stringify(data.errors));
    return data.result[0].results;
  }
  throw new Error('Set MIRROR_API_KEY, or D1_EMAIL and D1_KEY.');
}

const OLD = 'a.action_completed_date IS NULL';
const WINDOW = `a.action_date_due <= date('now', '+${DAY_WINDOW_DAYS} day')`;
const MINE = "EXISTS (SELECT 1 FROM json_each(a.raw_json, '$.fundraisers') j WHERE j.value = ?)";
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const emails = process.argv.slice(2).length ? process.argv.slice(2) : ['michael@favorintl.org', 'will@favorintl.org'];
let failed = false;

const count = async (cond, extra = '', params = []) => (await q(`SELECT COUNT(*) AS n FROM actions a WHERE ${cond} ${extra}`, params))[0].n;
const report = { today, everyone: { old_rule: await count(OLD), shared_rule: await count(openActionSql('a')) } };
const closedNoDate = await count(`${OLD} AND json_extract(a.raw_json, '$.completed') = 1`);
report.everyone.closed_but_no_date = closedNoDate;

report.people = {};
for (const email of emails) {
  const fr = await q('SELECT id FROM fundraisers WHERE lower(fundraiser_email) = ? LIMIT 1', [email]);
  if (!fr.length) { report.people[email] = 'no fundraiser record'; continue; }
  const id = fr[0].id;
  const oldN = await count(OLD, `AND ${WINDOW} AND ${MINE}`, [id]);
  const rows = await q(yourDayActionsSql(60), [today, id]);
  const shown = shapeYourDay(rows, 12);
  // Independent count, written a different way, must equal the window-function total.
  const check = await count(openActionSql('a'), `AND ${WINDOW} AND ${MINE}`, [id]);
  const completedShown = rows.length
    ? (await q(`SELECT COUNT(*) AS n FROM actions WHERE id IN (${rows.map(() => '?').join(',')}) AND (json_extract(raw_json, '$.completed') = 1 OR action_completed_date IS NOT NULL)`, rows.map((r) => r.id)))[0].n
    : 0;
  if (shown.total !== check) { failed = true; console.error(`${email}: window total ${shown.total} does not match count ${check}`); }
  if (completedShown) { failed = true; console.error(`${email}: ${completedShown} returned rows are already completed`); }
  report.people[email] = { fundraiser_id: id, old_rule_in_window: oldN, shared_rule_in_window: shown.total, overdue: shown.overdue, rows_returned: rows.length, rows_shown: shown.actions.length, completed_rows_returned: completedShown };
}
console.log(JSON.stringify(report, null, 1));
process.exit(failed ? 1 : 0);
