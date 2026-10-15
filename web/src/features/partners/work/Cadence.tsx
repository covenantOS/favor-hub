// Partners > /work/?view=cadence (Partner Care): the Partner Care manual's contact rules applied to the D1 copy of Blackbaud. Each row is a
// partner who is due, with the steps as buttons in the manual's order (call, text, email, card). A step opens a small form and saves one
// contact on the partner through POST /api/work/cadence/step, which saves an ordinary batch; the batch is then sent with
// /api/work/batches/:id/run, the way Gifts to thank does. Ported from public/js/work-cadence.js. Reads GET /api/work/cadence (no Blackbaud calls).
// On a phone each row is one line (name, how many days over, the next step) and the rest opens in the side panel.
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { queryOptions, useQueryClient, useSuspenseQuery, type QueryClient } from '@tanstack/react-query';
import { NavLink } from '@/shell/NavLink';
import { BodyPortal } from '@/shell/BodyPortal';
import { ColumnsMenu, DataTable, DensitySwitch, Pager, SearchBox, SidePanel, useHiddenColumns, useListKeys, usePageSize, pageOf, type Column, type Sort } from '../../../ui/table';
import '@hub/styles/pt-react-lists.css';
import type { WorkSearch } from './search';
import { Ic } from './lists/icons';
import { ListBoundary } from './lists/Boundary';
import { WgDialog } from './lists/Dlg';
import { WorkToast, driveBatch, failureOf, showToast } from './lists/toast';
import { CommPanel, SheetsButton, sheetScreen, useSheetSource } from './lists/legacy';
import { partnerHref, pressRowOpen } from './lists/nav';
import { useFit } from './lists/fit';
import { dateWords, reqId, telHref, useHeld, workGet, workPost, WorkError } from './lists/core';

// The WorkHeader (the page bar, the view chips) is built on branch pr-actions; render it here when ./WorkHeader exists.
// TODO: <WorkHeader view="cadence" search={search} />

const KEY = 'cadence';
const WORD: Record<string, string> = { call: 'Called', text: 'Texted', email: 'Emailed', card: 'Card' };
const ICON: Record<string, string> = { call: 'phone', text: 'text', email: 'mail', card: 'card' };
const QUICK: Record<string, string> = { due: 'Due now', first: 'First-time partners', repeat: 'Monthly, twice a year, annual', quarterly: 'Quarterly gifts to thank' };
const HIDE_DEFAULT = ['found'];

interface Step {
  k: string;
  label: string;
  state: string;
  off: string | null;
  late?: number;
  group?: string;
}
interface CadRow {
  cid: string;
  name: string;
  place: string;
  rule: string;
  ruleLabel: string;
  pattern: string;
  line: string;
  last: { date: string; what: string } | null;
  due: string;
  over: number;
  overMax?: number;
  overStep?: string;
  holderNames: string[];
  phone: string | null;
  steps: Step[];
  need: string;
  found?: { label: string; code: string } | null;
}
interface CadAnswer {
  today: string;
  synced: string;
  owner: string;
  me: string | null;
  owners: { id: string; name: string; n: number }[];
  everyone: number;
  unreachable: number;
  noText: Record<string, boolean>;
  stats: { week: number };
  rows: CadRow[];
}

const asOf = (s: WorkSearch) => (typeof s.as === 'string' ? s.as : '');
export const cadenceQuery = (owner: string, as?: string) =>
  queryOptions({
    queryKey: ['work', 'cadence', owner, as || ''],
    queryFn: () => workGet<CadAnswer>('/api/work/cadence' + (owner ? '?owner=' + encodeURIComponent(owner) : ''), as),
    staleTime: 30_000,
  });
export function prefetchCadence(qc: QueryClient, s: WorkSearch): void {
  void qc.prefetchQuery(cadenceQuery('', asOf(s)));
}

export function CadenceView({ search }: { search: WorkSearch }) {
  return (
    <>
      <ListBoundary what="Cadence">
        <CadenceBody as={asOf(search)} />
      </ListBoundary>
      <WorkToast />
    </>
  );
}

/* ------------------------------------------------------------------ the rules */

