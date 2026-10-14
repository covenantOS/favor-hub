// The Chat REST calls, the same list as public/js/chat/chat.js. Every rule lives in /api/chat; this only asks.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { J } from './fmt';

export class ChatError extends Error {
  status = 0;
  code = '';
}

export function req(method: string, path: string, body?: unknown, raw?: { body: BodyInit; headers: Record<string, string> }): Promise<J> {
  const headers: Record<string, string> = { 'X-Hub-Request': '1' };
  if (body && !raw) headers['Content-Type'] = 'application/json';
  const url = path.charAt(0) === '/' ? path : '/api/chat/' + path;
  return fetch(url, { method, credentials: 'same-origin', headers: Object.assign(headers, raw ? raw.headers : {}), body: raw ? raw.body : body ? JSON.stringify(body) : undefined }).then((res) =>
    res
      .json()
      .catch(() => ({}))
      .then((d: J) => {
        if (!res.ok || d.ok === false) {
          const e = new ChatError(d.message || 'That did not work. Try again.');
          e.status = res.status;
          e.code = String(d.error || '');
          throw e;
        }
        return d;
      })
  );
}
const e = encodeURIComponent;

export const chatApi = {
  boot: () => req('GET', 'boot'),
  history: (id: string, before?: number) => req('GET', 'channels/' + e(id) + '/messages' + (before ? '?before=' + before : '')),
  thread: (id: number) => req('GET', 'threads/' + id),
  send: (ch: string, p: J) => req('POST', 'channels/' + e(ch) + '/messages', p).then((d) => d.message as J),
  edit: (id: number, body: string) => req('PATCH', 'messages/' + id, { body }).then((d) => d.message as J),
  del: (id: number) => req('DELETE', 'messages/' + id),
  react: (id: number, emoji: string) => req('POST', 'messages/' + id + '/reactions', { emoji }),
  read: (ch: string, upTo: number) => req('POST', 'channels/' + e(ch) + '/read', { upTo }).catch(() => ({})),
  typing: (ch: string, thread: number | null) => void req('POST', 'channels/' + e(ch) + '/typing', thread ? { thread_id: thread } : {}).catch(() => undefined),
  mute: (ch: string, muted: boolean) => req('POST', 'channels/' + e(ch) + '/mute', { muted }),
  search: (q: string, o: { filter: string; channel: string; from: string }) => req('GET', 'search?q=' + e(q) + '&filter=' + e(o.filter || 'all') + '&channel=' + e(o.channel || '') + (o.from ? '&from=' + e(o.from) : '')),
  threads: () => req('GET', 'threads'),
  activity: () => req('GET', 'activity'),
  unread: (ch: string, from: number) => req('POST', 'channels/' + e(ch) + '/unread', { from }),
  pins: (ch: string) => req('GET', 'channels/' + e(ch) + '/pins'),
  pin: (id: number, on: boolean) => req('POST', 'messages/' + id + '/pin', { on }),
  addBookmark: (ch: string, p: J) => req('POST', 'channels/' + e(ch) + '/bookmarks', p),
  removeBookmark: (ch: string, id: string) => req('DELETE', 'channels/' + e(ch) + '/bookmarks/' + e(id)),
  makeRequest: (ch: string, p: J) => req('POST', 'channels/' + e(ch) + '/request', p),
  createChannel: (p: J) => req('POST', 'channels', p).then((d) => d.channel as J),
  openDm: (ids: string[]) => req('POST', 'conversations', { members: ids }).then((d) => d.channel as J),
  browse: () => req('GET', 'channels/browse'),
  join: (id: string) => req('POST', 'channels/' + e(id) + '/join', {}).then((d) => d.channel as J),
  leave: (id: string) => req('POST', 'channels/' + e(id) + '/leave', {}),
  setTopic: (id: string, topic: string) => req('PATCH', 'channels/' + e(id), { topic }),
  addMembers: (id: string, emails: string[]) => req('POST', 'channels/' + e(id) + '/members', { emails }).then((d) => d.channel as J),
  driveSearch: (q: string) => req('GET', 'drive?q=' + e(q)),
  shareAnswer: (id: number, summary = false) => req('POST', 'messages/' + id + '/share', summary ? { summary: true } : {}),
  dismissAnswer: (id: number) => req('POST', 'messages/' + id + '/dismiss', {}),
  clips: () => req('GET', 'clips'),
  startMeeting: (ch: string) => req('POST', 'channels/' + e(ch) + '/meeting', {}),
  huddle: (ch: string) => req('GET', 'channels/' + e(ch) + '/huddle').then((d) => (d.huddle || null) as J | null),
  upload: (file: File) =>
    req('POST', 'upload', null, { body: file, headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': e(file.name) } }).then((d) => ({ id: d.id, name: d.name, size: d.size, mime: d.mime, url: d.url })),
  setLang: (lang: string) => req('POST', 'prefs', { lang }),
  translate: (ids: number[], force?: boolean) => req('POST', 'translate', { ids, force: force || undefined }),
  catchup: (ch: string, from: number, thread?: number) => req('POST', 'channels/' + e(ch) + '/catchup', { from, thread: thread || undefined }),
  remind: (id: number, when: J) => req('POST', 'messages/' + id + '/remind', { when }),
  entities: (q: string) => req('GET', 'entities?q=' + e(q)),
  owners: () => req('GET', 'owners'),
  vote: (id: number, p: J) => req('POST', 'messages/' + id + '/vote', p).then((d) => d.message as J),
  check: (id: number, taskId: string, done: boolean) => req('POST', 'messages/' + id + '/check', { task_id: taskId, done }).then((d) => d.message as J),
  checkAdd: (id: number, text: string) => req('POST', 'messages/' + id + '/check-add', { text }).then((d) => d.message as J),
  cancelScheduled: (id: string) => req('POST', 'scheduled/' + e(id) + '/cancel', {}),
};
export type ChatApi = typeof chatApi;
