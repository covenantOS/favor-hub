// Needs you: one ranked list (the rules are in rank.ts), its tabs, the groups that open into rows, and the one action each row carries.
import { Suspense, startTransition, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { NavLink } from '@/shell/NavLink';
import { send } from '@/lib/api';
import { TZ, catOf, needCount, n0, plural, SHOW, TABS, ago, type GroupRow, type Item } from './rank';
import { useNeeds, useShared } from './state';
import { homeQ, inboxQ, todayQ, waitingQ, briefQ, giftsQ } from './queries';
import { CardHead, Ic, Skel, TypeChip, helpers, useNow } from './ui';
import { NeedsFoot } from './NeedsFoot';

const hit = (to: string | undefined, label: string, pid?: string) => <NavLink className="td-row__hit" href={to || '#'} data-partner-id={pid} aria-label={label} />;

function Snooze({ id, label }: { id: string; label: string }) {
  const h = helpers();
  const html = h.hubSnoozeButton ? h.hubSnoozeButton('hub', 'card:' + id, label, 'td-snz') : '';
  return html ? <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: html }} /> : null;
}

/** Take a row off the list at once, then do the write; the toast offers Undo where the write can be reversed. */
function useRowActions() {
  const { markGone, unmarkGone } = useShared();
  const qc = useQueryClient();
  const toast = (msg: string, undo?: (() => void) | null) => helpers().FavorTodayInbox?.toast(msg, undo);
  const fail = (e: unknown) => toast((e as Error).message || 'That did not work. Try again.');
  const again = () => {
    void qc.invalidateQueries({ queryKey: ['today', 'inbox'] });
    void qc.invalidateQueries({ queryKey: ['today', 'waiting'] });
  };
  return {
    clear(id: string) {
      const I = helpers().FavorTodayInbox;
      if (!I) return;
      void I.clear(id).then(() => {
        markGone(id);
        const undoable = /^(chat|tn|mm|hp|mail|star):/.test(id);
        toast('Cleared.', undoable ? () => void I.unclear(id).then(() => { unmarkGone(id); again(); }).catch(fail) : null);
      }, fail);
    },
    stop(id: string) {
      const I = helpers().FavorTodayInbox;
      if (!I) return;
      void I.stop(id).then(() => {
        markGone(id);
        toast('Off the list.', () => void I.unstop(id).then(() => { unmarkGone(id); again(); }).catch(fail));
      }, fail);
    },
    nudge(it: unknown) {
      helpers().FavorTodayInbox?.nudge(it, again);
    },
    handoff(id: string) {
      helpers().FavorTodayInbox?.openHandoff(id);
    },
    dismissMoment(id: string) {
      markGone('moment:' + id);
      const until = new Date(Date.now() + 14 * 864e5).toLocaleDateString('en-CA', { timeZone: TZ });
      void send('/api/hub/snooze', { key: 'moment:' + id, until }).catch(() => undefined);
    },
  };
}

function Acts({ it, act }: { it: Item; act: ReturnType<typeof useRowActions> }) {
  const s = it.src || {};
  if (it.kind === 'inbox') {
    if (s.kind === 'handoff') return <button type="button" className="td-btn td-btn--primary" onClick={() => act.handoff(String(s.id).slice(3))}>Pick up</button>;
    if (s.clear) {
      return (
        <>
          <NavLink className="td-btn td-btn--quiet" href={s.href}>{s.open || 'Open'}</NavLink>
          <button type="button" className="td-btn" title={s.clear} onClick={() => act.clear(s.id)}>
            <Ic n="check" />
            <span>{s.clear}</span>
          </button>
        </>
      );
    }
    return <NavLink className="td-btn" href={s.href}>{s.open || 'Open'}</NavLink>;
  }
  if (it.kind === 'wait-in') {
    return (
      <>
        <NavLink className="td-btn td-btn--primary" href={it.href || '#'}>Reply</NavLink>
        <button type="button" className="td-x" aria-label="Take it off the list" title="Take it off the list" onClick={() => act.stop(it.id)}><Ic n="x" /></button>
      </>
    );
  }
  if (it.kind === 'card') {
    return (
      <>
        <NavLink className="td-btn" href={it.href || '#'}>{it.card.cta || 'Open'}</NavLink>
        <Snooze id={it.card.id} label={it.card.label} />
      </>
    );
  }
  if (it.kind === 'thank') return <ThankButton row={it} />;
  if (it.kind === 'group') return <span className="td-count" data-flow={'today-' + it.id}>{(it.count ?? it.rows?.length ?? 0) > 99 ? '99+' : n0(it.count ?? it.rows?.length ?? 0)}</span>;
  return null;
}

