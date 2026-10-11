// The admin settings registry. One list says what each setting is, where it already lives and how to change it. Three places
// hold a value:
//   act_settings   the Work Center's own rows (release, posting, lane_cap, thank_mode, thank_days, digest_rollout)
//   BB_KV          the upkeep route's daily cap (bb:ops:cap)
//   hub_settings   new settings, and the answer an admin saves over a Pages variable (MEET_RELEASE, MEET_GUESTS, MEET_DRIVE_FOLDER)
// A setting reads the place it already lives in, so nothing changes until an admin saves. Every save goes through changeSetting():
// admin only, validated, confirmed when it touches Blackbaud writes, and written to hub_audit with the old and new value.
import { HttpError, nowIso, type Env } from '../http';
import { getRollout, GROUPS, setRollout } from '../work/digest';
import { setSetting as actSet } from '../work/db';
import { getMileageSettings, getSettings, saveMileageSettings, saveSettings, splitEmails } from '../expenses/db';

export type Area = 'work' | 'meetings' | 'brain' | 'clips' | 'reports' | 'expenses' | 'receipts';
export type Kind = 'enum' | 'int' | 'text' | 'date';

export interface Opt {
  value: string;
  label: string;
}

export interface Def {
  id: string;
  area: Area;
  group?: string;
  label: string;
  hint?: string;
  kind: Kind;
  options?: Opt[];
  min?: number;
  max?: number;
  unit?: string;
  /** Changing it changes what the hub may write to Blackbaud, so the page shows the current value and asks to confirm. */
  bb?: boolean;
  /** Where it lives, in words for the audit log. */
  where: string;
  /** The value when nothing is saved. */
  def: string;
  /** A Pages variable that holds the value until an admin saves one here. */
  envVar?: string;
  read(env: Env): Promise<{ value: string; saved: boolean; by?: string; at?: string }>;
  write(env: Env, value: string, actor: string): Promise<void>;
  /** Clears a saved answer so the original place answers again. Only for settings that overlay a Pages variable. */
  clear?(env: Env): Promise<void>;
  /** Extra check against other settings. */
  check?(env: Env, value: string): Promise<void>;
}

export type EnvPlus = Env & { BB_KV?: KVNamespace };

/* ----------------------------------------------------------------------------------------------- the three stores */

export async function hubGet(env: Env, key: string): Promise<{ value: string; by: string; at: string } | null> {
  const row = await env.DB.prepare('SELECT value, updated_by AS by, updated_at AS at FROM hub_settings WHERE key = ? LIMIT 1')
    .bind(key)
    .first<{ value: string; by: string; at: string }>()
    .catch(() => null);
  return row || null;
}

export async function hubPut(env: Env, key: string, value: string, by: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  )
    .bind(key, value, by, nowIso())
    .run();
}

export async function hubDel(env: Env, key: string): Promise<void> {
  await env.DB.prepare('DELETE FROM hub_settings WHERE key = ?').bind(key).run();
}

/** What a reader gets: the saved answer, else the Pages variable, else the default. Used by the code that obeys the setting. */
export async function effective(env: Env, key: string, envVar: string | undefined, fallback: string): Promise<string> {
  const row = await hubGet(env, key);
  if (row) return row.value;
  const v = envVar ? (env as unknown as Record<string, unknown>)[envVar] : undefined;
  return typeof v === 'string' && v !== '' ? v : fallback;
}

async function actRow(env: Env, key: string): Promise<{ value: string; at: string } | null> {
  return env.DB.prepare('SELECT value, updated_at AS at FROM act_settings WHERE key = ? LIMIT 1').bind(key).first<{ value: string; at: string }>().catch(() => null);
}

/* ------------------------------------------------------------------------------------------------- definitions */

