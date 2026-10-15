// The Meetings Day page's small drawn pieces (public/js/meet/day.js): provider marks, avatars, event blocks, live cards, note cards, agenda rows.
// Same classes and markup as the classic page. Each one is a pure function of what it is given.
import type { ReactNode } from 'react';
import { NavLink } from '@/shell/NavLink';
import * as MV from '../views';
import { initials } from '../ui';
import { PROV, PXH, count, dayKey, firstLine, hm, hue, nameOf, people, provName, type Ev } from './logic';

const I: Record<string, string> = {
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  doc: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/>',
  x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
};
/** The Day page's own icons (class dv-i). */
export function Ic({ n }: { n: string }) {
  return <svg className="dv-i" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: I[n] || '' }} />;
}

// Provider marks, drawn. Favor uses the hub icon.
const meetMark = (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <rect width="20" height="20" rx="5" fill="#1b9a5a" />
    <rect x="3.5" y="6.5" width="8" height="7" rx="1.8" fill="none" stroke="#fff" strokeWidth="1.6" />
    <path d="m12.5 9 4-2.3v6.6l-4-2.3z" fill="#fff" />
  </svg>
);
const MARK: Record<string, ReactNode> = {
  favor: <img src="/images/favor-icon.png" alt="" />,
  zoom: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect width="20" height="20" rx="5" fill="#2d8cff" />
      <rect x="3.5" y="6.5" width="8" height="7" rx="1.8" fill="#fff" />
      <path d="m12.5 9 4-2.3v6.6l-4-2.3z" fill="#fff" />
    </svg>
  ),
  meet: meetMark,
  teams: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect width="20" height="20" rx="5" fill="#5059c9" />
      <path d="M5.5 6.8h9M10 6.8v7.4" stroke="#fff" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  ),
  webex: meetMark,
};
export function Pv({ k }: { k: string }) {
  return (
    <span className={'dv-pv dv-pv--' + (k === 'favor' ? 'favor' : 'x')} title={PROV[k] || k}>
      {MARK[k] || MARK.favor}
    </span>
  );
}

export function Av({ n }: { n: string }) {
  return (
    <span className="dv-av" data-h={hue(n)} title={n}>
      {initials(n)}
    </span>
  );
}
export function Avs({ names, max = 4 }: { names: string[]; max?: number }) {
  const list = names.filter(Boolean);
  return (
    <span className="dv-avs">
      {list.slice(0, max).map((n, i) => (
        <Av key={i} n={n} />
      ))}
      {list.length > max ? (
        <span className="dv-av" data-h="x">
          {'+' + (list.length - max)}
        </span>
      ) : null}
    </span>
  );
}

const Live = () => (
  <span className="dv-live">
    <i></i>Live
  </span>
);

// Editable events can be dragged and resized; the others show a not-allowed cursor.
export const edc = (e: Ev): string => (e.edit ? ' is-edit' : ' is-lock');
const Rsh = ({ e }: { e: Ev }) => (e.edit ? <i className="dv-rs" aria-hidden="true"></i> : null);

export interface Draft {
  start: number;
  end: number;
  editing: boolean;
  busy?: boolean;
}
export function DraftEv({ d, left, width, top }: { d: Draft; left: string; width: string; top: number }) {
  const h = Math.max(20, ((d.end - d.start) / 3600000) * PXH - 3);
  return (
    <div className="dv-ev dv-new" data-p="favor" data-ev="draft" style={{ top: top + 'px', height: h + 'px', left, width }}>
      <span className="dv-ev__t">{hm(d.start) + ' to ' + hm(d.end)}</span>
      {d.editing ? <input className="dv-new__in" type="text" maxLength={140} placeholder="Add title" aria-label="Title of the new meeting" autoComplete="off" disabled={!!d.busy} /> : null}
    </div>
  );
}

