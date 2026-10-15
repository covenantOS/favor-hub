// The table block: a card with the first rows, sortable headers, filter chips, Copy, CSV, Google Sheets and Open large; in a
// narrow answer (dock, phone) five rows with one key field and Open full table (container query in brain.css). The large view
// (the page's side panel) is TablePanel, on the same state, so a sort or filter shows in both.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { bandStep, dlong, int, money, nounOf, shortTitle } from '../fmt';
import { Ic } from '../icons';
import { pop } from '../pop';
import { brainCall } from '../api';
import type { Block } from '../types';
import { tableKey, type BlockCtx, type BlockProps } from './ctx';

export interface Col {
  key: string;
  label: string;
  type?: string;
  panel_only?: boolean;
}
export interface TableState {
  b: Block;
  rows: Record<string, any>[];
  cols: Col[];
  f: Record<string, string>;
  q: string;
  sort: string | null;
  dir: 'asc' | 'desc';
  preview: number;
  count: number;
  more: boolean;
  partial: boolean;
  expired: boolean;
  loaded?: boolean;
  loading?: boolean;
  sheetUrl?: string;
  sheetBusy?: boolean;
}

const STATES = new WeakMap<Block, TableState>();
export function tableState(b: Block, expired = false): TableState {
  let s = STATES.get(b);
  if (!s) {
    const rows = (b.rows || []) as Record<string, any>[];
    s = {
      b,
      rows,
      cols: (b.cols || []) as Col[],
      f: {},
      q: '',
      sort: b.sort ? b.sort.key : null,
      dir: b.sort ? b.sort.dir : 'desc',
      preview: b.preview || 8,
      count: b.count || rows.length,
      more: !!b.more,
      partial: (b.count || 0) > rows.length,
      expired,
    };
    STATES.set(b, s);
  }
  return s;
}

const isNum = (c: Col) => ['money', 'score', 'int', 'pct'].includes(c.type || '');
const sortVal = (c: Col, x: Record<string, any>) => (c.type === 'band' ? bandStep(x[c.key]) : x[c.key]);
export function tableRows(tb: TableState) {
  let rows = tb.rows.slice();
  for (const [k, v] of Object.entries(tb.f)) rows = rows.filter((x) => String(x[k] ?? 'None') === v);
  if (tb.q) {
    const q = tb.q.toLowerCase();
    rows = rows.filter((x) => tb.cols.some((c) => String(x[c.key] ?? '').toLowerCase().includes(q)));
  }
  if (tb.sort) {
    const c = tb.cols.find((c) => c.key === tb.sort);
    if (c) {
      const dir = tb.dir === 'asc' ? 1 : -1;
      rows.sort((a, b) => {
        const va = sortVal(c, a);
        const vb = sortVal(c, b);
        if (va == null || va === '') return 1;
        if (vb == null || vb === '') return -1;
        return (va > vb ? 1 : va < vb ? -1 : 0) * dir;
      });
    }
  }
  return rows;
}
const rowLabel = (tb: TableState, n: number) => `${int(n)} ${tb.b.noun ? (Number(n) === 1 ? String(tb.b.noun).replace(/s$/, '') : tb.b.noun) : Number(n) === 1 ? 'row' : 'rows'}`;

function Score({ v, max = 4 }: { v: number | null; max?: number }) {
  if (v == null) return <span className="ns">Not rated</span>;
  return (
    <span className="scw">
      <span className={'score' + (v >= max ? ' hi' : '')} aria-hidden="true">
        {Array.from({ length: max }, (_, k) => (
          <i key={k} className={k + 1 <= v ? 'on' : ''} />
        ))}
      </span>
      <b className="scn">{v}</b>
    </span>
  );
}
export function Band({ label }: { label: string | null | undefined }) {
  return label ? (
    <span className={'band b' + bandStep(label)}>
      <i />
      {label}
    </span>
  ) : (
    <span className="ns">Not stored</span>
  );
}

