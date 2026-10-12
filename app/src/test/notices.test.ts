import { describe, expect, it } from 'vitest';
import { badge, fromChat, fromHub, fromProjects, fromReminders, fromRequests, grouped } from '@/shell/notices';
import { chatInboxResponse, projectNoticesResponse, remindersResponse, requestNoticesResponse } from '@shared/schemas';

const now = () => new Date().toISOString();

describe('one notification list', () => {
  it('turns each source into the same row', () => {
    const rem = fromReminders(remindersResponse.parse({ ok: true, rows: [{ id: 5, title: 'Call Sample', at: now(), bucket: 'now', cid: 101 }], count: 1 }).rows);
    expect(rem[0]).toMatchObject({ source: 'Reminders', warn: true, href: '/work/partner/101', reminder: { id: '5', cid: '101' } });

    const req = fromRequests(requestNoticesResponse.parse({ ok: true, count: 1, items: [{ id: 1, kind: 'comment', actor_name: 'Ada', title: 'Banner', note: 'See <@a.b@favorintl.org>', request_id: 9, created_at: now() }] }).items);
    expect(req[0].head).toBe('Ada commented on Banner');
    expect(req[0].txt).toBe('See @A B');
    expect(req[0].read).toEqual({ kind: 'request', id: '1' });

    const prj = fromProjects(projectNoticesResponse.parse({ ok: true, count: 1, items: [{ id: 'p1', url: '/projects/p?t=SB-1', head: 'Given to you:', title: 'Fix it', created_at: now() }] }).items);
    expect(prj[0].href).toBe('/projects/p?t=SB-1');

    const chat = fromChat(chatInboxResponse.parse({ ok: true, count: 1, items: [{ id: 3, kind: 'dm', from: 'ada.lovelace@favorintl.org', channel_kind: 'dm', channel_id: 2, body: 'hi', created_at: now() }] }).items);
    expect(chat[0].head).toBe('Ada Lovelace sent you a message');
    expect(chat[0].href).toBe('/chat/?c=2&m=3');

    const hub = fromHub([{ id: 'live', source: 'Meetings', head: 'A meeting is on now', txt: '', href: '/meet/', n: 1, warn: false }]);
    expect(hub[0].when).toBe('1');
  });

  it('groups in the bell order, reminders last', () => {
    const rows = [
      ...fromHub([
        { id: 'a', source: 'Mail', head: 'x', txt: '', href: '/mail/', n: 2, warn: false },
        { id: 'b', source: 'Meetings', head: 'y', txt: '', href: '/meet/', n: 1, warn: false },
      ]),
      ...fromReminders(remindersResponse.parse({ ok: true, rows: [{ id: 1, title: 't', at: now() }] }).rows),
    ];
    expect(grouped(rows).map(([g]) => g)).toEqual(['Meetings', 'Mail', 'Reminders']);
  });

  it('the badge reads 99+ past two digits and nothing at zero', () => {
    expect(badge(0)).toBe('');
    expect(badge(7)).toBe('7');
    expect(badge(100)).toBe('99+');
  });
});