const ON_OFF: Opt[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

function actDef(p: Omit<Def, 'read' | 'write' | 'where'> & { key: string; norm?: (v: string) => string }): Def {
  const norm = p.norm || ((v: string) => v);
  return {
    ...p,
    where: `act_settings ${p.key}`,
    async read(env) {
      const row = await actRow(env, p.key);
      return { value: row ? norm(row.value) : p.def, saved: !!row, at: row?.at };
    },
    async write(env, value) {
      await actSet(env, p.key, value);
    },
  };
}

function hubDef(p: Omit<Def, 'read' | 'write' | 'where' | 'clear'>): Def {
  return {
    ...p,
    where: `hub_settings ${p.id}`,
    async read(env) {
      const row = await hubGet(env, p.id);
      if (row) return { value: row.value, saved: true, by: row.by, at: row.at };
      const v = p.envVar ? (env as unknown as Record<string, unknown>)[p.envVar] : undefined;
      return { value: typeof v === 'string' && v !== '' ? v : p.def, saved: false };
    },
    async write(env, value, actor) {
      await hubPut(env, p.id, value, actor);
    },
    async clear(env) {
      await hubDel(env, p.id);
    },
  };
}


/** An expense setting. It lives in the expense tables, where the expense log reads it, so a save here changes the log at once. */
function expDef(p: Omit<Def, 'read' | 'write' | 'where' | 'area' | 'clear'> & { get(env: Env): Promise<string>; put(env: Env, value: string): Promise<void> }): Def {
  const { get, put, ...rest } = p;
  return {
    ...rest,
    area: 'expenses',
    where: 'the expense tables',
    async read(env) {
      const v = await get(env).catch(() => p.def);
      const last = await env.DB.prepare('SELECT actor, at FROM hub_audit WHERE key = ? ORDER BY id DESC LIMIT 1').bind(p.id).first<{ actor: string; at: string }>().catch(() => null);
      return { value: v, saved: !!last, by: last?.actor, at: last?.at };
    },
    async write(env, value) {
      await put(env, value);
    },
  };
}

export const START_TABS: Opt[] = [
  { value: 'open', label: 'Open actions' },
  { value: 'intake', label: 'Entry' },
  { value: 'ty', label: 'Thank-yous' },
  { value: 'stale', label: 'Stale' },
  { value: 'opps', label: 'Opportunities' },
  { value: 'recent', label: 'Recent' },
  { value: 'gifts', label: 'Gifts to thank' },
  { value: 'asks', label: 'Asks' },
  { value: 'cadence', label: 'Cadence' },
  { value: 'hqty', label: 'HQTY letters' },
];
export const START_ROLES: Array<{ role: string; label: string; def: string }> = [
  { role: 'admin', label: 'Admin', def: 'open' },
  { role: 'director', label: 'Directors', def: 'gifts' },
  { role: 'support', label: 'Support Team', def: 'hqty' },
  { role: 'partner_care', label: 'Partner Care', def: 'cadence' },
  { role: 'grants', label: 'Grants writers', def: 'open' },
];

const upkeepCap: Def = {
  id: 'wc.upkeep_cap',
  area: 'work',
  group: 'Blackbaud calls a day',
  label: 'Upkeep calls a day',
  hint: 'Everything the hub and the sync worker send through the upkeep route. The giving form keeps the rest of the key.',
  kind: 'int',
  min: 1000,
  max: 3000,
  unit: 'calls',
  bb: true,
  where: 'KV bb:ops:cap (favor-blackbaud-tokens)',
  def: '3000',
  async read(env) {
    const kv = (env as EnvPlus).BB_KV;
    const raw = kv ? await kv.get('bb:ops:cap').catch(() => null) : null;
    const n = Number(raw);
    return { value: Number.isFinite(n) && n > 0 ? String(n) : '3000', saved: !!raw };
  },
  async write(env, value) {
    const kv = (env as EnvPlus).BB_KV;
    if (!kv) throw new HttpError(503, 'no_kv', 'The upkeep cap is not connected to this copy of the hub.');
    await kv.put('bb:ops:cap', value);
  },
  async check(env, value) {
    const lane = Number((await actRow(env, 'lane_cap'))?.value) || 2400;
    if (Number(value) < lane + 100) throw new HttpError(400, 'bad_value', `The Work Center lane is ${lane}. The upkeep cap must stay at least 100 above it.`);
  },
};

const laneCap = actDef({
  id: 'wc.lane_cap', key: 'lane_cap', area: 'work', group: 'Blackbaud calls a day', label: 'Work Center lane',
  hint: 'Calls a day the Work Center may use out of the upkeep cap. The rest stays for the sync worker.',
  kind: 'int', min: 100, max: 2900, unit: 'calls', bb: true, def: '2400', norm: (v) => String(Number(v) || 2400),
});
laneCap.check = async (env, value) => {
  const cap = Number((await upkeepCap.read(env)).value) || 3000;
  if (Number(value) > cap - 100) throw new HttpError(400, 'bad_value', `The upkeep cap is ${cap}. The lane must stay at least 100 below it.`);
};

export const DEFS: Def[] = [
  // ------------------------------------------------------------------------------------------------ Work Center
  actDef({
    id: 'wc.release', key: 'release', area: 'work', group: 'Who has the Work Center', label: 'Who can open the Work Center', kind: 'enum', bb: true, def: 'admins',
    hint: 'Admins only, or admins plus everyone on the staff list marked for the Work Center.',
    options: [{ value: 'admins', label: 'Admins only' }, { value: 'support', label: 'Staff on the list' }],
    norm: (v) => (v === 'support' ? 'support' : 'admins'),
  }),
  actDef({ id: 'wc.posting', key: 'posting', area: 'work', group: 'Blackbaud calls a day', label: 'Send changes to Blackbaud', hint: 'Off holds every change in the queue and writes nothing.', kind: 'enum', options: ON_OFF, bb: true, def: 'on', norm: (v) => (v === 'off' ? 'off' : 'on') }),
  upkeepCap,
  laneCap,
  actDef({ id: 'wc.thank_mode', key: 'thank_mode', area: 'work', group: 'Thank-yous', label: 'How a thank-you is recorded', kind: 'enum', bb: true, def: 'one', options: [{ value: 'one', label: 'One action' }, { value: 'two', label: 'Two actions' }], norm: (v) => (v === 'two' ? 'two' : 'one') }),
  actDef({ id: 'wc.thank_days', key: 'thank_days', area: 'work', group: 'Thank-yous', label: 'How far back a gift can be owed', hint: 'Older gifts are not asked about.', kind: 'int', min: 7, max: 120, unit: 'days', def: '21', norm: (v) => String(Number(v) || 21) }),
  ...START_ROLES.map((r) =>
    hubDef({ id: `wc.start.${r.role}`, area: 'work', group: 'Where each role starts', label: r.label, hint: 'The tab the Work Center opens on until a person picks their own.', kind: 'enum', options: START_TABS, def: r.def })
  ),
  ...GROUPS.map(
    (g): Def => ({
      id: `wc.rollout.${g.key}`,
      area: 'work',
      group: 'Morning email starts',
      label: g.label,
      hint: 'The first morning the group gets the Work Center email. Blank keeps it off.',
      kind: 'date',
      where: 'act_settings digest_rollout',
      def: '',
      async read(env) {
        const r = await getRollout(env);
        const row = await actRow(env, 'digest_rollout');
        return { value: r[g.key] || '', saved: !!row, at: row?.at };
      },
      async write(env, value) {
        await setRollout(env, { [g.key]: value || null });
      },
    })
  ),
  // -------------------------------------------------------------------------------------------------- Meetings
  hubDef({ id: 'meet.release', area: 'meetings', label: 'Who can use Meetings', hint: 'Admins only, or every signed-in staff member.', kind: 'enum', options: [{ value: 'admin', label: 'Admins only' }, { value: 'staff', label: 'All staff' }], def: 'admin', envVar: 'MEET_RELEASE' }),
  hubDef({ id: 'meet.guests', area: 'meetings', label: 'Guests from outside Favor', hint: 'Guests join a meeting from an invitation link without a sign-in.', kind: 'enum', options: ON_OFF, def: 'off', envVar: 'MEET_GUESTS' }),
  hubDef({ id: 'meet.drive_folder', area: 'meetings', label: 'Recording folder', hint: 'The Google Drive folder id of the Meetings folder in US Team Files.', kind: 'text', def: '', envVar: 'MEET_DRIVE_FOLDER' }),
  hubDef({ id: 'meet.lead_min', area: 'meetings', label: 'Reminder lead time', hint: 'Minutes before the start that the second reminder email goes out. The first goes a day ahead.', kind: 'int', min: 5, max: 120, unit: 'minutes', def: '15' }),
  hubDef({ id: 'meet.max_people', area: 'meetings', label: 'People in one meeting', hint: 'The next person to join a full meeting is turned away.', kind: 'int', min: 2, max: 100, unit: 'people', def: '60' }),
  // ------------------------------------------------------------------------------------------------ Favor Brain
  hubDef({ id: 'brain.connect_prompt', area: 'brain', label: 'Connect prompt', hint: 'The one-time window that offers to connect Claude or ChatGPT.', kind: 'enum', options: ON_OFF, def: 'on' }),
  hubDef({ id: 'brain.auto_titles', area: 'brain', label: 'Automatic chat titles', hint: 'A short title written after the first answer in a chat.', kind: 'enum', options: ON_OFF, def: 'on' }),
  // ------------------------------------------------------------------------------------------------------ Clips
  hubDef({ id: 'clips.cap_gb', area: 'clips', label: 'Storage for each person', kind: 'int', min: 1, max: 100, unit: 'GB', def: '10', hint: 'A person at the cap deletes clips before recording another.' }),
  hubDef({ id: 'clips.who', area: 'clips', label: 'Who can record', kind: 'enum', options: [{ value: 'all', label: 'Every staff member' }, { value: 'admins', label: 'Admins only' }, { value: 'list', label: 'Admins and the people listed' }], def: 'all' }),
  hubDef({ id: 'clips.list', area: 'clips', label: 'People who can record', hint: 'Email addresses, separated by commas. Used when the setting above is the list.', kind: 'text', def: '' }),
  hubDef({ id: 'clips.max_min', area: 'clips', label: 'Longest recording', hint: 'The recorder stops a clip at this length.', kind: 'int', min: 5, max: 120, unit: 'minutes', def: '45' }),
  hubDef({ id: 'clips.share_default', area: 'clips', label: 'Sharing link on a new clip', hint: 'A person can still switch the link on or off for each clip.', kind: 'enum', options: ON_OFF, def: 'off' }),
  // ------------------------------------------------------------------------------------------- Thank-you receipts
  hubDef({ id: 'receipts.days', area: 'receipts', label: 'Days a gift can wait for a letter', hint: 'The window the waiting list and a new print file look back over.', kind: 'int', min: 7, max: 365, unit: 'days', def: '90' }),
  hubDef({ id: 'receipts.report', area: 'receipts', label: 'Open print file in the morning email', hint: 'Off stops the hub from telling the sync worker about an unmarked print file.', kind: 'enum', options: ON_OFF, def: 'on', envVar: 'RECEIPTS_REPORT' }),
  // -------------------------------------------------------------------------------------------------------- Expenses
  expDef({ id: 'expenses.approver_name', label: 'Approver name', kind: 'text', def: '', hint: 'Shown on each request and in the emails.',
    get: async (e) => (await getSettings(e)).approver_name, put: async (e, v) => saveSettings(e, { ...(await getSettings(e)), approver_name: v }) }),
  expDef({ id: 'expenses.approver_email', label: 'Approver emails', kind: 'text', def: '', hint: 'One address, or several separated by commas. Each can approve.',
    get: async (e) => (await getSettings(e)).approver_email, put: async (e, v) => saveSettings(e, { ...(await getSettings(e)), approver_email: v }) }),
  expDef({ id: 'expenses.distribution', label: 'Copy of every decision', kind: 'text', def: '', hint: 'Addresses that get a copy, separated by commas.',
    get: async (e) => (await getSettings(e)).distribution.join(', '), put: async (e, v) => saveSettings(e, { ...(await getSettings(e)), distribution: splitEmails(v) }) }),
  expDef({ id: 'expenses.viewers', label: 'Who else can open the log', kind: 'text', def: '', hint: 'Addresses, separated by commas. Approvers and admins always can.',
    get: async (e) => (await getSettings(e)).viewers.join(', '), put: async (e, v) => saveSettings(e, { ...(await getSettings(e)), viewers: splitEmails(v).map((x) => x.toLowerCase()) }) }),
  expDef({ id: 'expenses.mileage_rate', label: 'Mileage rate', kind: 'int', min: 1, max: 500, unit: 'cents a mile', def: '76',
    get: async (e) => String((await getMileageSettings(e)).rate_cents), put: async (e, v) => saveMileageSettings(e, { ...(await getMileageSettings(e)), rate_cents: Number(v) }) }),
  expDef({ id: 'expenses.mileage_deduction', label: 'Commute miles deducted', kind: 'int', min: 0, max: 500, unit: 'miles', def: '40', hint: 'Taken off each mileage claim.',
    get: async (e) => String((await getMileageSettings(e)).deduction_miles), put: async (e, v) => saveMileageSettings(e, { ...(await getMileageSettings(e)), deduction_miles: Number(v) }) }),
];

export const defOf = (id: string): Def | undefined => DEFS.find((d) => d.id === id);

/* ----------------------------------------------------------------------------------------------------- validate */

export function normalize(d: Def, raw: unknown): string {
  const v = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';
  if (d.kind === 'enum') {
    if (!(d.options || []).some((o) => o.value === v)) throw new HttpError(400, 'bad_value', `${d.label}: pick one of the choices.`);
    return v;
  }
  if (d.kind === 'int') {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || v === '' || n < (d.min ?? 0) || n > (d.max ?? 1e9)) throw new HttpError(400, 'bad_value', `${d.label} is ${d.min} to ${d.max}${d.unit ? ' ' + d.unit : ''}.`);
    return String(n);
  }
  if (d.kind === 'date') {
    if (v === '') return '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + 'T12:00:00Z'))) throw new HttpError(400, 'bad_value', `${d.label} is a date, YYYY-MM-DD.`);
    return v;
  }
  const t = v.slice(0, 400);
  if (d.id === 'expenses.approver_name' && !t) throw new HttpError(400, 'bad_value', 'The approver needs a name.');
  if (d.id === 'expenses.approver_email' || d.id === 'expenses.distribution' || d.id === 'expenses.viewers') {
    const list = splitEmails(t);
    if (d.id === 'expenses.approver_email' && !list.length) throw new HttpError(400, 'bad_value', 'Add at least one approver address.');
    if (list.some((e) => !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(e))) throw new HttpError(400, 'bad_value', `${d.label}: use full email addresses, separated by commas.`);
    return list.join(', ');
  }
  if (d.id === 'clips.list') {
    const list = t.split(/[,\s]+/).map((e) => e.toLowerCase()).filter(Boolean);
    if (list.some((e) => !/^[a-z0-9._-]+@favorintl\.org$/.test(e))) throw new HttpError(400, 'bad_value', 'Use favorintl.org addresses, separated by commas.');
    return list.join(', ');
  }
  if (d.id === 'meet.drive_folder' && t && !/^[A-Za-z0-9_-]{10,80}$/.test(t)) throw new HttpError(400, 'bad_value', 'A Drive folder id is letters, digits, dashes and underscores.');
  return t;
}

