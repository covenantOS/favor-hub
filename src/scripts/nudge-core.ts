// The meeting nudge's rules, kept apart from the page so the tests can run them in Node.
// A meeting is due when it starts within the next two minutes. Each meeting is shown once per browser session.

export const LEAD_MS = 2 * 60000;

export interface NudgeMeeting {
  key: string;
  title: string;
  startMs: number;
  endMs: number;
  join: string;
}

interface HubMeeting {
  id: string;
  title: string;
  startsAt?: string | null;
  endsAt?: string | null;
  status?: string;
}

interface CalMeeting {
  eventId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  joinUrl: string;
}

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);

/** Favor rooms and calendar meetings in one list. Meetings without a start time are left out. */
export function toNudgeList(upcoming: HubMeeting[], calendar: CalMeeting[]): NudgeMeeting[] {
  const out: NudgeMeeting[] = [];
  for (const m of upcoming) {
    const startMs = ms(m.startsAt);
    if (!m.id || Number.isNaN(startMs) || m.status === 'ended') continue;
    const endMs = ms(m.endsAt) || startMs + 60 * 60000;
    out.push({ key: `hub:${m.id}`, title: m.title || 'Meeting', startMs, endMs, join: `/meet/room/?m=${encodeURIComponent(m.id)}` });
  }
  for (const m of calendar) {
    const startMs = ms(m.startsAt);
    if (!m.eventId || Number.isNaN(startMs) || !m.joinUrl) continue;
    const endMs = ms(m.endsAt) || startMs + 60 * 60000;
    out.push({ key: `cal:${m.eventId}:${m.startsAt}`, title: m.title || 'Meeting', startMs, endMs, join: m.joinUrl });
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/** The meetings that start within the lead time and are not in the shown list. */
export function dueNow(list: NudgeMeeting[], now: number, shown: ReadonlySet<string>): NudgeMeeting[] {
  return list.filter((m) => !shown.has(m.key) && m.startMs - now > 0 && m.startMs - now <= LEAD_MS && now < m.endMs);
}

/** Whole minutes left, never less than one, for the toast text. */
export function minutesLeft(startMs: number, now: number): number {
  return Math.max(1, Math.ceil((startMs - now) / 60000));
}
