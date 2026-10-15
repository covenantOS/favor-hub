// Gift entry's front page: Today's deposit (the setup form and the open deposits), the month's deposits from Blackbaud, what waits after
// entry, Needs coding and the Day summary. Markup and class names follow home() in public/js/gift-entry.js.
import { startTransition, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient, useSuspenseQueries } from '@tanstack/react-query';
import { NavLink } from '@/shell/NavLink';
import { geKeys, geWrites, indexQuery, monthQuery, needsQuery, overviewQuery, summaryQuery } from './data';
import { KIND, KINDS, STEPS, dayText, etTime, filterMonth, isInBlackbaud, money, moneyS, nameOf, pickupText, pillOf, short, tapeTotalParam } from './logic';
import type { DepositListItem, GeMonth, GeOverview, GeSummary, MonthDeposit, NeedsItem } from './types';
import { Icon } from './Icon';

export interface HomeForm {
  kind: string;
}

export function Pill({ status }: { status: string }) {
  const p = pillOf(status);
  return <span className={'ge-pill' + (p.tone ? ' ge-pill--' + p.tone : '')}>{p.text}</span>;
}

function DepStatus({ x }: { x: MonthDeposit }) {
  if (isInBlackbaud(x)) return <span className="ge-pill ge-pill--ok">In Blackbaud</span>;
  return <Pill status={x.status || 'open'} />;
}

function itemsText(x: MonthDeposit) {
  return `${x.items} ${x.items === 1 ? 'item' : 'items'}${x.cash ? ' (' + x.cash + ' cash)' : ''}`;
}

function DepRows({ month, filter, open }: { month: GeMonth | null; filter: string; open: (id: string) => void }) {
  if (!month) return <div className="ge-empty">The deposits from Blackbaud did not load. Reload the page to try again.</div>;
  const list = filterMonth(month.deposits, filter);
  if (!list.length) return <div className="ge-empty">{filter === 'open' ? 'No deposit is open.' : 'No deposits this month yet.'}</div>;
  return (
    <div className="ge-tbl" role="table" aria-label="Deposits this month">
      <div className="ge-tr ge-th" role="row">
        <span role="columnheader">Deposit</span>
        <span role="columnheader">Gift date</span>
        <span role="columnheader" className="r">
          Items
        </span>
        <span role="columnheader" className="r">
          Total
        </span>
        <span role="columnheader">Entered</span>
        <span role="columnheader">Status</span>
      </div>
      {list.map((x, i) => {
        const inner = (
          <>
            <span className="c-dep" role="cell">
              <b>{KIND[x.kind] || 'Regular Mail'}</b> <span className="ge-batch">{x.batch || 'Not sent yet'}</span>
            </span>
            <span className="c-date" role="cell">
              {short(x.giftDate)}
            </span>
            <span className="c-n r" role="cell">
              {x.items}
              {x.cash ? (
                <>
                  {' '}
                  <small>({x.cash} cash)</small>
                </>
              ) : null}
            </span>
            <span className="c-amt r ge-money" role="cell">
              {money(x.totalCents)}
            </span>
            <span className="c-ent" role="cell">
              <span className="ge-ph">
                {short(x.giftDate)} · {itemsText(x)} ·{' '}
              </span>
              {x.source === 'blackbaud' ? <span className="ge-tag">Typed in Blackbaud</span> : <span className="ge-tag ge-tag--fos">FavorOS{x.enteredBy ? ' · ' + nameOf(x.enteredBy) : ''}</span>} <small>{short(x.addedDate)}</small>
            </span>
            <span className="c-st" role="cell">
              <DepStatus x={x} />
            </span>
          </>
        );
        const key = x.batch || 'row' + i;
        return x.favorosId ? (
          <a
            key={key}
            className="ge-tr"
            role="row"
            href={'/gift-entry/?d=' + encodeURIComponent(x.favorosId)}
            data-open={x.favorosId}
            onClick={(e) => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              open(x.favorosId as string);
            }}
          >
            {inner}
          </a>
        ) : (
          <div key={key} className="ge-tr" role="row">
            {inner}
          </div>
        );
      })}
    </div>
  );
}