const stepName = (s: Step) => (s.group === 'reach' ? 'Reach out' : s.label);
const isDue = (r: CadRow) => r.over >= 0;
const QTEST: Record<string, (r: CadRow) => boolean> = {
  due: isDue,
  first: (r) => isDue(r) && r.rule === 'first',
  repeat: (r) => isDue(r) && ['monthly', 'semi', 'annual'].includes(r.rule),
  quarterly: (r) => isDue(r) && r.rule === 'quarterly',
};
const SORTS: Record<string, (r: CadRow) => string | number> = {
  name: (r) => String(r.name || '').toLowerCase(),
  rule: (r) => String(r.ruleLabel || '').toLowerCase(),
  over: (r) => (typeof r.over === 'number' ? r.over : -1e9),
  last: (r) => (r.last && r.last.date ? r.last.date : ''),
};

interface Ov {
  at: number;
  local: Record<string, string[]>;
  left: Record<string, boolean>;
  week: number;
}

function CadenceBody({ as }: { as: string }) {
  const qc = useQueryClient();
  const [ownerPick, setOwnerPick] = useHeld('cad.owner', '');
  const dOwner = useDeferredValue(ownerPick);
  const { data: d, dataUpdatedAt } = useSuspenseQuery(cadenceQuery(dOwner, as));
  const busy = dOwner !== ownerPick;
  const [quick, setQuick] = useHeld('cad.quick', '');
  const [q, setQ] = useHeld('cad.q', '');
  const [sortH, setSortH] = useHeld<Sort>('cad.sort', { col: '', dir: 'desc' });
  const [ovHeld, setOv] = useHeld<Ov | null>('cad.ov', null);
  const [cm, setCm] = useHeld<string[]>('cad.cm', []);
  const [page, setPage] = useState(1);
  const [size, setSize] = usePageSize(KEY, 50);
  const [hidden, setHidden] = useHiddenColumns(KEY, HIDE_DEFAULT);
  const [leaving, setLeaving] = useState<string[]>([]);
  const [panelCid, setPanelCid] = useState<string | null>(null);
  const [pop, setPop] = useState<{ anchor: HTMLElement; row: CadRow; k: string } | null>(null);
  const [printing, setPrinting] = useState(false);
  const { ref, fit } = useFit(390);
  const today = d.today;

  const ov: Ov = ovHeld && ovHeld.at === dataUpdatedAt ? ovHeld : { at: dataUpdatedAt, local: {}, left: {}, week: 0 };
  const stepsOf = (r: CadRow) => {
    const got = ov.local[r.cid];
    if (!got) return r.steps;
    const reached = r.steps.some((s) => s.group === 'reach' && got.includes(s.k));
    return r.steps.filter((s) => !got.includes(s.k) && !(reached && s.group === 'reach'));
  };
  const finished = (r: CadRow) => !!ov.local[r.cid] && (r.need === 'any' ? r.steps.some((s) => ov.local[r.cid].includes(s.k)) : stepsOf(r).length === 0);
  const all = useMemo(() => d.rows.filter((r) => !finished(r)), [d, ov]); // eslint-disable-line react-hooks/exhaustive-deps
  const due = all.filter(isDue);
  const list = useMemo(() => {
    const out = all.filter((r) => (!quick || QTEST[quick](r)) && (!q || (r.name + ' ' + r.place).toLowerCase().includes(q.toLowerCase())));
    const key = SORTS[sortH.col];
    if (!key) return out;
    const sgn = sortH.dir === 'asc' ? 1 : -1;
    return out.slice().sort((a, b) => {
      const x = key(a), y = key(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sgn;
    });
  }, [all, quick, q, sortH]);

  useEffect(() => setPage(1), [quick, q, ownerPick, sortH.col, sortH.dir]);
  const curPage = Math.min(Math.max(1, page), Math.max(1, Math.ceil(list.length / size)));
  const shown = pageOf(list, curPage, size);
  useListKeys(KEY);

  const apply = (fn: (o: Ov) => Ov) =>
    setOv((p) => {
      const base = p && p.at === dataUpdatedAt ? p : { at: dataUpdatedAt, local: {}, left: {}, week: 0 };
      return fn(base);
    });
  const reload = () => void qc.invalidateQueries({ queryKey: ['work', 'cadence'] });
  useEffect(() => {
    document.addEventListener('favor:thanked-undone', reload);
    return () => document.removeEventListener('favor:thanked-undone', reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- pressing a step ---- */
  const save = async (r: CadRow, k: string, reach: string, line: string) => {
    const left = k === 'call' && reach === 'left';
    showToast('Saving…');
    let out: any;
    try {
      out = await workPost('/api/work/cadence/step', { cid: r.cid, step: k, outcome: left ? 'left' : 'talked', line, req: reqId() });
    } catch (e) {
      showToast((e as Error).message, { bad: true });
      if (e instanceof WorkError && e.status === 409) reload();
      return;
    }
    if (!out.batch) {
      showToast('That step was already saved.', { bad: true });
      return;
    }
    const bid: string = out.batch.id;
    // Show the result at once; the send follows. If Blackbaud turns something down, the list is read again.
    if (left) apply((o) => ({ ...o, left: { ...o.left, [r.cid]: true } }));
    else {
      const next = { ...ov.local, [r.cid]: [...(ov.local[r.cid] || []), k] };
      const done = r.need === 'any' ? r.steps.some((s) => next[r.cid].includes(s.k)) : r.steps.filter((s) => !next[r.cid].includes(s.k) && !(r.steps.some((x) => x.group === 'reach' && next[r.cid].includes(x.k)) && s.group === 'reach')).length === 0;
      const commit = () => {
        apply((o) => ({ ...o, local: { ...o.local, [r.cid]: [...(o.local[r.cid] || []), k] }, week: o.week + (done ? 1 : 0) }));
        setLeaving([]);
      };
      if (done) {
        setLeaving([r.cid]);
        setTimeout(commit, 380);
      } else commit();
    }
    let held = '';
    try {
      held = out.batch.run_when !== 'tonight' ? await driveBatch(bid) : 'tonight';
    } catch (e) {
      showToast((e as Error).message + ' It is saved, and Recent can send it again.', { undo: { batches: [bid] }, bad: true });
      return;
    }
    const bad = await failureOf([bid]);
    if (bad) {
      showToast(`${bad} Nothing was lost. Recent has Try again.`, { undo: { batches: [bid] }, bad: true });
      reload();
      return;
    }
    const what = left ? `Message logged for ${r.name}. Call again tomorrow` : `${WORD[k] === 'Called' ? 'Call' : WORD[k] === 'Texted' ? 'Text' : WORD[k] === 'Emailed' ? 'Email' : 'Card'} logged for ${r.name}`;
    showToast(held === 'tonight' ? `${what}. It goes to Blackbaud tonight.` : held ? `${what}. Blackbaud is slow, so the rest goes when it answers.` : what + '.', { undo: { batches: [bid] } });
  };

  /* ---- the three lists ---- */
  const splitLists = (l: CadRow[]): [string, CadRow[]][] => {
    const sorted = l.filter(isDue).sort((a, b) => (b.overMax ?? b.over) - (a.overMax ?? a.over));
    const n = Math.ceil(sorted.length / 3);
    return [['Friday', sorted.slice(0, n)], ['Saturday', sorted.slice(n, 2 * n)], ['Sunday', sorted.slice(2 * n)]];
  };
  const needText = (r: CadRow) => stepsOf(r).filter((s) => !s.off).map((s) => s.label).join(', ') || 'No step possible';

  /* ---- Open in Google Sheets ---- */
  const live = useRef({ list, quick, stepsOf, needText, splitLists });
  live.current = { list, quick, stepsOf, needText, splitLists };
  useSheetSource('cadence', () => {
    const L = live.current;
    return sheetScreen('Cadence', [{ name: 'Cadence', columns: sheetCols, rows: L.list.map(rowOfSheet) }], { filters: L.quick ? 'Filter: ' + QUICK[L.quick] : '', classes: ['partner'] });
  });
  useSheetSource('cadence-lists', () => {
    const L = live.current;
    return sheetScreen('Cadence, the three lists', L.splitLists(L.list).map(([day, l]) => ({ name: day, columns: sheetCols, rows: l.map(rowOfSheet) })), { classes: ['partner'] });
  });
  const sheetCols = [
    { key: 'partner', label: 'Partner', type: 'text' }, { key: 'place', label: 'Place', type: 'text' }, { key: 'rule', label: 'Rule', type: 'text' }, { key: 'pattern', label: 'Giving', type: 'text' }, { key: 'found', label: 'Came in through', type: 'text' },
    { key: 'steps', label: 'Steps', type: 'text' }, { key: 'phone', label: 'Phone', type: 'text' }, { key: 'last', label: 'Last contact', type: 'date' }, { key: 'over', label: 'Days over', type: 'number' }, { key: 'holder', label: 'Held by', type: 'text' },
  ];
  const rowOfSheet = (r: CadRow) => ({ partner: r.name, place: r.place, rule: r.ruleLabel, pattern: r.pattern, found: r.found ? r.found.label : '', steps: live.current.needText(r), phone: r.phone || '', last: r.last ? r.last.date : null, over: r.over, holder: r.holderNames.join(', ') });

  /* ---- the table ---- */
  const dueLabel = (r: CadRow) => {
    const os = r.overStep ? r.steps.find((x) => x.k === r.overStep) : null;
    const step = os ? stepName(os) : '';
    if (r.over > 0)
      return (
        <b className="is-late">
          {step ? step + ' ' : ''}
          {r.over} {r.over === 1 ? 'day' : 'days'} over
        </b>
      );
    if (r.over === 0) return <b>Due today</b>;
    return <b>Due {dateWords(r.due, today)}</b>;
  };
  const lateLine = (r: CadRow) => {
    const os = r.steps.find((x) => x.k === r.overStep);
    const late = r.steps.filter((s) => typeof s.late === 'number' && s.late > 0 && stepName(s) !== (os ? stepName(os) : '')).sort((a, b) => (b.late || 0) - (a.late || 0));
    const seen = new Set<string>();
    return late.filter((s) => !seen.has(stepName(s)) && seen.add(stepName(s))).map((s) => `${stepName(s)} ${s.late} ${s.late === 1 ? 'day' : 'days'} late`).join(' · ');
  };
  const figOf = (r: CadRow) => (r.over > 0 ? r.over + ' d over' : r.over === 0 ? 'Today' : 'In ' + -r.over + ' d');
  const nextOf = (r: CadRow) => stepsOf(r).find((s) => !s.off);
  const openCm = (cid: string) => setCm((s) => (s.includes(cid) ? s.filter((x) => x !== cid) : [...s, cid]));

  const columns: Column<CadRow>[] = [
    {
      key: 'who', label: 'Partner', sort: 'name', fixed: true, className: 'c-who cd-c-who',
      cell: (r) => {
        const where = [r.place, r.pattern].filter(Boolean).join(' · ');
        return (
          <div className="ptl-who cd-who">
            <NavLink className="pt-name wg-name" href={partnerHref(r.cid)} data-pt-open="" title={r.name} onClick={(e) => { if (window.matchMedia('(max-width: 860px)').matches) { e.preventDefault(); setPanelCid(r.cid); } }}>
              {r.name}
            </NavLink>
            <span className="pt-sub ptl-place" title={where + (r.found ? ' · Came in through ' + r.found.label : '')}>
              {where}
            </span>
          </div>
        );
      },
    },
    {
      key: 'figure', label: '', fixed: true, className: 'cd-c-fig pt-phoneonly', thClassName: 'pt-phoneonly',
      cell: (r) => <span className={'cd-fig' + (r.over > 0 ? ' is-late' : '')}>{figOf(r)}</span>,
    },
    {
      key: 'rule', label: 'Frequency', sort: 'rule', className: 'c-rule', title: (r) => r.line || '',
      cell: (r) => <span className={'pt-badge' + (r.rule === 'first' ? ' pt-badge--good' : '')}>{r.ruleLabel}</span>,
    },
    {
      key: 'due', label: 'Due', sort: 'over', fixed: true, phone: false, className: 'c-due',
      cell: (r) => {
        const late = lateLine(r);
        const lateN = late ? late.split(' · ').length : 0;
        return (
          <>
            {dueLabel(r)}
            {lateN ? <> <span className="pt-badge pt-badge--warn" title={late}>+{lateN} late</span></> : null}
            {ov.left[r.cid] ? <> <span className="pt-badge pt-badge--gold">Left a message today</span></> : null}
          </>
        );
      },
    },
    {
      key: 'steps', label: 'Steps', fixed: true, phone: false, className: 'c-steps',
      cell: (r) => {
        const steps = stepsOf(r);
        const nextK = nextOf(r)?.k;
        return (
          <div className="ptl-steps">
            {steps.map((s) => (
              <button key={s.k} type="button" className={'wcd-seq' + (s.k === nextK ? ' is-next' : '')} disabled={!!s.off} title={s.off || `${s.label} ${r.name}`} onClick={(e) => setPop({ anchor: e.currentTarget, row: r, k: s.k })}>
                <Ic n={ICON[s.k]} />
                {s.label}
              </button>
            ))}
          </div>
        );
      },
    },
    {
      key: 'main', label: '', fixed: true, className: 'cd-c-main pt-phoneonly', thClassName: 'pt-phoneonly',
      cell: (r) => {
        const n = nextOf(r);
        return n ? (
          <button type="button" className="wcd-seq is-next cd-main" title={`${n.label} ${r.name}`} onClick={(e) => setPop({ anchor: e.currentTarget, row: r, k: n.k })}>
            <Ic n={ICON[n.k]} />
            {n.label}
          </button>
        ) : (
          <span className="pt-mute">None</span>
        );
      },
    },
    {
      key: 'last', label: 'Last contact', sort: 'last', className: 'c-last',
      title: (r) => (r.last ? `${dateWords(r.last.date, today)} · ${r.last.what.toLowerCase()}` : 'No contact on record'),
      cell: (r) => <span className="pt-sub">{r.last ? `${dateWords(r.last.date, today)} · ${r.last.what.toLowerCase()}` : 'No contact on record'}</span>,
    },
    { key: 'holder', label: 'Held by', className: 'c-holder', title: (r) => r.holderNames.join(', '), cell: (r) => <span className="pt-sub">{r.holderNames.join(', ')}</span> },
    { key: 'found', label: 'Came in through', hidden: true, className: 'c-found', title: (r) => (r.found ? r.found.code : ''), cell: (r) => <span className="pt-sub">{r.found ? r.found.label : ''}</span> },
    {
      key: 'acts', label: '', srLabel: 'Actions', fixed: true, phone: false, className: 'c-acts cd-c-acts',
      cell: (r) => (
        <div className="pt-acts">
          {r.phone ? (
            <a className="pt-icon" href={telHref(r.phone)} title={'Call ' + r.phone} aria-label={'Call ' + r.name}>
              <Ic n="phone" />
            </a>
          ) : (
            <span className="pt-icon is-off" title="No phone to call">
              <Ic n="phone" />
            </span>
          )}
          <button type="button" className={'wcd-comm ptl-comm' + (cm.includes(r.cid) ? ' is-open' : '')} aria-expanded={cm.includes(r.cid)} title="Communication history and preferences" onClick={() => openCm(r.cid)}>
            Communication
            {d.noText && d.noText[r.cid] ? <> <span className="pt-badge pt-badge--warn">No texts</span></> : null}
          </button>
        </div>
      ),
    },
  ];
  const nCols = columns.filter((c) => c.fixed || !hidden.has(c.key)).length;

  const seg = d.owners.length > 1 && d.owners.some((o) => o.n !== d.everyone);
  const mine = d.me && d.owners.some((o) => o.id === d.me) ? d.me : '';
  const chips: [string, string, number, string][] = [
    ['', 'All', all.length, 'Every partner in the queue'],
    ['due', 'Due now', due.length, QUICK.due],
    ['first', 'First-time', due.filter((r) => r.rule === 'first').length, QUICK.first],
    ['repeat', 'Monthly to annual', due.filter((r) => ['monthly', 'semi', 'annual'].includes(r.rule)).length, QUICK.repeat],
    ['quarterly', 'Quarterly', due.filter((r) => r.rule === 'quarterly').length, QUICK.quarterly],
  ];
  const panel = panelCid ? d.rows.find((r) => r.cid === panelCid) || null : null;
  const stepPanel = (n: number) => {
    const i = shown.findIndex((r) => r.cid === panelCid);
    if (shown[i + n]) setPanelCid(shown[i + n].cid);
  };
  const [fopen, setFopen] = useState(false);

  return (
    <>
      <section className={'h-card wc-sheet ptl-sheet cd-sheet' + (fopen ? ' is-fopen' : '')} aria-label="Cadence" ref={ref}>
        <div className="pt-bar">
          {seg ? (
            <div className="pt-seg pl-f" role="group" aria-label="Whose list">
              {mine ? (
                <button type="button" className={d.owner === mine ? 'is-on' : ''} onClick={() => setOwnerPick(mine)}>
                  Mine
                </button>
              ) : null}
              <button type="button" className={!d.owner ? 'is-on' : ''} onClick={() => setOwnerPick('all')}>
                All of Partner Care
              </button>
            </div>
          ) : null}
          <SearchBox value={q} onChange={setQ} placeholder="Find a partner" label="Find a partner" delay={160} />
          <button type="button" className="h-btn h-btn--ghost h-btn--sm pl-fbtn" aria-expanded={fopen} onClick={() => setFopen(!fopen)}>
            Filters
          </button>
          <div className="pt-seg pl-f" role="group" aria-label="Show">
            {chips.map(([k, l, c, tip]) => (
              <button key={k} type="button" className={quick === k ? 'is-on' : ''} aria-pressed={quick === k} title={tip} onClick={() => setQuick(quick === k ? '' : k)}>
                {l}
                <span>{c.toLocaleString('en-US')}</span>
              </button>
            ))}
          </div>
          <span className="pt-spacer" />
          <span className="pl-f">
            <ColumnsMenu showFixed columns={columns} hidden={hidden} onChange={setHidden} />
          </span>
          <DensitySwitch />
          <button type="button" className="h-btn h-btn--ghost h-btn--sm pl-f" onClick={() => setPrinting(true)}>
            <Ic n="print" />
            Print the three lists
          </button>
          <SheetsButton grid name="cadence" className="h-btn h-btn--ghost h-btn--sm pl-f" />
        </div>
        <DataTable
          listKey={KEY}
          label="Cadence"
          className="ptl-table ptl-cadence cd-table"
          columns={columns}
          rows={shown}
          rowKey={(r) => r.cid}
          sort={sortH.col ? sortH : undefined}
          onSort={setSortH}
          hidden={hidden}
          onRowClick={(r) => {
            if (window.matchMedia('(max-width: 860px)').matches) setPanelCid(r.cid);
          }}
          onOpen={() => pressRowOpen()}
          openId={panelCid}
          rowClassName={(r) => 'cd-row' + (cm.includes(r.cid) ? ' is-open' : '') + (leaving.includes(r.cid) ? ' is-leaving' : '')}
          rowAfter={(r) =>
            cm.includes(r.cid) ? (
              <tr className="ptl-expand cd-expand">
                <td colSpan={nCols}>
                  <CommPanel cid={r.cid} onFlag={reload} />
                </td>
              </tr>
            ) : null
          }
          busy={busy}
          fit={fit}
          empty={
            <div className="pt-empty">
              <b>{all.length ? 'Nothing matches' : 'Queue clear'}</b>
              {all.length ? 'Clear the filter above to see the rest.' : 'New partners come due after the Blackbaud copy refreshes at 5 AM and 5 PM.'}
            </div>
          }
        />
        <Pager
          listKey={KEY}
          total={list.length}
          page={curPage}
          size={size}
          onPage={(p, s) => {
            if (s !== size) setSize(s);
            setPage(p);
            ref.current?.querySelector('.pt-wrap')?.scrollTo({ top: 0 });
          }}
        />
        <div className="wg-foot">
          <span>
            {list.length.toLocaleString('en-US')} {list.length === 1 ? 'partner' : 'partners'}. {(d.stats.week + ov.week).toLocaleString('en-US')} done this week. Each step you press logs an action on the partner.
            {d.unreachable ? ` ${d.unreachable.toLocaleString('en-US')} more ${d.unreachable === 1 ? 'partner is' : 'partners are'} due with no phone, email or mailing address for the step they need.` : ''}
          </span>
        </div>
      </section>

      {pop ? <StepPop anchor={pop.anchor} row={pop.row} k={pop.k} onClose={() => setPop(null)} onSave={(reach, line) => void save(pop.row, pop.k, reach, line)} /> : null}
      {printing ? <PrintDialog lists={splitLists(list)} needText={needText} onClose={() => setPrinting(false)} /> : null}

      <SidePanel
        open={!!panel}
        label="Partner due"
        kicker={panel ? panel.ruleLabel : 'Cadence'}
        title={panel ? panel.name : ''}
        sub={panel ? [panel.place, panel.pattern].filter(Boolean).join(' · ') : ''}
        onClose={() => setPanelCid(null)}
        onPrev={() => stepPanel(-1)}
        onNext={() => stepPanel(1)}
        foot={
          panel ? (
            <>
              {panel.phone ? (
                <a className="h-btn h-btn--ghost" href={telHref(panel.phone)}>
                  <Ic n="phone" />
                  Call
                </a>
              ) : null}
              <NavLink className="h-btn h-btn--ghost" href={partnerHref(panel.cid)}>
                Open partner
              </NavLink>
            </>
          ) : null
        }
      >
        {panel ? (
          <>
            <dl>
              <dt>Due</dt>
              <dd>{dueLabel(panel)}</dd>
              <dt>Frequency</dt>
              <dd>{panel.ruleLabel}</dd>
              <dt>Last contact</dt>
              <dd>{panel.last ? `${dateWords(panel.last.date, today, true)} · ${panel.last.what.toLowerCase()}` : 'No contact on record'}</dd>
              <dt>Held by</dt>
              <dd>{panel.holderNames.join(', ') || 'No current holder'}</dd>
              {panel.found ? (
                <>
                  <dt>Came in through</dt>
                  <dd>{panel.found.label}</dd>
                </>
              ) : null}
              {lateLine(panel) ? (
                <>
                  <dt>Late</dt>
                  <dd>{lateLine(panel)}</dd>
                </>
              ) : null}
            </dl>
            <div className="pa-block">
              <h3>Steps</h3>
              <div className="ptl-steps cd-panel-steps">
                {stepsOf(panel).map((s) => (
                  <button key={s.k} type="button" className={'wcd-seq' + (s.k === nextOf(panel)?.k ? ' is-next' : '')} disabled={!!s.off} title={s.off || `${s.label} ${panel.name}`} onClick={(e) => setPop({ anchor: e.currentTarget, row: panel, k: s.k })}>
                    <Ic n={ICON[s.k]} />
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="pa-block">
              <h3>Communication</h3>
              <CommPanel key={panel.cid} cid={panel.cid} onFlag={reload} />
            </div>
          </>
        ) : null}
      </SidePanel>
    </>
  );
}

/* ------------------------------------------------------------------ the step form */

function StepPop({ anchor, row: r, k, onClose, onSave }: { anchor: HTMLElement; row: CadRow; k: string; onClose: () => void; onSave: (reach: string, line: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [reach, setReach] = useState('talked');
  const [line, setLine] = useState('');
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const label = { call: 'Call', text: 'Text', email: 'Email', card: 'Card' }[k] || k;
  const attempt = k === 'call' && reach === 'left';
  useLayoutEffect(() => {
    const b = anchor.getBoundingClientRect();
    const width = Math.min(340, innerWidth - 24);
    const left = Math.max(12, Math.min(b.left, innerWidth - width - 12));
    const h = box.current?.offsetHeight || 0;
    let top = b.bottom + 8;
    if (top + h > innerHeight - 12) top = Math.max(12, b.top - h - 8);
    setPos({ left, top, width });
  }, [anchor, reach]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', esc, true);
    const off = (ev: MouseEvent) => {
      const path = ev.composedPath ? ev.composedPath() : [];
      if (box.current && !path.includes(box.current) && !path.includes(anchor)) onClose();
    };
    const t = setTimeout(() => document.addEventListener('click', off), 0);
    addEventListener('resize', onClose);
    const f = setTimeout(() => box.current?.querySelector<HTMLInputElement>('#wcd-line')?.focus(), 30);
    return () => {
      document.removeEventListener('keydown', esc, true);
      document.removeEventListener('click', off);
      clearTimeout(t);
      clearTimeout(f);
      removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);
  const save = () => {
    onClose();
    onSave(reach, line.trim());
  };
  return BodyPortal(
    <div ref={box} className="wg-pop" role="dialog" aria-label={`${k} ${r.name}`} style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { visibility: 'hidden', left: 0, top: 0 }}>
      <h4>
        <span>
          {label} {r.name}
          <small>
            {r.ruleLabel}
            {r.place ? ' · ' + r.place : ''}
          </small>
        </span>
        <button type="button" className="pp-iconbtn" aria-label="Close" onClick={onClose}>
          <Ic n="x" />
        </button>
      </h4>
      {k === 'call' ? (
        <div className="pp-seg" role="group" aria-label="Result">
          <button type="button" className={reach === 'talked' ? 'is-on' : ''} onClick={() => setReach('talked')}>
            Talked
          </button>
          <button type="button" className={reach === 'left' ? 'is-on' : ''} onClick={() => setReach('left')}>
            Left a message
          </button>
        </div>
      ) : null}
      <input
        type="text"
        id="wcd-line"
        maxLength={200}
        placeholder={k === 'card' ? 'What you wrote' : attempt ? 'Anything to note' : 'What was said'}
        value={line}
        autoComplete="off"
        onChange={(e) => setLine(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            save();
          }
        }}
      />
      <div className="wg-pop__foot">
        <small>{attempt ? 'Logs the attempt. The step stays due and a reminder comes tomorrow.' : r.phone && (k === 'call' || k === 'text') ? r.phone : ''}</small>
        <button type="button" className="h-btn h-btn--primary h-btn--sm" onClick={save}>
          {attempt ? 'Save attempt' : 'Save ' + label.toLowerCase()}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Print the three lists */

function PrintDialog({ lists, needText, onClose }: { lists: [string, CadRow[]][]; needText: (r: CadRow) => string; onClose: () => void }) {
  return (
    <WgDialog onClose={onClose} label="The three lists" wide className="wcd-printlayer">
      <div className="wg-dlg__head">
        <div>
          <h2>The three lists</h2>
          <p>Friday, Saturday and Sunday, from the queue as it stands. The partners who have waited longest are on Friday.</p>
        </div>
        <button type="button" className="pp-iconbtn" aria-label="Close" data-wcd-close="" onClick={onClose}>
          <Ic n="x" />
        </button>
      </div>
      <div className="wg-dlg__body">
        <div className="wcd-lists3">
          {lists.map(([day, l]) => (
            <div className="wcd-list3" key={day}>
              <h3>
                {day}
                <span>{l.length}</span>
              </h3>
              {l.length ? (
                l.map((r) => (
                  <div className="wcd-l3row" key={r.cid}>
                    <b>{r.name}</b>
                    <span>
                      {r.ruleLabel} · {needText(r)}
                      {r.phone ? ' · ' + r.phone : ''}
                    </span>
                  </div>
                ))
              ) : (
                <div className="wg-sub">None</div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="wg-dlg__foot">
        <small>Ordered by how long each partner has waited</small>
        <span>
          <SheetsButton grid name="cadence-lists" />
          <button
            type="button"
            className="h-btn h-btn--primary h-btn--sm"
            onClick={() => {
              document.body.classList.add('wcd-printing');
              window.print();
              setTimeout(() => document.body.classList.remove('wcd-printing'), 300);
            }}
          >
            <Ic n="print" />
            Print
          </button>
        </span>
      </div>
    </WgDialog>
  );
}
