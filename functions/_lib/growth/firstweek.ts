// The first week, built for a new hire's role. The role comes from the team and title on the onboarding run (or the staff
// directory); each role has a Learn path of the same name, and the five days are made of that path's courses, the common
// courses every new hire takes, the practice record and two conversations with the supervisor. Progress comes from Learn's
// own tables, so a course finished in Learn ticks here. Roles are named, never people.
import { newId, nowIso, type Env } from '../http';
import { practiceDone } from './practice';

type Db = Pick<Env, 'DB'>;
const lower = (s: unknown) => String(s || '').trim().toLowerCase();

export interface Role {
  key: string;
  label: string;
  /** Matched against the team and the title, lower case. */
  match: RegExp;
  /** The Learn path slug for the role; the role's courses come from it. */
  path: string;
  /** Courses on day 4, in order. */
  courses: string[];
  /** Practice entry or call logging matters for this role. */
  practice: ('gift' | 'call')[];
  work: string;
}

export const ROLES: Role[] = [
  { key: 'rdd', label: 'Regional Development Director', match: /\brdd\b|regional development|development \(rdd\)/, path: 'rdd', courses: ['work-center', 'rdd-actions'], practice: ['call'], work: 'Open your partners in the Work Center, read the next actions due and log a contact the way you will every week.' },
  { key: 'partner-care', label: 'Partner Care', match: /partner care/, path: 'partner-care', courses: ['work-center', 'partner-care-gifts'], practice: ['gift', 'call'], work: 'Learn how a gift by phone goes in, how a thank-you is sent and how a call is logged.' },
  { key: 'church', label: 'Church Engagement', match: /church/, path: 'church-engagement', courses: ['work-center', 'blackbaud-queries'], practice: ['call'], work: 'Open the Work Center, find a church partner and log a contact.' },
  { key: 'grants', label: 'Grants', match: /grant/, path: 'grants', courses: ['grants-records', 'blackbaud-queries'], practice: ['call'], work: 'Learn how a grant action, a letter of intent and an award are recorded.' },
  { key: 'marketing', label: 'Marketing', match: /market|communicat|media/, path: 'marketing', courses: ['blackbaud-queries', 'marketing-receipts'], practice: [], work: 'Learn the request board, thank-you receipts and the reports your team pulls.' },
  { key: 'admin-desk', label: 'Admin desk', match: /admin|operations|front desk|office|hr\b|human resources|bookkeep|finance|account/, path: 'admin-desk', courses: ['admin-desk'], practice: ['gift'], work: 'Learn gift batches, receipts and giving statements, then enter a gift by hand.' },
  { key: 'support', label: 'Support Team', match: /support/, path: 'support-team', courses: ['work-center', 'blackbaud-queries'], practice: ['gift', 'call'], work: 'Open the Work Center and the queries your team uses, add a gift and log a contact.' },
];

export const GENERAL: Role = { key: 'general', label: 'New hire', match: /$^/, path: 'new-hire-favor', courses: ['work-center'], practice: ['call'], work: 'Open the Work Center and see which tools your supervisor wants you in first.' };

/** The role for a team and a title. A team word wins over a title word, so an Associate in Partner Care is Partner Care. */
export function roleOf(team: unknown, title: unknown): Role {
  const t = lower(team);
  const both = `${t} ${lower(title)}`;
  return ROLES.find((r) => r.match.test(t)) || ROLES.find((r) => r.match.test(both)) || GENERAL;
}

export type ItemKind = 'course' | 'practice' | 'tour' | 'meet' | 'read';

export interface Item {
  kind: ItemKind;
  title: string;
  detail: string;
  href: string;
  slug?: string;
  minutes?: number;
  lessons?: number;
  lessonsDone?: number;
  done: boolean;
}

export interface Day {
  day: number;
  title: string;
  items: Item[];
}

export interface Week {
  role: { key: string; label: string; path: string; known: boolean };
  start: string;
  days: Day[];
  done: number;
  total: number;
  assigned: boolean;
}

interface CourseFacts { id: string; slug: string; title: string; lessons: number; done: number; complete: boolean; minutes: number }

async function courseFacts(env: Db, email: string, slugs: string[]): Promise<Map<string, CourseFacts>> {
  const out = new Map<string, CourseFacts>();
  try {
    for (const slug of slugs) {
      const c = await env.DB.prepare(`SELECT id, slug, title FROM learn_courses WHERE slug = ? AND status = 'published'`).bind(slug).first<{ id: string; slug: string; title: string }>();
      if (!c) continue;
      const l = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(minutes), 0) AS m FROM learn_lessons WHERE course_id = ?').bind(c.id).first<{ n: number; m: number }>();
      const d = await env.DB.prepare(`SELECT COUNT(*) AS n FROM learn_progress WHERE email = ? AND course_id = ? AND state = 'done'`).bind(email, c.id).first<{ n: number }>();
      const k = await env.DB.prepare('SELECT 1 AS x FROM learn_completions WHERE email = ? AND course_id = ?').bind(email, c.id).first();
      out.set(slug, { id: c.id, slug, title: c.title, lessons: Number(l?.n) || 0, done: Number(d?.n) || 0, complete: !!k, minutes: Number(l?.m) || 0 });
    }
  } catch {
    // Learn is not written yet: the days still show, without progress.
  }
  return out;
}

async function pathGiven(env: Db, email: string, slug: string): Promise<boolean> {
  try {
    const r = await env.DB.prepare(`SELECT 1 AS x FROM learn_assignments a JOIN learn_paths p ON p.id = a.target_id WHERE a.email = ? AND a.kind = 'path' AND p.slug = ? AND a.closed_why IS NOT 'removed'`).bind(email, slug).first();
    return !!r;
  } catch {
    return false;
  }
}