function DepCard({ month, filter, setFilter, open }: { month: GeMonth | null; filter: string; setFilter: (f: string) => void; open: (id: string) => void }) {
  const sub = month ? `${month.totals.deposits} this month · ${month.totals.items} gifts · ${money(month.totals.totalCents)}` : '';
  return (
    <section className="h-card ge-card ge-deps">
      <div className="ge-hd">
        <h2>Deposits</h2>
        <span className="ge-muted">{sub}</span>
        <span className="sp"></span>
        <div className="ge-seg ge-seg--sm" role="group" aria-label="Show">
          {[
            ['all', 'All'],
            ['open', 'Open'],
            ['bb', 'In Blackbaud'],
          ].map(([k, l]) => (
            <button key={k} type="button" data-depf={k} className={filter === k ? 'is-on' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div id="ge-deprows">
        <DepRows month={month} filter={filter} open={open} />
      </div>
      {month && month.asOf ? <p className="ge-asof">Blackbaud copy as of {etTime(month.asOf)}. A batch typed today shows after the next copy.</p> : null}
    </section>
  );
}

function AfterCard({ ov }: { ov: GeOverview | null }) {
  const r = ov?.receipts;
  const l = ov?.letters;
  const rs = r && r.lastFile ? `Last print file ${etTime(r.lastFile.at)}, ${r.lastFile.marked} gifts marked thanked` : r && r.left ? `${r.left} receipts waiting` : 'Gifts join the receipts list once their batch is approved';
  const ls = l ? `${l.month} ${l.month === 1 ? 'gift' : 'gifts'} of $5,000 and up this month` : 'Handwritten letters for gifts of $5,000 and up';
  const row = (t: string, s: string, href: string) => (
    <div className="ge-after">
      <div>
        <b>{t}</b>
        <span>{s}</span>
      </div>
      <NavLink className="ge-btn ge-btn--sm" href={href}>
        Open
      </NavLink>
    </div>
  );
  return (
    <section className="h-card ge-card">
      <div className="ge-hd">
        <h2>Waiting after entry</h2>
      </div>
      {row('Receipts', rs, '/receipts/')}
      {row('Thank-you letters', ls, '/gifts/letters/')}
      {row('Missing images', 'Gifts that need a check or letter image', '/work/?view=giftimages')}
    </section>
  );
}

function NeedsCard({ items }: { items: NeedsItem[] }) {
  if (!items.length) return null;
  return (
    <section className="h-card ge-card">
      <div className="ge-hd">
        <h2>Needs coding</h2>
        <span className="ge-muted">{items.length} White Mail</span>
      </div>
      {items.slice(0, 20).map((x) => (
        <div className="ge-sumrow" key={x.id}>
          <b>{x.partner || 'Gift ' + x.seq}</b>
          <span className="f">
            {x.deposit.name} · {x.reason}
            {x.suggestions.length ? ' · ' + x.suggestions.map((y) => y.code + ' (' + y.reason + ')').join('; ') : ''}
          </span>
          <span className="a ge-money">{money(x.amountCents)}</span>
        </div>
      ))}
    </section>
  );
}

function SummaryCard({ data, today, onDate }: { data: GeSummary; today: string; onDate: (d: string) => void }) {
  const s = data.summary;
  const t = s.totals;
  const dates = Array.from(new Set([s.date].concat(data.dates)));
  const sel = (
    <select className="ge-select" data-sumdate="" aria-label="Day" value={s.date} onChange={(e) => onDate(e.target.value)}>
      {dates.map((x) => (
        <option key={x} value={x}>
          {dayText(x, today)}
        </option>
      ))}
    </select>
  );
  const offCents = t.diffCents;
  const offCount = t.diffCount;
  return (
    <section className="h-card ge-card">
      <div className="ge-hd">
        <h2>Day summary</h2>
        {s.ties ? <span className="ge-pill ge-pill--ok">Ties to the tape</span> : <span className="ge-pill ge-pill--warn">Open items</span>}
        <span className="sp"></span>
        {sel}
      </div>
      <div className="ge-tiles">
        <div className="ge-tile">
          <span className="n ge-money">{money(t.tapeCents)}</span>
          <span className="l">Tape, {t.tapeCount} items</span>
        </div>
        <div className={'ge-tile ' + (offCents || offCount ? 'is-bad' : 'is-ok')}>
          <span className="n ge-money">{money(t.enteredCents)}</span>
          <span className="l">
            Entered, {t.enteredCount} items{offCents ? ' · ' + moneyS(offCents) : ''}
          </span>
        </div>
        <div className="ge-tile">
          <span className="n ge-money">{money(t.approvedCents)}</span>
          <span className="l">Approved, {t.approvedCount} items</span>
        </div>
      </div>
      {s.open.length ? (
        <ul className="ge-open">
          {s.open.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : null}
      <div className="ge-sumrows">
        {s.deposits.map((d) => (
          <div className="ge-sumrow" key={d.id}>
            <b>{d.name}</b>
            <span className="f">
              {d.enteredCount} of {d.tapeCount} · {d.approvers.length ? 'approved by ' + d.approvers.map(nameOf).join(', ') : 'not approved'}
              {d.heldCount ? ' · ' + d.heldCount + ' held' : ''}
              {d.rejectedCount ? ' · ' + d.rejectedCount + ' rejected, ' + money(d.rejectedCents) : ''}
              {d.batch ? ' · batch ' + d.batch : ''}
            </span>
            <span className="a ge-money">{money(d.enteredCents)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function OpenList({ list, open }: { list: DepositListItem[]; open: (id: string) => void }) {
  const rows = list.filter((x) => x.status === 'open' || x.status === 'needs_person');
  if (!rows.length) return null;
  return (
    <div className="ge-openlist">
      {rows.map((x) => (
        <a
          key={x.id}
          className="ge-dep"
          href={'/gift-entry/?d=' + encodeURIComponent(x.id)}
          data-open={x.id}
          onClick={(e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            open(x.id);
          }}
        >
          <b>{x.name}</b>
          <span className="f">
            {x.gifts} of {x.tape_count} photographed · {money(x.tape_cents)} on the tape · {x.created_by}
          </span>
          <span className="r">
            <Pill status={x.status} />
            <span className="a ge-money">{money(x.cents)}</span>
          </span>
        </a>
      ))}
    </div>
  );
}

export function Home({ start, form, setForm, depFilter, setDepFilter, sumDate, setSumDate }: {
  start: boolean;
  form: HomeForm;
  setForm: (f: HomeForm) => void;
  depFilter: string;
  setDepFilter: (f: string) => void;
  sumDate: string;
  setSumDate: (d: string) => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Every read goes out together, as the classic page did; the month comes from the Blackbaud copy.
  const [idx, sum, needs, month, overview] = useSuspenseQueries({ queries: [indexQuery, summaryQuery(sumDate), needsQuery, monthQuery, overviewQuery] });
  const d = idx.data;
  const s = sum.data;
  const showSum = !!(s && s.summary && s.summary.deposits && s.summary.deposits.length);
  const tapeRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (start && tapeRef.current) tapeRef.current.focus();
  }, [start]);

  const openDeposit = (id: string) => {
    void navigate({ to: '/gift-entry/', search: { d: id }, replace: true });
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    const date = String(f.get('date') || '');
    const tapeTotal = String(f.get('tapeTotal') || '');
    const tapeCount = String(f.get('tapeCount') || '');
    setBusy(true);
    try {
      const out = await geWrites.createDeposit({ kind: form.kind, date, tapeTotal: tapeTotalParam(tapeTotal), tapeCount });
      // The server has made the deposit by now; the classic page asked afterwards and so does this one.
      if (out.sameDayExists && !confirm('A ' + form.kind + ' deposit for that date already exists. Start another one anyway?')) return;
      void qc.invalidateQueries({ queryKey: geKeys.all });
      openDeposit(out.deposit.id);
    } catch (er) {
      setErr((er as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pick = pickupText(d.today);
  return (
    <div className="ge-home">
      <section className="h-card ge-card ge-today">
        <div className="ge-today__top">
          <div className="ge-today__h">
            <div className="ge-today__t">
              <h2>Today&apos;s deposit</h2>
              {pick ? <span className="ge-pill ge-pill--warn">{pick}</span> : null}
            </div>
            <p>Count the checks and cash, run the tape, then photograph each item.</p>
          </div>
          <form className="ge-today__form" id="ge-setup" noValidate onSubmit={submit}>
            <div className="ge-f">
              <span>Type</span>
              <div className="ge-seg" role="group" aria-label="Kind of mail">
                {KINDS.map(([k, l]) => (
                  <button key={k} type="button" data-kind={k} className={form.kind === k ? 'is-on' : ''} onClick={() => setForm({ kind: k })}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <label className="ge-f ge-f--date">
              <span>Date</span>
              <input type="date" name="date" defaultValue={d.today} max={d.today} required />
            </label>
            <label className="ge-f">
              <span>Tape total</span>
              <input name="tapeTotal" id="ge-tape" ref={tapeRef} inputMode="decimal" placeholder="$0.00" defaultValue="" required />
            </label>
            <label className="ge-f ge-f--n">
              <span>Items</span>
              <input name="tapeCount" inputMode="numeric" placeholder="0" defaultValue="" required />
            </label>
            <button className="ge-btn ge-btn--primary" type="submit">
              <Icon n="cam" />
              Start photographing
            </button>
          </form>
        </div>
        <div id="ge-err" className="ge-err" hidden={!err}>
          {err}
        </div>
        <ol className="ge-steps">
          {STEPS.map((x, i) => (
            <li key={x} className={i === 0 ? 'is-now' : ''}>
              <i>{i + 1}</i>
              {x}
            </li>
          ))}
        </ol>
        <OpenList list={d.deposits} open={openDeposit} />
      </section>
      <div className="ge-home__grid">
        <div className="ge-home__main">
          <DepCard month={month.data as GeMonth | null} filter={depFilter} setFilter={setDepFilter} open={openDeposit} />
        </div>
        <aside className="ge-home__side">
          <AfterCard ov={overview.data as GeOverview | null} />
          <NeedsCard items={needs.data.items} />
          {showSum ? (
            <SummaryCard
              data={s}
              today={d.today}
              onDate={(v) =>
                startTransition(() => {
                  setSumDate(v);
                })
              }
            />
          ) : null}
          {d.me && d.me.admin ? (
            <div className="ge-sidefoot">
              <NavLink className="ge-link" href="/admin/gifts/">
                Who can enter gifts, in Admin settings
              </NavLink>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

