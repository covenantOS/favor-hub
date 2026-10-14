// The privacy check. It reads every list, search, feed and by-id route that could show another person's meetings, notes, messages,
// tasks, bookings or Brain threads, as a made-up staff member and a made-up field member (neither is a real account), and fails when
// an answer carries the canary word PRVCNRY (functions/_lib/privacy/canaries.ts). A few reads must find PRVOPEN or a message in the
// probes' own channel, so a check that quietly reads nothing fails too. The routes run in this same request, behind the same code the
// browser reaches; the middleware's own gates (sign-in, field paths) are checked with fieldMayOpen and by the signed-out reads.
//
// Runs from the 30-minute smoke check (functions/api/hub/smoke.ts) and from tests/privacy-matrix.test.mjs on an in-memory database.
// Each row is one cell of the data-by-role matrix in the vault (Projects/FavorOS Privacy Matrix.md).
import type { Env } from '../http';
import { withUserHeaders, type HubUser } from '../session';
import { fieldMayOpen } from '../field';
import { CANARY, IDS, MESSAGE_MARKS, OPEN_MARK, PROBE_FIELD, PROBE_STAFF } from './canaries';
import { route as meetRoute } from '../meetroute';
import { onRequest as chatApi } from '../../api/chat/[[path]]';
import { onRequest as projectsApi } from '../../api/projects/[[path]]';
import { onRequest as tasksApi } from '../../api/tasks/[[path]]';
import { onRequest as integrationsApi } from '../../api/integrations/[[path]]';
import { onRequest as entityApi } from '../../api/hub/entity';
import { onRequestGet as findApi } from '../../api/hub/find';
import { onRequestGet as clipsApi } from '../../api/clips/index';
import { onRequestGet as clipInfoApi } from '../../api/clips/[id]/info';
import { onRequestGet as clipMediaApi } from '../../api/clips/[id]/media';
import { onRequestGet as brainHistoryApi } from '../../api/brain/history';
import { onRequestGet as brainThreadApi } from '../../api/brain/thread/[id]';
import { onRequest as bookApi } from '../../api/book/[[path]]';
import { onRequest as meetGuestApi } from '../../api/meet-guest/[[path]]';
import { onRequest as todayApi } from '../../api/today/[[path]]';

export type Who = 'staff' | 'field' | 'out';

export interface Probe {
  /** The matrix cell: data and what is read. */
  name: string;
  path: string;
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
  who: Who[];
  /** Text that must appear (a control). The canary word must never appear, in any probe. */
  must?: string;
}

const M = IDS;
const soon = () => new Date(Date.now() + 2 * 86400_000);

