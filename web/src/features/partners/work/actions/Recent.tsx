// Recent changes (public/js/work.js viewRecent): every batch this person sent in the last day, with Undo for 24 hours and Try again for the
// rows Blackbaud did not take.
import { useSuspenseQuery } from '@tanstack/react-query';
import { retryBatch, undoBatch } from './engine';
import { et } from './model';
import { recentQuery } from './queries';
import { useWc, wcSet } from './store';
import { ActionBar, Ic } from './ui';

const ITEM_CLS: Record<string, string> = { posted: 'ready', failed: 'fail', tonight: 'pick', saving: 'dup', undone: 'dup', queued: 'pick' };
const ITEM_TXT: Record<string, string> = { posted: 'In Blackbaud', failed: 'Not sent', tonight: 'Tonight', saving: 'Sending', undone: 'Undone', queued: 'Waiting' };
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

export function Recent({ as, today }: { as?: string; today: string }) {
  const bs = useSuspenseQuery(recentQuery(as)).data;
  const openB = useWc((s) => s.openB);
  const undoing = useWc((s) => s.undoing);
  return (
    <>
      {bs.length ? (
        <div className="wc-batches">
          {bs.map((b) => {
            const status = b.undone ? 'Undone' : b.tonight ? `${b.tonight} go to Blackbaud tonight` : b.failed ? `${b.posted} in Blackbaud · ${b.failed} did not go through` : b.queued ? `${b.posted} in Blackbaud · ${b.queued} sending` : `${b.posted} in Blackbaud`;
            const off = b.undoing || undoing.has(b.id);
            const when = dayOf(b.at) === today ? 'today' : 'on ' + et(b.at, { month: 'short', day: 'numeric' });
            const icon = b.undone ? 'undo' : b.failed ? 'alert' : b.op === 'reassign' ? 'user' : b.op === 'reschedule' ? 'cal' : 'check';
            return (
              <article key={b.id} className={'h-card wc-batch' + (openB === b.id ? ' is-open' : '')}>
                <div className="wc-batch__head">
                  <span className={'wc-batch__icon' + (b.undone ? ' undone' : b.failed ? ' fail' : '')}>
                    <Ic n={icon} />
                  </span>
                  <div>
                    <b>{b.label}</b>
                    <span>
                      {b.actor} · {et(b.at, { hour: 'numeric', minute: '2-digit' })} {when} · {status}
                    </span>
                  </div>
                  <div className="wc-batch__acts">
                    {b.failed && !b.undone ? (
                      <button type="button" className="h-btn h-btn--primary h-btn--sm" onClick={() => void retryBatch(b.id)}>
                        Try {b.failed} again
                      </button>
                    ) : null}
                    {b.undone ? null : (
                      <>
                        <button type="button" className="h-btn h-btn--ghost h-btn--sm" disabled={off} aria-busy={off} onClick={() => void undoBatch(b.id)}>
                          <Ic n="undo" />
                          {off ? 'Undoing…' : 'Undo'}
                        </button>
                        <small>
                          until {et(b.undo_until, { hour: 'numeric', minute: '2-digit' })} {dayOf(b.undo_until) === today ? 'today' : 'tomorrow'}
                        </small>
                      </>
                    )}
                    <button type="button" className="wc-clear" onClick={() => wcSet({ openB: openB === b.id ? null : b.id })}>
                      {openB === b.id ? 'Hide' : 'Show'} {b.items.length}
                    </button>
                  </div>
                </div>
                <ul>
                  {b.items.map((it) => (
                    <li key={it.id}>
                      <b>{it.name}</b>
                      <span>{it.what}</span>
                      <span className={'wc-state wc-state--' + (ITEM_CLS[it.state] || 'dup')}>{ITEM_TXT[it.state] || it.state}</span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="h-card wc-empty">
          <b>Nothing done here yet today</b>What you finish in the Work Center lands here, with Undo for 24 hours.
        </div>
      )}
      <ActionBar>{null}</ActionBar>
    </>
  );
}
