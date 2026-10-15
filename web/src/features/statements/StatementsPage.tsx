// Giving statements (/statements/): one partner's statement on request, and the January year-end statements for every partner on the tax receipt
// lists. Port of src/pages/statements/index.astro and public/js/statements.js with the same markup, stylesheets and calls. Reads are drawn with
// useSuspenseQuery inside Suspense; a preview is a read the person starts, so it is a plain query. Nothing touches window or document while drawing.
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryErrorResetBoundary, keepPreviousData, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import '@hub/styles/requests.css';
import '@hub/styles/expenses.css';
import '@hub/styles/foundations.css';
import '@hub/styles/receipts.css';
import '@hub/styles/qa-work.css';
import '@hub/styles/crit-forms.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/statements.css';
import { Boundary } from '../partners/record/Boundary';
import { Term } from '../partners/record/Ic';
import { day, money, num, plural, stamp } from '../receipts/format';
import { SheetsButton } from '../receipts/SheetsButton';
import { PageToast, toast } from '../receipts/toast';
import { LIST_NAME, TABS, askBody, filesQuery, meQuery, planQuery, stmApi, stmKeys, type Ask, type Batch, type Hit, type Line, type Me, type Plan, type Statement, type Tie } from './api';

export function StatementsPage({ tab }: { tab: string }) {
  return (
    <>
      <QueryErrorResetBoundary>
        {() => (
          <Boundary
            fallback={(e) => (
              <Frame>
                <p className="rcp-loading is-bad" id="stm-loading">
                  {e.message}
                </p>
              </Frame>
            )}
          >
            <Suspense
              fallback={
                <Frame>
                  <p className="rcp-loading" id="stm-loading">
                    <span className="rcp-spin" />
                    Opening
                  </p>
                </Frame>
              }
            >
              <Opened tab={tab} />
            </Suspense>
          </Boundary>
        )}
      </QueryErrorResetBoundary>
      <PageToast id="stm-toast" />
    </>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="fnd-page rcp-page stm-page">
      <div className="container">
        <header className="board-intro">
          <div>
            <p className="make-kicker">Admin desk</p>
            <h1>Giving statements</h1>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

function Opened({ tab }: { tab: string }) {
  const { data: me } = useSuspenseQuery(meQuery);
  return (
    <Frame>
      <Desk me={me} firstTab={TABS.some(([k]) => k === tab) ? tab : 'one'} />
    </Frame>
  );
}

const Loading = ({ text }: { text: string }) => (
  <p className="rcp-loading">
    <span className="rcp-spin" />
    {text}
  </p>
);

/** A part of the page that failed to read: its message, and a way to try again. */
function Part({ children, fallback, again }: { children: ReactNode; fallback: ReactNode; again: string }) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <Boundary
          fallback={(e, retry) => (
            <p className="rcp-loading is-bad">
              {e.message}{' '}
              {again ? (
                <button
                  type="button"
                  className="fnd-textbtn"
                  id="stm-retry"
                  onClick={() => {
                    reset();
                    retry();
                  }}
                >
                  {again}
                </button>
              ) : null}
            </p>
          )}
        >
          <Suspense fallback={fallback}>{children}</Suspense>
        </Boundary>
      )}
    </QueryErrorResetBoundary>
  );
}

