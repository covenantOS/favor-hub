// Add a partner from Entry. Support opens it from a row that matched no record. The form fills from the row; the right side lists records
// already in Blackbaud as you type (FavorOS's copy at once, Blackbaud's own duplicate search a moment after you stop typing). Add stays
// locked until "None of these is the same person" is ticked, and typing in a name, phone, email or city box clears the tick.
// Port of public/js/work-addpartner.js. With standin set (?standin=1 on the page) the add goes to a route that makes nothing in Blackbaud.
import { useEffect, useRef, useState } from 'react';
import { wcApi, wcPost } from '../api';
import { reloadEntry, toast } from '../engine';
import { closeDialog } from '../store';
import { Dialog, Ic } from '../ui';
import type { EntryOwner, EntryRow } from './types';

const KINDS: [string, string][] = [
  ['individual', 'Individual'],
  ['household', 'Household'],
  ['organization', 'Organization'],
];
const CODES = ['Prospect', 'Partner', 'Church'];
const MAX_LIVE = 8;

interface Form {
  kind: string;
  first: string;
  last: string;
  sfirst: string;
  slast: string;
  org: string;
  phone: string;
  email: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

/** Fill the form from the row's name, organization, phone, email and address. */
function parseRow(r: EntryRow): Form {
  const base = String(r.name || '').split(' - ')[0].trim();
  const org = r.org || '';
  let first = '';
  let last = '';
  let sfirst = '';
  let kind = 'individual';
  const n = base.includes(',') ? base.replace(/^(.+?),\s*(.+)$/, '$2 $1') : base;
  const pair = n.match(/^(\S+)\s+(?:and|&)\s+(\S+)\s+(.+)$/i);
  if (pair) {
    kind = 'household';
    first = pair[1];
    sfirst = pair[2];
    last = pair[3];
  } else {
    const parts = n.split(/\s+/);
    first = parts.shift() || '';
    last = parts.join(' ');
  }
  if (org && !last) kind = 'organization';
  let street = '';
  let city = '';
  let state = '';
  let zip = '';
  const a = String(r.addr || '').trim();
  const m = a.match(/^(.*?),\s*([^,]+),\s*([A-Za-z]{2})\.?\s*(\d{5}(?:-\d{4})?)?\s*$/);
  if (m) {
    street = m[1];
    city = m[2];
    state = m[3].toUpperCase();
    zip = m[4] || '';
  } else if (a) street = a;
  return { kind, first, last, sfirst, slast: last, org: kind === 'organization' ? org || base : '', phone: r.phoneV || '', email: r.emailV || '', street, city, state, zip };
}

interface Match {
  cid: string;
  name: string;
  place: string;
  lookup: string;
  phone: string;
  email: string;
  since: string;
  gifts: number;
  lastAmount: number;
  lastGift: string;
  holders: string[];
  reasons: string[];
  deceased?: boolean;
  fromCopy?: boolean;
}

const STRONG = /phone|email|and city|domain/i;
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

export function AddPartnerDialog({ row, owners, fd, ownerName, standin }: { row: EntryRow; owners: EntryOwner[]; fd: (iso: string, yr?: boolean) => string; ownerName: string; standin: boolean }) {
  const [f, setF] = useState<Form>(() => parseRow(row));
  const [code, setCode] = useState('Prospect');
  const [holder, setHolder] = useState(() => (owners.some((o) => o.fid === row.owner) ? row.owner : ''));
  const [notSame, setNotSame] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [status, setStatus] = useState('');
  const [warn, setWarn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ name: string; calls: { method: string; path: string }[] } | null>(null);
  const live = useRef({ sig: '', count: 0 });
  const seq = useRef(0);
  const tickSig = useRef('');
  const t1 = useRef<ReturnType<typeof setTimeout>>(undefined);
  const t2 = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(f);
  latest.current = f;
  const statusRef = useRef(status);
  statusRef.current = status;

  const probe = (x: Form) => ({ kind: x.kind, first: x.first, last: x.last, spouse_first: x.sfirst, spouse_last: x.slast || x.last, org: x.org, phone: x.phone, email: x.email, city: x.city, state: x.state, zip: x.zip });
  const sigOf = (x: Form) => JSON.stringify([x.kind, x.first, x.last, x.sfirst, x.slast, x.org, x.phone.replace(/\D/g, ''), x.email, x.city, x.state, x.zip].map((v) => String(v).trim().toLowerCase()));
  const formValid = (x: Form) =>
    (x.kind === 'organization' ? x.org.trim().length >= 3 : !!(x.first.trim() && x.last.trim() && (x.kind !== 'household' || x.sfirst.trim()))) &&
    (!x.phone || x.phone.replace(/\D/g, '').length === 10) &&
    (!x.email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x.email));

