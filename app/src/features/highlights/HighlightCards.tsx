// The week in giving on Reporting > Highlights, as cards (2026-10-14). Will: "ugly and wordy, cool idea but could be MUCH prettier."
// Every figure is one the server already writes into the sentences (functions/_lib/hub/reporting-math.ts weeklyHighlight), from the
// same fields, so a card and Copy as text always agree. No sentences on a card: labels state facts, details sit in the hover titles.
import { money0 } from '@/lib/format';

export type PaceStatus = 'ahead' | 'close' | 'behind';

export interface Week {
  from: string;
  to: string;
  gifts: number;
  amount: number;
}

export interface Highlight {
  key: string;
  name: string;
  from: string;
  to: string;
  gifts: number;
  amount: number;
  prevGifts: number;
  prevAmount: number;
  status: PaceStatus | null;
  noun?: string;
  largest?: { partner: string; cid: string | null; amount: number; date: string } | null;
  month?: { key: string; soFar: number; lastKey: string; last: number } | null;
  goal?: { goal: number; raised: number; pctGoal: number; toGo: number; perWeekNeeded: number; weeksLeft: number } | null;
  weeks?: Week[];
  grants?: {
    awarded: number;
    count: number;
    received: number;
    toCome: number;
    open: number;
    thisMonth: { awards: number; awarded: number } | null;
    lastMonth: { awards: number; awarded: number } | null;
    enteredThrough: string | null;
  } | null;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (key: string) => MONTHS[Number(key.slice(5, 7)) - 1] || key;
const dayLabel = (day: string) => `${monthName(day.slice(0, 7)).slice(0, 3)} ${Number(day.slice(8, 10))}`;
const plural = (n: number, one: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : one + 's'}`;
export const STATUS: Record<PaceStatus, string> = { ahead: 'On pace', close: 'Close', behind: 'Behind' };
const STATUS_LONG: Record<PaceStatus, string> = { ahead: 'On pace to pass the goal', close: 'Close, it depends on the fourth quarter', behind: 'Behind pace' };

function Delta({ h }: { h: Highlight }) {
  const diff = h.amount - h.prevAmount;
  const noun = h.noun || 'gift';
  const tip = `Week before: ${plural(h.prevGifts, noun)}, ${money0(h.prevAmount)}`;
  if (!h.prevGifts && !(h.prevAmount > 0)) return <span className="hc-delta is-flat" title={tip}>No {noun}s the week before</span>;
  if (Math.abs(diff) < 1) return <span className="hc-delta is-flat" title={tip}>Same as the week before</span>;
  const up = diff > 0;
  return (
    <span className={'hc-delta ' + (up ? 'is-up' : 'is-down')} title={tip}>
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d={up ? 'M6 2.5 10 8H2z' : 'M6 9.5 2 4h8z'} /></svg>
      {money0(Math.abs(diff))}
      <span className="hc-delta__l">vs. week before</span>
    </span>
  );
}

/** Eight weekly bars, oldest first; the week on the card is the dark one. A week the gift list does not reach yet is left out. */
function Spark({ weeks, noun }: { weeks: Week[]; noun: string }) {
  if (weeks.length < 2) return null;
  const top = Math.max(1, ...weeks.map((w) => w.amount));
  const W = 8;
  const G = 4;
  const H = 40;
  const width = weeks.length * (W + G) - G;
  return (
    <svg className="hc-spark" viewBox={`0 0 ${width} ${H}`} width={width} height={H} role="img" aria-label={`Last ${weeks.length} weeks`}>
      {weeks.map((w, i) => {
        const h = Math.max(2, Math.round((w.amount / top) * (H - 2)));
        return (
          <rect key={w.from} x={i * (W + G)} y={H - h} width={W} height={h} rx={2} className={i === weeks.length - 1 ? 'is-now' : ''}>
            <title>{`${dayLabel(w.from)} to ${dayLabel(w.to)}: ${money0(w.amount)}, ${plural(w.gifts, noun)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function Goal({ h }: { h: Highlight }) {
  const g = h.goal;
  if (!g) return null;
  const pct = Math.max(0, Math.min(100, g.pctGoal));
  const tip = `${money0(g.raised)} of ${money0(g.goal)}. ${money0(g.toGo)} left, ${money0(g.perWeekNeeded)} a week for ${Math.round(g.weeksLeft)} weeks.${h.status ? ' ' + STATUS_LONG[h.status] + '.' : ''}`;
  return (
    <div className="hc-goal" title={tip}>
      <div className="hc-goal__row">
        <span className="hc-lab">Annual goal</span>
        <b>{g.pctGoal.toFixed(1)}%</b>
        <span className="hc-goal__of">of {money0(g.goal)}</span>
      </div>
      <span className="hc-bar" aria-hidden="true">
        <i style={{ width: pct + '%' }} />
      </span>
      <div className="hc-pair">
        <span>
          <em>Left</em>
          {money0(g.toGo)}
        </span>
        <span>
          <em>Needed a week</em>
          {money0(g.perWeekNeeded)}
        </span>
        <span>
          <em>Weeks left</em>
          {Math.round(g.weeksLeft)}
        </span>
      </div>
    </div>
  );
}

function Grants({ g }: { g: NonNullable<Highlight['grants']> }) {
  const got = g.awarded > 0 ? Math.max(0, Math.min(100, (g.received / g.awarded) * 100)) : 0;
  return (
    <div className="hc-grants" title={g.enteredThrough ? `Awards entered through ${dayLabel(g.enteredThrough)}` : undefined}>
      <div className="hc-goal__row">
        <span className="hc-lab">Received</span>
        <b>{money0(g.received)}</b>
        <span className="hc-goal__of">of {money0(g.awarded)} awarded</span>
      </div>
      <span className="hc-bar hc-bar--grants" aria-hidden="true">
        <i style={{ width: got + '%' }} />
      </span>
      <div className="hc-pair">
        <span>
          <em>Awards</em>
          {g.count.toLocaleString('en-US')}
        </span>
        <span>
          <em>To come</em>
          {money0(g.toCome)}
        </span>
        <span>
          <em>Open awards</em>
          {g.open.toLocaleString('en-US')}
        </span>
      </div>
    </div>
  );
}

function Facts({ h }: { h: Highlight }) {
  const g = h.grants;
  const big = h.largest;
  return (
    <dl className="hc-facts">
      {big ? (
        <div className="hc-fact hc-fact--wide">
          <dt>Largest</dt>
          <dd>
            <b>{money0(big.amount)}</b>
            {big.cid ? (
              <a className="hc-partner" href={'/work/partner/' + encodeURIComponent(big.cid)} data-entity={'partner:' + big.cid} data-label={big.partner}>
                {big.partner}
              </a>
            ) : (
              <span className="hc-partner">{big.partner}</span>
            )}
            <span className="hc-date">{dayLabel(big.date)}</span>
          </dd>
        </div>
      ) : null}
      {h.month ? (
        <div className="hc-fact hc-fact--pair">
          <div>
            <dt>{monthName(h.month.key)} so far</dt>
            <dd>
              <b>{money0(h.month.soFar)}</b>
            </dd>
          </div>
          <div>
            <dt>{monthName(h.month.lastKey)}</dt>
            <dd>
              <b>{money0(h.month.last)}</b>
            </dd>
          </div>
        </div>
      ) : g && g.thisMonth && g.lastMonth ? (
        <div className="hc-fact hc-fact--pair">
          <div>
            <dt>{monthName(h.to.slice(0, 7))} awards</dt>
            <dd>
              <b>{money0(g.thisMonth.awarded)}</b>
              <span className="hc-date">{plural(g.thisMonth.awards, 'award')}</span>
            </dd>
          </div>
          <div>
            <dt>Last month</dt>
            <dd>
              <b>{money0(g.lastMonth.awarded)}</b>
              <span className="hc-date">{plural(g.lastMonth.awards, 'award')}</span>
            </dd>
          </div>
        </div>
      ) : null}
    </dl>
  );
}

export function HighlightCard({ h, lead }: { h: Highlight; lead?: boolean }) {
  const noun = h.noun || 'gift';
  return (
    <article className={'hc h-card' + (lead ? ' hc--lead' : '')} data-hl={h.key}>
      <header className="hc-h">
        <h3>{h.name}</h3>
        {h.status ? <span className={'hc-pill is-' + h.status}>{STATUS[h.status]}</span> : null}
      </header>
      <div className="hc-top">
        <div className="hc-big">
          <span className="hc-lab">Last 7 days</span>
          <b>{money0(h.amount)}</b>
          <span className="hc-count">{plural(h.gifts, noun)}</span>
        </div>
        <Spark weeks={h.weeks || []} noun={noun} />
      </div>
      <Delta h={h} />
      <Goal h={h} />
      {h.grants ? <Grants g={h.grants} /> : null}
      <Facts h={h} />
    </article>
  );
}

export function HighlightCards({ overall, teams }: { overall: Highlight; teams: Highlight[] }) {
  return (
    <div className={'hc-grid' + (teams.length ? '' : ' hc-grid--solo')} data-n={teams.length}>
      <HighlightCard h={overall} lead />
      {teams.map((t) => (
        <HighlightCard key={t.key} h={t} />
      ))}
    </div>
  );
}
