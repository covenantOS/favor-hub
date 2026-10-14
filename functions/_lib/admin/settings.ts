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
import { DEFAULT_COPY, WORDING } from '../statements/copy';
import { DEFAULT_EXTRA_DOMAINS, parseDomains } from '../session';
import { aiSettings, saveAiSettings } from '../ai/admin';
import { monthOf, utcDay } from '../ai/guard';
import { hubSettings, noteHubWrite } from './hubcache';
import { cleanAccess } from '../access';

export type Area = 'work' | 'meetings' | 'brain' | 'clips' | 'reports' | 'expenses' | 'receipts' | 'statements' | 'chat' | 'projects' | 'people' | 'ai';
export type Kind = 'enum' | 'int' | 'text' | 'date' | 'access';

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
  /** Changing it changes whether the hub contacts partners, so the page asks to confirm. */
  contact?: boolean;
  /** Changing it can make Favor pay for model use past the free allowance, so the page asks to confirm. */
  spend?: boolean;
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
  const rows = await hubSettings(env).catch(() => null);
  return (rows && rows.get(key)) || null;
}

export async function hubPut(env: Env, key: string, value: string, by: string): Promise<void> {
  const at = nowIso();
  await env.DB.prepare(
    `INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  )
    .bind(key, value, by, at)
    .run();
  noteHubWrite(key, { value, by, at }, env.DB);
}

export async function hubDel(env: Env, key: string): Promise<void> {
  await env.DB.prepare('DELETE FROM hub_settings WHERE key = ?').bind(key).run();
  noteHubWrite(key, null, env.DB);
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
  { value: 'grants', label: 'Grants' },
  { value: 'giftimages', label: 'Gift images' },
];
export const START_ROLES: Array<{ role: string; label: string; def: string }> = [
  { role: 'admin', label: 'Admin', def: 'open' },
  { role: 'director', label: 'Directors', def: 'gifts' },
  { role: 'support', label: 'Support Team', def: 'intake' },
  { role: 'partner_care', label: 'Partner Care', def: 'cadence' },
  { role: 'grants', label: 'Grants writers', def: 'open' },
];

const upkeepCap: Def = {
  id: 'wc.upkeep_cap',
  area: 'work',
  group: 'Blackbaud calls a day',
  label: 'Upkeep calls a day',
  hint: 'Hub and sync worker calls. The giving form keeps the rest of the key.',
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
    if (!kv) throw new HttpError(503, 'no_kv', 'The upkeep cap is not connected to this copy of FavorOS.');
    await kv.put('bb:ops:cap', value);
  },
  async check(env, value) {
    const lane = Number((await actRow(env, 'lane_cap'))?.value) || 2400;
    if (Number(value) < lane + 100) throw new HttpError(400, 'bad_value', `The Work Center lane is ${lane}. The upkeep cap must stay at least 100 above it.`);
  },
};

const laneCap = actDef({
  id: 'wc.lane_cap', key: 'lane_cap', area: 'work', group: 'Blackbaud calls a day', label: 'Work Center lane',
  hint: 'Share of the upkeep cap. The rest stays for the sync worker.',
  kind: 'int', min: 100, max: 2900, unit: 'calls', bb: true, def: '2400', norm: (v) => String(Number(v) || 2400),
});
laneCap.check = async (env, value) => {
  const cap = Number((await upkeepCap.read(env)).value) || 3000;
  if (Number(value) > cap - 100) throw new HttpError(400, 'bad_value', `The upkeep cap is ${cap}. The lane must stay at least 100 below it.`);
};

/** A switch for a feature the AI budget guard keeps off by default (functions/_lib/ai/guard.ts). Lives in KV ai:settings. */
function aiAllowDef(feature: string, label: string, hint: string): Def {
  return {
    id: `ai.allow.${feature}`, area: 'ai', group: 'Paid features', label, hint, kind: 'enum', options: ON_OFF, def: 'off', spend: true, where: `KV ai:settings allow.${feature}`,
    async read(env) {
      const s = await aiSettings(env);
      return { value: s.allow[feature] ? 'on' : 'off', saved: feature in s.allow };
    },
    async write(env, value) {
      await saveAiSettings(env, (s) => {
        s.allow[feature] = value === 'on';
      });
    },
  };
}

const aiExtraUnits: Def = {
  id: 'ai.extra', area: 'ai', group: 'Testing', label: 'Extra AI units for testing this month',
  hint: 'Raises the daily cap for test runs only, until this many units past the cap are used this month. Each 1,000 units past the free 10,000 a day costs $0.011.',
  kind: 'int', min: 0, max: 2_000_000, unit: 'units', def: '0', spend: true, where: 'KV ai:settings extra.<month>',
  async read(env) {
    const s = await aiSettings(env);
    const m = monthOf(utcDay());
    return { value: String(Number(s.extra[m]) || 0), saved: m in s.extra };
  },
  async write(env, value) {
    await saveAiSettings(env, (s) => {
      s.extra[monthOf(utcDay())] = Number(value) || 0;
    });
  },
};

export const DEFS: Def[] = [
  // --------------------------------------------------------------------------------------------------------- AI use
  aiAllowDef('brain-writer', 'Favor Brain query writer', 'Writes new database questions with the large model. Off: Favor Brain answers from its rules, the stored household lists and the menu.'),
  aiAllowDef('check-reading', 'Gift entry check reading', 'Reads the amount, number, date and payer from a check photo. Off: the photo is kept and a person types the gift.'),
  aiExtraUnits,
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
  hubDef({ id: 'cadence.monthly_cards_per_year', area: 'work', group: 'Cadence', label: 'Handwritten cards a year for monthly partners', hint: 'Cadence asks for a text, email or call every three months. Cards are on their own count.', kind: 'enum', options: [{ value: '0', label: 'None' }, { value: '2', label: 'Two a year' }, { value: '4', label: 'Four a year' }], def: '2' }),
  hubDef({ id: 'meet.release', area: 'meetings', label: 'Who can use Meetings', hint: 'Admins only, or every signed-in staff member.', kind: 'enum', options: [{ value: 'admin', label: 'Admins only' }, { value: 'staff', label: 'All staff' }], def: 'admin', envVar: 'MEET_RELEASE' }),
  hubDef({ id: 'meet.guests', area: 'meetings', label: 'Guests from outside Favor', hint: 'Guests join a meeting from an invitation link without a sign-in.', kind: 'enum', options: ON_OFF, def: 'off', envVar: 'MEET_GUESTS' }),
  hubDef({ id: 'meet.drive_folder', area: 'meetings', label: 'Recording folder', hint: 'The Google Drive folder id of the Meetings folder in US Team Files.', kind: 'text', def: '', envVar: 'MEET_DRIVE_FOLDER' }),
  hubDef({ id: 'meet.lead_min', area: 'meetings', label: 'Reminder lead time', hint: 'Minutes before the start that the second reminder email goes out. The first goes a day ahead.', kind: 'int', min: 5, max: 120, unit: 'minutes', def: '15' }),
  hubDef({ id: 'meet.texts', area: 'meetings', label: 'Meeting texts', hint: 'Sends meeting links and the 15 minute reminder by text through the GoHighLevel number. Each text is billed by GoHighLevel.', kind: 'enum', options: ON_OFF, def: 'off' }),
  hubDef({ id: 'meet.max_people', area: 'meetings', label: 'People in one meeting', hint: 'The next person to join a full meeting is turned away.', kind: 'int', min: 2, max: 100, unit: 'people', def: '60' }),
  // ---------------------------------------------------------------------------------------------------- Reports
  hubDef({ id: 'reports.mail_folder', area: 'reports', label: 'Mail files folder', hint: 'The Google Drive folder id where the Mail file sheets go, inside US Team Files. Empty means the folder called Hub mail files.', kind: 'text', def: '' }),
  // ------------------------------------------------------------------------------------------------ Favor Brain
  hubDef({ id: 'brain.connect_prompt', area: 'brain', label: 'Connect prompt', hint: 'The one-time window that offers to connect Claude or ChatGPT.', kind: 'enum', options: ON_OFF, def: 'on' }),
  hubDef({ id: 'brain.auto_titles', area: 'brain', label: 'Automatic chat titles', hint: 'A short title written after the first answer in a chat.', kind: 'enum', options: ON_OFF, def: 'on' }),
  // ------------------------------------------------------------------------------------------------------ Clips
  hubDef({ id: 'clips.cap_gb', area: 'clips', label: 'Storage for each person', kind: 'int', min: 1, max: 100, unit: 'GB', def: '10', hint: 'A person at the cap deletes clips before recording another.' }),
  hubDef({ id: 'clips.who', area: 'clips', label: 'Who can record', kind: 'enum', options: [{ value: 'all', label: 'Every staff member' }, { value: 'admins', label: 'Admins only' }, { value: 'list', label: 'Admins and the people listed' }], def: 'all' }),
  hubDef({ id: 'clips.list', area: 'clips', label: 'People who can record', hint: 'Email addresses, separated by commas. Used when the setting above is the list.', kind: 'text', def: '' }),
  hubDef({ id: 'clips.max_min', area: 'clips', label: 'Longest recording', hint: 'The recorder stops a clip at this length.', kind: 'int', min: 5, max: 120, unit: 'minutes', def: '45' }),
  hubDef({ id: 'clips.share_default', area: 'clips', label: 'Who can watch a new clip', hint: 'Specific people means the person who made it, people they name, and members of a Chat conversation they post it in. A person changes this for each clip in its Share window. Everybody (public) is never a default.', kind: 'enum', options: [{ value: 'private', label: 'Private (only the person who made it)' }, { value: 'people', label: 'Specific people' }, { value: 'staff', label: 'Anyone at Favor with the link' }], def: 'people' }),
  // -------------------------------------------------------------------------------------------------------- Chat
  hubDef({ id: 'chat.enabled', area: 'chat', label: 'Who can use Chat', hint: 'Admins only, every signed-in staff member, or nobody.', kind: 'enum', options: [{ value: 'admins', label: 'Admins only' }, { value: 'staff', label: 'All staff' }, { value: 'group', label: 'Chosen people and teams' }, { value: 'off', label: 'Off' }], def: 'admins' }),
  hubDef({ id: 'chat.access', area: 'chat', label: 'Who is in Chat', hint: 'Used when Who can use Chat is set to Chosen people and teams. Admins always have it. A team means everyone active on that team in the staff directory.', kind: 'access', def: '{"emails":[],"teams":[]}' }),
  hubDef({ id: 'learn.enabled', area: 'chat', group: 'Learn', label: 'Who can use Learn', hint: 'Admins and HR only, every signed-in staff member, or nobody. Courses and assignments are built by admins and HR either way.', kind: 'enum', options: [{ value: 'admins', label: 'Admins and HR only' }, { value: 'staff', label: 'All staff' }, { value: 'group', label: 'Chosen people and teams' }, { value: 'off', label: 'Off' }], def: 'admins' }),
  hubDef({ id: 'learn.access', area: 'chat', group: 'Learn', label: 'Who is in Learn', hint: 'Used when Who can use Learn is set to Chosen people and teams. Admins always have it. A team means everyone active on that team in the staff directory.', kind: 'access', def: '{"emails":[],"teams":[]}' }),
  hubDef({ id: 'requests.notify', area: 'chat', group: 'Request board', label: 'Request notices', hint: 'Send to, @mentions, comments and Waiting on reach Today, the bell and a Chat card. Off records them on the request only.', kind: 'enum', options: ON_OFF, def: 'off' }),
  hubDef({ id: 'requests.email', area: 'chat', group: 'Request board', label: 'Request email', hint: 'Each notice also goes by email, unless the person chose a daily summary or none. Only when request notices are on.', kind: 'enum', options: ON_OFF, def: 'on' }),
  hubDef({ id: 'requests.notify.only', area: 'chat', group: 'Request board', label: 'Notices while off', hint: 'Email addresses, separated by commas, that still get request notices while the setting above is off.', kind: 'text', def: '' }),
  hubDef({ id: 'mail.enabled', area: 'chat', group: 'Mail', label: 'Who can use Mail', hint: 'Each person sees only their own Gmail. Admins only, every signed-in staff member, or nobody.', kind: 'enum', options: [{ value: 'admins', label: 'Admins only' }, { value: 'staff', label: 'All staff' }, { value: 'group', label: 'Chosen people and teams' }, { value: 'off', label: 'Off' }], def: 'admins' }),
  hubDef({ id: 'mail.access', area: 'chat', group: 'Mail', label: 'Who is in Mail', hint: 'Used when Who can use Mail is set to Chosen people and teams. Admins always have it. A team means everyone active on that team in the staff directory.', kind: 'access', def: '{"emails":[],"teams":[]}' }),
  hubDef({ id: 'mail.write', area: 'chat', group: 'Mail', label: 'Change and send from Mail', hint: 'Off keeps Mail read only. Reply, archive and the rest open Gmail.', kind: 'enum', options: ON_OFF, def: 'on' }),
  // ---------------------------------------------------------------------------------------------------- People
  hubDef({
    id: 'signin.domains', area: 'people', group: 'Sign-in domains', label: 'Other domains that may ask for access',
    hint: 'Google Workspace domains, separated by commas. A person on one of these waits for an admin to approve them, then has Chat, Meetings and Favor Brain only.',
    kind: 'text', def: DEFAULT_EXTRA_DOMAINS,
  }),
  hubDef({
    id: 'field.brain', area: 'people', group: 'Field staff', label: 'Favor Brain for field staff',
    hint: 'Approved field staff may ask about the manuals and the programs. Partner records, giving and the dashboards stay closed to them.',
    kind: 'enum', options: ON_OFF, def: 'off',
  }),
  hubDef({
    id: 'release.badges', area: 'people', group: 'Release badges', label: 'Badge changes',
    hint: 'Changes to the Alpha, Beta and New badges in the menu, page headers and help. A JSON object of key and badge, for example {"projects":"beta","ask":"none"}. Keys are area ids (meet, chat, mail, learn, ask, kpi, today), page ids (projects, receipts, work-center for the Work Center), help:<article> or lite. Empty keeps the built-in list.',
    kind: 'text', def: '',
    async check(_env, value) {
      if (!value.trim()) return;
      let o: unknown;
      try { o = JSON.parse(value); } catch { throw new HttpError(400, 'bad', 'Badge changes must be a JSON object, like {"projects":"beta"}.'); }
      if (!o || typeof o !== 'object' || Array.isArray(o)) throw new HttpError(400, 'bad', 'Badge changes must be a JSON object, like {"projects":"beta"}.');
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (!['alpha', 'beta', 'new', 'none'].includes(String(v))) throw new HttpError(400, 'bad', `The badge for ${k} must be alpha, beta, new or none.`);
      }
    },
  }),
  // ---------------------------------------------------------------------------------------------------- Projects
  hubDef({ id: 'projects.enabled', area: 'projects', label: 'Who can use Projects', hint: 'Admins only, every signed-in staff member, or nobody. Task notices follow the Request notices setting in Admin > Chat.', kind: 'enum', options: [{ value: 'admins', label: 'Admins only' }, { value: 'staff', label: 'All staff' }, { value: 'off', label: 'Off' }], def: 'admins' }),
  hubDef({ id: 'projects.marketing_key', area: 'projects', label: 'Project for Marketing requests', hint: 'The key of the project where a Marketing request lands as a task, for example MKT. Empty leaves requests going to the form they use now.', kind: 'text', def: '' }),
  // ------------------------------------------------------------------------------------------- Thank-you receipts
  hubDef({ id: 'receipts.days', area: 'receipts', label: 'Days a gift can wait for a receipt', hint: 'The window the waiting list and a new print file look back over.', kind: 'int', min: 7, max: 365, unit: 'days', def: '90' }),
  hubDef({ id: 'receipts.report', area: 'receipts', label: 'Open print file in the morning email', hint: 'Off stops FavorOS from telling the sync worker about an unmarked print file.', kind: 'enum', options: ON_OFF, def: 'on', envVar: 'RECEIPTS_REPORT' }),
  // ------------------------------------------------------------------------------------------------- Giving statements
  hubDef({
    id: 'statements.email', area: 'statements', group: 'Sending', label: 'Emailing statements', contact: true,
    hint: 'On lets the Statements page email a statement to a partner who has an email address. Off keeps every statement a print file. Turning it on contacts partners.',
    kind: 'enum', options: ON_OFF, def: 'off',
  }),
  hubDef({ id: 'statements.batch_size', area: 'statements', group: 'Print files', label: 'Statements in one print file', hint: 'The year-end run makes files of this size, one at a time.', kind: 'int', min: 10, max: 500, unit: 'statements', def: '100' }),
  hubDef({
    id: 'statements.drive_folder', area: 'statements', group: 'Print files', label: 'Copy folder in US Team Files',
    hint: 'The Google Drive folder id of a folder inside US Team Files. A single statement is saved there when this is set. Blank keeps copies in FavorOS only.',
    kind: 'text', def: '',
  }),
  ...WORDING.map((w) =>
    hubDef({ id: w.id, area: 'statements', group: 'Wording on the statement', label: w.label, hint: w.hint, kind: 'text', def: DEFAULT_COPY[w.key] })
  ),
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
  if (d.kind === 'access') {
    const c = cleanAccess(typeof raw === 'string' ? raw : JSON.stringify(raw ?? {}));
    if (!c.ok) throw new HttpError(400, 'bad_value', `${d.label}: ${c.error}`);
    return c.value;
  }
  const t = v.slice(0, WORDING.find((w) => w.id === d.id)?.max ?? 400);
  if (d.id === 'expenses.approver_name' && !t) throw new HttpError(400, 'bad_value', 'The approver needs a name.');
  if (d.id === 'expenses.approver_email' || d.id === 'expenses.distribution' || d.id === 'expenses.viewers') {
    const list = splitEmails(t);
    if (d.id === 'expenses.approver_email' && !list.length) throw new HttpError(400, 'bad_value', 'Add at least one approver address.');
    if (list.some((e) => !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(e))) throw new HttpError(400, 'bad_value', `${d.label}: use full email addresses, separated by commas.`);
    return list.join(', ');
  }
  if (d.id === 'signin.domains') {
    const tokens = t.toLowerCase().split(/[\s,;]+/).filter(Boolean);
    const good = parseDomains(t);
    const bad = tokens.filter((x) => !good.includes(x));
    if (bad.length) throw new HttpError(400, 'bad_value', `${d.label}: ${bad.join(', ')} is not a company domain. Use names like favourafrica.org. Favor's own domain and public mail services (Gmail, Outlook, Yahoo) are not listed here.`);
    return good.join(', ');
  }
  if (d.id === 'clips.list') {
    const list = t.split(/[,\s]+/).map((e) => e.toLowerCase()).filter(Boolean);
    if (list.some((e) => !/^[a-z0-9._-]+@favorintl\.org$/.test(e))) throw new HttpError(400, 'bad_value', 'Use favorintl.org addresses, separated by commas.');
    return list.join(', ');
  }
  if (d.id === 'statements.drive_folder' && t && !/^[A-Za-z0-9_-]{10,80}$/.test(t)) throw new HttpError(400, 'bad_value', 'A Drive folder id is letters, digits, dashes and underscores.');
  if ((d.id === 'meet.drive_folder' || d.id === 'reports.mail_folder') && t && !/^[A-Za-z0-9_-]{10,80}$/.test(t)) throw new HttpError(400, 'bad_value', 'A Drive folder id is letters, digits, dashes and underscores.');
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
  contact: boolean;
  spend: boolean;
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
    unit: d.unit || '', bb: !!d.bb, contact: !!d.contact, spend: !!d.spend, value: r.value, def: d.def, saved: r.saved, by: r.by || '', at: r.at || '', where: d.where, canReset: !!d.clear && r.saved,
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
    throw new HttpError(409, 'confirm', `${d.label} changes what FavorOS sends to Blackbaud. It is ${display(d, before)} now. Confirm to change it to ${display(d, value)}.`);
  }
  if (d.spend && !opts.confirm) {
    throw new HttpError(409, 'confirm', `${d.label} can add model charges past the free allowance. It is ${display(d, before)} now. Confirm to change it to ${display(d, value)}.`);
  }
  if (d.contact && !opts.confirm) {
    throw new HttpError(409, 'confirm', `${d.label} changes whether FavorOS emails partners. It is ${display(d, before)} now. Confirm to change it to ${display(d, value)}.`);
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
export async function clipsShareDefault(env: Env): Promise<'private' | 'people' | 'staff'> {
  const v = await effective(env, 'clips.share_default', undefined, 'people');
  // 'off' and 'on' are the old two-way setting: off was no link at all, on was the old link switch (now Anyone at Favor).
  return v === 'private' ? 'private' : v === 'staff' || v === 'on' ? 'staff' : 'people';
}

export async function receiptsDays(env: Env): Promise<number> {
  const n = Math.floor(Number(await effective(env, 'receipts.days', undefined, '90')));
  return Number.isFinite(n) ? Math.min(365, Math.max(7, n)) : 90;
}

export async function receiptsReportOn(env: Env): Promise<boolean> {
  return (await effective(env, 'receipts.report', 'RECEIPTS_REPORT', 'on')).toLowerCase() !== 'off';
}
