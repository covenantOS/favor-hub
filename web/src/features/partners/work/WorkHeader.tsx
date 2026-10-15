// The Work Center's header: the pills (As of, the Blackbaud meter, Opens on, Settings, Morning email) and, on the Actions views, the view
// chips (Open actions, Thank-yous, Opportunities, Stale, Recent changes, Gift images). Every tab renders it at its top:
//
//   <WorkHeader search={search} />
//
// It also holds the toast, the progress bar and the dialog layer of the Work Center and hands the query client to the engine, so a tab
// that renders it can open the shared dialogs (openDialog in ./actions/store) and run writes (runJob in ./actions/engine).
import { Suspense, useEffect, useState } from 'react';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import './actions/actions.css';
import { bindClient } from './actions/engine';
import { boardQuery, gateQuery, giftImagesQuery, oppsQuery, recentQuery, startQuery } from './actions/queries';
import { indexOf, makeWork } from './actions/model';
import { openDialog, useWc } from './actions/store';
import { StartPanel, startTab } from './actions/start';
import { MailChip } from './actions/MorningEmail';
import { ACTION_LABEL, ACTION_VIEWS, hasTab, rememberTab, tabLabel, type ActionView, isActionView } from './actions/tabs';
import { WorkLayers } from './actions/ui';
import type { Meter } from './actions/types';
import type { WorkSearch } from './search';
import { useMounted } from '../record/lib';

const ET = { timeZone: 'America/New_York' } as const;
const clockOf = (iso: string) => {
  const d = new Date(iso);
  return iso && !isNaN(d.getTime()) ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...ET }) : 'recently';
};
/** "As of 11:18 PM" for a copy made today, "As of Oct 13, 11:18 PM" for an older one (public/js/copy-stamp.js). today is the board's day. */
function stamp(iso: string, today: string) {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return null;
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...ET });
  const same = d.toLocaleDateString('en-CA', ET) === today;
  return 'As of ' + (same ? time : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...ET }) + ', ' + time);
}

function Skel({ w }: { w: number }) {
  return (
    <span className="wc-pill" aria-hidden="true">
      <i className="h-skel" style={{ display: 'inline-block', width: w, height: 12, borderRadius: 6 }} />
    </span>
  );
}

function MeterPill({ meter }: { meter: Meter }) {
  const used = meter.used || 0;
  const pct = Math.min(100, Math.round((used / meter.cap) * 100));
  return (
    <span
      className={'wc-pill wc-meter' + (used >= 2200 ? ' is-high' : '')}
      title={`Favor's upkeep may make 3,000 Blackbaud calls a day, and the Work Center uses up to 2,400 of them. The giving form shares the same Blackbaud account, so FavorOS stays well under the limit. The count starts again at ${meter.resets}.`}
    >
      Blackbaud <b>{used.toLocaleString('en-US')}</b> / 3,000
      <span className="wc-meter__bar">
        <i style={{ width: Math.max(2, pct) + '%' }} />
      </span>
    </span>
  );
}

function PillsSkel() {
  return (
    <div className="wc-intro">
      <div className="wc-chips">
        <Skel w={96} />
        <Skel w={150} />
        <Skel w={130} />
      </div>
    </div>
  );
}

function Pills({ as }: { as?: string }) {
  const qc = useQueryClient();
  const gate = useSuspenseQuery(gateQuery(as)).data;
  const board = useSuspenseQuery(boardQuery(as)).data;
  const start = useSuspenseQuery(startQuery(as)).data;
  const meterNow = useWc((s) => s.meter);
  const [more, setMore] = useState(false);
  const [old, setOld] = useState(false);
  useEffect(() => bindClient(qc), [qc]);
  useEffect(() => {
    setOld(Date.now() - new Date(board.synced).getTime() > 26 * 3600 * 1000);
  }, [board.synced]);
  const me = board.me;
  const startLabel = tabLabel(startTab(start, me), me);
  const text = gate.admin ? stamp(board.synced, board.today) : null;
  return (
    <div className="wc-intro">
      <div className={'wc-chips' + (more ? ' is-open' : '')}>
        <button type="button" className="wc-pill wc-chipsmore" aria-expanded={more} aria-label="Show or hide Work Center details" onClick={() => setMore(!more)}>
          Details
        </button>
        {gate.admin && gate.release === 'admins' ? (
          <span className="wc-pill wc-pill--gold" title="Only admins see this page.">
            <svg className="h-i" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>' }} />
            Admins only
          </span>
        ) : null}
        {gate.admin ? (
          <>
            <span className="wc-pill" title="FavorOS reads a copy of Blackbaud that refreshes at 5 AM and 5 PM. What you do here shows at once.">
              <i className="dot" />
              <span className={'copy-stamp' + (old ? ' is-old' : '')} hidden={!text}>
                {text}
              </span>
            </span>
            <MeterPill meter={meterNow || board.meter} />
          </>
        ) : (
          <span className="wc-pill">
            <i className="dot" />
            Updated {clockOf(board.synced)}
          </span>
        )}
        <button type="button" className="wc-pill wc-pill--btn wc-start" aria-haspopup="dialog" onClick={() => openDialog(<StartPanel start={start} me={me} />)}>
          <svg className="h-i" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>' }} />
          Opens on <b>{startLabel}</b>
        </button>
        {gate.admin ? (
          <a className="wc-pill wc-pill--btn" href="/admin/work-center/" title="Work Center settings live in Admin settings">
            <svg className="h-i" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>' }} />
            Settings
          </a>
        ) : null}
        <MailChip />
      </div>
    </div>
  );
}

