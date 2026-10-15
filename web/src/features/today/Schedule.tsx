// Schedule: today's meetings from FavorOS and Google, Join, Move to FavorOS, and what is coming up in the room the card has left.
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { NavLink } from '@/shell/NavLink';
import { BodyPortal } from '@/shell/BodyPortal';
import { EntityChip } from '@/features/entity/EntityChip';
import { hubOv } from '@/lib/hubOv';
import { navQuery } from '../../lib/queries';
import { clock, dayKey, et, plural, type J } from './rank';
import { dayQ, upcomingQ } from './queries';
import { CardHead, Ic, P, Skel, useNow } from './ui';
import { useShared } from './state';

const PV: Record<string, [string, string, string]> = {
  favor: ['pv-favor', P.leaf, 'FavorOS'],
  zoom: ['pv-zoom', P.meeting, 'Zoom'],
  meet: ['pv-meet', P.meeting, 'Google Meet'],
  teams: ['pv-teams', P.teams, 'Microsoft Teams'],
  webex: ['pv-webex', P.ring, 'Webex'],
  phone: ['pv-none', P.phone, 'Phone call'],
};
const ROOM = (id: string) => '/meet/room/?m=' + encodeURIComponent(id);
const phoneHref = (n: string) => 'tel:' + String(n).replace(/[^0-9+]/g, '');

const isLive = (e: J, now: number) => !e.allDay && now >= Date.parse(e.start) && now < Date.parse(e.end);
const isOver = (e: J, now: number) => !e.allDay && now >= Date.parse(e.end);
const joinOf = (e: J) => (e.hub ? { href: ROOM(e.hub), label: 'Join', inside: true } : e.meet ? { href: e.meet, label: 'Join', inside: false } : e.phone ? { href: phoneHref(e.phone), label: 'Call', inside: false } : null);
const canMove = (e: J, now: number) => !e.hub && !!e.id && !e.allDay && !e.declined && !isOver(e, now) && e.provider !== 'favor';

/** Today's events for the status line, the live pill and this card. */
export function todaysEvents(day: J | null, today: string): J[] {
  const g = day && day.google;
  return ((g && g.events) || []).filter((e: J) => !e.declined && (e.allDay ? String(e.start).slice(0, 10) <= today && String(e.end || e.start).slice(0, 10) >= today : dayKey(e.start) === today));
}

export function Mark({ p }: { p?: string }) {
  const m = p ? PV[p] : null;
  return (
    <span className={'td-pv ' + (m ? m[0] : 'pv-none')} title={m ? m[2] : 'Calendar'}>
      <svg className="h-i" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: m ? m[1] : P.cal }} />
    </span>
  );
}

/* ---------------------------------------------------------------- the sheets (one at a time) */
type SheetView = { mode: 'event'; e: J } | { mode: 'move'; e: J } | { mode: 'moved'; e: J; r: J };

const whenLine = (e: J) => et(e.start, { weekday: 'long', month: 'short', day: 'numeric' }) + ', ' + clock(e.start) + ' to ' + clock(e.end) + ' ET';

function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const layer = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const focus = document.activeElement as HTMLElement | null;
    const tok = hubOv.on(() => closeRef.current());
    const key = (ev: KeyboardEvent) => {
      const l = layer.current;
      if (!l) return;
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeRef.current(); return; }
      if (ev.key !== 'Tab') return;
      const f = Array.from(l.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])')).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (ev.shiftKey && document.activeElement === f[0]) { ev.preventDefault(); f[f.length - 1].focus(); }
      else if (!ev.shiftKey && document.activeElement === f[f.length - 1]) { ev.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', key, true);
    const r = requestAnimationFrame(() => layer.current?.classList.add('is-in'));
    return () => {
      cancelAnimationFrame(r);
      document.removeEventListener('keydown', key, true);
      hubOv.off(tok);
      if (focus && document.contains(focus)) focus.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const f = layer.current?.querySelector<HTMLElement>('[data-t2-first]');
    if (f && !matchMedia('(pointer: coarse)').matches) f.focus({ preventScroll: true });
  }, [label]);
  return (
    <div className="t2-layer" ref={layer}>
      <div className="t2-scrim" onClick={onClose} />
      <div className="t2-sheet" role="dialog" aria-modal="true" aria-label={label}>
        <div className="t2-grab" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}