function Desk({ me, firstTab }: { me: Me; firstTab: string }) {
  const [tab, setTab] = useState(firstTab);
  const [year, setYear] = useState('');
  const [bump, setBump] = useState(0);
  const [filesBump, setFilesBump] = useState(0);
  return (
    <div id="stm-app">
      <div className="fnd-tabs" id="stm-tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            data-tab={k}
            className={tab === k ? 'is-on' : ''}
            aria-selected={tab === k}
            onClick={() => {
              setTab(k);
              if (k === 'files') setFilesBump((n) => n + 1);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="make-sheet fnd-sheet" id="stm-view-one" hidden={tab !== 'one'}>
        <OneStatement me={me} />
      </section>

      <section className="make-sheet fnd-sheet" id="stm-view-year" hidden={tab !== 'year'}>
        {tab === 'year' ? (
          <Part fallback={<Loading text="Reading the tax receipt lists" />} again="Try again">
            <YearEnd me={me} year={year || String(me.defaultYear)} setYear={setYear} bump={bump} refresh={() => setBump((n) => n + 1)} />
          </Part>
        ) : null}
      </section>

      <section className="make-sheet fnd-sheet" id="stm-view-files" hidden={tab !== 'files'}>
        {tab === 'files' ? (
          <Part fallback={<Loading text="Reading the print files" />} again="">
            <Files bump={filesBump} />
          </Part>
        ) : null}
      </section>

      <section className="make-sheet fnd-sheet" id="stm-view-wording" hidden={tab !== 'wording'}>
        {tab === 'wording' ? <Wording me={me} /> : null}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------ one statement */

function periodOptions(me: Me): [string, string][] {
  const y = me.thisYear;
  const opts: [string, string][] = [];
  for (let i = 0; i <= 6; i++) opts.push([String(y - i), String(y - i) + (i === 0 ? ' so far' : '')]);
  opts.push(['dates', 'Between two dates']);
  return opts;
}

function OneStatement({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [partner, setPartner] = useState<Hit | null>(null);
  const [period, setPeriod] = useState(String(me.defaultYear));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [soft, setSoft] = useState(true);
  const [last, setLast] = useState<Batch | null>(null);
  const [busy, setBusy] = useState(false);

  // The search waits a moment after the last key.
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) {
      setDq('');
      return;
    }
    const id = setTimeout(() => setDq(t), 250);
    return () => clearTimeout(id);
  }, [q]);
  const find = useQuery({
    queryKey: stmKeys.find(dq),
    queryFn: async () => ((await stmApi('/api/statements/find?q=' + encodeURIComponent(dq))) as { partners: Hit[] }).partners || [],
    enabled: dq.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 0,
    retry: false,
  });
  const hits = dq ? find.data : undefined;

  // The statement asked for: a partner and a year, or a partner and two dates (kept until both dates are filled).
  const built: Ask | null = partner ? { cid: partner.id, includeSoft: soft, ...(period === 'dates' ? { from, to } : { year: period }) } : null;
  const ready = built && (period !== 'dates' || (from && to));
  const keep = useRef<Ask | null>(null);
  const ask: Ask | null = ready ? built : keep.current && partner && keep.current.cid === partner.id ? keep.current : null;
  keep.current = ask;
  const preview = useQuery({
    queryKey: stmKeys.preview(ask || { cid: '', includeSoft: false }),
    queryFn: async () => ((await stmApi('/api/statements/preview', askBody(ask as Ask))) as { statement: Statement }).statement,
    enabled: Boolean(ask),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const statement = preview.data || null;
  const askKey = JSON.stringify(ask);
  useEffect(() => {
    setLast(null);
  }, [askKey]);
  const shownBefore = useRef(false);
  if (statement) shownBefore.current = true;
  if (preview.isError || !partner) shownBefore.current = false;

  const latest = useRef<Statement | null>(null);
  latest.current = statement;

  const pick = (hit: Hit) => {
    setPartner(hit);
    setLast(null);
    setQ('');
    setDq('');
    void qc.removeQueries({ queryKey: ['stm', 'preview'] });
  };

  const make = async () => {
    if (busy || !ask) return;
    setBusy(true);
    try {
      const d = await stmApi<{ batch: Batch }>('/api/statements/single', askBody(ask));
      setLast(d.batch);
      toast('The PDF is ready.');
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const email = async () => {
    const st = latest.current;
    if (!last || !st || !confirm(`Email this statement to ${st.partner.email}?`)) return;
    try {
      const d = await stmApi<{ result: { sent: boolean } }>(`/api/statements/batches/${encodeURIComponent(last.id)}`, { action: 'email', only: [st.partner.id] });
      toast(d.result.sent ? 'Sent.' : 'It did not send. Try again.');
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const sheetRows = (fs: { screen: (t: string, tabs: unknown[], o?: unknown) => unknown }) => {
    const s = latest.current;
    if (!s) throw new Error('Pick a partner first.');
    const rows = [
      ...s.gifts.map((l) => ({ section: 'Gifts', ...l })),
      ...s.refunds.map((l) => ({ section: 'Refunds', ...l })),
      ...s.notDeductible.map((l) => ({ section: 'Not tax-deductible', ...l })),
      ...s.soft.map((l) => ({ section: 'Through a fund', ...l })),
    ].map((l) => ({ section: l.section, date: l.date, gift: l.gift, fund: l.fund || '', kind: l.kind, amount: l.amount, from: l.from || '' }));
    return fs.screen(
      `Giving statement ${s.partner.lookup}, ${s.period}`,
      [
        {
          name: 'Gifts',
          columns: [
            { key: 'section', label: 'Section', type: 'text' },
            { key: 'date', label: 'Date', type: 'date' },
            { key: 'gift', label: 'Gift ID', type: 'id' },
            { key: 'fund', label: 'Designation', type: 'text' },
            { key: 'kind', label: 'Type', type: 'text' },
            { key: 'amount', label: 'Amount', type: 'money' },
            { key: 'from', label: 'Given by', type: 'text' },
          ],
          rows,
        },
      ],
      { filters: s.period, classes: ['partner'] }
    );
  };

  return (
    <>
      <div className="stm-find">
        <label className="req-field">
          <span>Find a partner</span>
          <input type="search" id="stm-q" placeholder="Name or Blackbaud ID" autoComplete="off" maxLength={80} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="stm-hits" id="stm-hits" role="listbox" aria-label="Partners found">
          {find.isError && dq ? (
            <p className="rcp-fine">{(find.error as Error).message}</p>
          ) : hits && !hits.length ? (
            <p className="rcp-fine">No partner matches. Try the Blackbaud ID or another part of the name.</p>
          ) : (
            (hits || []).map((h) => (
              <button type="button" className="stm-hit" role="option" aria-selected={false} key={h.id} onClick={() => pick(h)}>
                <b>{h.name}</b>
                <span>
                  ID {h.lookup}
                  {h.place ? ' · ' + h.place : ''}
                  {' · '}
                  {plural(h.gifts, 'gift')}
                  {h.last ? ', last ' + day(h.last) : ''}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
      <div id="stm-one" hidden={!partner}>
        <div className="stm-who" id="stm-who">
          {partner ? (
            <>
              <h2>{partner.name}</h2>
              <p className="fnd-note">
                Blackbaud ID {partner.lookup}
                {partner.place ? ', ' + partner.place : ''}
              </p>
            </>
          ) : null}
        </div>
        <div className="stm-controls">
          <label className="req-field">
            <span>Period</span>
            <select id="stm-period" value={period} onChange={(e) => setPeriod(e.target.value)}>
              {periodOptions(me).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="req-field" id="stm-from-wrap" hidden={period !== 'dates'}>
            <span>From</span>
            <input type="date" id="stm-from" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="req-field" id="stm-to-wrap" hidden={period !== 'dates'}>
            <span>To</span>
            <input type="date" id="stm-to" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="stm-check">
            <input type="checkbox" id="stm-soft" checked={soft} onChange={(e) => setSoft(e.target.checked)} /> List gifts made through a fund or foundation
          </label>
        </div>
        <div className="stm-sheet" id="stm-sheet" hidden={!(statement || (preview.isPending && shownBefore.current))}>
          <SheetsButton name="statement" build={sheetRows} />
        </div>
        <div id="stm-preview" aria-live="polite">
          {!ask ? null : preview.isError ? (
            <p className="rcp-loading is-bad">{(preview.error as Error).message}</p>
          ) : statement ? (
            <Preview s={statement} me={me} last={last} busy={busy} onMake={make} onEmail={email} />
          ) : (
            <Loading text="Reading the gifts" />
          )}
        </div>
      </div>
    </>
  );
}

function LineTable({ title, lines, from }: { title: ReactNode; lines: Line[]; from?: boolean }) {
  if (!lines.length) return null;
  return (
    <>
      <h3 className="stm-h">{title}</h3>
      <div className="fnd-table-wrap">
        <table className="exp-admin-table sc-table stm-table stm-lines">
          <thead>
            <tr>
              <th>Date</th>
              <th>Gift ID</th>
              <th>Designation</th>
              <th>Type</th>
              <th className="r">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.gift + '|' + i}>
                <td>{day(l.date)}</td>
                <td>{l.gift}</td>
                <td>
                  {from && l.from ? l.from + ': ' : ''}
                  {l.fund || 'Where Needed Most'}
                  {l.flags.includes('noncash') ? (
                    <>
                      {' '}
                      <span className="stm-flag">Stock or in-kind</span>
                    </>
                  ) : null}
                  {l.flags.includes('split') ? (
                    <>
                      {' '}
                      <span className="stm-flag">Part of a split gift</span>
                    </>
                  ) : null}
                </td>
                <td>{l.kind}</td>
                <td className="r">{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const Tile = ({ n, cap }: { n: ReactNode; cap: ReactNode }) => (
  <div className="stm-tile">
    <b>{n}</b>
    <span>{cap}</span>
  </div>
);

function Preview({ s, me, last, busy, onMake, onEmail }: { s: Statement; me: Me; last: Batch | null; busy: boolean; onMake: () => void; onEmail: () => void }) {
  const t = s.totals;
  const left = s.left.filter((l) => l.reason !== 'schedule');
  const schedules = s.left.length - left.length;
  const empty = !s.gifts.length && !s.refunds.length;
  const base = last ? `/api/statements/batches/${encodeURIComponent(last.id)}/pdf` : '';
  return (
    <>
      <div className="stm-tiles">
        <Tile n={money(t.net)} cap={`Net total, ${s.period}`} />
        <Tile n={plural(t.giftCount, 'gift')} cap={`${money(t.gifts)} counted`} />
        {t.refunds ? <Tile n={money(t.refunds)} cap="Refunds" /> : null}
        {t.notDeductible ? <Tile n={money(t.notDeductible)} cap="Not tax-deductible" /> : null}
        {t.soft ? <Tile n={money(t.soft)} cap={<Term k="soft" label="Through a fund, not counted" />} /> : null}
      </div>
      {s.notes.length ? (
        <ul className="stm-notes">
          {s.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
      {s.gifts.length || s.refunds.length ? null : <p className="fnd-note">No gift belongs on this statement for the period.</p>}
      <LineTable title="Gifts" lines={s.gifts} />
      <LineTable title="Refunds and returned gifts" lines={s.refunds} />
      <LineTable title="Payments that are not tax-deductible" lines={s.notDeductible} />
      <LineTable title={<Term k="soft" label="Gifts made through a fund or foundation" />} lines={s.soft} from />
      {left.length ? (
        <details className="stm-left">
          <summary>{plural(left.length, 'row')} left off the statement</summary>
          <div className="fnd-table-wrap">
            <table className="exp-admin-table sc-table stm-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Gift ID</th>
                  <th>Why</th>
                  <th className="r">Amount</th>
                </tr>
              </thead>
              <tbody>
                {left.map((l, i) => (
                  <tr key={l.gift + '|' + i}>
                    <td>{day(l.date)}</td>
                    <td>{l.gift}</td>
                    <td>{l.why}</td>
                    <td className="r">{money(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
      {schedules ? (
        <p className="rcp-fine">
          {plural(schedules, 'monthly gift schedule')} in the period {schedules === 1 ? 'is' : 'are'} not listed. The payments are.
        </p>
      ) : null}
      <div className="stm-actions" id="stm-actions">
        {!last ? (
          <>
            <button type="button" className="req-submit" id="stm-make" disabled={busy || empty} onClick={onMake}>
              {busy ? 'Making the PDF' : 'Make the PDF'}
            </button>
            <span className="rcp-fine">{me.driveOn ? 'A copy is saved in US Team Files.' : 'FavorOS keeps a copy under Print files.'}</span>
          </>
        ) : (
          <>
            <a className="req-submit rcp-btn" href={base} target="_blank" rel="noopener">
              Open the PDF
            </a>
            <a className="req-ghost rcp-btn" href={`${base}?download=1`}>
              Download
            </a>
            {me.emailOn ? (
              <button type="button" className="req-ghost" id="stm-email" disabled={!s.partner.email} onClick={onEmail}>
                {s.partner.email ? 'Email it to the partner' : 'No email on the record'}
              </button>
            ) : (
              <span className="rcp-fine">Emailing is off in Admin.</span>
            )}
            <p className="rcp-fine">
              Made {stamp(last.createdAt)} by {last.createdBy}. {last.driveFile ? 'A copy is in US Team Files.' : ''}
            </p>
          </>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ year-end */

const ListCard = ({ k, p }: { k: string; p: Plan['lists']['mail'] }) => (
  <div className="ticker__stat">
    <div className="ticker__num">{num(p.count)}</div>
    <div className="ticker__caption">
      {LIST_NAME[k]} list
      <br />
      {money(p.total)}
      <br />
      {p.issued} in print files, {p.remaining} left
    </div>
  </div>
);

function TieRow({ t }: { t: Tie }) {
  const cls = t.status === 'match' ? 'is-match' : t.status === 'differs' ? 'is-differs' : 'is-none';
  const fmt = (n: number | null) => (n == null ? 'not available' : t.kind === 'money' ? money(n) : num(n));
  const word = t.status === 'match' ? 'Matches' : t.status === 'differs' ? 'Differs' : 'Not compared';
  return (
    <li className={`stm-tie ${cls}`}>
      <b>{word}</b>{' '}
      <span>
        {t.label}: {fmt(t.mine)}
        {t.other != null ? ' against ' + fmt(t.other) : ''}
        {t.note ? '. ' + t.note : ''}
      </span>
    </li>
  );
}

function YearEnd({ me, year, setYear, bump, refresh }: { me: Me; year: string; setYear: (y: string) => void; bump: number; refresh: () => void }) {
  const { data: p } = useSuspenseQuery(planQuery(year, bump));
  const [busy, setBusy] = useState(false);
  // Every fresh read of the lists puts the list and the fund box back to their defaults, as the classic page does: the first list with statements left.
  const firstList = (['mail', 'email', 'other'] as const).find((k) => p.lists[k].remaining > 0) || 'mail';
  const [list, setList] = useState<string>(firstList);
  const [withSoft, setWithSoft] = useState(false);
  useEffect(() => {
    setList(firstList);
    setWithSoft(false);
  }, [p, firstList]);
  const years: number[] = [];
  for (let y = me.thisYear; y >= me.thisYear - 6; y--) years.push(y);
  const open = p.open;

  const makeYearEnd = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const d = await stmApi<{ mismatches: number }>('/api/statements/yearend', { year: Number(year), list, includeSoft: withSoft });
      toast(d.mismatches ? `File made. ${plural(d.mismatches, 'partner')} differ from the tax list, see below.` : 'The print file is ready.');
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
      refresh();
    }
  };
  const closeFile = async (b: Batch, action: 'printed' | 'discard') => {
    try {
      await stmApi(`/api/statements/batches/${encodeURIComponent(b.id)}`, { action });
      toast(action === 'printed' ? 'Marked printed.' : 'Print file thrown away.');
    } catch (err) {
      toast((err as Error).message);
    }
    refresh();
  };
  const any = (['mail', 'email', 'other'] as const).some((k) => p.lists[k].remaining > 0);

  return (
    <>
      <div className="stm-year">
        <label className="req-field">
          <span>Gift year</span>
          <select id="stm-year" value={year} onChange={(e) => setYear(e.target.value)}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="fnd-textbtn" id="stm-reload" onClick={refresh}>
          Read the lists again
        </button>
      </div>
      <section className="ticker fnd-band rcp-band" aria-label="Year-end lists">
        <div className="ticker__label">{p.year} tax receipt lists</div>
        <div className="fnd-band__row">
          {(['mail', 'email', 'other'] as const).map((k) => (
            <ListCard key={k} k={k} p={p.lists[k]} />
          ))}
          <div className="ticker__stat">
            <div className="ticker__num">{num(p.none.count)}</div>
            <div className="ticker__caption">
              No statement
              <br />
              {money(p.none.total)}
              <br />
              under $250, churches, foundations, <Term k="daf" label="DAFs" />
            </div>
          </div>
        </div>
      </section>
      <ul className="stm-ties">
        {p.ties.map((t, i) => (
          <TieRow key={i} t={t} />
        ))}
      </ul>
      <div id="stm-run">
        {open ? (
          <OpenFile b={open} onPrinted={() => closeFile(open, 'printed')} onDiscard={() => confirm('Throw this print file away? Its partners go back on the list.') && closeFile(open, 'discard')} onDownload={refresh} />
        ) : !any ? (
          <p className="fnd-note stm-done">
            <b>Every partner on the three lists has a statement in a print file.</b> A second run makes nothing new.
          </p>
        ) : (
          <div className="rcp-make__row">
            <div>
              <h2>Make the next print file</h2>
              <p className="fnd-note">{plural(p.size, 'statement')} to a file, one list at a time, ZIP order for mail. A partner already in a file is never included again. Nothing is marked printed until you press it.</p>
            </div>
            <div className="rcp-make__form">
              <label className="req-field">
                <span>List</span>
                <select id="stm-list" value={list} onChange={(e) => setList(e.target.value)}>
                  {(['mail', 'email', 'other'] as const).map((k) => (
                    <option key={k} value={k} disabled={!p.lists[k].remaining}>
                      {LIST_NAME[k]}, {p.lists[k].remaining} left
                    </option>
                  ))}
                </select>
              </label>
              <label className="stm-check">
                <input type="checkbox" id="stm-yesoft" checked={withSoft} onChange={(e) => setWithSoft(e.target.checked)} /> List gifts made through a fund
              </label>
              <button type="button" className="req-submit" id="stm-run-go" disabled={busy} onClick={makeYearEnd}>
                {busy ? 'Making the file' : 'Make the print file'}
              </button>
            </div>
          </div>
        )}
      </div>
      <h3 className="stm-h">Files made for {p.year}</h3>
      <FilesTable list={p.batches} yearOnly me={me} />
    </>
  );
}

function OpenFile({ b, onPrinted, onDiscard, onDownload }: { b: Batch; onPrinted: () => void; onDiscard: () => void; onDownload: () => void }) {
  const base = `/api/statements/batches/${encodeURIComponent(b.id)}/pdf`;
  const printed = Boolean(b.downloadedAt);
  const click = () => {
    if (b.downloadedAt) return;
    setTimeout(onDownload, 1500);
  };
  const step = (n: number, title: string, done: boolean, next: boolean, body: ReactNode) => (
    <li className={`rcp-step${done ? ' is-done' : ''}${next ? ' is-next' : ''}`}>
      <span className="rcp-step__n">{done ? '✓' : n}</span>
      <div>
        <h3>{title}</h3>
        {body}
      </div>
    </li>
  );
  return (
    <>
      <div className="rcp-make__row">
        <div>
          <p className="make-kicker">Print file ready</p>
          <h2>
            {LIST_NAME[b.list]} {b.seq}: {plural(b.count, 'statement')} for {b.year}
          </h2>
          <p className="fnd-note">
            {plural(b.gifts, 'gift')}, {money(b.amount)} net.
            {b.skipped ? ` ${plural(b.skipped, 'partner')} on the list had nothing tax-deductible to print.` : ''} Made by {b.createdBy || 'someone'} on {stamp(b.createdAt)}.
          </p>
        </div>
      </div>
      <ol className="rcp-steps">
        {step(
          1,
          'Print',
          printed,
          false,
          <>
            <p>
              Letterhead or plain paper in the tray. In the print window pick <b>Letter</b> paper, <b>Actual size</b> (100%) and <b>one side</b>.
            </p>
            <a className="req-submit rcp-btn" id="stm-dl" href={`${base}?download=1`} onClick={click}>
              Download the print file
            </a>{' '}
            <a className="fnd-textbtn" id="stm-open" href={base} target="_blank" rel="noopener" onClick={click}>
              or open it in a tab
            </a>
            {printed ? <p className="rcp-fine">Downloaded {stamp(b.downloadedAt)}.</p> : null}
          </>
        )}
        {step(
          2,
          'Mark it printed',
          false,
          printed,
          <>
            <p>
              {printed ? <b>Printed? Press this now.</b> : 'Press this once the statements are printed.'} The next file cannot be made until this one is marked.
            </p>
            <button type="button" className="req-submit exp-green rcp-btn" id="stm-printed" onClick={onPrinted}>
              Mark {plural(b.count, 'statement')} printed
            </button>
            {' '}
            <button type="button" className="fnd-textbtn is-danger" id="stm-discard" onClick={onDiscard}>
              Throw this print file away
            </button>
          </>
        )}
      </ol>
    </>
  );
}

function FilesTable({ list, yearOnly, me }: { list: Batch[]; yearOnly: boolean; me: Me }) {
  if (!list || !list.length) return <p className="fnd-note">Nothing yet.</p>;
  return (
    <div className="fnd-table-wrap">
      <table className="exp-admin-table sc-table stm-table">
        <thead>
          <tr>
            <th>File</th>
            <th>Made</th>
            <th className="r">Statements</th>
            <th className="r">Gifts</th>
            <th className="r">Net</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((b) => {
            const name = b.kind === 'single' ? `Single, ${b.from === `${b.to.slice(0, 4)}-01-01` && b.to.endsWith('12-31') ? b.to.slice(0, 4) : day(b.from) + ' to ' + day(b.to)}` : `${b.year} ${LIST_NAME[b.list] || ''} ${b.seq}`;
            const status = b.kind === 'single' ? 'Made' : b.status === 'printed' ? `Printed ${stamp(b.printedAt)}` : 'Waiting to be marked printed';
            const base = `/api/statements/batches/${encodeURIComponent(b.id)}/pdf`;
            return (
              <tr key={b.id}>
                <td>{name}</td>
                <td>
                  {stamp(b.createdAt)}
                  <br />
                  <span className="rcp-fine">{b.createdBy}</span>
                </td>
                <td className="r">{b.count}</td>
                <td className="r">{b.gifts}</td>
                <td className="r">{money(b.amount)}</td>
                <td>{status}</td>
                <td className="r">
                  <a className="fnd-textbtn" href={base} target="_blank" rel="noopener">
                    Open
                  </a>{' '}
                  <a className="fnd-textbtn" href={`${base}?download=1`}>
                    Download
                  </a>{' '}
                  {!yearOnly || b.list !== 'email' || !me.emailOn ? null : <EmailThem id={b.id} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EmailThem({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="fnd-textbtn"
      data-email={id}
      disabled={busy}
      onClick={async () => {
        if (!confirm('Email these statements to the partners in this file who have an email address? Each partner gets one.')) return;
        setBusy(true);
        try {
          const d = await stmApi<{ result: { sent: number; failed: number; skipped: number } }>(`/api/statements/batches/${encodeURIComponent(id)}`, { action: 'email' });
          toast(`${d.result.sent} sent, ${d.result.failed} failed${d.result.skipped ? `, ${d.result.skipped} already sent or without an email` : ''}.`);
        } catch (err) {
          toast((err as Error).message);
        }
        setBusy(false);
      }}
    >
      Email them
    </button>
  );
}

/* ------------------------------------------------------------------- files */

function Files({ bump }: { bump: number }) {
  const { data } = useSuspenseQuery(filesQuery(bump));
  const { data: me } = useSuspenseQuery(meQuery);
  return (
    <>
      <h2 className="stm-h2">Print files</h2>
      <FilesTable list={data} yearOnly={false} me={me} />
    </>
  );
}

/* ----------------------------------------------------------------- wording */

function Wording({ me }: { me: Me }) {
  const c = me.copy;
  return (
    <>
      <div className="rcp-make__row">
        <div>
          <h2>Wording on the statement</h2>
          <p className="fnd-note">{me.admin ? 'Change any line in Admin.' : 'A FavorOS admin changes these lines in Admin.'}</p>
        </div>
        <div className="rcp-make__form">
          <a className="req-ghost rcp-btn" href="/api/statements/sample" target="_blank" rel="noopener">
            Open a sample statement
          </a>
          {me.admin ? (
            <a className="req-submit rcp-btn" href="/admin/statements/">
              Change the wording
            </a>
          ) : null}
        </div>
      </div>
      <div className="fnd-table-wrap">
        <table className="exp-admin-table sc-table stm-table stm-words">
          <tbody>
            {me.fields.map((f) => (
              <tr key={f.key}>
                <th scope="row">{f.label}</th>
                <td>{c[f.key] || <span className="rcp-fine">Blank</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