/** The rows of the matrix the check reads. Kept in one list so the test and the smoke check read the same cells. */
export function probes(): Probe[] {
  const both: Who[] = ['staff', 'field'];
  const list: Probe[] = [
    // Meetings: lists, the meeting, its notes, recording, live notes, prep, send screen, scheduling, booking.
    { name: 'Meetings upcoming list', path: '/api/meet/meetings?scope=upcoming', who: both },
    { name: 'Meetings recent list', path: '/api/meet/meetings?scope=recent', who: both },
    { name: 'Meeting notes library', path: '/api/meet/meetings?scope=notes', who: ['staff'], must: OPEN_MARK },
    { name: 'Meeting notes library (field)', path: '/api/meet/meetings?scope=notes', who: ['field'] },
    { name: 'Meeting notes search', path: '/api/meet/meetings?scope=notes&q=prvcnry', who: both },
    { name: 'Open meeting notes (control)', path: `/api/meet/meetings/${M.meetOpen}/notes`, who: ['staff'], must: OPEN_MARK },
    { name: 'My action items', path: '/api/meet/meetings/actions', who: both },
    ...[M.meetPrivate, M.meetEnded, M.meetGuest, M.meetStaffGuest].flatMap((id): Probe[] => [
      { name: `Meeting by id ${id.slice(-2)}`, path: `/api/meet/meetings/${id}`, who: both },
      { name: `Meeting notes by id ${id.slice(-2)}`, path: `/api/meet/meetings/${id}/notes`, who: both },
      { name: `Meeting recording by id ${id.slice(-2)}`, path: `/api/meet/meetings/${id}/media/1`, who: both },
      { name: `Meeting live notes by id ${id.slice(-2)}`, path: `/api/meet/meetings/${id}/live`, who: both },
      { name: `Meeting prep by id ${id.slice(-2)}`, path: `/api/meet/meetings/${id}/prep`, who: both },
      { name: `Meeting send screen by id ${id.slice(-2)}`, path: `/api/meet/meetings/${id}/send`, who: both },
      { name: `Meeting entity card ${id.slice(-2)}`, path: `/api/hub/entity?kind=meeting&id=${id}`, who: both },
      { name: `Meeting task links ${id.slice(-2)}`, path: `/api/tasks/links/meet/actions?meeting_id=${id}`, who: both },
    ]),
    { name: 'Scheduling assistant (busy times of the tester)', path: '/api/meet/meetings/assist', method: 'POST', body: { emails: ['tester@favorintl.org'], from: new Date().toISOString(), to: new Date(Date.now() + 5 * 86400_000).toISOString() }, who: ['staff'] },
    { name: 'Conflicts check against the tester', path: '/api/meet/meetings/conflicts', method: 'POST', body: { emails: ['tester@favorintl.org'], startsAt: new Date(soon().getTime() - 3600_000).toISOString(), endsAt: new Date(soon().getTime() + 86400_000).toISOString() }, who: ['staff'] },
    { name: 'Booking page (signed out)', path: '/api/book/page?u=tester', who: ['out'] },
    { name: 'Booking open times (signed out)', path: '/api/book/slots?u=tester&t=privacy-check', who: ['out'] },
    { name: 'Booking manage with a wrong key', path: `/api/book/manage?b=${M.booking}&k=${'0'.repeat(32)}`, who: ['out'] },
    { name: 'Guest door with a wrong key', path: `/api/meet-guest/meetings/${M.meetGuest}/guestinfo?k=${'0'.repeat(32)}`, who: ['out'] },
    // Chat: lists, searches, private channel and direct message by id, the probes' own channel with linked cards, notes only for the tester.
    ...['boot', 'dock', 'scheduled', 'status', 'threads', 'activity', 'inbox', 'search?q=prvcnry'].map((p): Probe => ({ name: `Chat ${p.split('?')[0]}`, path: `/api/chat/${p}`, who: both })),
    { name: 'Chat channel browse', path: '/api/chat/channels/browse', who: ['staff'] },
    { name: 'Private channel by id', path: `/api/chat/channels/${M.chPrivate}/messages`, who: both },
    { name: 'Direct message by id', path: `/api/chat/channels/${M.chDm}/messages`, who: both },
    { name: 'Own channel: linked private meeting and task stay unnamed', path: `/api/chat/channels/${M.chProbe}/messages`, who: both, must: MESSAGE_MARKS.meetingLink },
    // Projects and tasks.
    { name: 'Projects list', path: '/api/projects', who: ['staff'] },
    { name: 'Members-only project by id', path: `/api/projects/${M.project}`, who: ['staff'] },
    { name: 'Members-only project by key', path: `/api/projects/${M.projectKey}`, who: ['staff'] },
    { name: 'Task search', path: '/api/tasks?q=prvcnry', who: ['staff'] },
    { name: "Another person's tasks", path: '/api/tasks?owner=tester@favorintl.org&status=all', who: ['staff'] },
    { name: 'Members-only project task by id', path: `/api/tasks/${M.task}`, who: ['staff'] },
    { name: 'Personal task by id', path: `/api/tasks/${M.taskLoose}`, who: ['staff'] },
    { name: 'Task entity card', path: `/api/hub/entity?kind=task&id=${M.taskLoose}`, who: ['staff'] },
    { name: 'Project entity card', path: `/api/hub/entity?kind=project&id=${M.project}`, who: ['staff'] },
    { name: 'Search box', path: '/api/hub/find?q=prvcnry', who: ['staff'] },
    // Clips: the library is your own; an unshared clip opens for nobody but its owner and admins (2026-10-14).
    { name: 'Clips library', path: '/api/clips', who: ['staff'] },
    { name: 'Unshared clip', path: `/api/clips/${M.clip}/info`, who: ['staff', 'field', 'out'] },
    { name: 'Private clip', path: `/api/clips/${M.clipPrivate}/info`, who: ['staff', 'field', 'out'] },
    { name: 'Private clip video', path: `/api/clips/${M.clipPrivate}/media`, who: ['staff', 'field', 'out'] },
    { name: 'Unshared clip video', path: `/api/clips/${M.clip}/media`, who: ['staff', 'field', 'out'] },
    { name: 'Public clip (everybody reads it)', path: `/api/clips/${M.clipPublic}/info`, who: ['staff', 'out'], must: OPEN_MARK },
    { name: 'Public clip video without its token', path: `/api/clips/${M.clipPublic}/media`, who: ['out'] },
    // Find a time reads the people of a place only for someone who can see it (integrations/findtime.ts).
    { name: 'Find a time: private channel', path: `/api/integrations/context?kind=chat&ref=${M.chPrivate}`, who: both },
    { name: 'Find a time: direct message', path: `/api/integrations/context?kind=chat&ref=${M.chDm}`, who: both },
    { name: 'Find a time: members-only task', path: `/api/integrations/context?kind=task&ref=${M.task}`, who: ['staff'] },
    // Favor Brain conversations.
    { name: 'Brain history', path: '/api/brain/history?q=prvcnry', who: ['staff'] },
    { name: "Another person's Brain thread", path: `/api/brain/thread/${M.brainThread}`, who: ['staff'] },
    // Today's cross-app lists and hand-offs (2026-10-14): your own items only; a hand-off opens for its giver and receiver alone.
    { name: 'Today inbox', path: '/api/today/inbox?part=fast', who: both },
    { name: 'Today waiting on', path: '/api/today/waiting?part=fast', who: both },
    { name: "Another person's hand-off", path: `/api/today/handoff/${M.handoff}`, who: ['staff', 'field', 'out'] },
    { name: 'Hand-offs given', path: '/api/today/handoffs', who: ['staff'] },
    // Signed out: nothing at all.
    ...['/api/meet/meetings?scope=notes', `/api/meet/meetings/${M.meetEnded}/notes`, '/api/chat/boot', '/api/projects', '/api/hub/find?q=prvcnry'].map((p): Probe => ({ name: `Signed out ${p.split('?')[0]}`, path: p, who: ['out'] })),
  ];
  return list;
}

