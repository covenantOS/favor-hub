import './styles';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDay, useKpi, useToday } from '@/data/hooks';
import { greeting, et } from '@/lib/format';
import { layoutAssets, loadScript } from '@/lib/legacy';
import { leavePage, runClassicScript } from '@/legacy/page';
import { keys } from '@/lib/query';
import { KEYS, readString, writeString } from '@/lib/storage';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { PathIcon } from '@/shell/Icon';
import { DayGrid, LivePill } from './day';
import { Feed, Mission, MineList, NeedsCards, NeedsSkeleton, Starts, Year } from './sections';

const WELCOME = '<path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="m5.6 5.6 2.1 2.1"/><path d="m16.3 16.3 2.1 2.1"/><path d="m5.6 18.4 2.1-2.1"/><path d="m16.3 7.7 2.1-2.1"/>';

const notes: Record<string, string> = {
  connected: 'Your meetings, files and mail now show here.',
  declined: 'Google was not connected.',
  'wrong-account': 'Pick your Favor account when Google asks.',
  failed: 'Google did not connect. Try again.',
  expired: 'That took too long. Try again.',
  'no-token': 'Google did not hand back access. Try again.',
};

const Skel = ({ n, tall }: { n: number; tall?: boolean }) => (
  <>
    {Array.from({ length: n }, (_, i) => (
      <div className={'r2t-skel' + (tall ? ' r2t-skel--tall' : '')} key={i} />
    ))}
  </>
);

/** Today: what is waiting on this person, their day, the year against goal (leadership), their own requests and recent activity. */
export function TodayPage() {
  const qc = useQueryClient();
  const today = useToday();
  const day = useDay();
  const t = today.data;
  const kpi = useKpi(!!t?.access.kpi);

  const first = String(t?.user?.name || '').trim().split(/\s+/)[0];
  const shown = t ? (first && t.user.via === 'google' ? first : '') : readString(KEYS.firstName);
  const part = greeting();
  const [date] = useState(() => et(new Date(), { weekday: 'long', month: 'long', day: 'numeric' }));
  const [note] = useState(() => {
    const code = new URLSearchParams(location.search).get('google');
    return code && notes[code] ? notes[code] : '';
  });

  // Remember the first name and card count so the greeting and the placeholders are final from the first paint next time.
  useEffect(() => {
    if (!t) return;
    writeString(KEYS.firstName, shown || null);
    writeString(KEYS.cardCount, String(t.cards.length || 1));
  }, [t, shown]);

  // The Google redirect note shows once; the address goes back to a plain /.
  useEffect(() => {
    if (note) history.replaceState(null, '', '/');
  }, [note]);

  // The snooze menu (public/js/today-snooze.js) and the number drill-downs (drill.js) are helpers that predate the app.
  useEffect(() => {
    void loadScript('/js/today-snooze.js?v=2').catch(() => undefined);
    const onSnoozed = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d && d.kind === 'hub') void qc.invalidateQueries({ queryKey: keys.today });
    };
    document.addEventListener('hub:snoozed', onSnoozed);
    return () => document.removeEventListener('hub:snoozed', onSnoozed);
  }, [qc]);

  // The morning briefing (Since you were away, the briefing rows, Moments, Focus) is the classic script, mounted here. It draws from
  // /api/brief/today and reads today's meetings and the Needs you cards from the events the classic Today sent.
  useEffect(() => {
    let live = true;
    void layoutAssets().then(async (a) => {
      if (!live || !a.brief) return;
      try {
        await runClassicScript(a.brief);
      } catch (e) {
        console.warn('[today] briefing did not start', e);
      }
    });
    return () => {
      live = false;
      leavePage();
    };
  }, []);
  useEffect(() => {
    if (!day.data) return;
    (window as unknown as { __hubDay?: unknown }).__hubDay = day.data;
    document.dispatchEvent(new CustomEvent('hub:day', { detail: day.data }));
  }, [day.data]);
  useEffect(() => {
    if (t) document.dispatchEvent(new CustomEvent('hub:cards', { detail: t.cards }));
  }, [t]);

  const hasKpi = !!t?.access.kpi;
  return (
    <div className="r2t">
      <div className="r2t-hello">
        <section className="h-hello">
          <h1 id="t-hello">{shown ? `${part}, ${shown}` : part}</h1>
          <p id="t-date">{date}</p>
        </section>
        <div className="r2t-hello__r" id="t-now">
          {day.data && <LivePill events={day.data.google.events} />}
        </div>
      </div>
      <div className="h-card h-welcome" id="t-welcome" hidden>
        <span className="h-welcome__mark">
          <PathIcon d={WELCOME} />
        </span>
        <div>
          <b>Tour of FavorOS, 2 minutes</b>
        </div>
        <div className="h-welcome__acts">
          <button type="button" className="h-btn h-btn--primary h-btn--sm" data-tour-start>
            Show me
          </button>
        </div>
      </div>

      <div id="br-root" aria-live="polite" />

      <section>
        <div className="r2t-sec">
          <h2>Needs you</h2>
          <span id="t-needs-meta" />
        </div>
        <div className="r2t-needs" id="t-cards" aria-busy={!t && !today.isError}>
          <ErrorBoundary label="Needs you could not load." className="h-card r2t-clear">
            {today.isError && !t ? <div className="h-card r2t-clear">{(today.error as Error).message}</div> : t ? <NeedsCards cards={t.cards} /> : <NeedsSkeleton />}
          </ErrorBoundary>
        </div>
        {note && (
          <p className="r2t-msg" id="d-sub">
            {note}
          </p>
        )}
      </section>

      <div className="r2t-row3" id="d-grid" aria-busy={!day.data && !day.isError}>
        {day.data ? (
          <DayGrid day={day.data} />
        ) : day.isError ? (
          <div className="h-card r2t-clear r2t-span">Your day could not load. Refresh to try again.</div>
        ) : (
          <Skel n={3} tall />
        )}
      </div>

      {hasKpi && (
        <section id="t-year-wrap" hidden={!kpi.data}>
          <div className="r2t-sec">
            <h2>Where the year stands</h2>
            <span id="t-fresh">{kpi.data?.summary.lastUpdated ? `KPI dashboard, Raiser's Edge as of ${new Date(kpi.data.summary.lastUpdated).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })}` : ''}</span>
          </div>
          <div className="r2t-yearrow">
            <ErrorBoundary label="The year card could not load." className="h-card r2t-year">
              {kpi.data && <Year s={kpi.data.summary} />}
            </ErrorBoundary>
            <Mission />
          </div>
        </section>
      )}

      <div className="r2t-lower">
        <ErrorBoundary label="What changed could not load." className="h-card">
          <Feed list={t?.activity || []} />
        </ErrorBoundary>
        <div className="r2t-stack">
          {t && !hasKpi && <Mission side />}
          {t && t.mine.length > 0 && (
            <ErrorBoundary label="Your requests could not load." className="h-card">
              <MineList list={t.mine} />
            </ErrorBoundary>
          )}
          <Starts />
        </div>
      </div>
    </div>
  );
}
