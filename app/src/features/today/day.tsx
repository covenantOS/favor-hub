import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { send } from '@/lib/api';
import { ago, clock, dayShort, et, hue, initials, phoneHref, todayEt } from '@/lib/format';
import { hubOv } from '@/lib/hubOv';
import { loadScript } from '@/lib/legacy';
import { keys } from '@/lib/query';
import { KEYS, readJson } from '@/lib/storage';
import { dayMoveResponse, type DayEvent, type DayFile, type DayMail, type DayResponse } from '@shared/schemas';
import { EntityChip } from '@/features/entity/EntityChip';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { NavLink } from '@/shell/NavLink';
import { PathIcon } from '@/shell/Icon';
import { SnoozeButton } from './sections';

const room = (id: string) => '/meet/room/?m=' + encodeURIComponent(id);

/** A small mark per meeting provider: simple drawn stand-ins. */
const PV: Record<string, [string, string, string]> = {
  favor: ['pv-favor', '<path d="M12 4c3 3 5 5 5 8a5 5 0 0 1-10 0c0-3 2-5 5-8z"/>', 'FavorOS'],
  zoom: ['pv-zoom', '<rect x="4" y="7" width="10" height="10" rx="2"/><path d="m14 11 6-3v8l-6-3"/>', 'Zoom'],
  meet: ['pv-meet', '<rect x="4" y="7" width="10" height="10" rx="2"/><path d="m14 11 6-3v8l-6-3"/>', 'Google Meet'],
  teams: ['pv-teams', '<path d="M6 8h12"/><path d="M12 8v9"/>', 'Microsoft Teams'],
  webex: ['pv-webex', '<circle cx="12" cy="12" r="5"/>', 'Webex'],
  phone: ['pv-none', '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>', 'Phone call'],
};

function Mark({ provider }: { provider: string }) {
  const m = PV[provider];
  if (m)
    return (
      <span className={'r2t-pv ' + m[0]} title={m[2]}>
        <PathIcon d={m[1]} className="" />
      </span>
    );
  return (
    <span className="r2t-pv pv-none">
      <PathIcon d='<rect x="5" y="6" width="14" height="13" rx="2"/><path d="M5 10h14"/>' className="" />
    </span>
  );
}

const isLive = (e: DayEvent) => !e.allDay && Date.now() >= new Date(e.start).getTime() && Date.now() < new Date(e.end).getTime();
const isOver = (e: DayEvent) => !e.allDay && Date.now() >= new Date(e.end).getTime();
const joinOf = (e: DayEvent) => (e.hub ? { href: room(e.hub), label: 'Join', inside: true } : e.meet ? { href: e.meet, label: 'Join', inside: false } : e.phone ? { href: phoneHref(e.phone), label: 'Call', inside: false } : null);
const canMove = (e: DayEvent) => !e.hub && !!e.id && !e.allDay && !e.declined && !isOver(e) && e.provider !== 'favor';
const whenLine = (e: DayEvent) => et(e.start, { weekday: 'long', month: 'short', day: 'numeric' }) + ', ' + clock(e.start) + ' to ' + clock(e.end) + ' ET';

type Day = DayResponse;
type Partners = NonNullable<Day['google']['partners']>;

const Empty = ({ t }: { t: string }) => <p className="r2t-empty">{t}</p>;

function Card({ title, meta, extra, children, td }: { title: string; meta?: ReactNode; extra?: ReactNode; children: ReactNode; td?: string }) {
  return (
    <div className="h-card r2t-card" data-td={td}>
      <div className="r2t-ch">
        <h3>
          {title}
          {extra}
        </h3>
        <span>{meta}</span>
      </div>
      {children}
    </div>
  );
}

