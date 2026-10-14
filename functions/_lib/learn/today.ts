// Learn on Today and in the menu: the access flags, the Today card and the badge. A card and a badge appear only for a person
// who may open Learn and whom notices may reach (the request board's gate), so a switched-off notice setting shows nothing.
import type { Env } from '../http';
import type { HubUser } from '../session';
import { groupMembers } from '../access';
import { mayHear } from '../requests/tasks';
import { isHrOrAdmin } from '../people-dev';
import { hasAssignment, learnMode, learnReady, lower } from './db';
import { badgeFor } from './views';

export interface LearnCard {
  id: string;
  label: string;
  n: number;
  what: string;
  note: string;
  warn: boolean;
  href: string;
  cta: string;
}

/** access.learn opens Learn; access.learnAdmin opens authoring (a hub admin or a person marked HR). */
export async function learnAccess(env: Env, user: HubUser): Promise<{ learn: boolean; learnAdmin: boolean }> {
  if (user.via === 'agent') return { learn: false, learnAdmin: false };
  try {
    const [mode, ready] = await Promise.all([learnMode(env), learnReady(env)]);
    if (!ready || mode === 'off') return { learn: false, learnAdmin: false };
    if (mode === 'group') {
      // learn.access: admins and the named people and teams. Assigned courses do not open Learn for anyone else.
      const inGroup = user.role === 'admin' || (await groupMembers(env, 'learn')).has(lower(user.email));
      return { learn: inGroup, learnAdmin: inGroup && (await isHrOrAdmin(env, user)) };
    }
    const author = await isHrOrAdmin(env, user);
    return { learn: mode === 'staff' || author || (await hasAssignment(env, user.email)), learnAdmin: author };
  } catch {
    return { learn: false, learnAdmin: false };
  }
}

const short = (t: string, n = 56) => (t.length > n ? t.slice(0, n - 2) + '...' : t);
const dayWord = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

/** The number beside Learn in the menu: courses and paths assigned to this person and not finished. */
export async function learnCount(env: Env, user: HubUser, access: { learn: boolean }): Promise<number> {
  if (!access.learn) return 0;
  if (!(await mayHear(env, user.email).catch(() => false))) return 0;
  return (await badgeFor(env, lower(user.email)).catch(() => ({ open: 0 }))).open;
}

/** One Today card when learning is assigned. Late items turn it to a warning. */
export async function learnCards(env: Env, user: HubUser, access: { learn: boolean }): Promise<LearnCard[]> {
  if (!access.learn) return [];
  if (!(await mayHear(env, user.email).catch(() => false))) return [];
  const b = await badgeFor(env, lower(user.email)).catch(() => null);
  if (!b || !b.open) return [];
  const note = b.overdue
    ? `${b.overdue} past the due date`
    : b.next
      ? `${short(b.next.title)}${b.next.due_date ? `, due ${dayWord(b.next.due_date)}` : ''}`
      : '';
  return [
    {
      id: 'learn',
      label: 'Learning',
      n: b.open,
      what: b.open === 1 ? 'course assigned to you' : 'courses assigned to you',
      note,
      warn: b.overdue > 0,
      href: b.open === 1 && b.next ? b.next.href : '/learn/',
      cta: b.open === 1 ? 'Open it' : 'Open My learning',
    },
  ];
}
