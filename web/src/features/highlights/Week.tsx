// Reporting > Highlights > This week: where each goal ends the year and the week in plain language for each team. Port of the week half of
// public/js/reporting.js with the same markup and classes. Every figure comes from /api/hub/reporting (the KPI dashboard's numbers) and is
// drawn as it came; a number opens its explanation through data-drill (public/js/drill.js, loaded after the page paints).
import { useSuspenseQuery } from '@tanstack/react-query';
import { HighlightCards } from '@/features/highlights/HighlightCards';
import { weekQuery, type Pace, type WeekAnswer } from './api';
import { longDay, money0, shortDay, short } from './format';
import { toast } from './toast';

const STATUS = { ahead: 'On pace to pass the goal', close: 'Close, it depends on the fourth quarter', behind: 'Behind pace' } as const;

function PaceCard({ k, p, name }: { k: string; p: Pace; name: string }) {
  const scale = Math.max(p.goal, p.projectedHigh, p.raised) || 1;
  const at = (n: number) => Math.min(100, Math.max(0, (n / scale) * 100)).toFixed(2);
  // A projection is an estimate, so it reads to the nearest tenth of a million ($12.8M), never to the dollar.
  const range = p.projectedLow === p.projectedHigh ? `about ${short(p.projectedHigh)}` : `${short(p.projectedLow)} to ${short(p.projectedHigh)}`;
  const awarded = p.measure === 'awarded';
  const label = name + (k === 'year' ? '' : awarded ? ', awarded this year' : ', this year');
  return (
    <button
      type="button"
      className={'rg-pace h-card is-' + p.status}
      data-drill={'explain:' + k}
      data-drill-label={label}
      data-drill-value={Number(p.raised) || 0}
      data-drill-shown-label={awarded ? 'Awarded this year' : 'Raised so far this year'}
    >
      <span className="rg-pace__top">
        <b>{name}</b>
        <span className={'rg-chip is-' + p.status}>{STATUS[p.status]}</span>
      </span>
      <span className="rg-pace__end">{range}</span>
      <span className="rg-pace__sub">{awarded ? 'awarded' : 'raised'} by December 31 at this pace</span>
      <span className="rg-track" aria-hidden="true">
        {p.projectedLow !== p.projectedHigh ? <i className="rg-band" style={{ left: at(p.projectedLow) + '%', width: (Number(at(p.projectedHigh)) - Number(at(p.projectedLow))).toFixed(2) + '%' }} /> : null}
        <i className="rg-fill" style={{ width: at(p.raised) + '%' }} />
        <i className="rg-tick rg-tick--now" style={{ left: at(p.expected) + '%' }} />
        <i className="rg-tick rg-tick--goal" style={{ left: at(p.goal) + '%' }} />
      </span>
      <span className="rg-pace__facts">
        <span>
          {money0(p.raised)} of {money0(p.goal)}, {p.pctGoal.toFixed(1)}%
        </span>
        <span>{p.pctYear.toFixed(1)}% of the year gone</span>
      </span>
      <span className="rg-pace__facts rg-pace__need">
        <span>{money0(p.toGo)} to go</span>
        <span>
          {money0(p.perWeekNeeded)} a week for {Math.round(p.weeksLeft)} weeks
        </span>
      </span>
    </button>
  );
}

function highlightText(d: WeekAnswer): string {
  const hl = d.highlights;
  const parts = [hl.overall].concat(hl.teams).map((h) => `${h.name}\n${h.headline}\n${h.lines.join('\n')}`);
  return `Favor highlights, ${shortDay(hl.week.from)} to ${shortDay(hl.week.to)}\n\n${parts.join('\n\n')}`;
}

export function Week() {
  const { data: d } = useSuspenseQuery(weekQuery);
  const names: Record<string, string> = { year: 'Raised this year' };
  for (const t of d.teams || []) names[t.key] = t.name;
  const order = ['year'].concat((d.teams || []).map((t) => t.key)).filter((k) => d.pace[k]);
  const hl = d.highlights;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(highlightText(d));
      toast('Highlights copied');
    } catch {
      toast('Your browser would not copy.');
    }
  };
  return (
    <div id="rg-week-body">
      <div className="rg-sec">
        <div className="rg-sec__h">
          <h2>Where each goal ends the year</h2>
          <p>{longDay(d.asOf)}</p>
        </div>
        <div className="rg-pace-grid">
          {order.map((k) => (
            <PaceCard key={k} k={k} p={d.pace[k]} name={names[k]} />
          ))}
        </div>
        <p className="rg-key">
          <span>
            <i className="rg-key__fill" />
            So far
          </span>
          <span>
            <i className="rg-key__now" />
            Where the line sits today
          </span>
          <span>
            <i className="rg-key__goal" />
            Goal
          </span>
          <span>
            <i className="rg-key__band" />
            Range for year end
          </span>
        </p>
      </div>
      <div className="rg-sec">
        <div className="rg-sec__h rg-sec__h--row">
          <div>
            <h2>This week</h2>
            <p>
              {shortDay(hl.week.from)} to {shortDay(hl.week.to)}
            </p>
          </div>
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" id="rg-copy" onClick={copy}>
            Copy as text
          </button>
        </div>
        <div className="rg-hl-grid" id="rg-hl-root" data-cards="1">
          <HighlightCards overall={hl.overall} teams={hl.teams || []} />
        </div>
        {d.giftsAvailable ? null : <p className="rg-note">Gift detail did not load, so the weekly lines are short. Reload in a minute.</p>}
      </div>
    </div>
  );
}

/** The week's frame at its final size while the numbers load (the classic page's skeleton). */
export function WeekWait() {
  return (
    <div className="rg-wait" id="rg-wait" role="status" aria-label="Loading the numbers">
      <div className="rg-sk-grid" aria-hidden="true">
        <i className="rg-sk rg-sk--lead" />
        <i className="rg-sk" />
        <i className="rg-sk" />
        <i className="rg-sk" />
        <i className="rg-sk" />
      </div>
    </div>
  );
}
