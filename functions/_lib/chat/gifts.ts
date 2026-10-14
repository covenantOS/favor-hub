// Gift notices in Chat (Will, 2026-10-14). A gift of $5,000 or more posts to the private channel #leadership-gifts: the partner (a chip
// that opens the partner in FavorOS), the amount, the fund, the fundraiser credit and the gift date.
// The source is the Blackbaud mirror the Work Center reads (gifts, constituents, funds, fundraisers). The 5-minute work drain runs this
// pass, and the mirror syncs gifts through the day, so a gift posts within about fifteen minutes of landing in the mirror.
// Only gifts added today (Eastern) count: there is no backfill. hub_gift_notices holds one row per gift id, taken before the post, so a
// gift never posts twice. The channel is made on the first pass with the hub admins and the leadership list as members.
import { nowIso, type Env } from '../http';
import { mirrorQ, type Q } from '../work/partner';
import { GIVEN } from '../work/gifts';
import { isTester } from '../testuser';
import { audienceOf, post, shape } from './db';
import { publish, type LiveEnv } from './live';
import { GIFTS_ID, entityName } from './text';

export const GIFT_CHANNEL_ID = 'ch_leadership_gifts';
export const GIFT_CHANNEL_NAME = 'leadership-gifts';
export const GIFT_MIN = 5000;
/** Leadership beyond the hub admins (Will, 2026-10-14). */
export const GIFT_LEADERS = ['rachel@favorintl.org', 'michael@favorintl.org', 'terry@favorintl.org', 'danny@favorintl.org'];

const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const TZ = 'America/New_York';
export const todayEt = (now: Date) => now.toLocaleDateString('en-CA', { timeZone: TZ });

export interface GiftNotice {
  id: string;
  cid: string;
  partner: string;
  amount: number;
  date: string;
  funds: string[];
  credit: string[];
}

const money = (n: number) => '$' + (Math.round(n) === n ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayWord = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}` : iso);

/** The message for one gift. Pure, so tests read it directly. */
export function giftMessage(g: GiftNotice): string {
  return [
    `**${money(g.amount)}** from <~p:${g.cid}|${entityName(g.partner) || 'Partner ' + g.cid}>`,
    `Fund: ${g.funds.length ? g.funds.join(', ') : 'Not set'}`,
    `Fundraiser credit: ${g.credit.length ? g.credit.join(', ') : 'None'}`,
    `Gift date: ${dayWord(g.date)}`,
  ].join('\n');
}

function parse<T>(v: unknown, d: T): T {
  if (v == null || v === '') return d;
  if (typeof v !== 'string') return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return d;
  }
}

const GIFTS_SQL = `SELECT g.id AS id, g.constituent_record_id AS cid, g.gift_amount AS amount, substr(g.gift_date, 1, 10) AS gdate, g.gift_splits AS splits, g.fundraiser_credits AS credits
  FROM gifts g WHERE g.date_added >= ?1 AND g.gift_amount >= ?2 AND g.gift_type IN ${GIVEN} AND COALESCE(g.gift_status, 'Active') = 'Active'
 ORDER BY g.date_added, g.id LIMIT 60`;
const NAMES_SQL = `SELECT c.id AS id, COALESCE(json_extract(c.raw_json, '$.name'), trim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))) AS name
  FROM constituents c WHERE c.id IN (SELECT value FROM json_each(?1))`;
const FUNDS_SQL = `SELECT id AS id, COALESCE(NULLIF(fund_description, ''), fund_id) AS name FROM funds WHERE id IN (SELECT value FROM json_each(?1))`;
const FRS_SQL = `SELECT id AS id, trim(COALESCE(fundraiser_first_name, '') || ' ' || COALESCE(fundraiser_last_name, '')) AS name FROM fundraisers WHERE id IN (SELECT value FROM json_each(?1))`;

/** Today's gifts of $5,000 or more, shaped for the message. */
export async function newBigGifts(q: Q, now: Date): Promise<GiftNotice[]> {
  const rows = (await q(GIFTS_SQL, [todayEt(now), GIFT_MIN])) as Array<{ id: unknown; cid: unknown; amount: unknown; gdate: unknown; splits: unknown; credits: unknown }>;
  if (!rows.length) return [];
  const fundIds = new Set<string>();
  const frIds = new Set<string>();
  for (const r of rows) {
    for (const s of parse<Array<{ fund_id?: unknown }>>(r.splits, [])) if (s && s.fund_id != null) fundIds.add(String(s.fund_id));
    for (const c of parse<Array<{ constituent_id?: unknown }>>(r.credits, [])) if (c && c.constituent_id != null) frIds.add(String(c.constituent_id));
  }
  const [names, funds, frs] = await Promise.all([
    q(NAMES_SQL, [JSON.stringify([...new Set(rows.map((r) => String(r.cid)))])]),
    fundIds.size ? q(FUNDS_SQL, [JSON.stringify([...fundIds])]) : Promise.resolve([]),
    frIds.size ? q(FRS_SQL, [JSON.stringify([...frIds])]) : Promise.resolve([]),
  ]);
  const nameOf = new Map((names as Array<{ id: unknown; name: unknown }>).map((n) => [String(n.id), String(n.name || '').trim()]));
  const fundOf = new Map((funds as Array<{ id: unknown; name: unknown }>).map((n) => [String(n.id), String(n.name || '').trim()]));
  const frOf = new Map((frs as Array<{ id: unknown; name: unknown }>).map((n) => [String(n.id), String(n.name || '').trim()]));
  return rows.map((r) => ({
    id: String(r.id),
    cid: String(r.cid),
    partner: nameOf.get(String(r.cid)) || '',
    amount: Number(r.amount) || 0,
    date: String(r.gdate || ''),
    funds: [...new Set(parse<Array<{ fund_id?: unknown }>>(r.splits, []).map((s) => fundOf.get(String(s?.fund_id)) || '').filter(Boolean))],
    credit: [...new Set(parse<Array<{ constituent_id?: unknown }>>(r.credits, []).map((c) => frOf.get(String(c?.constituent_id)) || '').filter(Boolean))],
  }));
}

/** Who belongs in the channel: every hub admin (the test users aside) and the leadership list. */
export async function giftMembers(env: Pick<Env, 'DB'> & Partial<Env>): Promise<string[]> {
  const admins = ((await env.DB.prepare(`SELECT email FROM hub_users WHERE role = 'admin' AND blocked = 0`).all<{ email: string }>()).results || []).map((r) => lower(r.email));
  const envAdmins = String(env.HUB_ADMINS || 'will@favorintl.org').split(',').map(lower).filter(Boolean);
  return [...new Set([...admins, ...envAdmins, ...GIFT_LEADERS])].filter((e) => e && !isTester(e));
}

/** Finds #leadership-gifts, or makes it (private) with its members. Members added later by hand stay. Returns the channel id. */
export async function ensureGiftChannel(env: Pick<Env, 'DB'> & Partial<Env>, now = new Date()): Promise<string> {
  const have = await env.DB.prepare(`SELECT id FROM chat_channels WHERE name = ? AND kind IN ('public', 'private') AND archived = 0 LIMIT 1`).bind(GIFT_CHANNEL_NAME).first<{ id: string }>();
  if (have) return have.id;
  const at = now.toISOString();
  const owner = 'will@favorintl.org';
  const members = await giftMembers(env);
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO chat_channels (id, kind, name, topic, created_by, created_at, last_at) VALUES (?, 'private', ?, ?, ?, ?, ?)`).bind(GIFT_CHANNEL_ID, GIFT_CHANNEL_NAME, 'Gifts of $5,000 or more as they land in Blackbaud', owner, at, at),
    ...members.map((e) => env.DB.prepare(`INSERT OR IGNORE INTO chat_members (channel_id, email, role, joined_at) VALUES (?, ?, ?, ?)`).bind(GIFT_CHANNEL_ID, e, e === owner ? 'owner' : 'member', at)),
  ]);
  return GIFT_CHANNEL_ID;
}

