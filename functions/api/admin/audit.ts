import { adminRoute } from '../../_lib/admin/route';

// Every settings change, newest first: who, when, and the old and new value.
export const onRequestGet = adminRoute(async ({ env, url }) => {
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100));
  const before = Number(url.searchParams.get('before')) || 0;
  const area = (url.searchParams.get('area') || '').slice(0, 20);
  const q = `SELECT id, at, actor, area, key, label, before_value AS before, after_value AS after, note FROM hub_audit WHERE (? = 0 OR id < ?) AND (? = '' OR area = ?) ORDER BY id DESC LIMIT ?`;
  const rows = await env.DB.prepare(q).bind(before, before, area, area, limit).all();
  return { entries: rows.results || [] };
});
