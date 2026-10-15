// Tie-out for Gifts > First-gift letters. Compares the page's list with an independent read of the D1 mirror.
//
//   node scripts/fgl-tieout.mjs [days]        (default 90)
//
// Page side: runs the page's own code (fglView) against the live Blackbaud waiting list (a read-only query through the sync worker) and the live
// mirror. Independent side: one SQL statement on the mirror that never touches the page's code: acquisition-coded gifts the mirror shows as
// NotAcknowledged, and of those the ones that are the credited household's earliest credited gift. Nothing is written anywhere.
// Needs ~/.claude/secrets/favor-receipts-key.txt and favor-will-cf.txt (the Tech account key that reads re_nxt_data).
import './../tests/support/resolve-ts.mjs';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const secret = (f) => readFileSync(`${homedir()}/.claude/secrets/${f}`, 'utf8').trim();
const days = Number(process.argv[2]) || 90;
const D1 = 'https://api.cloudflare.com/client/v4/accounts/c1296fbe1d211d8c1e14cccb7c1d6f9f/d1/database/f5a02941-2655-414f-aaa3-4039ba8b6bd2/query';
const realFetch = globalThis.fetch;

async function d1(sql, params = []) {
  const res = await realFetch(D1, {
    method: 'POST',
    headers: { 'X-Auth-Email': 'will@favorintl.org', 'X-Auth-Key': secret('favor-will-cf.txt'), 'Content-Type': 'application/json', 'User-Agent': 'fgl-tieout' },
    body: JSON.stringify({ sql, params }),
  });
  const out = await res.json();
  if (!out.success) throw new Error(JSON.stringify(out.errors));
  return out.result[0].results;
}

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

// ---- the independent read: one statement, its own household and first-gift logic
const INDEPENDENT = `
WITH acq AS (SELECT id FROM appeals WHERE appeal_category = 'Acquisition'),
cg AS (
  SELECT g.id AS gid, g.constituent_record_id AS pid, substr(g.gift_date, 1, 10) AS d FROM gifts g
   WHERE g.gift_amount > 0 AND g.gift_type <> 'RecurringGift' AND g.gift_date IS NOT NULL AND (g.soft_credits IS NULL OR g.soft_credits IN ('', '[]', 'null'))
  UNION ALL
  SELECT g.id, json_extract(s.value, '$.constituent_id'), substr(g.gift_date, 1, 10) FROM gifts g, json_each(g.soft_credits) s
   WHERE g.gift_amount > 0 AND g.gift_type <> 'RecurringGift' AND g.gift_date IS NOT NULL AND g.soft_credits IS NOT NULL AND g.soft_credits NOT IN ('', '[]', 'null') AND json_valid(g.soft_credits)
),
hh AS (
  SELECT c.id AS pid, CASE WHEN c.spouse_id IS NOT NULL AND c.spouse_id <> '' AND EXISTS (SELECT 1 FROM constituents x WHERE x.id = c.spouse_id) AND CAST(c.spouse_id AS INTEGER) < CAST(c.id AS INTEGER)
    THEN c.spouse_id ELSE c.id END AS hid FROM constituents c
),
ranked AS (
  SELECT hh.hid AS hid, cg.gid AS gid, ROW_NUMBER() OVER (PARTITION BY hh.hid ORDER BY cg.d, CAST(cg.gid AS INTEGER)) AS rn
    FROM cg JOIN hh ON hh.pid = cg.pid WHERE cg.d <= ?2
)
SELECT g.id AS id, g.gift_amount AS amount, substr(g.gift_date, 1, 10) AS d, g.constituent_record_id AS giver
  FROM gifts g
 WHERE g.acknowledgment_status = 'NotAcknowledged' AND g.gift_amount > 0 AND g.gift_type <> 'RecurringGift' AND substr(g.gift_date, 1, 10) >= ?1
   AND EXISTS (SELECT 1 FROM json_each(g.gift_splits) sp WHERE json_extract(sp.value, '$.appeal_id') IN (SELECT id FROM acq))
   AND g.id IN (SELECT gid FROM ranked WHERE rn = 1)
 ORDER BY g.gift_date`;

