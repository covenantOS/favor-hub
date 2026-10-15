// Meetings, Day tab (/meet/): the chosen day's meetings on a timeline (80 px per hour), the live ones on top, the notes beside it, with Week
// and Month views. Native React port of src/pages/meet/index.astro and public/js/meet/day.js: the same markup, classes, stylesheets, calls,
// storage keys and keys. The page's model and behaviors are in ./ctl.ts (one mutable state object, like the classic page, drawn from React);
// the drawn pieces are in ./pieces.tsx and ./Panel.tsx. Nothing reads the browser while the server draws: the skeleton shows until the page is
// live, then the day appears (the Eastern-day math is deterministic, "now" is not).
import { useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import '@hub/styles/meet.css';
import '@hub/styles/qa2-meet.css';
import '@hub/styles/crit-meet.css';
import '@hub/styles/r2-meet.css';
import '@hub/styles/huddle.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import '@hub/styles/meet-auto.css';
import '@hub/styles/break-ui.css';
import '@hub/styles/meet-views.css';
import { NavLink } from '@/shell/NavLink';
import * as MV from '../views';
import { Icon, MeetToast, meetApi, useHydrated } from '../ui';
import { createCtl, mobile, say, type State } from './ctl';
import { PXH, count, dayKey, hm, hourLabel, lanes, longDay, wk, type Ev } from './logic';
import { Agenda, AgendaRow, DayEvent, DraftEv, Ic, Legend, LiveCard, NoteCard, WeekEvent, edc } from './pieces';
import { CloseBtn, DetailPanel, MovePanel, MovedPanel } from './Panel';

/** Draws children into the top bar's actions slot (#h-actions), which the top bar draws after the page. */
function TopActions({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | undefined;
    let n = 0;
    const find = () => {
      const el = document.getElementById('h-actions');
      if (el) {
        setSlot(el);
        return true;
      }
      return false;
    };
    if (!find()) t = setInterval(() => (find() || ++n > 100) && clearInterval(t), 100);
    return () => clearInterval(t);
  }, []);
  return slot ? createPortal(children, slot) : null;
}

// "Meeting, Oct 11, 3:40 PM" in Eastern time. The host's name already shows in the room.
function nowTitle(): string {
  const d = new Date();
  const day = d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
  const tm = d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  return ('Meeting, ' + day + ', ' + tm).replace(/[  ]/g, ' ');
}

// Start now makes the room and goes straight in (one press). It is invited only and records the way the person chose in Settings;
// inside, Ring or Send the link brings people in and the recording button changes what it records.
function StartNow() {
  const [busy, setBusy] = useState(false);
  const starting = useRef(false);
  const go = () => {
    if (starting.current) return;
    starting.current = true;
    setBusy(true);
    meetApi('meetings', { method: 'POST', body: { title: nowTitle(), access: 'invited' } })
      .then((r) => {
        const id = r.meeting.id;
        try {
          sessionStorage.setItem('meet.prejoin', JSON.stringify({ mid: id, at: Date.now(), mic: true, cam: true }));
        } catch {
          // the lobby shows
        }
        location.href = '/meet/room/?m=' + id + '&pj=1&back=' + encodeURIComponent(location.pathname + location.search);
      })
      .catch((err: Error) => {
        starting.current = false;
        setBusy(false);
        say(err.message);
      });
  };
  return (
    <button type="button" className="h-btn h-btn--ghost h-btn--sm" id="mt-now" aria-busy={busy ? 'true' : undefined} onClick={go}>
      <Icon n="video" />
      <span className="h-lbl">Start now</span>
    </button>
  );
}

const Skeleton = () => (
  <div id="mt-day" aria-busy="true">
    <div className="dv-card dv-skel"></div>
  </div>
);

interface Surf {
  S: State;
  byDay: Record<string, Ev[]>;
  today: string;
  all: Ev[];
}

function NotesAside({ S, notes }: { S: State; notes: any[] }) {
  return (
    <aside className="dv-notes" aria-label="Notes">
      <div className="dv-notes__in">
        <div className="dv-notes__h">
          <h2>Notes</h2>
          <span className="dv-chip">{notes.length}</span>
          <span className="dv-grow"></span>
          <NavLink className="dv-link" href="/meet/library/">
            Ask or search all notes <Ic n="arrow" />
          </NavLink>
        </div>
        <div className="dv-notes__list">
          {notes.length ? notes.map((m) => <NoteCard key={m.id} m={m} now={S.now} sel={S.sel} ppl={S.people} />) : <p className="dv-none">No notes yet</p>}
        </div>
      </div>
    </aside>
  );
}

