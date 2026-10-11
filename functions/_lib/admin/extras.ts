// Read-only facts shown beside each tab's settings: the cadence rules, the tags list, the question log, clip storage and the approver schedule.
import type { Env } from '../http';
import { mirror } from '../foundations/blackbaud';
import { getSetting } from '../work/db';
import { AHEAD_DAYS, FIRST_DAYS, LIMIT, PERIOD, QUARTERLY_DAYS, RULE_LABEL, RULE_STEPS, STEP_LABEL } from '../work/cadence';
import { getSettings, listOverrides, splitEmails } from '../expenses/db';
import { GROUPS } from '../work/digest';
import { DAILY_CAP, LANE_CAP } from '../actions/batch';
import { getMeter } from '../work/db';
import type { Area } from './settings';

const money = (n: number) => '$' + n.toLocaleString('en-US');

async function workExtras(env: Env) {
  const rules = [
    { rule: RULE_LABEL.first, text: `A call at once, then a card. Stays on the list ${FIRST_DAYS} days after the first gift.` },
    { rule: RULE_LABEL.monthly, text: `${RULE_STEPS.monthly.map((s) => STEP_LABEL[s]).join(' and ')} every ${PERIOD.monthly} days.` },
    { rule: RULE_LABEL.quarterly, text: `Thanked each time they give. Stays owed ${QUARTERLY_DAYS} days.` },
    { rule: RULE_LABEL.semi, text: `${RULE_STEPS.semi.map((s) => STEP_LABEL[s]).join(' and ')} every ${PERIOD.semi} days.` },
    { rule: RULE_LABEL.annual, text: `${RULE_STEPS.annual.map((s) => STEP_LABEL[s]).join(', ')} every ${PERIOD.annual} days.` },
    { rule: 'Partner Care thanks', text: `First gifts and gifts under ${money(LIMIT)}. A partner a director holds stays the director's.` },
    { rule: 'Coming up', text: `Rows due inside ${AHEAD_DAYS} days show as coming up.` },
  ];
  let tags: Array<{ name: string; type: string; values: string[] }> = [];
  let tagsAt = '';
  try {
    const raw = await getSetting(env, 'codes:v3', '');
    const c = raw ? JSON.parse(raw) : null;
    if (c && Array.isArray(c.tagCategories)) {
      tags = c.tagCategories.map((t: any) => ({ name: String(t.name), type: String(t.type || 'Text'), values: Array.isArray(t.values) ? t.values.map(String) : [] }));
      tagsAt = String(c.at || '');
    }
  } catch {
    tags = [];
  }
  const meter = await getMeter(env).catch(() => ({ used: 0 }));
  return {
    rules,
    tags,
    tagsAt,
    groups: GROUPS.map((g) => ({ key: g.key, label: g.label })),
    calls: { used: meter.used, cap: DAILY_CAP, lane: LANE_CAP },
  };
}

async function brainExtras(env: Env) {
  const [pending, questions, iw] = await Promise.all([
    env.DB.prepare("SELECT id, name, email, package, at FROM brain_requests WHERE status = 'pending' ORDER BY id LIMIT 20").all().catch(() => ({ results: [] })),
    env.DB.prepare(
      `SELECT t.email AS email, u.question AS question, u.at AS at FROM brain_turns u JOIN brain_threads t ON t.id = u.thread_id
       WHERE t.source = 'person' ORDER BY u.id DESC LIMIT 100`
    ).all().catch(() => ({ results: [] })),
    mirror(env, "SELECT name AS k, value AS v FROM dp_settings WHERE name LIKE 'iwave%'").catch(() => null),
  ]);
  const caps: Record<string, string> = {};
  for (const r of (iw || []) as Array<{ k: string; v: string }>) caps[r.k] = r.v;
  return {
    pending: pending.results || [],
    questions: questions.results || [],
    iwave: iw
      ? [
          { label: 'Refreshes a day', value: caps.iwave_daily_cap || '10' },
          { label: 'Refreshes for one person a day', value: caps.iwave_person_cap || '3' },
          { label: 'Automatic screening a run', value: caps.iwave_auto_cap || '25' },
          { label: 'Credit floor', value: caps.iwave_credit_floor || '100' },
          { label: 'Mode', value: caps.iwave_refresh_mode || 'admin' },
        ]
      : null,
  };
}

async function clipsExtras(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT c.owner_email AS email, COALESCE(u.name, c.owner_name, c.owner_email) AS name, COUNT(*) AS clips, COALESCE(SUM(c.size_bytes), 0) AS bytes
     FROM hub_clips c LEFT JOIN hub_users u ON u.email = c.owner_email WHERE c.status != 'failed' GROUP BY c.owner_email ORDER BY bytes DESC LIMIT 100`
  ).all().catch(() => ({ results: [] }));
  return { usage: rows.results || [] };
}

async function expenseExtras(env: Env) {
  const s = await getSettings(env).catch(() => null);
  const overrides = await listOverrides(env).catch(() => []);
  return {
    approver: s ? { name: s.approver_name, emails: splitEmails(s.approver_email) } : null,
    viewers: s ? s.viewers : [],
    overrides: overrides.map((o) => ({ start: o.start_date, end: o.end_date, name: o.name, email: o.email })),
  };
}

export async function areaExtras(env: Env, area: Area | 'expenses') {
  if (area === 'work') return workExtras(env);
  if (area === 'brain') return brainExtras(env);
  if (area === 'clips') return clipsExtras(env);
  if (area === 'expenses') return expenseExtras(env);
  return {};
}
