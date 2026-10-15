// Meetings > Prep (/meet/prep/?m=<id>): who is coming, what is open between them and what was decided last time. Port of
// src/pages/meet/prep.astro and public/js/meet/prep.js: the same markup, the same stylesheets, the same reads. Without ?m= it opens the next
// meeting coming up. The Send the link sheet is public/js/meet/send.js, loaded on the first press.
import { Fragment, Suspense, useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import '@hub/styles/meet.css';
import '@hub/styles/qa2-meet.css';
import '@hub/styles/crit-meet.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import '@hub/styles/meet-auto.css';
import '@hub/styles/break-ui.css';
import { NavLink } from '@/shell/NavLink';
import { Boundary } from '../../partners/record/Boundary';
import { Avatar, Day, Icon, Time, Wait, loadSend, meetApi } from '../ui';
import { prepQuery } from '../queries';

interface Between {
  url: string;
  title: string;
  mine?: boolean;
  due?: string;
}
interface Attendee {
  name: string;
  email: string;
  title?: string;
  team?: string;
  role?: string;
  you?: boolean;
  held?: { count: number; last12: number };
  between: Between[];
}
interface PartnerCard {
  name: string;
  detail?: boolean;
  place: string;
  url: string;
  line?: string;
  count: number;
  lifetime: number;
  last12: number;
  last?: { amount: number; fund?: string; date: string; through?: string };
  largest?: { amount: number; date: string };
  lastContact?: { category: string; date: string; summary?: string };
  holders: string[];
  open: { what: string; due?: string }[];
}
export interface Prep {
  meeting: { id: string; title: string; startsAt?: string; endsAt?: string; status: string; agenda?: string };
  line: string;
  attendees: Attendee[];
  partners: PartnerCard[];
  last?: { id: string; title: string; date: string; summary: string; decisions: string[]; open: { text: string; owner?: string; due?: string }[] };
  openItems: { meetingId: string; text: string; owner?: string; due?: string; title: string; date: string }[];
}

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
// A single gift keeps its cents when it has them (FavorUI.money on the classic page).
const gift = (a: number | null | undefined) => {
  if (a == null) return '';
  const n = Number(a);
  return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: Math.round(n) === n ? 0 : 2, maximumFractionDigits: 2 });
};
const day = (iso?: string) => (iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const dayY = (iso?: string) => (iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

function Person({ a }: { a: Attendee }) {
  const bits = [a.title || a.team, a.role === 'host' ? 'Host' : '', a.you ? 'You' : ''].filter(Boolean).join(' · ');
  return (
    <div className="pr-p">
      <Avatar name={a.name} />
      <div>
        <b>{a.name}</b>
        <span>{bits || a.email}</span>
        {a.held ? (
          <span>
            Holds {a.held.count.toLocaleString('en-US')} {a.held.count === 1 ? 'partner' : 'partners'}, {money(a.held.last12)} given in 12 months
          </span>
        ) : null}
        {a.between.length ? (
          <ul className="pr-tasks">
            {a.between.map((t, i) => (
              <li key={i}>
                <NavLink href={t.url}>{t.title}</NavLink>
                <em>
                  {t.mine ? 'You owe' : 'Owes you'}
                  {t.due ? ' · due ' + day(t.due) : ''}
                </em>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function PartnerBlock({ p }: { p: PartnerCard }) {
  if (!p.detail)
    return (
      <div className="pr-pc">
        <b>{p.name}</b>
        <span>A partner on record.</span>
      </div>
    );
  const rows = (
    [
      ['Given in all', p.line || (p.count ? `${money(p.lifetime)} in ${p.count} ${p.count === 1 ? 'gift' : 'gifts'}` : 'No gifts yet')],
      ['Last 12 months', money(p.last12)],
      p.last ? ['Last gift', `${gift(p.last.amount)} to ${p.last.fund || 'no fund on file'}, ${dayY(p.last.date)}${p.last.through ? ' through ' + p.last.through : ''}`] : null,
      p.largest ? ['Largest gift', `${gift(p.largest.amount)}, ${dayY(p.largest.date)}`] : null,
      p.lastContact ? ['Last contact', `${p.lastContact.category}, ${day(p.lastContact.date)}${p.lastContact.summary ? ': ' + p.lastContact.summary : ''}`] : null,
      p.holders.length ? ['Held by', p.holders.join(', ')] : null,
    ] as ([string, string] | null)[]
  ).filter((r): r is [string, string] => !!r);
  return (
    <div className="pr-pc">
      <div className="pr-pc__h">
        <div>
          <b>{p.name}</b>
          <span>{p.place}</span>
        </div>
        <NavLink className="h-btn h-btn--ghost h-btn--sm" href={p.url}>
          Partner page
        </NavLink>
      </div>
      <dl className="kv">
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </Fragment>
        ))}
      </dl>
      {p.open.length ? (
        <>
          <div className="h-label" style={{ margin: '10px 0 4px' }}>
            Open on the record
          </div>
          <ul className="pr-tasks">
            {p.open.map((o, i) => (
              <li key={i}>
                {o.what}
                <em>{o.due ? 'due ' + day(o.due) : ''}</em>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function PrepSheet({ id }: { id: string }) {
  const { data: d } = useSuspenseQuery(prepQuery(id));
  const m = d.meeting;
  useEffect(() => {
    document.title = 'Prep, ' + m.title + ' - FavorOS';
  }, [m.title]);
  useEffect(() => {
    // The sheet is ready for a press at once; the script itself (a self-contained dialog) loads the moment the page is live.
    void loadSend();
  }, []);
  const n = d.attendees.length;
  return (
    <>
      <div className="nt-head">
        <div>
          <div className="h-label" style={{ marginBottom: 6 }}>
            Prep
          </div>
          <h2>{m.title}</h2>
          <div className="nt-meta">
            <span>
              <Icon n="cal" />
              {m.startsAt ? (
                <>
                  <Day iso={m.startsAt} />, <Time iso={m.startsAt} />
                  {m.endsAt ? (
                    <>
                      {' to '}
                      <Time iso={m.endsAt} />
                    </>
                  ) : null}
                </>
              ) : (
                'Open room'
              )}
            </span>
            <span>
              <Icon n="users" />
              {n} {n === 1 ? 'person' : 'people'}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {m.status === 'ended' ? (
            <NavLink className="h-btn h-btn--ghost h-btn--sm" href={`/meet/notes/?m=${m.id}`}>
              Notes
            </NavLink>
          ) : (
            <>
              <a className="h-btn h-btn--primary h-btn--sm" href={`/meet/room/?m=${m.id}`}>
                <Icon n="video" />
                Open the room
              </a>
              <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => void loadSend().then((s) => s?.open({ id: m.id, self: false }))}>
                Send the link
              </button>
            </>
          )}
        </div>
      </div>
      <p className="pr-line">{d.line}</p>
      <div className="mt-grid">
        <div className="mt-stack">
          {m.agenda ? (
            <section className="h-card mt-card">
              <div className="h-label" style={{ marginBottom: 8 }}>
                Agenda
              </div>
              <p className="nt-sum" style={{ whiteSpace: 'pre-wrap' }}>
                {m.agenda}
              </p>
            </section>
          ) : null}
          {d.last ? (
            <section className="h-card mt-card">
              <div className="h-label" style={{ marginBottom: 8 }}>
                Last time, {day(d.last.date)}
              </div>
              <p className="nt-sum">
                <NavLink href={`/meet/notes/?m=${d.last.id}`}>{d.last.title}</NavLink>. {d.last.summary}
              </p>
              {d.last.decisions.length ? (
                <>
                  <div className="h-label" style={{ margin: '10px 0 4px' }}>
                    Decided
                  </div>
                  <ul className="nt-list">
                    {d.last.decisions.map((t, i) => (
                      <li key={i}>
                        <span className="b">
                          <Icon n="check" />
                        </span>
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {d.last.open.length ? (
                <>
                  <div className="h-label" style={{ margin: '10px 0 4px' }}>
                    Still open
                  </div>
                  <ul className="pr-tasks">
                    {d.last.open.map((o, i) => (
                      <li key={i}>
                        {o.text}
                        <em>{[o.owner, o.due ? 'due ' + o.due : ''].filter(Boolean).join(' · ')}</em>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </section>
          ) : null}
          {d.openItems.length ? (
            <section className="h-card mt-card">
              <div className="h-label" style={{ marginBottom: 6 }}>
                Open from past meetings with these people
              </div>
              {d.openItems.map((o, i) => (
                <NavLink className="pr-oi" href={`/meet/notes/?m=${o.meetingId}`} key={i}>
                  <b>{o.text}</b>
                  <span>{[o.owner, o.due ? 'due ' + o.due : '', o.title + ', ' + day(o.date)].filter(Boolean).join(' · ')}</span>
                </NavLink>
              ))}
            </section>
          ) : null}
          {!m.agenda && !d.last && !d.openItems.length ? (
            <section className="h-card mt-card">
              <p className="mt-sub" style={{ margin: 0 }}>
                No agenda, no earlier meeting with this group and nothing open between these people.
              </p>
            </section>
          ) : null}
        </div>
        <div className="mt-stack">
          <section className="h-card mt-card">
            <div className="h-label" style={{ marginBottom: 8 }}>
              Who is coming
            </div>
            {d.attendees.map((a, i) => (
              <Person key={a.email + i} a={a} />
            ))}
          </section>
          {d.partners.length ? (
            <section className="h-card mt-card">
              <div className="h-label" style={{ marginBottom: 8 }}>
                Partners
              </div>
              {d.partners.map((p, i) => (
                <PartnerBlock key={i} p={p} />
              ))}
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}

const none = (
  <div className="h-card mt-card" style={{ maxWidth: 560 }}>
    <h2 className="mt-h2">Prep</h2>
    <p className="mt-sub" style={{ fontSize: 14, margin: '0 0 12px' }}>
      No meetings coming up.
    </p>
    <NavLink className="h-btn h-btn--ghost h-btn--sm" href="/meet/">
      Meetings
    </NavLink>
  </div>
);

/** Without ?m=, the next meeting that has not ended; the address is rewritten to name it (a replace, so Back skips the empty address). */
function Next() {
  const nav = useNavigate();
  const [state, setState] = useState<'wait' | 'none'>('wait');
  useEffect(() => {
    let live = true;
    (async () => {
      let id = '';
      try {
        const d = await meetApi<{ meetings?: { id: string; status: string; startsAt?: string; endsAt?: string }[] }>('meetings?scope=upcoming');
        const now = Date.now();
        const list = (d.meetings || []).filter((m) => m.status !== 'cancelled' && m.status !== 'ended' && (!m.startsAt || Date.parse(m.endsAt || m.startsAt) > now));
        list.sort((a, b) => (Date.parse(a.startsAt || '') || now) - (Date.parse(b.startsAt || '') || now));
        id = list.length ? list[0].id : '';
      } catch {
        id = '';
      }
      if (!live) return;
      if (!id) setState('none');
      else void nav({ to: '/meet/prep/', search: { m: id }, replace: true });
    })();
    return () => {
      live = false;
    };
  }, [nav]);
  return state === 'none' ? none : <Wait />;
}

export function PrepPage({ m }: { m: string }) {
  return (
    <div id="mt-prep">
      {m ? (
        <Boundary
          key={m}
          fallback={(e) => (
            <div className="h-card mt-card" style={{ maxWidth: 560 }}>
              <h2 className="mt-h2">Prep not available</h2>
              <p className="mt-sub" style={{ fontSize: 14 }}>
                {e.message}
              </p>
              <NavLink className="h-btn h-btn--primary" href="/meet/">
                Meetings
              </NavLink>
            </div>
          )}
        >
          <Suspense fallback={<Wait />}>
            <PrepSheet id={m} />
          </Suspense>
        </Boundary>
      ) : (
        <Next />
      )}
    </div>
  );
}
