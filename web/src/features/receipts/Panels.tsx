// The parts of the Receipts page: the print file card, the receipts list, held back, past printings and the wording.
// Same markup and class names as public/js/receipts.js drew, so the stylesheets apply unchanged.
import { Fragment, Suspense, useState, type ReactNode } from 'react';
import { QueryErrorResetBoundary, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Boundary } from '../partners/record/Boundary';
import { Term } from '../partners/record/Ic';
import { rcpKeys, rcpApi, wordingQuery, type Batch, type Copy, type Item, type Waiting } from './api';
import { codeFor, day, etDay, money, num, plural, shortDay, stamp, today } from './format';
import { FLAG_WORD, HELD, HELD_SHOW, KINDS, PAGE, countsOf, flaggedGoing, groupLetters, issuesOf, partnerKey, type Group } from './logic';
import { toast } from './toast';

/* ------------------------------------------------------------ loading */

/** The same shapes the page fills with: four totals, the print file card, then rows. */
export function StatsSkeleton({ slow }: { slow?: boolean }) {
  return (
    <div className="rcp-skel" role="status" aria-label="Reading Blackbaud">
      <div className="rcp-skel__stats">
        {[0, 1, 2, 3].map((i) => (
          <div key={i}>
            <span className="cf-skel cf-skel--stat" />
            <span className="cf-skel cf-skel--rowhead" />
          </div>
        ))}
      </div>
      <p className="rcp-load-note">
        <span className="rcp-spin" aria-hidden="true" />
        <span id="rcp-load-text">{slow ? 'Still reading Blackbaud' : 'Reading Blackbaud'}</span>
      </p>
    </div>
  );
}

export function MakeSkeleton() {
  return (
    <div className="rcp-skel" aria-hidden="true">
      <span className="cf-skel" style={{ height: 26, width: '46%' }} />
      <span className="cf-skel" style={{ width: '84%' }} />
      <span className="cf-skel" style={{ width: '70%' }} />
      <span className="cf-skel" style={{ height: 48, width: 160, borderRadius: 999, marginTop: 10 }} />
    </div>
  );
}

export function ListError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rcp-loading is-bad">
      {message}{' '}
      <button type="button" className="fnd-textbtn" id="rcp-retry" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

/* ------------------------------------------------------------- stats */

const Stat = ({ n, cap }: { n: number; cap: ReactNode }) => (
  <div className="ticker__stat">
    <div className="ticker__num">{num(n)}</div>
    <div className="ticker__caption">{cap}</div>
  </div>
);

export function Stats({ list, open }: { list: Item[]; open: boolean }) {
  const c = countsOf(list);
  const dates = list.map((l) => l.date).sort();
  return (
    <>
      <Stat
        n={c.letters}
        cap={
          <>
            {open ? 'Not in the print file yet' : 'Receipts to print'}
            {dates.length ? (
              <>
                <br />
                {plural(c.gifts, 'gift')}, {shortDay(dates[0])} to {day(dates[dates.length - 1])}
              </>
            ) : null}
          </>
        }
      />
      <Stat n={c.regular} cap="Regular" />
      <Stat n={c.major} cap="$200 and up" />
      <Stat n={c.recurring} cap="Monthly partners" />
    </>
  );
}

/* -------------------------------------------------------------- make */

