// Make a request fills itself out. The person types what they need; this reads it and suggests the form's answers, the owner
// and a due date. The pure reading lives in shared/request-parse.ts (the React composer runs the same code); this file adds the parts
// that need the database. Nothing here writes to the board: the form shows the answers for the person to change, and a hub admin
// presses a button to put the owner and date on the request.
import type { Env } from '../http';
import { staffDirectory } from '../people';
import { addDays, type Fill, type Surface } from '../../../shared/request-parse';

export * from '../../../shared/request-parse';

export interface OwnerGuess {
  email: string;
  name: string;
  why: string;
}

/**
 * Who usually takes this kind of request: the person who owned the most requests on the same surface in the last 90 days, else the
 * Lead Developer on the staff list. Null when the board has no history and nobody has that title.
 */
export async function suggestOwner(env: Pick<Env, 'DB'>, surface: Surface, today: string, route: 'board' | 'marketing' | 'expense' = 'board'): Promise<OwnerGuess | null> {
  const since = `${addDays(today, -90)}T00:00:00.000Z`;
  let pick = '';
  let count = 0;
  try {
    const r = await env.DB.prepare(
      `SELECT t.owner_email AS email, COUNT(*) AS n FROM request_tasks t JOIN requests q ON q.id = t.request_id
        WHERE q.surface = ? AND t.owner_email IS NOT NULL AND t.owner_email <> '' AND q.created_at > ?
        GROUP BY t.owner_email ORDER BY n DESC, MAX(t.updated_at) DESC LIMIT 1`
    )
      .bind(surface, since)
      .first<{ email: string; n: number }>();
    if (r) {
      pick = r.email;
      count = Number(r.n) || 0;
    }
  } catch {
    // the task tables are not switched on yet; the staff list answers below
  }
  const people = await staffDirectory(env).catch(() => []);
  if (route === 'marketing') {
    const m = people.filter((p) => /marketing/i.test(p.team));
    const lead = m.find((p) => /director|manager|lead/i.test(p.title)) || m[0];
    if (lead) return { email: lead.email, name: lead.name, why: 'Leads the Marketing team, which takes design, print and video requests' };
  }
  if (route === 'expense') {
    const a = people.find((p) => /operations|administrat|finance|accounting/i.test(p.title));
    if (a) return { email: a.email, name: a.name, why: 'Handles expense approvals' };
  }
  if (pick && route === 'board') {
    const p = people.find((x) => x.email === pick);
    if (p) return { email: p.email, name: p.name, why: `${count === 1 ? 'Took the last' : `Took ${count} of the last`} ${surface} request${count === 1 ? '' : 's'}` };
  }
  const dev = people.find((p) => /lead developer|developer/i.test(p.title));
  if (dev) return { email: dev.email, name: dev.name, why: 'Takes the technical requests' };
  const any = people[0];
  return any ? { email: any.email, name: any.name, why: 'First person on the staff list, since nobody has this kind of request yet' } : null;
}

export interface Suggestion {
  owner: OwnerGuess | null;
  due_date: string;
  needed: string;
  why: string;
}

/** The owner and due date the form suggested when this request was written, for the board's panel. Null when none was kept. */
export async function suggestionFor(env: Pick<Env, 'DB'>, requestId: string): Promise<Suggestion | null> {
  const row = await env.DB.prepare("SELECT fill FROM request_routes WHERE request_id = ? AND fill <> '' ORDER BY at DESC LIMIT 1")
    .bind(requestId)
    .first<{ fill: string }>()
    .catch(() => null);
  if (!row) return null;
  try {
    const f = JSON.parse(row.fill) as Fill & { owner: OwnerGuess | null };
    if (!f.owner && !f.due_date) return null;
    return { owner: f.owner || null, due_date: f.due_date || '', needed: f.needed, why: f.why?.needed || '' };
  } catch {
    return null;
  }
}
