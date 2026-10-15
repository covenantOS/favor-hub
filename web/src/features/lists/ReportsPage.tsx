// Reporting > Standard reports (/lists/reports/): pick a report, set the period, read the rows and the tie to the KPI dashboard, press a row
// to see the partners or gifts behind it. Every figure comes from /api/lists/report; this page only draws it. A row's drill opens the Lists
// page with the criteria already set. The open report is in the address (?r=<id>); its period and options are held here.
import '@hub/styles/reports.css';
import '@hub/styles/lists.css';
import { Component, Fragment, Suspense, startTransition, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { EntityChip } from '@/features/entity/EntityChip';
import { reportQuery, reportsQuery, type ReportCol, type ReportItem, type ReportResult, type ReportsList, type Row } from './api';
import { day, money, num } from './fmt';
import { encodeSpec } from './spec';

export interface ReportsSearch { r?: string }

export function ReportsFallback() {
  return (
    <>
      <div id="lr-app" data-api="/api/lists/report">
        <p className="rp-note rp-loading">Loading</p>
      </div>
      <div className="rp-toast" id="lr-toast" role="status" />
    </>
  );
}

export function ReportsError({ message }: { message: string }) {
  return (
    <div id="lr-app" data-api="/api/lists/report">
      <div className="h-card ls-pad">
        <p className="rp-note">{message || 'Reports did not load.'}</p>
      </div>
    </div>
  );
}

export function ReportsPage({ search }: { search: ReportsSearch }) {
  return (
    <Suspense fallback={<ReportsFallback />}>
      <Reports search={search} />
    </Suspense>
  );
}

function Reports({ search }: { search: ReportsSearch }) {
  const { data: list } = useSuspenseQuery(reportsQuery);
  const navigate = useNavigate();
  // The report in the address counts only when the list has it; any other address shows the menu.
  const id = search.r && list.reports.some((x) => x.id === search.r) ? search.r : '';
  const [values, setValuesNow] = useState<Record<string, string>>({});
  // A change of period or option keeps the report on screen (dimmed) until the new answer arrives, as the classic page does, instead of
  // dropping back to the loading box.
  const [busy, setBusy] = useState(false);
  const setValues = (v: Record<string, string>) => {
    setBusy(true);
    startTransition(() => {
      setValuesNow(v);
      setBusy(false);
    });
  };
  const go = (r: string) => void navigate({ to: '/lists/reports/', search: r ? { r } : {}, replace: true, resetScroll: false });
  return id ? (
    <ReportBoundary resetKey={id + JSON.stringify(values)}>
      <Suspense fallback={<ReportsFallback />}>
        <Report list={list} id={id} values={values} busy={busy} setValues={setValues} onBack={() => go('')} />
      </Suspense>
    </ReportBoundary>
  ) : (
    <Menu
      list={list}
      onPick={(r) => {
        setValuesNow({});
        go(r);
      }}
    />
  );
}

/** A report that cannot open (the server refuses a person limited to their own partners) says why in the same card the classic page uses. */
class ReportBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null; key: string }> {
  state = { error: null as Error | null, key: this.props.resetKey };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  static getDerivedStateFromProps(p: { resetKey: string }, st: { error: Error | null; key: string }) {
    return p.resetKey !== st.key ? { error: null, key: p.resetKey } : null;
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <ReportsError message={this.state.error.message || 'The report did not load.'} />;
  }
}

function Menu({ list, onPick }: { list: ReportsList; onPick: (id: string) => void }) {
  return (
    <>
      <div id="lr-app" data-api="/api/lists/report">
        <div className="lr-grid">
          {['Giving', 'Partners', 'Team'].map((g) => (
            <div className="h-card lr-grp" key={g}>
              <div className="rp-k">{g}</div>
              {list.reports
                .filter((r) => r.group === g)
                .map((r: ReportItem) => (
                  <button type="button" className="lr-item" data-id={r.id} key={r.id} disabled={!r.open} onClick={() => onPick(r.id)}>
                    <b>{r.name}</b>
                    <small>{r.about}</small>
                  </button>
                ))}
            </div>
          ))}
        </div>
      </div>
      <div className="rp-toast" id="lr-toast" role="status" />
    </>
  );
}

const right = (c: ReportCol) => c.type === 'money' || c.type === 'int';

function cell(c: ReportCol, v: unknown): string {
  if (v == null || v === '') return '';
  if (c.type === 'money') return money(v);
  if (c.type === 'int') return num(v as number);
  if (c.type === 'date') return day(v);
  return String(v);
}

// A partner's name on a report row opens the same partner card as everywhere else.
function NameCell({ r, c }: { r: Row; c: ReportCol }) {
  const v = r[c.key];
  if (c.key !== 'partner' || !r._cid || !v) return <>{cell(c, v)}</>;
  return <EntityChip kind="partner" id={String(r._cid)} label={String(v)} />;
}