const TITLES: Record<string, { title: string; detail: string }> = {
  'favoros-basics': { title: 'FavorOS basics', detail: 'Sign in, read Today and find your way around.' },
  'favor-who-we-are': { title: 'Favor: who we are', detail: 'The words staff use and how the team works together.' },
  'requests-and-clips': { title: 'Requests, expenses and Clips', detail: 'Ask for something, file an expense and record a clip.' },
  'blackbaud-first-week': { title: 'Blackbaud: your first week', detail: 'Find a partner, read a record and know what not to touch.' },
  'favor-brain': { title: 'Favor Brain: ask the numbers', detail: 'Ask a question in plain words and read the answer.' },
};

export async function firstWeekFor(env: Db, p: { email: string; team?: string; title?: string; start?: string }, now = new Date()): Promise<Week> {
  const email = lower(p.email);
  const role = roleOf(p.team, p.title);
  const known = role.key !== 'general';
  const slugs = [...new Set(['favoros-basics', 'favor-who-we-are', 'requests-and-clips', 'blackbaud-first-week', 'favor-brain', ...role.courses])];
  const facts = await courseFacts(env, email, slugs);
  const practiced = await practiceDone(env, email, role.practice);

  const course = (slug: string): Item => {
    const f = facts.get(slug);
    const t = TITLES[slug];
    const title = f?.title || t?.title || slug;
    const detail = t?.detail || (f ? '' : '');
    return {
      kind: 'course',
      slug,
      title,
      detail,
      href: f ? `/learn/c/?c=${encodeURIComponent(slug)}` : '/learn/',
      minutes: f?.minutes || 0,
      lessons: f?.lessons || 0,
      lessonsDone: f?.done || 0,
      done: !!f?.complete,
    };
  };
  const practiceItem = (): Item => ({
    kind: 'practice',
    title: role.practice.length ? `Practice: ${role.practice.map((k) => (k === 'gift' ? 'add a gift' : 'log a contact')).join(' and ')}` : 'Practice record',
    detail: 'A pretend partner record. Nothing you enter here goes to Blackbaud or to a real partner.',
    href: '/learn/practice/',
    done: practiced,
  });

  const days: Day[] = [
    {
      day: 1,
      title: 'Find your feet',
      items: [
        { kind: 'tour', title: 'Take the FavorOS tour', detail: 'Eight to ten stops on the real screens, set up for your role.', href: '/?tour=1', done: false },
        course('favoros-basics'),
        { kind: 'meet', title: 'Meet your supervisor', detail: "Agree what a good first week looks like in your role.", href: '/welcome/', done: false },
      ],
    },
    { day: 2, title: 'Learn Favor', items: [course('favor-who-we-are'), course('requests-and-clips')] },
    { day: 3, title: 'Blackbaud', items: [course('blackbaud-first-week'), { kind: 'read', title: 'Partner page', detail: 'How a partner record reads in FavorOS: gifts, contacts and notes in one place.', href: '/help/partner-page/', done: false }] },
    { day: 4, title: `Your work as ${role.label === 'New hire' ? 'a new hire' : role.label}`, items: [...role.courses.map(course), ...(role.practice.length ? [practiceItem()] : [])] },
    {
      day: 5,
      title: 'Ask and check in',
      items: [
        course('favor-brain'),
        { kind: 'meet', title: 'Check in with your supervisor', detail: 'Say what is clear and what is not. Your supervisor sets your first month.', href: '/welcome/', done: false },
      ],
    },
  ];
  const all = days.flatMap((d) => d.items).filter((i) => i.kind === 'course' || i.kind === 'practice');
  const done = all.filter((i) => i.done).length;
  return {
    role: { key: role.key, label: role.label, path: role.path, known },
    start: p.start || '',
    days,
    done,
    total: all.length,
    assigned: await pathGiven(env, email, role.path),
  };
}

/** Gives the person the Learn path for their role. Safe to run twice. The state says what happened; nothing throws. */
export async function assignRolePath(env: Db, email: string, by: string, due: string | null, team: unknown, title: unknown): Promise<{ title: string; slug: string; state: 'given' | 'already' | 'missing' | 'off' | 'none' }> {
  const role = roleOf(team, title);
  if (role.key === 'general') return { title: role.label, slug: '', state: 'none' };
  try {
    const path = await env.DB.prepare('SELECT id, title FROM learn_paths WHERE slug = ?').bind(role.path).first<{ id: string; title: string }>();
    if (!path) return { title: role.label, slug: role.path, state: 'missing' };
    const have = await env.DB.prepare(`SELECT id, closed_at, closed_why FROM learn_assignments WHERE email = ? AND kind = 'path' AND target_id = ?`).bind(lower(email), path.id).first<{ id: string; closed_at: string | null; closed_why: string | null }>();
    const now = nowIso();
    if (have && !(have.closed_at && have.closed_why === 'removed')) return { title: path.title, slug: role.path, state: 'already' };
    if (have) {
      await env.DB.prepare(`UPDATE learn_assignments SET closed_at = NULL, closed_why = NULL, due_date = ?, source = 'onboarding', assigned_by = ?, assigned_at = ? WHERE id = ?`).bind(due, lower(by), now, have.id).run();
    } else {
      await env.DB.prepare(`INSERT INTO learn_assignments (id, email, kind, target_id, due_date, source, group_label, note, assigned_by, assigned_at) VALUES (?, ?, 'path', ?, ?, 'onboarding', 'New hire', '', ?, ?)`)
        .bind(newId('asg'), lower(email), path.id, due, lower(by), now).run();
    }
    return { title: path.title, slug: role.path, state: 'given' };
  } catch {
    return { title: role.label, slug: role.path, state: 'off' };
  }
}
