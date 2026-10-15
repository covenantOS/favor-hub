// Prints the household figures the partner page shows, read from the D1 mirror through the same code the page runs.
// usage: node --import ./tests/support/resolve-ts.mjs scripts/household-pages.mjs <env-file-with-no-secrets-needed> id id id
import { readFileSync } from 'node:fs';
const { partnerGiving } = await import('../functions/_lib/gifts/partner-giving.ts');
const key = readFileSync(process.env.USERPROFILE + '/.claude/secrets/favor-will-cf.txt', 'utf8').trim();
async function q(sql, params = []) {
  const r = await fetch('https://api.cloudflare.com/client/v4/accounts/c1296fbe1d211d8c1e14cccb7c1d6f9f/d1/database/f5a02941-2655-414f-aaa3-4039ba8b6bd2/query', {
    method: 'POST', headers: { 'X-Auth-Email': 'will@favorintl.org', 'X-Auth-Key': key, 'content-type': 'application/json' }, body: JSON.stringify({ sql, params }) });
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result[0].results;
}
const out = [];
for (const id of process.argv.slice(2)) {
  const g = await partnerGiving(q, id);
  out.push({
    id, household: g.household, members: g.members,
    total: g.total, count: g.count, ytd: g.ytd, last12: g.last12, asOf: g.asOf,
    years: g.years.map((y) => [y.year, y.total]),
    byMember: (g.byMember || []).map((b) => ({ id: b.id, total: b.giving.total, count: b.giving.count, ytd: b.giving.ytd, last12: b.giving.last12, years: b.giving.years.map((y) => [y.year, y.total]) })),
  });
}
console.log(JSON.stringify(out));