export function DayEvent({ e, t0, open }: { e: Ev; t0: number; open: string }) {
  const h = (((e.vend || e.end) - e.start) / 3600000) * PXH - 3;
  const compact = h < 50;
  const tall = h >= 76;
  const top = ((e.start - t0) / 3600000) * PXH + 1;
  if (e.stack !== undefined) {
    const rt = ((e.stackTop as number) - t0) / 3600000 * PXH + 1 + e.stack * (e.pitch as number);
    const rc = 'dv-ev is-row' + edc(e) + (e.live ? ' is-live' : '') + (e.past ? ' is-past' : '') + (open === e.id ? ' is-sel' : '');
    return (
      <button type="button" className={rc} data-p={e.p} data-ev={e.id} aria-pressed={open === e.id} aria-label={e.title + ', ' + hm(e.start) + ', ' + (PROV[e.p] || e.p)} style={{ top: rt + 'px', height: (e.pitch as number) - 4 + 'px', left: '70px', width: 'calc(100% - 76px)' }}>
        <span className="dv-ev__t">
          <Pv k={e.p} />
          {e.live ? <Live /> : hm(e.start)}
          {e.capEnd ? <span className="dv-cont">continues</span> : null}
        </span>
        <h4 title={e.title}>{e.title}</h4>
      </button>
    );
  }
  const c = 'dv-ev' + edc(e) + (e.live ? ' is-live' : '') + (e.past ? ' is-past' : '') + (compact ? ' is-compact' : '') + (open === e.id ? ' is-sel' : '');
  const lanes = e.lanes as number;
  const lane = e.lane as number;
  return (
    <button
      type="button"
      className={c}
      data-p={e.p}
      data-ev={e.id}
      aria-pressed={open === e.id}
      aria-label={e.title + ', ' + hm(e.start) + ' to ' + hm(e.end) + ', ' + (PROV[e.p] || e.p)}
      style={{ top: top + 'px', height: h + 'px', left: 'calc(70px + (100% - 76px) * ' + lane / lanes + ')', width: 'calc((100% - 76px) / ' + lanes + ' - 6px)' }}
    >
      <span className="dv-ev__t">
        <Pv k={e.p} />
        {e.live ? <Live /> : hm(e.start)}
        {e.capEnd ? (
          <span className="dv-cont" title={'Ends ' + hm(e.end) + ' the next day'}>
            continues
          </span>
        ) : null}
        {compact ? null : <Avs names={e.who} max={lanes > 1 ? 2 : 4} />}
      </span>
      <h4>{e.title}</h4>
      {tall ? (
        <span className="dv-ev__f">
          <span>{e.live && e.inRoom ? Number(e.inRoom).toLocaleString('en-US') + ' in the room' : people(e.count)}</span>
          {e.noteId ? (
            <span className="dv-chip dv-chip--plain">
              <Ic n="doc" />
              Notes
            </span>
          ) : null}
        </span>
      ) : null}
      <Rsh e={e} />
    </button>
  );
}

export function WeekEvent({ e, t0, open }: { e: Ev; t0: number; open: string }) {
  if (e.stack !== undefined) {
    const rt = ((e.stackTop as number) - t0) / 3600000 * PXH + 1 + e.stack * (e.pitch as number);
    return (
      <button
        type="button"
        className={'dv-ev is-row is-wk' + edc(e) + (e.live ? ' is-live' : '') + (e.past ? ' is-past' : '') + (open === e.id ? ' is-sel' : '')}
        data-p={e.p}
        data-ev={e.id}
        aria-label={e.title + ', ' + hm(e.start) + ', ' + provName(e.p)}
        style={{ top: rt + 'px', height: (e.pitch as number) - 4 + 'px', left: '2px', width: 'calc(100% - 4px)' }}
      >
        <span className="dv-ev__t">{e.live ? <Live /> : hm(e.start)}</span>
        <h4 title={e.title}>{e.title}</h4>
      </button>
    );
  }
  const h = (((e.vend || e.end) - e.start) / 3600000) * PXH - 3;
  const top = ((e.start - t0) / 3600000) * PXH + 1;
  const c = 'dv-ev is-wk' + edc(e) + (e.live ? ' is-live' : '') + (e.past ? ' is-past' : '') + (h < 50 ? ' is-compact' : '') + (open === e.id ? ' is-sel' : '');
  const lanes = e.lanes as number;
  const lane = e.lane as number;
  return (
    <button
      type="button"
      className={c}
      data-p={e.p}
      data-ev={e.id}
      aria-label={e.title + ', ' + hm(e.start) + ' to ' + hm(e.end) + ', ' + provName(e.p)}
      style={{ top: top + 'px', height: h + 'px', left: 'calc(100% * ' + lane / lanes + ' + 2px)', width: 'calc(100% / ' + lanes + ' - 4px)' }}
    >
      <span className="dv-ev__t">
        <Pv k={e.p} />
        {e.live ? <Live /> : hm(e.start)}
      </span>
      <h4 title={e.title}>{e.title}</h4>
      <Rsh e={e} />
    </button>
  );
}