/** The meeting that is on now, at the top right of the greeting. */
export function LivePill({ events }: { events: DayEvent[] | null | undefined }) {
  const e = (events || []).find((x) => isLive(x) && !x.declined);
  const j = e && joinOf(e);
  if (!e) return null;
  return (
    <div className="r2t-now">
      <span className="r2t-pv pv-favor-on">{PV[e.provider] ? <PathIcon d={PV[e.provider][1]} className="" /> : null}</span>
      <span>
        {e.title}
        <small>Live, until {clock(e.end)}</small>
      </span>
      {j && (
        <a className="r2t-join" href={j.href} {...(j.inside ? {} : { target: '_blank', rel: 'noopener' })}>
          Join
        </a>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ a sheet: one at a time, over the page */

type Sheet = { type: 'event'; id: string } | { type: 'move'; id: string } | { type: 'moved'; id: string; room: string; linked: boolean; linkError?: string; emailed?: number; emailFailed?: number } | null;

function SheetLayer({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const [on, setOn] = useState(false);
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => {
      setOn(true);
      const f = el.current?.querySelector<HTMLElement>('[data-t2-first]');
      if (f && !matchMedia('(pointer: coarse)').matches) f.focus({ preventScroll: true });
    });
    const tok = hubOv.on(onClose);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !el.current) return;
      const f = Array.from(el.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])')).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
        e.preventDefault();
        f[0].focus();
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      cancelAnimationFrame(raf);
      hubOv.off(tok);
      document.removeEventListener('keydown', key, true);
      if (returnTo && document.contains(returnTo)) returnTo.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createPortal(
    <div className={'t2-layer' + (on ? ' is-in' : '')} ref={el}>
      <div className="t2-scrim" onClick={onClose} />
      <div className="t2-sheet" role="dialog" aria-modal="true" aria-label={label}>
        <div className="t2-grab" aria-hidden="true" />
        {children}
      </div>
    </div>,
    document.body
  );
}

const CloseBtn = ({ onClose }: { onClose: () => void }) => (
  <button type="button" className="t2-x" aria-label="Close" onClick={onClose}>
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  </button>
);

function EventSheet({ e, partners, onClose, onMove }: { e: DayEvent; partners: Partners; onClose: () => void; onMove: () => void }) {
  const j = !e.declined && !isOver(e) ? joinOf(e) : null;
  const n = e.people.length;
  const ps = e.people.map((p) => partners[p]).filter(Boolean);
  return (
    <SheetLayer label={e.title} onClose={onClose}>
      <div className="t2-h">
        <Mark provider={e.provider} />
        <div>
          <h3>{e.title}</h3>
          <p>{e.allDay ? 'All day' : whenLine(e)}</p>
        </div>
        <CloseBtn onClose={onClose} />
      </div>
      <dl className="t2-facts">
        <div>
          <dt>Held on</dt>
          <dd>
            {e.source || 'Meeting'}
            {e.declined ? ', declined' : ''}
          </dd>
        </div>
        <div>
          <dt>With</dt>
          <dd>{n ? `${n} ${n === 1 ? 'person' : 'people'}` : 'Just you'}</dd>
        </div>
        {ps.length > 0 && (
          <div>
            <dt>Partners</dt>
            <dd className="t2-chips">
              {ps.map((p) => (
                <EntityChip key={p.id} kind="partner" id={p.id} label={p.name} />
              ))}
            </dd>
          </div>
        )}
      </dl>
      <div className="t2-acts">
        {j && (
          <a className="h-btn h-btn--primary" data-t2-first href={j.href} target="_blank" rel="noopener">
            {j.label}
          </a>
        )}
        {canMove(e) && (
          <button type="button" className={'h-btn ' + (j ? 'h-btn--ghost' : 'h-btn--primary')} {...(j ? {} : { 'data-t2-first': true })} onClick={onMove}>
            Move to FavorOS
          </button>
        )}
      </div>
      {e.link && (
        <a className="t2-sec" href={e.link} target="_blank" rel="noopener">
          Open in Google Calendar
        </a>
      )}
    </SheetLayer>
  );
}

/** "katharine@favorintl.org" becomes Katharine; an address that does not read as a first name becomes "them". */
const firstOf = (email: string) => {
  const w = email.split('@')[0]!.split(/[._-]/)[0]!;
  return /^[a-z]{3,}$/i.test(w) ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : 'them';
};

function MoveSheet({ e, mayWrite, onClose, onBack, onDone }: { e: DayEvent; mayWrite: boolean; onClose: () => void; onBack: () => void; onDone: (r: { id: string; room: string; linked: boolean; linkError?: string; already?: boolean; emailed?: number; emailFailed?: number }) => void }) {
  const [mail, setMail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const n = e.people.length;
  const go = async () => {
    setBusy(true);
    setErr('');
    try {
      const res = await send('/api/hub/day-move', { eventId: e.id, emailInvitees: n > 0 && mail });
      const d = dayMoveResponse.parse(res);
      onDone({ id: d.id, room: d.room, linked: !!d.linked, linkError: d.linkError, emailed: d.emailed, emailFailed: d.emailFailed });
    } catch (x) {
      const er = x as Error & { status?: number; code?: string };
      if (er.status === 409 && er.code === 'already') {
        onDone({ id: '', room: '', linked: false, already: true });
        return;
      }
      setErr(er.message || 'Could not move it. Try again.');
      setBusy(false);
    }
  };
  return (
    <SheetLayer label="Move to FavorOS" onClose={onClose}>
      <div className="t2-h">
        <div>
          <h3>Move to FavorOS</h3>
          <p>{e.title}</p>
        </div>
        <CloseBtn onClose={onClose} />
      </div>
      <ul className="t2-list">
        <li>Makes a FavorOS meeting on {whenLine(e)}.</li>
        <li>{n ? `Invites the same ${n} ${n === 1 ? 'person' : 'people'} in FavorOS. ${mail ? 'FavorOS emails them the link.' : 'FavorOS sends no email.'}` : 'Only you are on it.'}</li>
        <li>It is not recorded. The host can change that in the meeting.</li>
        <li id="t2-stays">{e.canEdit ? 'Your calendar event gets the FavorOS link in its location and at the top of its notes, and the old video link comes off.' : 'Your calendar event is not changed.'}</li>
      </ul>
      {n > 0 && (
        <label className="t2-check">
          <input type="checkbox" checked={mail} onChange={(ev) => setMail(ev.target.checked)} />
          <span>{n === 1 ? `Email ${firstOf(e.people[0] || '')} the FavorOS link` : `Email the ${n} people the FavorOS link`}</span>
        </label>
      )}
      {!e.canEdit ? (
        <p className="t2-note">Someone else organizes this event, so Google does not let you change it. The FavorOS meeting is made and the calendar event keeps its video link. The organizer has to add the FavorOS link.</p>
      ) : !mayWrite ? (
        <>
          <p className="t2-note">To put the FavorOS link on the calendar event, FavorOS needs your permission to edit your calendar events.</p>
          <a className="h-btn h-btn--ghost h-btn--sm" href="/api/google/connect?add=meetings&next=%2F">
            Allow calendar edits
          </a>
        </>
      ) : null}
      {err && (
        <p className="t2-err" role="alert">
          {err}
        </p>
      )}
      <div className="t2-acts">
        <button type="button" className="h-btn h-btn--primary" data-t2-first disabled={busy} onClick={() => void go()}>
          {busy ? 'Moving' : 'Move to FavorOS'}
        </button>
        <button type="button" className="h-btn h-btn--ghost" onClick={onBack}>
          Back
        </button>
      </div>
    </SheetLayer>
  );
}

function MovedSheet({ e, s, onClose }: { e: DayEvent; s: { room: string; linked: boolean; linkError?: string; emailed?: number; emailFailed?: number }; onClose: () => void }) {
  return (
    <SheetLayer label="Moved to FavorOS" onClose={onClose}>
      <div className="t2-h">
        <div>
          <h3>Moved to FavorOS</h3>
          <p>{e.title}</p>
        </div>
        <CloseBtn onClose={onClose} />
      </div>
      <ul className="t2-list">
        <li>{whenLine(e)}.</li>
        <li>{s.linked ? 'The FavorOS link is on your calendar event.' : 'Your calendar event is not changed.'}</li>
        {!!s.emailed && <li>{`Emailed the link to ${s.emailed} ${s.emailed === 1 ? 'person' : 'people'}.`}</li>}
        {!!s.emailFailed && <li>{`${s.emailFailed} ${s.emailFailed === 1 ? 'email' : 'emails'} did not go out. Share the room link with them.`}</li>}
      </ul>
      {s.linkError && <p className="t2-note">{s.linkError}</p>}
      <div className="t2-acts">
        <NavLink className="h-btn h-btn--primary" data-t2-first href={s.room} onClick={onClose}>
          Open the meeting
        </NavLink>
        <button type="button" className="h-btn h-btn--ghost" onClick={onClose}>
          Done
        </button>
      </div>
    </SheetLayer>
  );
}

/* ------------------------------------------------------------------ the cards */

function MeetingsCard({ events, partners, onOpen, onMove }: { events: DayEvent[] | null | undefined; partners: Partners; onOpen: (id: string) => void; onMove: (id: string) => void }) {
  const list = events;
  const outside = (list || []).filter(canMove).length;
  return (
    <Card
      title="Today’s meetings"
      td="meetings"
      meta={
        <NavLink className="h-link" href="/meet/">
          Day view
        </NavLink>
      }
    >
      {!list ? (
        <Empty t="Your calendar could not be read just now." />
      ) : !list.length ? (
        <Empty t="Nothing on your calendar today." />
      ) : (
        <ul className="r2t-list">
          {list.map((e) => {
            const live = isLive(e);
            const over = isOver(e);
            const j = !e.declined && !over ? joinOf(e) : null;
            const inner = (
              <>
                <span className="r2t-time">{live ? 'Now' : e.allDay ? 'All day' : clock(e.start)}</span>
                <Mark provider={e.provider} />
                <span className="r2t-lr__t">
                  <b>{e.title}</b>
                  <span>
                    {e.source || 'Meeting'}
                    {e.declined ? ' · Declined' : ''}
                  </span>
                </span>
                {live && <span className="r2t-chip r2t-chip--live">Live</span>}
              </>
            );
            const cls = 'r2t-lr' + (live ? ' is-now' : '');
            const ps = e.people.map((p) => partners[p]).filter(Boolean);
            return (
              <li className={'r2t-ev' + (over ? ' is-over' : '') + (e.declined ? ' is-declined' : '')} key={e.id || e.hub + e.start}>
                {e.hub ? (
                  <NavLink className={cls} href={room(e.hub)}>
                    {inner}
                  </NavLink>
                ) : (
                  <button type="button" className={cls + ' t2-rowbtn'} aria-haspopup="dialog" onClick={() => onOpen(e.id)}>
                    {inner}
                  </button>
                )}
                {(!e.hub && j) || canMove(e) || ps.length ? (
                  <div className="r2t-ev__a">
                    {!e.hub && j && (
                      <a className={'h-btn h-btn--sm ' + (live ? 'h-btn--primary' : 'h-btn--ghost')} href={j.href} {...(j.inside ? {} : { target: '_blank', rel: 'noopener' })}>
                        {j.label}
                      </a>
                    )}
                    {canMove(e) && (
                      <button type="button" className="h-btn h-btn--sm h-btn--ghost" onClick={() => onMove(e.id)}>
                        Move to FavorOS
                      </button>
                    )}
                    {ps.map((p) => (
                      <EntityChip key={p.id} kind="partner" id={p.id} label={p.name} />
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {outside > 0 && <p className="t2-nudge">{`${outside} ${outside === 1 ? 'meeting is' : 'meetings are'} held outside FavorOS.`}</p>}
    </Card>
  );
}

function ActionsCard({ bb }: { bb: Day['blackbaud'] }) {
  const today = todayEt();
  if (!bb.linked) return <Card title="Blackbaud actions"><Empty t="Your account is not linked to a fundraiser record in Blackbaud." /></Card>;
  if (!bb.actions.length) return <Card title="Blackbaud actions" meta="Next 7 days"><Empty t="No open actions due this week." /></Card>;
  return (
    <Card
      title="Blackbaud actions"
      meta={<NavLink className="h-link" href="/work/">Work Center</NavLink>}
      extra={bb.overdue ? <span className="r2t-chip r2t-chip--late">{bb.overdue} overdue</span> : null}
    >
      <ul className="r2t-list">
        {bb.actions.map((a) => (
          <li className="r2t-snzrow" data-row={a.id} key={a.id}>
            <NavLink className="r2t-lr" href={'/work/?action=' + encodeURIComponent(a.id)} title={a.summary || a.type || ''}>
              <span className="r2t-chk" aria-hidden="true" />
              <span className="r2t-lr__t">
                <b>{a.partner || 'Partner'}</b>
                <span>{a.summary || a.type || a.category}</span>
              </span>
              <span className={'r2t-chip ' + (a.due < today ? 'r2t-chip--late' : 'r2t-chip--plain')} data-chip>
                {dayShort(a.due)}
              </span>
            </NavLink>
            <SnoozeButton kind="bb" id={a.id} label={a.partner || 'Partner'} extra="r2t-snz--row" />
          </li>
        ))}
      </ul>
      {bb.total > bb.actions.length && (
        <NavLink className="r2t-more-n" href="/work/">
          {bb.total - bb.actions.length} more in the Work Center
        </NavLink>
      )}
    </Card>
  );
}

function MailCard({ g }: { g: Day['google'] }) {
  const inMail = !!(readJson<{ access?: { mail?: boolean } }>('local', KEYS.nav, {}).access || {}).mail;
  const list: DayMail[] | null | undefined = g.mail;
  const nMail = typeof g.mailUnread === 'number' ? g.mailUnread : list ? list.length : 0;
  return (
    <Card
      title="Unread mail"
      meta={inMail ? <NavLink className="h-link" href="/mail/">Mail</NavLink> : <a className="h-link" href="https://mail.google.com" target="_blank" rel="noopener">Gmail</a>}
      extra={nMail ? <span className="r2t-count">{nMail}</span> : null}
    >
      {!list ? (
        <Empty t="Your inbox could not be read just now." />
      ) : !list.length ? (
        <Empty t="No unread mail from the last three days." />
      ) : (
        <ul className="r2t-list">
          {list.slice(0, 6).map((m) => {
            const inner = (
              <>
                <span className="r2t-av" data-h={hue(m.from)}>
                  {initials(m.from)}
                </span>
                <span className="r2t-lr__t">
                  <b>{m.from}</b>
                  <span>{m.subject}</span>
                </span>
                {m.date && <time className="r2t-when">{clock(m.date)}</time>}
              </>
            );
            return (
              <li key={m.id}>
                {inMail && m.threadId ? (
                  <NavLink className="r2t-lr" href={'/mail/#/INBOX/' + m.threadId} title={m.subject}>
                    {inner}
                  </NavLink>
                ) : (
                  <a className="r2t-lr" href={m.link} target="_blank" rel="noopener" title={m.subject}>
                    {inner}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function fileItem(f: DayFile) {
  const m = String(f.mime || '');
  const enc = encodeURIComponent(f.id);
  const base = '/api/hub/day-file?id=' + enc;
  const common = { name: f.name, sub: f.by ? 'Shared by ' + f.by : 'Google Drive', external: f.link, externalShort: 'Drive', externalLabel: 'Open in Google Drive' };
  if (/^image\//.test(m)) return { kind: 'image', url: base + '&v=thumb&s=2000', download: '', ...common };
  return { kind: 'drive', url: base + '&v=content', page: base + '&v=thumb&s=1600', embed: /folder$/.test(m) ? '' : 'https://drive.google.com/file/d/' + enc + '/preview', ...common };
}

async function openFile(f: DayFile) {
  const w = window as unknown as { FavorChatView?: { open(i: unknown): void; close(): void; onClose?: () => void } };
  try {
    await loadScript('/js/chat/chat-view.js?v=2');
  } catch {
    location.href = f.link;
    return;
  }
  const V = w.FavorChatView;
  if (!V) {
    location.href = f.link;
    return;
  }
  let tok: ReturnType<typeof hubOv.on> | null = null;
  V.onClose = () => {
    if (tok) {
      const t = tok;
      tok = null;
      hubOv.off(t);
    }
  };
  V.open(fileItem(f));
  tok = hubOv.on(() => {
    tok = null;
    V.close();
  });
}

function FilesCard({ files }: { files: DayFile[] }) {
  return (
    <Card title="Shared with you" meta="This week">
      <ul className="r2t-list">
        {files.map((f) => (
          <li key={f.id}>
            <button type="button" className="r2t-lr t2-rowbtn" aria-haspopup="dialog" onClick={() => void openFile(f)}>
              <span className="r2t-lr__t">
                <b>{f.name}</b>
                <span>
                  {f.by} {ago(f.modified)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Your day: Blackbaud actions assigned to you and, once Google is connected, today's meetings, unread mail and shared files. Each card fails alone. */
export function DayGrid({ day }: { day: Day }) {
  const qc = useQueryClient();
  const [sheet, setSheet] = useState<Sheet>(null);
  const g = day.google;
  const partners: Partners = g.partners || {};
  const events = g.events;
  const byId = useMemo(() => new Map((events || []).map((e) => [e.id, e])), [events]);
  const sheetEvent = sheet ? byId.get(sheet.id) : undefined;

  const patchEvent = (id: string, patch: Partial<DayEvent>) =>
    qc.setQueryData<Day>(keys.day, (old) => (old ? { ...old, google: { ...old.google, events: (old.google.events || []).map((e) => (e.id === id ? { ...e, ...patch } : e)) } } : old));

  const close = () => setSheet(null);
  return (
    <>
      <ErrorBoundary label="Blackbaud actions could not load." className="h-card r2t-card">
        <ActionsCard bb={day.blackbaud} />
      </ErrorBoundary>
      {!g.connected ? (
        <>
          {events && events.length > 0 && (
            <ErrorBoundary label="Today’s meetings could not load." className="h-card r2t-card">
              <MeetingsCard events={events} partners={partners} onOpen={(id) => setSheet({ type: 'event', id })} onMove={(id) => setSheet({ type: 'move', id })} />
            </ErrorBoundary>
          )}
          <div className="h-card r2t-connect">
            <b>Calendar, files and mail</b>
            <p>Today&apos;s meetings, files shared with you and who emailed you. Reads titles and names only.</p>
            <a className="h-btn h-btn--primary h-btn--sm" href="/api/google/connect">
              Connect my Google
            </a>
          </div>
        </>
      ) : (
        <Fragment>
          <ErrorBoundary label="Today’s meetings could not load." className="h-card r2t-card">
            <MeetingsCard events={events} partners={partners} onOpen={(id) => setSheet({ type: 'event', id })} onMove={(id) => setSheet({ type: 'move', id })} />
          </ErrorBoundary>
          <ErrorBoundary label="Unread mail could not load." className="h-card r2t-card">
            <MailCard g={g} />
          </ErrorBoundary>
          {g.files && g.files.length > 0 && (
            <ErrorBoundary label="Shared files could not load." className="h-card r2t-card">
              <FilesCard files={g.files} />
            </ErrorBoundary>
          )}
        </Fragment>
      )}
      {sheet && sheetEvent && sheet.type === 'event' && <EventSheet e={sheetEvent} partners={partners} onClose={close} onMove={() => setSheet({ type: 'move', id: sheetEvent.id })} />}
      {sheet && sheetEvent && sheet.type === 'move' && (
        <MoveSheet
          e={sheetEvent}
          mayWrite={!!g.mayWrite}
          onClose={close}
          onBack={() => setSheet({ type: 'event', id: sheetEvent.id })}
          onDone={(r) => {
            if (r.already) {
              void qc.invalidateQueries({ queryKey: keys.day });
              close();
              return;
            }
            patchEvent(sheetEvent.id, { hub: r.id, source: 'FavorOS', provider: 'favor' });
            setSheet({ type: 'moved', id: sheetEvent.id, room: r.room, linked: r.linked, linkError: r.linkError, emailed: r.emailed, emailFailed: r.emailFailed });
          }}
        />
      )}
      {sheet && sheetEvent && sheet.type === 'moved' && <MovedSheet e={sheetEvent} s={sheet} onClose={close} />}
    </>
  );
}
