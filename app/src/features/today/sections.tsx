import { Fragment, useMemo, useState } from 'react';
import { PathIcon } from '@/shell/Icon';
import { NavLink } from '@/shell/NavLink';
import { clock, compact, dayKey, et, money0, money2 } from '@/lib/format';
import { KEYS, readString } from '@/lib/storage';
import type { KpiSummary, TodayActivity, TodayCard, TodayMine } from '@shared/schemas';
import { Glyph, TileIcon, tool } from './tiles';

/** The clock button on a card or a Blackbaud action. Its menu (Tomorrow, Next week, Pick a date) is public/js/today-snooze.js, which listens for this markup. */
export function SnoozeButton({ kind, id, label, extra }: { kind: 'hub' | 'bb'; id: string; label: string; extra?: string }) {
  return (
    <button type="button" className={'r2t-snz' + (extra ? ' ' + extra : '')} data-snooze={kind} data-snooze-id={id} data-snooze-label={label} aria-label={'Snooze ' + label} title="Snooze" aria-haspopup="dialog">
      <PathIcon d='<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>' />
    </button>
  );
}

/* ------------------------------------------------------------------ Needs you */

/** Placeholders match the number of cards this browser last saw, so the row never changes height when the answer arrives. */
export const skeletonCount = () => Math.min(4, Math.max(0, Number(readString(KEYS.cardCount, '4')) || 4)) || 4;

export function NeedsSkeleton() {
  return (
    <>
      {Array.from({ length: skeletonCount() }, (_, i) => (
        <div className="r2t-skel" key={i} />
      ))}
    </>
  );
}