function WeekView({ S, byDay, today, all }: Surf) {
  const days = MV.weekDays(S.day);
  if (mobile())
    return (
      <section className="dv-card dv-tl wk-agenda" aria-label="Week">
        <Agenda days={days} byDay={byDay} today={today} />
      </section>
    );
  let h0 = 8;
  let h1 = 18;
  days.forEach((k) => {
    const dayEnd = MV.etStart(MV.addDays(k, 1));
    (byDay[k] || []).forEach((e) => {
      e.capEnd = e.end > dayEnd ? dayEnd : 0;
      h0 = Math.min(h0, MV.etHM(e.start).h);
      const ed = Math.min(dayEnd, Math.max(e.end, e.start + 45 * 60000));
      const hh = MV.etHM(ed);
      h1 = Math.max(h1, ed >= dayEnd ? 24 : hh.h + (hh.m ? 1 : 0));
    });
  });
  if (h1 <= h0) h1 = h0 + 1;
  S.wkH0 = h0;
  let gridH = (h1 - h0) * PXH + 8;
  const lists: Record<string, Ev[]> = {};
  // Many meetings in the same stretch stack as one-line rows (see lanes), so the grid grows to hold them.
  days.forEach((k) => {
    const list = (byDay[k] || []).slice();
    const tk0 = MV.etStart(k) + h0 * 3600000;
    lanes(list);
    lists[k] = list;
    list.forEach((e) => {
      if (e.stack !== undefined) gridH = Math.max(gridH, (((e.stackTop as number) - tk0) / 3600000) * PXH + e.stack * (e.pitch as number) + (e.pitch as number) + 8);
    });
  });
  const hrs: ReactNode[] = [];
  for (let h = h0; h <= h1; h++)
    hrs.push(
      <div key={h} className="dv-hr" style={{ top: (h - h0) * PXH + 'px' }}>
        <span>{hourLabel(h)}</span>
      </div>
    );
  const cols = days.map((k) => {
    const list = lists[k];
    const tk = MV.etStart(k) + h0 * 3600000;
    const now = k === today && S.now.getTime() >= tk ? <div className="dv-now" style={{ top: ((S.now.getTime() - tk) / 3600000) * PXH + 'px' }}></div> : null;
    const dr = S.draft && S.draft.key === k ? <DraftEv d={S.draft} left="2px" width="calc(100% - 4px)" top={((S.draft.start - tk) / 3600000) * PXH + 1} /> : null;
    return (
      <div key={k} className={'wk-col' + (k === today ? ' is-today' : '')} data-col={k}>
        {list.map((e) => (
          <WeekEvent key={e.id} e={e} t0={tk} open={S.open} />
        ))}
        {dr}
        {now}
      </div>
    );
  });
  return (
    <section className="dv-card dv-tl wk" aria-label="Week">
      <div className="dv-tl__head">
        <h2>Week</h2>
        <Legend evs={all} />
      </div>
      <div className="wk-head">
        <span className="wk-gut"></span>
        {days.map((k) => (
          <button key={k} type="button" className={'wk-hd' + (k === today ? ' is-today' : '')} data-goday={k} aria-label={longDay(k) + ', ' + count((byDay[k] || []).length)}>
            <small>{MV.dayName(k, false)}</small>
            <b>{MV.dayNum(k)}</b>
          </button>
        ))}
      </div>
      <div className="dv-tl__scroll">
        <div className="dv-tl__grid wk-grid" style={{ height: gridH + 'px' }}>
          {hrs}
          <div className="wk-cols">{cols}</div>
        </div>
      </div>
    </section>
  );
}

