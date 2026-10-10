// Shared by the morning email routes: who the signed-in person is on the staff list, and what the settings dialog shows.
import { etParts } from '../actions/intake';
import type { Env } from '../http';
import { getPrefs, getRollout, groupIsLive, groupOf, GROUPS, SECTION_KEYS, SECTION_LABEL, type Rollout } from './digest';
import { staffByEmail, type StaffRow } from './db';
import type { WorkUser } from './gate';

/** The person's staff row, or a stand-in for an admin who is not on the list, so an admin can see and test their own email. */
export async function personOf(env: Env, wu: WorkUser): Promise<StaffRow> {
  const row = await staffByEmail(env, wu.email).catch(() => null);
  if (row) return row;
  return { email: wu.email, name: wu.user.name || wu.email, team: 'admin', bb_fundraiser_id: null, work_center: 1, entry_owner: 0, entry_type: null, sheet_tab: null, active: 1, updated_at: '' };
}

export async function mailView(env: Env, person: StaffRow, now = new Date()) {
  const prefs = await getPrefs(env, person.email);
  const rollout = await getRollout(env);
  const today = etParts(now).date;
  const group = groupOf(person.team);
  const from = group ? rollout[group] : null;
  const live = groupIsLive(rollout, group, today);
  return {
    email: person.email,
    name: person.name,
    prefs,
    sections: SECTION_KEYS.map((k) => ({ key: k, label: SECTION_LABEL[k] })),
    group,
    /** Whether the rollout has reached this person's group: until it has, nothing is sent to them. */
    live,
    from,
    groupLabel: GROUPS.find((g) => g.key === group)?.label || '',
  };
}

export type { Rollout };