type Handler = (ctx: { request: Request; env: Env; params: Record<string, string | string[]>; waitUntil: (p: Promise<unknown>) => void; next: () => Promise<Response>; data: Record<string, unknown> }) => Response | Promise<Response>;

/** The function the browser's request reaches for this path, and its route parameters. */
function handlerFor(path: string): { fn: Handler; params: Record<string, string | string[]> } | null {
  const p = path.split('?')[0];
  const rest = (prefix: string) => p.slice(prefix.length).split('/').filter(Boolean);
  if (p.startsWith('/api/meet/')) return { fn: ((c: Parameters<Handler>[0]) => meetRoute({ request: c.request, env: c.env as never, params: c.params, waitUntil: c.waitUntil }, false)) as Handler, params: { path: rest('/api/meet/') } };
  if (p.startsWith('/api/meet-guest/')) return { fn: meetGuestApi as unknown as Handler, params: { path: rest('/api/meet-guest/') } };
  if (p.startsWith('/api/chat/')) return { fn: chatApi as unknown as Handler, params: { path: rest('/api/chat/') } };
  if (p === '/api/projects' || p.startsWith('/api/projects/')) return { fn: projectsApi as unknown as Handler, params: { path: rest('/api/projects') } };
  if (p === '/api/tasks' || p.startsWith('/api/tasks/')) return { fn: tasksApi as unknown as Handler, params: { path: rest('/api/tasks') } };
  if (p === '/api/hub/entity') return { fn: entityApi as unknown as Handler, params: {} };
  if (p === '/api/hub/find') return { fn: findApi as unknown as Handler, params: {} };
  if (p === '/api/clips') return { fn: clipsApi as unknown as Handler, params: {} };
  const clip = /^\/api\/clips\/([0-9a-f]{32})\/info$/.exec(p);
  if (clip) return { fn: clipInfoApi as unknown as Handler, params: { id: clip[1] } };
  const media = new RegExp('^/api/clips/([0-9a-f]{32})/media$').exec(p);
  if (media) return { fn: clipMediaApi as unknown as Handler, params: { id: media[1] } };
  if (p === '/api/brain/history') return { fn: brainHistoryApi as unknown as Handler, params: {} };
  const bt = /^\/api\/brain\/thread\/([^/]+)$/.exec(p);
  if (bt) return { fn: brainThreadApi as unknown as Handler, params: { id: bt[1] } };
  if (p.startsWith('/api/integrations/')) return { fn: integrationsApi as unknown as Handler, params: { path: rest('/api/integrations/') } };
  if (p.startsWith('/api/book/')) return { fn: bookApi as unknown as Handler, params: { path: rest('/api/book/') } };
  if (p.startsWith('/api/today/')) return { fn: todayApi as unknown as Handler, params: { path: rest('/api/today/') } };
  return null;
}