  async function check(isLive: boolean) {
    const my = ++seq.current;
    const s = sigOf(latest.current);
    try {
      const out = await wcPost<{ matches: Match[]; ready: boolean; live?: string }>('/api/work/partner-add/matches', { ...probe(latest.current), live: isLive });
      if (my !== seq.current && !isLive) return;
      if (s !== sigOf(latest.current)) {
        if (isLive && /^Checking/.test(statusRef.current)) setStatus('');
        return;
      }
      setMatches(out.matches);
      if (isLive) {
        live.current.sig = s;
        live.current.count++;
      }
      setStatus(
        !out.ready
          ? ''
          : out.live === 'ran'
            ? 'Checked in Blackbaud at ' + new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET'
            : out.live === 'failed'
              ? "Blackbaud did not answer. These come from FavorOS's copy, which can be 12 hours old."
              : isLive
                ? ''
                : /^Checking/.test(statusRef.current)
                  ? statusRef.current
                  : ''
      );
      setWarn(out.live === 'failed');
    } catch (e) {
      setStatus((e as Error).message);
      setWarn(true);
    }
  }

  // The first check runs at once, and a live check a moment later when the form already has a name.
  useEffect(() => {
    void check(false);
    const x = latest.current;
    if (formValid(x) || x.last || x.org)
      t2.current = setTimeout(() => {
        setStatus('Checking Blackbaud…');
        void check(true);
      }, 400);
    return () => {
      clearTimeout(t1.current);
      clearTimeout(t2.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A change to a name, phone, email or city box: clears the tick and schedules both checks. */
  const changed = (next: Form, resetTick: boolean) => {
    latest.current = next;
    if (resetTick && notSame && sigOf(next) !== tickSig.current) setNotSame(false);
    clearTimeout(t1.current);
    clearTimeout(t2.current);
    t1.current = setTimeout(() => void check(false), 250);
    t2.current = setTimeout(() => {
      if (live.current.count < MAX_LIVE && sigOf(latest.current) !== live.current.sig) {
        setStatus('Checking Blackbaud…');
        setWarn(false);
        void check(true);
      }
    }, 1300);
  };
  const set = (k: keyof Form, v: string) => {
    const next = { ...f, [k]: v };
    setF(next);
    if (k === 'street') latest.current = next;
    else changed(next, true);
  };

  const valid = formValid(f);
  const ok = !busy && notSame && valid;
  const ready = (f.kind === 'organization' ? f.org.trim().length >= 3 : f.last.trim().length >= 2) || f.phone.replace(/\D/g, '').length >= 10 || /@/.test(f.email);

  const use = async (m: Match, btn: HTMLButtonElement) => {
    if (!m.fromCopy) {
      toast("That record is new in Blackbaud and FavorOS's copy has not read it yet. Try again after the next refresh.");
      return;
    }
    btn.disabled = true;
    try {
      await wcApi('/api/work/entry/' + row.id, { method: 'PATCH', body: JSON.stringify({ constituent_id: m.cid }) });
      closeDialog();
      await reloadEntry();
      toast('Matched the row to the existing record. Nothing was added to Blackbaud.');
    } catch (err) {
      btn.disabled = false;
      toast((err as Error).message);
    }
  };

  const add = async () => {
    setBusy(true);
    const body = { ...probe(f), street: f.street, code, holder, none_same: true, row: row.id };
    try {
      const out = await wcPost<{ name: string; lookup?: string; warnings?: string[]; calls: { method: string; path: string }[] }>(standin ? '/api/work/partner-add/standin' : '/api/work/partner-add', body);
      setBusy(false);
      if (standin) {
        setDone({ name: out.name, calls: out.calls });
        return;
      }
      closeDialog();
      await reloadEntry();
      toast(`Added ${out.name}${out.lookup ? ' (record ' + out.lookup + ')' : ''}. The row is ready to enter.${out.warnings && out.warnings.length ? ' ' + out.warnings.join(' ') : ''}`);
    } catch (err) {
      setBusy(false);
      toast((err as Error).message);
    }
  };

  const text = (name: keyof Form, ph: string, type = 'text') => <input type={type} name={name} value={f[name]} placeholder={ph} autoComplete="off" aria-label={ph} onChange={(e) => set(name, e.target.value)} />;
  const reach = (m: Match) => [m.phone ? m.phone.replace(/^(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3') : '', m.email].filter(Boolean).join(' · ');
  const meta = (m: Match) => [m.since ? (m.gifts ? 'Partner since ' + m.since.slice(0, 4) : 'Added ' + m.since.slice(0, 4)) : '', m.gifts ? `last gift ${money(m.lastAmount)}, ${m.lastGift ? fd(m.lastGift, true) : ''}` : m.fromCopy ? 'no gifts' : '', m.holders.length ? 'held by ' + m.holders.join(', ') : m.fromCopy ? 'held by no one' : ''].filter(Boolean).join(' · ');

  return (
    <Dialog label="Add a partner" cls="ap-dlg">
      <div className="wc-dlg__head">
        <div>
          <h2>Add a partner</h2>
          <p>
            From {ownerName}'s contact on {fd(row.date, true)}
            {standin ? ' · stand-in: nothing is made in Blackbaud' : ''}
          </p>
        </div>
        <button type="button" className="wc-dlg__x" aria-label="Close" onClick={closeDialog}>
          <Ic n="x" />
        </button>
      </div>
      <div className="wc-dlg__body" id="ap-body">
        {done ? (
          <div className="ap-done">
            <b>Stand-in answered. Nothing was made in Blackbaud.</b>
            <span>
              {done.calls.length} calls built for {done.name}:
            </span>
            <code>{done.calls.map((c) => c.method + ' ' + c.path).join('\n')}</code>
          </div>
        ) : (
          <div className="ap">
            <form className="ap-form" id="ap-form" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
              <div className="ap-src">
                <b>{row.name || 'This row'}</b>
                {row.notes ? (
                  <>
                    <br />
                    {row.notes.slice(0, 220)}
                  </>
                ) : null}
              </div>
              <div className="ap-seg" role="group" aria-label="What kind of record">
                {KINDS.map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    className={f.kind === k ? 'is-on' : ''}
                    onClick={() => {
                      const next = { ...f, kind: k };
                      setF(next);
                      setNotSame(false);
                      changed(next, false);
                    }}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {f.kind === 'organization' ? (
                text('org', 'Organization name')
              ) : (
                <div className="ap-two">
                  {text('first', 'First name')}
                  {text('last', 'Last name')}
                </div>
              )}
              {f.kind === 'household' ? (
                <div className="ap-two">
                  {text('sfirst', 'Spouse first name')}
                  <input type="text" name="slast" value={f.slast || f.last} placeholder="Spouse last name" autoComplete="off" aria-label="Spouse last name" onChange={(e) => set('slast', e.target.value)} />
                </div>
              ) : null}
              <div className="ap-two">
                {text('phone', 'Phone', 'tel')}
                {text('email', 'Email', 'email')}
              </div>
              {text('street', 'Street')}
              <div className="ap-three">
                {text('city', 'City')}
                {text('state', 'State')}
                {text('zip', 'ZIP')}
              </div>
              <div className="ap-two">
                <label className="ap-lab">
                  Code
                  <select name="code" value={code} onChange={(e) => setCode(e.target.value)}>
                    {CODES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label className="ap-lab">
                  Held by
                  <select name="holder" value={holder} onChange={(e) => setHolder(e.target.value)}>
                    <option value="">No one yet</option>
                    {owners.map((o) => (
                      <option key={o.fid} value={o.fid}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </form>
            <div className="ap-matches" id="ap-matches">
              {!ready ? (
                <>
                  <h3>
                    <span>Already in Blackbaud?</span>
                    <span />
                  </h3>
                  <div className="ap-idle">Type a name, phone or email. Records already in Blackbaud show here.</div>
                </>
              ) : (
                <>
                  <h3>
                    <span>Already in Blackbaud?</span>
                    <span>{matches.length ? matches.length + ' found' : ''}</span>
                  </h3>
                  <div className={'ap-status' + (warn ? ' is-warn' : '')} aria-live="polite">
                    {status}
                  </div>
                  {matches.length ? (
                    matches.map((m) => (
                      <div key={m.cid} className={'ap-match' + (m.reasons.some((x) => STRONG.test(x)) ? ' is-strong' : '')}>
                        <b>
                          {m.name}
                          {m.deceased ? ' (deceased)' : ''}
                        </b>
                        <p>
                          {m.place || 'No address'}
                          {m.lookup ? ' · ' + m.lookup : ''}
                          {reach(m) ? ' · ' + reach(m) : ''}
                          {meta(m) ? (
                            <>
                              <br />
                              {meta(m)}
                            </>
                          ) : null}
                        </p>
                        <div className="ap-why">
                          {m.reasons.map((w) => (
                            <span key={w} className={'wc-tag ' + (STRONG.test(w) ? 'wc-tag--gift' : '')}>
                              {w}
                            </span>
                          ))}
                        </div>
                        <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={(e) => void use(m, e.currentTarget)}>
                          Use this record
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="ap-clear">No match on name, phone, email or city</div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="wc-dlg__foot" id="ap-foot">
        {done ? (
          <button type="button" className="h-btn h-btn--primary" onClick={closeDialog}>
            Close
          </button>
        ) : (
          <>
            <label className="ap-check">
              <input
                type="checkbox"
                checked={notSame}
                onChange={(e) => {
                  setNotSame(e.target.checked);
                  tickSig.current = sigOf(f);
                }}
              />{' '}
              None of these is the same person
            </label>
            <button type="button" className="h-btn h-btn--ghost" onClick={closeDialog}>
              Cancel
            </button>
            <button type="button" className="h-btn h-btn--primary" disabled={!ok} onClick={() => void add()}>
              {busy ? 'Adding…' : standin ? 'Try the stand-in' : 'Add as new partner'}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
