// When the Blackbaud copy last finished a complete sync. The "As of" stamps on Today, the Work Center,
// Reports and Favor Brain answers read this. It is one row of the mirror's sync log, so it costs one
// mirror read and no Blackbaud call.
import { mirror } from '../foundations/blackbaud';
import { SYNCED_SQL } from '../work/repo';
import type { Env } from '../http';

/** ISO UTC time of the last complete sync, or '' when the mirror has none or does not answer. */
export async function copyTime(env: Env): Promise<string> {
  try {
    const rows = await mirror<{ at: string | null }>(env, SYNCED_SQL, []);
    const at = rows[0]?.at;
    return at ? (at.includes('T') ? at : at.replace(' ', 'T') + 'Z') : '';
  } catch {
    return '';
  }
}