const PEOPLE: Record<'staff' | 'field', HubUser> = {
  staff: { email: PROBE_STAFF, name: 'FavorOS Privacy Probe', picture: '', role: 'staff', via: 'google', kpi: true },
  field: { email: PROBE_FIELD, name: 'FavorOS Privacy Probe', picture: '', role: 'field', via: 'google', kpi: false },
};

export interface Cell { name: string; who: Who; path: string; status: number; ok: boolean; why?: string }

/** Reads one probe as one person and judges it. A route that throws counts as refused (nothing came back). */
export async function readCell(env: Env, origin: string, probe: Probe, who: Who): Promise<Cell> {
  const base = { name: probe.name, who, path: probe.path };
  // Field staff reach only the field paths; everything else stops in the middleware before any route runs.
  if (who === 'field' && !fieldMayOpen(probe.path.split('?')[0])) return { ...base, status: 403, ok: !probe.must, ...(probe.must ? { why: 'control needs a path field staff may open' } : {}) };
  const h = handlerFor(probe.path);
  if (!h) return { ...base, status: 0, ok: false, why: 'no handler for this path' };
  // Signed out: only the open doors run their route; the middleware answers 401 for the rest.
  const open = /^\/api\/(book|meet-guest)\//.test(probe.path) || /^\/api\/clips\/[0-9a-f]{32}\/(info|media|views)$/.test(probe.path.split('?')[0]);
  if (who === 'out' && !open) return { ...base, status: 401, ok: true };
  const init: RequestInit = { method: probe.method || 'GET', headers: { 'Content-Type': 'application/json', Origin: origin } };
  if (probe.body) init.body = JSON.stringify(probe.body);
  let req = new Request(origin + probe.path, init);
  if (who !== 'out') req = withUserHeaders(req, PEOPLE[who]);
  let status = 0, text = '';
  try {
    const waits: Array<Promise<unknown>> = [];
    const res = await h.fn({ request: req, env, params: h.params, waitUntil: (p) => { waits.push(p.catch(() => undefined)); }, next: async () => new Response('not found', { status: 404 }), data: {} });
    status = res.status;
    text = await res.text();
  } catch (err) {
    status = 500;
    text = String((err as Error)?.message || err);
  }
  if (text.includes(CANARY)) return { ...base, status, ok: false, why: `LEAK: the answer carries ${CANARY}: ${snippet(text)}` };
  if (probe.must && !text.includes(probe.must)) return { ...base, status, ok: false, why: `control missing (${probe.must}): ${snippet(text)}` };
  return { ...base, status, ok: true };
}

function snippet(text: string): string {
  const at = Math.max(0, text.indexOf(CANARY) - 80);
  return text.slice(at, at + 220).replace(/\s+/g, ' ');
}

export interface ProbeResult { ok: boolean; cells: Cell[]; failed: Cell[]; passed: number; total: number }

/** Every cell for every role it names. Runs a few at a time so the whole check stays inside the smoke check's time. */
export async function runPrivacyProbe(env: Env, origin = 'https://dash.favorintl.org', only?: Who[]): Promise<ProbeResult> {
  const jobs: Array<() => Promise<Cell>> = [];
  for (const p of probes()) for (const who of p.who) if (!only || only.includes(who)) jobs.push(() => readCell(env, origin, p, who));
  const cells: Cell[] = [];
  for (let i = 0; i < jobs.length; i += 8) cells.push(...(await Promise.all(jobs.slice(i, i + 8).map((j) => j()))));
  const failed = cells.filter((c) => !c.ok);
  return { ok: failed.length === 0, cells, failed, passed: cells.length - failed.length, total: cells.length };
}
