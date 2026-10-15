// Gifts > Overview: the gift day on one screen. Six steps across the top (the mail, online gifts, gifts waiting for a second look, what is in
// Blackbaud this month, receipts, thank-you letters), the gifts Blackbaud took in by day, the month's mail deposits, and the online gifts and
// letters waiting. Same markup and classes as public/js/gifts-home.js (src/styles/gifts-pages.css). Every box holds its final size while its
// read is out, so nothing moves when the numbers arrive.
import { Suspense, type ReactNode } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { GiftTerm } from './Term';
import { failed, monthQuery, overviewQuery, type ChartDay, type Month, type Overview } from './queries';
import { MONTHS, dow, money, short, when } from './fmt';
import '@hub/styles/gifts-pages.css';

const KIND: Record<string, string> = { Regular: 'Regular Mail', Acquisition: 'Acquisition Mail', Grant: 'Grant Mail' };

function Waiting() {
  return (
    <>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div className="gh-step is-wait" key={i} />
      ))}
    </>
  );
}

interface Slots {
  steps: ReactNode;
  chart: ReactNode;
  chartSub: ReactNode;
  deps: ReactNode;
  depsSub: ReactNode;
  online: ReactNode;
  onlineN: ReactNode;
  letters: ReactNode;
  busy?: boolean;
}

