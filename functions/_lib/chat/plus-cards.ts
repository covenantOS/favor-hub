// Cards filled in each time a message is read: checklists (each line a Projects task, read as it is now), polls (the votes now),
// and the private notes that confirm a scheduled message or reminder (waiting, sent or canceled now).
import type { Env } from '../http';
import type { Attachment } from './db';
import { dirMap, dueLabel, nameOf, taskLine, taskUrl, todayEt, type TaskLine } from '../projects/links/shared';
import { whenLabel } from './when';

export async function hydratePlusCards(env: Env, list: Attachment[]): Promise<Attachment[]> {
  const wants = list.some((a) => a.type === 'checklist' || a.type === 'poll' || a.type === 'note');
  if (!wants) return list;
  const out: Attachment[] = [];
  let dir: Awaited<ReturnType<typeof dirMap>> | null = null;
  const names = async () => (dir ||= await dirMap(env));
  for (const a of list) {
    if (a.type === 'checklist') {
      const ids = Array.isArray(a.ids) ? (a.ids as unknown[]).map(String).slice(0, 30) : [];
      const lines: TaskLine[] = [];
      for (const id of ids) {
        const t = await taskLine(env, id);
        if (t && t.status !== 'dropped') lines.push(t);
      }
      const d = await names();
      const today = todayEt();
      const items = lines.map((t) => ({
        id: t.id,
        code: t.code || '',
        title: t.title,
        done: t.status === 'done',
        owner: t.owner_email ? nameOf(d, t.owner_email) : '',
        owner_email: t.owner_email || '',
        due: dueLabel(t.due_date, t.due_time),
        late: !!t.due_date && t.due_date < today && t.status !== 'done',
        url: taskUrl(t, t.project_key ? { key: t.project_key } : null),
      }));
      out.push({ type: 'checklist', title: String(a.title || 'Checklist'), items, done: items.filter((i) => i.done).length, total: items.length });
      continue;
    }
    if (a.type === 'poll') {
      const opts = Array.isArray(a.opts) ? (a.opts as unknown[]).map(String).slice(0, 10) : [];
      const mid = Number(a.mid) || 0;
      const votes = mid
        ? ((await env.DB.prepare('SELECT email, choice FROM chat_poll_votes WHERE message_id = ? ORDER BY created_at').bind(mid).all<{ email: string; choice: number }>().catch(() => ({ results: [] as Array<{ email: string; choice: number }> }))).results || [])
        : [];
      const d = await names();
      const people = new Set(votes.map((v) => v.email));
      out.push({
        type: 'poll', mid, q: String(a.q || ''), multi: !!a.multi, closed: !!a.closed, by: String(a.by || ''),
        opts: opts.map((label, i) => {
          const who = votes.filter((v) => v.choice === i).map((v) => v.email);
          return { label, n: who.length, who, names: who.map((e) => nameOf(d, e)) };
        }),
        voters: people.size,
      });
      continue;
    }
    if (a.type === 'note') {
      const sid = String(a.sid || '');
      let status = String(a.status || '');
      let at = String(a.at || '');
      if (sid) {
        const r = await env.DB.prepare('SELECT status, send_at FROM chat_scheduled WHERE id = ?').bind(sid).first<{ status: string; send_at: string }>().catch(() => null);
        if (r) {
          status = r.status;
          at = r.send_at;
        }
      }
      out.push({ ...a, status, at, at_label: at ? whenLabel(at) : '' });
      continue;
    }
    out.push(a);
  }
  return out;
}