export function NeedsCards({ cards }: { cards: TodayCard[] }) {
  if (!cards.length)
    return (
      <div className="h-card r2t-clear r2t-span" data-tool="leaf">
        <span className="r2t-ico">
          <Glyph name="check" />
        </span>
        Nothing is waiting on you right now.
      </div>
    );
  return (
    <>
      {cards.map((c) => {
        const late = /past due|overdue|late/i.test(c.note);
        const long = String(Math.round(Number(c.n) || 0)).length > 5;
        return (
          <div className="r2t-snzwrap" key={c.id}>
            <NavLink className={'r2t-tile' + (c.warn ? ' r2t-tile--urgent' : '')} data-tool={tool(c.id)} href={c.href}>
              <span className="r2t-tile__h">
                <span className="r2t-ico">
                  <TileIcon name={c.id} />
                </span>
                {c.label}
              </span>
              <span className={'r2t-tile__n' + (long ? ' is-long' : '')}>
                <span data-countup key={c.n}>
                  {(Number(c.n) || 0).toLocaleString('en-US')}
                </span>
                {c.amount != null && <small>{money2(c.amount)}</small>}
              </span>
              <span className="r2t-tile__w">{c.what}</span>
              <span className="r2t-tile__f">
                {c.note && (
                  <span className={'r2t-chip ' + (c.warn ? 'r2t-chip--due' : late ? 'r2t-chip--late' : '')} title={c.note}>
                    <span className="r2t-chip__t">{c.note}</span>
                  </span>
                )}
                <span className="r2t-go">
                  <Glyph name="arrow" />
                </span>
              </span>
            </NavLink>
            <SnoozeButton kind="hub" id={'card:' + c.id} label={c.label} />
          </div>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ Your requests, Start something */

export function MineList({ list }: { list: TodayMine[] }) {
  const cls = (s: string) => (/Done|Approved/.test(s) ? 'r2t-chip--ok' : /Declined/.test(s) ? 'r2t-chip--late' : 'r2t-chip--due');
  return (
    <div className="h-card" id="t-mine-card">
      <div className="r2t-ch">
        <h3>Your requests</h3>
        <NavLink className="h-link" href="/requests/">
          The board
        </NavLink>
      </div>
      <ul className="r2t-list" id="t-mine">
        {list.map((m, i) => (
          <li key={m.href + i}>
            <NavLink className="r2t-lr" href={m.href} title={m.title}>
              <span className="r2t-lr__t">
                <b>{String(m.title || '').trim() || 'Untitled'}</b>
              </span>
              <span className={'r2t-chip ' + cls(m.status)} title={m.status}>
                <span className="r2t-chip__t">{m.status}</span>
              </span>
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STARTS: Array<[string, string, string, string]> = [
  ['Make a request', 'Website, Blackbaud, design, print and more', '/requests/new', '<path d="M12 5v14"/><path d="M5 12h14"/>'],
  ['Expense request', 'Purchases, travel and reimbursements', '/expenses/new', '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6"/><path d="M9 11h6"/><path d="M9 15h4"/>'],
  ['Receipts', 'Print the receipts waiting to go out', '/receipts/', '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'],
  ['Foundation prospects', 'Check a foundation before you call', '/foundations/', '<path d="M3 21h18"/><path d="M5 21V10"/><path d="M19 21V10"/><path d="M9 21V10"/><path d="M15 21V10"/><path d="m2 10 10-6 10 6z"/>'],
];

export function Starts() {
  return (
    <div className="h-card">
      <div className="r2t-ch">
        <h3>Start something</h3>
      </div>
      <div className="r2t-starts">
        {STARTS.map(([t, sub, href, ic]) => (
          <NavLink className="r2t-start" href={href} key={href}>
            <span className="r2t-ico">
              <PathIcon d={ic} />
            </span>
            <span>
              <b>{t}</b>
              <small>{sub}</small>
            </span>
          </NavLink>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ What changed */

const FEED_FIRST = 8;

export function Feed({ list }: { list: TodayActivity[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, FEED_FIRST);
  const rows = useMemo(() => {
    const today = dayKey(new Date());
    const yest = dayKey(new Date(Date.now() - 864e5));
    let last = '';
    return shown.map((a) => {
      const k = dayKey(a.at);
      let group: string | null = null;
      if (k !== last) {
        last = k;
        group = k === today ? 'Today' : k === yest ? 'Yesterday' : et(a.at, { weekday: 'long', month: 'short', day: 'numeric' });
      }
      return { a, group };
    });
  }, [shown]);
  return (
    <div className="h-card">
      <div className="r2t-ch">
        <h3>What changed</h3>
        <span>Last two weeks</span>
      </div>
      <div className="r2t-feed" id="t-feed">
        {list.length === 0 && <p className="r2t-empty">Nothing in the last two weeks.</p>}
        {rows.map(({ a, group }, i) => {
          const inner = (
            <>
              <span className="r2t-ico r2t-ico--sm">
                <TileIcon name={String(a.app || '')} />
              </span>
              <p>{a.text}</p>
              <time>{clock(a.at)}</time>
            </>
          );
          return (
            <Fragment key={a.at + a.text + i}>
              {group && <div className="r2t-feed__g">{group}</div>}
              {a.href ? (
                <NavLink className="r2t-fr" data-tool={tool(a.app)} href={a.href}>
                  {inner}
                </NavLink>
              ) : (
                <div className="r2t-fr" data-tool={tool(a.app)}>
                  {inner}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
      <button type="button" className="h-more r2t-more" id="t-feed-more" hidden={all || list.length <= FEED_FIRST} onClick={() => setAll(true)}>
        {`Show ${list.length - FEED_FIRST} more`}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ Where the year stands */

const SLICE_OF: Record<string, string> = { rdd: 'rdds', pc: 'pc', ce: 'ce', mk: 'marketing' };

export function Year({ s }: { s: KpiSummary }) {
  const pct = s.goal ? (s.raised / s.goal) * 100 : 0;
  const delta = s.raisedLastYear ? ((s.raised - s.raisedLastYear) / s.raisedLastYear) * 100 : null;
  const left = Math.max(0, (s.goal || 0) - (s.raised || 0));
  const yr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const days = Math.max(0, Math.round((Date.UTC(+yr.slice(0, 4), 11, 31) - Date.UTC(+yr.slice(0, 4), +yr.slice(5, 7) - 1, +yr.slice(8, 10))) / 864e5));
  return (
    <div className="h-card r2t-year" id="t-year">
      <div>
        <div className="r2t-lab">Raised so far this year</div>
        <div className="r2t-hero" data-countup key={s.raised} data-drill="year" data-drill-label="Raised so far this year" data-drill-value={Number(s.raised) || 0} data-drill-def="Which gifts count|Whose gift it is">
          {money0(s.raised)}
        </div>
        <div className="r2t-bar r2t-bar--lg">
          <i style={{ width: Math.min(100, pct).toFixed(1) + '%' }} />
        </div>
        <div className="r2t-goal">
          <span>
            {pct.toFixed(1)}% of the {money0(s.goal)} goal
          </span>
          {delta !== null && (
            <span className="r2t-delta">
              <span className={'r2t-chip ' + (delta >= 0 ? 'r2t-chip--ok' : 'r2t-chip--late')}>
                {delta >= 0 ? '+' : ''}
                {delta.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
              </span>
              <span className="r2t-sub">vs. this day last year</span>
            </span>
          )}
        </div>
        {s.goal > 0 && (
          <div className="r2t-strip">
            <div>
              <b>{money0(left)}</b>
              <span>to goal</span>
            </div>
            <div>
              <b>{days.toLocaleString('en-US')}</b>
              <span>days left</span>
            </div>
            <div>
              <b>{days ? money0(left / days) : money0(left)}</b>
              <span>needed a day</span>
            </div>
          </div>
        )}
        <div className="r2t-open">
          <a className="h-btn h-btn--primary h-btn--sm" href="/dashboard/">
            Open the KPI dashboard
          </a>
          <span className="copy-stamp" data-copy-stamp />
        </div>
      </div>
      <div>
        <div className="r2t-lab">Team goals</div>
        <div className="r2t-teams">
          {s.teams.map((t) => {
            const p = t.goal ? (t.amount / t.goal) * 100 : 0;
            const slice = SLICE_OF[t.key];
            return (
              <div className="r2t-team" key={t.key}>
                <div>
                  <b>{t.name}</b>
                  <small>
                    {slice && t.measure !== 'awarded' ? (
                      <span data-drill={'slice:' + slice} data-drill-label={t.name + ', this year'} data-drill-value={Number(t.amount) || 0} data-drill-def="Team revenue">
                        {compact(t.amount)}
                      </span>
                    ) : (
                      compact(t.amount)
                    )}{' '}
                    of {compact(t.goal)}
                    {t.measure === 'awarded' ? ' awarded' : ''}
                  </small>
                </div>
                <span>{Math.round(p)}%</span>
                <div className="r2t-bar">
                  <i style={{ width: Math.min(100, p).toFixed(1) + '%' }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function Mission({ side }: { side?: boolean }) {
  return (
    <div className={'h-card r2t-mission' + (side ? ' r2t-mission--side' : '')} data-mission>
      <small>Since Favor began</small>
      <b>615,780</b>
      <p>people have come to Christ. Transformed hearts transform nations.</p>
    </div>
  );
}
