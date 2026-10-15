import { HttpError, type Env } from '../../_lib/http';
import { brainPackagesFor } from '../../_lib/brain-access';
import { mirror } from '../../_lib/foundations/blackbaud';
import { readOnly } from '../../_lib/work/repo';
import { logEvent } from '../../_lib/work/db';
import { todayET } from '../../_lib/lists/service.ts';
import { refreshSnapshot } from '../../_lib/lists/refresh.ts';
import { body, work, type RouteArgs } from '../../_lib/work/route';
import { BAND_LABEL, exportQuery, facetQueries, KIND_LABEL, listQuery, specFromParams, STATUS_LABEL, DUP_SQL, type Ctx } from '../../_lib/partners/query.ts';
import {
  actionPage, addTag, allTags, cards, checkId, decideMerge, dropTag, dropView, extras, giftPage, merges, noteRecent, recent, requestMerge, saveView, setStar, stars, tagsOf, views,
} from '../../_lib/partners/service.ts';

// The Partners directory: every Blackbaud record (functions/_lib/partners). Read by anyone the Work Center lets in; partner records are
// open to every Work Center role (Will, 2026-10-10). Street addresses, emails and phones in the list and in exports follow the
// Favor Brain's contacts package, except on partners the person holds. Nothing here writes to Blackbaud.
//   GET  /api/partners                     one page of the directory (?q, filters, sort, dir, page, size), counts and menus
//   GET  /api/partners/export              the matching partners as CSV (?ids= for a selection)
//   GET  /api/partners/menus                codes, solicit codes, states, holders and tags with counts
//   GET  /api/partners/views | stars | recent | tags[?cid] | duplicates | merges[?state]
//   GET  /api/partners/record/<id>/gifts | actions | extras
//   POST /api/partners/views               save a view; POST /api/partners/views/<id>/delete
//   POST /api/partners/stars/<id>          { on }      POST /api/partners/recent/<id>
//   POST /api/partners/tags                { cids, tag, remove }
//   POST /api/partners/merge               { keep, other, note }   POST /api/partners/merges/decide { id | keep+other, state }
//   POST /api/partners/rebuild             admins and the agent key: rebuild the copy now

type Row = Record<string, any>;
const hub = async (env: Env, sql: string, params: unknown[]): Promise<Row[]> => ((await env.DB.prepare(sql).bind(...params).all()).results || []) as Row[];
const mq = (env: Env) => <T = Row>(sql: string, params: unknown[] = []) => mirror(env, readOnly(sql), params) as Promise<T[]>;
const seg = (params: Record<string, string | string[]>, i: number): string => String((params.a as string[] | undefined)?.[i] || '');

async function meta(env: Env): Promise<{ builtAt: string; records: number; menus: Row }> {
  const rows = await hub(env, `SELECT key, value FROM pd_meta WHERE key IN ('directory', 'menus')`, []).catch(() => []);
  const by = new Map(rows.map((r) => [r.key, r.value]));
  let d: Row = {}, m: Row = {};
  try {
    d = JSON.parse(by.get('directory') || '{}');
    m = JSON.parse(by.get('menus') || '{}');
  } catch {
    /* an empty copy reads as not built */
  }
  return { builtAt: d.builtAt || '', records: Number(d.records) || 0, menus: m };
}

/** Whether this person sees street addresses, emails and phones on every partner (admins and the contacts package). */
async function contactsAll(a: RouteArgs): Promise<boolean> {
  if (a.wu.user.role === 'admin' && a.wu.scope.all) return true;
  const p = await brainPackagesFor(a.env, [a.wu.email]).catch(() => new Map<string, Set<string>>());
  return !!p.get(a.wu.email.toLowerCase())?.has('contacts');
}
/** Leave a partner's contact details out unless the person may see them. */
function screen(rows: Row[], all: boolean, fids: Set<string>): Row[] {
  if (all) return rows;
  return rows.map((r) => {
    const held = String(r.holders || '').split('|').some((f) => f && fids.has(f));
    if (held) return r;
    const { email: _e, phone: _p, addr: _a, ...rest } = r;
    return { ...rest, hidden: true };
  });
}

const ctxOf = (a: RouteArgs): Ctx => ({ today: todayET(), email: a.wu.email, fid: a.wu.scope.fid || null });
const csvCell = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  // A cell that starts like a formula is quoted with a leading apostrophe so a spreadsheet shows it as text.
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const pipes = (s: unknown) => String(s || '').split('|').filter(Boolean).join('; ');

