// The Meetings Day page's meeting panel (public/js/meet/day.js): the detail sheet, the Move to FavorOS sheet and the Moved sheet. Same classes,
// data-* hooks and words as the classic page; the clicks are read by the page (ctl.ts onPanelClick) from the data-* attributes.
import type { ReactNode } from 'react';
import { NavLink } from '@/shell/NavLink';
import type { State } from './ctl';
import { Av, Ic, Pv } from './pieces';
import { dayKey, firstLine, firstOf, hhmm, invited, nameOf, provName, recLabel, whenLine, type Ev } from './logic';

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="mp-row">
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
);
export const CloseBtn = () => (
  <button type="button" className="mp-x" data-mp="close" aria-label="Close">
    <Ic n="x" />
  </button>
);

function Head({ e, kicker }: { e: Ev; kicker?: string }) {
  if (e.edit) {
    return (
      <header className="mp-h">
        <Pv k={e.p} />
        <div className="mp-h__t">
          <small>{kicker || provName(e.p)}</small>
          <input className="mp-ed mp-ti" type="text" data-f="title" maxLength={140} defaultValue={e.title} aria-label="Title" autoComplete="off" />
        </div>
        <CloseBtn />
      </header>
    );
  }
  return (
    <header className="mp-h">
      <Pv k={e.p} />
      <div className="mp-h__t">
        <small>{(kicker || provName(e.p)) + (e.live ? ' · Live now' : e.past ? ' · Ended' : '')}</small>
        <h3>{e.title}</h3>
        <p>{whenLine(e)}</p>
      </div>
      <CloseBtn />
    </header>
  );
}

