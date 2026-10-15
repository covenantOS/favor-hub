// The Meetings Day page's pure pieces (public/js/meet/day.js): constants, the derivation of drawable events from the loaded lists, side by side
// lanes, and the small formatters. Nothing here touches the page.
import * as MV from '../views';

export const PXH = 80;
export const KEY = 'meet.day.v3';
export const TTL = 20000;
export const VIEW_KEY = 'meet.view.v1';
export const CAL_KEY = 'meet.cal.v1';
export const SNAP = 15;
export const STALE = 150000;
export const PROV: Record<string, string> = { favor: 'Favor', zoom: 'Zoom', meet: 'Google Meet', teams: 'Microsoft Teams', webex: 'Webex' };

export interface Ev {
  id: string;
  hub?: any;
  cal?: any;
  p: string;
  title: string;
  start: number;
  end: number;
  live: boolean;
  past: boolean;
  who: string[];
  count: number;
  rec?: string;
  inRoom: number;
  open?: boolean;
  noteId: string;
  desc: string;
  edit: boolean;
  lane?: number;
  lanes?: number;
  stack?: number;
  stackTop?: number;
  pitch?: number;
  vend?: number;
  capEnd?: number;
}
export interface Hub {
  at?: number;
  up: any[];
  recent: any[];
  notes: any[];
  people: { email: string; name: string }[];
  cal?: { connected: boolean; canWrite?: boolean; meetings?: any[]; error?: string };
}

export const dayKey = (d: number | string | Date): string => MV.etKey(new Date(d).getTime());
export const hm = (d: number | string | Date): string => new Date(d).toLocaleTimeString('en-US', { timeZone: MV.TZ, hour: 'numeric', minute: '2-digit' });
export const hourLabel = (h: number): string => ((h + 11) % 12 + 1) + ' ' + (h >= 12 && h < 24 ? 'PM' : 'AM');
export const longDay = (k: string): string => MV.dayName(k) + ', ' + MV.monthName(k) + ' ' + MV.dayNum(k);
export const wk = (k: string, w?: string): string => MV.dayName(k, w !== 'short');
export const clip = (t: string, n: number): string => {
  t = (t || '').trim();
  if (t.length <= n) return t;
  const c = t.slice(0, n);
  const i = c.lastIndexOf(' ');
  return (i > n * 0.6 ? c.slice(0, i) : c) + '...';
};
export const count = (n: number): string => n + ' meeting' + (n === 1 ? '' : 's');
export const provName = (p: string): string => (p === 'favor' ? 'FavorOS' : PROV[p] || p);
/** "1 person", "41 people". */
export const people = (n: number): string => Number(n).toLocaleString('en-US') + (Number(n) === 1 ? ' person' : ' people');
export const hue = (n: string): number => {
  let h = 0;
  String(n).split('').forEach((c) => {
    h = (h * 31 + c.charCodeAt(0)) >>> 0;
  });
  return h % 6;
};

export const pad2 = (n: number): string => (n < 10 ? '0' : '') + n;
export const hhmm = (ms: number): string => {
  const h = MV.etHM(ms);
  return pad2(h.h) + ':' + pad2(h.m);
};
export const toMin = (v: string): number => {
  const p = String(v).split(':');
  return +p[0] * 60 + +p[1];
};
export const minOfDay = (ms: number): number => {
  const h = MV.etHM(ms);
  return h.h * 60 + h.m;
};
export const atDay = (key: string, minutes: number): number => {
  const extra = Math.floor(minutes / 1440);
  const m = ((minutes % 1440) + 1440) % 1440;
  return MV.etStart(MV.addDays(key, extra)) + m * 60000;
};
export const snapMin = (v: number): number => Math.round(v / SNAP) * SNAP;
export const shortMsg = (m: unknown): string => {
  const s = String(m || '');
  return s && s.length <= 80 ? s : 'Could not save. Nothing changed.';
};
export const urlId = (id: string): string => (id.indexOf('c:') === 0 ? 'ext:' + id.slice(2) : id);
export const fromUrlId = (u: string): string => (u.indexOf('ext:') === 0 ? 'c:' + u.slice(4) : u);
export const recLabel = (r: string): string => (r === 'video' ? 'Notes and video' : r === 'notes' ? 'Notes' : 'Not recorded');
/** "katharine@favorintl.org" becomes Katharine; an address that does not read as a first name becomes "them". Same rule as Today. */
export const firstOf = (email: string): string => {
  const w = String(email || '').split('@')[0].split(/[._-]/)[0];
  return /^[a-z]{3,}$/i.test(w) ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : 'them';
};
/** Same wording as the Today sheet: "Tuesday, Oct 13, 2:00 PM to 3:00 PM ET". */
export const whenLine = (e: { start: number; end: number }): string =>
  new Date(e.start).toLocaleDateString('en-US', { timeZone: MV.TZ, weekday: 'long', month: 'short', day: 'numeric' }) + ', ' + hm(e.start) + ' to ' + hm(e.end) + ' ET';

