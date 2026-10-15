// Meetings > Booking page (/meet/booking/): the owner's booking page setup. Types, working hours, upcoming bookings. Port of
// src/pages/meet/booking.astro and public/js/meet/booking.js: the same markup, stylesheets and calls.
import { Suspense, useRef, useState } from 'react';
import { useQueryClient, useSuspenseQueries } from '@tanstack/react-query';
import '@hub/styles/meet.css';
import '@hub/styles/meet-booking.css';
import { Boundary } from '../../partners/record/Boundary';
import { ConfirmHost, Day, MeetToast, Time, Wait, confirmCard, copyText, meetApi, toast, useHydrated } from '../ui';
import { bookingPrefsQuery, bookingQuery } from '../queries';

const ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'];
const ZNAME: Record<string, string> = { 'America/New_York': 'Eastern', 'America/Chicago': 'Central', 'America/Denver': 'Mountain', 'America/Phoenix': 'Arizona', 'America/Los_Angeles': 'Pacific', 'America/Anchorage': 'Alaska', 'Pacific/Honolulu': 'Hawaii' };
const DAYS: [number, string][] = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
const LENGTHS = [15, 20, 30, 45, 60, 90];

export interface BType {
  id: string;
  title: string;
  about: string;
  durationMin: number;
  audience: string;
  location: string;
  place: string;
  questions: { q: string; required: boolean }[];
  tz: string;
  avail: { days?: Record<string, number[][]> } & Record<string, any>;
  bufferMin: number;
  travelMin: number;
  noticeMin: number;
  horizonDays: number;
  maxPerDay: number;
  stepMin: number;
  rec: string;
  active: boolean;
}
export interface BookingData {
  handle: string;
  types: BType[];
  bookings: { id: string; name: string; title?: string; email: string; phone?: string; starts_at: string; ends_at: string; meeting_id?: string; answers?: any[] }[];
}
export interface PrefsData {
  prefs: { tz: string; workDays: number[]; dayStart: number; dayEnd: number; bufferMin: number };
  google?: { freebusy?: boolean } | null;
}

const hhmm = (m: number) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const mins = (v: string) => {
  const [h, m] = String(v || '').split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : NaN;
};
const ZoneOpts = ({ cur }: { cur: string }) => {
  const l = ZONES.includes(cur) || !cur ? ZONES : [cur, ...ZONES];
  return (
    <>
      {l.map((z) => (
        <option key={z} value={z}>
          {ZNAME[z] || z}
        </option>
      ))}
    </>
  );
};
const blank = (tz: string): BType => ({ id: '', title: '', about: '', durationMin: 30, audience: 'partners', location: 'video', place: '', questions: [], tz, avail: { days: {} }, bufferMin: 10, travelMin: 0, noticeMin: 240, horizonDays: 30, maxPerDay: 4, stepMin: 30, rec: 'off', active: true });

// Read the open editor into a type object.
function readForm(f: HTMLFormElement, cur: BType): BType {
  const v = (n: string) => (f.querySelector(`[data-f="${n}"]`) as HTMLInputElement).value;
  const days: Record<string, number[][]> = {};
  f.querySelectorAll<HTMLInputElement>('[data-day]').forEach((c) => {
    if (!c.checked) return;
    const d = c.dataset.day as string;
    const a = mins((f.querySelector(`[data-from="${d}"]`) as HTMLInputElement).value);
    const b = mins((f.querySelector(`[data-to="${d}"]`) as HTMLInputElement).value);
    if (b - a >= 15) days[d] = [[a, b]];
  });
  const questions = Array.from(f.querySelectorAll<HTMLInputElement>('[data-q]'))
    .map((el) => ({ q: el.value.trim(), required: (f.querySelector(`[data-qr="${el.dataset.q}"]`) as HTMLInputElement).checked }))
    .filter((q) => q.q);
  return {
    id: cur.id || (undefined as unknown as string),
    title: v('title').trim(),
    about: v('about').trim(),
    durationMin: +v('durationMin'),
    audience: v('audience'),
    location: v('location'),
    place: v('place').trim(),
    avail: { days },
    tz: v('tz'),
    bufferMin: +v('bufferMin'),
    travelMin: v('location') === 'in_person' ? +v('travelMin') : 0,
    noticeMin: Math.round(+v('noticeH') * 60),
    horizonDays: +v('horizonDays'),
    maxPerDay: +v('maxPerDay'),
    stepMin: +v('stepMin'),
    rec: v('rec'),
    questions,
    active: cur.active !== false,
  };
}