function ThankButton({ row }: { row: { thank?: Item['thank'] } }) {
  const { markGone } = useShared();
  const qc = useQueryClient();
  const x = row.thank;
  if (!x) return null;
  return (
    <button
      type="button"
      className="td-btn td-btn--primary"
      onClick={(e) => {
        const wg = helpers().FavorWG;
        if (!wg || !wg.pop) { location.href = '/work/?view=gifts'; return; }
        const g = x.g;
        wg.pop(e.currentTarget, { giftId: g.giftId, cid: g.cid, name: g.name, amount: g.amount, date: g.date, fund: g.fund, phone: g.phone, left: g.left, tasks: g.tasks, team: g.team }, {
          owner: g.owner,
          done: () => {
            markGone('gift:' + g.giftId);
            setTimeout(() => { void qc.invalidateQueries({ queryKey: ['today', 'brief'] }); void qc.invalidateQueries({ queryKey: giftsQ.queryKey }); void qc.invalidateQueries({ queryKey: homeQ.queryKey }); }, 1500);
          },
        });
      }}
    >
      Thank
    </button>
  );
}

function SubRow({ r, act, now }: { r: GroupRow; act: ReturnType<typeof useRowActions>; now: number }) {
  let a: React.ReactNode = null;
  if (r.moment) {
    const m = r.moment;
    a = (
      <>
        <NavLink className="td-btn" href={m.href} onClick={(e) => { const c = helpers().FavorCall; if (c && !e.metaKey && !e.ctrlKey) { e.preventDefault(); c.open(m.cid); } }}>{m.step.label}</NavLink>
        <button type="button" className="td-btn td-btn--quiet" onClick={() => act.dismissMoment(m.id)}>Not now</button>
      </>
    );
  } else if (r.wait) {
    const w = r.wait.src;
    a = (
      <>
        {w && w.nudge ? (w.nudged ? <span className="td-when">{`Nudged ${ago(w.nudged, now)} ago`}</span> : <button type="button" className="td-btn" title={w.nudge.label || 'Nudge'} onClick={() => act.nudge(w)}>Nudge</button>) : null}
        {w ? <button type="button" className="td-x" aria-label="Stop waiting on this" title="Stop waiting" onClick={() => act.stop(w.id)}><Ic n="x" /></button> : null}
      </>
    );
  } else if (r.thank) a = <ThankButton row={r} />;
  return (
    <li className="td-sr">
      {hit(r.href, r.title, r.pid)}
      <span className="td-sr__t"><b>{r.title}</b><span>{r.sub || ''}</span></span>
      {r.chip ? <span className={'td-when' + (r.late ? ' is-late' : '')}>{r.chip}</span> : null}
      <span className="td-row__a">{a}</span>
    </li>
  );
}

function Row({ it, open, toggle, act, now }: { it: Item; open: boolean; toggle: () => void; act: ReturnType<typeof useRowActions>; now: number }) {
  const grp = it.kind === 'group';
  const ho = it.src && it.src.kind === 'handoff';
  const mark = grp ? (
    <button type="button" className="td-row__hit" aria-expanded={open} aria-label={it.title} onClick={toggle} />
  ) : ho ? (
    <button type="button" className="td-row__hit" aria-label={it.title} onClick={() => act.handoff(String(it.src.id).slice(3))} />
  ) : (
    hit(it.href, it.title, it.pid)
  );
  const when = it.chip ? <span className={'td-when' + (it.late ? ' is-late' : '')}>{it.chip}</span> : it.when ? <span className="td-when">{it.when}</span> : it.late ? <span className="td-when is-late">Late</span> : <span className="td-when" />;
  return (
    <li className={'td-row' + (it.late ? ' is-late' : '') + (grp ? ' td-row--grp' : '') + (open ? ' is-open' : '')} data-td-id={it.id}>
      {mark}
      <TypeChip t={it.t} />
      <span className="td-row__t"><b>{it.title}</b>{it.sub ? <span>{it.sub}</span> : null}</span>
      {when}
      <span className="td-row__a"><Acts it={it} act={act} />{grp ? <Ic n="chev" cls="td-chev" /> : null}</span>
      {open && grp ? (
        <ul className="td-sub">
          {(it.rows || []).map((r) => <SubRow key={r.key} r={r} act={act} now={now} />)}
          {it.more ? <li className="td-sr td-sr--more"><NavLink className="h-link" href={it.more.href}>{it.more.text}</NavLink></li> : null}
        </ul>
      ) : null}
    </li>
  );
}

