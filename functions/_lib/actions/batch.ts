// Splitting a batch into requests, counting its Blackbaud calls, and deciding whether it goes now or after the 8:00 PM ET reset.
// Pure. The upkeep route takes 15 calls a request and caps all upkeep at 3,000 a UTC day; the Work Center keeps to 2,400 of them
// (singles go until the route reaches 2,700), so the morning jobs, Foundation prospects and one-off fixes always have room.

export const CHUNK = 15;
export const DAILY_CAP = 3000;
export const LANE_CAP = 2400;
export const SINGLES_UNTIL = 2700;
export const MAX_IDS = 2000;

export function chunk<T>(list: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** Calls a batch uses: one per step, plus one read-back per 15 changed actions. */
export function plannedCalls(steps: number, items: number): number {
  return steps + Math.ceil(items / CHUNK);
}

/**
 * SKY calls the mirror refresh costs after a batch: the sync worker reads each changed action once, and a second time for its tags
 * when the action is new or the batch tags it. A refresh holds at most REFRESH_MAX ids; the rest wait for the next sync.
 */
export const REFRESH_MAX = 200;
export function refreshCalls(items: { steps: { op: string }[] }[]): number {
  let n = 0;
  for (const it of items.slice(0, REFRESH_MAX)) n += 1 + (it.steps.some((s) => s.op === 'create' || s.op === 'tag') ? 1 : 0);
  return n;
}

export interface LaneInput {
  planned: number;
  used: number; // the larger of the route's last calls_today and the hub's own count for this UTC day
  laneCap?: number;
}

/** 'now' sends at once; 'tonight' holds the batch for the drain after the reset. A change of 15 calls or fewer never waits before 2,700. */
export function laneFor(i: LaneInput): { when: 'now' | 'tonight'; left: number } {
  const cap = i.laneCap ?? LANE_CAP;
  const left = Math.max(0, cap - i.used);
  if (i.planned <= CHUNK && i.used + i.planned <= SINGLES_UNTIL) return { when: 'now', left };
  return { when: i.used + i.planned <= cap ? 'now' : 'tonight', left };
}

/** The UTC date the upkeep route counts calls under. */
export const utcDay = (d: Date = new Date()): string => d.toISOString().slice(0, 10);

/** The Eastern clock time the next UTC day begins ("8:00 PM" in summer, "7:00 PM" in winter). */
export function resetLabel(d: Date = new Date()): string {
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0));
  return next.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
}

/** Undo stays open for 24 hours from the batch. */
export function undoUntil(from: Date = new Date()): string {
  return new Date(from.getTime() + 24 * 3600000).toISOString();
}