export interface GiftRunOpts {
  now?: Date;
  /** Tests: the mirror stand-in. */
  q?: Q;
  /** Tests: post into this channel instead of #leadership-gifts. */
  channelId?: string;
}

/** The pass. Posts each new gift once. Before db/gift-notices.sql is applied it does nothing. */
export async function runGiftNotices(env: Env, opts: GiftRunOpts = {}): Promise<{ posted: number; seen: number; note?: string }> {
  const now = opts.now || new Date();
  try {
    await env.DB.prepare('SELECT 1 FROM hub_gift_notices LIMIT 1').first();
  } catch {
    return { posted: 0, seen: 0, note: 'tables not applied' };
  }
  const gifts = await newBigGifts(opts.q || mirrorQ(env), now);
  if (!gifts.length) return { posted: 0, seen: 0 };
  const done = new Set(((await env.DB.prepare(`SELECT gift_id FROM hub_gift_notices WHERE gift_id IN (${gifts.map(() => '?').join(',')})`).bind(...gifts.map((g) => g.id)).all<{ gift_id: string }>()).results || []).map((r) => String(r.gift_id)));
  const fresh = gifts.filter((g) => !done.has(g.id));
  if (!fresh.length) return { posted: 0, seen: gifts.length };
  const channelId = opts.channelId || (await ensureGiftChannel(env, now));
  let posted = 0;
  for (const g of fresh) {
    // The once-only row first: a second pass at the same moment posts nothing.
    const take = await env.DB.prepare(`INSERT OR IGNORE INTO hub_gift_notices (gift_id, cid, amount, channel_id, posted_at) VALUES (?, ?, ?, ?, ?)`).bind(g.id, g.cid, g.amount, channelId, nowIso()).run();
    if (!Number((take.meta as { changes?: number }).changes)) continue;
    try {
      const p = await post(env as never, { channel_id: channelId, email: GIFTS_ID, body: giftMessage(g) });
      await env.DB.prepare('UPDATE hub_gift_notices SET message_id = ? WHERE gift_id = ?').bind(p.message.id, g.id).run();
      if ((env as LiveEnv).CHAT_ROOM) {
        const [msg] = await shape(env as never, [p.message]);
        await publish(env as LiveEnv, audienceOf(p.message, p.members), { type: 'message', message: msg }).catch(() => undefined);
      }
      posted++;
    } catch (err) {
      // Given back so the next pass tries again.
      await env.DB.prepare('DELETE FROM hub_gift_notices WHERE gift_id = ?').bind(g.id).run();
      console.warn('[gift notices]', String(err).slice(0, 160));
    }
  }
  return { posted, seen: gifts.length };
}