function List() {
  const { items, now, home, brief } = useNeeds();
  const [tab, setTab] = useState('all');
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const act = useRowActions();
  const by: Record<string, number> = {};
  items.forEach((x) => { by[catOf(x)] = (by[catOf(x)] || 0) + 1; });
  const tabs = TABS.filter(([k]) => k === 'all' || by[k]);
  const cur = by[tab] || tab === 'all' ? tab : 'all';
  const counted = needCount(items);
  const shown = cur === 'all' ? items : items.filter((x) => catOf(x) === cur);
  const cut = all ? shown : shown.slice(0, SHOW);
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <>
      <CardHead id="td-needs-h" title="Needs you">
        <span className="td-n" id="td-needs-n" data-flow="today-needs" hidden={!counted}>{counted ? n0(counted) : ''}</span>
        <div className="td-tabs" id="td-tabs" role="tablist" aria-label="Show">
          {tabs.length > 2
            ? tabs.map(([k, l]) => (
                <button key={k} type="button" role="tab" className={'td-tab' + (cur === k ? ' is-on' : '')} aria-selected={cur === k} onClick={() => { setTab(k); setAll(false); }}>
                  {l}
                  {k === 'all' ? null : <> <span>{by[k]}</span></>}
                </button>
              ))
            : null}
        </div>
      </CardHead>
      <ol className="td-list" id="t-cards">
        {shown.length ? (
          cut.map((it) => <Row key={it.id} it={it} open={open.has(it.id)} toggle={() => toggle(it.id)} act={act} now={now} />)
        ) : (
          <li className="td-clear">
            <Ic n="check" />
            <div><b>Nothing needs you right now.</b><span>Mentions, replies owed, approvals, tasks due and gifts to thank land here.</span></div>
          </li>
        )}
      </ol>
      <NeedsFoot home={home} brief={brief} more={shown.length > SHOW ? { all, count: shown.length, toggle: () => setAll((v) => !v) } : null} />
    </>
  );
}

export function NeedsCard() {
  const { swr } = useShared();
  return (
    <section className="h-card td-card td-needs" id="td-needs" aria-labelledby="td-needs-h" data-keep-h="td-needs">
      <ErrorBoundary label="Needs you could not load.">
        <Suspense
          key={swr ? 'swr' : 'page'}
          fallback={
            <>
              <CardHead id="td-needs-h" title="Needs you" />
              <ol className="td-list" id="t-cards" aria-busy="true"><Skel n={6} /></ol>
            </>
          }
        >
          <List />
        </Suspense>
      </ErrorBoundary>
    </section>
  );
}

/** Refresh the lists when a hand-off lands or the tab comes back to the front. */
export function useNeedsRefresh() {
  const qc = useQueryClient();
  useEffect(() => {
    const again = () => {
      void qc.invalidateQueries({ queryKey: inboxQ('fast').queryKey.slice(0, 2) });
      void qc.invalidateQueries({ queryKey: waitingQ('fast').queryKey.slice(0, 2) });
    };
    const snoozed = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d && d.kind === 'hub') void qc.invalidateQueries({ queryKey: todayQ.queryKey });
    };
    const vis = () => { if (!document.hidden) again(); };
    document.addEventListener('favor-handoff', again);
    document.addEventListener('hub:snoozed', snoozed);
    document.addEventListener('visibilitychange', vis);
    return () => {
      document.removeEventListener('favor-handoff', again);
      document.removeEventListener('hub:snoozed', snoozed);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [qc]);
}

export { briefQ, plural, startTransition, useRef, useNow };
