// Partners > /work/?view=open (and ty, opps, stale, recent, giftimages): the Work Center's Actions page. The header (pills and view chips)
// comes from WorkHeader; the view chosen by ?view= draws below it. Reads are started on the server by prefetchActions and every write goes
// through the engine in ./actions/engine (the same /api/work routes the classic page uses).
import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { WorkSearch } from './search';
import { WorkHeader } from './WorkHeader';
import { boardQuery, codesQuery, gateQuery, giftImagesQuery, oppsQuery, recentQuery, startQuery, viewsQuery } from './actions/queries';
import { asOf, useBoard, useGate, useWork } from './actions/useWork';
import { bindClient, toast } from './actions/engine';
import { EMPTY_FILTERS } from './actions/types';
import type { WorkFilters } from './actions/types';
import { applyScope, startScope, startTab } from './actions/start';
import { clearSel, setFilters, setSel, wcGet, wcSet } from './actions/store';
import { hasTab, isActionView, lastTab, rememberTab } from './actions/tabs';
import { ActionBar, Ic, Skel } from './actions/ui';
import { OpenView } from './actions/OpenView';
// The views behind the header's chips load as their own files when chosen; their stylesheets stay here so the server links them.
import './actions/opportunities.css';
import './actions/gift-images.css';
const ThankYous = lazy(() => import('./actions/ThankYous').then((m) => ({ default: m.ThankYous })));
const Stale = lazy(() => import('./actions/Stale').then((m) => ({ default: m.Stale })));
const Recent = lazy(() => import('./actions/Recent').then((m) => ({ default: m.Recent })));
const Opportunities = lazy(() => import('./actions/Opportunities').then((m) => ({ default: m.Opportunities })));
const GiftImages = lazy(() => import('./actions/GiftImages').then((m) => ({ default: m.GiftImages })));
import { openEditPanel } from './actions/EditPanel';
import { useWorkKeys } from './actions/useWorkKeys';

export function prefetchActions(qc: QueryClient, s: WorkSearch): void {
  const as = asOf(s);
  void qc.prefetchQuery(gateQuery(as));
  void qc.prefetchQuery(boardQuery(as));
  void qc.prefetchQuery(recentQuery(as));
  void qc.prefetchQuery(startQuery(as));
  void qc.prefetchQuery(codesQuery(as));
  void qc.prefetchQuery(viewsQuery(as));
  if (s.view === 'opps') void qc.prefetchQuery(oppsQuery(as));
  if (s.view === 'giftimages') void qc.prefetchQuery(giftImagesQuery(as));
}

function GateScreen({ reason }: { reason?: string }) {
  const before = reason === 'before_release';
  return (
    <div className="h-card wc-gate">
      <div className="wc-batch__icon">
        <Ic n="lock" />
      </div>
      <h2>{before ? 'The Work Center opens for you soon' : 'The Work Center is for the people whose job touches it'}</h2>
      <p>{before ? 'This page is not open for your account yet.' : 'It holds the open actions, thank-yous and partner work of the Support Team, the regional directors, Partner Care and church engagement. If your work needs it, tell Will Hamilton through Feedback.'}</p>
    </div>
  );
}

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="h-card wc-gate">
        <div className="wc-batch__icon">
          <Ic n="alert" />
        </div>
        <h2>The list did not load</h2>
        <p>{this.state.error.message}</p>
        <p>
          <button type="button" className="h-btn h-btn--primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </p>
      </div>
    );
  }
}

export function ActionsView({ search }: { search: WorkSearch }) {
  const as = asOf(search);
  return (
    <Boundary>
      <Suspense fallback={<Skel rows={8} id="wc-board" />}>
        <Gated search={search} as={as} />
      </Suspense>
    </Boundary>
  );
}

function Gated({ search, as }: { search: WorkSearch; as?: string }) {
  const gate = useGate(as);
  if (!gate.open) return <GateScreen reason={gate.reason} />;
  return (
    <>
      <WorkHeader search={search} />
      <Suspense fallback={<Skel rows={8} id="wc-board" />}>
        <Body search={search} as={as} />
      </Suspense>
    </>
  );
}