const CloseBtn = ({ onClose }: { onClose: () => void }) => (
  <button type="button" className="t2-x" aria-label="Close" onClick={onClose}><Ic n="x" /></button>
);

function EventSheet({ e, day, go, onClose, now }: { e: J; day: J; go: (v: SheetView) => void; onClose: () => void; now: number }) {
  const j = !e.declined && !isOver(e, now) ? joinOf(e) : null;
  const people: string[] = e.people || [];
  const partners = people.map((em) => (day.google.partners || {})[em]).filter(Boolean);
  return (
    <>
      <div className="t2-h">
        <Mark p={e.provider} />
        <div><h3>{e.title}</h3><p>{e.allDay ? 'All day' : whenLine(e)}</p></div>
        <CloseBtn onClose={onClose} />
      </div>
      <dl className="t2-facts">
        <div><dt>Held on</dt><dd>{(e.source || 'Meeting') + (e.declined ? ', declined' : '')}</dd></div>
        <div><dt>With</dt><dd>{people.length ? plural(people.length, 'person', 'people') : 'Only you'}</dd></div>
        {partners.length ? (
          <div><dt>Partners</dt><dd className="t2-chips">{partners.map((p: J) => <NavLink key={p.id} className="r2t-chip r2t-chip--plain" href={'/work/partner/' + p.id} title="Partner page">{p.name}</NavLink>)}</dd></div>
        ) : null}
      </dl>
      <div className="t2-acts">
        {j ? <a className="h-btn h-btn--primary" data-t2-first href={j.href} target="_blank" rel="noopener">{j.label}</a> : null}
        {canMove(e, now) ? <button type="button" className={'h-btn ' + (j ? 'h-btn--ghost' : 'h-btn--primary')} {...(j ? {} : { 'data-t2-first': '' })} onClick={() => go({ mode: 'move', e })}>Move to FavorOS</button> : null}
      </div>
      {e.link ? <a className="t2-sec" href={e.link} target="_blank" rel="noopener">Open in Google Calendar</a> : null}
    </>
  );
}