/** The chips under the pills on the Actions views, with the number each one carries. */
function ViewChipsSkel({ view }: { view: ActionView }) {
  return (
    <div className="wc-nav" id="wc-nav" style={{ minHeight: 34 }}>
      <div className="wc-vchips" role="tablist" aria-label="Actions views">
        {ACTION_VIEWS.filter((k) => k !== 'giftimages').map((k) => (
          <span key={k} role="tab" className={'wc-vchip' + (view === k ? ' is-on' : '')} aria-selected={view === k}>
            {ACTION_LABEL[k]}
          </span>
        ))}
      </div>
    </div>
  );
}

function ViewChips({ view, as }: { view: ActionView; as?: string }) {
  const board = useSuspenseQuery(boardQuery(as)).data;
  const recent = useSuspenseQuery(recentQuery(as)).data;
  // Data that streams in after the server draws is used only after mount, so the server HTML matches the first browser frame (React 418).
  const mounted = useMounted();
  const oppsQ = useQuery(oppsQuery(as));
  const imgsQ = useQuery(giftImagesQuery(as));
  const opps = mounted ? oppsQ.data : undefined;
  const imgs = mounted ? imgsQ.data : undefined;
  const ov = useWc((s) => s.ov);
  const gone = useWc((s) => s.gone);
  const f = useWc((s) => s.f);
  const me = board.me;
  const w = makeWork(indexOf(board), { ov, gone, saving: {}, queued: {}, back: {} });
  const count = (k: ActionView): number | '' => {
    if (k === 'open') return w.acts.filter((a) => w.isOpenNow(a) && w.inScope(a, f)).length;
    if (k === 'ty') return w.tyGroups('').length;
    if (k === 'stale') return w.staleCount();
    if (k === 'opps') return opps ? opps.rows.filter((o) => !o.inactive).length : '';
    if (k === 'recent') return recent.length;
    return imgs ? imgs.rows.filter((r) => r.why !== 'designated').length : '';
  };
  return (
    <div className="wc-nav" id="wc-nav" style={{ minHeight: 34 }}>
      <div className="wc-vchips" role="tablist" aria-label="Actions views">
        {ACTION_VIEWS.filter((k) => hasTab(k, me)).map((k) => {
          const n = count(k);
          return (
            <Link key={k} to="/work/" search={(s: WorkSearch) => ({ ...s, view: k === 'open' ? undefined : k, action: undefined })} replace role="tab" className={'wc-vchip' + (view === k ? ' is-on' : '')} aria-selected={view === k} onClick={() => rememberTab(k)}>
              {ACTION_LABEL[k]}
              {n !== '' && n !== 0 ? <span>{n.toLocaleString('en-US')}</span> : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function WorkHeader({ search, view }: { search?: WorkSearch; view?: string }) {
  const v = view || (search?.view as string | undefined) || 'open';
  const as = typeof search?.as === 'string' && search.as ? search.as : undefined;
  return (
    <>
      <Suspense fallback={<PillsSkel />}>
        <Pills as={as} />
      </Suspense>
      {isActionView(v) ? (
        <Suspense fallback={<ViewChipsSkel view={v} />}>
          <ViewChips view={v} as={as} />
        </Suspense>
      ) : null}
      <WorkLayers />
    </>
  );
}
