// One report (/reports/?r=<id>): filters, tiles, the tie-out line, the table, the exports. Port of the report half of public/js/reports.js with
// the same markup and classes. Every figure is drawn as /api/reports/<id> sent it; nothing is recomputed here. A filter change asks the server
// again (the old report stays on screen, dimmed, until the new one arrives).
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { EntityChip } from '@/features/entity/EntityChip';
import { loadScript } from '@/lib/legacy';
import { NavLink } from '@/shell/NavLink';
import { API, BASE, apiUrl, pageUrl, reportQuery, type Col, type Filter, type Report, type Row, type Tie } from './api';
import { loadDrill } from '../highlights/drill';
import { dshort, money, num, pct } from './format';
import { ReportSheetsButton } from './Sheets';
import { toast } from './toast';

const isRight = (c: Col) => c.type === 'money' || c.type === 'int' || c.type === 'pct' || c.type === 'cell' || c.type === 'cellint';
const tileValue = (t: Report['tiles'][number]) => (t.kind === 'money' ? money(t.value) : t.kind === 'int' ? num(t.value) : String(t.value));

const Arrow = ({ d }: { d: 'up' | 'down' | 'both' }) => (
  <svg viewBox="0 0 12 12" aria-hidden="true">
    <path d={d === 'up' ? 'M6 10V2.5M2.8 5.5 6 2.3l3.2 3.2' : d === 'down' ? 'M6 2v7.5M2.8 6.5 6 9.7l3.2-3.2' : 'm3.5 4.5 2.5-2.5 2.5 2.5M3.5 7.5 6 10l2.5-2.5'} />
  </svg>
);

function TieLine({ t }: { t: Tie }) {
  if (t.status === 'none' && !t.note) return null;
  const f = (v: number | null) => (t.kind === 'count' ? num(v) : money(v));
  const check = (
    <svg className="h-i" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12 5 5 9-10" />
    </svg>
  );
  if (t.against) {
    if (t.status === 'match')
      return (
        <div className="rp-tie is-ok">
          <span className="rp-tie__i">{check}</span>
          <div>
            <b>Matches {t.against}</b>
            <span>
              {t.label}: {f(t.kpi)}
              {t.note ? '. ' + t.note : ''}
            </span>
          </div>
        </div>
      );
    return (
      <div className="rp-tie is-warn">
        <span className="rp-tie__i">!</span>
        <div>
          <b>
            Differs from {t.against} by {f(t.diff ?? null)}
          </b>
          <span>
            {t.label}: this report {f(t.mine)}, saved query {f(t.kpi)}
            {t.note ? '. ' + t.note : ''}
          </span>
        </div>
      </div>
    );
  }
  if (t.status === 'match')
    return (
      <div className="rp-tie is-ok">
        <span className="rp-tie__i">{check}</span>
        <div>
          <b>Matches the KPI dashboard</b>
          <span>
            {t.label}: {f(t.kpi)}
          </span>
        </div>
      </div>
    );
  if (t.status === 'differs')
    return (
      <div className="rp-tie is-warn">
        <span className="rp-tie__i">!</span>
        <div>
          <b>Differs from the KPI dashboard by {f(t.diff ?? null)}</b>
          <span>
            This report {f(t.mine)}, {t.label} {f(t.kpi)}
          </span>
        </div>
      </div>
    );
  if (t.status === 'unavailable')
    return (
      <div className="rp-tie is-off">
        <span className="rp-tie__i" aria-hidden="true">
          i
        </span>
        <div>
          <b>KPI figure not available</b>
          <span>{t.note || ''}</span>
        </div>
      </div>
    );
  return (
    <div className="rp-tie is-off">
      <span className="rp-tie__i" aria-hidden="true">
        i
      </span>
      <div>
        <b>Not on the KPI dashboard</b>
        {t.note && t.note !== 'Not on the KPI dashboard.' ? <span>{t.note}</span> : null}
      </div>
    </div>
  );
}