const indep = await d1(INDEPENDENT, [since, today]);

// ---- the page's read: its own code, live Blackbaud waiting list, live mirror
globalThis.fetch = async (url, init = {}) => {
  if (String(url).endsWith('/d1/query')) {
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify(await d1(body.sql, body.params || [])), { status: 200 });
  }
  return realFetch(url, init);
};
const hub = new DatabaseSync(':memory:');
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  first: async () => hub.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: hub.prepare(sql).all(...args) }),
  run: async () => ({ meta: { changes: Number(hub.prepare(sql).run(...args).changes) } }),
});
hub.exec(readFileSync(new URL('../db/receipts.sql', import.meta.url), 'utf8'));
hub.exec(readFileSync(new URL('../db/first-gift-letters.sql', import.meta.url), 'utf8'));
hub.exec('CREATE TABLE act_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)');
const env = { DB: { prepare: (s) => stmt(s), batch: async (l) => Promise.all(l.map((x) => x.run())) }, RECEIPTS_KEY: secret('favor-receipts-key.txt'), MIRROR_API_KEY: 'tieout' };

const { fglView } = await import('../functions/_lib/fgl/store.ts');
const { waitingView } = await import('../functions/_lib/receipts/store.ts');
const page = await fglView(env, { days, fresh: true });
const rcp = await waitingView(env, days, false);

const pageItems = [...page.letters, ...page.held];
const mine = new Map(pageItems.map((i) => [i.id, i]));
const theirs = new Map(indep.map((r) => [String(r.id), r]));
const sum = (xs) => Math.round(xs.reduce((t, x) => t + Number(x), 0) * 100) / 100;
console.log(`window: ${since} to ${today} (${days} days), mirror read ${new Date().toISOString()}`);
console.log(`independent mirror query : ${theirs.size} gifts, $${sum([...theirs.values()].map((r) => r.amount))}`);
console.log(`page (letters + held)    : ${mine.size} gifts, $${sum([...mine.values()].map((i) => i.amount))}`);
console.log(`  letters                : ${page.letters.length} gifts, $${sum(page.letters.map((i) => i.amount))}`);
console.log(`  held back              : ${page.held.length} gifts, $${sum(page.held.map((i) => i.amount))} (${[...new Set(page.held.map((h) => h.key))].join(', ') || 'none'})`);
const onlyMine = [...mine.keys()].filter((id) => !theirs.has(id));
const onlyTheirs = [...theirs.keys()].filter((id) => !mine.has(id));
console.log(`only on the page         : ${onlyMine.length} ${onlyMine.join(', ')}`);
console.log(`only in the mirror query : ${onlyTheirs.length} ${onlyTheirs.join(', ')}`);
for (const id of onlyTheirs) {
  const r = theirs.get(id);
  console.log(`   ${id}: $${r.amount} on ${r.d}, record ${r.giver} (the mirror says NotAcknowledged; the page reads Blackbaud's own list)`);
}
const rcpIds = new Set([...rcp.letters, ...rcp.held].map((i) => i.id));
const both = pageItems.filter((i) => rcp.letters.some((l) => l.id === i.id));
console.log(`Receipts waiting list    : ${rcp.letters.length} receipts, ${rcp.held.length} held, window total ${rcpIds.size}`);
console.log(`gifts on both pages' printable lists: ${both.length}`);
const heldOnReceipts = pageItems.filter((i) => rcp.held.some((h) => h.id === i.id && (h.key === 'first_gift' || h.key === 'first_gift_file')));
console.log(`first gifts Receipts holds back for letters: ${heldOnReceipts.length} of ${pageItems.length}`);
if (onlyMine.length === 0 && onlyTheirs.length === 0 && both.length === 0) console.log('TIE-OUT: the lists match and no gift is on both pages.');
else console.log('TIE-OUT: differences listed above.');