export function MakePanel(p: {
  view: Waiting;
  list: Item[];
  shared: number;
  letterDate: string;
  setLetterDate: (d: string) => void;
  busy: boolean;
  onMake: () => void;
  onShowFlagged: () => void;
  ask: ReactNode;
}) {
  const c = countsOf(p.list);
  const date = p.letterDate || today();
  const ch = p.view.check || { partners: 0, address: 0, greeting: 0, duplicate: 0 };
  const left = flaggedGoing(p.view, p.list);
  const parts = [ch.address && plural(ch.address, 'address', 'addresses'), ch.greeting && plural(ch.greeting, 'greeting'), ch.duplicate && plural(ch.duplicate, 'possible duplicate')].filter(Boolean);
  return (
    <>
      <div className="rcp-make__row">
        <div>
          <h2>Make the print file</h2>
          <p className="fnd-note">
            {p.list.length
              ? `${plural(c.letters, 'receipt')} for ${plural(c.gifts, 'gift')}: ${c.regular} regular, ${c.major} of $200 and up, ${c.recurring} monthly.${
                  p.shared ? ` ${p.shared === 1 ? 'One address has receipts' : `${p.shared} addresses have receipts`} for two records, marked "Same address" below. They print back to back.` : ''
                }`
              : 'Nothing is waiting for a receipt.'}
          </p>
        </div>
        <div className="rcp-make__form">
          <label className="req-field rcp-date">
            <span>Date on the receipts</span>
            <input type="date" id="rcp-date" value={date} onChange={(e) => p.setLetterDate(e.target.value || today())} />
          </label>
          <div className="rcp-code">
            <span>Reply code</span>
            <b id="rcp-code-out">{codeFor(date)}</b>
          </div>
          <button type="button" className="req-submit" id="rcp-make-go" disabled={!(p.list.length && !p.busy)} onClick={p.onMake}>
            {p.busy ? 'Making the file' : 'Make the print file'}
          </button>
          {p.ask}
        </div>
      </div>
      {p.list.length ? (
        ch.partners ? (
          <div className="rcp-check" id="rcp-check">
            <p>
              <b>{plural(left, 'receipt')} to look at before printing.</b> {parts.join(', ')}.
            </p>
            <button type="button" className="fnd-textbtn" id="rcp-check-show" onClick={p.onShowFlagged}>
              Show them
            </button>
          </div>
        ) : (
          <p className="rcp-check is-clear" id="rcp-check">
            Checked before printing: no address, greeting or duplicate problems.
          </p>
        )
      ) : null}
      <p className="rcp-fine">Nothing is marked thanked until you press "Mark as thanked".</p>
    </>
  );
}

function Step({ n, title, done, next, children }: { n: number; title: string; done: boolean; next: boolean; children: ReactNode }) {
  return (
    <li className={`rcp-step${done ? ' is-done' : ''}${next ? ' is-next' : ''}`}>
      <span className="rcp-step__n">{done ? '✓' : n}</span>
      <div>
        <h3>{title}</h3>
        {children}
      </div>
    </li>
  );
}

export function BatchSteps(p: {
  b: Batch;
  busy: boolean;
  /** When this page saw the first download (the server notes it too), as an ISO time; empty until then. */
  downloadedHere: string;
  onDownloadClick: () => void;
  onMark: () => void;
  onCancel: () => void;
  askMark: ReactNode;
  askCancel: ReactNode;
}) {
  const { b } = p;
  const base = `/api/receipts/batches/${encodeURIComponent(b.id)}/pdf`;
  const marking = b.status === 'marking';
  const total = b.gifts || b.count;
  const pct = total ? Math.round((b.marked / total) * 100) : 0;
  const downloadedAt = b.downloadedAt || p.downloadedHere || null;
  const printed = Boolean(downloadedAt);
  const madeDay = etDay(b.createdAt);
  const waited = Boolean(madeDay) && madeDay < today();
  return (
    <>
      <div className="rcp-make__row">
        <div>
          <p className="make-kicker">Print file ready</p>
          <h2>
            {plural(b.count, 'receipt')} dated {day(b.letterDate)}
          </h2>
          <p className="fnd-note">
            {b.regular} regular, {b.major} of $200 and up, {b.recurring} monthly. {plural(total, 'gift')} from {day(b.firstGift)} to {day(b.lastGift)}, {money(b.amount)} in all. Made by {b.createdBy || 'someone'} on {stamp(b.createdAt)}.
          </p>
        </div>
        <div className="rcp-code rcp-code--big">
          <span>Write on the reply envelopes</span>
          <b>{b.appealCode}</b>
        </div>
      </div>
      {waited ? (
        <p className="rcp-nudge" role="status">
          <b>Not marked thanked yet.</b> This print file was made {day(madeDay)}. If the receipts were printed, mark them thanked now. If they were never printed, throw the file away.
        </p>
      ) : null}
      <ol className="rcp-steps">
        <Step n={1} title="Check the proof" done={false} next={false}>
          <p>Every page drawn on a picture of the receipt paper. Look at the first few and the last few.</p>
          <a className="req-ghost rcp-btn" href={`${base}?proof=1`} target="_blank" rel="noopener">
            Open the proof
          </a>
        </Step>
        <Step n={2} title="Print" done={printed} next={false}>
          <p>
            Receipt paper in the tray. In the print window pick <b>Legal</b> paper, <b>Actual size</b> (100%), and printing on <b>one side</b>.
          </p>
          <a className="req-submit rcp-btn" id="rcp-dl" href={`${base}?download=1`} onClick={p.onDownloadClick}>
            Download the print file
          </a>{' '}
          <a className="fnd-textbtn" id="rcp-open" href={base} target="_blank" rel="noopener" onClick={p.onDownloadClick}>
            or open it in a tab
          </a>
          {printed ? <p className="rcp-fine rcp-step__when">Downloaded {stamp(downloadedAt)}.</p> : null}
        </Step>
        <Step n={3} title="Mark as thanked in Blackbaud" done={false} next={printed || waited || marking}>
          <p>
            {printed || waited ? <b>Printed? Press this now.</b> : 'Press this once the receipts are printed.'} Every gift in them is marked thanked, dated {day(b.letterDate)}, so it leaves this list. No new print file can be made until this one is marked.
          </p>
          {marking || b.marked ? (
            <>
              <div className="rcp-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${pct}%` }} />
              </div>
              <p className="rcp-fine" id="rcp-mark-msg">
                {b.marked} of {plural(total, 'gift')} marked{b.markFailed ? `, ${b.markFailed} Blackbaud turned down` : ''}.
              </p>
            </>
          ) : null}
          <button type="button" className="req-submit exp-green rcp-btn" id="rcp-mark" disabled={p.busy} onClick={p.onMark}>
            {b.marked ? 'Finish marking' : `Mark ${plural(total, 'gift')} as thanked`}
          </button>{' '}
          {p.askMark}
          {b.marked ? null : (
            <button type="button" className="fnd-textbtn is-danger" id="rcp-cancel" onClick={p.onCancel}>
              Throw this print file away
            </button>
          )}
          {b.marked ? null : p.askCancel}
        </Step>
      </ol>
    </>
  );
}

