// The server sources behind Ctrl K, ported from src/components/CommandPalette.astro. Each returns rows for one group and never throws:
// a denied or failed source gives no rows and the rest keep working. Every call applies the signed-in person's access on the server.
export interface Hit {
  title: string;
  desc: string;
  href: string;
  external: boolean;
  group: string;
  tags?: string;
  need?: string;
  team?: string;
  searchOnly?: boolean;
}

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function getJson(url: string): Promise<{ denied: boolean; data: J | null }> {
  try {
    const res = await fetch(url, { credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } });
    if (!res.ok) return { denied: res.status === 401 || res.status === 403, data: null };
    return { denied: false, data: (await res.json().catch(() => null)) as J | null };
  } catch {
    return { denied: false, data: null };
  }
}

const when = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
const norm = (s: unknown) => String(s || '').toLowerCase();
const rows = (d: J | null, key: string): J[] => (d && Array.isArray(d[key]) ? (d[key] as J[]) : []);
const hit = (title: string, desc: string, href: string, group: string, external = false): Hit => ({ title, desc, href, external, group });

export type SourceKind = 'partners' | 'requests' | 'projects' | 'reports' | 'chats' | 'meetings' | 'messages' | 'clips' | 'learn' | 'drive';

export const GROUP_ORDER = ['Partners', 'Requests', 'Projects', 'Menu', 'Tools', 'Reports', 'Meetings', 'Chat', 'Clips', 'Learn', 'Favor Brain', 'Help', 'External', 'Drive'];

/** One tier of sources: the kinds in a tier run together; tier 3 (Drive) runs after the others settle. */
export const TIERS: SourceKind[][] = [
  ['partners', 'requests', 'projects', 'reports', 'chats'],
  ['meetings', 'clips', 'messages', 'learn'],
  ['drive'],
];

let partnerDenied = false;
let reportsAll: J[] | null = null;

