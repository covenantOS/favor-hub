// Online gifts: each online gift with the partner's comment and the designation read from it, Approve per gift or all at once, the Blackbaud
// batches that still need Approve in Blackbaud, and where the write switch stands. Same markup and classes as public/js/online-gifts.js.
// The rules and every decision are on the server (functions/_lib/online-gifts). This page shows what it returns and posts choices.
import { Suspense, startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { DAYS, ogSearch, onlineQuery, type OgBatch, type OgHealth, type OgOverview, type OgRow } from './online';
import { dayLabel, dollars, timeOf, todayEt } from './fmt';
import '@hub/styles/reports.css';
import '@hub/styles/lists.css';
import '@hub/styles/gifts-pages.css';

const API = '/api/online-gifts';
const SRC: Record<string, string> = { website: 'Website', form: 'Blackbaud form', 'fundraise up': 'International' };
const STATE: Record<string, string> = { approved: 'No change', queued: 'Queued', applied: 'Saved', failed: 'Failed', held: 'Held', noted: 'Noted' };
const PILL: Record<string, string> = { approved: 'applied', queued: 'queued', applied: 'applied', failed: 'failed', held: 'approved', noted: 'approved' };

interface Result { key?: string; state: string; result?: string }
interface Reply { ok?: boolean; message?: string; results?: Result[] }

/** A call to the page's own API. A failure of any kind comes back as { ok: false, message }, never as a throw. */
async function call(path: string, body?: unknown): Promise<Reply> {
  const init: RequestInit = { credentials: 'same-origin' };
  if (body !== undefined) {
    init.method = 'POST';
    init.headers = { 'Content-Type': 'application/json', 'X-Hub-Request': '1' };
    init.body = JSON.stringify(body);
  }
  try {
    const res = await fetch(API + path, init);
    const data = (await res.json().catch(() => ({}))) as Reply;
    if (!res.ok && data.ok !== false) return { ok: false, message: data.message || 'Not saved. Try again.' };
    return data;
  } catch {
    return { ok: false, message: 'FavorOS could not be reached. Check the connection and try again.' };
  }
}

const fundName = (o: OgOverview, id: string) => (o.funds || []).find((f) => f.id === id)?.name || 'No fund';

function Partner({ r }: { r: OgRow }) {
  const nm = r.name || 'Partner';
  return r.recordId ? (
    <a className="og-n" href={'/work/partner/' + r.recordId} data-partner-id={r.recordId}>
      {nm}
    </a>
  ) : (
    <span className="og-n">{nm}</span>
  );
}

function facts(r: OgRow): string {
  const b = [dollars(r.amount)];
  if (r.original) b.push(r.original);
  b.push(SRC[r.source] || r.source);
  b.push(dayLabel(r.date));
  if (r.flag && r.flag.kind === 'fru-missing') b.push(r.flag.days + 'd');
  if (r.monthly) b.push('Monthly');
  if (r.tribute) b.push('Tribute');
  if (r.test) b.push('Test record');
  return b.join(' · ');
}

interface Ctx {
  o: OgOverview;
  pick: Record<string, string>;
  chosen: (r: OgRow) => string;
}

function Row({ r, c, onPick, onApprove, onKeep }: { r: OgRow; c: Ctx; onPick: (key: string, fund: string) => void; onApprove: (r: OgRow) => void; onKeep: (r: OgRow) => void }) {
  const cur = c.chosen(r);
  const changes = !!(r.inBlackbaud && r.currentFund && cur !== r.currentFund);
  const k = r.flag && r.flag.kind;
  const fl = r.flag;
  const keep = !!(fl && (fl.kind === 'note' || fl.kind === 'fru-fund') && !r.review);
  const bits: string[] = [];
  if (fl && fl.kind === 'fru-fund') bits.push('Fundraise Up: ' + (fl.words || fundName(c.o, fl.wantedFund || '')));
  else if (fl && fl.kind === 'note') {
    // the pill already says the note names another fund
  } else if (r.read.by === 'comment' || r.read.by === 'model') bits.push('From the comment');
  else if (r.read.by === 'form' && r.source !== 'form') bits.push('From the form');
  if (r.inBlackbaud && r.currentFund && cur && cur !== r.currentFund) bits.push('In Blackbaud: ' + fundName(c.o, r.currentFund));
  else if (keep) bits.push('In Blackbaud: ' + fundName(c.o, r.currentFund));
  const pill =
    k === 'fru-fund' ? (
      <span className="ls-st ls-st--queued og-pill">Fund differs</span>
    ) : k === 'note' || changes ? (
      <span className="ls-st ls-st--queued og-pill">Changes fund</span>
    ) : k === 'fru-missing' ? (
      <span className="ls-st ls-st--queued og-pill">Not in Blackbaud</span>
    ) : !r.inBlackbaud ? (
      <span className="ls-st og-pill">Not in Blackbaud yet</span>
    ) : null;
  return (
    <div className="og-row" data-key={r.key}>
      <div className="og-main">
        <b>
          <Partner r={r} />
          {pill}
        </b>
        <span className="og-f">{facts(r)}</span>
        {r.comment ? <q className="og-c">{r.comment}</q> : null}
        {bits.length ? (
          <span className={'og-why' + (keep ? ' og-why--keep' : '')}>
            <span>{bits.join(' · ')}</span>
            {keep ? (
              <button type="button" className="ls-link" data-act="keep" onClick={() => onKeep(r)}>
                Keep fund
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      <div className="og-acts">
        <label className="og-des">
          <select className="og-sel" data-key={r.key} aria-label={'Designation for ' + (r.name || 'Partner')} value={cur || ''} onChange={(e) => onPick(r.key, e.target.value)}>
            {!cur ? <option value="">Pick a designation</option> : null}
            {(c.o.funds || []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="ls-link" data-act="approve" onClick={() => onApprove(r)}>
          Approve
        </button>
      </div>
    </div>
  );
}

function DoneRow({ r, o, onReopen }: { r: OgRow; o: OgOverview; onReopen: (key: string) => void }) {
  const v = r.review!;
  const t = timeOf(v.approved_at);
  const who = (v.approved_name || v.approved_by || '') + ', ' + dayLabel(v.approved_at) + (t ? ' ' + t : '');
  return (
    <div className="og-row og-row--done" data-key={r.key}>
      <div className="og-main">
        <b>
          <Partner r={r} />
        </b>
        <span className="og-f">{facts(r)}</span>
        {r.comment ? <q className="og-c">{r.comment}</q> : null}
        <span className="og-f">{fundName(o, v.chosen_fund) + ' · ' + who}</span>
        {v.result && v.state !== 'approved' && v.state !== 'applied' ? <span className="og-why">{v.result}</span> : null}
      </div>
      <div className="og-acts og-acts--done">
        <span className={'ls-st ls-st--' + (PILL[v.state] || 'approved')}>{STATE[v.state] || v.state}</span>
        <button type="button" className="ls-link og-again" data-act="reopen" onClick={() => onReopen(r.key)}>
          Change
        </button>
      </div>
    </div>
  );
}

function Health({ list }: { list: OgHealth[] }) {
  if (!list.length) return null;
  const today = todayEt();
  const at = (iso?: string) => (iso ? (String(iso).slice(0, 10) === today ? '' : dayLabel(iso) + ', ') + timeOf(iso) : '');
  return (
    <p className="og-health" aria-label="Checks">
      {list.map((c, i) => {
        const bad = c.state === 'stale' || c.state === 'failing';
        let tail = c.state === 'none' ? 'not run yet' : at(c.lastOk) || 'no good run';
        if (c.state === 'failing') tail += ' · failed ' + at(c.lastError);
        else if (c.state === 'stale') tail += ' · behind';
        return (
          <span className={bad ? 'is-warn' : ''} key={c.name || i}>
            {c.label} {tail}
          </span>
        );
      })}
    </p>
  );
}

function BlackbaudStrip({ o }: { o: OgOverview }) {
  const bf: OgBatch[] = o.batchFlags || [];
  const w = (o.batches && o.batches.waiting) || [];
  if (!w.length && !bf.length) return null;
  const g = w.reduce((s, b) => s + b.gifts, 0);
  const amt = w.reduce((s, b) => s + b.amount, 0);
  return (
    <>
      <div className="og-bb">
        <span>
          <b>Approve in Blackbaud</b> · {w.length}
          {w.length === 1 ? ' batch' : ' batches'} · {g}
          {g === 1 ? ' gift' : ' gifts'} · {dollars(amt)}
        </span>
        <a className="ls-link" href={o.blackbaud} target="_blank" rel="noopener">
          Open Blackbaud
        </a>
      </div>
      {bf.map((b, i) => (
        <div className="og-bb og-bb--row" key={(b.number || 'b') + i}>
          <span>
            <b>{b.number || 'Batch'}</b> · {b.gifts}
            {b.gifts === 1 ? ' gift' : ' gifts'} · {dollars(b.amount)} · {b.days}d{b.by ? ' · ' + b.by : ''}
          </span>
          <a className="ls-link" href={b.link} target="_blank" rel="noopener">
            Open
          </a>
        </div>
      ))}
    </>
  );
}

function Toast({ msg }: { msg: { t: string; n: number } }) {
  const [on, setOn] = useState(false);
  const [shown, setShown] = useState('');
  useEffect(() => {
    if (!msg.t) return;
    setShown(msg.t);
    setOn(true);
    const t = setTimeout(() => setOn(false), 4200);
    return () => clearTimeout(t);
  }, [msg]);
  return (
    <div className={'rp-toast' + (on ? ' is-on' : '')} id="og-toast" role="status">
      {shown}
    </div>
  );
}

function Page() {
  const search = ogSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const got = useSuspenseQuery(onlineQuery(search)).data;
  if ('failed' in got) return <OnlineGiftsError message={got.message} />;
  return <Loaded search={search} o={got} />;
}

function Loaded({ search, o }: { search: ReturnType<typeof ogSearch>; o: OgOverview }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [pick, setPick] = useState<Record<string, string>>({});
  const [reopened, setReopened] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [toastMsg, setToastMsg] = useState({ t: '', n: 0 });
  // A repeated message shows again: each call is a new object.
  const toast = useCallback((t: string) => setToastMsg((p) => ({ t, n: p.n + 1 })), []);

  const chosen = (r: OgRow): string => pick[r.key] || (r.review && r.review.state !== 'failed' ? r.review.chosen_fund : r.read.fundId) || r.currentFund;
  const ctx: Ctx = { o, pick, chosen };

  const reload = useCallback(async () => {
    setReopened({});
    await qc.invalidateQueries({ queryKey: ['online-gifts'] });
  }, [qc]);

  const approve = async (items: { key: string; fundId: string }[]) => {
    if (busyRef.current || !items.length) return;
    busyRef.current = true;
    setBusy(true);
    const r = await call('/approve', { from: o.from, items, gift: search.gift });
    busyRef.current = false;
    setBusy(false);
    if (r.ok === false) {
      toast(r.message || 'Not saved.');
      return;
    }
    const res = r.results || [];
    const q = res.filter((x) => x.state === 'queued').length;
    const held = res.filter((x) => x.state === 'held');
    const miss = res.filter((x) => x.state === 'missing');
    let msg = res.length === 1 ? 'Approved' : 'Approved ' + (res.length - miss.length);
    if (q) msg += ' · ' + q + ' queued for Blackbaud';
    if (held.length) msg += ' · ' + held[0].result;
    if (miss.length) msg += ' · ' + miss[0].result;
    toast(msg);
    setPick({});
    await reload();
  };

  const keep = async (r: OgRow) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const res = await call('/keep', { key: r.flag && r.flag.key });
    busyRef.current = false;
    setBusy(false);
    if (res.ok === false) {
      toast(res.message || 'Not saved.');
      return;
    }
    toast('Fund kept');
    await reload();
  };

  const rank = (r: OgRow) => (r.flag ? 0 : r.inBlackbaud && r.currentFund && chosen(r) !== r.currentFund ? 1 : r.comment ? 2 : 3);
  const todo = o.rows
    .filter((r) => !r.review || reopened[r.key])
    .map((r, i) => [r, i] as const)
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
    .map((x) => x[0]);
  const done = o.rows.filter((r) => r.review && !reopened[r.key]);
  const total = o.rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const withC = o.rows.filter((r) => r.comment).length;

  const setDays = (days: string) => {
    startTransition(() => {
      void navigate({ to: '/online-gifts/', search: ((prev: Record<string, unknown>) => ({ ...prev, days: Number(days) })) as never, replace: true });
    });
  };

  return (
    <div id="og-app" data-api={API} aria-busy={busy ? true : undefined}>
      <div className="og-wrap">
        <div className="h-card cr-card og-card">
          <div className="cr-h">
            <b>
              Online gifts <small>{o.rows.length}</small>
            </b>
            <label className="og-period">
              <span className="sr-only">Period</span>
              <select id="og-days" aria-label="Period" value={search.days} onChange={(e) => setDays(e.target.value)}>
                {Object.keys(DAYS).map((k) => (
                  <option key={k} value={k}>
                    {DAYS[k]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="og-sum">
            <span>
              {dollars(total)}
              <i className="og-wide">
                {' '}
                · {withC} {withC === 1 ? 'comment' : 'comments'}
              </i>
              <i className="og-wide"> · {todo.length} to approve</i>
              {o.flags && o.flags.count ? ' · ' + o.flags.count + ' flagged' : ''}
            </span>
            {todo.length ? (
              <button
                type="button"
                className="h-btn h-btn--primary h-btn--sm"
                id="og-all"
                onClick={() => void approve(todo.map((r) => ({ key: r.key, fundId: chosen(r) })).filter((x) => x.fundId))}
              >
                Approve all {todo.length}
              </button>
            ) : null}
          </div>
          <BlackbaudStrip o={o} />
          {todo.length ? (
            todo.map((r) => (
              <Row
                key={r.key}
                r={r}
                c={ctx}
                onPick={(key, fund) => setPick((p) => ({ ...p, [key]: fund }))}
                onApprove={(row) => {
                  const f = chosen(row);
                  if (!f) {
                    toast('Pick a designation first');
                    return;
                  }
                  void approve([{ key: row.key, fundId: f }]);
                }}
                onKeep={(row) => void keep(row)}
              />
            ))
          ) : (
            <p className="cr-none">Every gift here is approved</p>
          )}
        </div>
        {done.length ? (
          <div className="h-card cr-card og-card">
            <div className="cr-h">
              <b>
                Approved <small>{done.length}</small>
              </b>
            </div>
            {done.map((r) => (
              <DoneRow key={r.key} r={r} o={o} onReopen={(key) => setReopened((s) => ({ ...s, [key]: true }))} />
            ))}
          </div>
        ) : null}
        <Health list={o.health || []} />
        {o.admin ? (
          <p className="og-adminline">
            Writes to Blackbaud are {o.apply ? 'on' : 'off'}
            {o.testLimit ? ' (record ' + o.testLimit + ' only)' : ''}.{' '}
            <a className="ls-link" href="/admin/gifts/">
              Change in Admin settings
            </a>
          </p>
        ) : null}
      </div>
      <Toast msg={toastMsg} />
    </div>
  );
}

/** Rows are drawn at about their final height while the read is out, so the page below does not move. */
function Waiting() {
  return (
    <div id="og-app" data-api={API} aria-busy="true">
      <div className="og-wrap">
        <div className="h-card cr-card og-card">
          <div className="cr-h">
            <b>Online gifts</b>
          </div>
          <div className="og-sum">
            <span>&nbsp;</span>
          </div>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div className="og-row" key={i}>
              <div className="og-main">
                <b>&nbsp;</b>
                <span className="og-f">&nbsp;</span>
                <span className="og-f">&nbsp;</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function OnlineGiftsPage() {
  return (
    <Suspense fallback={<Waiting />}>
      <Page />
    </Suspense>
  );
}

export function OnlineGiftsError({ message }: { message: string }) {
  return (
    <div id="og-app" data-api={API}>
      <p className="rp-note">{message}</p>
    </div>
  );
}
