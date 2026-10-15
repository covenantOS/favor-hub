// Meetings > Book (/meet/book/): pick the people, find a time from everyone's Google Calendar (free and busy only), set the details, book it.
// The booker's own Google connection reads free/busy and puts the meeting on their calendar with the others invited. Port of
// src/pages/meet/book.astro and public/js/meet/book.js: the same steps, markup, stylesheets and calls. The wizard keeps its state in one model
// (S, like the classic page) and draws it from React; every handler changes S and then draws.
//   /meet/book/?edit=<id>   move one meeting (a series asks which meetings the change reaches)
//   /meet/book/?follow=<id> the follow-up to a meeting: the same people, a Follow-up title
//   /meet/book/?template=<id>, ?google=meetings (back from the Google consent screen, the saved wizard comes back)
import { Suspense, useEffect, useReducer, useRef, type ReactNode } from 'react';
import { useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query';
import '@hub/styles/meet.css';
import '@hub/styles/qa2-meet.css';
import '@hub/styles/crit-meet.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import '@hub/styles/meet-sched.css';
import { NavLink } from '@/shell/NavLink';
import { Boundary } from '../../partners/record/Boundary';
import { navQuery } from '../../../lib/queries';
import { Avatar, Icon, MeetToast, Wait, copyText, meetApi, roomLink, toast, useHydrated, MeetError } from '../ui';
import { bookDirQuery, bookEditQuery, bookSeriesQuery, bookStatusQuery, bookTemplatesQuery, bookMyRecQuery } from '../queries';
import {
  DAY_NAMES, HOURS, ORD, TZ, WD, baseOf, bookerLocal, browserZone, clock, etDay, etInstant, etTime, hourLabel, newRule, parts, ruleIn, ruleOn, ruleOut, ruleText, weekDays, zoneName, type Day, type Rule,
} from './logic';

interface Person {
  email: string;
  name: string;
  team: string;
}
interface Slot {
  s: number;
  e: number;
  d: Day;
  h: number;
  mi: number;
  clash: number;
  clashList: string[];
  beforeList: string[];
  total: number;
  score: number;
}
// The wizard's model. One object, as on the classic page.
interface Model {
  post: string;
  channels: { id: string; name: string }[];
  step: number;
  dir: Person[];
  teams: Set<string>;
  chipAdded: Map<string, string[]>;
  people: Map<string, Person>;
  guests: string[];
  dur: number;
  start: string;
  title: string;
  autoTitle: boolean;
  agenda: string;
  rec: string;
  rule: Rule;
  access: string;
  team: string;
  driveFolder: string;
  templateId: string;
  templates: any[];
  tplOpen: boolean;
  tplName: string;
  tplShare: boolean;
  optional: Set<string>;
  buffer: number;
  travel: number;
  as: { state: string; slots: any[]; people: any[]; msg?: string };
  asKey: string;
  multi: boolean;
  picked: Set<string>;
  holdGrp: string;
  holdMsg: string;
  conf: { key: string; list: any[]; state: string };
  hrsOn: boolean;
  scope: string;
  scopeAsk: boolean;
  remind: boolean;
  week: number;
  busy: Record<string, any>;
  fb: string;
  fbMsg?: string;
  me: { email: string; name: string };
  booked: any;
  bookedRule?: string;
  guestLink?: string;
  can: { ok: boolean; connected?: boolean; guestsEnabled?: boolean; leadMin?: number };
  guestsOn: boolean;
  busyKey: string;
  editing?: any;
  ruleWas?: string;
  busyNow?: boolean;
}

const UNIT: Record<string, string> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };
const WHY: Record<string, [string, string]> = { meeting: ['has another meeting', 'have another meeting'], busy: ['is busy', 'are busy'], outside: ['is outside working hours', 'are outside working hours'] };

function initModel(a: { me: any; dir: Person[]; can: any; rec: string; templates: any[]; edit?: any; series?: any; follow?: any; template: string; editId: string; followId: string }): Model {
  const S: Model = {
    post: '', channels: [], step: 1, dir: a.dir, teams: new Set(), chipAdded: new Map(), people: new Map(), guests: [], dur: 60, start: '', title: '', autoTitle: false, agenda: '', rec: 'video', rule: newRule(), access: 'invited', team: '', driveFolder: '', templateId: '', templates: a.templates, tplOpen: false, tplName: '', tplShare: false, optional: new Set(), buffer: 0, travel: 0, as: { state: 'idle', slots: [], people: [] }, asKey: '', multi: false, picked: new Set(), holdGrp: '', holdMsg: '', conf: { key: '', list: [], state: 'idle' }, hrsOn: false, scope: '', scopeAsk: false, remind: true, week: 0, busy: {}, fb: 'idle', me: a.me, booked: null, can: a.can, guestsOn: !!a.can.guestsEnabled, busyKey: '',
  };
  if (['video', 'notes', 'off'].includes(a.rec)) S.rec = a.rec;
  const addPersonTo = (p: Person) => {
    if (p.email.toLowerCase() === (S.me.email || '').toLowerCase()) return;
    S.people.set(p.email.toLowerCase(), { email: p.email.toLowerCase(), name: p.name || p.email, team: p.team || '' });
  };
  if (a.edit) {
    const m = a.edit;
    S.title = m.title;
    S.agenda = m.agenda;
    S.dur = m.durationMin;
    S.rec = m.rec;
    S.editing = m;
    for (const i of m.invitees) addPersonTo({ email: i.email, name: i.name, team: i.team });
    if (m.seriesId && a.series) {
      S.rule = ruleIn(a.series.rule);
      S.ruleWas = JSON.stringify(ruleOut(S.rule, m.startsAt));
    }
    S.step = 2;
  }
  if (a.template && !a.editId) {
    const t = S.templates.find((x: any) => x.id === a.template);
    if (t) applyTemplateTo(S, t, addPersonTo);
  }
  // Book the follow-up (from a meeting's notes): the same people, with a Follow-up title, starting on Who.
  if (a.followId && !a.editId && a.follow) {
    const m = a.follow;
    S.title = 'Follow-up: ' + String(m.title || 'Meeting').replace(/^Follow-up:\s*/i, '');
    // A directory name wins; someone not in the directory keeps the name the meeting was booked with.
    const who = (email: string, name?: string) => {
      const d = S.dir.find((x) => x.email.toLowerCase() === email);
      addPersonTo({ email, name: d ? d.name : name || email, team: d ? d.team : '' });
    };
    if (m.hostEmail) who(String(m.hostEmail).toLowerCase(), m.hostName);
    for (const i of m.invitees || []) who(String(i.email).toLowerCase(), i.name);
  }
  if (S.step === 2 && !S.can.ok) S.fb = 'consent';
  return S;
}
function personByEmailIn(S: Model, email: string): Person {
  const d = S.dir.find((x) => x.email.toLowerCase() === email);
  return { email, name: d ? d.name : email, team: d ? d.team : '' };
}
function applyTemplateTo(S: Model, t: any, addPerson: (p: Person) => void) {
  S.templateId = t.id;
  if (t.title) {
    S.title = t.title;
    S.autoTitle = false;
  }
  S.agenda = t.agenda || '';
  S.dur = t.durationMin || 60;
  if (['notes', 'video', 'off'].includes(t.rec)) S.rec = t.rec;
  if (t.access) S.access = t.access;
  S.team = t.team || '';
  S.driveFolder = t.driveFolder || '';
  for (const i of t.invitees || []) {
    const e = String(i.email || '').toLowerCase();
    if (!e) continue;
    if (i.guest) {
      if (S.guestsOn && !S.guests.includes(e)) S.guests.push(e);
      continue;
    }
    const p = personByEmailIn(S, e);
    addPerson({ email: e, name: p.name !== e ? p.name : i.name || e, team: p.team || i.team || '' });
  }
  S.rule = ruleIn(t.rule);
  S.busyKey = '';
  S.asKey = '';
}