function MonthView({ S, byDay, today, all }: Surf) {
  const grid = MV.monthGrid(S.day);
  const phone = mobile();
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const pick = S.pick || S.day;
  const body = grid.map((row) => (
    <div key={row[0].key} className="mo-row">
      {row.map((c) => {
        const list = byDay[c.key] || [];
        const cls = 'mo-cell' + (c.inMonth ? '' : ' is-out') + (c.key === today ? ' is-today' : '');
        if (phone)
          return (
            <button key={c.key} type="button" className={cls + (c.key === pick ? ' is-pick' : '')} data-pick={c.key} aria-label={longDay(c.key) + ', ' + count(list.length)}>
              <b>{MV.dayNum(c.key)}</b>
              <span className="mo-dots">
                {list.slice(0, 3).map((e) => (
                  <i key={e.id} data-p={e.p}></i>
                ))}
              </span>
            </button>
          );
        const ch = MV.chips(list, 3);
        return (
          <div key={c.key} className={cls} data-cell={c.key}>
            <button type="button" className="mo-num" data-goday={c.key} aria-label={longDay(c.key)}>
              {MV.dayNum(c.key)}
            </button>
            {ch.shown.map((e) => (
              <button key={e.id} type="button" className={'mo-chip' + edc(e) + (e.past ? ' is-past' : '')} data-p={e.p} data-ev={e.id} title={e.title}>
                <b>{hm(e.start).replace(' ', '').toLowerCase()}</b>
                <span>{e.title}</span>
              </button>
            ))}
            {ch.more ? (
              <button type="button" className="mo-more" data-goday={c.key}>
                {'+' + ch.more + ' more'}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  ));
  const pl = byDay[pick] || [];
  return (
    <section className="dv-card mo" aria-label="Month">
      <div className="dv-tl__head">
        <h2>Month</h2>
        <Legend evs={all} />
      </div>
      <div className="mo-dow">
        {names.map((n) => (
          <span key={n}>{n}</span>
        ))}
      </div>
      <div className="mo-grid">{body}</div>
      {phone ? (
        <div className="mo-pick">
          <div className="mo-pick__h">
            <b>{longDay(pick)}</b>
            <small>{pl.length ? count(pl.length) : 'No meetings'}</small>
            <button type="button" className="dv-btn dv-btn--line" data-goday={pick}>
              Open day
            </button>
          </div>
          {pl.length ? (
            <div className="ag">
              <section className="ag-day">
                {pl.map((e) => (
                  <AgendaRow key={e.id} e={e} />
                ))}
              </section>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
function DayBody() {
  const qc = useQueryClient();
  const rootRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [, force] = useReducer((x: number) => x + 1, 0);
  // Created once, after the page is live: it reads the copy of the lists and the calendar the last visit kept.
  const [ctl] = useState(() => createCtl({ qc, bump: force, root: () => rootRef.current, layer: () => layerRef.current }));
  useEffect(() => {
    const off = ctl.attach(rootRef.current as HTMLElement, layerRef.current as HTMLElement);
    ctl.start();
    return () => {
      ctl.stop();
      off();
    };
  }, [ctl]);
  useLayoutEffect(() => {
    ctl.afterRender();
  });

  const S = ctl.S;
  const sendReady = S.sendReady || !!(window as unknown as { FavorSend?: unknown }).FavorSend;
  let content: ReactNode;
  if (!S.data) content = S.err ? <div className="dv-card dv-err">{S.err}</div> : <div className="dv-card dv-skel"></div>;
  else {
    const d = S.data;
    const now = S.now;
    const today = dayKey(now);
    const all = ctl.derived().all;
    const byDay = ctl.derived().by;
    const view = S.view;
    const evs = byDay[S.day] || [];
    // The seven day strip starts today and moves only when the chosen day leaves it.
    if (!S.winStart) S.winStart = today;
    if (S.day < S.winStart) S.winStart = S.day;
    if (S.day > MV.addDays(S.winStart, 6)) S.winStart = MV.addDays(S.day, -6);
    const isToday = S.day === today;
    const dayLive = isToday ? all.filter((e) => e.live) : [];
    const cal = d.cal;
    const needConnect = cal && !cal.connected;
    const inView = MV.range(view, S.day);
    let total = 0;
    inView.forEach((k) => {
      if (view !== 'month' || k.slice(0, 7) === S.day.slice(0, 7)) total += (byDay[k] || []).length;
    });
    const sub = total ? count(total) + (view === 'day' && dayLive.length ? ', ' + dayLive.length + ' live now' : '') : 'No meetings';
    const unit = view;

    const strip: ReactNode[] = [];
    if (view === 'day')
      for (let i = 0; i < 7; i++) {
        const k = MV.addDays(S.winStart, i);
        const n = (byDay[k] || []).length;
        strip.push(
          <button key={k} type="button" className={'dv-day' + (k === S.day ? ' is-on' : '') + (k === today ? ' is-today' : '')} role="tab" aria-selected={k === S.day} aria-label={longDay(k) + ', ' + count(n)} data-day={k}>
            <small>{wk(k, 'short')}</small>
            <b>{MV.dayNum(k)}</b>
            <span>
              {Array.from({ length: Math.min(n, 3) }, (_, j) => (
                <i key={j}></i>
              ))}
            </span>
          </button>
        );
      }

    let notes: any[] = d.notes || [];
    if (view !== 'day') {
      const rk: Record<string, number> = {};
      inView.forEach((k) => {
        if (view !== 'month' || k.slice(0, 7) === S.day.slice(0, 7)) rk[k] = 1;
      });
      notes = notes.filter((m) => {
        const t = Date.parse(m.endedAt || m.startedAt || m.startsAt || m.createdAt || '');
        return !isNaN(t) && rk[dayKey(t)];
      });
    }
    const notesAside = <NotesAside S={S} notes={notes} />;
    let main: ReactNode;
    let list: Ev[] = evs;
    let t0 = 0;
    if (view === 'week') {
      main = (
        <div className="dv-cols">
          <WeekView S={S} byDay={byDay} today={today} all={all} />
          {notesAside}
        </div>
      );
      list = [];
      MV.weekDays(S.day).forEach((k2) => {
        list = list.concat(byDay[k2] || []);
      });
    } else if (view === 'month')
      main = (
        <div className="dv-cols">
          <MonthView S={S} byDay={byDay} today={today} all={all} />
          {notesAside}
        </div>
      );
    else {
      // A phone starts the timeline at the first meeting's hour and ends after the last, so no empty hours sit above the day.
      const phone = mobile();
      let h0 = phone && evs.length ? 23 : 8;
      let h1 = phone && evs.length ? 0 : 18;
      // A meeting that runs past midnight is drawn to the end of its day and marked "continues".
      const dayEnd = MV.etStart(MV.addDays(S.day, 1));
      evs.forEach((e) => {
        e.capEnd = e.end > dayEnd ? dayEnd : 0;
      });
      evs.forEach((e) => {
        h0 = Math.min(h0, MV.etHM(e.start).h);
        if (e.capEnd) {
          h1 = 24;
          return;
        }
        const ed = Math.min(dayEnd, Math.max(e.end, e.start + 45 * 60000));
        const hh = MV.etHM(ed);
        h1 = Math.max(h1, ed >= dayEnd ? 24 : hh.h + (hh.m ? 1 : 0));
      });
      if (h1 <= h0) h1 = h0 + 1;
      t0 = MV.etStart(S.day) + h0 * 3600000;
      S.t0 = t0;
      lanes(evs);
      let gridH = (h1 - h0) * PXH + 8;
      evs.forEach((e) => {
        if (e.stack !== undefined) gridH = Math.max(gridH, (((e.stackTop as number) - t0) / 3600000) * PXH + e.stack * (e.pitch as number) + (e.pitch as number) + 8);
      });
      const hrs: ReactNode[] = [];
      for (let h = h0; h <= h1; h++)
        hrs.push(
          <div key={h} className="dv-hr" style={{ top: (h - h0) * PXH + 'px' }}>
            <span>{hourLabel(h)}</span>
          </div>
        );
      const nowLine =
        isToday && now.getTime() >= t0 ? (
          <div className="dv-now" style={{ top: ((now.getTime() - t0) / 3600000) * PXH + 'px' }}>
            <span>{hm(now)}</span>
          </div>
        ) : null;
      const tlBody =
        evs.length || !mobile() ? (
          <div className="dv-tl__scroll">
            <div className="dv-tl__grid" style={{ height: gridH + 'px' }}>
              {hrs}
              {evs.map((e) => (
                <DayEvent key={e.id} e={e} t0={t0} open={S.open} />
              ))}
              {S.draft && S.draft.key === S.day ? <DraftEv d={S.draft} left="70px" width="calc(100% - 76px)" top={((S.draft.start - t0) / 3600000) * PXH + 1} /> : null}
              {nowLine}
            </div>
          </div>
        ) : (
          <div className="dv-empty">
            <span className="dv-tile">
              <Ic n="cal" />
            </span>
            <b>{isToday ? 'No meetings today' : 'No meetings on ' + wk(S.day)}</b>
            <NavLink className="dv-btn dv-btn--primary" href="/meet/book/">
              <Ic n="plus" />
              Book a meeting
            </NavLink>
          </div>
        );
      main = (
        <>
          {dayLive.length ? (
            <div className="dv-livewrap">
              {dayLive.map((e) => (
                <LiveCard key={e.id} e={e} />
              ))}
            </div>
          ) : null}
          <div className="dv-cols">
            <section className="dv-card dv-tl" aria-label="Timeline">
              <div className="dv-tl__head">
                <h2>Timeline</h2>
                <Legend evs={evs} />
              </div>
              {tlBody}
            </section>
            {notesAside}
          </div>
        </>
      );
    }
    S.scroll = { list, t0, inRange: inView.indexOf(today) >= 0, now: now.getTime() };
    const showToday = !(inView.indexOf(today) >= 0);
    content = (
      <div key={view} className={'dv dv--' + view}>
        <div className="dv-bar">
          <div className="dv-date">
            <h2>{MV.title(view, S.day)}</h2>
            <p>{sub}</p>
          </div>
          <div className="dv-nav">
            <button type="button" className="dv-ib" data-step="-1" aria-label={'Previous ' + unit}>
              <Ic n="left" />
            </button>
            <button type="button" className="dv-ib" data-step="1" aria-label={'Next ' + unit}>
              <Ic n="right" />
            </button>
            {showToday ? (
              <button type="button" className="dv-btn dv-btn--line" data-today="1">
                Today
              </button>
            ) : null}
          </div>
          <div className="mv-seg" role="tablist" aria-label="View">
            {(['day', 'week', 'month'] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={v === view} className={v === view ? 'is-on' : ''} data-view={v}>
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <div className="dv-grow"></div>
          {view === 'day' ? (
            <div className="dv-days" role="tablist" aria-label="Day">
              {strip}
            </div>
          ) : null}
        </div>
        {needConnect ? (
          <div className="dv-conn">
            <span>Google Calendar meetings are not connected.</span>
            <a className="dv-btn dv-btn--primary" href={'/api/google/connect?next=' + encodeURIComponent('/meet/')}>
              Connect my Google
            </a>
          </div>
        ) : null}
        {cal && cal.error ? (
          <div className="dv-conn">
            <span>{cal.error}</span>
          </div>
        ) : null}
        {main}
      </div>
    );
  }

  // The meeting panel: a layer on the page body, empty while nothing is open.
  const open = !!S.open;
  let inner: ReactNode = null;
  let label = 'Meeting';
  if (open) {
    const e = S.data ? ctl.findEv(S.open) : null;
    if (e) label = e.title;
    if (S.panel === 'moved' && S.moved) inner = <MovedPanel S={S} />;
    else if (!S.data || !e)
      inner = (
        <>
          <header className="mp-h">
            <div className="mp-h__t">
              <h3>Meeting</h3>
            </div>
            <CloseBtn />
          </header>
          <div className="mp-b">
            <p className="dv-none">{S.data && (S.missing === S.open || S.open.indexOf('c:') === 0) ? 'That meeting is not on your list.' : 'Loading'}</p>
          </div>
        </>
      );
    else inner = S.panel === 'move' && e.cal ? <MovePanel S={S} e={e} /> : <DetailPanel S={S} e={e} sendReady={sendReady} />;
  }
  return (
    <>
      <div id="mt-day" ref={rootRef} aria-busy={S.busy ? 'true' : undefined}>
        {content}
      </div>
      {createPortal(
        <div id="mp" ref={layerRef} className={'mp' + (open ? ' is-open' : '')}>
          {open ? (
            <>
              <div className="mp-scrim" data-mp="close"></div>
              <aside className="mp-sheet" role="dialog" aria-modal="true" aria-label={label}>
                {inner}
              </aside>
            </>
          ) : null}
        </div>,
        document.body
      )}
    </>
  );
}

export function DayNative() {
  const hydrated = useHydrated();
  // The alerts link (src/scripts/nudge.ts) goes above the day once it draws. Its room is held from the first frame, so the day never drops.
  // The link is set up on page load and on a classic page swap; arriving here inside the app asks it once more.
  useEffect(() => {
    try {
      if ('Notification' in window && Notification.permission === 'default' && !localStorage.getItem('meet.nudge.asked')) document.documentElement.classList.add('meet-ask');
    } catch {
      // storage off: no link
    }
    document.dispatchEvent(new CustomEvent('hub-swapped', { detail: { path: '/meet/' } }));
    return () => document.documentElement.classList.remove('meet-ask', 'meet-ask-on');
  }, []);
  return (
    <>
      <TopActions>
        <StartNow />
        <NavLink className="h-btn h-btn--primary h-btn--sm" href="/meet/book/">
          <Icon n="plus" />
          <span className="h-lbl">Book</span>
        </NavLink>
      </TopActions>
      {hydrated ? <DayBody /> : <Skeleton />}
      <MeetToast />
    </>
  );
}