function Body({ search, as }: { search: WorkSearch; as?: string }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const board = useBoard(as);
  const w = useWork(board);
  const start = useSuspenseQuery(startQuery(as)).data;
  const views = useSuspenseQuery(viewsQuery(as)).data;
  const [focusId, setFocusId] = useState('');
  const asked = typeof search.view === 'string' ? search.view : '';
  const view = isActionView(asked) && hasTab(asked, w.me) ? asked : 'open';
  useWorkKeys();
  useEffect(() => bindClient(qc), [qc]);
  useEffect(() => rememberTab(view), [view]);

  // Once per page load: where this person's Work Center opens (a saved view, their own list, the saved start tab and scope), and the
  // filters or the action named in the address.
  useEffect(() => {
    if (wcGet().startApplied) return;
    wcSet({ startApplied: true });
    const me = w.me;
    const q = new URLSearchParams(location.search);
    const named = ['fr', 'quick', 'due', 'action', 'cid', 'q'].some((k) => q.get(k));
    let goTo = '';
    if (!asked) {
      const def = views.find((v) => v.default);
      if (def) {
        const sp = def.spec || {};
        wcSet((s) => ({ f: { ...s.f, ...((sp.f as Partial<WorkFilters>) || {}) }, sort: sp.sort || s.sort, dir: (sp.dir === 1 ? 1 : sp.dir === -1 ? -1 : s.dir) as 1 | -1 }));
        if (sp.view && sp.view !== 'open') goTo = sp.view;
      } else if (me.fid && w.idx.people[me.fid] && !['support', 'partner_care'].includes(me.role)) setFilters({ fr: me.fid, theirs: true });
    }
    {
      const qk = q.get('quick');
      const fr = q.get('fr');
      const dq = q.get('due');
      const patch: Partial<WorkFilters> = {};
      if (dq && ['past', 'today', 'now', 'week'].includes(dq)) patch.due = dq;
      if (qk && ['past', 'ty', 'done', 'ctg'].includes(qk)) patch.quick = qk;
      if (fr && /^\d{1,12}$/.test(fr)) patch.fr = fr;
      if (Object.keys(patch).length) setFilters(patch);
    }
    if (asked) {
      const f = wcGet().f;
      if (!named && asked === 'open' && me.fid && !f.fr && !f.scope) applyScope(startScope(start, me), me);
    } else {
      const savedFirst = views.some((v) => v.default);
      if (start.pref || !savedFirst) {
        const t = (!start.pref && lastTab() && hasTab(lastTab(), me) ? lastTab() : '') || startTab(start, me);
        goTo = goTo || t;
        if (start.pref && start.pref.scope) applyScope(start.pref.scope, me);
      }
    }
    const act = q.get('action') || '';
    if (/^\d{1,12}$/.test(act)) {
      const a = w.byId[act];
      if (!a || !w.isOpenNow(a)) toast('That action is not open any more.');
      else {
        setFilters({ ...EMPTY_FILTERS });
        setSel([act]);
        setFocusId(act);
        goTo = '';
        setTimeout(() => openEditPanel(act), 300);
      }
    }
    if (goTo && goTo !== 'open' && goTo !== view) void nav({ to: '/work/', search: (s) => ({ ...s, view: goTo as WorkSearch['view'] }), replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A change of view empties the selection (a selection never carries across lists).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else clearSel();
  }, [view]);

  if (view === 'ty')
    return (
      <Suspense fallback={null}>
        <ThankYous w={w} />
      </Suspense>
    );
  if (view === 'stale')
    return (
      <Suspense fallback={null}>
        <Stale w={w} board={board} />
      </Suspense>
    );
  if (view === 'recent')
    return (
      <Suspense fallback={null}>
        <Recent as={as} today={board.today} />
      </Suspense>
    );
  if (view === 'opps')
    return (
      <>
        <Suspense fallback={null}>
          <Opportunities as={as} />
        </Suspense>
        <ActionBar>{null}</ActionBar>
      </>
    );
  if (view === 'giftimages')
    return (
      <>
        <Suspense fallback={null}>
          <GiftImages as={as} />
        </Suspense>
        <ActionBar>{null}</ActionBar>
      </>
    );
  return <OpenView board={board} w={w} as={as} focusId={focusId} />;
}