function MoveSheet({ e, day, go, onClose }: { e: J; day: J; go: (v: SheetView) => void; onClose: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const g = day.google || {};
  const n = (e.people || []).length;
  const move = async () => {
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/hub/day-move', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'X-Hub-Request': '1' }, body: JSON.stringify({ eventId: e.id }) });
      const d = await res.json().catch(() => ({}));
      if (res.status === 409 && d.error === 'already' && d.id) { void qc.invalidateQueries({ queryKey: dayQ.queryKey }); onClose(); return; }
      if (!res.ok || d.ok === false) throw new Error(d.message || 'Could not move it. Try again.');
      void qc.invalidateQueries({ queryKey: dayQ.queryKey });
      go({ mode: 'moved', e: { ...e, hub: d.id, source: 'FavorOS', provider: 'favor' }, r: d });
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };
  return (
    <>
      <div className="t2-h"><div><h3>Move to FavorOS</h3><p>{e.title}</p></div><CloseBtn onClose={onClose} /></div>
      <ul className="t2-list">
        <li>{`Makes a FavorOS meeting on ${whenLine(e)}.`}</li>
        <li>{n ? `Invites the same ${plural(n, 'person', 'people')} in FavorOS. FavorOS sends no email.` : 'Only you are on it.'}</li>
        <li>It is not recorded. The host can change that in the meeting.</li>
        <li>{e.canEdit ? 'Your calendar event gets the FavorOS link in its location and at the top of its notes, and the old video link comes off.' : 'Your calendar event is not changed.'}</li>
      </ul>
      {!e.canEdit ? (
        <p className="t2-note">Someone else organizes this event, so Google does not let you change it. The FavorOS meeting is made and the calendar event keeps its video link. The organizer has to add the FavorOS link.</p>
      ) : !g.mayWrite ? (
        <>
          <p className="t2-note">To put the FavorOS link on the calendar event, FavorOS needs your permission to edit your calendar events.</p>
          <a className="h-btn h-btn--ghost h-btn--sm" href="/api/google/connect?add=meetings&next=%2F">Allow calendar edits</a>
        </>
      ) : null}
      <p className="t2-err" id="t2-err" role="alert" hidden={!err}>{err}</p>
      <div className="t2-acts">
        <button type="button" className="h-btn h-btn--primary" data-t2-first disabled={busy} onClick={() => void move()}>{busy ? 'Moving' : 'Move to FavorOS'}</button>
        <button type="button" className="h-btn h-btn--ghost" onClick={() => go({ mode: 'event', e })}>Back</button>
      </div>
    </>
  );
}

function MovedSheet({ e, r, onClose }: { e: J; r: J; onClose: () => void }) {
  return (
    <>
      <div className="t2-h"><div><h3>Moved to FavorOS</h3><p>{e.title}</p></div><CloseBtn onClose={onClose} /></div>
      <ul className="t2-list">
        <li>{whenLine(e) + '.'}</li>
        <li>{r.linked ? 'The FavorOS link is on your calendar event.' : r.created ? `A new event with the FavorOS link is on your calendar${r.invited ? `, and Google invited ${plural(r.invited, 'person', 'people')} to it` : ''}.` : 'No calendar has this meeting yet.'}</li>
        {r.created && r.organizer && r.organizer.email ? <li>{`The original event from ${r.organizer.name || r.organizer.email} is still on calendars. The organizer can delete it.`}</li> : null}
      </ul>
      {r.linkError ? <p className="t2-note">{r.linkError}</p> : null}
      <div className="t2-acts">
        <NavLink className="h-btn h-btn--primary" data-t2-first href={r.room}>Open the meeting</NavLink>
        <button type="button" className="h-btn h-btn--ghost" onClick={onClose}>Done</button>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- the card */
function EvRow({ e, day, now, open }: { e: J; day: J; now: number; open: (v: SheetView) => void }) {
  const live = isLive(e, now);
  const over = isOver(e, now);
  const partners = (day.google.partners || {}) as Record<string, J>;
  const people = ((e.people || []) as string[]).map((em) => partners[em]).filter(Boolean);
  const src = e.source || (PV[e.provider] && PV[e.provider][2]) || '';
  const j = !over ? joinOf(e) : null;
  const soon = j && (live || Date.parse(e.start) - now < 15 * 60000);
  return (
    <li className={'td-evr' + (live ? ' is-live' : '') + (over ? ' is-over' : '')}>
      {e.hub ? <NavLink className="td-row__hit" href={ROOM(e.hub)} aria-label={e.title} /> : <button type="button" className="td-row__hit" aria-haspopup="dialog" aria-label={e.title} onClick={() => open({ mode: 'event', e })} />}
      <span className="td-evr__time">{live ? 'Now' : e.allDay ? 'All day' : clock(e.start)}</span>
      <Mark p={e.provider} />
      <span className="td-evr__t">
        <b>{e.title}</b>
        <span>
          {src}
          {src && (people.length || (e.people || []).length) ? ' · ' : ''}
          {people.length ? people.slice(0, 2).map((p, i) => <span key={p.id}>{i ? ', ' : ''}<EntityChip kind="partner" id={p.id} label={p.name} /></span>) : (e.people || []).length ? plural(e.people.length, 'guest') : ''}
        </span>
      </span>
      <span className="td-row__a">
        {j && soon ? (
          <a className={'td-btn' + (live ? ' td-btn--primary' : '')} href={j.href} {...(j.inside ? {} : { target: '_blank', rel: 'noopener' })}>{j.label}</a>
        ) : canMove(e, now) ? (
          <button type="button" className="td-btn td-btn--quiet" onClick={() => open({ mode: 'move', e })}>Move to FavorOS</button>
        ) : null}
      </span>
    </li>
  );
}

function Body() {
  const now = useNow();
  const { data: day } = useSuspenseQuery(dayQ);
  const nav = useQuery(navQuery).data;
  const meetingsOff = !!nav && (nav.access as J)?.meetings === false;
  const up = useQuery({ ...upcomingQ, enabled: !meetingsOff }).data;
  const [view, setView] = useState<SheetView | null>(null);
  const [pastOpen, setPastOpen] = useState(false);
  const box = useRef<HTMLOListElement>(null);
  const card = useRef<HTMLElement | null>(null);
  const today = dayKey(now);
  const close = useCallback(() => setView(null), []);

  const list = day ? todaysEvents(day, today).sort((a, b) => (a.allDay ? -1 : 0) - (b.allDay ? -1 : 0) || Date.parse(a.start) - Date.parse(b.start)) : [];
  const past = list.filter((e) => isOver(e, now));
  const rest = list.filter((e) => !isOver(e, now));
  const g = (day && day.google) || {};
  const all: J[] = g.events || [];
  const soon: J[] = all.filter((e) => !e.declined && !e.allDay && dayKey(e.start) > today && Date.parse(e.start) - now < 8 * 864e5).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const next = (() => {
    if (!up) return null;
    const l = ((up.meetings || []) as J[]).filter((m) => m.status !== 'cancelled' && m.status !== 'ended' && m.startsAt && Date.parse(m.endsAt || m.startsAt) > now && Date.parse(m.startsAt) - now < 8 * 864e5 && dayKey(m.startsAt) !== today);
    l.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    return l[0] || null;
  })();
  if (next && !soon.some((e) => e.hub && e.hub === next.id)) soon.push({ title: next.title, start: next.startsAt, end: next.endsAt || next.startsAt, hub: next.id, provider: 'favor', source: 'FavorOS', prep: true, people: [] });
  soon.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const outside = list.filter((e) => canMove(e, now)).length;

  // The card is as tall as Needs you beside it: Coming up rows that would run past its bottom come off, the last first. The row is never
  // shorter than today's meetings need, so none of them is cut off when Needs you is short.
  const fit = useCallback(() => {
    const b = box.current;
    if (!b || getComputedStyle(b).overflow !== 'hidden') return;
    const c = b.closest<HTMLElement>('.td-sched');
    const main = b.closest<HTMLElement>('.td-main');
    if (c && main) {
      let need = 0;
      for (const el of Array.from(c.children) as HTMLElement[]) if (el !== b && !el.hidden) need += el.offsetHeight;
      for (const li of Array.from(b.children) as HTMLElement[]) if (!li.hasAttribute('data-soon')) need += li.offsetHeight;
      main.style.setProperty('--sched-min', Math.ceil(need + 2) + 'px');
    }
    b.querySelectorAll<HTMLElement>('[data-soon]').forEach((x) => { x.hidden = false; });
    const rows = Array.from(b.querySelectorAll<HTMLElement>('.td-evr[data-soon]'));
    while (rows.length && b.scrollHeight > b.clientHeight + 1) rows.pop()!.hidden = true;
    const head = b.querySelector<HTMLElement>('.td-evh[data-soon]');
    if (head) head.hidden = !b.querySelector('.td-evr[data-soon]:not([hidden])');
  }, []);
  useLayoutEffect(() => { fit(); });
  useEffect(() => {
    const n = box.current?.closest('.td-main')?.querySelector('.td-needs');
    if (!n || !window.ResizeObserver) return;
    let rt = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(rt); rt = requestAnimationFrame(fit); });
    ro.observe(n);
    return () => ro.disconnect();
  }, [fit]);
  void card;

  return (
    <>
      <ol className="td-evs" id="td-sched-list" ref={box}>
        {!day ? (
          <li className="td-empty">Your day could not load. Refresh to try again.</li>
        ) : (
          <>
            {past.length
              ? pastOpen || !rest.length
                ? past.map((e, i) => <EvRow key={e.id || 'p' + i} e={e} day={day} now={now} open={setView} />)
                : (
                  <li className="td-evr td-evr--earlier">
                    <button type="button" className="td-row__hit" aria-label="Show earlier meetings" onClick={() => setPastOpen(true)} />
                    <span className="td-evr__time">Earlier</span>
                    <span className="td-pv" aria-hidden="true"><Ic n="clock" /></span>
                    <span className="td-evr__t"><span>{plural(past.length, 'earlier meeting')}</span></span>
                  </li>
                )
              : null}
            {rest.map((e, i) => <EvRow key={e.id || 'r' + i} e={e} day={day} now={now} open={setView} />)}
            {!list.length ? <li className="td-empty">{g.events === null ? 'Your calendar could not be read just now.' : 'Nothing on your calendar today.'}</li> : !rest.length ? <li className="td-empty">No more meetings today.</li> : null}
            {soon.length ? (
              <>
                <li className="td-evh" data-soon="">Coming up</li>
                {soon.slice(0, 8).map((e, i) => (
                  <li className="td-evr td-evr--next" data-soon="" key={(e.hub || e.id || '') + i}>
                    <NavLink className="td-row__hit" href={e.hub ? (e.prep ? '/meet/prep/?m=' + encodeURIComponent(e.hub) : ROOM(e.hub)) : '/meet/'} aria-label={e.title} />
                    <span className="td-evr__time">{et(e.start, { weekday: 'short' })}<small>{clock(e.start)}</small></span>
                    <Mark p={e.provider} />
                    <span className="td-evr__t"><b>{e.title}</b><span>{e.source || (PV[e.provider] && PV[e.provider][2]) || ''}</span></span>
                  </li>
                ))}
              </>
            ) : null}
            {!g.connected ? (
              <li className="td-connect"><span>Connect Google to see your calendar here.</span><a className="td-btn" href="/api/google/connect">Connect my Google</a></li>
            ) : null}
          </>
        )}
      </ol>
      <p className="td-note" id="td-sched-f" hidden={!outside}>{outside ? `${plural(outside, 'meeting')} held outside FavorOS. Open one to move it.` : ''}</p>
      <GoogleNote />
      {view && day
        ? BodyPortal(
            <Sheet label={view.mode === 'move' ? 'Move to FavorOS' : view.mode === 'moved' ? 'Moved to FavorOS' : view.e.title} onClose={close}>
              {view.mode === 'event' ? <EventSheet e={view.e} day={day} go={setView} onClose={close} now={now} /> : view.mode === 'move' ? <MoveSheet e={view.e} day={day} go={setView} onClose={close} /> : <MovedSheet e={view.e} r={view.r} onClose={close} />}
            </Sheet>,
          )
        : null}
    </>
  );
}

const NOTES: Record<string, string> = { connected: 'Your meetings, files and mail now show here.', declined: 'Google was not connected.', 'wrong-account': 'Pick your Favor account when Google asks.', failed: 'Google did not connect. Try again.', expired: 'That took too long. Try again.', 'no-token': 'Google did not hand back access. Try again.' };
/** Where Google sent the person back to (?google=connected and the rest), said once and then taken off the address. */
function GoogleNote() {
  const [note, setNote] = useState('');
  useEffect(() => {
    const g = new URLSearchParams(location.search).get('google');
    if (g && NOTES[g]) {
      setNote(NOTES[g]);
      history.replaceState(null, '', '/');
    }
  }, []);
  return <p className="td-note" id="d-sub" hidden={!note}>{note}</p>;
}

export function ScheduleCard() {
  const { swr } = useShared();
  return (
    <section className="h-card td-card td-sched" id="td-sched" data-td="meetings" aria-labelledby="td-sched-h" data-keep-h="td-sched">
      <CardHead id="td-sched-h" title="Schedule">
        <NavLink className="h-link td-ch__r" href="/meet/">Day view</NavLink>
      </CardHead>
      <ErrorBoundary label="The schedule could not load.">
        <Suspense key={swr ? 'swr' : 'page'} fallback={<ol className="td-evs" id="td-sched-list" aria-busy="true"><Skel n={4} /></ol>}>
          <Body />
        </Suspense>
      </ErrorBoundary>
    </section>
  );
}