function Wizard({ editId, followId, templateId, google }: { editId: string; followId: string; templateId: string; google: boolean }) {
  const [{ data: nav }, { data: dir }, { data: can }, { data: mine }, { data: tpls }] = useSuspenseQueries({
    queries: [navQuery, bookDirQuery, bookStatusQuery, bookMyRecQuery, bookTemplatesQuery],
  });
  const { data: edit } = useSuspenseQuery(bookEditQuery(editId || followId));
  const seriesId = editId && edit && (edit as any).meeting ? (edit as any).meeting.seriesId : '';
  const { data: series } = useSuspenseQuery(bookSeriesQuery(seriesId));
  const hydrated = useHydrated();
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const model = useRef<Model | null>(null);
  if (!model.current) {
    model.current = initModel({
      me: nav.user,
      dir: (dir as any).people,
      can,
      rec: (mine as any).rec,
      templates: (tpls as any).templates || [],
      edit: editId && edit ? (edit as any).meeting : undefined,
      series: series ? (series as any).series : undefined,
      follow: followId && edit ? (edit as any).meeting : undefined,
      template: templateId,
      editId,
      followId,
    });
  }
  const S = model.current;
  const draw = () => bump();
  const focusAt = useRef('');
  const addp = useRef<HTMLInputElement>(null);
  const addg = useRef<HTMLInputElement>(null);
  const BTZ = hydrated ? browserZone() : TZ;
  const EDIT = editId;

  /* ---------------------------------------------------------------- people */
  const invited = () => [...S.people.values()];
  const emailsAll = () => [...new Set([S.me.email.toLowerCase(), ...S.people.keys()])];
  const hasWho = () => S.people.size + S.guests.length > 0;
  const addPerson = (p: Person) => {
    if (p.email.toLowerCase() === (S.me.email || '').toLowerCase()) return;
    S.people.set(p.email.toLowerCase(), { email: p.email.toLowerCase(), name: p.name || p.email, team: p.team || '' });
  };
  const personByEmail = (email: string) => personByEmailIn(S, email);
  const nameOf = (email: string) => (email === (S.me.email || '').toLowerCase() ? 'You' : (S.people.get(email) || ({} as Person)).name || email);
  const listNames = (emails: string[]) => {
    const n = emails.map(nameOf);
    return n.length <= 2 ? n.join(' and ') : `${n[0]}, ${n[1]} and ${n.length - 2} more`;
  };
  const teamsList = (): [string, number][] => {
    const m = new Map<string, number>();
    for (const p of S.dir) m.set(p.team, (m.get(p.team) || 0) + 1);
    return [['All staff', S.dir.length], ...[...m.entries()].sort((a, b) => b[1] - a[1])];
  };
  const defaultTitle = () => {
    const n = invited().map((p) => p.name.split(/[\s@]/)[0]).filter(Boolean);
    if (!n.length) return '';
    if (n.length === 1) return `Meeting with ${n[0]}`;
    if (n.length <= 3) return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
    return 'Team meeting';
  };
  // A team chip adds its members who are not already on the list, and taking it off removes only those.
  const toggleTeam = (team: string) => {
    if (S.teams.has(team)) {
      S.teams.delete(team);
      const keep = new Set<string>();
      for (const [t, list] of S.chipAdded) if (t !== team) list.forEach((e) => keep.add(e));
      for (const e of S.chipAdded.get(team) || []) if (!keep.has(e)) S.people.delete(e);
      S.chipAdded.delete(team);
    } else {
      S.teams.add(team);
      const members = team === 'All staff' ? S.dir : S.dir.filter((p) => p.team === team);
      const added: string[] = [];
      for (const p of members) {
        const e = p.email.toLowerCase();
        if (e !== (S.me.email || '').toLowerCase() && !S.people.has(e)) added.push(e);
        addPerson(p);
      }
      S.chipAdded.set(team, added);
    }
  };

  const save = () => {
    try {
      sessionStorage.setItem('meet.book', JSON.stringify({ step: S.step, teams: [...S.teams], chipAdded: [...S.chipAdded], people: [...S.people], guests: S.guests, dur: S.dur, start: S.start, title: S.title, autoTitle: S.autoTitle, agenda: S.agenda, rec: S.rec, rule: S.rule, access: S.access, team: S.team, driveFolder: S.driveFolder, templateId: S.templateId, optional: [...S.optional], buffer: S.buffer, travel: S.travel, holdGrp: S.holdGrp, remind: S.remind }));
    } catch {
      // private mode: the wizard just does not come back after Google
    }
  };

  /* ---------------------------------------------------------------- availability */
  const loadBusy = async () => {
    // Without calendar consent there is nothing to read, so no request goes out and the consent card shows alone.
    if (!S.can.ok) {
      S.fb = 'consent';
      S.fbMsg = '';
      draw();
      return;
    }
    const days = weekDays(S.week);
    const first = days[0];
    const last = days[days.length - 1];
    const from = new Date(etInstant(first.y, first.mo, first.d, 8, 0)).toISOString();
    const to = new Date(etInstant(last.y, last.mo, last.d, 18, 0)).toISOString();
    const key = from + emailsAll().join(',');
    if (S.busyKey === key) return;
    S.fb = 'loading';
    draw();
    try {
      const r = await meetApi<{ calendars: Record<string, any> }>('meetings/freebusy', { method: 'POST', body: { emails: emailsAll(), from, to } });
      S.busy = r.calendars;
      S.busyKey = key;
      S.fb = 'ok';
    } catch (e) {
      S.fb = (e as MeetError).code === 'consent' ? 'consent' : 'error';
      S.fbMsg = (e as Error).message;
    }
    draw();
  };
  const busyAt = (email: string, startMs: number, endMs: number) => {
    const c = S.busy[email];
    if (!c || c.error) return false;
    return c.busy.some((b: any) => Date.parse(b.start) < endMs && Date.parse(b.end) > startMs);
  };
  // People whose calendar was not read count as unknown, never as free.
  const unknownList = () => (S.fb === 'ok' ? emailsAll().filter((e) => !S.busy[e] || S.busy[e].error) : emailsAll());
  const busyCount = (startMs: number, endMs: number) => emailsAll().filter((e) => busyAt(e, startMs, endMs)).length;
  const slotsFor = (days: Day[]): Slot[] => {
    const out: Slot[] = [];
    const step = 30 * 60000;
    const dur = S.dur * 60000;
    const now = Date.now() + 30 * 60000;
    for (const d of days)
      for (const [h, mi] of HOURS) {
        if (d.wd === 0 || d.wd === 6) continue;
        const s = etInstant(d.y, d.mo, d.d, h, mi);
        const e = s + dur;
        if (s < now) continue;
        if (parts(e - 1).h >= 17 && parts(e).h !== 17) continue; // keep inside the working day
        if (h * 60 + mi + S.dur > 17 * 60 + 30) continue;
        const total = emailsAll().length;
        const clashList = emailsAll().filter((em) => {
          for (let t = s; t < e; t += step) if (busyAt(em, t, t + step)) return true;
          return false;
        });
        const clash = clashList.length;
        const beforeList = emailsAll().filter((em) => busyAt(em, s - 15 * 60000, s));
        const lunch = h * 60 + mi < 13 * 60 && h * 60 + mi + S.dur > 12 * 60;
        out.push({ s, e, d, h, mi, clash, clashList, beforeList, total, score: clash * 100 + (lunch ? 30 : 0) + (beforeList.length ? 5 : 0) + (mi ? 1 : 0) + (s - now) / 3.6e8 });
      }
    return out.sort((a, b) => a.score - b.score);
  };
  const slotNote = (s: Slot, unk: string[]) => {
    const bits: string[] = [];
    if (s.clash) bits.push(`${listNames(s.clashList)} busy`);
    else if (!unk.length) bits.push('Everyone is free');
    if (!s.clash && s.beforeList.length) bits.push(`${listNames(s.beforeList)} in a meeting just before`);
    if (unk.length && S.fb === 'ok') bits.push(`${listNames(unk)}: calendar not read`);
    if (S.fb === 'error') bits.push('Calendars not read');
    return bits.join('. ');
  };

  /* ---------------------------------------------------------------- scheduling assistant */
  const optList = () => [...S.optional].filter((e) => S.people.has(e));
  const loadAssist = async () => {
    if (!S.can.ok || !hasWho()) return;
    const days = weekDays(S.week);
    const first = days[0];
    const last = days[days.length - 1];
    const from = new Date(Math.max(Date.now(), etInstant(first.y, first.mo, first.d, 0, 0))).toISOString();
    const to = new Date(etInstant(last.y, last.mo, last.d, 23, 59)).toISOString();
    const key = [from, [...S.people.keys()].sort().join(','), optList().sort().join(','), S.dur, S.buffer, S.travel].join('|');
    if (S.asKey === key) return;
    S.asKey = key;
    S.as.state = 'loading';
    draw();
    try {
      const body = { emails: [...S.people.keys()], optional: optList(), from, to, durationMin: S.dur, bufferMin: S.buffer, travelMin: S.travel };
      const r = await meetApi<{ slots?: any[]; people?: any[] }>('meetings/assist', { method: 'POST', body });
      if (S.asKey !== key) return;
      S.as = { state: 'ok', slots: r.slots || [], people: r.people || [] };
    } catch (e) {
      if (S.asKey !== key) return;
      S.as = { state: 'error', slots: [], people: [], msg: (e as Error).message };
    }
    draw();
  };
  const isAre = (e: string) => (nameOf(e) === 'You' ? 'are' : 'is');
  const holdTimes = async () => {
    const picks = [...S.picked];
    if (picks.length < 2 || picks.length > 4) return;
    S.busyNow = true;
    draw();
    try {
      const slots = picks.map((a) => ({ startsAt: a, endsAt: new Date(Date.parse(a) + S.dur * 60000).toISOString() }));
      const r = await meetApi<{ grp: string }>('meetings/holds', { method: 'POST', body: { title: S.title.trim() || defaultTitle() || 'Meeting', slots } });
      if (S.holdGrp && S.holdGrp !== r.grp) meetApi('meetings/holds/release', { method: 'POST', body: { grp: S.holdGrp } }).catch(() => undefined);
      S.holdGrp = r.grp;
      S.holdMsg = `Holding ${picks.length} times on your calendar. Booking one releases the others.`;
      S.multi = false;
      S.picked = new Set();
      save();
    } catch (e) {
      toast((e as Error).message);
    }
    S.busyNow = false;
    draw();
  };

  /* ---------------------------------------------------------------- conflicts: a warning only, booking is never blocked */
  const checkConflicts = async () => {
    if (!S.start) return;
    const startsAt = S.start;
    const endsAt = new Date(Date.parse(startsAt) + S.dur * 60000).toISOString();
    const key = startsAt + '|' + S.dur + '|' + emailsAll().join(',');
    if (S.conf.key === key && S.conf.state === 'ok') return;
    S.conf = { key, list: [], state: 'loading' };
    try {
      const r = await meetApi<{ conflicts?: any[] }>('meetings/conflicts', { method: 'POST', body: { startsAt, endsAt, emails: emailsAll(), skipId: EDIT || undefined } });
      if (S.conf.key !== key) return;
      S.conf = { key, list: r.conflicts || [], state: 'ok' };
    } catch {
      if (S.conf.key !== key) return;
      S.conf = { key, list: [], state: 'error' };
    }
    draw();
  };
  const pickTime = (iso: string) => {
    S.start = iso;
    draw();
    void checkConflicts();
  };

  // On arrival: the second step (editing) reads calendars at once; the posting channels load on the side; a wizard saved before the Google
  // consent screen comes back.
  useEffect(() => {
    meetApi<{ channels?: any[] }>('meetings/channels')
      .then((r) => {
        S.channels = r.channels || [];
        if (S.step === 3) draw();
      })
      .catch(() => undefined);
    if (google) {
      try {
        const saved = JSON.parse(sessionStorage.getItem('meet.book') || 'null');
        if (saved) {
          S.step = saved.step || 3;
          S.teams = new Set(saved.teams);
          S.chipAdded = new Map(saved.chipAdded || []);
          S.autoTitle = !!saved.autoTitle;
          S.people = new Map(saved.people);
          S.guests = saved.guests;
          S.dur = saved.dur;
          S.start = saved.start;
          S.title = saved.title;
          S.agenda = saved.agenda;
          S.rec = saved.rec;
          S.rule = ruleIn(saved.rule);
          S.access = saved.access || 'invited';
          S.team = saved.team || '';
          S.driveFolder = saved.driveFolder || '';
          S.templateId = saved.templateId || '';
          S.optional = new Set(saved.optional || []);
          S.buffer = saved.buffer || 0;
          S.travel = saved.travel || 0;
          S.holdGrp = saved.holdGrp || '';
          S.remind = saved.remind;
          if (S.step === 2 && !S.can.ok) S.fb = 'consent';
        }
      } catch {
        // an unreadable saved wizard starts fresh
      }
    }
    if (S.step === 2) {
      void loadBusy();
      void loadAssist();
      if (S.start) void checkConflicts();
    }
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A time chosen with the keyboard keeps the focus after the grid draws again.
  useEffect(() => {
    if (!focusAt.current) return;
    const el = document.querySelector<HTMLElement>(`td.c[data-at="${focusAt.current}"]`);
    focusAt.current = '';
    if (el) {
      document.querySelectorAll('td.c[tabindex="0"]').forEach((x) => x.setAttribute('tabindex', '-1'));
      el.setAttribute('tabindex', '0');
      el.focus();
    }
  });
  useEffect(() => {
    if (S.booked) document.title = 'Booked - FavorOS';
  }, [S.booked]);

  /* ---------------------------------------------------------------- templates */
  const saveTemplate = async () => {
    const name = S.tplName.trim();
    if (!name) return toast('Name the template.');
    try {
      const guests = S.guestsOn ? S.guests : [];
      const body = {
        name, title: S.title, agenda: S.agenda, durationMin: S.dur, rec: S.rec, access: S.access, team: S.team, driveFolder: S.driveFolder, shared: S.tplShare, rule: ruleOut(S.rule, S.start),
        invitees: [...invited().map((p) => ({ email: p.email, name: p.name, team: p.team })), ...guests.map((g) => ({ email: g, name: g, guest: true }))],
      };
      const r = await meetApi<{ id: string }>('meetings/templates', { method: 'POST', body });
      S.templates = (await meetApi<{ templates?: any[] }>('meetings/templates')).templates || [];
      S.templateId = r.id;
      S.tplOpen = false;
      S.tplName = '';
      S.tplShare = false;
      save();
      draw();
      toast('Template saved');
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const templateBlock = () => (
    <div className="sc-tpl">
      <div className="mt-f">
        <label htmlFor="sc-tpl">Start from a template</label>
        <select
          id="sc-tpl"
          value={S.templateId}
          onChange={(e) => {
            const tp = S.templates.find((x: any) => x.id === e.target.value);
            if (tp) applyTemplateTo(S, tp, addPerson);
            else S.templateId = '';
            save();
            draw();
          }}
        >
          <option value="">No template</option>
          {S.templates.map((t: any) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.shared && !t.mine ? ' (shared)' : ''}
            </option>
          ))}
        </select>
      </div>
      {S.tplOpen ? (
        <div className="sc-tpl-new">
          <div className="mt-f">
            <label htmlFor="sc-tname">Template name</label>
            <input id="sc-tname" value={S.tplName} maxLength={80} autoFocus onChange={(e) => { S.tplName = e.target.value; draw(); }} />
          </div>
          <label className="sc-check">
            <input type="checkbox" id="sc-tshare" checked={S.tplShare} onChange={(e) => { S.tplShare = e.target.checked; draw(); }} />
            Share with all staff
          </label>
          <div className="sc-row">
            <button className="h-btn h-btn--primary h-btn--sm" id="sc-tsave" onClick={() => void saveTemplate()}>
              Save template
            </button>
            <button className="h-btn h-btn--ghost h-btn--sm" id="sc-tcancel" onClick={() => { S.tplOpen = false; draw(); }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="sc-row">
          <button className="h-btn h-btn--ghost h-btn--sm" id="sc-topen" onClick={() => { S.tplOpen = true; draw(); }}>
            Save as template
          </button>
        </div>
      )}
    </div>
  );

  /* ---------------------------------------------------------------- repeat editor */
  const repeatBlock = () => {
    const r = S.rule;
    const b = baseOf(S.start);
    const on = ruleOn(r);
    const opts: [string, string][] = [['none', 'Does not repeat'], ['daily', 'Every day'], ['weekdays', 'Every weekday'], ['weekly', 'Weekly on chosen days'], ['monthly', 'Monthly'], ['yearly', 'Yearly']];
    const unit = UNIT[r.freq] || '';
    const mopts: [string, string][] = [['date', `On day ${b.d}`]];
    if (b.nth <= 4) mopts.push(['weekday', `On the ${ORD[b.nth]} ${DAY_NAMES[b.wd]}`]);
    if (b.last) mopts.push(['last', `On the last ${DAY_NAMES[b.wd]}`]);
    const mval = mopts.some((x) => x[0] === r.monthBy) ? r.monthBy : 'date';
    const sentence = on ? ruleText(r, S.start) : '';
    const minDate = `${b.y}-${String(b.mo).padStart(2, '0')}-${String(b.d).padStart(2, '0')}`;
    const done = () => {
      save();
      draw();
    };
    // A number box commits when it loses focus or Enter is pressed, as a change event does on the classic page.
    const commit = (fn: (v: string) => void) => ({
      onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
        fn(e.target.value);
        done();
      },
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          fn((e.target as HTMLInputElement).value);
          done();
        }
      },
    });
    return (
      <div className="sc-rep">
        <div className="h-label" style={{ marginBottom: 8 }}>
          Repeats
        </div>
        <div className="mt-f">
          <select
            id="sc-freq"
            aria-label="Repeats"
            value={r.freq}
            onChange={(e) => {
              r.freq = e.target.value;
              if (r.freq === 'weekly' && !r.byDay.length) r.byDay = [b.wd];
              if (r.freq === 'weekdays') r.interval = 1;
              done();
            }}
          >
            {opts.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        {on && r.freq !== 'weekdays' ? (
          <div className="sc-every">
            <label htmlFor="sc-int">Every</label>
            <input id="sc-int" type="number" min={1} max={52} inputMode="numeric" key={'i' + r.interval} defaultValue={r.interval} {...commit((v) => (r.interval = Math.max(1, Math.min(52, Number(v) || 1))))} />
            <span>
              {unit}
              {Number(r.interval) === 1 ? '' : 's'}
            </span>
          </div>
        ) : null}
        {r.freq === 'weekly' ? (
          <div className="sc-days" role="group" aria-label="Days of the week">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((l, i) => {
              const sel = (r.byDay.length ? r.byDay : [b.wd]).includes(i);
              return (
                <button
                  type="button"
                  key={i}
                  className={'sc-day' + (sel ? ' is-on' : '')}
                  data-sday={i}
                  aria-pressed={sel}
                  aria-label={DAY_NAMES[i]}
                  onClick={() => {
                    const cur = r.byDay.length ? r.byDay : [b.wd];
                    r.byDay = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i];
                    if (!r.byDay.length) r.byDay = [i];
                    done();
                  }}
                >
                  {l}
                </button>
              );
            })}
          </div>
        ) : null}
        {r.freq === 'monthly' ? (
          <div className="mt-f">
            <select
              id="sc-mby"
              aria-label="Monthly pattern"
              value={mval}
              onChange={(e) => {
                r.monthBy = e.target.value;
                done();
              }}
            >
              {mopts.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {on ? (
          <>
            <div className="sc-end">
              <div className="mt-f">
                <label htmlFor="sc-end">Ends</label>
                <select
                  id="sc-end"
                  value={r.end.kind}
                  onChange={(e) => {
                    r.end.kind = e.target.value;
                    if (e.target.value === 'until' && !r.end.until) r.end.until = new Date(Date.UTC(b.y, b.mo + 2, b.d)).toISOString().slice(0, 10);
                    done();
                  }}
                >
                  <option value="never">Never</option>
                  <option value="count">After a number of meetings</option>
                  <option value="until">On a date</option>
                </select>
              </div>
              {r.end.kind === 'count' ? (
                <div className="sc-every">
                  <label htmlFor="sc-cnt">After</label>
                  <input id="sc-cnt" type="number" min={1} max={400} inputMode="numeric" key={'c' + r.end.count} defaultValue={r.end.count} {...commit((v) => (r.end.count = Math.max(1, Math.min(400, Number(v) || 1))))} />
                  <span>meeting{Number(r.end.count) === 1 ? '' : 's'}</span>
                </div>
              ) : null}
              {r.end.kind === 'until' ? (
                <div className="mt-f">
                  <label htmlFor="sc-unt">Last day</label>
                  <input
                    id="sc-unt"
                    type="date"
                    value={r.end.until}
                    min={minDate}
                    onChange={(e) => {
                      r.end.until = e.target.value;
                      done();
                    }}
                  />
                </div>
              ) : null}
            </div>
            <p className="sc-sentence">{sentence}</p>
          </>
        ) : null}
      </div>
    );
  };

  /* ---------------------------------------------------------------- the pieces of each step */
  const stepOpen = (n: number) => n <= S.step || (n === 2 && hasWho()) || (n === 3 && hasWho() && !!S.start && S.can.ok);
  const goStep = (to: number | 'save') => {
    if (to === 'save') return void reschedule();
    if (!stepOpen(to)) return;
    S.step = to;
    if (S.step === 3 && (!S.title || S.autoTitle)) {
      S.title = defaultTitle();
      S.autoTitle = true;
    }
    if (S.step === 2 && !S.can.ok) S.fb = 'consent';
    save();
    draw();
    window.scrollTo(0, 0);
    if (S.step === 2) {
      void loadBusy();
      void loadAssist();
      if (S.start) void checkConflicts();
    }
  };
  const stepsBar = () => (
    <div className="mt-steps">
      {['Who', 'When', 'Details'].map((l, i) => (
        <button key={l} className={'mt-step' + (S.step === i + 1 ? ' is-on' : S.step > i + 1 ? ' is-done' : '')} data-step={i + 1} disabled={!stepOpen(i + 1)} onClick={() => goStep(i + 1)}>
          <i>{S.step > i + 1 ? '✓' : i + 1}</i>
          {l}
        </button>
      ))}
    </div>
  );
  const personChip = (p: Person) => (
    <span className="mt-person" key={p.email}>
      <Avatar name={p.name} />
      {p.name}
      <button
        data-rm={p.email}
        aria-label={`Remove ${p.name}`}
        onClick={() => {
          S.people.delete(p.email);
          S.optional.delete(p.email);
          S.asKey = '';
          S.conf.key = '';
          draw();
        }}
      >
        <Icon n="x" />
      </button>
    </span>
  );

  const startNow = async () => {
    S.busyNow = true;
    draw();
    try {
      const guests = S.guestsOn ? S.guests : [];
      const r = await meetApi<{ meeting: { id: string } }>('meetings', {
        method: 'POST',
        body: {
          title: S.title.trim() || defaultTitle() || 'Meeting', rec: S.rec, access: 'invited',
          invitees: [...invited().map((p) => ({ email: p.email, name: p.name, team: p.team })), ...guests.map((g) => ({ email: g, name: g, guest: true }))],
        },
      });
      try {
        sessionStorage.removeItem('meet.book');
      } catch {
        // nothing saved
      }
      location.href = '/meet/room/?m=' + r.meeting.id;
    } catch (e) {
      S.busyNow = false;
      draw();
      toast((e as Error).message);
    }
  };

  const confirmBook = async () => {
    if (!S.start) return toast('Pick a time first.');
    S.busyNow = true;
    draw();
    try {
      const guests = S.guestsOn ? S.guests : [];
      const r = await meetApi<any>('meetings', {
        method: 'POST',
        body: {
          title: S.title.trim() || defaultTitle() || 'Meeting', agenda: S.agenda, startsAt: S.start, durationMin: S.dur, rec: S.rec, access: S.access || 'invited', recur: ruleOut(S.rule, S.start) || undefined, tz: BTZ, templateId: S.templateId || undefined, team: S.team || undefined, driveFolder: S.driveFolder.trim() || undefined, holdGroup: S.holdGrp || undefined, remind: S.remind, postChannel: S.post,
          invitees: [...invited().map((p) => ({ email: p.email, name: p.name, team: p.team })), ...guests.map((g) => ({ email: g, name: g, guest: true }))],
        },
      });
      try {
        sessionStorage.removeItem('meet.book');
      } catch {
        // nothing saved
      }
      S.bookedRule = ruleText(S.rule, S.start);
      S.booked = r;
      S.holdGrp = '';
      S.busyNow = false;
      draw();
      if (guests.length)
        meetApi<{ url: string }>('meetings/' + r.meeting.id + '/guestlink', { method: 'POST', body: {} })
          .then((g) => {
            S.guestLink = g.url;
            draw();
          })
          .catch(() => undefined);
    } catch (e) {
      S.busyNow = false;
      if ((e as MeetError).code === 'consent') {
        S.fb = 'consent';
        S.fbMsg = (e as Error).message;
        S.step = 2;
        save();
      } else toast((e as Error).message);
      draw();
    }
  };
  // A meeting in a series asks which meetings the change reaches. A single meeting moves as before.
  const reschedule = async () => {
    if (S.editing && S.editing.seriesId) {
      S.scopeAsk = true;
      S.scope = S.scope || 'this';
      draw();
      window.scrollTo(0, 0);
      return;
    }
    return saveEdit();
  };
  const saveEdit = async () => {
    try {
      const body: Record<string, unknown> = { startsAt: S.start };
      if (S.editing && S.editing.seriesId) {
        const guests = S.guestsOn ? S.guests : [];
        Object.assign(body, { scope: S.scope || 'this', durationMin: S.dur, title: S.title, agenda: S.agenda, rec: S.rec, invitees: [...invited().map((p) => ({ email: p.email, name: p.name, team: p.team })), ...guests.map((g) => ({ email: g, name: g, guest: true }))] });
        const out = ruleOut(S.rule, S.start);
        if (body.scope !== 'this' && out && JSON.stringify(out) !== S.ruleWas) body.recur = out; // the update route has no way to stop a series from repeating
      }
      await meetApi('meetings/' + EDIT + '/update', { method: 'POST', body });
      toast('Moved. Invitations updated.');
      setTimeout(() => (location.href = '/meet/'), 900);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  /* ---------------------------------------------------------------- the screens */
  if (S.booked) {
    const m = S.booked.meeting;
    const link = roomLinkSafe(m.id, hydrated);
    const end = new Date(Date.parse(m.startsAt) + (m.durationMin || S.dur) * 60000).toISOString();
    const everyone = [S.me, ...invited()].filter(Boolean).map((p: any) => ({ name: p.name || p.email, email: p.email }));
    const n = S.people.size + S.guests.length;
    return (
      <>
        <div className="h-card mt-card" style={{ maxWidth: 720, margin: '10px auto', display: 'grid', gap: 16, justifyItems: 'start', gridTemplateColumns: 'minmax(0,1fr)' }}>
          <span className="done-ic">
            <Icon n="check" />
          </span>
          <div>
            <h2 className="mt-h2">{m.title}</h2>
            <p className="mt-sub" style={{ fontSize: 14, margin: 0 }}>
              Booked for {etDay(m.startsAt)}, {etTime(m.startsAt)} to {etTime(end)} Eastern, {m.durationMin || S.dur} min{S.bookedRule ? `. ${S.bookedRule}` : ''}.
              {S.booked.calendar ? ` Invites went to ${n} ${n === 1 ? 'person' : 'people'} and the meeting is on their Google Calendars.` : ''}
            </p>
          </div>
          <div style={{ width: '100%' }}>
            <div className="h-label" style={{ marginBottom: 6 }}>
              Invited
            </div>
            <div className="mt-people">
              {everyone.map((p) => (
                <span className="mt-person" key={p.email}>
                  <Avatar name={p.name} />
                  {p.name}
                </span>
              ))}
              {S.guests.map((g) => (
                <span className="mt-person mt-person--guest" key={g}>
                  <Avatar name={g} />
                  {g}
                </span>
              ))}
            </div>
          </div>
          <div style={{ width: '100%' }}>
            <div className="h-label" style={{ marginBottom: 6 }}>
              Share link
            </div>
            <div className="linkbox">
              <code>{link.replace(/^https?:\/\//, '')}</code>
              <button className="h-btn h-btn--ghost h-btn--sm" id="cp" onClick={() => void copyText(roomLink(m.id))}>
                <Icon n="copy" />
                Copy
              </button>
            </div>
          </div>
          <ul className="nt-list">
            <li>
              <span className="b">
                <Icon n="bell" />
              </span>
              <span>{S.remind ? `Reminder emails go out a day before and ${S.can.leadMin || 15} minutes before the start, with the join link.` : 'No reminder emails. Google Calendar still shows its own reminder.'}</span>
            </li>
            <li>
              <span className="b">
                <Icon n="notes" />
              </span>
              <span>{S.rec === 'off' ? 'No notes for this meeting.' : S.rec === 'video' ? 'Video, transcript and notes go to the Meetings folder in US Team Files and to Meeting notes in FavorOS.' : 'Transcript and notes go to Meeting notes in FavorOS.'}</span>
            </li>
          </ul>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <NavLink className="h-btn h-btn--primary" href="/meet/">
              Back to meetings
            </NavLink>
            {S.booked.seriesId ? (
              <NavLink className="h-btn h-btn--ghost" href={`/meet/series/?id=${encodeURIComponent(S.booked.seriesId)}`}>
                Open the series
              </NavLink>
            ) : null}
            <a className="h-btn h-btn--ghost" href="/meet/book/">
              Book another
            </a>
          </div>
          {S.guestLink ? (
            <div className="mt-guestlink">
              <span className="h-label">Guest link</span>
              <input readOnly value={S.guestLink} aria-label="Guest link" />
              <button className="h-btn h-btn--ghost h-btn--sm" type="button" onClick={() => navigator.clipboard.writeText(S.guestLink as string).then(() => toast('Guest link copied'))}>
                <Icon n="link" />
                Copy
              </button>
            </div>
          ) : null}
        </div>
      </>
    );
  }

  if (S.scopeAsk) {
    const m = S.editing;
    const when = `${etDay(S.start)}, ${etTime(S.start)} Eastern`;
    const choices: [string, string, string][] = [
      ['this', 'This meeting', 'Only the meeting on ' + etDay(m.startsAt) + '.'],
      ['following', 'This and following meetings', 'This meeting and every later one in the series.'],
      ['all', 'All meetings', 'Every meeting in the series, past ones stay as they were.'],
    ];
    return (
      <>
        <div className="mt-intro">
          <div>
            <p>Change which meetings?</p>
          </div>
        </div>
        <section className="h-card mt-card" style={{ display: 'grid', gap: 14, maxWidth: 720, margin: '0 auto' }}>
          <p className="mt-sub" style={{ margin: 0 }}>
            New time: {when}
          </p>
          <div className="mt-opt">
            {choices.map(([k, t, d]) => (
              <button
                key={k}
                className={S.scope === k ? 'is-on' : ''}
                data-scope={k}
                onClick={() => {
                  S.scope = k;
                  draw();
                }}
              >
                <i className="dot" />
                <div>
                  <b>{t}</b>
                  <span>{d}</span>
                </div>
              </button>
            ))}
          </div>
          {S.scope && S.scope !== 'this' ? repeatBlock() : null}
        </section>
        <div className="mt-foot">
          <button
            className="h-btn h-btn--ghost"
            data-scopeback="1"
            onClick={() => {
              S.scopeAsk = false;
              draw();
            }}
          >
            <Icon n="back" />
            Back
          </button>
          <button className="h-btn h-btn--primary" id="sc-savescope" disabled={!S.scope} onClick={() => void saveEdit()}>
            Save the change
          </button>
        </div>
      </>
    );
  }

  let body: ReactNode = null;
  if (S.step === 1) {
    body = (
      <>
        <div className="mt-grid">
          <section className="h-card mt-card" style={{ display: 'grid', gap: 16 }}>
            <div>
              <h3 className="mt-h3">Pick a team or a group</h3>
              <div className="mt-chips">
                {teamsList().map(([t, n]) => (
                  <button
                    key={t}
                    className={'mt-chip' + (S.teams.has(t) ? ' is-on' : '')}
                    data-team={t}
                    onClick={() => {
                      toggleTeam(t);
                      save();
                      draw();
                    }}
                  >
                    {t}
                    <span>{n}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <h3 className="mt-h3">Add people</h3>
              <div className="mt-add">
                <input id="addp" ref={addp} aria-label="Add people" placeholder="Name or Favor email" list="plist" autoComplete="off" />
                <button
                  className="h-btn h-btn--ghost h-btn--sm"
                  id="addbtn"
                  onClick={() => {
                    const v = (addp.current?.value || '').trim().toLowerCase();
                    if (!v) return;
                    const p = S.dir.find((x) => x.name.toLowerCase() === v) || S.dir.find((x) => x.name.toLowerCase().includes(v) || x.email.toLowerCase() === v);
                    if (p) addPerson(p);
                    else if (/^[^@\s]+@favorintl\.org$/.test(v)) addPerson(personByEmail(v));
                    else return toast('No one on staff by that name. Type a full Favor email address.');
                    if (addp.current) addp.current.value = '';
                    draw();
                  }}
                >
                  <Icon n="plus" />
                  Add
                </button>
              </div>
              <datalist id="plist">
                {S.dir.map((p) => (
                  <option key={p.email} value={p.name} />
                ))}
              </datalist>
            </div>
            <div>
              <h3 className="mt-h3">{S.people.size + S.guests.length} invited</h3>
              <div className="mt-people">
                {invited().map(personChip)}
                {S.guests.map((g, i) => (
                  <span className="mt-person mt-person--guest" key={g}>
                    <Avatar name={g} />
                    {g}
                    <button
                      data-rg={i}
                      aria-label="Remove"
                      onClick={() => {
                        S.guests.splice(i, 1);
                        draw();
                      }}
                    >
                      <Icon n="x" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
            {S.guestsOn ? (
              <div>
                <h3 className="mt-h3">Guests from outside Favor</h3>
                <div className="mt-add">
                  <input id="addg" ref={addg} aria-label="Guest email address" placeholder="Email address" />
                  <button
                    className="h-btn h-btn--ghost h-btn--sm"
                    id="addgbtn"
                    onClick={() => {
                      const v = (addg.current?.value || '').trim().toLowerCase();
                      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return toast('Type a full email address');
                      if (/@favorintl\.org$/.test(v)) addPerson(personByEmail(v));
                      else if (!S.guests.includes(v)) S.guests.push(v);
                      if (addg.current) addg.current.value = '';
                      draw();
                    }}
                  >
                    <Icon n="plus" />
                    Add guest
                  </button>
                </div>
              </div>
            ) : null}
          </section>
          <aside className="mt-stack">
            <div className="mt-note">Reads free and busy times only.</div>
            <div className="h-card mt-card">
              <div className="h-label" style={{ marginBottom: 8 }}>
                How long
              </div>
              <div className="mt-seg">
                {[30, 45, 60, 90].map((d) => (
                  <button
                    key={d}
                    className={S.dur === d ? 'is-on' : ''}
                    data-dur={d}
                    onClick={() => {
                      S.dur = d;
                      S.busyKey = '';
                      draw();
                    }}
                  >
                    {d} min
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </div>
        <div className="mt-foot">
          <button className="h-btn h-btn--ghost" id="startnow" disabled={!!S.busyNow} onClick={() => void startNow()}>
            <Icon n="video" />
            Start now
          </button>
          <button className="h-btn h-btn--primary" data-step="2" disabled={!hasWho()} onClick={() => goStep(2)}>
            Find times
            <Icon n="chev" />
          </button>
        </div>
      </>
    );
  } else if (!hydrated) {
    // Steps two and three read the clock and the browser's time zone, so the server draws them as a waiting box.
    body = <Wait h={320} />;
  } else if (S.step === 2 && S.fb === 'consent') {
    body = (
      <>
        <div className="mt-note mt-note--gold" style={{ marginBottom: 10 }}>
          <b>Allow calendar access once.</b> {S.fbMsg || 'Favor needs to read free and busy times and add the meeting to your calendar.'}{' '}
          <a className="h-btn h-btn--primary h-btn--sm" href={`/api/google/connect?add=meetings&next=${encodeURIComponent(EDIT ? '/meet/book/?edit=' + EDIT : '/meet/book/')}`} id="allow" onClick={save}>
            Allow in Google
          </a>
        </div>
        <div className="mt-foot">
          {EDIT ? (
            <NavLink className="h-btn h-btn--ghost" href="/meet/">
              Cancel
            </NavLink>
          ) : (
            <button className="h-btn h-btn--ghost" data-step="1" onClick={() => goStep(1)}>
              <Icon n="back" />
              Back
            </button>
          )}
        </div>
      </>
    );
  } else if (S.step === 2) {
    const days = weekDays(S.week);
    const unk = unknownList();
    const slots = S.fb === 'ok' || S.fb === 'error' ? slotsFor(days).slice(0, 4) : [];
    const total = emailsAll().length;
    const pickCell = S.start ? null : slots[0];
    const cell = (d: Day, [h, mi]: [number, number]) => {
      const s = etInstant(d.y, d.mo, d.d, h, mi);
      if (s + 1800000 <= Date.now()) return <td key={d.d + ':' + h + ':' + mi} className="c is-past" role="gridcell" aria-disabled="true" tabIndex={-1} />;
      const n = S.fb === 'ok' ? busyCount(s, s + 1800000) : 0;
      const bb = n === 0 ? 0 : n / total < 0.25 ? 1 : n / total < 0.5 ? 2 : 3;
      const sel = S.start && s >= Date.parse(S.start) && s < Date.parse(S.start) + S.dur * 60000;
      const pick = slots.some((x) => x.s === s);
      const first = S.start ? s === Date.parse(S.start) : pickCell ? s === pickCell.s : h === HOURS[0][0] && mi === 0 && d === days[0];
      const label = `${WD[d.wd]} ${d.mo}/${d.d}, ${hourLabel(h)}${mi ? ':30' : ''}${n ? `, ${n} of ${total} busy` : ''}`;
      const at = new Date(s).toISOString();
      return (
        <td key={d.d + ':' + h + ':' + mi} className={'c' + (sel ? ' is-sel' : '') + (pick && !sel ? ' is-pick' : '')} role="gridcell" tabIndex={first ? 0 : -1} aria-selected={sel ? 'true' : 'false'} aria-label={label} data-b={bb} data-at={at} title={label} onClick={() => pickTime(at)} />
      );
    };
    const A = S.as;
    const peopleList = [...S.people.values()];
    const me = (S.me.email || '').toLowerCase();
    const none = A.people.filter((p: any) => p.source === 'none' && p.email !== me).map((p: any) => nameOf(p.email));
    const sugs = A.slots.slice(0, 8);
    const sel = (id: string, label: string, vals: number[], cur: number, set: (v: number) => void) => (
      <div className="mt-f">
        <label htmlFor={id}>{label}</label>
        <select id={id} value={cur} onChange={(e) => { set(Number(e.target.value)); S.asKey = ''; save(); void loadAssist(); draw(); }}>
          {vals.map((v) => (
            <option key={v} value={v}>
              {v ? v + ' min' : 'None'}
            </option>
          ))}
        </select>
      </div>
    );
    const assist = (
      <section className="h-card mt-card sc-assist">
        <div className="sc-head">
          <h3 className="mt-h3" style={{ margin: 0 }}>
            Suggested times
          </h3>
          <span className="mt-sub">Times in Eastern{BTZ !== TZ ? '. Your zone is ' + zoneName(BTZ) : ''}</span>
        </div>
        <div className="sc-ctl">
          {sel('sc-buf', 'Buffer', [0, 5, 10, 15], S.buffer, (v) => (S.buffer = v))}
          {sel('sc-trv', 'Travel time', [0, 15, 30, 60], S.travel, (v) => (S.travel = v))}
        </div>
        {peopleList.length ? (
          <div className="sc-who">
            {peopleList.map((p) => {
              const o = S.optional.has(p.email);
              return (
                <span className={'sc-pp' + (o ? ' is-opt' : '')} key={p.email}>
                  {p.name}
                  <button
                    type="button"
                    data-opt={p.email}
                    aria-pressed={o}
                    aria-label={o ? 'Make ' + p.name + ' required' : 'Make ' + p.name + ' optional'}
                    onClick={() => {
                      if (S.optional.has(p.email)) S.optional.delete(p.email);
                      else S.optional.add(p.email);
                      S.asKey = '';
                      save();
                      void loadAssist();
                    }}
                  >
                    {o ? 'Optional' : 'Required'}
                  </button>
                </span>
              );
            })}
          </div>
        ) : null}
        {A.state === 'ok' && none.length ? <p className="mt-sub sc-none">No calendar for: {none.join(', ')}. Times show only their FavorOS meetings.</p> : null}
        {A.state === 'loading' ? <p className="mt-sub">Finding times.</p> : null}
        {A.state === 'error' ? <p className="mt-sub">{A.msg || 'Suggestions did not load.'} Pick a time on the grid.</p> : null}
        {A.state === 'ok' && !sugs.length ? <p className="mt-sub">No times fit in this week. Try the next week or a shorter meeting.</p> : null}
        {sugs.length ? (
          <div className="sc-list">
            {sugs.map((sl: any) => {
              const on = !S.multi && S.start && Date.parse(S.start) === Date.parse(sl.start);
              const ck = S.picked.has(sl.start);
              const part = (sl.busy && sl.busy.length) || (sl.outside && sl.outside.length);
              const zones = A.people.filter((p: any) => p.tz && p.tz !== TZ && sl.local && sl.local[p.email]);
              const miss = [...(sl.busy || []).map((e: string) => `${nameOf(e)} ${isAre(e)} busy`), ...(sl.outside || []).map((e: string) => `${nameOf(e)} ${isAre(e)} outside working hours`)];
              return (
                <button
                  type="button"
                  key={sl.start}
                  className={'sc-slot' + (on ? ' is-on' : '') + (ck ? ' is-ck' : '')}
                  data-sug={sl.start}
                  {...(S.multi ? { role: 'checkbox', 'aria-checked': ck } : {})}
                  onClick={() => {
                    if (S.multi) {
                      if (S.picked.has(sl.start)) S.picked.delete(sl.start);
                      else if (S.picked.size < 4) S.picked.add(sl.start);
                      else toast('Hold up to 4 times.');
                      draw();
                    } else pickTime(sl.start);
                  }}
                >
                  {S.multi ? <i className={'sc-box' + (ck ? ' is-on' : '')} /> : null}
                  <b>
                    {etDay(sl.start)}, {etTime(sl.start)} to {etTime(sl.end)}
                  </b>
                  {part ? null : <span className="mt-pill mt-pill--ok sc-pill">Everyone is free</span>}
                  {zones.length ? <span className="sc-local">{zones.map((p: any) => `${nameOf(p.email)} ${sl.local[p.email]}`).join(', ')}</span> : null}
                  {miss.length ? <span className="sc-miss">{miss.join('. ')}</span> : null}
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="sc-row">
          {sugs.length > 1 ? (
            <button
              className="h-btn h-btn--ghost h-btn--sm"
              id="sc-multi"
              onClick={() => {
                S.multi = !S.multi;
                S.picked = new Set();
                S.holdMsg = '';
                draw();
              }}
            >
              {S.multi ? 'Done selecting' : 'Select times to hold'}
            </button>
          ) : null}
          {S.multi ? (
            <>
              <button className="h-btn h-btn--primary h-btn--sm" id="sc-hold" disabled={!(S.picked.size >= 2 && S.picked.size <= 4) || !!S.busyNow} onClick={() => void holdTimes()}>
                Hold these times
              </button>
              <span className="mt-sub">{S.picked.size} selected, pick 2 to 4</span>
            </>
          ) : null}
          {S.holdGrp ? (
            <button
              className="h-btn h-btn--ghost h-btn--sm"
              id="sc-release"
              onClick={() => {
                const g = S.holdGrp;
                S.holdGrp = '';
                S.holdMsg = 'Holds released.';
                save();
                draw();
                meetApi('meetings/holds/release', { method: 'POST', body: { grp: g } }).catch((er) => toast((er as Error).message));
              }}
            >
              Release holds
            </button>
          ) : null}
        </div>
        {S.holdMsg ? <p className="mt-sub">{S.holdMsg}</p> : null}
        {A.people.length ? (
          <>
            <button
              type="button"
              className="sc-link"
              id="sc-hrs"
              aria-expanded={S.hrsOn}
              onClick={() => {
                S.hrsOn = !S.hrsOn;
                draw();
              }}
            >
              Working hours
            </button>
            {S.hrsOn ? (
              <ul className="sc-hours">
                {A.people.map((p: any) => (
                  <li key={p.email}>
                    <span>{nameOf(p.email)}</span>
                    <span>
                      {clock(p.dayStart)} to {clock(p.dayEnd)} {zoneName(p.tz)}
                    </span>
                    <i className="sc-bar" style={{ '--a': (p.dayStart / 14.4).toFixed(1) + '%', '--w': ((p.dayEnd - p.dayStart) / 14.4).toFixed(1) + '%' } as React.CSSProperties} />
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </section>
    );
    const endIso = S.start ? new Date(Date.parse(S.start) + S.dur * 60000).toISOString() : '';
    const loc = S.start ? bookerLocal(S.start, BTZ) : '';
    body = (
      <>
        {hasWho() ? assist : null}
        <div className="mt-grid">
          <section className="h-card mt-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <h3 className="mt-h3" style={{ margin: 0 }}>
                {S.week ? 'Week ' + (S.week + 1) : 'The next seven days'}, {total} people, {S.dur} minutes
              </h3>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span className="mt-sub">Times in Eastern</span>
                <button className="icon-b" data-week="-1" disabled={!S.week} aria-label="Earlier" onClick={() => weekMove(-1)}>
                  <Icon n="chevl" />
                </button>
                <button className="icon-b" data-week="1" aria-label="Later" onClick={() => weekMove(1)}>
                  <Icon n="chev" />
                </button>
              </span>
            </div>
            {S.fb === 'loading' ? <p className="mt-sub">Reading calendars.</p> : null}
            {S.fb === 'error' ? (
              <div className="mt-note mt-note--gold" style={{ marginBottom: 10 }}>
                {S.fbMsg || 'Calendars did not load.'} You can still pick a time below.
              </div>
            ) : null}
            {S.fb === 'ok' && unk.length ? (
              <p className="mt-sub" style={{ margin: '0 0 8px' }}>
                {listNames(unk)}: calendar could not be read, so {unk.length === 1 ? 'that time is' : 'those times are'} not checked.
              </p>
            ) : null}
            <div className="fb">
              <table role="grid" aria-label="Times in Eastern time. Use the arrow keys to move and Enter to pick." onKeyDown={gridKey}>
                <thead>
                  <tr>
                    <th />
                    {days.map((d) => (
                      <th key={d.d}>
                        {WD[d.wd]} {d.d}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {HOURS.map((hm, r) => (
                    <tr key={r}>
                      <td className="h">{r % 2 ? '' : hourLabel(hm[0])}</td>
                      {days.map((d) => cell(d, hm))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="fb-key">
              <span>
                <i style={{ background: '#cfdcc6' }} />
                Everyone free
              </span>
              <span>
                <i style={{ background: '#e8e1cc' }} />A few busy
              </span>
              <span>
                <i style={{ background: '#ecd7c6' }} />
                Several busy
              </span>
              <span>
                <i style={{ background: '#e2bfae' }} />
                Many busy
              </span>
              <span>
                <i style={{ background: 'var(--h-brand)' }} />
                Your pick
              </span>
            </div>
          </section>
          <aside className="h-card mt-card">
            <div className="h-label" style={{ marginBottom: 10 }}>
              Best times
            </div>
            <div className="slots">
              {slots.length ? (
                slots.map((s) => (
                  <button key={s.s} className={'slot' + (S.start && Date.parse(S.start) === s.s ? ' is-on' : '')} data-at={new Date(s.s).toISOString()} onClick={() => pickTime(new Date(s.s).toISOString())}>
                    <b>
                      {WD[s.d.wd]} {s.d.mo}/{s.d.d}, {etTime(new Date(s.s).toISOString())} to {etTime(new Date(s.e).toISOString())}
                    </b>
                    {s.clash ? (
                      <span className="mt-pill mt-pill--gold" style={{ height: 22, gridColumn: 'auto' }}>
                        {s.total - s.clash} of {s.total}
                      </span>
                    ) : unk.length ? null : (
                      <span className="mt-pill mt-pill--ok" style={{ height: 22 }}>
                        All free
                      </span>
                    )}
                    <span>{slotNote(s, unk)}</span>
                  </button>
                ))
              ) : (
                <p className="mt-sub">Pick a time on the grid.</p>
              )}
            </div>
          </aside>
        </div>
        {S.start ? (
          <p className="mt-sub sc-picked">
            Picked: {etDay(S.start)}, {etTime(S.start)} to {etTime(endIso)} Eastern{loc ? `. Your time: ${loc}` : ''}
          </p>
        ) : null}
        {conflictBlock()}
        <div className="mt-foot">
          {EDIT ? null : (
            <button className="h-btn h-btn--ghost" data-step="1" onClick={() => goStep(1)}>
              <Icon n="back" />
              Back
            </button>
          )}
          <button className="h-btn h-btn--primary" data-step={EDIT ? 'save' : '3'} disabled={!S.start} onClick={() => goStep(EDIT ? 'save' : 3)}>
            {EDIT ? 'Move the meeting' : 'Use this time'}
            {EDIT ? null : <Icon n="chev" />}
          </button>
        </div>
      </>
    );
  } else {
    const when = S.start ? `${etDay(S.start)}, ${etTime(S.start)} to ${etTime(new Date(Date.parse(S.start) + S.dur * 60000).toISOString())} Eastern` : '';
    const local = S.start ? bookerLocal(S.start, BTZ) : '';
    const RECS: [string, string, string][] = [
      ['video', 'Record video', 'Video, sound and notes. The video goes to the Meetings folder in US Team Files, with the notes beside it.'],
      ['notes', 'Transcribe only', 'Notes from the sound: decisions and action items land in FavorOS after the meeting. No video is kept.'],
      ['off', 'Neither', 'No recording and no notes.'],
    ];
    body = (
      <>
        <div className="mt-grid">
          <section className="h-card mt-card" style={{ display: 'grid', gap: 14 }}>
            {templateBlock()}
            <div className="mt-f">
              <label htmlFor="ttl">Title</label>
              <input
                id="ttl"
                value={S.title}
                placeholder="Meeting title"
                maxLength={140}
                onChange={(e) => {
                  if (e.target.value !== S.title) S.autoTitle = false;
                  S.title = e.target.value;
                  draw();
                }}
              />
            </div>
            <div className="mt-f">
              <label htmlFor="ag">Agenda</label>
              <textarea id="ag" maxLength={2000} value={S.agenda} onChange={(e) => { S.agenda = e.target.value; draw(); }} />
            </div>
            <div>
              <div className="h-label" style={{ marginBottom: 8 }}>
                Record
              </div>
              <div className="mt-opt">
                {RECS.map(([k, t, d]) => (
                  <button key={k} className={S.rec === k ? 'is-on' : ''} data-rec={k} onClick={() => { S.rec = k; draw(); }}>
                    <i className="dot" />
                    <div>
                      <b>{t}</b>
                      <span>{d}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            {S.channels.length ? (
              <div className="mt-f">
                <label htmlFor="postch">Post the summary to</label>
                <select id="postch" value={S.post} onChange={(e) => { S.post = e.target.value; draw(); }}>
                  <option value="">Nowhere</option>
                  {S.channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                    </option>
                  ))}
                </select>
                {S.rec === 'off' ? <span className="mt-sub">Recording is off, so there is no summary to post.</span> : <span className="mt-sub">When the notes are ready, the summary, decisions and action items go there and each owner is mentioned.</span>}
              </div>
            ) : null}
            <div className="sc-two">
              <div className="mt-f">
                <label htmlFor="sc-team">Team</label>
                <select id="sc-team" value={S.team} onChange={(e) => { S.team = e.target.value; save(); draw(); }}>
                  <option value="">No team</option>
                  {teamsList().slice(1).map(([t]) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-f">
                <label htmlFor="sc-drive">Drive notes folder</label>
                <input id="sc-drive" value={S.driveFolder} placeholder="Folder link or ID" maxLength={200} onChange={(e) => { S.driveFolder = e.target.value; draw(); }} onBlur={save} />
              </div>
            </div>
            {repeatBlock()}
          </section>
          <aside className="mt-stack">
            <div className="h-card mt-card">
              <div className="h-label" style={{ marginBottom: 6 }}>
                Summary
              </div>
              <dl className="kv">
                <dt>When</dt>
                <dd>
                  {when}
                  {local ? (
                    <>
                      <br />
                      <span className="mt-sub">Your time: {local}</span>
                    </>
                  ) : null}
                </dd>
                {ruleOn(S.rule) ? (
                  <>
                    <dt>Repeats</dt>
                    <dd>{ruleText(S.rule, S.start)}</dd>
                  </>
                ) : null}
                <dt>Who</dt>
                <dd>
                  {S.people.size + 1} staff{S.guests.length ? `, ${S.guests.length} guest${S.guests.length === 1 ? '' : 's'}` : ''}
                </dd>
                <dt>Where</dt>
                <dd>Favor meeting room in FavorOS</dd>
              </dl>
            </div>
            <div className="h-card mt-card">
              <div className="mt-toggle">
                <div>
                  <b>Email reminders</b>
                  <span>A day before and {S.can.leadMin || 15} minutes before, with the join link</span>
                </div>
                <button className={'mt-sw' + (S.remind ? ' is-on' : '')} data-sw="remind" aria-label="Email reminders" onClick={() => { S.remind = !S.remind; draw(); }} />
              </div>
            </div>
          </aside>
        </div>
        {conflictBlock()}
        <div className="mt-foot">
          <button className="h-btn h-btn--ghost" data-step="2" onClick={() => goStep(2)}>
            <Icon n="back" />
            Back
          </button>
          <button className="h-btn h-btn--primary" id="confirm" disabled={!S.start || !!S.busyNow} onClick={() => void confirmBook()}>
            {S.busyNow ? (
              'Booking'
            ) : (
              <>
                <Icon n="check" />
                Book it and send invites
              </>
            )}
          </button>
        </div>
      </>
    );
  }

  function conflictBlock() {
    if (S.conf.state !== 'ok' || !S.conf.list.length || !S.start) return null;
    const me = (S.me.email || '').toLowerCase();
    const lines = S.conf.list.map((c: any) => {
      const you = c.email === me;
      return `${nameOf(c.email)} ${(WHY[c.why] || WHY.busy)[you ? 1 : 0]}${c.why === 'meeting' && c.title && you ? ' (' + c.title + ')' : ''}`;
    });
    return (
      <div className="mt-note mt-note--gold sc-warn" role="status">
        <b>Heads up.</b> {lines.join('. ')}. You can still book this time.
      </div>
    );
  }
  function weekMove(dir: number) {
    S.week = Math.max(0, S.week + dir);
    S.busyKey = '';
    draw();
    void loadBusy();
    void loadAssist();
  }
  // Keyboard on the time grid: arrows move between cells, Enter or Space picks the time.
  function gridKey(e: React.KeyboardEvent) {
    const c = (e.target as HTMLElement).closest('td.c') as HTMLElement | null;
    if (!c) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      focusAt.current = c.dataset.at || '';
      pickTime(c.dataset.at as string);
      return;
    }
    const dc = ({ ArrowLeft: -1, ArrowRight: 1 } as Record<string, number>)[e.key] || 0;
    const dr = ({ ArrowUp: -1, ArrowDown: 1 } as Record<string, number>)[e.key] || 0;
    if (!dc && !dr) return;
    e.preventDefault();
    const row = c.parentElement as HTMLElement;
    const col = Array.from(row.children).indexOf(c);
    const rows = Array.from((row.parentElement as HTMLElement).children);
    const nr = rows[rows.indexOf(row) + dr] as HTMLElement | undefined;
    if (!nr) return;
    const next = nr.children[Math.min(nr.children.length - 1, Math.max(1, col + dc))] as HTMLElement | undefined;
    if (!next || !next.matches('td.c')) return;
    document.querySelectorAll('td.c[tabindex="0"]').forEach((x) => x.setAttribute('tabindex', '-1'));
    next.setAttribute('tabindex', '0');
    next.focus();
  }

  return (
    <>
      {EDIT ? (
        <div className="mt-intro">
          <div>
            <p>Pick a new time. Everyone gets an updated invitation.</p>
          </div>
        </div>
      ) : (
        stepsBar()
      )}
      {body}
    </>
  );
}

// The room link on the finished screen: the page's own address after the browser takes over, the production one before.
function roomLinkSafe(id: string, hydrated: boolean): string {
  return hydrated ? roomLink(id) : 'https://dash.favorintl.org/meet/room/?m=' + id;
}

export function BookPage({ edit, follow, template, google }: { edit: string; follow: string; template: string; google: boolean }) {
  return (
    <div id="mt-book">
      <Boundary
        key={edit + follow}
        fallback={(e) => (
          <div className="h-card mt-card">
            <p>{e.message}</p>
          </div>
        )}
      >
        <Suspense fallback={<Wait />}>
          <Wizard editId={edit} followId={follow} templateId={template} google={google} />
        </Suspense>
      </Boundary>
      <MeetToast />
    </div>
  );
}

