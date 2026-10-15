// The answer blocks that are mostly reading: text, figure tiles, a team's year, a chart, a partner card, coverage, manual
// steps, a note, a choice, a sheet made, sources and the one-time Google Sheets step. Same markup and classes as the classic
// page (src/styles/brain.css), so the look carries over.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import { bandStep, dlong, fmt, initialsOf, inline, int, md, money, moneyS, MONTHS, safeHref } from '../fmt';
import { Ic } from '../icons';
import { brainCall } from '../api';
import type { BlockProps } from './ctx';

export const Html = ({ html, className }: { html: string; className?: string }) => <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;

export function TextBlock({ b }: BlockProps) {
  return <Html className="blk-text" html={md(b.md)} />;
}

function Delta({ d }: { d?: { dir?: string; pct?: number } }) {
  if (!d) return null;
  const dir = d.dir === 'up' ? 'up' : d.dir === 'down' ? 'down' : 'flat';
  return (
    <span className={'delta ' + dir}>
      {dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→'} {Math.abs(Number(d.pct) || 0).toLocaleString('en-US', { maximumFractionDigits: 1 })}%
    </span>
  );
}
function Spark({ v }: { v?: number[] }) {
  if (!v || v.length < 2) return null;
  const mx = Math.max(...v);
  const mn = Math.min(...v);
  const pts = v.map((y, k) => `${(k / (v.length - 1)) * 100},${26 - ((y - mn) / (mx - mn || 1)) * 22}`).join(' ');
  return (
    <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="var(--c-a)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
const Bar = ({ pct, label }: { pct: number; label?: string }) => (
  <div style={{ height: 6, borderRadius: 999, background: '#ece7dc', marginTop: 8, overflow: 'hidden' }} role={label ? 'img' : undefined} aria-label={label}>
    <i style={{ display: 'block', height: '100%', width: Math.max(Math.min(pct, 100), 2) + '%', background: 'var(--c-a)', borderRadius: 999, transformOrigin: 'left', animation: 'bc-grow .8s var(--ease) both' }} />
  </div>
);

export function TilesBlock({ b }: BlockProps) {
  return (
    <div className="blk-tiles">
      {(b.tiles || []).map((t: any, i: number) => {
        const f = t.format || 'int';
        const shown = typeof t.value === 'number' ? fmt(t.value, f) : String(t.value ?? '');
        return (
          <div className="bc-tile" key={i}>
            <div className="bc-tile__l">{t.label}</div>
            <div className={'bc-tile__n' + (typeof t.value === 'string' ? ' is-txt' : shown.length > 10 ? ' is-long' : '')}>{shown}</div>
            <div className="bc-tile__c">
              <Delta d={t.delta} />
              {t.compare && <span>{t.compare}</span>}
            </div>
            <Spark v={t.trend} />
            {t.progress != null && <Bar pct={t.progress} />}
          </div>
        );
      })}
    </div>
  );
}

export function TeamBlock({ b }: BlockProps) {
  const yr = b.year;
  const months = (b.months || []) as any[];
  const quarters = (b.quarters || []) as any[];
  const mx = Math.max(1, ...months.map((m) => Math.max(m.a || 0, m.b || 0)));
  const qmx = Math.max(1, ...quarters.map((q) => Math.max(q.a || 0, q.b || 0)));
  const c = b.compare;
  const ch = c && c.value ? ((c.this_value - c.value) / c.value) * 100 : null;
  const link = String(b.link || '').match(/\[([^\]]+)\]\(([^)]+)\)/);
  const goalPct = b.goal ? Math.min(100, (b.total / b.goal) * 100) : null;
  return (
    <div className="card team">
      <div className="team__top">
        <div>
          <div className="h-label">
            {b.team} &middot; {yr}
          </div>
          <div className="team__n">{money(b.total)}</div>
        </div>
        <div className="bc-tile__c" style={{ paddingBottom: 4 }}>
          {ch != null && (
            <>
              <span className={'delta ' + (ch >= 0 ? 'up' : 'down')}>
                {ch >= 0 ? '↑' : '↓'} {Math.abs(ch).toFixed(0)}%
              </span>
              <span>
                vs {money(c.value)} {String(c.label || '').replace(/^./, (x) => x.toLowerCase())}
              </span>
            </>
          )}
          {b.goal && (
            <span>
              {goalPct!.toFixed(1)}% of the {money(b.goal)} goal
            </span>
          )}
        </div>
        <div className="legend" style={{ marginLeft: 'auto' }}>
          <span>
            <s style={{ background: 'var(--c-a)' }} />
            {yr}
          </span>
          <span>
            <s style={{ background: 'var(--c-b)' }} />
            {yr - 1}
          </span>
        </div>
      </div>
      {goalPct != null && <Bar pct={Math.max(goalPct, 1.5)} label={goalPct.toFixed(1) + ' percent of the goal'} />}
      <div className="qs">
        {quarters.map((q) => (
          <div className="q" key={q.q}>
            <span>Q{q.q}</span>
            <b>{q.a ? moneyS(q.a) : '—'}</b>
            <span style={{ fontWeight: 500, letterSpacing: 0 }}>
              {q.b != null ? moneyS(q.b) + ' in ' + (yr - 1) : ''}
              {q.goal ? ' · goal ' + moneyS(q.goal) : ''}
            </span>
            <i>
              <em style={{ width: ((q.a || 0) / qmx) * 100 + '%' }} />
            </i>
          </div>
        ))}
      </div>
      <div className="months" role="list" aria-label="Giving by month">
        {months.map((m, k) => (
          <button type="button" className="mo" role="listitem" key={k} aria-label={`${MONTHS[m.m - 1]}: ${m.a == null ? 'not yet' : money(m.a)} in ${yr}, ${m.b == null ? 'none' : money(m.b)} in ${yr - 1}`}>
            <i className="a" style={{ height: (m.a ? Math.max((m.a / mx) * 100, 1.5) : 0) + '%', animationDelay: k * 30 + 'ms' }} />
            <i className="b" style={{ height: (m.b ? (m.b / mx) * 100 : 0) + '%', animationDelay: k * 30 + 60 + 'ms' }} />
            <span className="tipbox">
              <b>
                {MONTHS[m.m - 1]}
                {m.partial ? ' so far' : ''}
              </b>
              <br />
              <s style={{ background: 'var(--c-a)' }} />
              {yr}: {m.a == null ? 'not yet' : money(m.a)}
              <br />
              <s style={{ background: 'var(--c-b)' }} />
              {yr - 1}: {m.b == null ? 'none' : money(m.b)}
            </span>
          </button>
        ))}
      </div>
      <div className="mlabels" style={{ gridTemplateColumns: `repeat(${months.length},minmax(0,1fr))` }}>
        {months.map((m, k) => (
          <span key={k}>{MONTHS[m.m - 1]}</span>
        ))}
      </div>
      {link && (
        <div style={{ marginTop: 10 }}>
          <a className="h-btn h-btn--ghost h-btn--xs" href={safeHref(link[2])}>
            <Ic n="ext" />
            {link[1]}
          </a>
        </div>
      )}
    </div>
  );
}

// ---- Chart: bar or line, any number of series, one axis, drawn to the card's width -------------------------------------
const SERIES = ['var(--c-a)', 'var(--c-b)', 'var(--c-c, #3b78b0)', 'var(--c-d, #a8573a)'];
const monthLab = (lab: string, k: number) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(lab));
  if (!m) return lab;
  const mo = MONTHS[+m[2] - 1];
  return mo ? (k === 0 || m[2] === '01' ? mo + ' ' + m[1].slice(2) : mo) : lab;
};
const niceTicks = (mx: number) => {
  if (mx <= 0) return { top: 1, step: 1 };
  const raw = mx / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) as number;
  return { top: Math.ceil(mx / step) * step, step };
};
export function ChartBlock({ b }: BlockProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(0);
  const [hk, setHk] = useState<number | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(el.clientWidth, 260)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const X = (b.x || []) as string[];
  const S = (b.series || []) as { label: string; values: (number | null)[] }[];
  const H = 220;
  const L = 54;
  const R = 10;
  const T = 10;
  const BT = 26;
  const all = S.flatMap((s) => s.values).filter((v): v is number => v != null);
  const { top, step } = niceTicks(Math.max(0, ...all));
  const yf = b.y_format || 'money_short';
  const yl = (v: number) => (v === 0 ? (yf.startsWith('money') ? '$0' : '0') : fmt(v, yf === 'money' ? 'money_short' : yf));
  const n = Math.max(X.length, 1);
  const x = (k: number) => (b.kind === 'bar' ? L + ((k + 0.5) / n) * (W - L - R) : L + (n === 1 ? 0.5 : k / (n - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - v / top) * (H - T - BT);
  const ticks: number[] = [];
  for (let t = 0; t <= top + 1e-9; t += step) ticks.push(t);
  const every = Math.ceil(n / Math.max(2, Math.floor((W - L) / 54)));
  const path = (v: (number | null)[]) => v.map((p, k) => (p == null ? '' : `${k && v[k - 1] != null ? 'L' : 'M'}${x(k).toFixed(1)},${y(p).toFixed(1)}`)).join('');
  const s0 = S[0] ? S[0].values : [];
  const last = s0.reduce((li: number, v, k) => (v != null ? k : li), -1);
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHk(Math.max(0, Math.min(n - 1, b.kind === 'bar' ? Math.floor(((px - L) / (W - L - R)) * n) : Math.round(((px - L) / (W - L - R)) * (n - 1)))));
  };
  const gw = ((W - L - R) / n) * 0.72;
  const bw = Math.min(26, gw / Math.max(S.length, 1) - 2);
  return (
    <div className="card chart">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div className="card__t">{b.title}</div>
        <div className="legend" style={{ marginLeft: 'auto' }}>
          {S.map((s, i) => (
            <span key={i}>
              <s className={b.kind === 'line' ? 'ln' : ''} style={{ background: SERIES[i % 4] }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div className={'chart__wrap' + (hk != null ? ' is-hover' : '')} ref={wrap} style={{ minHeight: H }}>
        {W > 0 && (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={b.title} className={hk != null ? 'is-hover' : ''} onPointerMove={move} onPointerLeave={() => setHk(null)}>
              <g className="grid">
                {ticks.map((t) => (
                  <line key={t} x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
                ))}
              </g>
              <g className="ax">
                {ticks.map((t) => (
                  <text key={'y' + t} x={L - 8} y={y(t) + 4} textAnchor="end">
                    {yl(t)}
                  </text>
                ))}
                {X.map((lab, k) =>
                  k % every === 0 ? (
                    <text key={'x' + k} x={x(k)} y={H - 6} textAnchor="middle">
                      {monthLab(lab, k)}
                    </text>
                  ) : null,
                )}
              </g>
              {b.kind === 'bar'
                ? S.map((s, i) =>
                    s.values.map((v, k) => {
                      if (v == null) return null;
                      const bx = x(k) - (S.length * (bw + 2)) / 2 + i * (bw + 2);
                      const by = y(v);
                      return <rect key={i + ':' + k} x={bx.toFixed(1)} y={by.toFixed(1)} width={bw.toFixed(1)} height={Math.max(H - BT - by, 1).toFixed(1)} rx="3" fill={SERIES[i % 4]} style={{ transformOrigin: `${(bx + bw / 2).toFixed(1)}px ${H - BT}px`, animation: 'bc-growy .7s var(--ease) both', animationDelay: k * 25 + 'ms' }} />;
                    }),
                  )
                : S.slice()
                    .reverse()
                    .map((s, ri) => {
                      const i = S.length - 1 - ri;
                      return <path key={i} className="l draw" d={path(s.values)} stroke={SERIES[i % 4]} style={{ animationDelay: i * 0.15 + 's' }} />;
                    })}
              {b.kind !== 'bar' && last >= 0 && <circle cx={x(last)} cy={y(s0[last] as number)} r="4.5" fill={SERIES[0]} stroke="#fff" strokeWidth="2" />}
              {b.kind !== 'bar' && hk != null && (
                <>
                  <line className="cross" x1={x(hk)} x2={x(hk)} y1={T} y2={H - BT} />
                  {S.map((s, i) => (s.values[hk] != null ? <circle key={i} className={'dot d' + i} r="5" fill={SERIES[i % 4]} cx={x(hk)} cy={y(s.values[hk] as number)} /> : null))}
                </>
              )}
              <rect className="hit" x={L} y="0" width={W - L - R} height={H} />
            </svg>
            {hk != null && (
              <div className="chart__tip tipbox" style={{ bottom: 'auto', transform: 'none', top: -6, left: Math.min(Math.max((x(hk) / W) * W - 70, 0), Math.max(W - 150, 0)) }}>
                <b>{X[hk]}</b>
                {S.map((s, i) => (
                  <span key={i}>
                    <br />
                    <s style={{ background: SERIES[i % 4] }} />
                    {s.label}: {s.values[hk] == null ? 'not yet' : fmt(s.values[hk], yf === 'money_short' ? 'money' : yf)}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {b.note && <div style={{ fontSize: 13, color: 'var(--h-ink-3)', marginTop: 6 }}>{b.note}</div>}
    </div>
  );
}

// ---- Partner card -------------------------------------------------------------------------------------------------------
export function PartnerBlock({ b, ctx }: BlockProps) {
  const ys = (b.years || []) as { y: number; amount: number }[];
  const mx = Math.max(1, ...ys.map((y) => y.amount));
  const s = b.stats || {};
  const w = b.iwave;
  const lg = s.last_gift;
  const lc = s.last_contact;
  const step = w && w.band ? bandStep(w.band.label) : 0;
  const rd = w && w.scored_at;
  return (
    <div className={'card pc' + (w && w.fresh ? ' is-fresh' : '')}>
      <div className="pc__h">
        <div className="pc__av">{initialsOf(b.name)}</div>
        <div style={{ minWidth: 0 }}>
          <div className="pc__n">{b.name}</div>
          <div className="pc__s">
            {b.place || ''}
            {b.kind ? ' · ' + b.kind : ''}{' '}
            {(b.tags || []).map((t: string) => (
              <span className="tag g" key={t}>
                {String(t).toLowerCase() === 'lybunt' ? 'LYBUNT' : t}
              </span>
            ))}
          </div>
        </div>
        {b.holder && (
          <span className="tag l">
            <Ic n="user" />
            Held by {b.holder.name}
          </span>
        )}
      </div>
      <div className="pc__stats">
        <div className="pc__stat">
          <span>Lifetime giving</span>
          <b>{money(s.lifetime || 0)}</b>
          <small>{s.since ? 'since ' + s.since : ''}</small>
        </div>
        <div className="pc__stat">
          <span>Last gift</span>
          <b>{lg ? money(lg.credited != null ? lg.credited : lg.amount) : 'None'}</b>
          <small>{lg ? dlong(lg.date) + (lg.through ? ' through ' + lg.through : '') : ''}</small>
        </div>
        <div className="pc__stat">
          <span>Largest gift</span>
          <b>{s.largest ? money(s.largest.credited != null ? s.largest.credited : s.largest.amount) : 'None'}</b>
          <small>{s.largest ? dlong(s.largest.date) : ''}</small>
        </div>
        <div className="pc__stat">
          <span>Last contact</span>
          <b>{lc ? lc.kind : 'None on file'}</b>
          <small>{lc ? dlong(lc.date) + (lc.by ? ' · ' + lc.by : '') : ''}</small>
        </div>
      </div>
      <div className="pc__body">
        <div className="pc__giving">
          <div className="pc__sec">Giving by year</div>
          {ys.length ? (
            <>
              <div className="yb" style={{ gridTemplateColumns: `repeat(${ys.length},minmax(0,1fr))` }}>
                {ys.map((y, k) => (
                  <button type="button" key={y.y} aria-label={`${y.y}: ${money(y.amount)}`}>
                    <i className={y.amount ? '' : 'z'} style={{ height: (y.amount / mx) * 100 + '%', animationDelay: k * 50 + 'ms' }} />
                    <span className="tipbox">
                      <b>{y.y}</b>
                      <br />
                      {money(y.amount)}
                    </span>
                  </button>
                ))}
              </div>
              <div className="yl" style={{ gridTemplateColumns: `repeat(${ys.length},minmax(0,1fr))` }}>
                {ys.map((y, k) => (
                  <span key={y.y}>{ys.length <= 10 || k % Math.ceil(ys.length / 8) === 0 ? y.y : ''}</span>
                ))}
              </div>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--h-ink-3)' }}>{s.lifetime ? 'No yearly breakdown came with this record.' : 'No gifts yet.'}</p>
          )}
        </div>
        <div className="pc__iw">
          <div className="pc__sec">
            iWave ratings{' '}
            {w && w.fresh ? (
              <span className="updated">
                <Ic n="check" />
                Scored just now
              </span>
            ) : rd ? (
              <span className="src">Scored {dlong(rd)}</span>
            ) : null}
          </div>
          {w ? (
            <>
              {(w.meters || []).map((m: any) => (
                <div className={'meter' + (m.value >= m.max ? ' hi' : '')} key={m.label}>
                  <span>{m.label}</span>
                  <div className="meter__bar" style={{ gridTemplateColumns: `repeat(${m.max},1fr)` }} role="img" aria-label={`${m.label} ${m.value == null ? 'not rated' : m.value + ' of ' + m.max}`}>
                    {Array.from({ length: m.max }, (_, k) => (
                      <i key={k} className={m.value != null && k + 1 <= m.value ? 'on' : ''} style={{ animationDelay: (k + 1) * 70 + 'ms' }} />
                    ))}
                  </div>
                  <em>
                    {m.value == null ? (
                      m.why || 'Not rated'
                    ) : (
                      <>
                        <b>
                          {m.value} of {m.max}
                        </b>
                        {dlong(m.date || rd)}
                      </>
                    )}
                  </em>
                </div>
              ))}
              <div className="capband">
                <div className="capband__top">
                  <span>
                    Capacity band <b>{w.band ? w.band.label : 'Not stored'}</b>
                  </span>
                  <span>
                    {w.estimate ? (
                      <>
                        iWave estimate <b>{money(w.estimate.value)}</b>
                      </>
                    ) : (
                      <span className="ns">Estimate fills on the next refresh</span>
                    )}
                  </span>
                </div>
                <div className="capband__bar">
                  {[1, 2, 3, 4].map((k) => (
                    <i key={k} className={k === step ? 'on' : ''} />
                  ))}
                </div>
                <div className="capband__lab">
                  <span>$0</span>
                  <span>$50K</span>
                  <span>$250K</span>
                  <span>$500K+</span>
                </div>
              </div>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--h-ink-3)' }}>Open to leadership and the RDDs.</p>
          )}
        </div>
      </div>
      {(b.actions || []).length > 0 && (
        <div className="pc__acts">
          {(b.actions || []).map((a: any, i: number) =>
            a.href ? (
              <a key={i} className="h-btn h-btn--ghost h-btn--sm" href={safeHref(a.href)} target="_blank" rel="noopener">
                <Ic n="ext" />
                {a.label}
              </a>
            ) : a.sheet ? null : (
              <button key={i} type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => ctx.ask(a.ask || a.label)}>
                <Ic n={a.id === 'refresh' ? 'redo' : 'list'} />
                {a.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

const TONE: Record<string, string> = { a: 'var(--c-a)', b: 'var(--c-b)', muted: '#cfc8b8' };
export function CoverageBlock({ b }: BlockProps) {
  const segs = (b.segments || []) as { label: string; n: number; tone?: string; note?: string }[];
  return (
    <div className="card cov">
      <div className="card__t">{b.title}</div>
      <div className="cov__bar" role="img" aria-label={segs.map((s) => `${s.label} ${s.n}`).join(', ')}>
        {segs.map((s, k) => (
          <i key={k} style={{ flex: Math.max(s.n, b.total * 0.006), background: TONE[s.tone || ''] || TONE.muted, animationDelay: k * 120 + 'ms' }} />
        ))}
      </div>
      <div className="cov__lg">
        {segs.map((s, k) => (
          <span key={k}>
            <s style={{ background: TONE[s.tone || ''] || TONE.muted }} />
            <b>{int(s.n)}</b> {String(s.label).toLowerCase()}
            {s.note && <span style={{ color: 'var(--h-ink-3)' }}> ({s.note})</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

export function StepsBlock({ b }: BlockProps) {
  const src = b.source;
  return (
    <div className="card">
      <div className="card__h">
        <div>
          <div className="card__t">{b.title}</div>
          {src && (
            <div className="card__s">
              <Ic n="book" /> {src.manual}
              {src.section ? ' · ' + src.section : ''}
            </div>
          )}
        </div>
        {(b.video || (src && src.href)) && (
          <div className="card__acts">
            {b.video && (
              <a className="h-btn h-btn--ghost h-btn--xs" href={safeHref(b.video.href)}>
                <Ic n="play" />
                Watch the video
              </a>
            )}
            {src && src.href && (
              <a className="h-btn h-btn--ghost h-btn--xs" href={safeHref(src.href)} target="_blank" rel="noopener">
                <Ic n="ext" />
                Open in the manual
              </a>
            )}
          </div>
        )}
      </div>
      <div className="steps">
        <ol>
          {(b.steps || []).map((s: any, i: number) => (
            <li key={i}>
              <div>
                <span dangerouslySetInnerHTML={{ __html: inline(s.md) }} />
                {s.hint && <small>{s.hint}</small>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export function NoteBlock({ b, ctx }: BlockProps) {
  const e = ctx.engine;
  const [busy, setBusy] = useState(false);
  return (
    <div className="note">
      <div className="note__i">
        <Ic n={b.tone === 'lock' ? 'lock' : 'info'} />
      </div>
      <b>{b.title}</b>
      {b.body && <p dangerouslySetInnerHTML={{ __html: inline(b.body) }} />}
      {(b.access || (b.asks && b.asks.length)) && (
        <div className="acts">
          {b.access &&
            (b._state === 'asked' || e.pending(b.access) ? (
              <span className="state wait">
                <i />
                Request sent to Will
              </span>
            ) : e.canRequest(b.access) ? (
              <button
                type="button"
                className="h-btn h-btn--primary h-btn--sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await e.requestAccess(b.access, 'Asked from an answer: ' + String(ctx.turn.q).slice(0, 200), 30);
                    b._state = 'asked';
                  } catch (err) {
                    e.toast((err as Error).message);
                  }
                  setBusy(false);
                }}
              >
                Ask Will for access
              </button>
            ) : null)}
          {(b.asks || []).map((q: string) => (
            <button key={q} type="button" className="fu" onClick={() => ctx.ask(q)}>
              <Ic n="arrow" />
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChoiceBlock({ b, ctx }: BlockProps) {
  const picked = b._picked;
  return (
    <div className={'blk-choice' + (picked != null ? ' is-done' : '')}>
      {b.q && <div className="blk-choice__q">{b.q}</div>}
      <div className="blk-choice__opts">
        {(b.opts || []).map((o: any, k: number) => (
          <button
            key={k}
            type="button"
            className={'opt' + (picked === k ? ' is-picked' : '')}
            onClick={() => {
              b._picked = k;
              ctx.engine.touch();
              ctx.ask(o.ask, o.intent);
            }}
          >
            <span className={'opt__i' + (o.icon === 'spark' ? ' g' : '')}>
              <Ic n={o.icon || 'arrow'} />
            </span>
            <b>{o.label}</b>
            {o.sub && <small>{o.sub}</small>}
            <Ic n="arrow" />
          </button>
        ))}
      </div>
      {b.other && (
        <button type="button" className="else" onClick={() => document.querySelector<HTMLTextAreaElement>('[data-brain-input]')?.focus()}>
          Something else
        </button>
      )}
    </div>
  );
}

export function SheetBlock({ b }: BlockProps) {
  return (
    <div className="card sheet">
      <div className="sheet__i">
        <Ic n="sheet" className="h-i sheet__svg" />
      </div>
      <div style={{ minWidth: 0 }}>
        <b>{b.title}</b>
        <small>
          {int(b.rows)} {Number(b.rows) === 1 ? 'row' : 'rows'} in your Drive. {b.private ? 'Only you can open it. ' : ''}Keep it inside Favor.
        </small>
      </div>
      <a className="h-btn h-btn--primary h-btn--sm" href={safeHref(b.url)} target="_blank" rel="noopener">
        <Ic n="ext" />
        Open the sheet
      </a>
    </div>
  );
}

export function SourcesBlock({ b }: BlockProps) {
  const items = ((b.items || []) as { label: string; href?: string }[]).slice(0, 2);
  if (!items.length) return null;
  return (
    <div className="srcrow">
      <span className="srcrow__l">Sources</span>
      {items.map((i, k) =>
        i.href ? (
          <a key={k} className="srcchip" href={safeHref(i.href)} target="_blank" rel="noopener">
            <Ic n="book" />
            {i.label}
            <Ic n="ext" />
          </a>
        ) : (
          <span key={k} className="srcchip">
            <Ic n="book" />
            {i.label}
          </span>
        ),
      )}
    </div>
  );
}

export function ConsentBlock({ b, ctx }: BlockProps) {
  const [going, setGoing] = useState(false);
  const t = ctx.turn;
  return (
    <div className="card consent">
      <b>Allow Favor to make Google Sheets for you</b>
      <p>Google will ask once. Favor can then create sheets in your own Drive and open only the sheets it made. Only you can open them.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="h-btn h-btn--primary"
          disabled={going}
          onClick={() => {
            setGoing(true);
            const toks = (t.lists || []).map((l) => l.token).filter(Boolean).slice(0, 3) as string[];
            const spec = b._spec || (toks.length ? { mode: 'brain', tokens: toks, dedupe: 'brain:' + toks.join(','), title: 'Favor Brain list', provenance: { kind: 'brain', page: '/brain/', asked: t.q } } : null);
            (window as any).FavorSheets?.consent(spec, b.consent_url);
          }}
        >
          {going ? (
            <>
              <span className="spin" />
              Opening Google
            </>
          ) : (
            'Allow'
          )}
        </button>
        <button
          type="button"
          className="h-btn h-btn--ghost"
          onClick={() => {
            t.extras = (t.extras || []).filter((x) => x.type !== 'consent');
            if (t.blocks) t.blocks = t.blocks.filter((x) => x !== b);
            ctx.engine.touch();
            ctx.engine.toast('No sheet made. The CSV still works.');
          }}
        >
          No thanks
        </button>
      </div>
    </div>
  );
}

// ---- Action card: a change the Brain proposes (an iWave refresh, a screening, a task) waiting for a press -------------
const STATUS: Record<string, [string, string]> = { ready: ['wait', 'Ready'], waiting: ['wait', 'Waiting for Will'], sent: ['wait', 'Sent to Will'], approved: ['ok', 'Approved'], running: ['wait', 'Running'], done: ['ok', 'Done'], declined: ['no', 'Declined'], refused: ['no', 'Not done'] };
export function ConfirmBlock({ b, ctx }: BlockProps) {
  const st = STATUS[b.status] || STATUS.ready;
  const busy = b._busy as string | undefined;
  const task = b.kind === 'task_create';
  const wm = String(b.who || '').match(/^(.*?)\s*Open it: (https:\/\/\S+)$/);
  const press = async (action: string) => {
    const t = ctx.turn;
    if (b._busy || !t.blocks) return;
    b._busy = action;
    ctx.engine.touch();
    try {
      const d = await brainCall<{ blocks?: any[] }>('confirm', { body: { id: b.id, action } });
      const i = t.blocks.indexOf(b);
      if (i >= 0) t.blocks.splice(i, 1, ...(d.blocks || []));
      if (b.kind === 'iwave_refresh' && (d.blocks || []).some((x) => x.type === 'confirm' && x.status === 'done')) {
        const p = t.blocks.find((x) => x.type === 'partner');
        if (p) t.follow = p.lookup ? ['Tell me about lookup ' + p.lookup] : ['Show the new rating for ' + p.name];
      }
      document.dispatchEvent(new CustomEvent('favor:cue', { detail: action === 'approve' ? 'success' : 'droplet' }));
    } catch (err) {
      b._busy = undefined;
      ctx.engine.toast((err as Error).message);
    }
    ctx.engine.touch();
  };
  const pr = b.progress;
  return (
    <div className="card cf">
      <div className="cf__h">
        <div className="cf__i">
          <Ic n={b.kind === 'iwave_refresh' ? 'redo' : task ? 'check' : 'coin'} />
        </div>
        <div>
          <div className="cf__t">{b.title}</div>
          {b.sub && <div className="cf__s">{b.sub}</div>}
        </div>
        <span className={'state ' + st[0]}>
          <i />
          {st[1]}
        </span>
      </div>
      {(b.facts || []).length > 0 && (
        <div className="cf__rows">
          {b.facts.map((f: any, i: number) => (
            <div className="kv" key={i}>
              <span>{f.label}</span>
              <b>{typeof f.value === 'number' ? int(f.value) : f.value}</b>
              {f.sub && !/^\d{4}-\d\d-\d\d$/.test(f.sub) && <small>{f.sub}</small>}
            </div>
          ))}
        </div>
      )}
      {(b.notes || []).length > 0 && (
        <ul className="cf__notes">
          {b.notes.map((n: any, i: number) => (
            <li key={i}>
              <Ic n={n.icon || 'info'} />
              <span>{n.text}</span>
            </li>
          ))}
        </ul>
      )}
      {pr && (
        <div className="prog" role="progressbar" aria-valuenow={pr.done} aria-valuemax={pr.total}>
          <i style={{ width: (pr.total ? (pr.done / pr.total) * 100 : 0) + '%' }} />
        </div>
      )}
      <div className="cf__acts">
        {(b.actions || []).map((a: any, i: number) =>
          a.ask ? (
            <button key={i} type="button" className="h-btn h-btn--ghost" onClick={() => ctx.ask(a.ask)}>
              <Ic n="list" />
              {a.label}
            </button>
          ) : (
            <button key={i} type="button" className={'h-btn ' + (a.tone === 'gold' ? 'h-btn--gold' : a.id === 'approve' ? 'h-btn--primary' : 'h-btn--ghost')} disabled={a.enabled === false || !!busy} onClick={() => void press(a.id)}>
              {busy === a.id ? <span className="spin d" /> : a.id === 'approve' ? <Ic n={task ? 'check' : 'coin'} /> : null}
              {a.label}
            </button>
          ),
        )}
        {b.who && (
          <span className="who">
            <Ic n={task ? 'info' : 'shield'} />
            {wm ? (
              <>
                {wm[1]} <a href={wm[2]}>Open the task</a>
              </>
            ) : (
              b.who
            )}
          </span>
        )}
      </div>
    </div>
  );
}