/* --------------------------------------------------------------------------------------------------------- audit */

export async function audit(env: Env, a: { actor: string; area: string; key: string; label: string; before: string | null; after: string | null; note?: string }): Promise<void> {
  await env.DB.prepare('INSERT INTO hub_audit (at, actor, area, key, label, before_value, after_value, note) VALUES (?,?,?,?,?,?,?,?)')
    .bind(nowIso(), a.actor, a.area, a.key, a.label, a.before, a.after, a.note || '')
    .run();
}

/* ---------------------------------------------------------------------------------------------------- read, write */

export interface View {
  id: string;
  area: Area;
  group: string;
  label: string;
  hint: string;
  kind: Kind;
  options: Opt[];
  min?: number;
  max?: number;
  unit: string;
  bb: boolean;
  value: string;
  def: string;
  saved: boolean;
  by: string;
  at: string;
  where: string;
  canReset: boolean;
}

async function viewOf(env: Env, d: Def): Promise<View> {
  const r = await d.read(env).catch(() => ({ value: d.def, saved: false } as { value: string; saved: boolean; by?: string; at?: string }));
  return {
    id: d.id, area: d.area, group: d.group || '', label: d.label, hint: d.hint || '', kind: d.kind, options: d.options || [], min: d.min, max: d.max,
    unit: d.unit || '', bb: !!d.bb, value: r.value, def: d.def, saved: r.saved, by: r.by || '', at: r.at || '', where: d.where, canReset: !!d.clear && r.saved,
  };
}