function Sel({ name, val, opts, id }: { name: string; val: string | number; opts: [string | number, string][]; id: string }) {
  return (
    <select className="bk-in" data-f={name} id={id} defaultValue={String(val)}>
      {opts.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

function TypeEditor({ t, i, rev, onAdd, onDel, onClose, onSave }: { t: BType; i: number; rev: number; onAdd: (f: HTMLFormElement) => void; onDel: (f: HTMLFormElement, k: number) => void; onClose: () => void; onSave: (body: BType) => Promise<string | null> }) {
  const form = useRef<HTMLFormElement>(null);
  const [loc, setLoc] = useState(t.location);
  const [err, setErr] = useState('');
  const days = ((t.avail && (t.avail.days || t.avail)) || {}) as Record<string, number[][]>;
  return (
    <form
      className="bk-card"
      data-i={i}
      noValidate
      ref={form}
      key={rev}
      onSubmit={async (e) => {
        e.preventDefault();
        const body = readForm(e.currentTarget, t);
        if (!body.title) {
          setErr('Name the meeting type.');
          return;
        }
        const bad = await onSave(body);
        if (bad) setErr(bad);
      }}
    >
      <div className="bk-field">
        <label htmlFor="f-title">Name</label>
        <input className="bk-in" id="f-title" data-f="title" defaultValue={t.title} maxLength={80} autoFocus />
      </div>
      <div className="bk-field">
        <label htmlFor="f-about">About</label>
        <textarea className="bk-in" id="f-about" data-f="about" maxLength={600} defaultValue={t.about} />
      </div>
      <div className="bk-grid2">
        <div className="bk-field">
          <label htmlFor="f-len">Length</label>
          <Sel name="durationMin" val={t.durationMin} opts={LENGTHS.map((m) => [m, m + ' min'])} id="f-len" />
        </div>
        <div className="bk-field">
          <label htmlFor="f-aud">Who can book</label>
          <Sel name="audience" val={t.audience} opts={[['partners', 'Partners and anyone with the link'], ['staff', 'Staff only']]} id="f-aud" />
        </div>
      </div>
      <div className="bk-field">
        <label htmlFor="f-loc">Where</label>
        <select className="bk-in" data-f="location" id="f-loc" defaultValue={t.location} onChange={(e) => setLoc(e.target.value)}>
          <option value="video">Video call in FavorOS</option>
          <option value="phone">Phone call</option>
          <option value="in_person">In person</option>
        </select>
      </div>
      <div className="bk-field" data-place hidden={loc !== 'in_person'}>
        <label htmlFor="f-place">Place</label>
        <input className="bk-in" id="f-place" data-f="place" defaultValue={t.place} maxLength={200} />
      </div>
      <div className="bk-field">
        <span className="bk-lbl">Hours</span>
        <span className="bk-muted">Leave every day off to use your working hours.</span>
      </div>
      <div className="bk-hours">
        {DAYS.map(([d, n]) => {
          const w = (days[d] || [])[0];
          return (
            <div className="bk-hr" key={d}>
              <label className="bk-check">
                <input type="checkbox" data-day={d} defaultChecked={!!w} /> {n}
              </label>
              <input className="bk-in" type="time" data-from={d} defaultValue={w ? hhmm(w[0]) : '09:00'} aria-label={`${n} from`} />
              <input className="bk-in" type="time" data-to={d} defaultValue={w ? hhmm(w[1]) : '17:00'} aria-label={`${n} to`} />
            </div>
          );
        })}
      </div>
      <div className="bk-field">
        <label htmlFor="f-tz">Time zone</label>
        <select className="bk-in" id="f-tz" data-f="tz" defaultValue={t.tz}>
          <ZoneOpts cur={t.tz} />
        </select>
      </div>
      <div className="bk-grid2">
        <div className="bk-field">
          <label htmlFor="f-buf">Buffer between meetings (min)</label>
          <input className="bk-in" id="f-buf" type="number" min={0} max={120} inputMode="numeric" data-f="bufferMin" defaultValue={t.bufferMin} />
        </div>
        <div className="bk-field" data-travel hidden={loc !== 'in_person'}>
          <label htmlFor="f-trv">Travel time (min)</label>
          <input className="bk-in" id="f-trv" type="number" min={0} max={240} inputMode="numeric" data-f="travelMin" defaultValue={t.travelMin} />
        </div>
        <div className="bk-field">
          <label htmlFor="f-not">Minimum notice (hours)</label>
          <input className="bk-in" id="f-not" type="number" min={0} max={336} inputMode="numeric" data-f="noticeH" defaultValue={Math.round((t.noticeMin || 0) / 60)} />
        </div>
        <div className="bk-field">
          <label htmlFor="f-hor">How far ahead (days)</label>
          <input className="bk-in" id="f-hor" type="number" min={1} max={120} inputMode="numeric" data-f="horizonDays" defaultValue={t.horizonDays} />
        </div>
        <div className="bk-field">
          <label htmlFor="f-max">Most per day</label>
          <input className="bk-in" id="f-max" type="number" min={1} max={20} inputMode="numeric" data-f="maxPerDay" defaultValue={t.maxPerDay} />
        </div>
        <div className="bk-field">
          <label htmlFor="f-step">Start every</label>
          <Sel name="stepMin" val={t.stepMin} opts={[15, 20, 30, 60].map((m) => [m, m + ' min'])} id="f-step" />
        </div>
      </div>
      <div className="bk-field">
        <label htmlFor="f-rec">Recording</label>
        <Sel name="rec" val={t.rec} opts={[['off', 'Off'], ['notes', 'Notes'], ['video', 'Video']]} id="f-rec" />
      </div>
      <div className="bk-field">
        <span className="bk-lbl">Questions</span>
        <div data-qs>
          {(t.questions || []).map((q, k) => (
            <div className="bk-q" key={k}>
              <input className="bk-in" data-q={k} defaultValue={q.q} maxLength={200} aria-label={`Question ${k + 1}`} />
              <button
                type="button"
                className="bk-btn bk-btn--ghost bk-btn--sm"
                data-act="delq"
                data-k={k}
                aria-label={`Remove question ${k + 1}`}
                onClick={() => onDel(form.current as HTMLFormElement, k)}
              >
                Remove
              </button>
              <label className="bk-check">
                <input type="checkbox" data-qr={k} defaultChecked={q.required} /> Required
              </label>
            </div>
          ))}
        </div>
        <div>
          <button type="button" className="bk-btn bk-btn--ghost bk-btn--sm" data-act="addq" onClick={() => onAdd(form.current as HTMLFormElement)}>
            Add a question
          </button>
        </div>
      </div>
      <p className="bk-err" data-err role="alert" hidden={!err}>
        {err}
      </p>
      <div className="bk-row">
        <button type="submit" className="bk-btn">
          Save
        </button>
        <button type="button" className="bk-btn bk-btn--ghost" data-act="close" onClick={onClose}>
          Close
        </button>
      </div>
    </form>
  );
}

function TypeCard({ t, i, onToggle, onEdit }: { t: BType; i: number; onToggle: () => void; onEdit: () => void }) {
  const where = t.location === 'in_person' ? 'In person' + (t.place ? ', ' + t.place : '') : t.location === 'phone' ? 'Phone call' : 'Video call in FavorOS';
  return (
    <div className={'bk-card ' + (t.active ? '' : 'bk-off')} data-i={i}>
      <div className="bk-type-hd">
        <div>
          <h3>{t.title}</h3>
          <div className="bk-muted">
            {t.durationMin} min, {where}, {t.audience === 'staff' ? 'staff only' : 'partners and anyone with the link'}
          </div>
        </div>
        <div className="bk-row">
          <button type="button" className="bk-btn bk-btn--ghost bk-btn--sm" data-act="toggle" aria-pressed={t.active} aria-label={`${t.title} is ${t.active ? 'on' : 'off'}`} onClick={onToggle}>
            {t.active ? 'On' : 'Off'}
          </button>
          <button type="button" className="bk-btn bk-btn--ghost bk-btn--sm" data-act="edit" onClick={onEdit}>
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}

function PrefsCard({ p, google, onSaved }: { p: PrefsData['prefs']; google?: PrefsData['google']; onSaved: (p: PrefsData['prefs'] | null) => void }) {
  return (
    <section className="bk-card">
      <h2 className="bk-h2">Your working hours</h2>
      <p className="bk-muted">Used for suggested times and for meeting types with no hours of their own.</p>
      {google && google.freebusy === false ? (
        <p className="bk-note">
          Connect your Google Calendar so your booking page skips times you are busy. <a href={`/api/google/connect?add=meetings&next=${encodeURIComponent('/meet/booking/')}`}>Connect Google Calendar</a>
        </p>
      ) : null}
      <form
        id="bk-prefs"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const f = e.currentTarget;
          const g = (id: string) => (f.querySelector('#' + id) as HTMLInputElement).value;
          const body = {
            tz: g('p-tz'),
            workDays: Array.from(f.querySelectorAll<HTMLInputElement>('[data-pd]')).filter((c) => c.checked).map((c) => +(c.dataset.pd as string)),
            dayStart: mins(g('p-from')),
            dayEnd: mins(g('p-to')),
            bufferMin: +g('p-buf') || 0,
          };
          if (!(body.dayEnd > body.dayStart)) return toast('The end time must be after the start time.');
          try {
            const r = await meetApi<{ prefs?: PrefsData['prefs'] }>('meetings/prefs', { method: 'POST', body });
            toast('Working hours saved');
            onSaved(r.prefs || null);
          } catch (er) {
            toast((er as Error).message);
          }
        }}
      >
        <div className="bk-field">
          <label htmlFor="p-tz">Time zone</label>
          <select className="bk-in" id="p-tz" defaultValue={p.tz}>
            <ZoneOpts cur={p.tz} />
          </select>
        </div>
        <div className="bk-field">
          <span className="bk-lbl">Days</span>
          <div className="bk-row">
            {DAYS.map(([d, n]) => (
              <label className="bk-check" key={d}>
                <input type="checkbox" data-pd={d} defaultChecked={p.workDays.includes(d)} /> {n}
              </label>
            ))}
          </div>
        </div>
        <div className="bk-grid2">
          <div className="bk-field">
            <label htmlFor="p-from">From</label>
            <input className="bk-in" type="time" id="p-from" defaultValue={hhmm(p.dayStart)} />
          </div>
          <div className="bk-field">
            <label htmlFor="p-to">To</label>
            <input className="bk-in" type="time" id="p-to" defaultValue={hhmm(p.dayEnd)} />
          </div>
        </div>
        <div className="bk-field">
          <label htmlFor="p-buf">Buffer between meetings (min)</label>
          <input className="bk-in" type="number" min={0} max={60} inputMode="numeric" id="p-buf" defaultValue={p.bufferMin} />
        </div>
        <button className="bk-btn" type="submit">
          Save working hours
        </button>
      </form>
    </section>
  );
}

function BookingsCard({ rows, onCancelled }: { rows: BookingData['bookings']; onCancelled: () => void }) {
  return (
    <section className="bk-card">
      <h2 className="bk-h2">Upcoming bookings</h2>
      {rows.length ? (
        rows.map((b) => {
          const ans = (b.answers || []).filter((a) => a && (typeof a !== 'object' || a.a));
          return (
            <div className="bk-bk" key={b.id}>
              <b>{b.name}</b> <span className="bk-muted">{b.title || ''}</span>
              <div>
                {b.email}
                {b.phone ? ', ' + b.phone : ''}
              </div>
              <div className="bk-muted">
                <Day iso={b.starts_at} />, <Time iso={b.starts_at} /> to <Time iso={b.ends_at} />
              </div>
              {ans.length ? (
                <ul className="bk-ans">
                  {ans.map((a, i) =>
                    typeof a === 'object' ? (
                      <li key={i}>
                        {a.q ? <b>{a.q}</b> : null} {a.a || ''}
                      </li>
                    ) : (
                      <li key={i}>{a}</li>
                    )
                  )}
                </ul>
              ) : null}
              <div className="bk-row" style={{ marginTop: 8 }}>
                {b.meeting_id ? (
                  <a className="bk-btn bk-btn--ghost bk-btn--sm" href={`/meet/room/?m=${b.meeting_id}`}>
                    Open
                  </a>
                ) : null}
                <button
                  type="button"
                  className="bk-btn bk-btn--danger bk-btn--sm"
                  data-act="cancel"
                  data-id={b.id}
                  onClick={async () => {
                    const ok = await confirmCard({ title: 'Cancel this booking?', body: 'The partner gets a cancellation with a calendar file.', ok: 'Cancel booking', cancel: 'Keep it', danger: true });
                    if (!ok) return;
                    const note = (prompt('Add a note for the partner (optional)') || '').trim();
                    try {
                      await meetApi('meetings/booking/cancel/' + b.id, { method: 'POST', body: { note } });
                      toast('Booking cancelled');
                      onCancelled();
                    } catch (er) {
                      toast((er as Error).message);
                    }
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          );
        })
      ) : (
        <p className="bk-muted">No upcoming bookings.</p>
      )}
    </section>
  );
}

function Booking() {
  const qc = useQueryClient();
  const [{ data: b }, { data: pd }] = useSuspenseQueries({ queries: [bookingQuery, bookingPrefsQuery] });
  const hydrated = useHydrated();
  const [open, setOpen] = useState<{ i: number; t: BType; rev: number } | null>(null);
  const types = b.types || [];
  const prefs = pd?.prefs || null;
  const origin = hydrated ? location.origin : 'https://dash.favorintl.org';
  const link = origin + '/meet/with/?u=' + encodeURIComponent(b.handle);
  const reload = () => Promise.all([qc.invalidateQueries({ queryKey: ['meet', 'booking'] })]);

  // Keep what was typed when the editor redraws (adding or removing a question).
  const edit = (i: number, t: BType) => setOpen({ i, t, rev: (open?.rev || 0) + 1 });
  const typed = (f: HTMLFormElement) => (open ? { ...open.t, ...readForm(f, open.t) } : null);
  const editor = (t: BType, i: number) => (
    <TypeEditor
      t={t}
      i={i}
      rev={open?.rev || 0}
      onAdd={(f) => {
        const cur = typed(f);
        if (!open || !cur) return;
        if (cur.questions.length >= 8) return toast('Eight questions is the most.');
        setOpen({ ...open, t: { ...cur, questions: [...cur.questions, { q: '', required: false }] }, rev: open.rev + 1 });
      }}
      onDel={(f, k) => {
        const cur = typed(f);
        if (!open || !cur) return;
        setOpen({ ...open, t: { ...cur, questions: cur.questions.filter((_, x) => x !== k) }, rev: open.rev + 1 });
      }}
      onClose={() => setOpen(null)}
      onSave={async (body) => {
        try {
          await meetApi('meetings/booking/types', { method: 'POST', body });
          setOpen(null);
          toast('Saved');
          await reload();
          return null;
        } catch (er) {
          return (er as Error).message;
        }
      }}
    />
  );
  return (
    <>
      <section className="bk-card">
        <h2 className="bk-h2">Your booking link</h2>
        <div className="bk-link">
          <code id="bk-url">{link}</code>
          <button type="button" className="bk-btn bk-btn--sm" data-act="copy" onClick={() => void copyText(location.origin + '/meet/with/?u=' + encodeURIComponent(b.handle))}>
            Copy
          </button>
          <a className="bk-btn bk-btn--ghost bk-btn--sm" href={link} target="_blank" rel="noopener">
            Open
          </a>
        </div>
      </section>
      <section>
        <h2 className="bk-h2">Meeting types</h2>
        {types.length ? (
          types.map((t, i) =>
            open && open.i === i ? (
              <div key={t.id || i}>{editor(open.t, i)}</div>
            ) : (
              <TypeCard
                key={t.id || i}
                t={t}
                i={i}
                onEdit={() => edit(i, JSON.parse(JSON.stringify(t)))}
                onToggle={async () => {
                  try {
                    await meetApi('meetings/booking/types', { method: 'POST', body: { ...t, active: !t.active } });
                    await reload();
                  } catch (er) {
                    toast((er as Error).message);
                  }
                }}
              />
            )
          )
        ) : (
          <p className="bk-muted">No meeting types yet.</p>
        )}
        {open && open.i === -1 ? (
          <div>{editor(open.t, -1)}</div>
        ) : (
          <button type="button" className="bk-btn" data-act="new" onClick={() => edit(-1, blank(prefs ? prefs.tz : 'America/New_York'))}>
            New meeting type
          </button>
        )}
      </section>
      <div style={{ height: 14 }} />
      {prefs ? (
        <PrefsCard
          p={prefs}
          google={pd?.google}
          onSaved={(np) => {
            if (np) qc.setQueryData(bookingPrefsQuery.queryKey, { ...(pd || {}), prefs: np } as PrefsData);
          }}
        />
      ) : null}
      <BookingsCard rows={b.bookings || []} onCancelled={() => void reload()} />
    </>
  );
}

export function BookingPage() {
  return (
    <div id="bk-root" className="bk-wrap--app">
      <Boundary
        fallback={(e) => (
          <div className="bk-card">
            <p className="bk-err">{e.message}</p>
          </div>
        )}
      >
        <Suspense fallback={<Wait />}>
          <Booking />
        </Suspense>
      </Boundary>
      <MeetToast />
      <ConfirmHost />
    </div>
  );
}