/** The frame: static headings and links always show; the bodies and the small counts beside the headings arrive with their reads. */
function Frame({ steps, chart, chartSub, deps, depsSub, online, onlineN, letters, busy }: Slots) {
  return (
    <div className="gh" id="gh-root" aria-busy={busy ? true : undefined}>
      <section className="h-card gh-steps" id="gh-steps" aria-label="The gift day">
        {steps}
      </section>
      <div className="gh-grid">
        <div className="gh-main">
          <section className="h-card gh-card gh-card--chart">
            <header className="gh-hd">
              <h2>Gifts added to Blackbaud</h2>
              <span id="gh-chart-sub">{chartSub}</span>
            </header>
            <div id="gh-chart" className="gh-chartbox">
              {chart}
            </div>
          </section>
          <section className="h-card gh-card gh-card--deps">
            <header className="gh-hd">
              <h2>Mail deposits</h2>
              <span id="gh-deps-sub">{depsSub}</span>
              <a className="gh-link" href="/gift-entry/">
                Gift entry
              </a>
            </header>
            <div id="gh-deps" className="gh-depsbox">
              {deps}
            </div>
          </section>
        </div>
        <aside className="gh-side">
          <section className="h-card gh-card">
            <header className="gh-hd">
              <h2>Online gifts to approve</h2>
              <span id="gh-online-n">{onlineN}</span>
              <a className="gh-link" href="/online-gifts/">
                Approve
              </a>
            </header>
            <div id="gh-online" className="gh-listbox">
              {online}
            </div>
          </section>
          <section className="h-card gh-card">
            <header className="gh-hd">
              <h2>Thank-you letters</h2>
              <span>$5,000 and up</span>
              <a className="gh-link" href="/gifts/letters/">
                Letters desk
              </a>
            </header>
            <div id="gh-letters" className="gh-listbox">
              {letters}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Step({ n, k, big, sub, href, link }: { n: number; k: string; big: string; sub: string; href: string; link: string }) {
  return (
    <a className="gh-step" href={href}>
      <span className="gh-step__k">
        <i className={'gh-n' + (n < 4 ? ' is-warm' : n === 4 ? ' is-ok' : ' is-gold')}>{n}</i>
        {k}
      </span>
      <b className="gh-step__v">{big}</b>
      <span className="gh-step__s">{sub}</span>
      <span className="gh-step__a">
        {link} <span aria-hidden="true">&rarr;</span>
      </span>
    </a>
  );
}

function Steps({ ov }: { ov: Overview | null }) {
  const m0 = useSuspenseQuery(monthQuery).data;
  const m: Month | null = failed(m0) ? null : m0;
  const mail = ov?.mail;
  const on = ov?.online;
  const rv = ov?.review;
  const bb = ov?.blackbaud || (m ? { deposits: m.totals.deposits, cents: m.totals.totalCents } : null);
  const rc = ov?.receipts;
  const lt = ov?.letters;
  const today = ov?.today || '';
  const pick = ov?.pickupDay ? 'started on a pickup day' : 'started today';
  const monthName = MONTHS[Number(today.slice(5, 7)) - 1] || '';
  return (
    <>
      <Step n={1} k="Mail" big={mail ? String(mail.startedToday) : '0'} sub={'deposits ' + pick} href="/gift-entry/?start=1" link="Start a deposit" />
      <Step n={2} k="Online" big={on ? String(on.toApprove) : '0'} sub={on ? 'to approve, ' + money(on.cents, true) : 'to approve'} href="/online-gifts/" link="Online gifts" />
      <Step n={3} k="Review" big={rv ? String(rv.waiting) : '0'} sub="gifts waiting for a second look" href="/gift-entry/" link="Gift entry" />
      <Step n={4} k="In Blackbaud" big={bb ? String(bb.deposits) : '0'} sub={bb ? 'deposits this month, ' + money(bb.cents, true) : 'deposits this month'} href="/gift-entry/" link="Deposits" />
      <Step n={5} k="Receipts" big={rc ? String(rc.lastFile ? rc.lastFile.marked : rc.left) : '0'} sub={rc && rc.lastFile ? 'marked thanked ' + when(rc.lastFile.at, today) : 'receipts waiting to print'} href="/receipts/" link="Receipts" />
      <Step n={6} k="Letters" big={lt ? String(lt.month) : '0'} sub={'gifts of $5,000 and up in ' + monthName} href="/gifts/letters/" link="Thank-you letters" />
    </>
  );
}

function Chart({ c }: { c: Overview['chart'] }) {
  if (!c || !c.days || !c.days.length) return <p className="gh-fail">No gifts in the copy for the last week yet.</p>;
  const cap = c.capCents || 2500000;
  const tot = (d: ChartDay) => Math.min(cap, d.checksCents) + Math.min(cap, d.cardCents) + Math.min(cap, d.otherCents);
  const max = Math.max(1, ...c.days.map(tot));
  const capped = c.days.some((d) => d.checksCents > cap || d.cardCents > cap || d.otherCents > cap);
  const h = (v: number) => ((Math.min(cap, v) / max) * 100).toFixed(1) + '%';
  return (
    <>
      <div className="gh-chart" role="img" aria-label="Gifts added to Blackbaud by day">
        {c.days.map((d) => {
          const tip = `${dow(d.date)} ${short(d.date)}: checks and cash ${money(d.checksCents, true)}, card and online ${money(d.cardCents, true)}, other ${money(d.otherCents, true)}`;
          return (
            <div className="gh-bar" title={tip} key={d.date}>
              <div className="gh-bar__stack">
                <i className="o" style={{ height: h(d.otherCents) }} />
                <i className="c" style={{ height: h(d.cardCents) }} />
                <i className="k" style={{ height: h(d.checksCents) }} />
              </div>
              <span>
                {dow(d.date)} {short(d.date).split(' ')[1]}
              </span>
            </div>
          );
        })}
      </div>
      <div className="gh-legend">
        <span>
          <i className="k" />
          Checks and cash
        </span>
        <span>
          <i className="c" />
          Card and online
        </span>
        <span>
          <i className="o" />
          Other
        </span>
        {capped ? (
          <span className="gh-cap">
            Each part of a day (checks and cash, card and online, other) is drawn at no more than {money(cap, true)}. Hover a bar for the full amounts. Other includes <GiftTerm k="daf" /> grants and stock.
          </span>
        ) : null}
      </div>
    </>
  );
}

function Deposits() {
  const m0 = useSuspenseQuery(monthQuery).data;
  if (failed(m0)) return <p className="gh-fail">The deposits did not load. Reload the page to try again.</p>;
  if (!m0.deposits.length) return <p className="gh-empty">No mail deposits this month yet.</p>;
  return (
    <div className="gh-tbl">
      <div className="gh-tr gh-th">
        <span>Deposit</span>
        <span>Gift date</span>
        <span className="r">Items</span>
        <span className="r">Total</span>
        <span>Entered</span>
        <span>Status</span>
      </div>
      {m0.deposits.slice(0, 8).map((x, i) => {
        const inBb = x.source === 'blackbaud' || x.status === 'committed';
        return (
          <a className="gh-tr" key={(x.favorosId || x.batch || '') + i} href={x.favorosId ? '/gift-entry/?d=' + encodeURIComponent(x.favorosId) : '/gift-entry/'}>
            <span>
              <b>{KIND[x.kind || ''] || 'Regular Mail'}</b> <small>{x.batch || 'Not sent yet'}</small>
            </span>
            <span>{short(x.giftDate)}</span>
            <span className="r">
              {x.items}
              {x.cash ? <small> ({x.cash} cash)</small> : null}
            </span>
            <span className="r gh-amt">{money(x.totalCents)}</span>
            <span>
              <em className={'gh-tag' + (x.source === 'favoros' ? ' is-fos' : '')}>{x.source === 'favoros' ? 'FavorOS' : 'Typed in Blackbaud'}</em> <small>{short(x.addedDate)}</small>
            </span>
            <span>
              <em className={'gh-pill' + (inBb ? ' is-ok' : '')}>{inBb ? 'In Blackbaud' : 'In FavorOS'}</em>
            </span>
          </a>
        );
      })}
    </div>
  );
}

function DepositsSub() {
  const m0 = useSuspenseQuery(monthQuery).data;
  return <>{failed(m0) ? 'this month' : `${m0.totals.deposits} this month · ${m0.totals.items} gifts · ${money(m0.totals.totalCents, true)}`}</>;
}

function OnlineList({ on }: { on: Overview['online'] }) {
  if (!on) return <p className="gh-fail">Online gifts did not load.</p>;
  if (!on.rows || !on.rows.length) return <p className="gh-empty">No giving form gifts in the last 14 days are waiting for approval. Fundraise Up gifts are not counted here.</p>;
  return (
    <>
      {on.rows.map((r, i) => (
        <a className="gh-li" href="/online-gifts/" key={r.name + r.date + i}>
          <b>{r.name}</b>
          <span>
            {money(r.cents)} · {short(r.date)}
            {r.kind ? ' · ' + r.kind : ''}
          </span>
        </a>
      ))}
    </>
  );
}

function LetterList({ lt }: { lt: Overview['letters'] }) {
  if (!lt) return <p className="gh-fail">Thank-you letters did not load.</p>;
  if (!lt.rows || !lt.rows.length) return <p className="gh-empty">No gifts of $5,000 and up this month yet.</p>;
  return (
    <>
      {lt.rows.map((r, i) => (
        <a className="gh-li" href="/gifts/letters/" key={r.name + r.date + i}>
          <b>{r.name}</b>
          <span>
            {money(r.cents)}
            {r.fund ? ' · ' + r.fund : ''} · {short(r.date)}
          </span>
        </a>
      ))}
    </>
  );
}

/** The overview answer decides the whole page: a 403 replaces it with the access message, as the classic page does. */
function Body() {
  const r = useSuspenseQuery(overviewQuery).data;
  if (failed(r) && r.error === 403) {
    return (
      <div className="gh" id="gh-root">
        <section className="h-card gh-card">
          <p className="gh-empty">Gifts is for the admin desk, Partner Care and the Support Team. Ask an admin for gift entry access.</p>
        </section>
      </div>
    );
  }
  const ov: Overview | null = failed(r) ? null : r;
  const days = ov?.chart?.days;
  return (
    <Frame
      steps={
        <Suspense fallback={<Waiting />}>
          <Steps ov={ov} />
        </Suspense>
      }
      chart={ov ? <Chart c={ov.chart} /> : <p className="gh-fail">The chart did not load.</p>}
      chartSub={days && days.length ? `${short(days[0].date)} to ${short(days[days.length - 1].date)}, by day` : ''}
      deps={
        <Suspense fallback={null}>
          <Deposits />
        </Suspense>
      }
      depsSub={
        <Suspense fallback="this month">
          <DepositsSub />
        </Suspense>
      }
      online={<OnlineList on={ov?.online} />}
      onlineN={ov?.online ? ov.online.toApprove || '' : ''}
      letters={<LetterList lt={ov?.letters} />}
    />
  );
}

export function GiftsOverview() {
  return (
    <Suspense fallback={<Frame busy steps={<Waiting />} chart={null} chartSub="" deps={null} depsSub="this month" online={null} onlineN="" letters={null} />}>
      <Body />
    </Suspense>
  );
}