export async function readArea(env: Env, area: Area): Promise<View[]> {
  const out: View[] = [];
  for (const d of DEFS.filter((x) => x.area === area)) out.push(await viewOf(env, d));
  return out;
}

export function display(d: Def, v: string): string {
  const o = (d.options || []).find((x) => x.value === v);
  if (o) return o.label.toLowerCase();
  if (d.kind === 'int') return `${v}${d.unit ? ' ' + d.unit : ''}`;
  return v === '' ? 'blank' : v;
}

/** Save one setting. `reset` clears the saved answer on a setting that overlays a Pages variable. */
export async function changeSetting(env: Env, actor: string, id: string, raw: unknown, opts: { confirm?: boolean; reset?: boolean } = {}): Promise<View> {
  const d = defOf(id);
  if (!d) throw new HttpError(404, 'no_setting', 'There is no setting by that name.');
  const before = (await d.read(env)).value;
  if (opts.reset) {
    if (!d.clear) throw new HttpError(400, 'no_reset', 'This setting has no saved answer to clear.');
    await d.clear(env);
    const after = (await d.read(env)).value;
    await audit(env, { actor, area: d.area, key: d.id, label: d.label, before, after, note: 'reset to ' + (d.envVar ? `the Pages variable ${d.envVar}` : 'the default') });
    return viewOf(env, d);
  }
  const value = normalize(d, raw);
  if (d.bb && !opts.confirm) {
    throw new HttpError(409, 'confirm', `${d.label} changes what the hub sends to Blackbaud. It is ${display(d, before)} now. Confirm to change it to ${display(d, value)}.`);
  }
  if (d.check) await d.check(env, value);
  if (value === before) return viewOf(env, d);
  await d.write(env, value, actor);
  await audit(env, { actor, area: d.area, key: d.id, label: d.label, before, after: value, note: d.bb ? 'confirmed' : '' });
  return viewOf(env, d);
}