export async function runSource(kind: SourceKind, text: string, hasChat: boolean): Promise<Hit[]> {
  const q = encodeURIComponent(text);
  switch (kind) {
    case 'partners': {
      if (partnerDenied) return [];
      const r = await getJson('/api/work/partners?wide=1&q=' + q);
      if (r.denied) partnerDenied = true;
      return rows(r.data, 'rows').map((h) => hit(String(h.name), (h.place || 'No city on file') + (h.lookup ? ' · ' + h.lookup : '') + (h.deceased ? ' · deceased' : ''), '/work/partner/' + encodeURIComponent(h.cid), 'Partners'));
    }
    case 'projects': {
      const r = await getJson('/api/tasks/links/search?q=' + q);
      return rows(r.data, 'hits').map((h) => hit(String(h.title), String(h.desc), String(h.url), 'Projects'));
    }
    case 'requests': {
      const r = await getJson('/api/requests/search?q=' + q);
      return rows(r.data, 'results').map((h) =>
        hit(String(h.title), ['Request', h.status, h.owner ? 'Owner ' + h.owner : 'Asked by ' + h.asked_by, h.waiting_on ? 'Waiting on ' + h.waiting_on : ''].filter(Boolean).join(' · '), String(h.url), 'Requests')
      );
    }
    case 'reports': {
      if (!reportsAll) {
        const r = await getJson('/api/reports');
        if (!r.data || !Array.isArray(r.data.reports)) return [];
        reportsAll = (r.data.reports as J[]).filter((x) => x.ready);
      }
      const lq = norm(text);
      return reportsAll
        .filter((x) => norm(`${x.name} ${x.who || ''} ${x.replaces || ''}`).includes(lq))
        .slice(0, 8)
        .map((x) => hit(String(x.name), String(x.who || 'Report'), '/reports/?r=' + encodeURIComponent(x.id), 'Reports'));
    }
    case 'chats': {
      const r = await getJson('/api/brain/history?q=' + q);
      return rows(r.data, 'threads').slice(0, 8).map((t) => hit(String(t.title || 'Untitled chat'), when(t.changed_at) ? 'Chat · ' + when(t.changed_at) : 'Chat', '/brain/?c=' + encodeURIComponent(t.id), 'Favor Brain'));
    }
    case 'meetings': {
      const lq = norm(text);
      const [notes, recent, upcoming] = await Promise.all([
        getJson('/api/meet/meetings?scope=notes&q=' + q),
        getJson('/api/meet/meetings?scope=recent'),
        getJson('/api/meet/meetings?scope=upcoming'),
      ]);
      const out: Hit[] = [];
      const seen = new Set<string>();
      const add = (m: J, href: string, desc: string) => {
        if (!m || !m.id || seen.has(m.id)) return;
        seen.add(m.id);
        out.push(hit(String(m.title || 'Meeting'), desc, href, 'Meetings'));
      };
      for (const m of rows(notes.data, 'meetings')) add(m, '/meet/notes/?m=' + encodeURIComponent(m.id), 'Meeting notes' + (m.hostName ? ' · ' + m.hostName : ''));
      for (const m of rows(recent.data, 'meetings').filter((x) => norm(x.title).includes(lq))) add(m, '/meet/notes/?m=' + encodeURIComponent(m.id), 'Meeting notes' + (m.endedAt ? ' · ' + when(m.endedAt) : ''));
      for (const m of rows(upcoming.data, 'meetings').filter((x) => norm(x.title).includes(lq))) add(m, '/meet/room/?m=' + encodeURIComponent(m.id), 'Meeting' + (m.startsAt ? ' · ' + when(m.startsAt) : ''));
      return out.slice(0, 10);
    }
    case 'messages': {
      if (!hasChat) return [];
      const r = await getJson('/api/chat/search?q=' + q);
      return rows(r.data, 'results').slice(0, 6).map((m) => {
        const body = String(m.body || '').replace(/<@([^>]+)>/g, (_a, id: string) => '@' + (id === 'brain' ? 'Favor Brain' : id.split('@')[0])).replace(/\s+/g, ' ').slice(0, 90);
        return hit(body || 'Message', (m.channel_name ? '#' + m.channel_name : 'Direct message') + ' · ' + when(m.created_at), '/chat/?c=' + encodeURIComponent(m.channel_id) + '&m=' + m.id + (m.thread_id ? '&t=' + m.thread_id : ''), 'Chat');
      });
    }
    case 'clips': {
      const r = await getJson('/api/clips?q=' + q);
      return rows(r.data, 'clips').slice(0, 8).map((c) => hit(String(c.title || 'Untitled clip'), String(c.match ? c.match.text : c.summary || 'Clip'), '/c/' + encodeURIComponent(c.id) + (c.match ? '?t=' + Math.floor(c.match.at) : ''), 'Clips'));
    }
    case 'learn': {
      const r = await getJson('/api/learn/search?q=' + q);
      return rows(r.data, 'results').map((h) => hit(String(h.title), String(h.desc), String(h.href), 'Learn'));
    }
    case 'drive': {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch('/api/brain/drive/search', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' }, body: JSON.stringify({ query: text }), signal: ctrl.signal });
        if (!res.ok) return [];
        const data = (await res.json().catch(() => null)) as J | null;
        return rows(data, 'files')
          .filter((f) => f && /^https:\/\/(drive|docs)\.google\.com\//.test(f.link || ''))
          .slice(0, 6)
          .map((f) => hit(String(f.name || '').trim() || 'Untitled file', [f.type, f.owner, f.modified ? when(f.modified + 'T12:00:00') : '', f.folder].filter(Boolean).join(' · '), String(f.link), 'Drive', true));
      } catch {
        return [];
      } finally {
        clearTimeout(timer);
      }
    }
  }
}

export function scoreHit(item: Hit, q: string): number {
  if (!q) return 1;
  const t = norm(item.title);
  const d = norm(item.desc);
  const tags = norm(item.tags);
  if (t.startsWith(q)) return 4;
  if (t.includes(q)) return 3;
  if (tags.includes(q)) return 2;
  if (d.includes(q)) return 1;
  return 0;
}

export function filterLocal(items: Hit[], q: string, allowed: (i: Hit) => boolean): Hit[] {
  const lq = norm(q.trim());
  const pool = items.filter(allowed);
  if (!lq) return pool.filter((i) => !i.searchOnly);
  return pool
    .map((i) => ({ i, s: scoreHit(i, lq) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.i);
}

/** Local rows plus server rows, grouped in GROUP_ORDER; rows inside a group keep their order. */
export function mergeHits(local: Hit[], remote: Hit[]): Hit[] {
  return local
    .concat(remote)
    .map((x, i) => ({ x, i }))
    .sort((a, b) => GROUP_ORDER.indexOf(a.x.group) - GROUP_ORDER.indexOf(b.x.group) || a.i - b.i)
    .map((r) => r.x);
}
