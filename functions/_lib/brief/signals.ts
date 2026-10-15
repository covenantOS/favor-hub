// What a partner's giving and contact history says: rhythm, health, the next best action and the moments worth a call.
// Pure functions over plain facts, so the Today briefing, the partner page, My partners and Call mode all read a partner the same way.
import { isOrgName, shortName } from '../../../shared/names';
import { money, whole } from '../../../shared/giving';
import { addDays, dayDiff, longDay, plural, shortDay } from './text';

export interface GiftPt {
  /** Gift date, YYYY-MM-DD. */
  d: string;
  a: number;
  /** Date Blackbaud had the gift, when known. */
  added?: string;
}

export type Cadence = 'monthly' | 'quarterly' | 'twice a year' | 'yearly' | 'occasional' | 'new' | 'none';

export interface Rhythm {
  n: number;
  lastDate: string;
  daysSince: number | null;
  medianGap: number | null;
  cadence: Cadence;
  expectedNext: string | null;
  /** Days past the point where the next gift was due (0 when it is not late yet). */
  lateDays: number;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function cadenceOf(gap: number): Cadence {
  if (gap <= 45) return 'monthly';
  if (gap <= 120) return 'quarterly';
  if (gap <= 240) return 'twice a year';
  if (gap <= 480) return 'yearly';
  return 'occasional';
}

/** How many days after the last gift the next one counts as late: the usual gap plus a third, and at least ten days of grace. */
const lateAfter = (gap: number): number => Math.round(gap * 1.34 + 10);

/** The pattern in a partner's gifts over the last three years. Gifts on one day count once. */
export function rhythmOf(gifts: GiftPt[], today: string): Rhythm {
  const cut = addDays(today, -1100);
  const days = [...new Set(gifts.filter((g) => g.a > 0 && g.d && g.d >= cut && g.d <= today).map((g) => g.d))].sort();
  if (!days.length) return { n: 0, lastDate: '', daysSince: null, medianGap: null, cadence: 'none', expectedNext: null, lateDays: 0 };
  const last = days[days.length - 1];
  const since = Math.max(0, dayDiff(last, today));
  if (days.length < 3) {
    const gap = days.length === 2 ? dayDiff(days[0], days[1]) : null;
    return {
      n: days.length,
      lastDate: last,
      daysSince: since,
      medianGap: gap,
      cadence: days.length === 1 ? 'new' : cadenceOf(gap as number),
      expectedNext: gap ? addDays(last, gap) : null,
      lateDays: gap ? Math.max(0, since - lateAfter(gap)) : 0,
    };
  }
  const gaps: number[] = [];
  for (let i = 1; i < days.length; i++) gaps.push(dayDiff(days[i - 1], days[i]));
  const gap = Math.max(1, median(gaps));
  return { n: days.length, lastDate: last, daysSince: since, medianGap: gap, cadence: cadenceOf(gap), expectedNext: addDays(last, Math.round(gap)), lateDays: Math.max(0, since - lateAfter(gap)) };
}

export type Health = 'growing' | 'steady' | 'slipping' | 'lapsing' | 'atrisk' | 'new' | 'none';

export const HEALTH_LABEL: Record<Health, string> = { growing: 'Growing', steady: 'Steady', slipping: 'Slipping', lapsing: 'Lapsing', atrisk: 'At risk', new: 'New', none: 'No gifts yet' };

export interface HealthFacts {
  l12: number;
  p12: number;
  life: number;
  gifts: number;
  firstDate: string;
  /** Days since the last completed call, visit or email; null when none is on record. */
  quiet: number | null;
  rhythm: Rhythm;
  /** Gifts this record sent for other partners (a donor-advised fund granting for a family). They are not its own giving. */
  passedOn?: number;
}

export function healthOf(f: HealthFacts, today: string): { health: Health; why: string } {
  if (!(f.life > 0) && !f.gifts) return { health: 'none', why: f.passedOn && f.passedOn > 0 ? 'No gifts of its own. It passes gifts on for other partners.' : 'No gifts yet.' };
  const r = f.rhythm;
  if (f.firstDate && dayDiff(f.firstDate, today) <= 270 && r.n <= 3) return { health: 'new', why: `First gift ${shortDay(f.firstDate)}.` };
  const lapsing = r.lateDays > 0 && (r.daysSince || 0) >= 60;
  if (lapsing) {
    const quiet = f.quiet === null || f.quiet >= 120;
    const meaningful = f.l12 + f.p12 >= 250;
    const word = r.cadence === 'occasional' || r.cadence === 'none' || r.cadence === 'new' ? 'next' : r.cadence;
    const base = `Last gift ${shortDay(r.lastDate)}, ${plural(r.daysSince || 0, 'day')} ago. A ${word} gift was due ${plural(r.lateDays, 'day')} ago.`;
    if (quiet && meaningful) return { health: 'atrisk', why: `${base} No contact in ${f.quiet === null ? 'the records' : plural(f.quiet, 'day')}.` };
    return { health: 'lapsing', why: base };
  }
  if (f.p12 > 0 && f.l12 < f.p12 * 0.75) return { health: 'slipping', why: `${whole(f.l12)} in the last 12 months, down from ${whole(f.p12)}.` };
  if (f.p12 > 0 && f.l12 > f.p12 * 1.2) return { health: 'growing', why: `${whole(f.l12)} in the last 12 months, up from ${whole(f.p12)}.` };
  if (f.p12 === 0 && f.l12 > 0) return { health: 'growing', why: `${whole(f.l12)} in the last 12 months, nothing the year before.` };
  return { health: 'steady', why: f.l12 ? `${whole(f.l12)} in the last 12 months, about the same as the year before.` : 'Giving is steady.' };
}

/** How many days a partner can go without a call, visit or email, by what they give. */
export function contactEvery(l12: number, life: number): number {
  const v = Math.max(l12, life / 4);
  if (v >= 5000) return 45;
  if (v >= 1000) return 90;
  if (v >= 250) return 150;
  return 270;
}

export type Channel = 'call' | 'visit' | 'email' | 'card' | 'none';

export interface NbaFacts {
  name: string;
  health: Health;
  rhythm: Rhythm;
  l12: number;
  p12: number;
  life: number;
  quiet: number | null;
  owed: { n: number; total: number; oldestDays: number; fund?: string } | null;
  firstGiftDays: number | null;
  nextTask: { due: string; summary: string } | null;
  hasPhone: boolean;
  doNotCall: boolean;
  hasEmail: boolean;
  doNotEmail: boolean;
}

export interface Nba {
  kind: 'thank' | 'welcome' | 'reconnect' | 'checkin' | 'follow' | 'planned' | 'none';
  /** The words on the button or the line: a verb first. */
  label: string;
  why: string;
  channel: Channel;
  /** 0 nothing needed, 1 when there is time, 2 this week, 3 today. */
  urgency: 0 | 1 | 2 | 3;
}

function channelFor(f: Pick<NbaFacts, 'hasPhone' | 'doNotCall' | 'hasEmail' | 'doNotEmail'>, prefer: Channel = 'call'): Channel {
  const phone = f.hasPhone && !f.doNotCall;
  const mail = f.hasEmail && !f.doNotEmail;
  if (prefer === 'visit') return phone || mail ? 'visit' : 'card';
  if (phone) return 'call';
  if (mail) return 'email';
  return 'card';
}

const VERB: Record<Channel, string> = { call: 'Call', visit: 'Visit or call', email: 'Email', card: 'Send a card to', none: 'Check on' };

export { shortName } from '../../../shared/names';

/** The one thing to do for a partner next, from what they owe us (a thank-you), how they give, and when anyone last spoke to them. */
export function nextAction(f: NbaFacts, today: string): Nba {
  // A church, a company or a foundation has no first name: "Call The to reconnect" read wrong, so an organization is "them".
  const org = isOrgName(f.name);
  const first = shortName(f.name, org);
  if (f.owed && f.owed.n > 0) {
    const what = f.owed.n === 1 ? `the ${money(f.owed.total)} gift` : `${f.owed.n} gifts, ${whole(f.owed.total)}`;
    return {
      kind: 'thank',
      label: `Thank ${first} for ${what}`,
      why: `Not thanked yet. The oldest has waited ${plural(f.owed.oldestDays, 'day')}.`,
      channel: channelFor(f),
      urgency: f.owed.oldestDays >= 3 ? 3 : 2,
    };
  }
  if (f.firstGiftDays !== null && f.firstGiftDays <= 14 && (f.quiet === null || f.quiet > f.firstGiftDays)) {
    return {
      kind: 'welcome',
      label: `Welcome ${first} as a new partner`,
      why: `Gave a first gift ${plural(f.firstGiftDays, 'day')} ago and nobody has been in touch since.`,
      channel: channelFor(f),
      urgency: f.firstGiftDays >= 5 ? 3 : 2,
    };
  }
  const slipping = f.health === 'lapsing' || f.health === 'atrisk';
  if (f.nextTask) {
    const late = dayDiff(f.nextTask.due || today, today);
    if (!slipping || late <= 0) {
      return {
        kind: 'planned',
        label: f.nextTask.summary ? f.nextTask.summary : `Contact ${first}`,
        why: late > 0 ? `Planned for ${shortDay(f.nextTask.due)}, ${plural(late, 'day')} late.` : `Already planned for ${shortDay(f.nextTask.due)}.`,
        channel: channelFor(f),
        urgency: late > 0 ? 3 : late === 0 ? 2 : 0,
      };
    }
  }
  if (slipping) {
    const r = f.rhythm;
    const word = r.cadence === 'monthly' || r.cadence === 'quarterly' || r.cadence === 'yearly' ? r.cadence : r.cadence === 'twice a year' ? 'twice-a-year' : 'usual';
    const ch = channelFor(f);
    return {
      kind: 'reconnect',
      label: `${VERB[ch]} ${first} to reconnect`,
      why: `The ${word} gift is ${plural(r.lateDays, 'day')} late. ${f.quiet === null ? 'No contact on record.' : `Last contact ${plural(f.quiet, 'day')} ago.`}`,
      channel: ch,
      urgency: f.health === 'atrisk' ? 3 : 2,
    };
  }
  const every = contactEvery(f.l12, f.life);
  if (f.life > 0 && (f.quiet === null || f.quiet >= every)) {
    const ch = channelFor(f, f.l12 >= 5000 ? 'visit' : 'call');
    return {
      kind: 'checkin',
      label: `${VERB[ch]} ${first} to check in`,
      why: f.quiet === null ? `No contact on record.${f.l12 ? ' ' + whole(f.l12) + ' in 12 months.' : ''}` : `Last contact ${plural(f.quiet, 'day')} ago. A partner at this level hears from us about every ${every} days.`,
      channel: ch,
      urgency: f.quiet === null || f.quiet >= every * 1.6 ? 2 : 1,
    };
  }
  if (f.health === 'slipping') {
    return { kind: 'follow', label: `Ask ${first} how you can serve them`, why: `Giving is ${whole(f.l12)} in 12 months, down from ${whole(f.p12)}. Listen before you ask.`, channel: channelFor(f), urgency: 1 };
  }
  const next = f.rhythm.expectedNext;
  return {
    kind: 'none',
    label: 'Nothing needed now',
    why: f.quiet !== null ? `Last contact ${plural(f.quiet, 'day')} ago${next && next >= today ? `, next gift expected around ${shortDay(next)}` : ''}.` : 'No action needed.',
    channel: 'none',
    urgency: 0,
  };
}

/* ------------------------------------------------------------------ moments */

export interface MomentFacts {
  cid: string;
  name: string;
  gifts: GiftPt[];
  count: number;
  firstDate: string;
  firstAmount: number;
  /** The largest single gift before the last 30 days. */
  maxBefore: number;
  health: Health;
  rhythm: Rhythm;
  l12: number;
  phone?: string | null;
}

export type MomentKind = 'largest' | 'first' | 'quiet' | 'anniversary';

export interface Moment {
  id: string;
  kind: MomentKind;
  cid: string;
  name: string;
  line: string;
  /** The date the moment belongs to. */
  when: string;
  amount?: number;
  step: { label: string; channel: Channel };
}

const ORDER: Record<MomentKind, number> = { largest: 0, first: 1, quiet: 2, anniversary: 3 };

export function momentsFor(list: MomentFacts[], today: string, max = 12): Moment[] {
  const out: Moment[] = [];
  for (const p of list) {
    const recent = p.gifts.filter((g) => g.a > 0 && dayDiff(g.d, today) >= 0 && dayDiff(g.d, today) <= 14).sort((a, b) => b.a - a.a);
    const top = recent[0];
    if (top && p.count >= 3 && p.maxBefore > 0 && top.a > p.maxBefore) {
      out.push({
        id: `largest:${p.cid}:${top.d}`,
        kind: 'largest',
        cid: p.cid,
        name: p.name,
        line: `Gave ${money(top.a)} on ${shortDay(top.d)}, the largest gift on record. The best before was ${money(p.maxBefore)}.`,
        when: top.d,
        amount: top.a,
        step: { label: 'Thank them in person', channel: 'call' },
      });
    } else if (p.count === 1 && p.firstDate && dayDiff(p.firstDate, today) >= 0 && dayDiff(p.firstDate, today) <= 14) {
      out.push({
        id: `first:${p.cid}:${p.firstDate}`,
        kind: 'first',
        cid: p.cid,
        name: p.name,
        line: `First gift, ${money(p.firstAmount)} on ${shortDay(p.firstDate)}.`,
        when: p.firstDate,
        amount: p.firstAmount,
        step: { label: 'Call to welcome them', channel: 'call' },
      });
    }
    if ((p.health === 'lapsing' || p.health === 'atrisk') && p.rhythm.lastDate && p.l12 >= 100 && p.rhythm.n >= 4 && (p.rhythm.daysSince || 0) <= 540) {
      const word = p.rhythm.cadence === 'new' || p.rhythm.cadence === 'none' || p.rhythm.cadence === 'occasional' ? '' : `${p.rhythm.cadence} `;
      out.push({
        id: `quiet:${p.cid}`,
        kind: 'quiet',
        cid: p.cid,
        name: p.name,
        line: `Gave ${whole(p.l12)} in the last 12 months and has not given since ${longDay(p.rhythm.lastDate, today)}. A ${word}gift was due ${plural(p.rhythm.lateDays, 'day')} ago.`,
        when: p.rhythm.lastDate,
        amount: p.l12,
        step: { label: 'Call to reconnect', channel: 'call' },
      });
    }
    if (p.firstDate && p.firstDate.length >= 10) {
      const years = Number(today.slice(0, 4)) - Number(p.firstDate.slice(0, 4));
      if (years >= 1) {
        const mark = `${today.slice(0, 4)}${p.firstDate.slice(4, 10)}`;
        const diff = dayDiff(today, mark);
        if (diff >= -2 && diff <= 7) {
          out.push({
            id: `anniversary:${p.cid}:${today.slice(0, 4)}`,
            kind: 'anniversary',
            cid: p.cid,
            name: p.name,
            line: `${plural(years, 'year')} since the first gift on ${shortDay(p.firstDate)}${p.count > 1 ? `, ${plural(p.count, 'gift')} since` : ''}.`,
            when: mark,
            step: { label: 'Send a note or call', channel: 'call' },
          });
        }
      }
    }
  }
  return out.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || (b.amount || 0) - (a.amount || 0) || a.name.localeCompare(b.name)).slice(0, max);
}