/* --------------------------------------------------------------------------------------- what the rest of the hub reads */

export async function startTabFor(env: Env, role: string, fallback: string): Promise<string> {
  const row = await hubGet(env, `wc.start.${role}`);
  return row && START_TABS.some((t) => t.value === row.value) ? row.value : fallback;
}

export async function meetSettings(env: Env): Promise<{ release: string; guests: string; folder: string; leadMin: number; maxPeople: number }> {
  const [release, guests, folder, lead, max] = await Promise.all([
    effective(env, 'meet.release', 'MEET_RELEASE', 'admin'),
    effective(env, 'meet.guests', 'MEET_GUESTS', 'off'),
    effective(env, 'meet.drive_folder', 'MEET_DRIVE_FOLDER', ''),
    effective(env, 'meet.lead_min', undefined, '15'),
    effective(env, 'meet.max_people', undefined, '60'),
  ]);
  return { release: release.toLowerCase(), guests: guests.toLowerCase(), folder, leadMin: Math.min(120, Math.max(5, Number(lead) || 15)), maxPeople: Math.min(100, Math.max(2, Number(max) || 60)) };
}

/** The same environment with the saved meeting answers laid over the Pages variables, so the code that reads env.MEET_* needs no change. */
export async function withMeetSettings<T extends Env>(env: T): Promise<T> {
  const m = await meetSettings(env).catch(() => null);
  if (!m) return env;
  return Object.assign(Object.create(env), { MEET_RELEASE: m.release, MEET_GUESTS: m.guests, MEET_DRIVE_FOLDER: m.folder }) as T;
}