/* ----------------------------------------------------------- receipts */

function RecordLink({ lookup, label }: { lookup: string; label: string }) {
  return lookup ? (
    <a className="rcp-fixlink" href="/work/partner/" data-partner-lookup={lookup}>
      {label}
    </a>
  ) : null;
}

const Lines = ({ items }: { items: string[] }) => (
  <>
    {items.map((t, i) => (
      <Fragment key={i}>
        {i > 0 ? <br /> : null}
        {t}
      </Fragment>
    ))}
  </>
);

export function LettersTable(p: {
  rows: Group[];
  all: number;
  page: number;
  left: Set<string>;
  shared: Map<string, Map<string, string>>;
  allChecked: boolean;
  onTick: (ids: string[], on: boolean) => void;
  onTickAll: (on: boolean) => void;
}) {
  const shown = p.rows.slice((p.page - 1) * PAGE, p.page * PAGE);
  return (
    <div className="fnd-table-wrap">
      <table className="exp-admin-table rcp-table sc-table">
        <thead>
          <tr>
            <th className="rcp-tick">
              <input type="checkbox" id="rcp-all" checked={p.allChecked} onChange={(e) => p.onTickAll(e.target.checked)} aria-label="Print every receipt" title="Check or uncheck every receipt, on every page" />
            </th>
            <th>Partner</th>
            <th>Gift date</th>
            <th className="r">Amount</th>
            <th>Receipt</th>
          </tr>
        </thead>
        <tbody id="rcp-rows">
          {!p.rows.length ? (
            <tr>
              <td colSpan={5} className="fnd-empty">
                {p.all ? 'No receipts match.' : 'Nothing is waiting for a receipt.'}
              </td>
            </tr>
          ) : (
            shown.map((g) => {
              const l = g.first;
              const ids = g.gifts.map((x) => x.id);
              const off = Boolean(g.batch);
              const on = !off && !ids.some((id) => p.left.has(id));
              const funds = [...new Set(g.gifts.map((x) => x.fund).filter((f) => f && f !== 'Where Needed Most'))];
              const notes: [string, string][] = [];
              if (g.gifts.length > 1) notes.push(['', `One receipt for ${num(g.gifts.length)} gifts, ${money(g.gifts.reduce((t, x) => t + x.amount, 0))} in all`]);
              const same = !off && l.addressKey && p.shared.get(l.addressKey);
              if (same) {
                const others = [...same].filter(([k]) => k !== partnerKey(l)).map(([, name]) => name);
                if (others.length) notes.push([' is-warn', `Same address as ${others.join(' and ')}`]);
              }
              const flags = off ? [] : issuesOf(g);
              return (
                <tr key={ids.join(',') + '|' + (g.batch ? g.batch.id : '')} className={`${on ? '' : 'is-off'}${flags.length ? ' has-flag' : ''}`}>
                  <td className="rcp-tick">
                    <input type="checkbox" data-ids={ids.join(',')} checked={on} disabled={off} onChange={(e) => p.onTick(ids, e.target.checked)} aria-label={`Print a receipt for ${l.addressee}`} />
                  </td>
                  <td>
                    <span className="fnd-name">{String(l.addressee || '').trim() || 'No addressee on file'}</span>
                    <span className="fnd-sub">
                      {l.place}
                      {funds.length ? ` · ${funds.join(', ')}` : ''}
                    </span>
                    {notes.map(([cls, text], i) => (
                      <span key={i} className={`rcp-note${cls}`}>
                        {text}
                      </span>
                    ))}
                    {flags.map((i) => (
                      <span key={i.code + '|' + (i.other?.lookup || '')} className="rcp-flag" data-code={i.code}>
                        <b>{FLAG_WORD[i.group]}</b> {i.text} <span className="rcp-flag__fix">{i.fix}</span> <RecordLink lookup={l.constituentLookup} label="Open the record" />
                        {i.other && i.other.lookup ? (
                          <>
                            {' '}
                            <RecordLink lookup={i.other.lookup} label="Open the other record" />
                          </>
                        ) : null}
                      </span>
                    ))}
                  </td>
                  <td className="mono">
                    <Lines items={g.gifts.map((x) => day(x.date))} />
                  </td>
                  <td className="r">
                    <Lines items={g.gifts.map((x) => money(x.amount))} />
                  </td>
                  <td>
                    {off && g.batch ? <span className="exp-pill pending">In the {shortDay(g.batch.letterDate)} print file</span> : <span className={`exp-pill rcp-pill-${g.segment}`}>{KINDS[g.segment]}</span>}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------------------------- held */

export function HeldView(p: { view: Waiting; added: Set<string>; heldOpen: Set<string>; onMore: (k: string) => void; onAdd: (id: string) => void }) {
  const v = p.view;
  if (!v.held.length) return <p className="fnd-empty">Nothing is held back.</p>;
  const groups: Record<string, Item[]> = {};
  for (const h of v.held) (groups[h.key] = groups[h.key] || []).push(h);
  const order = Object.keys(HELD).filter((k) => groups[k]);
  return (
    <>
      <p className="fnd-note">These gifts stay unthanked in Blackbaud and get no receipt. A gift that is fixed in Blackbaud (an address added, a code removed) comes back to the receipts the next time this page loads.</p>
      {order.map((k) => {
        const [title, note] = HELD[k];
        const every = groups[k];
        const folds = every.length > HELD_SHOW + 2;
        const list = folds && !p.heldOpen.has(k) ? every.slice(0, HELD_SHOW) : every;
        return (
          <div className="rcp-held" key={k}>
            <h3>
              {title} <span>{every.length}</span>
            </h3>
            {note ? <p className="rcp-fine">{k === 'organization' ? <OrganizationNote /> : note}</p> : null}
            <table className="exp-admin-table rcp-table sc-table">
              <tbody>
                {list.map((h) => (
                  <tr key={h.id}>
                    <td>
                      <span className="fnd-name">{h.addressee}</span>
                      <span className="fnd-sub">{h.place || h.reason}</span>
                    </td>
                    <td className="mono">{day(h.date)}</td>
                    <td className="r">{money(h.amount)}</td>
                    <td className="rcp-held__act">
                      {h.batch ? (
                        <span className="exp-pill pending">In the {shortDay(h.batch.letterDate)} print file</span>
                      ) : h.canAdd ? (
                        <button type="button" className={`fnd-textbtn${p.added.has(h.id) ? '' : ' is-quiet'}`} data-add={h.id} onClick={() => p.onAdd(h.id)}>
                          {p.added.has(h.id) ? 'Will print. Undo' : 'Add a receipt'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {folds ? (
              <button type="button" className="fnd-textbtn rcp-more" data-more={k} onClick={() => p.onMore(k)}>
                {p.heldOpen.has(k) ? 'Show fewer' : `Show all ${every.length}`}
              </button>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/** HELD.organization with DAF explained in its plain meaning. */
function OrganizationNote() {
  return (
    <>
      Churches and ministries get receipts. Other organizations do not, and neither does a person whose gift came through a foundation, business or <Term k="daf" label="DAF" />.
    </>
  );
}

/* --------------------------------------------------------------- past */

function StatusPill({ b }: { b: Batch }) {
  if (b.kind === 'reprint') return <span className="exp-pill pending">Printed again</span>;
  if (b.status === 'done') return <span className="exp-pill approved">Marked thanked</span>;
  if (b.status === 'marking')
    return (
      <span className="exp-pill fnd-pill-work">
        {num(b.marked)} of {plural(b.gifts || b.count, 'gift')} marked
      </span>
    );
  return <span className="exp-pill fnd-pill-two">Not marked yet</span>;
}

export function PastView(p: { batches: Batch[]; onReprint: (date: string, letterDate: string, button: HTMLButtonElement) => void; reprinting: boolean }) {
  const [again, setAgain] = useState('');
  const [letter, setLetter] = useState(today);
  return (
    <>
      {p.batches.length ? (
        <div className="fnd-table-wrap">
          <table className="exp-admin-table rcp-table sc-table">
            <thead>
              <tr>
                <th>Receipts dated</th>
                <th className="r">Receipts</th>
                <th>Gifts from</th>
                <th>Made by</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {p.batches.map((b) => {
                const base = `/api/receipts/batches/${encodeURIComponent(b.id)}/pdf`;
                return (
                  <tr key={b.id}>
                    <td>
                      <span className="fnd-name">{day(b.letterDate)}</span>
                      <span className="fnd-sub">{b.kind === 'reprint' ? `Gifts marked ${day(b.sourceDate)}` : b.appealCode}</span>
                    </td>
                    <td className="r">
                      {num(b.count)}
                      {b.gifts && b.gifts !== b.count ? <span className="fnd-sub">{plural(b.gifts, 'gift')}</span> : null}
                    </td>
                    <td className="mono">{[shortDay(b.firstGift), shortDay(b.lastGift)].filter(Boolean).join(' to ')}</td>
                    <td>
                      {b.createdBy}
                      <span className="fnd-sub">{stamp(b.createdAt)}</span>
                    </td>
                    <td>
                      <StatusPill b={b} />
                    </td>
                    <td className="rcp-past__act">
                      <a className="fnd-textbtn" href={`${base}?download=1`}>
                        Print file
                      </a>{' '}
                      <a className="fnd-textbtn is-quiet" href={`${base}?proof=1`} target="_blank" rel="noopener">
                        Proof
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="fnd-empty">No print files yet.</p>
      )}
      <div className="rcp-again">
        <h3>Print a past run again</h3>
        <p className="rcp-fine">Makes receipts for every gift Blackbaud shows as thanked on one day, for a run that was marked but never printed or mailed. Nothing in Blackbaud changes.</p>
        <div className="rcp-again__row">
          <label className="req-field">
            <span>Gifts marked thanked on</span>
            <input type="date" id="rcp-again-date" value={again} onChange={(e) => setAgain(e.target.value)} />
          </label>
          <label className="req-field">
            <span>Date on the receipts</span>
            <input type="date" id="rcp-again-letter" value={letter} onChange={(e) => setLetter(e.target.value)} />
          </label>
          <button type="button" className="req-ghost" id="rcp-again-go" disabled={p.reprinting} onClick={(e) => p.onReprint(again, letter || today(), e.currentTarget)}>
            {p.reprinting ? 'Reading Blackbaud' : 'Make the print file'}
          </button>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ wording */

export function WordingView({ needWho, who }: { needWho: () => boolean; who: string }) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <Boundary
          fallback={(e, retry) => (
            <p className="fnd-empty">
              {e.message}{' '}
              <button
                type="button"
                className="fnd-textbtn"
                onClick={() => {
                  reset();
                  retry();
                }}
              >
                Try again
              </button>
            </p>
          )}
        >
          <Suspense fallback={<p className="fnd-empty">Loading the receipt.</p>}>
            <WordingForm needWho={needWho} who={who} />
          </Suspense>
        </Boundary>
      )}
    </QueryErrorResetBoundary>
  );
}

const asList = (s: string) => s.split(/[,\s$]+/).filter(Boolean).map(Number);

function WordingForm({ needWho, who }: { needWho: () => boolean; who: string }) {
  const { data: w, dataUpdatedAt } = useSuspenseQuery(wordingQuery);
  return <WordingFields key={dataUpdatedAt} w={w} needWho={needWho} who={who} />;
}

function WordingFields({ w, needWho, who }: { w: { copy: Copy; fit: { fits: boolean }; saved: { updated_by: string; updated_at: string } | null }; needWho: () => boolean; who: string }) {
  const qc = useQueryClient();
  const c = w.copy;
  const [paragraphs, setParagraphs] = useState<string[]>(c.paragraphs);
  const [closing, setClosing] = useState(c.closing);
  const [signerName, setSignerName] = useState(c.signerName);
  const [signerTitle, setSignerTitle] = useState(c.signerTitle);
  const [greeting, setGreeting] = useState(c.greeting);
  const [asks, setAsks] = useState(c.asks.regular.join(', '));
  const [asksMajor, setAsksMajor] = useState(c.asks.major.join(', '));
  const collect = (): Copy => ({ paragraphs, closing, signerName, signerTitle, greeting, asks: { regular: asList(asks), major: asList(asksMajor) } });
  const call = <T,>(path: string, body: unknown) => rcpApi<T>(path, { body, who });
  const save = async () => {
    if (needWho()) return;
    try {
      await call('/api/receipts/wording', { copy: collect() });
      toast('Saved. The next print file uses it.');
      await qc.invalidateQueries({ queryKey: rcpKeys.wording });
    } catch (err) {
      toast((err as Error).message);
    }
  };
  const reset = async () => {
    if (needWho()) return;
    if (!confirm('Put back the standard receipt? The current wording is kept in the log.')) return;
    try {
      await call('/api/receipts/wording', { reset: true });
      toast('The standard receipt is back.');
      await qc.invalidateQueries({ queryKey: rcpKeys.wording });
    } catch (err) {
      toast((err as Error).message);
    }
  };
  const sample = async () => {
    const tab = window.open('', '_blank');
    try {
      const res = await fetch('/api/receipts/sample', { method: 'POST', credentials: 'same-origin', headers: { 'X-Hub-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ copy: collect() }) });
      if (!res.ok) throw new Error('The sample did not build. Try again.');
      const url = URL.createObjectURL(await res.blob());
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (err) {
      if (tab) tab.close();
      toast((err as Error).message);
    }
  };
  return (
    <>
      <p className="fnd-note">Every receipt prints these words. Put **two stars** around words to print them in bold, and {'{amount}'} where the gift amount goes. The page says when the receipt is too long for the paper.</p>
      <div className="rcp-word">
        {paragraphs.map((p, i) => (
          <label className="req-field" key={i}>
            <span>Paragraph {i + 1}</span>
            <textarea data-p={i} rows={4} value={p} onChange={(e) => setParagraphs(paragraphs.map((x, j) => (j === i ? e.target.value : x)))} />
          </label>
        ))}
        <div className="exp-grid2 rcp-word__sign">
          <label className="req-field">
            <span>Closing</span>
            <input id="rcp-w-closing" value={closing} onChange={(e) => setClosing(e.target.value)} />
          </label>
          <label className="req-field">
            <span>Signed</span>
            <input id="rcp-w-name" value={signerName} onChange={(e) => setSignerName(e.target.value)} />
          </label>
          <label className="req-field">
            <span>Title</span>
            <input id="rcp-w-title" value={signerTitle} onChange={(e) => setSignerTitle(e.target.value)} />
          </label>
          <label className="req-field">
            <span>Greeting</span>
            <select id="rcp-w-greet" value={greeting} onChange={(e) => setGreeting(e.target.value as 'full' | 'first')}>
              <option value="full">Dear Sam and Pat Sample,</option>
              <option value="first">Dear Sam and Pat,</option>
            </select>
          </label>
          <label className="req-field">
            <span>Amounts on the reply slip</span>
            <input id="rcp-w-asks" value={asks} onChange={(e) => setAsks(e.target.value)} />
          </label>
          <label className="req-field">
            <span>Amounts for gifts of $200 and up</span>
            <input id="rcp-w-asks-major" value={asksMajor} onChange={(e) => setAsksMajor(e.target.value)} />
          </label>
        </div>
        <p className="rcp-fine" id="rcp-w-fit">
          {w.fit.fits ? 'Fits on the page.' : 'Too long for the page.'}
          {w.saved ? ` Last changed by ${w.saved.updated_by || 'someone'} on ${stamp(w.saved.updated_at)}.` : ' This is the standard receipt.'}
        </p>
        <div className="fnd-form__foot">
          <button type="button" className="req-submit" id="rcp-w-save" onClick={save}>
            Save the wording
          </button>
          <button type="button" className="req-ghost" id="rcp-w-sample" onClick={sample}>
            See a sample receipt
          </button>
          <button type="button" className="fnd-textbtn is-quiet" id="rcp-w-reset" onClick={reset}>
            Put back the standard receipt
          </button>
        </div>
      </div>
    </>
  );
}