/** A note card shows one sentence of the summary. A summary that only says the recording had nothing in it is left off. */
export function firstLine(s: unknown): string {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const one = (t.match(/^.*?[.!?](?=\s|$)/) || [t])[0];
  if (/appears to be|is unclear|unclear due|did not cover|does not seem|no specific|farewell message|was brief/i.test(one)) return '';
  return clip(one, 110);
}

export const sigOf = (v: Hub): string => JSON.stringify([v.up, v.recent, v.notes, (v.people || []).length]);

export interface Ctx {
  now: number;
  ov: Record<string, any>;
  extra: any[];
  people: Record<string, string>;
}
export const nameOf = (i: { email?: string; name?: string } | null | undefined, ppl: Record<string, string>): string => {
  const e = String((i && i.email) || '').toLowerCase();
  return (e && ppl[e]) || (i && (i.name || i.email)) || '';
};

/** The API has no provider, start, end or live flag per Favor room, so they are derived here from status, startsAt, endsAt and durationMin. */
export function normalize(d: Hub, c: Ctx): Ev[] {
  const out: Ev[] = [];
  const seen: Record<string, number> = {};
  const now = c.now;
  const add = (m: any) => {
    if (seen[m.id]) return;
    seen[m.id] = 1;
    let start = Date.parse(m.startsAt || m.startedAt || m.createdAt);
    if (isNaN(start)) return;
    let end = Date.parse(m.endsAt || m.endedAt || '') || start + (m.durationMin || 30) * 60000;
    const ov = c.ov[m.id];
    if (ov && ov.start) {
      start = ov.start;
      end = ov.end;
    }
    // Live only while someone is in the room (a heartbeat in the last 20 seconds). A room everyone left is not live, even
    // before the server closes it.
    const live = m.status === 'live' && (m.inRoom || 0) > 0;
    if (live && end < now + 10 * 60000) end = now + 10 * 60000;
    const host = m.hostName || nameOf({ email: m.hostEmail }, c.people);
    const names = [host].concat((m.invitees || []).map((i: any) => nameOf(i, c.people))).filter(Boolean);
    const past = !live && (m.status === 'ended' || end <= now);
    out.push({
      id: m.id,
      hub: m,
      p: 'favor',
      title: (ov && ov.title != null ? ov.title : String(m.title || '').trim()) || 'Meeting',
      start,
      end,
      live,
      past,
      who: names,
      count: names.length || 1,
      rec: m.rec,
      inRoom: m.inRoom || 0,
      open: !m.startsAt,
      noteId: m.notesStatus && m.notesStatus !== 'none' ? m.id : '',
      desc: ov && ov.desc != null ? ov.desc : m.agenda || '',
      edit: !!(m.mine && m.startsAt && m.status === 'scheduled' && (!m.repeat || m.repeat === 'none') && !live && !past),
    });
  };
  (d.up || []).forEach(add);
  (d.recent || []).forEach(add);
  (c.extra || []).forEach(add);
  const cal = d.cal && d.cal.connected ? d.cal.meetings || [] : [];
  cal.forEach((cv: any) => {
    let s = Date.parse(cv.startsAt);
    let e = Date.parse(cv.endsAt) || s + 30 * 60000;
    if (isNaN(s)) return;
    const ov = c.ov['c:' + cv.eventId];
    if (ov && ov.start) {
      s = ov.start;
      e = ov.end;
    }
    const names = (cv.people || []).map((p: any) => p.name || p.email);
    const clive = s <= now && e > now;
    const cpast = e <= now;
    out.push({
      id: 'c:' + cv.eventId,
      cal: cv,
      p: cv.provider || 'meet',
      title: (ov && ov.title != null ? ov.title : String(cv.title || '').trim()) || '(No title)',
      start: s,
      end: e,
      live: clive,
      past: cpast,
      who: names,
      count: names.length || 1,
      rec: 'none',
      inRoom: 0,
      noteId: '',
      desc: ov && ov.desc != null ? ov.desc : cv.description || '',
      edit: !!(cv.canEdit && d.cal && d.cal.canWrite && !clive && !cpast),
    });
  });
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

/** Side by side lanes for events that overlap. */
export function lanes(evs: Ev[], noStack?: boolean): void {
  let cluster: Ev[] = [];
  let end = 0;
  evs.forEach((e) => {
    e.stack = undefined;
  });
  // Draw every event at least 45 minutes tall so a short or empty meeting never sits on top of its neighbours.
  evs.forEach((e) => {
    e.vend = e.capEnd ? Math.max(e.capEnd, e.start + 30 * 60000) : Math.max(e.end, e.start + 45 * 60000);
  });
  const flush = () => {
    let n = 0;
    cluster.forEach((e) => {
      n = Math.max(n, (e.lane as number) + 1);
    });
    cluster.forEach((e) => {
      e.lanes = n;
    });
    // Many meetings starting within the same stretch cannot sit side by side. They stack as one-line rows from the first start.
    if (cluster.length > 3 && !noStack) {
      const first = cluster[0].start;
      const last = cluster[cluster.length - 1].start;
      let nxt = Infinity;
      evs.forEach((o) => {
        if (o.start > last && o.start < nxt) nxt = o.start;
      });
      const room = nxt === Infinity ? 32 * cluster.length : ((nxt - first) / 3600000) * PXH - 6;
      const pitch = Math.max(22, Math.min(32, Math.floor(room / cluster.length)));
      cluster.forEach((e, i) => {
        e.stack = i;
        e.stackTop = first;
        e.pitch = pitch;
        e.lanes = 1;
        e.lane = 0;
      });
    }
    cluster = [];
  };
  evs.forEach((e) => {
    if (cluster.length && e.start >= end) {
      flush();
      end = 0;
    }
    const used: Record<number, number> = {};
    cluster.forEach((c) => {
      if ((c.vend as number) > e.start) used[c.lane as number] = 1;
    });
    let l = 0;
    while (used[l]) l++;
    e.lane = l;
    cluster.push(e);
    end = Math.max(end, e.vend as number);
  });
  flush();
}

export interface Invitee {
  name: string;
  email: string;
  sub: string;
}
/** Who is on a meeting besides the organizer (a Favor room) or everyone on the event (a calendar event). */
export function invited(e: Ev, ppl: Record<string, string>): Invitee[] {
  const out: Invitee[] = [];
  if (e.cal) (e.cal.people || []).forEach((p: any) => out.push({ name: p.name || p.email, email: p.email, sub: p.name ? p.email : '' }));
  else {
    const m = e.hub;
    const hostE = String(m.hostEmail || '').toLowerCase();
    (m.invitees || []).forEach((i: any) => {
      if (String(i.email || '').toLowerCase() !== hostE) out.push({ name: nameOf(i, ppl), email: i.email || '', sub: i.guest ? 'Guest' : '' });
    });
  }
  return out;
}
