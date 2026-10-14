// Admin > People > Favor Brain access: which FavorOS roles, teams and people get which Brain packages (2026-10-14). GET returns the
// rules, the teams in the directory and every person's packages after rules and grants. POST {op: 'add' | 'remove', kind, key,
// package} changes one rule and records it in the admin audit log. The Brain reads the same table within 30 seconds.
import { HttpError } from '../../_lib/http';
import { adminRoute, readBody } from '../../_lib/admin/route';
import { PACKAGE_LABEL, RULE_KINDS, RULE_PACKAGES, brainPackagesFor, readRules, rulePackages, type RuleKind } from '../../_lib/brain-access';

export const onRequestGet = adminRoute(async ({ env }) => {
  const rules = await readRules(env);
  const people = await env.DB.prepare(
    `SELECT lower(u.email) AS email, COALESCE(NULLIF(u.name, ''), d.name, u.email) AS name, u.role AS role, u.blocked AS blocked, d.team AS team, d.lead AS lead, d.active AS active
       FROM hub_users u LEFT JOIN meet_directory d ON lower(d.email) = lower(u.email)
      WHERE u.role <> 'field'
     UNION
     SELECT lower(d.email), d.name, NULL, 0, d.team, d.lead, d.active FROM meet_directory d
      WHERE lower(d.email) NOT IN (SELECT lower(email) FROM hub_users)
     ORDER BY 2`
  ).all<{ email: string; name: string; role: string | null; blocked: number; team: string | null; lead: number | null; active: number | null }>();
  const list = (people.results || []).filter((p) => !p.blocked);
  const after = await brainPackagesFor(env, list.map((p) => p.email));
  const teams = await env.DB.prepare("SELECT DISTINCT team FROM meet_directory WHERE team <> '' AND active = 1 ORDER BY team").all<{ team: string }>();
  return {
    rules,
    kinds: RULE_KINDS,
    packages: RULE_PACKAGES.map((k) => ({ key: k, label: PACKAGE_LABEL[k] })),
    teams: (teams.results || []).map((t) => t.team),
    people: list.map((p) => {
      const fromRules = rulePackages(rules, { email: p.email, role: p.role, team: p.active ? p.team : '', lead: p.active ? p.lead : 0 });
      const now = after.get(p.email) || new Set<string>();
      return {
        email: p.email,
        name: p.name,
        role: p.role || 'not signed in yet',
        team: p.active ? p.team || '' : '',
        packages: [...now].filter((x) => x !== 'basics').sort(),
        fromGrants: [...now].filter((x) => x !== 'basics' && !fromRules.has(x)).sort(),
        removedByGrant: [...fromRules].filter((x) => x !== 'basics' && !now.has(x)).sort(),
      };
    }),
  };
});

export const onRequestPost = adminRoute(async ({ env, request, user }) => {
  const b = await readBody(request);
  const op = String(b.op || '');
  const kind = String(b.kind || '') as RuleKind;
  const pkg = String(b.package || '');
  let key = String(b.key || '').trim().slice(0, 120);
  if (op !== 'add' && op !== 'remove') throw new HttpError(400, 'bad_op', 'Add or remove a rule.');
  if (!(RULE_KINDS as readonly string[]).includes(kind)) throw new HttpError(400, 'bad_kind', 'Pick everyone, a role, a team, team leads or a person.');
  if (!(RULE_PACKAGES as readonly string[]).includes(pkg)) throw new HttpError(400, 'bad_package', 'Pick one of the Brain packages.');
  if (kind === 'everyone') key = '';
  if (kind === 'person') {
    key = key.toLowerCase();
    if (!/^[^@\s]+@favorintl\.org$/.test(key)) throw new HttpError(400, 'bad_person', 'A person rule needs a @favorintl.org address.');
  }
  if (kind === 'role' && !['admin', 'staff'].includes(key)) throw new HttpError(400, 'bad_role', 'A role rule is for admin or staff.');
  if ((kind === 'team' && !key) || (pkg === 'admin' && kind !== 'person')) throw new HttpError(400, 'bad_rule', pkg === 'admin' ? 'Brain admin goes to one person at a time.' : 'Pick a team.');
  if (op === 'add') {
    await env.DB.prepare('INSERT OR IGNORE INTO brain_access_rules (kind, key, package, created_by, created_at) VALUES (?, ?, ?, ?, ?)').bind(kind, key, pkg, user.email, new Date().toISOString()).run();
  } else {
    // Will keeps Brain admin: the last admin rule cannot be removed here.
    if (pkg === 'admin') {
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM brain_access_rules WHERE package = 'admin'").first<{ n: number }>();
      if (Number(n?.n) <= 1) throw new HttpError(400, 'last_admin', 'Someone has to keep Brain admin.');
    }
    await env.DB.prepare('DELETE FROM brain_access_rules WHERE kind = ? AND key = ? AND package = ?').bind(kind, key, pkg).run();
  }
  await env.DB.prepare('INSERT INTO hub_audit (at, actor, area, key, label, before_value, after_value, note) VALUES (?,?,?,?,?,?,?,?)')
    .bind(new Date().toISOString(), user.email, 'brain', `brain_rule:${kind}:${key || '*'}:${pkg}`, 'Favor Brain access rule', op === 'add' ? '' : pkg, op === 'add' ? pkg : '', `${op} ${kind}${key ? ' ' + key : ''}: ${pkg}`)
    .run()
    .catch(() => undefined);
  return { rules: await readRules(env) };
});