function Cell({ c, x, ctx }: { c: Col; x: Record<string, any>; ctx: BlockCtx }) {
  const v = x[c.key];
  const none = <span className="ns">&mdash;</span>;
  switch (c.type) {
    case 'name': {
      if (v == null || v === '') return <span className="ns">None</span>;
      const q = x.lookup_id ? `Tell me about lookup ${x.lookup_id}` : `Tell me about ${v}${x.place ? ' in ' + x.place : ''}`;
      return (
        <a
          href="#"
          className="lk"
          title={String(v)}
          {...(x.lookup_id ? { 'data-entity': 'partner:L' + x.lookup_id, 'data-label': String(v), 'data-partner-lookup': String(x.lookup_id) } : {})}
          onClick={(e) => {
            e.preventDefault();
            ctx.ask(q, 'partner_lookup');
          }}
        >
          {String(v)}
        </a>
      );
    }
    case 'money':
      return v == null || v === '' ? none : <>{money(v)}</>;
    case 'int':
      return v == null || v === '' ? none : <>{int(v)}</>;
    case 'pct':
      return v == null || v === '' ? none : <>{v + '%'}</>;
    case 'score':
      return <Score v={v == null || v === '' ? null : Number(v)} />;
    case 'band':
      return <Band label={v} />;
    case 'date':
      return v ? <>{dlong(v)}</> : <span className="ns">None</span>;
    default:
      return v == null || v === '' ? null : <>{String(v)}</>;
  }
}