export const onRequestGet = work(async (a) => {
  const { env, params, url, wu } = a;
  const what = seg(params, 0);
  if (!what || what === 'directory') {
    const spec = specFromParams(url.searchParams);
    const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
    const size = [25, 50, 100].includes(Number(url.searchParams.get('size'))) ? Number(url.searchParams.get('size')) : 50;
    const ctx = ctxOf(a);
    const lq = listQuery(spec, ctx, page, size, true);
    const fq = facetQueries(spec, ctx);
    const [rows, cnt, kinds, status, m, all, starred] = await Promise.all([
      hub(env, lq.sql, lq.params),
      hub(env, lq.countSql, lq.countParams),
      hub(env, fq.kinds.sql, fq.kinds.params),
      hub(env, fq.status.sql, fq.status.params),
      meta(env),
      contactsAll(a),
      stars(env, wu.email),
    ]);
    const kindN: Record<string, number> = {};
    let hh = 0;
    for (const k of kinds) {
      kindN[k.k] = Number(k.n) || 0;
      hh += Number(k.hh) || 0;
    }
    kindN.household = hh;
    const statusN: Record<string, number> = {};
    for (const s of status) statusN[s.k] = Number(s.n) || 0;
    const tags = url.searchParams.get('menus') === '1' ? await allTags(env) : undefined;
    const starSet = new Set(starred);
    return {
      rows: screen(rows, all, wu.scope.fids).map((r) => ({ ...r, star: starSet.has(String(r.id)) })),
      total: Number(cnt[0]?.n) || 0,
      lifetime: Number(cnt[0]?.lifetime) || 0,
      page,
      size,
      spec,
      facets: { kinds: kindN, status: statusN },
      builtAt: m.builtAt,
      records: m.records,
      contacts: all,
      fid: wu.scope.fid || null,
      menus: url.searchParams.get('menus') === '1' ? { ...m.menus, tags, bands: BAND_LABEL, kinds: KIND_LABEL, statuses: STATUS_LABEL } : undefined,
    };
  }
  if (what === 'export') {
    const spec = specFromParams(url.searchParams);
    const ids = (url.searchParams.get('ids') || '').split(',').filter((x) => /^\d{1,12}$/.test(x));
    const all = await contactsAll(a);
    const eq = exportQuery(spec, ctxOf(a), true, ids);
    const rows = screen(await hub(env, eq.sql, eq.params), all, wu.scope.fids);
    const showContacts = all || rows.some((r) => !r.hidden);
    const cols: [string, (r: Row) => unknown][] = [
      ['Lookup ID', (r) => r.lookup], ['Name', (r) => r.name], ['Kind', (r) => KIND_LABEL[r.kind] || r.kind], ['Spouse', (r) => r.spouse_name],
      ['City', (r) => r.city], ['State', (r) => r.state], ['ZIP', (r) => r.zip],
      ...(showContacts ? ([['Street', (r: Row) => r.addr], ['Email', (r: Row) => r.email], ['Phone', (r: Row) => r.phone]] as [string, (r: Row) => unknown][]) : []),
      ['Status', (r) => STATUS_LABEL[r.status] || r.status], ['Lifetime', (r) => r.lifetime], ['Gifts', (r) => r.gifts], ['First gift', (r) => r.first_gift], ['Last gift', (r) => r.last_gift],
      ['Last gift amount', (r) => r.last_amt], ['Largest gift', (r) => r.largest], ['This year', (r) => r.ytd], ['Last year', (r) => r.last_year], ['Last 12 months', (r) => r.l12],
      ['Passed on for others', (r) => (r.passed_on ? r.passed_on : '')], ['Holders', (r) => r.holder_names], ['Constituent codes', (r) => pipes(r.codes)], ['Solicit codes', (r) => pipes(r.solicit)],
      ['Last contact', (r) => r.last_contact], ['Open actions', (r) => r.open_actions], ['Recurring gift', (r) => (r.recurring ? 'Yes' : '')], ['Deceased', (r) => (r.deceased ? 'Yes' : '')],
      ['FavorOS link', (r) => `https://dash.favorintl.org/work/partner/${r.id}`],
    ];
    if (url.searchParams.get('format') === 'json') {
      await logEvent(env, { actor: wu.actor, actor_email: wu.email, kind: 'partners_export', detail: `${rows.length} partners to Google Sheets${showContacts ? ', with contact details' : ''}` }).catch(() => undefined);
      const money = new Set(['Lifetime', 'Last gift amount', 'Largest gift', 'This year', 'Last year', 'Last 12 months', 'Passed on for others']);
      const dates = new Set(['First gift', 'Last gift', 'Last contact']);
      return {
        columns: cols.map((c, i) => ({ key: 'c' + i, label: c[0], type: money.has(c[0]) ? 'money' : dates.has(c[0]) ? 'date' : 'text' })),
        rows: rows.map((r) => Object.fromEntries(cols.map((c, i) => [('c' + i), c[1](r) ?? null]))),
      };
    }
    const csv = [cols.map((c) => csvCell(c[0])).join(','), ...rows.map((r) => cols.map((c) => csvCell(c[1](r))).join(','))].join('\r\n');
    await logEvent(env, { actor: wu.actor, actor_email: wu.email, kind: 'partners_export', detail: `${rows.length} partners${showContacts ? ', with contact details' : ''}` }).catch(() => undefined);
    return new Response('﻿' + csv, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="partners-${todayET()}.csv"`, 'Cache-Control': 'private, no-store' },
    });
  }
  if (what === 'menus') {
    const [m, tags, all] = await Promise.all([meta(env), allTags(env), contactsAll(a)]);
    return { menus: { ...m.menus, tags, bands: BAND_LABEL, kinds: KIND_LABEL, statuses: STATUS_LABEL }, builtAt: m.builtAt, records: m.records, contacts: all, fid: wu.scope.fid || null };
  }
  if (what === 'views') return { views: await views(env, wu.email) };
  if (what === 'stars') return { rows: await cards(env, await stars(env, wu.email)) };
  if (what === 'recent') return { rows: await recent(env, wu.email) };
  if (what === 'tags') {
    const cid = url.searchParams.get('cid');
    return cid ? { tags: await tagsOf(env, cid) } : { tags: await allTags(env) };
  }
  if (what === 'duplicates') {
    const pairs = await hub(env, DUP_SQL, []);
    const ids = [...new Set(pairs.flatMap((p) => [String(p.a), String(p.b)]))];
    const by = new Map((await cards(env, ids)).map((c) => [String(c.id), c]));
    return { pairs: pairs.map((p) => ({ a: by.get(String(p.a)) || { id: p.a }, b: by.get(String(p.b)) || { id: p.b }, why: String(p.why || '').split(',') })) };
  }
  if (what === 'merges') return { merges: await merges(env, url.searchParams.get('state') === 'done' ? 'done' : 'open') };
  if (what === 'record') {
    const id = checkId(seg(params, 1));
    const part = seg(params, 2);
    const page = Number(url.searchParams.get('page')) || 1;
    const size = Number(url.searchParams.get('size')) || 25;
    if (part === 'gifts') return await giftPage(mq(env), id, page, size, url.searchParams.get('sort') || 'date', url.searchParams.get('dir') || 'desc');
    if (part === 'actions') return await actionPage(mq(env), id, page, size, url.searchParams.get('filter') || '');
    if (part === 'extras') {
      const [x, tags, starred] = await Promise.all([extras(mq(env), id), tagsOf(env, id), stars(env, wu.email)]);
      return { ...x, tags, star: starred.includes(id) };
    }
  }
  throw new HttpError(404, 'not_found', 'Nothing here.');
});

export const onRequestPost = work(async (a) => {
  const { env, params, request, wu } = a;
  const what = seg(params, 0);
  const b = await body(request);
  if (what === 'views') {
    if (seg(params, 2) === 'delete') {
      await dropView(env, wu.email, seg(params, 1), wu.user.role === 'admin');
      return { views: await views(env, wu.email) };
    }
    const id = await saveView(env, wu.email, String(b.name || ''), { ...b, ownerName: wu.actor });
    return { id, views: await views(env, wu.email) };
  }
  if (what === 'stars') {
    await setStar(env, wu.email, seg(params, 1), b.on !== false);
    return { stars: await stars(env, wu.email) };
  }
  if (what === 'recent') {
    await noteRecent(env, wu.email, seg(params, 1));
    return {};
  }
  if (what === 'tags') {
    const cids = Array.isArray(b.cids) ? b.cids.map(String) : [String(b.cid || '')];
    if (b.remove) await dropTag(env, cids, String(b.tag || ''));
    else await addTag(env, wu.email, cids, String(b.tag || ''));
    return { tags: cids.length === 1 ? await tagsOf(env, cids[0]) : await allTags(env) };
  }
  if (what === 'merge') {
    const id = await requestMerge(env, { email: wu.email, name: wu.actor }, String(b.keep || ''), String(b.other || ''), String(b.note || ''));
    return { id };
  }
  if (what === 'merges' && seg(params, 1) === 'decide') {
    const role = wu.scope.role;
    if (!(wu.user.role === 'admin' || role === 'support')) throw new HttpError(403, 'support_only', 'The Support Team and admins mark merge requests.');
    await decideMerge(env, wu.email, b);
    return { merges: await merges(env, 'open') };
  }
  if (what === 'rebuild') {
    if (wu.user.role !== 'admin' && wu.user.via !== 'agent') throw new HttpError(403, 'admin_only', 'Only an admin can rebuild the directory.');
    const r = await refreshSnapshot(env);
    return { ok: r.ok, busy: !!r.busy, meta: await meta(env) };
  }
  throw new HttpError(404, 'not_found', 'Nothing here.');
});