function Report({ list, id, values, busy, setValues, onBack }: { list: ReportsList; id: string; values: Record<string, string>; busy: boolean; setValues: (v: Record<string, string>) => void; onBack: () => void }) {
  const navigate = useNavigate();
  const { data: res } = useSuspenseQuery(reportQuery(id, values));
  // A new answer draws new elements instead of editing the old ones in place, so right-aligned columns that change width do not count as the page shifting.
  const shown = id + JSON.stringify(values);
  const drill = (r: Row) => void navigate({ to: '/lists/', search: { spec: encodeSpec(r._drill) } });
  const rowProps = (r: Row) =>
    r._drill
      ? {
          tabIndex: 0,
          'data-drill': encodeSpec(r._drill),
          onClick: (e: MouseEvent) => {
            // A partner's name in the row opens the partner, not the list behind the row.
            if ((e.target as Element).closest('a')) return;
            drill(r);
          },
          onKeyDown: (e: KeyboardEvent) => e.key === 'Enter' && drill(r),
        }
      : {};
  const prim = res.columns.find((c) => c.key === res.primary) || res.columns[res.columns.length - 1];
  const nameCols = res.columns.filter((c) => c.type === 'text' && c !== prim).slice(0, res.id === 'status' ? 2 : 1);
  const restCols = res.columns.filter((c) => c !== prim && !nameCols.includes(c) && c.key !== 'role');
  const drillable = res.rows.some((r) => r._drill);
  const set = (k: string, v: string) => {
    const next = { ...values, [k]: v };
    if (k === 'period' && v === 'custom') {
      next.from = res.from;
      next.to = res.to;
    }
    setValues(next);
  };
  return (
    <>
      <div id="lr-app" data-api="/api/lists/report" className={busy ? 'is-busy' : undefined}>
        <div className="lr-head">
          <button type="button" className="ls-link" id="lr-back" onClick={onBack}>
            All reports
          </button>
          <h2>{res.name}</h2>
        </div>
        {res.params.length ? (
          <div className="h-card lr-bar">
            <Params res={res} list={list} values={values} set={set} />
            <span className="lr-range">{day(res.from) + ' to ' + day(res.to)}</span>
          </div>
        ) : null}
        <div className="h-card ls-sumc" key={'sum' + shown}>
          <div className="lr-tiles">
            {res.tiles.map((t, i) => (
              <div className="lr-tile" key={i}>
                <b>{t.kind === 'money' ? money(t.value) : t.kind === 'int' ? num(t.value) : String(t.value)}</b>
                <span>{t.label}</span>
              </div>
            ))}
          </div>
          {res.ties.map((t, i) => {
            const cls = t.status === 'match' ? 'is-ok' : t.status === 'differs' ? 'is-warn' : 'is-off';
            const fig = (n: number) => (n % 1 !== 0 ? money(n) : num(n));
            return (
              <div className={'ls-tie ' + cls} key={i}>
                <span className="ls-tie__i" aria-hidden="true">
                  {t.status === 'match' ? '✓' : '≠'}
                </span>
                <div>
                  <b>{t.status === 'match' ? 'Ties to the KPI dashboard' : t.status === 'differs' ? 'Differs from the KPI dashboard' : 'KPI dashboard not answering'}</b>
                  <span>
                    {t.label + ': ' + (t.kpi == null ? '—' : typeof t.kpi === 'number' && Math.abs(t.kpi) >= 1000 && t.mine % 1 !== 0 ? money(t.kpi) : num(t.kpi)) + (t.status === 'differs' ? ' · here ' + fig(t.mine) + (t.note ? ' · ' + t.note : '') : '')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="lr-cards" key={'cards' + shown}>
          {res.rows.map((r, i) => {
            const sub = restCols
              .map((c) => (r[c.key] === '' || r[c.key] == null ? '' : c.label + ' ' + cell(c, r[c.key])))
              .filter(Boolean)
              .join(' · ');
            return (
              <div className={'lr-card' + (r._drill ? ' lr-row' : '')} key={i} {...rowProps(r)}>
                <div>
                  <b>
                    {nameCols.map((c, j) => (
                      <span key={c.key}>
                        {j ? ' · ' : ''}
                        <NameCell r={r} c={c} />
                      </span>
                    ))}
                  </b>
                  {sub ? <span>{sub}</span> : null}
                </div>
                <strong>{cell(prim, r[prim.key])}</strong>
              </div>
            );
          })}
        </div>
        <div className="h-card ls-tcard lr-wide" key={'wide' + shown}>
          <div className="ls-scroll rp-scroll">
            <table className="rp-table ls-t">
              <thead>
                <tr>
                  {res.columns.map((c) => (
                    <th key={c.key} className={right(c) ? 'r' : ''}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {res.rows.length ? (
                  res.rows.map((r, i) => (
                    <tr key={i} className={r._drill ? 'lr-row' : undefined} {...rowProps(r)}>
                      {res.columns.map((c) => (
                        <td key={c.key} className={right(c) ? 'r' : ''}>
                          <NameCell r={r} c={c} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="rp-empty" colSpan={res.columns.length}>
                      No rows
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {drillable ? (
            <div className="rp-pager">
              <span>Press a row to see the rows behind it</span>
            </div>
          ) : null}
        </div>
        {res.note ? <p className="rp-note lr-note">{res.note}</p> : null}
      </div>
      <div className="rp-toast" id="lr-toast" role="status" />
    </>
  );
}

function Params({ res, list, values, set }: { res: ReportResult; list: ReportsList; values: Record<string, string>; set: (k: string, v: string) => void }) {
  return (
    <>
      {res.params.map((p) => {
        const cur = values[p.id] != null ? values[p.id] : (res.values && res.values[p.id]) || p.def;
        const opts = p.type === 'period' ? list.periods : p.options;
        return (
          <Fragment key={p.id}>
            <label className="lr-p">
              <span>{p.label}</span>
              <select data-p={p.id} value={cur} onChange={(e) => set(p.id, e.target.value)}>
                {opts.map((o) => (
                  <option key={o[0]} value={o[0]}>
                    {o[1]}
                  </option>
                ))}
              </select>
            </label>
            {p.type === 'period' && cur === 'custom' ? (
              <>
                <label className="lr-p">
                  <span>From</span>
                  <input type="date" data-p="from" value={values.from || res.from} onChange={(e) => set('from', e.target.value)} />
                </label>
                <label className="lr-p">
                  <span>To</span>
                  <input type="date" data-p="to" value={values.to || res.to} onChange={(e) => set('to', e.target.value)} />
                </label>
              </>
            ) : null}
          </Fragment>
        );
      })}
    </>
  );
}