/** Bars by team, from the rows on screen, only when the report has a team column and a money column. */
function TeamBars({ res, rows }: { res: Report; rows: Row[] }) {
  const tc = res.columns.find((c) => /^(team|credited)/i.test(c.key) || /^credited/i.test(c.label));
  const mc = res.columns.find((c) => c.type === 'money');
  if (!tc || !mc || !rows.length) return null;
  const sums: Record<string, number> = {};
  rows.forEach((r) => {
    const k = r[tc.key] as string;
    if (k) sums[k] = (sums[k] || 0) + (Number(r[mc.key]) || 0);
  });
  const keys = Object.keys(sums).sort((a, b) => sums[b] - sums[a]);
  if (!keys.length) return null;
  const max = sums[keys[0]] || 1;
  return (
    <div className="h-card rp-box">
      <div className="rp-k">By {tc.label.toLowerCase()}</div>
      <div className="rp-bars">
        {keys.map((k) => (
          <div className="rp-bar" key={k}>
            <span>{k}</span>
            <i>
              <u style={{ width: Math.max(2, Math.round((sums[k] / max) * 100)) + '%' }} />
            </i>
            <b>{money(sums[k])}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function Cell({ c, v, row, res, onEdit }: { c: Col; v: unknown; row: Row; res: Report; onEdit: (key: string, col: string, value: string) => void }) {
  if (c.type === 'cell' || c.type === 'cellint') {
    const key = (res.editable || []).length ? row.__key || '' : '';
    const shown = v == null ? '' : Number(v).toFixed(c.type === 'cellint' ? 0 : 2);
    return (
      <input
        className="cell"
        key={shown}
        data-edit-key={key}
        data-edit-col={c.key}
        defaultValue={shown}
        inputMode={c.type === 'cellint' ? 'numeric' : 'decimal'}
        aria-label={c.label}
        // A typed cell saves when the person leaves it or presses Enter, once, and only if the text changed.
        onBlur={(e) => {
          if (e.currentTarget.value !== shown) onEdit(key, c.key, e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    );
  }
  if (v == null || v === '') return null;
  // A partner's name opens the same partner card as everywhere else in FavorOS.
  if ((c.key === 'partner' || c.key === 'name') && row && row.__cid && /^\d{1,12}$/.test(String(row.__cid))) return <EntityChip kind="partner" id={String(row.__cid)} label={String(v)} />;
  if (c.type === 'money') return <>{isFinite(Number(v)) ? money(v) : String(v)}</>;
  // A value that is not a number or a date prints as it came, never as NaN or Invalid Date.
  if (c.type === 'int') return <>{isFinite(Number(v)) ? num(v) : String(v)}</>;
  if (c.type === 'date') return <>{dshort(String(v))}</>;
  if (c.type === 'pct') return <>{isFinite(Number(v)) ? pct(v) : String(v)}</>;
  if (c.type === 'chip') {
    const s = String(v);
    const cls = /^(Mailed|Active|Recurring|Thanked)$/.test(s) ? 'rp-tag--ok' : /^(Hold|LYBUNT|Waiting)$/.test(s) ? 'rp-tag--warn' : /^Lapsed$/.test(s) ? 'rp-tag--none' : '';
    return <span className={'rp-tag ' + cls}>{s}</span>;
  }
  // Long text ends in an ellipsis at 420 px on a wide screen; the whole value is in the tooltip and in the export.
  const s = String(v);
  return s.length > 48 ? (
    <span className="rp-cell" title={s}>
      {s}
    </span>
  ) : (
    <>{s}</>
  );
}

function Param({ f, value, onSet }: { f: Filter; value: string; onSet: (id: string, v: string) => void }) {
  if (f.type === 'seg')
    return (
      <div className="rp-f">
        <span>{f.label}</span>
        <div className="rp-seg2" role="group" aria-label={f.label}>
          {(f.options || []).map((o) => (
            <button type="button" key={o[0]} data-f={f.id} data-v={o[0]} className={value === o[0] ? 'is-on' : ''} onClick={() => onSet(f.id, o[0])}>
              {o[1]}
            </button>
          ))}
        </div>
      </div>
    );
  if (f.type === 'select')
    return (
      <label className={'rp-f rp-f--dd' + (value !== f.def ? ' is-set' : '')}>
        <span>{f.label}</span>
        <select data-f={f.id} key={value} defaultValue={value} onChange={(e) => onSet(f.id, e.target.value)}>
          {(f.options || []).map((o) => (
            <option key={o[0]} value={o[0]}>
              {o[1]}
            </option>
          ))}
        </select>
      </label>
    );
  if (f.type === 'date' || f.type === 'month')
    return (
      <label className="rp-f rp-f--dd">
        <span>{f.label}</span>
        <input type={f.type} data-f={f.id} defaultValue={value} key={value} onChange={(e) => onSet(f.id, e.target.value)} />
      </label>
    );
  return (
    <label className="rp-f rp-f--dd">
      <span>{f.label}</span>
      <input
        type="text"
        data-f={f.id}
        defaultValue={value}
        key={value}
        maxLength={80}
        // A text filter asks when the person leaves it or presses Enter, once, and only if the text changed (the classic page's change event).
        onBlur={(e) => {
          if (e.currentTarget.value !== value) onSet(f.id, e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}

/** The report's name goes in the browser tab and in exports; the header keeps the area's name, so the tab row never shifts. */
function useTabTitle(name: string) {
  useEffect(() => {
    const set = () => {
      document.title = name + ' - FavorOS';
    };
    set();
    // The frame sets the tab title in its own effect after this one on a first open; set it again once that has run.
    const t = setTimeout(set, 0);
    return () => clearTimeout(t);
  }, [name]);
}

interface Open {
  id: string;
  asked: Record<string, string>;
  onAsk: (values: Record<string, string>) => void;
}

export function Report({ id, asked, onAsk }: Open) {
  // A new filter asks the server again; until it answers, the report on screen stays and is dimmed.
  const lagging = useDeferredValue(asked);
  const busy = lagging !== asked;
  const { data: res } = useSuspenseQuery(reportQuery(id, lagging));
  useTabTitle(res.name);
  return (
    <div id="rp-app" data-base={BASE} data-api={API} className={busy ? 'is-busy' : undefined}>
      <Body res={res} onAsk={onAsk} />
    </div>
  );
}

function Body({ res, onAsk }: { res: Report; onAsk: (values: Record<string, string>) => void }) {
  const qc = useQueryClient();
  const [sort, setSort] = useState<{ k: string; d: number } | null>(null);
  const [find, setFind] = useState('');
  const [page, setPage] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const toTop = useRef(false);

  // A new answer from the server (a filter) starts on the first page.
  useEffect(() => setPage(0), [res]);
  useEffect(() => loadDrill(), []);
  useEffect(() => {
    // Copy stamps ("As of ...") are painted by public/js/copy-stamp.js, which watches for the spans.
    loadScript('/js/copy-stamp.js?v=2').catch(() => undefined);
  }, []);

  const rows = useMemo(() => {
    let out = res.rows;
    const q = find.toLowerCase();
    if (q) out = out.filter((r) => res.columns.some((c) => String(r[c.key] == null ? '' : r[c.key]).toLowerCase().indexOf(q) >= 0));
    if (sort) {
      out = out.slice().sort((a, b) => {
        let x = a[sort.k];
        let y = b[sort.k];
        if (x == null) x = '';
        if (y == null) y = '';
        return sort.d * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)));
      });
    }
    return out;
  }, [res, find, sort]);

  const ps = res.pageSize;
  const pages = Math.max(1, Math.ceil(rows.length / ps));
  const at = Math.min(page, pages - 1);
  const pageRows = rows.slice(at * ps, at * ps + ps);
  const searching = !!find;
  const hasFlags = res.columns.some((c) => c.total);
  let totals = res.totals;
  if (searching && hasFlags) {
    totals = {};
    res.columns.forEach((c) => {
      if (c.total) {
        let s = 0;
        rows.forEach((r) => (s += Number(r[c.key]) || 0));
        totals[c.key] = Math.round(s * 100) / 100;
      }
    });
  } else if (searching) totals = {};

  useEffect(() => {
    if (toTop.current && scroll.current) scroll.current.scrollTop = 0;
    toTop.current = false;
  }, [at]);

  const shown = res.filters.filter((f) => !f.showWhen || res.values[f.showWhen.id] === f.showWhen.is);
  const setFilter = (fid: string, v: string) => onAsk({ ...res.values, [fid]: v });
  const changed = shown.some((f) => res.values[f.id] !== f.def);
  const tiles = res.tiles;
  const tieOn = (t: Tie) => !(t.status === 'none' && !t.note);
  const hasTie = tieOn(res.tie) || (res.ties || []).some(tieOn);
  const side = res.post != null || !!res.note || teamBarsPresent(res, rows);
  let headAt = 0;
  for (let hi = 0; hi < res.columns.length; hi++) {
    if (['money', 'int', 'pct', 'cell', 'cellint', 'date', 'id', 'chip'].indexOf(res.columns[hi].type || '') < 0) {
      headAt = hi;
      break;
    }
  }
  // A total opens the rows it adds up (the page's own rows, never a new query). Not while searching or when the list is cut short.
  const canOpen = !searching && !res.more;

  const openTotal = (key: string) => {
    const c = res.columns.find((x) => x.key === key);
    const drill = (window as unknown as { FavorDrill?: { open: (o: Record<string, unknown>) => void } }).FavorDrill;
    if (!c || !drill) return;
    let sum = 0;
    res.rows.forEach((r) => (sum += Number(r[key]) || 0));
    const isMoney = c.type === 'money' || c.type === 'cell';
    const total = res.totals ? res.totals[key] : null;
    drill.open({
      title: res.name + ', ' + c.label + ' total',
      shown: total == null ? null : Number(total),
      shownType: isMoney ? 'money' : 'int',
      shownLabel: 'Total on this report',
      columns: res.columns.map((x) => ({ key: x.key, label: x.label, type: x.type === 'money' || x.type === 'cell' ? 'money' : x.type === 'int' ? 'int' : 'text' })),
      rows: res.rows,
      total: Math.round(sum * 100) / 100,
      totalLabel: 'Sum of the rows below',
      rowsLabel: 'Rows in this total',
      sheetTitle: res.name + ' rows',
    });
  };

  const edit = (key: string, col: string, value: string) => {
    fetch(API + '/edit', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' }, body: JSON.stringify({ report: res.id, key, col, value }) })
      .then((r) => r.json())
      .then((d: { ok?: boolean; message?: string }) => {
        if (!d.ok) {
          toast(d.message || 'That did not save.');
          return;
        }
        // The report is read again with the same filters, so the typed cell shows as the server keeps it.
        void qc.invalidateQueries({ queryKey: ['reports', 'one', res.id] });
      })
      .catch(() => toast('That did not save. Check the connection.'));
  };

  const [mailBusy, setMailBusy] = useState(false);
  const [mailUrl, setMailUrl] = useState<{ url: string; rows: number } | null>(null);
  const mailSheet = () => {
    setMailBusy(true);
    fetch(API + '/' + encodeURIComponent(res.id), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' }, body: JSON.stringify({ filters: res.values }) })
      .then((r) => r.json().catch(() => ({})))
      .then((d: { ok?: boolean; message?: string; url?: string; rows?: number }) => {
        if (!d.ok || !d.url) {
          setMailBusy(false);
          toast(d.message || 'The sheet did not build. Try again in a minute.');
          return;
        }
        setMailUrl({ url: d.url, rows: d.rows || 0 });
      })
      .catch(() => {
        setMailBusy(false);
        toast('The sheet did not build. Check the connection.');
      });
  };

  const copyLink = () => {
    const fail = () => toast('Copy did not work. Copy the address bar instead.');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(location.href).then(() => toast('Link copied.'), fail);
    else fail();
  };
  const copyPost = () => {
    const fail = () => toast('Copy did not work. Select the post text and copy it.');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(res.post || '').then(() => toast('Post text copied.'), fail);
    else fail();
  };

  const sortVal = sort ? sort.k + '|' + sort.d : '';
  return (
    <>
      <NavLink className="rp-back" href={BASE}>
        <svg className="h-i" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m15 5-7 7 7 7" />
        </svg>
        All reports
      </NavLink>
      <div className="h-card rp-params">
        {shown.map((f) => (
          <Param key={f.id} f={f} value={res.values[f.id]} onSet={(fid, v) => setFilter(fid, v)} />
        ))}
        <div className="rp-acts">
          {changed ? (
            <button
              type="button"
              className="rp-link"
              id="rp-reset"
              onClick={() => {
                setFind('');
                setSort(null);
                onAsk({});
              }}
            >
              Reset
            </button>
          ) : null}
          {res.post != null ? (
            <button type="button" className="h-btn h-btn--ghost h-btn--sm" id="rp-copy" onClick={copyPost}>
              Copy for WhatsApp
            </button>
          ) : null}
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" id="rp-link" onClick={copyLink}>
            Copy link
          </button>
          <a className="h-btn h-btn--ghost h-btn--sm" id="rp-csv" href={apiUrl(res.id, res.values, 'csv')} download>
            CSV
          </a>
          {res.mailFile ? (
            <>
              <a className="h-btn h-btn--ghost h-btn--sm" id="rp-mailcsv" href={apiUrl(res.id, res.values, 'csv') + '&file=mail'} download>
                {res.mailFile.label} CSV
              </a>
              {mailUrl ? (
                <a className="h-btn h-btn--primary h-btn--sm" id="rp-mailsheet-open" target="_blank" rel="noopener" href={mailUrl.url}>
                  Open the sheet ({num(mailUrl.rows)} rows)
                </a>
              ) : (
                <button type="button" className="h-btn h-btn--ghost h-btn--sm" id="rp-mailsheet" disabled={mailBusy} onClick={mailSheet}>
                  {mailBusy ? 'Building the sheet' : res.mailFile.label + ' to Sheets'}
                </button>
              )}
            </>
          ) : null}
          <ReportSheetsButton
            build={() =>
              fetch(apiUrl(res.id, res.values, 'sheet'), { credentials: 'same-origin' })
                .then((r) => r.json().catch(() => ({})))
                .then((d: { ok?: boolean; message?: string; spec?: unknown }) => {
                  if (!d.ok) throw new Error(d.message || 'The sheet did not build.');
                  return d.spec;
                })
            }
          />
        </div>
      </div>

      {tiles.length || hasTie ? (
        <div className="h-card rp-sum">
          {tiles.map((t, i) => (
            <div key={i} className={'rp-tile' + (i === 0 ? ' is-hero' : '') + (i > 0 && i === tiles.length - 1 && i % 2 === 1 ? ' rp-tile--wide' : '')}>
              <div className="k">{t.label}</div>
              <div className="n">{tileValue(t)}</div>
              <div className="s">{t.sub || ''}</div>
            </div>
          ))}
          <TieLine t={res.tie} />
          {(res.ties || []).map((t, i) => (
            <TieLine key={i} t={t} />
          ))}
        </div>
      ) : null}

      <div className={'rp-main' + (side ? '' : ' is-solo')}>
        <div>
          <div className="h-card rp-tcard">
            <div className="rp-thead">
              <span className="cnt">
                Rows <small>{num(rows.length)}</small> <span className="copy-stamp" data-copy-stamp suppressHydrationWarning />
                {res.more ? (
                  <>
                    {' '}
                    <em>
                      first {num(res.rows.length)} of {num(res.count)}
                    </em>
                  </>
                ) : null}
              </span>
              <label className="rp-find">
                <svg className="h-i" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  type="search"
                  id="rp-find"
                  placeholder="Search these rows"
                  value={find}
                  aria-label="Search these rows"
                  onChange={(e) => {
                    setFind(e.target.value);
                    setPage(0);
                  }}
                />
              </label>
              <label className="rp-sortm">
                <span>Sort</span>
                <select
                  id="rp-sortm"
                  aria-label="Sort rows"
                  value={sortVal}
                  onChange={(e) => {
                    const p = e.target.value.split('|');
                    setSort(p[0] ? { k: p[0], d: Number(p[1]) } : null);
                    setPage(0);
                  }}
                >
                  <option value="">Report order</option>
                  {res.columns.map((c) => {
                    const t = isRight(c) || c.type === 'date';
                    return [1, -1].map((d) => (
                      <option key={c.key + d} value={c.key + '|' + d}>
                        {c.label}, {t ? (d > 0 ? 'low to high' : 'high to low') : d > 0 ? 'A to Z' : 'Z to A'}
                      </option>
                    ));
                  })}
                </select>
              </label>
            </div>
            <div className="rp-scroll" ref={scroll}>
              <table className="rp-table sc-table">
                <thead>
                  <tr>
                    {res.columns.map((c) => {
                      const on = !!sort && sort.k === c.key;
                      return (
                        <th
                          key={c.key}
                          className={(isRight(c) ? 'r ' : '') + (on ? 'is-sort' : '')}
                          data-sort={c.key}
                          aria-sort={on ? (sort!.d > 0 ? 'ascending' : 'descending') : 'none'}
                          onClick={() => setSort(sort && sort.k === c.key ? { k: c.key, d: -sort.d } : { k: c.key, d: 1 })}
                        >
                          <button type="button">
                            {c.label}
                            <span className="ar">
                              <Arrow d={on ? (sort!.d > 0 ? 'up' : 'down') : 'both'} />
                            </span>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r, ri) => (
                    <tr key={(r.__key as string) || at * ps + ri}>
                      {res.columns.map((c, ci) => (
                        <td key={c.key} data-label={c.label} className={(isRight(c) ? 'r' : c.type === 'id' ? 'id' : '') + (ci === headAt ? ' rp-hd' : '')}>
                          <Cell c={c} v={r[c.key]} row={r} res={res} onEdit={edit} />
                        </td>
                      ))}
                    </tr>
                  ))}
                  {!pageRows.length ? (
                    <tr>
                      <td colSpan={res.columns.length} className="rp-empty">
                        No rows for these filters.{' '}
                        <button type="button" className="rp-link" id="rp-clear" onClick={() => setFind('')}>
                          Clear
                        </button>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
                {Object.keys(totals).length ? (
                  <tfoot>
                    <tr>
                      {res.columns.map((c, i) => {
                        const v = totals[c.key];
                        let txt: React.ReactNode = i === 0 ? 'Total' : v == null ? '' : c.type === 'money' || c.type === 'cell' ? money(v) : num(v);
                        if (canOpen && i > 0 && v != null)
                          txt = (
                            <span
                              className="dr-num"
                              tabIndex={0}
                              role="button"
                              data-report-total={c.key}
                              onClick={() => openTotal(c.key)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  openTotal(c.key);
                                }
                              }}
                            >
                              {txt}
                            </span>
                          );
                        return (
                          <td key={c.key} data-label={c.label} className={(isRight(c) ? 'r' : '') + (i === 0 ? ' rp-hd' : '')}>
                            {txt}
                          </td>
                        );
                      })}
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
            {rows.length > ps ? (
              <div className="rp-pager">
                <button
                  type="button"
                  className="h-btn h-btn--ghost h-btn--sm"
                  id="rp-prev"
                  disabled={!at}
                  onClick={() => {
                    toTop.current = true;
                    setPage(at - 1);
                  }}
                >
                  Previous
                </button>
                <span>
                  {at * ps + 1} to {Math.min(rows.length, at * ps + ps)} of {num(rows.length)}
                </span>
                <button
                  type="button"
                  className="h-btn h-btn--ghost h-btn--sm"
                  id="rp-next"
                  disabled={!(at + 1 < pages)}
                  onClick={() => {
                    toTop.current = true;
                    setPage(at + 1);
                  }}
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {side ? (
          <aside className="rp-side">
            <TeamBars res={res} rows={rows} />
            {res.post != null ? (
              <div className="h-card rp-box">
                <div className="rp-k">Post text</div>
                <div className="rp-pre" id="rp-pre">
                  {res.post}
                </div>
              </div>
            ) : null}
            {res.note ? (
              <div className="h-card rp-box">
                <p className="rp-note">{res.note}</p>
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
    </>
  );
}

/** Whether the team bars have anything to draw (the same test TeamBars makes). */
function teamBarsPresent(res: Report, rows: Row[]): boolean {
  const tc = res.columns.find((c) => /^(team|credited)/i.test(c.key) || /^credited/i.test(c.label));
  const mc = res.columns.find((c) => c.type === 'money');
  if (!tc || !mc || !rows.length) return false;
  return rows.some((r) => !!r[tc.key]);
}