export function LiveCard({ e }: { e: Ev }) {
  const ext = !!e.cal;
  const url = ext ? e.cal.joinUrl : '/meet/room/?m=' + e.id;
  const until = e.hub && !e.hub.endsAt ? '' : ', until ' + hm(e.end);
  const room = ext ? people(e.count) : e.inRoom ? Number(e.inRoom).toLocaleString('en-US') + ' in the room' : 'Open now';
  const rec = e.rec === 'video' ? 'Notes and video on' : e.rec === 'notes' ? 'Notes on' : 'Not recorded';
  return (
    <article className="dv-lv">
      <div className="dv-lv__top">
        <Pv k={e.p} />
        <Live />
        <span>{(PROV[e.p] || e.p) + until}</span>
      </div>
      <h3>{e.title}</h3>
      <div className="dv-lv__meta">
        <Avs names={e.who} max={4} />
        <span>{room}</span>
        <span className="dv-lv__chip">
          {e.rec === 'notes' || e.rec === 'video' ? <Ic n="mic" /> : null}
          {rec}
        </span>
      </div>
      <a className="dv-btn dv-btn--onlive" href={url} target={ext ? '_blank' : undefined} rel={ext ? 'noopener' : undefined}>
        <Ic n={ext ? 'arrow' : 'video'} />
        Join
      </a>
    </article>
  );
}

export function NoteCard({ m, now, sel, ppl }: { m: any; now: Date; sel: string | null; ppl: Record<string, string> }) {
  const when = m.endedAt || m.startedAt || m.startsAt || m.createdAt;
  const d = new Date(when || NaN);
  const ok = !isNaN(d.getTime());
  const today = ok && dayKey(d) === dayKey(now);
  const label = !ok
    ? 'No date on file'
    : today
      ? 'Today, ' + hm(d)
      : d.toLocaleDateString('en-US', Object.assign({ weekday: 'short', month: 'short', day: 'numeric' } as Intl.DateTimeFormatOptions, d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }));
  const names = [m.hostName].concat((m.invitees || []).map((i: any) => nameOf(i, ppl))).filter(Boolean);
  const line = firstLine(m.summary);
  return (
    <NavLink className={'dv-nt' + (sel === m.id ? ' is-sel' : '')} href={'/meet/notes/?m=' + m.id} data-note={m.id}>
      <div className="dv-nt__top">
        <Pv k="favor" />
        <span>{label}</span>
      </div>
      <h3>{String(m.title || '').trim() || 'Meeting'}</h3>
      {line ? <p>{line}</p> : null}
      <div className="dv-nt__f">
        <span className="dv-chip dv-chip--teal">
          <Ic n="doc" />
          Transcript
        </span>
        {m.actionCount ? <span className="dv-chip">{m.actionCount + ' action' + (m.actionCount === 1 ? '' : 's')}</span> : null}
        <Avs names={names} max={3} />
      </div>
    </NavLink>
  );
}

export function Legend({ evs }: { evs: Ev[] }) {
  return (
    <div className="dv-legend">
      {['favor', 'zoom', 'meet', 'teams']
        .filter((k) => evs.some((e) => e.p === k))
        .map((k) => (
          <span key={k}>
            <Pv k={k} />
            {k === 'favor' ? 'FavorOS' : PROV[k]}
          </span>
        ))}
    </div>
  );
}

export function AgendaRow({ e }: { e: Ev }) {
  const meta = [e.live ? 'Live now' : '', provName(e.p), people(e.count)].filter(Boolean).join(' · ');
  return (
    <button type="button" className={'ag-row' + (e.past ? ' is-past' : '')} data-p={e.p} data-ev={e.id}>
      <span className="ag-t">{hm(e.start)}</span>
      <Pv k={e.p} />
      <span className="ag-m">
        <b>{e.title}</b>
        <small>{meta}</small>
      </span>
    </button>
  );
}
export function Agenda({ days, byDay, today }: { days: string[]; byDay: Record<string, Ev[]>; today: string }) {
  return (
    <div className="ag">
      {days.map((k) => {
        const list = byDay[k] || [];
        return (
          <section key={k} className={'ag-day' + (k === today ? ' is-today' : '')}>
            <button type="button" className="ag-h" data-goday={k}>
              <b>{MV.dayName(k, false) + ', ' + MV.monthName(k, false) + ' ' + MV.dayNum(k)}</b>
              {k === today ? <span className="ag-tag">Today</span> : null}
              <small>{list.length ? count(list.length) : 'No meetings'}</small>
            </button>
            {list.map((e) => (
              <AgendaRow key={e.id} e={e} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