function Grid({ tb, all, ctx }: { tb: TableState; all: boolean; ctx: BlockCtx }) {
  const rows = tableRows(tb);
  const show = all ? rows : rows.slice(0, tb.preview);
  const cols = all ? tb.cols : tb.cols.filter((c) => !c.panel_only);
  const sortBy = (k: string) => {
    if (tb.sort === k) tb.dir = tb.dir === 'asc' ? 'desc' : 'asc';
    else {
      tb.sort = k;
      const c = tb.cols.find((c) => c.key === k);
      tb.dir = c && ['name', 'text'].includes(c.type || '') ? 'asc' : 'desc';
    }
    ctx.engine.touch();
  };
  return (
    <table className="t sc-table">
      <caption className="bc-sr">
        {tb.b.title}, {int(rows.length)} {rows.length === 1 ? 'row' : 'rows'}
      </caption>
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c.key} className={isNum(c) ? 'num' : ''} aria-sort={tb.sort === c.key ? (tb.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
              <button type="button" onClick={() => sortBy(c.key)}>
                {c.label}
                <Ic n="sort" className="h-i ar" />
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {show.map((x, i) => (
          <tr key={i}>
            {cols.map((c, ci) => (
              <td key={c.key} className={(isNum(c) ? 'num' : '') + (ci === 0 ? ' nm' : '')}>
                <Cell c={c} x={x} ctx={ctx} />
              </td>
            ))}
          </tr>
        ))}
        {!show.length && (
          <tr>
            <td colSpan={cols.length} className="dim" style={{ textAlign: 'center', padding: 22 }}>
              Nothing matches.{' '}
              <button
                type="button"
                className="else"
                onClick={() => {
                  tb.f = {};
                  tb.q = '';
                  ctx.engine.touch();
                }}
              >
                Clear the filters
              </button>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function chipValues(tb: TableState, k: string) {
  const counts = new Map<string, number>();
  tb.rows.forEach((x) => {
    const v = String(x[k] ?? 'None');
    counts.set(v, (counts.get(v) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
function Chips({ tb, ctx, style }: { tb: TableState; ctx: BlockCtx; style?: React.CSSProperties }) {
  const chips = (tb.b.chips || []) as { key: string; label: string }[];
  // Only chips whose column carries more than one value in these rows are worth a button.
  const live = chips.filter((c) => tb.f[c.key] || new Set(tb.rows.map((x) => String(x[c.key] ?? 'None'))).size > 1);
  if (!live.length) return null;
  return (
    <div className="tbl__chips" style={style}>
      {live.map((c) =>
        tb.f[c.key] ? (
          <button
            key={c.key}
            type="button"
            className="chip is-on chip--x"
            aria-label={'Remove the ' + c.label + ' filter'}
            onClick={() => {
              delete tb.f[c.key];
              ctx.engine.touch();
            }}
          >
            {c.label}: <b>{tb.f[c.key]}</b>
            <Ic n="close" />
          </button>
        ) : (
          <button
            key={c.key}
            type="button"
            className="chip"
            aria-haspopup="menu"
            onClick={(e) =>
              pop.open(
                e.currentTarget,
                chipValues(tb, c.key)
                  .slice(0, 40)
                  .map(([v, n]) => ({ v, label: v, aside: n })),
                (v) => {
                  tb.f[c.key] = v;
                  ctx.engine.touch();
                },
                c.label,
              )
            }
          >
            {c.label}
            <Ic n="caret" />
          </button>
        ),
      )}
    </div>
  );
}

// ---- Copy, CSV, Google Sheets ------------------------------------------------------------------------------------------
const tsv = (tb: TableState) => {
  const val = (c: Col, x: Record<string, any>) => (x[c.key] == null ? '' : String(x[c.key]).replace(/[\t\r\n]+/g, ' '));
  return [tb.cols.map((c) => c.label).join('\t'), ...tableRows(tb).map((x) => tb.cols.map((c) => val(c, x)).join('\t'))].join('\n');
};
const csv = (tb: TableState) => {
  const q = (v: unknown) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // a cell that starts like a formula opens as text
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [tb.cols.map((c) => q(c.label)).join(','), ...tableRows(tb).map((x) => tb.cols.map((c) => q(x[c.key])).join(','))].join('\r\n');
};
const SHEET_TYPE: Record<string, string> = { name: 'text', text: 'text', int: 'int', money: 'money', date: 'date', pct: 'percent', score: 'int', band: 'text' };
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
async function makeSheet(tb: TableState, ctx: BlockCtx) {
  const FS = (window as any).FavorSheets;
  if (!FS) return;
  tb.sheetBusy = true;
  ctx.engine.touch();
  const filtered = Object.keys(tb.f).length || tb.q;
  const b = tb.b;
  const page = ctx.where === 'dock' ? location.pathname : '/brain/';
  const spec =
    b.token && !filtered && !tb.expired
      ? { mode: 'brain', tokens: [b.token], dedupe: 'brain:' + b.token, title: b.sheet_title || b.title, provenance: { kind: 'brain', page, asked: ctx.turn.q } }
      : {
          mode: 'rows',
          tabs: [{ name: String(b.sheet_title || b.title || 'List').slice(0, 90), columns: tb.cols.map((c) => ({ key: c.key, label: c.label, type: SHEET_TYPE[c.type || ''] || 'text' })), rows: tableRows(tb).map((x) => Object.fromEntries(tb.cols.map((c) => [c.key, x[c.key] == null ? null : x[c.key]]))), more: tb.more, note: b.note || '' }],
          title: b.sheet_title || b.title,
          provenance: { kind: 'screen', page, asked: ctx.turn.q, filters: filtered ? 'Filtered: ' + Object.entries(tb.f).map(([k, v]) => k + ' ' + v).concat(tb.q ? ['search ' + tb.q] : []).join(', ') : '' },
        };
  const r = await FS.run(spec, { navigate: false });
  tb.sheetBusy = false;
  const t = ctx.turn;
  if (r.ok) {
    tb.sheetUrl = r.url;
    t.extras = (t.extras || []).filter((x) => x.type !== 'consent');
    t.extras.push({ type: 'sheet', title: r.title, url: r.url, rows: (r.tabs || []).reduce((n: number, x: { rows: number }) => n + x.rows, 0), private: r.private !== false });
    ctx.engine.sheetMade(r);
    ctx.engine.toast('Your sheet is ready in Google Drive', { href: r.url, label: 'Open it' });
  } else if (r.error === 'consent' || r.error === 'not_connected') {
    t.extras = (t.extras || []).filter((x) => x.type !== 'consent');
    t.extras.push({ type: 'consent', consent_url: r.consentUrl || r.connectUrl, _spec: spec });
  } else ctx.engine.toast(r.message || 'The sheet did not build. The CSV still works.');
  ctx.engine.touch();
}

function Tools({ tb, ctx, inPanel }: { tb: TableState; ctx: BlockCtx; inPanel: boolean }) {
  const canSheets = ctx.engine.canSheets();
  return (
    <>
      <button
        type="button"
        className="h-btn h-btn--ghost h-btn--xs tb-ic"
        aria-label="Copy the table"
        data-tip="Copy"
        onClick={async () => {
          const ok = await copyText(tsv(tb));
          ctx.engine.toast(ok ? `Copied ${tableRows(tb).length} rows. Paste into any sheet.` : 'Your browser would not copy. Use CSV.');
        }}
      >
        <Ic n="copy" />
        <span className="lbl-l">Copy</span>
      </button>
      <button
        type="button"
        className="h-btn h-btn--ghost h-btn--xs tb-ic"
        aria-label="Download a CSV"
        data-tip="Download CSV"
        onClick={() => {
          const b = tb.b;
          const a = document.createElement('a');
          if (b.csv && tb.partial && !Object.keys(tb.f).length && !tb.q) {
            a.href = b.csv;
            a.download = '';
            ctx.engine.toast('Downloading the CSV. The link works for 24 hours.');
          } else {
            const url = URL.createObjectURL(new Blob(['﻿' + csv(tb)], { type: 'text/csv;charset=utf-8' }));
            a.href = url;
            a.download = String(b.sheet_title || b.title || 'list').replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-') + '.csv';
            setTimeout(() => URL.revokeObjectURL(url), 4000);
            ctx.engine.toast('Downloading the rows you see.');
          }
          document.body.appendChild(a);
          a.click();
          a.remove();
        }}
      >
        <Ic n="dl" />
        <span className="lbl-l">CSV</span>
      </button>
      {canSheets &&
        (tb.sheetUrl ? (
          <a className="h-btn h-btn--primary h-btn--xs" href={tb.sheetUrl} target="_blank" rel="noopener">
            <Ic n="ext" />
            <span>Open the sheet</span>
          </a>
        ) : (
          <button type="button" className="h-btn h-btn--ghost h-btn--xs" data-sheetbtn disabled={tb.sheetBusy} onClick={() => void makeSheet(tb, ctx)}>
            {tb.sheetBusy ? <span className="spin d" /> : <Ic n="sheet" />}
            <span>{tb.sheetBusy ? 'Creating the sheet' : 'Open in Google Sheets'}</span>
          </button>
        ))}
      {!inPanel && (
        <button type="button" className="ib ib--sm" aria-label="Open large" data-tip="Open large" onClick={() => ctx.openTable(tableKey(ctx.ti, ctx.bi))}>
          <Ic n="expand" />
        </button>
      )}
    </>
  );
}

export function TableBlock({ b, ctx }: BlockProps) {
  const tb = tableState(b, ctx.expired);
  const n = tb.count || tb.rows.length;
  const rows = tableRows(tb);
  const shown = Math.min(tb.preview, rows.length);
  const filtered = Object.keys(tb.f).length || tb.q;
  const sub = filtered ? `${int(rows.length)} of ${rowLabel(tb, n)} match` : n > shown ? `${int(shown)} of ${rowLabel(tb, n)}` : rowLabel(tb, n);
  const title = shortTitle(b.title, nounOf(b));
  const mini = rows.slice(0, 5);
  const name = tb.cols[0];
  const key = tb.cols.slice(1).find((c) => !c.panel_only && ['money', 'date', 'int'].includes(c.type || '')) || tb.cols.slice(1).find((c) => !c.panel_only);
  const open = () => ctx.openTable(tableKey(ctx.ti, ctx.bi));
  return (
    <div className="card blk-table">
      <div className="card__h">
        <div>
          <div className="card__t" title={b.title}>
            {title}
          </div>
          <div className="card__s">
            {sub}
            {b.more ? '+' : ''}
          </div>
        </div>
        <div className="card__acts">{!ctx.expired && <Tools tb={tb} ctx={ctx} inPanel={false} />}</div>
      </div>
      <Chips tb={tb} ctx={ctx} />
      {mini.length > 0 && name && (
        <>
          <ul className="tbl__mini" aria-label={title + ', first ' + mini.length}>
            {mini.map((x, i) => (
              <li key={i}>
                <span className="mn">
                  <Cell c={name} x={x} ctx={ctx} />
                </span>
                {key && (
                  <span className="mk">
                    <Cell c={key} x={x} ctx={ctx} />
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="tbl__minifoot">
            <button type="button" className="h-btn h-btn--ghost h-btn--xs" onClick={open}>
              Open full table{n > mini.length ? ` (${int(n)})` : ''} <Ic n="arrow" />
            </button>
          </div>
        </>
      )}
      <ScrollFade>
        <Grid tb={tb} all={false} ctx={ctx} />
      </ScrollFade>
      {ctx.expired ? (
        <div className="bc-expired">
          Expired. Lists last 24 hours.
          <button type="button" className="h-btn h-btn--ghost h-btn--xs" onClick={() => ctx.engine.again(ctx.ti)}>
            Ask again
          </button>
        </div>
      ) : n > tb.preview || tb.partial ? (
        <div className="tbl__foot">
          <span>
            Showing {int(Math.min(tb.preview, rows.length))} of {int(filtered ? rows.length : n)}
            {b.more ? '+' : ''}
          </span>
          <button type="button" className="h-btn h-btn--ghost h-btn--xs" onClick={open}>
            Show all <Ic n="arrow" />
          </button>
        </div>
      ) : null}
      {b.note && (
        <div className="tbl__foot">
          <span>{b.note}</span>
        </div>
      )}
    </div>
  );
}

/** A table wider than its card scrolls sideways, with a fade on each edge that has more to see. */
function ScrollFade({ children }: { children: React.ReactNode }) {
  const [edge, setEdge] = useState({ l: false, r: false, fw: 0 });
  const measure = (s: HTMLDivElement | null) => {
    if (!s) return;
    const th = s.querySelector('th') as HTMLElement | null;
    const n = { l: s.scrollLeft > 4, r: s.scrollWidth - s.clientWidth - s.scrollLeft > 4, fw: th ? th.offsetWidth : 0 };
    if (n.l !== edge.l || n.r !== edge.r || n.fw !== edge.fw) setEdge(n);
  };
  return (
    <div className={'tbl__wrap' + (edge.r ? ' more-r' : '') + (edge.l ? ' more-l' : '')} style={{ ['--fw' as string]: edge.fw + 'px' }}>
      <div className="tbl__scroll" tabIndex={0} role="region" aria-label="Scroll sideways for every column" ref={measure} onScroll={(e) => measure(e.currentTarget)}>
        {children}
      </div>
    </div>
  );
}

/** One table shown large: the filter box, Copy, CSV and Sheets, the chips and every row and column. */
export function TablePanel({ b, ctx, onClose }: { b: Block; ctx: BlockCtx; onClose: () => void }) {
  const tb = tableState(b, ctx.expired);
  const n = tb.count || tb.rows.length;
  const f = tableRows(tb).length;
  const filtered = Object.keys(tb.f).length || tb.q;
  // A table kept with only its preview rows reads the whole list again by its token (lists last 24 hours).
  if (tb.partial && b.token && !tb.expired && !tb.loaded && !tb.loading && typeof window !== 'undefined') {
    tb.loading = true;
    void brainCall<{ lists?: { rows?: Record<string, any>[]; more?: boolean }[] }>('list/read', { body: { tokens: [b.token] } })
      .then((d) => {
        const l = (d.lists || [])[0];
        if (l && l.rows) {
          tb.rows = l.rows.map((r) => (r.place || !(r.city || r.state) ? r : { ...r, place: [r.city, r.state].filter(Boolean).join(', ') }));
          tb.count = tb.rows.length;
          tb.more = !!l.more;
          tb.partial = false;
          tb.loaded = true;
        }
      })
      .catch((e) => {
        tb.expired = true;
        ctx.engine.toast(e.status === 410 ? 'That list expired. Ask again.' : e.message);
      })
      .finally(() => {
        tb.loading = false;
        ctx.engine.touch();
      });
  }
  return (
    <>
      <div className="bc-panel__h">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="t">{shortTitle(b.title, nounOf(b))}</div>
          <div className="s">{filtered ? `${int(f)} of ${rowLabel(tb, n)} match` : rowLabel(tb, n)}</div>
        </div>
        <button type="button" className="ib" aria-label="Close the panel" onClick={onClose}>
          <Ic n="close" />
        </button>
      </div>
      <div className="bc-panel__tools">
        <div className="tbl__find">
          <Ic n="search" />
          <input
            type="search"
            placeholder="Filter these rows"
            aria-label="Filter these rows"
            defaultValue={tb.q}
            onInput={(e) => {
              tb.q = (e.target as HTMLInputElement).value;
              ctx.engine.touch();
            }}
          />
        </div>
        {!tb.expired && <Tools tb={tb} ctx={ctx} inPanel />}
      </div>
      {(b.chips || []).length > 0 && (
        <div style={{ padding: '10px 18px 0' }}>
          <Chips tb={tb} ctx={ctx} style={{ padding: 0 }} />
        </div>
      )}
      <div className="bc-panel__body" style={{ marginTop: 10, borderTop: '1px solid var(--h-line)' }}>
        <div className="tbl__scroll" data-tbfull tabIndex={0} role="region" aria-label={b.title}>
          {tb.loading && <div className="bc-empty-note">Loading the full list...</div>}
          <Grid tb={tb} all ctx={ctx} />
        </div>
      </div>
    </>
  );
}