export async function brainFlag(env: Env, key: 'brain.connect_prompt' | 'brain.auto_titles'): Promise<boolean> {
  return (await effective(env, key, undefined, 'on')) !== 'off';
}

export async function clipsCapBytes(env: Env): Promise<number> {
  const gb = Number(await effective(env, 'clips.cap_gb', undefined, '10')) || 10;
  return Math.min(100, Math.max(1, gb)) * 1024 ** 3;
}

/** May this person start a recording? Admins always may. */
export async function mayRecordClips(env: Env, email: string, admin: boolean): Promise<boolean> {
  if (admin) return true;
  const who = await effective(env, 'clips.who', undefined, 'all');
  if (who === 'all') return true;
  if (who === 'admins') return false;
  const list = (await effective(env, 'clips.list', undefined, '')).split(/[,\s]+/).map((e) => e.toLowerCase());
  return list.includes(email.toLowerCase());
}

export async function clipsMaxMs(env: Env): Promise<number> {
  const m = Number(await effective(env, 'clips.max_min', undefined, '45')) || 45;
  return Math.min(120, Math.max(5, m)) * 60_000;
}

/** Does a new clip start with its sharing link on? */
export async function clipsShareDefault(env: Env): Promise<boolean> {
  return (await effective(env, 'clips.share_default', undefined, 'off')) === 'on';
}

export async function receiptsDays(env: Env): Promise<number> {
  const n = Math.floor(Number(await effective(env, 'receipts.days', undefined, '90')));
  return Number.isFinite(n) ? Math.min(365, Math.max(7, n)) : 90;
}

export async function receiptsReportOn(env: Env): Promise<boolean> {
  return (await effective(env, 'receipts.report', 'RECEIPTS_REPORT', 'on')).toLowerCase() !== 'off';
}
