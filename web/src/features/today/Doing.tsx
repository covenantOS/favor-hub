// How Favor is doing: raised against the goal, team goals, and the new gifts since the last workday. Every figure is the KPI dashboard's own
// (/api/hub/kpi) or the briefing's. The card is hidden when it has nothing, but only after its sources have answered.
import { Suspense, useEffect } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { NavLink } from '@/shell/NavLink';
import { clock, compact, et, money0, n0, plural, shortMoney, type J } from './rank';
import { kpiQ } from './queries';
import { useNeeds } from './state';
import { helpers } from './ui';

const SLICE_OF: Record<string, string> = { rdd: 'rdds', pc: 'pc', ce: 'ce', mk: 'marketing' };

function Raised({ k }: { k: J }) {
  const pct = k.goal ? (k.raised / k.goal) * 100 : 0;
  const delta = k.raisedLastYear ? ((k.raised - k.raisedLastYear) / k.raisedLastYear) * 100 : null;
  const p = k.pace && k.pace.year;
  return (
    <div className="td-dc td-dc--raised">
      <span className="td-lab">Raised this year</span>
      <b className="td-hero" data-countup="" data-drill="year" data-drill-label="Raised so far this year" data-drill-value={Number(k.raised) || 0} data-drill-def="Which gifts count|Whose gift it is">{money0(k.raised)}</b>
      <span className="td-bar td-bar--lg"><i style={{ width: Math.min(100, pct).toFixed(1) + '%' }} /></span>
      <span className="td-goal">{`${pct.toFixed(1)}% of the ${money0(k.goal)} goal`}</span>
      {delta !== null ? <span className={'td-delta ' + (delta >= 0 ? 'is-up' : 'is-down')}>{`${delta >= 0 ? '+' : ''}${delta.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% vs. this day last year`}</span> : null}
      {p && p.goal ? (
        <button type="button" className={'td-pace is-' + p.status} data-drill="explain:year" data-drill-label="Raised so far this year" data-drill-value={Number(k.raised) || 0} data-drill-shown-label="Raised so far this year">
          {`${p.status === 'ahead' ? 'On pace to pass the goal' : p.status === 'close' ? 'Close to goal pace' : 'Behind goal pace'}: ${p.projectedLow === p.projectedHigh ? 'about ' + shortMoney(p.projectedHigh) : shortMoney(p.projectedLow) + ' to ' + shortMoney(p.projectedHigh)} at year end`}
        </button>
      ) : null}
    </div>
  );
}

function Teams({ k }: { k: J }) {
  const teams: J[] = k.teams || [];
  if (!teams.length) return null;
  return (
    <div className="td-dc td-dc--teams">
      <span className="td-lab">Team goals</span>
      <div className="td-teams">
        {teams.map((t) => {
          const tp = t.goal ? (t.amount / t.goal) * 100 : 0;
          const slice = SLICE_OF[t.key];
          const amt =
            slice && t.measure !== 'awarded' ? (
              <span data-drill={'slice:' + slice} data-drill-label={`${t.name}, this year`} data-drill-value={Number(t.amount) || 0} data-drill-def="Team revenue">{compact(t.amount)}</span>
            ) : t.measure === 'awarded' ? (
              <span data-drill={'explain:' + t.key} data-drill-label={`${t.name}, awarded this year`} data-drill-value={Number(t.amount) || 0} data-drill-shown-label="Awarded this year">{compact(t.amount)}</span>
            ) : (
              compact(t.amount)
            );
          return (
            <div className="td-goalrow" key={t.key}>
              <span className="td-goalrow__n">{String(t.name).replace(/ team$/i, '')}</span>
              <span className="td-goalrow__p">{Math.round(tp) + '%'}</span>
              <span className="td-bar"><i style={{ width: Math.min(100, tp).toFixed(1) + '%' }} /></span>
              <span className="td-goalrow__a">{amt} of {compact(t.goal)}{t.measure === 'awarded' ? ' awarded' : ''}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Cells({ kpi, onHide }: { kpi: J | null; onHide: (h: boolean) => void }) {
  const { brief, thanks, today } = useNeeds();
  const o = brief && brief.overnight;
  const late = thanks.filter((x) => x.late).length;
  const hasGifts = !!o || thanks.length > 0;
  const cells = (kpi ? 1 + ((kpi.teams || []).length ? 1 : 0) : 0) + (hasGifts ? 1 : 0);
  useEffect(() => {
    onHide(!cells);
    if (!cells) {
      const el = document.getElementById('t-year-wrap');
      if (el && (el as J).__kh) helpers().hubMotion?.letGo?.(el);
    }
  }, [cells, onHide]);
  useEffect(() => {
    document.getElementById('t-year-wrap')?.classList.toggle('is-nokpi', !(today.access && today.access.kpi));
  }, [today]);
  return (
    <>
      <header className="td-ch">
        <h2 id="td-doing-h">How Favor is doing</h2>
        <span className="td-ch__meta" id="t-fresh">{kpi && kpi.lastUpdated ? `Raiser's Edge as of ${clock(kpi.lastUpdated)}` : ''}</span>
        <NavLink className="h-link td-ch__r" id="td-kpi-link" href="/dashboard/" hidden={!kpi}>KPI dashboard</NavLink>
      </header>
      <div className="td-doing__b" id="t-year" data-n={cells}>
        {kpi ? <Raised k={kpi} /> : null}
        {kpi ? <Teams k={kpi} /> : null}
        {hasGifts ? (
          <div className="td-dc td-dc--gifts">
            <span className="td-lab">{`New gifts${brief && brief.since ? ' since ' + et(brief.since + 'T12:00:00Z', { weekday: 'long' }) : ''}`}</span>
            <NavLink className="td-big" href="/work/?view=gifts"><b data-flow="today-newgifts">{n0(o ? o.count : 0)}</b><span>{o && o.count ? money0(o.total) : 'None yet'}</span></NavLink>
            <NavLink className="td-mini" href="/work/?view=gifts">
              {thanks.length ? <>{plural(thanks.length, 'gift')} to thank{late ? <>, <em>{n0(late)} overdue</em></> : null}</> : 'Every gift thanked'}
            </NavLink>
          </div>
        ) : null}
      </div>
    </>
  );
}

function WithKpi({ onHide }: { onHide: (h: boolean) => void }) {
  const { data } = useSuspenseQuery(kpiQ);
  return <Cells kpi={data && data.summary ? data.summary : null} onHide={onHide} />;
}

function Body({ onHide }: { onHide: (h: boolean) => void }) {
  const { today } = useNeeds();
  return today.access && today.access.kpi ? <WithKpi onHide={onHide} /> : <Cells kpi={null} onHide={onHide} />;
}

export function DoingCard({ hidden, setHidden }: { hidden: boolean; setHidden: (h: boolean) => void }) {
  return (
    <section className="h-card td-card td-doing" id="t-year-wrap" aria-labelledby="td-doing-h" data-keep-h="td-doing" hidden={hidden}>
      <ErrorBoundary label="How Favor is doing could not load.">
        <Suspense
          fallback={
            <>
              <header className="td-ch"><h2 id="td-doing-h">How Favor is doing</h2><span className="td-ch__meta" id="t-fresh" /></header>
              <div className="td-doing__b" id="t-year" aria-busy="true"><div className="td-dc td-skelblock" /><div className="td-dc td-skelblock" /><div className="td-dc td-skelblock" /></div>
            </>
          }
        >
          <Body onHide={setHidden} />
        </Suspense>
      </ErrorBoundary>
    </section>
  );
}