export function DetailPanel({ S, e, sendReady }: { S: State; e: Ev; sendReady: boolean }) {
  const acts: ReactNode[] = [];
  const foot: ReactNode[] = [];
  const rows: ReactNode[] = [];
  if (e.cal) {
    const c = e.cal;
    const over = e.past;
    if (!over)
      acts.push(
        <a key="join" className="dv-btn dv-btn--primary mp-first" href={c.joinUrl} target="_blank" rel="noopener">
          <Ic n="arrow" />
          {'Join on ' + provName(e.p)}
        </a>
      );
    if (!over)
      acts.push(
        <button key="move" type="button" className="dv-btn dv-btn--line" data-mp="move">
          Move to FavorOS
        </button>
      );
    rows.push(
      <Row key="held" label="Held on">
        {provName(e.p) + (over ? ', ended' : '')}
      </Row>
    );
    if (c.organizerName)
      rows.push(
        <Row key="org" label="Organizer">
          {c.organizerName}
        </Row>
      );
  } else {
    const m = e.hub;
    const rep = m.repeat && m.repeat !== 'none';
    const sid = m.seriesId || '';
    const scheduled = m.mine && m.startsAt && m.status === 'scheduled';
    if (m.status === 'ended') {
      if (e.noteId)
        acts.push(
          <NavLink key="notes" className="dv-btn dv-btn--primary mp-first" href={'/meet/notes/?m=' + m.id}>
            <Ic n="doc" />
            Notes
          </NavLink>
        );
    } else
      acts.push(
        <a key="room" className="dv-btn dv-btn--primary mp-first" href={'/meet/room/?m=' + m.id}>
          <Ic n="video" />
          {e.live || e.open ? 'Join' : 'Open'}
        </a>
      );
    if (m.status !== 'ended')
      acts.push(
        <NavLink key="prep" className="dv-btn dv-btn--line" href={'/meet/prep/?m=' + m.id}>
          <Ic n="doc" />
          Prep
        </NavLink>
      );
    if (sid)
      acts.push(
        <NavLink key="series" className="dv-btn dv-btn--line" href={'/meet/series/?id=' + sid}>
          Series
        </NavLink>
      );
    rows.push(
      <Row key="held" label="Held on">
        FavorOS
      </Row>
    );
    if (sid || rep)
      rows.push(
        <Row key="rep" label="Repeats">
          {sid ? <NavLink href={'/meet/series/?id=' + sid}>Part of a series</NavLink> : 'Yes'}
        </Row>
      );
    rows.push(
      <Row key="org" label="Organizer">
        {m.hostName || nameOf({ email: m.hostEmail }, S.people)}
      </Row>
    );
    if (m.status !== 'ended') {
      if (m.mine) {
        rows.push(
          <Row key="rec" label="Recording">
            <span className="mp-seg" role="group" aria-label="Recording">
              {[
                ['off', 'Off'],
                ['notes', 'Notes'],
                ['video', 'Notes and video'],
              ].map((r) => (
                <button key={r[0]} type="button" className={m.rec === r[0] ? 'is-on' : ''} aria-pressed={m.rec === r[0]} data-rec={r[0]}>
                  {r[1]}
                </button>
              ))}
            </span>
          </Row>
        );
      } else
        rows.push(
          <Row key="rec" label="Recording">
            {recLabel(m.rec)}
          </Row>
        );
    } else
      rows.push(
        <Row key="rec" label="Recording">
          {recLabel(m.rec)}
        </Row>
      );
    if (m.status !== 'ended' && sendReady)
      foot.push(
        <button key="send" type="button" className="dv-btn dv-btn--line" data-mp="send">
          {m.mine ? 'Send the link' : 'Send me the link'}
        </button>
      );
    foot.push(
      <button key="copy" type="button" className="dv-btn dv-btn--ghost" data-mp="copy">
        Copy link
      </button>
    );
    if (m.mine && S.info[m.id] && S.info[m.id].guests && m.status !== 'ended')
      foot.push(
        <button key="guest" type="button" className="dv-btn dv-btn--ghost" data-mp="guest">
          Copy guest link
        </button>
      );
    if (scheduled)
      foot.push(
        <NavLink key="edit" className="dv-btn dv-btn--ghost" href={'/meet/book/?edit=' + m.id}>
          {rep ? 'Move' : 'Edit'}
        </NavLink>
      );
    if (scheduled) {
      if (S.confirm === m.id) {
        foot.push(
          <span key="ask" className="mp-ask">
            {(rep ? 'Cancel which meetings?' : 'Cancel this meeting?') + ' Invitees get a cancellation.'}
          </span>
        );
        if (rep) {
          [
            ['this', 'This meeting'],
            ['following', 'This and following meetings'],
            ['all', 'All meetings'],
          ].forEach((o) =>
            foot.push(
              <button key={'yes-' + o[0]} type="button" className="dv-btn dv-btn--danger" data-yes={m.id} data-scope={o[0]}>
                {o[1]}
              </button>
            )
          );
        } else
          foot.push(
            <button key="yes" type="button" className="dv-btn dv-btn--danger" data-yes={m.id}>
              Yes, cancel
            </button>
          );
        foot.push(
          <button key="no" type="button" className="dv-btn dv-btn--ghost" data-no="1">
            Keep it
          </button>
        );
      } else
        foot.push(
          <button key="cancel" type="button" className="dv-btn dv-btn--danger" data-cancel={m.id}>
            Cancel meeting
          </button>
        );
    }
  }
  if (e.edit) {
    rows.push(
      <Row key="date" label="Date">
        <input className="mp-ed" type="date" data-f="date" defaultValue={dayKey(e.start)} aria-label="Date" />
      </Row>
    );
    rows.push(
      <Row key="time" label="Time">
        <span className="mp-time">
          <input className="mp-ed" type="time" step={300} data-f="start" defaultValue={hhmm(e.start)} aria-label="Start time" />
          <span>to</span>
          <input className="mp-ed" type="time" step={300} data-f="end" defaultValue={hhmm(e.end)} aria-label="End time" />
          <small>ET</small>
        </span>
      </Row>
    );
  }
  const inv = invited(e, S.people);
  rows.push(
    <Row key="inv" label="Invited">
      {inv.length ? (
        <ul className="mp-pl">
          {inv.map((p, i) => (
            <li key={i} className="mp-pp">
              <Av n={p.name} />
              <span>
                <b>{p.name}</b>
                {p.sub ? <small>{p.sub}</small> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        'Just the organizer'
      )}
    </Row>
  );
  if (e.edit)
    rows.push(
      <Row key="agenda" label="Agenda">
        <textarea className="mp-ed mp-ed--area" data-f="desc" rows={3} maxLength={2000} placeholder="Add an agenda" aria-label="Agenda" defaultValue={e.desc || ''} />
      </Row>
    );
  else if (e.desc)
    rows.push(
      <Row key="agenda" label="Agenda">
        <p className="mp-text">{e.desc}</p>
      </Row>
    );
  if (!e.cal) {
    const m2 = e.hub;
    const pr = S.prep[m2.id];
    let nt: ReactNode = null;
    if (m2.status === 'ended') {
      const line = firstLine(m2.summary);
      nt = (
        <>
          {line ? <p className="mp-text">{line}</p> : null}
          {e.noteId ? (
            <NavLink className="dv-link" href={'/meet/notes/?m=' + m2.id}>
              {'Notes and transcript' + (m2.actionCount ? ', ' + m2.actionCount + ' action' + (m2.actionCount === 1 ? '' : 's') : '') + ' '}
              <Ic n="arrow" />
            </NavLink>
          ) : null}
        </>
      );
    } else if (pr && pr.last) {
      const fl = firstLine(pr.last.summary);
      nt = (
        <>
          <p className="mp-text">
            Last time: <NavLink href={'/meet/notes/?m=' + pr.last.id}>{pr.last.title}</NavLink>
            {fl ? '. ' + fl : ''}
          </p>
          {pr.open ? <p className="mp-text">{pr.open + ' open item' + (pr.open === 1 ? '' : 's') + ' from past meetings with these people.'}</p> : null}
        </>
      );
    } else if (pr && pr.open) nt = <p className="mp-text">{pr.open + ' open item' + (pr.open === 1 ? '' : 's') + ' from past meetings with these people.'}</p>;
    if (m2.status === 'ended' ? (firstLine(m2.summary) || e.noteId) : nt)
      rows.push(
        <Row key="prep" label={m2.status === 'ended' ? 'Notes' : 'Prep'}>
          {nt}
        </Row>
      );
  }
  return (
    <>
      <Head e={e} />
      <div className="mp-b">
        <div className="mp-acts">{acts}</div>
        <dl className="mp-rows">{rows}</dl>
      </div>
      {foot.length ? <footer className="mp-f">{foot}</footer> : null}
    </>
  );
}

export function MovePanel({ S, e }: { S: State; e: Ev }) {
  const s = S.move || e;
  const n = invited(s, S.people).length;
  const c = s.cal;
  const may = !!(S.data && S.data.cal && S.data.cal.canWrite);
  const held = provName(s.p);
  const all = !!(c.recurring && S.moveSeries);
  const stays = all
    ? c.canEdit
      ? 'The series on your calendar gets the FavorOS link in place of the ' + held + ' link, for every meeting.'
      : 'A new repeating event with the FavorOS link goes on your calendar from this meeting on, and Google invites the same people to it.'
    : c.canEdit
      ? 'Your calendar event gets the FavorOS link in its location and at the top of its notes, and the ' + held + ' link comes off.'
      : 'A new event with the FavorOS link goes on your calendar, and Google invites the same people to it.';
  return (
    <>
      <header className="mp-h">
        <div className="mp-h__t">
          <h3>Move to FavorOS</h3>
          <p>{s.title}</p>
        </div>
        <CloseBtn />
      </header>
      <div className="mp-b">
        <ul className="mp-list">
          <li>{all ? 'Moves the whole series to FavorOS, starting with ' + whenLine(s) + '. Every meeting keeps its time.' : 'Makes a FavorOS meeting on ' + whenLine(s) + '.'}</li>
          <li>{n ? 'Invites the same ' + n + (n === 1 ? ' person' : ' people') + ' in FavorOS. ' + (S.moveMail ? 'FavorOS emails them the link.' : 'FavorOS sends no email.') : 'Only you are on it.'}</li>
          <li>It is not recorded. The host can change that in the meeting.</li>
          <li id="mp-stays">{stays}</li>
        </ul>
        {!c.canEdit ? (
          <p className="mp-note">{(c.organizerName || 'Someone else') + ' organizes the original event, so Google does not let you change it. It stays on calendars with its ' + held + ' link until the organizer deletes it. After the move you can email the organizer.'}</p>
        ) : null}
        {c.recurring ? (
          <label className="mp-check">
            <input type="checkbox" data-mp="series" defaultChecked={S.moveSeries} />
            <span>Move every meeting in this series</span>
          </label>
        ) : null}
        {!may ? (
          <>
            <p className="mp-note">To put the FavorOS link on the calendar event, FavorOS needs your permission to edit your calendar events.</p>
            <a className="dv-btn dv-btn--line" href="/api/google/connect?add=meetings&next=%2Fmeet%2F">
              Allow calendar edits
            </a>
          </>
        ) : null}
        {n > 0 ? (
          <label className="mp-check">
            <input type="checkbox" data-mp="mail" defaultChecked={S.moveMail} />
            <span>{n === 1 ? 'Email ' + firstOf(invited(s, S.people)[0].email) + ' the FavorOS link' : 'Email the ' + n + ' people the FavorOS link'}</span>
          </label>
        ) : null}
        {S.moveErr ? (
          <p className="mp-err" role="alert">
            {S.moveErr}
          </p>
        ) : null}
        <div className="mp-acts mp-acts--end">
          <button type="button" className="dv-btn dv-btn--primary mp-first" data-mp="domove" disabled={S.moveBusy || !may}>
            {S.moveBusy ? 'Moving' : 'Move to FavorOS'}
          </button>
          <button type="button" className="dv-btn dv-btn--ghost" data-mp="back">
            Back
          </button>
        </div>
      </div>
    </>
  );
}

export function MovedPanel({ S }: { S: State }) {
  const s = S.moved;
  const org = s.created && s.organizer && s.organizer.email;
  return (
    <>
      <header className="mp-h">
        <div className="mp-h__t">
          <h3>Moved to FavorOS</h3>
          <p>{s.title}</p>
        </div>
        <CloseBtn />
      </header>
      <div className="mp-b">
        <ul className="mp-list">
          <li>{s.when + '.'}</li>
          <li>
            {s.linked
              ? 'The FavorOS link is on your calendar event.'
              : s.created
                ? 'A new event with the FavorOS link is on your calendar' + (s.invited ? ', and Google invited ' + s.invited + (s.invited === 1 ? ' person' : ' people') + ' to it' : '') + '.'
                : 'No calendar has this meeting yet.'}
          </li>
          {org ? <li>{'The original event from ' + (s.organizer.name || s.organizer.email) + ' is still on calendars. The organizer can delete it.'}</li> : null}
          {s.emailed ? <li>{'Emailed the link to ' + s.emailed + (s.emailed === 1 ? ' person' : ' people') + '.'}</li> : null}
          {s.emailFailed ? <li>{s.emailFailed + (s.emailFailed === 1 ? ' email' : ' emails') + ' did not go out. Share the room link with them.'}</li> : null}
        </ul>
        {s.linkError ? (
          <p className="mp-err" role="alert">
            {s.linkError}
          </p>
        ) : null}
        {org ? (
          <p className="mp-note" aria-live="polite">
            {s.told ? (
              s.told
            ) : (
              <button type="button" className="dv-btn dv-btn--line" data-mp="tellorg" disabled={!!s.telling}>
                {'Email ' + (s.organizer.name || s.organizer.email) + ' about the move'}
              </button>
            )}
          </p>
        ) : null}
        <div className="mp-acts mp-acts--end">
          {s.series && s.seriesId ? (
            <NavLink className="dv-btn dv-btn--line" href={'/meet/series/?id=' + s.seriesId}>
              Open the series
            </NavLink>
          ) : null}
          <a className="dv-btn dv-btn--primary mp-first" href={s.room}>
            Open the meeting
          </a>
          <button type="button" className="dv-btn dv-btn--ghost" data-mp="close">
            Done
          </button>
        </div>
      </div>
    </>
  );
}
