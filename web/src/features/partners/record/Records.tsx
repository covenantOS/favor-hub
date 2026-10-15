// Record maintenance inside the partner view: the Contact, Codes and Record tabs (port of public/js/records.js). Everything shown is read
// live from Blackbaud (GET /api/work/partners/:id/contact, /codes, /record). Every change goes through /api/work/batches like the Work
// Center's edits: saved, sent through the upkeep route's write guard, read back, and undone from the toast for 24 hours. After a save the
// tab reads the record again and shows what Blackbaud kept.
import { Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { queryOptions, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Boundary } from './Boundary';
import { fdY, MONTHS, rApi, todayEt, type Partner } from './lib';
import { runBatch } from './writes';
import { toast } from './toast';

const MON3 = MONTHS.map((m) => m.slice(0, 3));
const STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'PR', 'GU', 'VI'];
const md = (v: { m: number; d: number } | null | undefined) => (v ? MON3[v.m - 1] + ' ' + v.d : '');
const mdLong = (v: { m: number; d: number } | null | undefined) => (v ? MONTHS[v.m - 1] + ' ' + v.d : '');
const words = (a: { m: number; d: number }, b: { m: number; d: number }) => `Every year ${mdLong(a)} to ${mdLong(b)}`;

const Chip = ({ t, cls }: { t: string; cls?: string }) => <span className={'rc-chip' + (cls ? ' ' + cls : '')}>{t}</span>;
function Toggle({ name, label, on, off, onChange }: { name: string; label: string; on?: boolean; off?: boolean; onChange?: (v: boolean) => void }) {
  return (
    <label className="rc-tog">
      <input type="checkbox" name={name} defaultChecked={on} disabled={off} onChange={onChange ? (e) => onChange(e.target.checked) : undefined} />
      <i />
      <span>{label}</span>
    </label>
  );
}
const Opts = ({ list, cur, blank }: { list: string[]; cur?: string; blank?: string }) => (
  <>
    {blank != null ? <option value="">{blank}</option> : null}
    {list.map((x) => (
      <option key={x} value={x}>
        {x}
      </option>
    ))}
    {cur && !list.includes(cur) && blank == null ? <option value={cur}>{cur}</option> : null}
  </>
);

/* ------------------------------------------------------------------ reads */
const recQuery = (id: string, kind: 'contact' | 'codes' | 'record') =>
  queryOptions({
    queryKey: ['pr', 'rec', id, kind],
    queryFn: async () => {
      if (kind === 'contact') {
        const [a, r] = await Promise.all([rApi(`/api/work/partners/${id}/contact`), rApi(`/api/work/partners/${id}/record`)]);
        return { ...a, flags: r.flags, record: r };
      }
      return await rApi(`/api/work/partners/${id}/${kind}`);
    },
    staleTime: 0,
    gcTime: 60_000,
  });

export interface RecordsProps {
  id: string;
  tab: 'contact' | 'codes' | 'record';
  /** The partner as the page has it (name and household for the Record tab). */
  partner: Partner;
  /** What a tab read live from Blackbaud goes into the partner shown, so the header links and the Overview show it before the next refresh. */
  merge: (part: Record<string, any>) => void;
}

const Skel = () => (
  <div className="rc-skel">
    <i style={{ height: 14, width: '30%' }} />
    <i style={{ height: 96 }} />
    <i style={{ height: 96 }} />
    <i style={{ height: 14, width: '24%' }} />
    <i style={{ height: 72 }} />
  </div>
);

export function RecordsTab(p: RecordsProps) {
  const qc = useQueryClient();
  return (
    <Boundary
      fallback={(e, retry) => (
        <div className="rc-err">
          <p>{e.message || 'Blackbaud did not answer.'}</p>
          <button
            type="button"
            className="h-btn h-btn--ghost h-btn--sm"
            onClick={() => {
              qc.resetQueries({ predicate: (q) => q.state.status === 'error' });
              retry();
            }}
          >
            Try again
          </button>
        </div>
      )}
    >
      <Suspense fallback={<Skel />}>
        <Inner {...p} />
      </Suspense>
    </Boundary>
  );
}

function Inner({ id, tab, partner, merge }: RecordsProps) {
  const qc = useQueryClient();
  const { data, refetch, isFetching } = useSuspenseQuery(recQuery(id, tab));
  // The page's copy of the partner follows what Blackbaud answered.
  useEffect(() => {
    if (!data) return;
    if (tab === 'contact') merge({ phones: data.phones, emails: data.emails, addresses: data.addresses });
    else if (tab === 'codes') merge({ codes: data.codes });
    else merge({ flags: data.flags });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [ask, setAsk] = useState<string | null>(null);
  const [conflict, setConflict] = useState<any[] | null>(null);
  const [retry, setRetry] = useState<Record<string, unknown> | null>(null);
  const reread = async () => {
    await refetch();
    void qc.invalidateQueries({ queryKey: ['pr', 'rec', id] });
  };
  const save = async (params: Record<string, unknown>, label: string, after?: (bid: string) => void): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    const ok = await runBatch(params, label, after, {
      onConflict: (d) => {
        setConflict(d.conflict || []);
        setRetry(params);
      },
    });
    setBusy(false);
    if (ok) {
      setEditing(null);
      setConflict(null);
      setAsk(null);
      await reread();
    }
    return !!ok;
  };
  const common = { id, d: data, busy: busy || isFetching, editing, setEditing, ask, setAsk, conflict, setConflict, save, retry, reread };
  return tab === 'contact' ? <ContactView c={common} /> : tab === 'codes' ? <CodesView c={common} /> : <StatusView c={common} partner={partner} />;
}

interface Common {
  id: string;
  d: any;
  busy: boolean;
  editing: string | null;
  setEditing: (v: string | null) => void;
  ask: string | null;
  setAsk: (v: string | null) => void;
  conflict: any[] | null;
  setConflict: (v: any[] | null) => void;
  save: (params: Record<string, unknown>, label: string, after?: (bid: string) => void) => Promise<boolean>;
  retry: Record<string, unknown> | null;
  reread: () => Promise<void>;
}

/* ------------------------------------------------------------------ Contact */
const label = (k: string) =>
  ({ address_lines: 'Street', postal_code: 'ZIP', do_not_mail: 'Do not mail', do_not_call: 'Do not call', do_not_email: 'Do not email', seasonal_start: 'Season start', seasonal_end: 'Season end', primary: 'Preferred', preferred: 'Preferred' } as Record<string, string>)[k] || k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ');
const show = (v: any) => (v == null || v === '' ? 'blank' : typeof v === 'boolean' ? (v ? 'on' : 'off') : typeof v === 'object' ? (v.m ? mdLong(v) : JSON.stringify(v)) : String(v).slice(0, 10) === String(v) || /^\d{4}-\d{2}-\d{2}T/.test(String(v)) ? fdY(v) : String(v));

function Conflict({ c }: { c: Common }) {
  if (!c.conflict) return null;
  return (
    <div className="rc-conflict" role="alert">
      <b>Changed in Blackbaud</b>
      <p>{c.conflict.map((x) => `${label(x.key)} is now ${show(x.theirs)}`).join('. ')}.</p>
      <div>
        <button
          type="button"
          className="h-btn h-btn--ghost h-btn--sm"
          onClick={async () => {
            c.setConflict(null);
            await c.reread();
          }}
        >
          Use theirs
        </button>{' '}
        <button
          type="button"
          className="h-btn h-btn--primary h-btn--sm"
          onClick={async () => {
            // Keep mine: the same change again, with what is in Blackbaud now as the starting point.
            if (!c.retry) return;
            const live: Record<string, unknown> = {};
            for (const x of c.conflict || []) live[x.key] = x.theirs;
            const next = { ...c.retry, base: { ...((c.retry.base as object) || {}), ...live } };
            c.setConflict(null);
            await c.save(next, 'Saved');
          }}
        >
          Keep mine
        </button>
      </div>
    </div>
  );
}

const vals = (f: HTMLFormElement) => {
  const g = (n: string) => f.elements.namedItem(n) as HTMLInputElement | HTMLSelectElement | null;
  return { v: (n: string) => (g(n) ? g(n)!.value : undefined), b: (n: string) => (g(n) ? (g(n) as HTMLInputElement).checked : undefined), el: g };
};
const sortRows = (list: any[], mark: string) => list.slice().sort((a, b) => (a.inactive === b.inactive ? (b[mark] ? 1 : 0) - (a[mark] ? 1 : 0) : a.inactive ? 1 : -1));
const Foot = ({ left, children }: { left?: ReactNode; children: ReactNode }) => (
  <div className="rc-foot">
    {left ?? <span />}
    <span>{children}</span>
  </div>
);

function AddrForm({ c, a }: { c: Common; a: any | null }) {
  const t = c.d.tables;
  const [type, setType] = useState<string>(a ? a.type : 'Home');
  const [ss, setSs] = useState(a?.seasonalStart || { m: 5, d: 1 });
  const [se, setSe] = useState(a?.seasonalEnd || { m: 10, d: 15 });
  const [endAsk, setEndAsk] = useState(false);
  const [endDay, setEndDay] = useState(todayEt());
  const seasonal = type === 'Seasonal';
  const locked = a && a.type === 'Seasonal';
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = e.currentTarget;
    const { v, b } = vals(f);
    const ty = locked ? a.type : v('type');
    const set: Record<string, any> = { type: ty, lines: v('lines'), city: v('city'), state: v('state'), zip: v('zip'), country: v('country'), preferred: b('preferred'), doNotMail: b('doNotMail'), start: v('start') || null, end: v('end') || null };
    if (ty === 'Seasonal') {
      set.seasonalStart = { m: Number(v('sm')), d: Number(v('sd')) };
      set.seasonalEnd = { m: Number(v('em')), d: Number(v('ed')) };
    }
    if (a && a.type === 'Seasonal') delete set.type;
    if (set.type === 'Seasonal' && !a) toast(words(set.seasonalStart, set.seasonalEnd));
    const base = a ? { type: a.type, address_lines: a.lines, city: a.city, state: a.state, postal_code: a.zip, country: a.country, preferred: a.preferred, do_not_mail: a.doNotMail, start: a.start || null, end: a.end || null, seasonal_start: a.seasonalStart, seasonal_end: a.seasonalEnd } : undefined;
    void c.save({ op: 'pcontact', cid: c.id, kind: 'address', mode: a ? 'edit' : 'add', id: a?.id || undefined, set, base }, a ? 'Address saved' : 'Address added');
  };
  const v = a || { type: 'Home', lines: '', city: '', state: '', zip: '', country: 'United States', preferred: false, doNotMail: false, start: '', end: '' };
  const monthOpts = MONTHS.map((m, i) => (
    <option key={m} value={i + 1}>
      {m.slice(0, 3)}
    </option>
  ));
  return (
    <form className="rc-form" data-rc-form="address" autoComplete="off" onSubmit={submit}>
      <div className="rc-grid">
        <label>
          Type
          <select name="type" value={type} disabled={!!locked} onChange={(e) => setType(e.target.value)}>
            <Opts list={t.addressTypes} cur={type} />
          </select>
        </label>
        <label>
          Street
          <input type="text" name="lines" defaultValue={v.lines} maxLength={150} />
        </label>
        <label>
          City
          <input type="text" name="city" defaultValue={v.city} maxLength={50} />
        </label>
        <div className="rc-two">
          <label>
            State
            <input type="text" name="state" defaultValue={v.state} list="rc-states" maxLength={30} />
          </label>
          <label>
            ZIP
            <input type="text" name="zip" defaultValue={v.zip} maxLength={12} />
          </label>
        </div>
        <label>
          Country
          <input type="text" name="country" defaultValue={v.country || 'United States'} maxLength={60} />
        </label>
        <label>
          In use from
          <input type="date" name="start" defaultValue={v.start || ''} />
        </label>
        <label>
          In use until
          <input type="date" name="end" defaultValue={v.end || ''} />
        </label>
      </div>
      <datalist id="rc-states">
        {STATES.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
      {seasonal ? (
        <fieldset className="rc-season">
          <legend>Seasonal dates, every year</legend>
          <div className="rc-grid rc-grid--4">
            <label>
              From month
              <select name="sm" value={ss.m} onChange={(e) => setSs({ ...ss, m: Number(e.target.value) })}>
                {monthOpts}
              </select>
            </label>
            <label>
              Day
              <input type="number" name="sd" min={1} max={31} value={ss.d} onChange={(e) => setSs({ ...ss, d: Number(e.target.value) })} />
            </label>
            <label>
              To month
              <select name="em" value={se.m} onChange={(e) => setSe({ ...se, m: Number(e.target.value) })}>
                {monthOpts}
              </select>
            </label>
            <label>
              Day
              <input type="number" name="ed" min={1} max={31} value={se.d} onChange={(e) => setSe({ ...se, d: Number(e.target.value) })} />
            </label>
          </div>
          <p className="rc-words">{words(ss, se)}</p>
        </fieldset>
      ) : null}
      <div className="rc-toggles">
        <Toggle name="preferred" label="Preferred address" on={v.preferred} off={!!(a && a.preferred)} />
        <Toggle name="doNotMail" label="Do not mail" on={v.doNotMail} />
      </div>
      <Conflict c={c} />
      <Foot
        left={
          a && !a.inactive ? (
            endAsk ? (
              <span className="rc-ask">
                <label>
                  Last day in use
                  <input type="date" name="endday" value={endDay} max={todayEt()} onChange={(e) => setEndDay(e.target.value)} />
                </label>
                <button
                  type="button"
                  className="h-btn h-btn--sm rc-btn-bad"
                  onClick={() => c.save({ op: 'pcontact', cid: c.id, kind: 'address', mode: 'end', id: a.id, set: { end: endDay || todayEt() }, base: { end: a.end || null } }, 'Address ended')}
                >
                  End address
                </button>
              </span>
            ) : (
              <button type="button" className="rc-link rc-link--bad" onClick={() => setEndAsk(true)}>
                End this address
              </button>
            )
          ) : (
            <span />
          )
        }
      >
        <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => c.setEditing(null)}>
          Cancel
        </button>{' '}
        <button type="submit" className="h-btn h-btn--primary h-btn--sm" disabled={c.busy}>
          {a ? 'Save' : 'Add address'}
        </button>
      </Foot>
    </form>
  );
}

function PhoneForm({ c, p }: { c: Common; p: any | null }) {
  const v = p || { number: '', type: 'Cell Phone', primary: false, doNotCall: false };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const { v: gv, b } = vals(e.currentTarget);
    const set = { number: gv('number'), type: gv('type'), primary: b('primary'), doNotCall: b('doNotCall') };
    void c.save({ op: 'pcontact', cid: c.id, kind: 'phone', mode: p ? 'edit' : 'add', id: p?.id || undefined, set, base: p ? { number: p.number, type: p.type, primary: p.primary, do_not_call: p.doNotCall } : undefined }, p ? 'Phone saved' : 'Phone added');
  };
  return (
    <form className="rc-form" data-rc-form="phone" autoComplete="off" onSubmit={submit}>
      <div className="rc-grid">
        <label>
          Number
          <input type="tel" name="number" defaultValue={v.number} maxLength={40} placeholder="(813) 555-0100" />
        </label>
        <label>
          Type
          <select name="type" defaultValue={v.type}>
            <Opts list={c.d.tables.phoneTypes} cur={v.type} />
          </select>
        </label>
      </div>
      <div className="rc-toggles">
        <Toggle name="primary" label="Preferred phone" on={v.primary} />
        <Toggle name="doNotCall" label="Do not call" on={v.doNotCall} />
      </div>
      <Conflict c={c} />
      <Foot
        left={
          p && !p.inactive ? (
            <button type="button" className="rc-link rc-link--bad" onClick={() => c.save({ op: 'pcontact', cid: c.id, kind: 'phone', mode: 'end', id: p.id }, 'Phone marked inactive')}>
              Mark inactive
            </button>
          ) : undefined
        }
      >
        <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => c.setEditing(null)}>
          Cancel
        </button>{' '}
        <button type="submit" className="h-btn h-btn--primary h-btn--sm" disabled={c.busy}>
          {p ? 'Save' : 'Add phone'}
        </button>
      </Foot>
    </form>
  );
}

function EmailForm({ c, e }: { c: Common; e: any | null }) {
  const v = e || { address: '', primary: false, doNotEmail: false };
  const submit = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const { v: gv, b } = vals(ev.currentTarget);
    const set = { address: gv('address'), primary: b('primary'), doNotEmail: b('doNotEmail') };
    void c.save({ op: 'pcontact', cid: c.id, kind: 'email', mode: e ? 'edit' : 'add', id: e?.id || undefined, set, base: e ? { address: e.address, primary: e.primary, do_not_email: e.doNotEmail } : undefined }, e ? 'Email saved' : 'Email added');
  };
  return (
    <form className="rc-form" data-rc-form="email" autoComplete="off" onSubmit={submit}>
      <div className="rc-grid">
        <label>
          Email address
          <input type="email" name="address" defaultValue={v.address} maxLength={150} />
        </label>
      </div>
      <div className="rc-toggles">
        <Toggle name="primary" label="Preferred email" on={v.primary} />
        <Toggle name="doNotEmail" label="Do not email" on={v.doNotEmail} />
      </div>
      <Conflict c={c} />
      <Foot
        left={
          e && !e.inactive ? (
            <button type="button" className="rc-link rc-link--bad" onClick={() => c.save({ op: 'pcontact', cid: c.id, kind: 'email', mode: 'end', id: e.id }, 'Email marked inactive')}>
              Mark inactive
            </button>
          ) : undefined
        }
      >
        <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => c.setEditing(null)}>
          Cancel
        </button>{' '}
        <button type="submit" className="h-btn h-btn--primary h-btn--sm" disabled={c.busy}>
          {e ? 'Save' : 'Add email'}
        </button>
      </Foot>
    </form>
  );
}

function ContactView({ c }: { c: Common }) {
  const d = c.d;
  const can = !!(d.can && d.can.contact);
  const [flags, setFlags] = useState(d.flags || null);
  useEffect(() => setFlags(d.flags || null), [d.flags]);
  const Add = ({ kind, text }: { kind: string; text: string }) =>
    can ? (
      <button type="button" className="rc-add" onClick={() => c.setEditing(kind + ':new')}>
        {text}
      </button>
    ) : null;
  const Edit = ({ k }: { k: string }) =>
    can ? (
      <button type="button" className="rc-edit" onClick={() => c.setEditing(k)}>
        Edit
      </button>
    ) : null;
  return (
    <>
      <div className="rc-sec">
        <h3 className="rc-h">
          Addresses
          <Add kind="address" text="Add an address" />
        </h3>
        {c.editing === 'address:new' ? (
          <div className="rc-card is-open">
            <AddrForm c={c} a={null} />
          </div>
        ) : null}
        {d.addresses.length ? (
          sortRows(d.addresses, 'preferred').map((a: any) =>
            c.editing === 'address:' + a.id ? (
              <div key={a.id} className="rc-card is-open">
                <AddrForm c={c} a={a} />
              </div>
            ) : (
              <div key={a.id} className={'rc-card' + (a.inactive ? ' is-ended' : '')}>
                <div className="rc-card__chips">
                  <Chip t={a.type} />
                  {a.preferred ? <Chip t="Preferred" cls="rc-chip--ok" /> : null}
                  {a.doNotMail ? <Chip t="Do not mail" cls="rc-chip--bad" /> : null}
                  {a.inactive ? <Chip t="Ended" /> : null}
                </div>
                <div className="rc-card__body">
                  <b>{a.lines || 'No street'}</b>
                  <p>
                    {[a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
                    {a.country && a.country !== 'United States' ? ' · ' + a.country : ''}
                  </p>
                  {(() => {
                    const meta = a.inactive ? `Used ${a.start ? fdY(a.start) + ' to ' : 'until '}${fdY(a.end)}` : a.seasonalStart ? `Every year ${md(a.seasonalStart)} to ${md(a.seasonalEnd)}` : a.start ? 'Since ' + fdY(a.start) : '';
                    return meta ? <small>{meta}</small> : null;
                  })()}
                </div>
                <Edit k={'address:' + a.id} />
              </div>
            )
          )
        ) : c.editing === 'address:new' ? null : (
          <p className="rc-none">No address on file.</p>
        )}
      </div>
      <div className="rc-sec">
        <h3 className="rc-h">
          Phones
          <Add kind="phone" text="Add a phone" />
        </h3>
        {c.editing === 'phone:new' ? (
          <div className="rc-card is-open">
            <PhoneForm c={c} p={null} />
          </div>
        ) : null}
        {d.phones.length ? (
          sortRows(d.phones, 'primary').map((p: any) =>
            c.editing === 'phone:' + p.id ? (
              <div key={p.id} className="rc-card is-open">
                <PhoneForm c={c} p={p} />
              </div>
            ) : (
              <div key={p.id} className={'rc-card' + (p.inactive ? ' is-ended' : '')}>
                <div className="rc-card__chips">
                  <Chip t={p.type || 'Phone'} />
                  {p.primary ? <Chip t="Preferred" cls="rc-chip--ok" /> : null}
                  {p.doNotCall ? <Chip t="Do not call" cls="rc-chip--bad" /> : null}
                  {p.inactive ? <Chip t="Inactive" /> : null}
                </div>
                <div className="rc-card__body">
                  <b>{p.number}</b>
                </div>
                <Edit k={'phone:' + p.id} />
              </div>
            )
          )
        ) : c.editing === 'phone:new' ? null : (
          <p className="rc-none">No phone on file.</p>
        )}
      </div>
      <div className="rc-sec">
        <h3 className="rc-h">
          Emails
          <Add kind="email" text="Add an email" />
        </h3>
        {c.editing === 'email:new' ? (
          <div className="rc-card is-open">
            <EmailForm c={c} e={null} />
          </div>
        ) : null}
        {d.emails.length ? (
          sortRows(d.emails, 'primary').map((e: any) =>
            c.editing === 'email:' + e.id ? (
              <div key={e.id} className="rc-card is-open">
                <EmailForm c={c} e={e} />
              </div>
            ) : (
              <div key={e.id} className={'rc-card' + (e.inactive ? ' is-ended' : '')}>
                <div className="rc-card__chips">
                  <Chip t="Email" />
                  {e.primary ? <Chip t="Preferred" cls="rc-chip--ok" /> : null}
                  {e.doNotEmail ? <Chip t="Do not email" cls="rc-chip--bad" /> : null}
                  {e.inactive ? <Chip t="Inactive" /> : null}
                </div>
                <div className="rc-card__body">
                  <b>{e.address}</b>
                </div>
                <Edit k={'email:' + e.id} />
              </div>
            )
          )
        ) : c.editing === 'email:new' ? null : (
          <p className="rc-none">No email on file.</p>
        )}
      </div>
      <div className="rc-sec">
        {flags ? (
          <>
            <h3 className="rc-h">Record flags</h3>
            <div className="rc-card rc-card--flags">
              <form
                onSubmit={(e) => e.preventDefault()}
                onChange={(e) => {
                  const f = e.currentTarget;
                  const t = e.target as unknown as HTMLInputElement;
                  if (t.type !== 'checkbox') return;
                  const get = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).checked;
                  const next = { givesAnonymously: get('givesAnonymously'), requestsNoEmail: get('requestsNoEmail'), noValidAddress: get('noValidAddress') };
                  setFlags({ ...flags, ...next });
                  void c.save({ op: 'pflags', cid: c.id, flags: next }, 'Record flags saved');
                }}
              >
                <Toggle name="givesAnonymously" label="Gives anonymously" on={flags.givesAnonymously} off={!can} />
                <Toggle name="requestsNoEmail" label="Requests no email" on={flags.requestsNoEmail} off={!can} />
                <Toggle name="noValidAddress" label="No valid address" on={flags.noValidAddress} off={!can} />
              </form>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ Codes */
function CodeForm({ c, solicit }: { c: Common; solicit: boolean }) {
  const d = c.d;
  const first = (d.tables.constituentCodes.find((x: string) => !d.morningRun.includes(x)) || '') as string;
  const [code, setCode] = useState(solicit ? '' : first);
  const [pt, setPt] = useState<any>(null);
  const morning = !solicit && d.morningRun.includes(code);
  useEffect(() => {
    setPt(null);
    if (!morning) return;
    let live = true;
    rApi(`/api/work/partners/${c.id}/codes?passthrough=1`)
      .then((r) => live && setPt(r.passThrough))
      .catch(() => live && setPt({ gifts: 0, passed: 0, to: [], blocked: false }));
    return () => {
      live = false;
    };
  }, [morning, c.id]);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const { v } = vals(e.currentTarget);
    if (solicit) {
      if (!v('code')) {
        toast('Pick a solicit code.', null, true);
        return;
      }
      void c.save({ op: 'psolicit', cid: c.id, mode: 'add', code: v('code'), date: v('date') || todayEt() }, 'Solicit code added');
    } else void c.save({ op: 'pcode', cid: c.id, mode: 'add', code: v('code'), date: v('date') || todayEt() }, 'Code added');
  };
  return (
    <form className="rc-form rc-card is-open" data-rc-form={solicit ? 'solicit' : 'code'} onSubmit={submit}>
      <div className="rc-grid">
        <label>
          {solicit ? 'Solicit code' : 'Code'}
          <select name="code" value={code} onChange={(e) => setCode(e.target.value)}>
            {solicit ? <Opts list={d.tables.solicitCodes} blank="Pick a code" /> : <Opts list={d.tables.constituentCodes} />}
          </select>
        </label>
        <label>
          Starts
          <input type="date" name="date" defaultValue={todayEt()} />
        </label>
      </div>
      {morning ? (
        <div className="rc-check">
          <b>Gifts to check first</b>
          <p>
            {pt === null
              ? 'Reading the gifts.'
              : pt.gifts === 0
                ? 'No gifts on this record.'
                : pt.passed === 0
                  ? `None of the ${pt.gifts} gifts are soft-credited to someone else.`
                  : pt.blocked
                    ? `All ${pt.gifts} gifts are soft-credited to ${pt.to.slice(0, 3).join(', ') || 'another partner'}. A record that only passes money along stays a Prospect.`
                    : `${pt.passed} of ${pt.gifts} gifts are soft-credited to ${pt.to.slice(0, 3).join(', ') || 'another partner'}.`}
          </p>
        </div>
      ) : null}
      <div className="rc-foot">
        <small>{morning ? 'Partner and Prospect are set automatically each weekday from the gift rules' : ''}</small>
        <span>
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => c.setEditing(null)}>
            Cancel
          </button>{' '}
          <button type="submit" className="h-btn h-btn--primary h-btn--sm" disabled={c.busy || morning}>
            {solicit ? 'Add solicit code' : 'Add code'}
          </button>
        </span>
      </div>
    </form>
  );
}

function CodesView({ c }: { c: Common }) {
  const d = c.d;
  const can = !!(d.can && d.can.codes);
  const active = d.codes.filter((x: any) => !x.inactive);
  const ended = d.codes.filter((x: any) => x.inactive);
  const sActive = d.solicit.filter((x: any) => !x.inactive);
  const sEnded = d.solicit.filter((x: any) => x.inactive);
  const range = (x: any, none: string) => (x.inactive ? `${x.start ? fdY(x.start) + ' to ' : 'Until '}${fdY(x.end)}` : x.start ? 'Since ' + fdY(x.start) : none);
  const codeCard = (x: any) => (
    <div key={x.id} className={'rc-card' + (x.inactive ? ' is-ended' : '')}>
      <div className="rc-card__body">
        <b>
          {x.code}
          {x.morningRun ? <> <Chip t="Set automatically" cls="rc-chip--gold" /></> : null}
          {x.inactive ? <> <Chip t="Ended" /></> : null}
        </b>
        <small>{range(x, '')}</small>
      </div>
      {can && !x.morningRun ? (
        x.inactive ? (
          <button type="button" className="rc-edit" onClick={() => c.save({ op: 'pcode', cid: c.id, mode: 'reopen', id: x.id }, 'Code reopened')}>
            Reopen
          </button>
        ) : c.ask === 'code:' + x.id ? (
          <span className="rc-ask">
            <button type="button" className="h-btn h-btn--sm rc-btn-bad" onClick={() => c.save({ op: 'pcode', cid: c.id, mode: 'end', id: x.id, date: todayEt() }, 'Code ended')}>
              End today
            </button>
            <button type="button" className="rc-edit" onClick={() => c.setAsk(null)}>
              Keep
            </button>
          </span>
        ) : (
          <button type="button" className="rc-edit rc-edit--bad" onClick={() => c.setAsk('code:' + x.id)}>
            End
          </button>
        )
      ) : null}
    </div>
  );
  const sCard = (x: any) => (
    <div key={x.id} className={'rc-card' + (x.inactive ? ' is-ended' : '')}>
      <div className="rc-card__body">
        <b>
          {x.code}
          {x.inactive ? <> <Chip t="Ended" /></> : null}
        </b>
        <small>{range(x, 'No start date')}</small>
      </div>
      {can ? (
        x.inactive ? (
          <button type="button" className="rc-edit" onClick={() => c.save({ op: 'psolicit', cid: c.id, mode: 'reopen', id: x.id }, 'Solicit code reopened')}>
            Reopen
          </button>
        ) : c.ask === 'sol:' + x.id ? (
          <span className="rc-ask">
            <button type="button" className="h-btn h-btn--sm rc-btn-bad" onClick={() => c.save({ op: 'psolicit', cid: c.id, mode: 'end', id: x.id, date: todayEt() }, 'Solicit code ended')}>
              End today
            </button>
            <button type="button" className="rc-edit" onClick={() => c.setAsk(null)}>
              Keep
            </button>
          </span>
        ) : (
          <button type="button" className="rc-edit rc-edit--bad" onClick={() => c.setAsk('sol:' + x.id)}>
            End
          </button>
        )
      ) : null}
    </div>
  );
  return (
    <>
      <div className="rc-sec">
        <h3 className="rc-h">
          Constituent codes
          {can ? (
            <button type="button" className="rc-add" onClick={() => c.setEditing('code:new')}>
              Add a code
            </button>
          ) : null}
        </h3>
        {c.editing === 'code:new' ? <CodeForm c={c} solicit={false} /> : null}
        {active.length ? active.map(codeCard) : <p className="rc-none">No active code.</p>}
        {ended.length ? (
          <details className="rc-ended">
            <summary>{ended.length} ended</summary>
            {ended.map(codeCard)}
          </details>
        ) : null}
      </div>
      <div className="rc-sec">
        <h3 className="rc-h">
          Solicit codes
          {can ? (
            <button type="button" className="rc-add" onClick={() => c.setEditing('solicit:new')}>
              Add a solicit code
            </button>
          ) : null}
        </h3>
        {c.editing === 'solicit:new' ? <CodeForm c={c} solicit /> : null}
        {sActive.length ? sActive.map(sCard) : <p className="rc-none">No solicit code.</p>}
        {sEnded.length ? (
          <details className="rc-ended">
            <summary>{sEnded.length} ended</summary>
            {sEnded.map(sCard)}
          </details>
        ) : null}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ Record */
function StatusForm({ c, to, partner }: { c: Common; to: string; partner: Partner }) {
  const d = c.d;
  const f = d.flags;
  const cur = f.deceased ? 'deceased' : f.inactive ? 'inactive' : 'active';
  const [who, setWho] = useState(c.id);
  const dead = to === 'deceased';
  const people = [{ id: c.id, name: partner.name || 'This record' }].concat((partner.household || []).filter((h) => h.id !== c.id).map((h) => ({ id: h.id, name: h.name })));
  const [fx, setFx] = useState<Record<string, boolean>>({ endPartner: true, endAssignments: true, doNotSolicit: dead, noteOther: true, closeActions: false });
  const open: any[] = d.openActions || [];
  if (to === 'active') {
    return (
      <form
        className="rc-form rc-card is-open"
        data-rc-form="status"
        onSubmit={(e) => {
          e.preventDefault();
          void c.save({ op: 'pstatus', cid: c.id, status: 'active' }, 'Marked active');
        }}
      >
        <p className="rc-line">{cur === 'deceased' ? 'Removes the deceased mark and date.' : 'Removes the inactive mark.'} The codes that ended with it open again.</p>
        <Foot>
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => c.setEditing(null)}>
            Cancel
          </button>{' '}
          <button type="submit" className="h-btn h-btn--primary h-btn--sm" disabled={c.busy}>
            Mark active
          </button>
        </Foot>
      </form>
    );
  }
  const tick = (k: string, title: string, sub: string, dis?: boolean) => (
    <label className="rc-fx" key={k}>
      <input type="checkbox" name={'fx_' + k} checked={dis ? true : !!fx[k]} disabled={dis} onChange={(e) => setFx({ ...fx, [k]: e.target.checked })} />
      <span>
        <b>{title}</b>
        <small>{sub}</small>
      </span>
    </label>
  );
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const { v } = vals(form);
    const effects = { endPartner: fx.endPartner, endAssignments: fx.endAssignments, doNotSolicit: fx.doNotSolicit, closeActions: fx.closeActions, noteOther: fx.noteOther };
    const closeIds = fx.closeActions ? Array.from(form.querySelectorAll<HTMLInputElement>('input[name="close"]:checked')).map((x) => x.value) : [];
    const others = (partner.household || []).filter((h) => h.id !== who).map((h) => h.id).concat(who !== c.id ? [c.id] : []);
    void c.save({ op: 'pstatus', cid: who, status: to, date: v('date') || todayEt(), effects, closeIds, alsoNote: effects.noteOther && others.length ? others[0] : undefined }, dead ? 'Marked deceased' : 'Marked inactive');
  };
  return (
    <form className="rc-form rc-card is-open" data-rc-form="status" onSubmit={submit}>
      <div className="rc-grid">
        <label>
          {dead ? 'Date of death' : 'Date'}
          <input type="date" name="date" defaultValue={todayEt()} max={todayEt()} />
        </label>
        {people.length > 1 ? (
          <label>
            Who
            <select name="who" value={who} onChange={(e) => setWho(e.target.value)}>
              {people.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {people.length > 1 ? (
        <div className="rc-note">
          <p>The other person in this household stays active and keeps their codes and assignment.</p>
          <label className="rc-tog">
            <input type="checkbox" name="fx_noteOther" checked={!!fx.noteOther} onChange={(e) => setFx({ ...fx, noteOther: e.target.checked })} />
            <i />
            <span>Add a note to the other person&apos;s record</span>
          </label>
        </div>
      ) : null}
      <div className="rc-fxs">
        {tick('flag', dead ? 'Set deceased and the date' : 'Set inactive', 'Blackbaud record', true)}
        {tick('endPartner', 'End the Partner code on that date', 'The code stays on the record, ended')}
        {tick('endAssignments', 'End assignments on that date', 'The holder keeps credit for gifts dated before it')}
        {tick('doNotSolicit', 'Add the Do Not Solicit solicit code', 'Stops mail and calls that name this partner')}
        {tick('closeActions', 'Cancel open actions for this partner', open.length ? `${open.length} open` : 'None open')}
      </div>
      {fx.closeActions && open.length ? (
        <div className="rc-open">
          {open.map((a) => (
            <label key={a.id}>
              <input type="checkbox" name="close" value={a.id} defaultChecked /> {a.summary || a.category}
              {a.due ? ' · ' + fdY(a.due) : ''}
            </label>
          ))}
        </div>
      ) : null}
      {who === c.id ? null : <p className="rc-line">The effects apply to the person picked.</p>}
      <div className="rc-foot">
        <small />
        <span>
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => c.setEditing(null)}>
            Cancel
          </button>{' '}
          <button type="submit" className="h-btn h-btn--primary h-btn--sm" disabled={c.busy}>
            {dead ? 'Mark deceased' : 'Mark inactive'}
          </button>
        </span>
      </div>
    </form>
  );
}

function StatusView({ c, partner }: { c: Common; partner: Partner }) {
  const d = c.d;
  const f = d.flags;
  const cur = f.deceased ? 'deceased' : f.inactive ? 'inactive' : 'active';
  const can = !!(d.can && d.can.codes);
  const isOrg = f.type === 'Organization';
  const [pick, setPick] = useState<string>(cur);
  const card = (k: string, title: string, sub: string) => (
    <button key={k} type="button" className={'rc-status' + (pick === k ? ' is-on' : '') + (cur === k ? ' is-now' : '')} disabled={!can} onClick={() => setPick(k)}>
      <b>{title}</b>
      <span>{sub}</span>
    </button>
  );
  return (
    <>
      <div className="rc-sec">
        <h3 className="rc-h">Record status</h3>
        <div className="rc-statuses">
          {card('active', 'Active', 'Partner or prospect today')}
          {card('inactive', 'Inactive', 'Left or asked to be removed')}
          {isOrg ? null : card('deceased', 'Deceased', 'Passed away')}
        </div>
        {can && pick !== cur ? <StatusForm key={pick} c={{ ...c, setEditing: () => setPick(cur) }} to={pick} partner={partner} /> : null}
        {can ? null : <p className="rc-none">Admins and the Support Team change the record status.</p>}
      </div>
      <div className="rc-sec">
        <h3 className="rc-h">Record</h3>
        <dl className="rc-dl">
          <dt>Record type</dt>
          <dd>{f.type || 'Individual'}</dd>
          <dt>Status</dt>
          <dd>{cur === 'deceased' ? 'Deceased' + (f.deceasedDate ? ' ' + fdY(f.deceasedDate) : '') : cur === 'inactive' ? 'Inactive' : 'Active'}</dd>
          {d.lastStatusChange ? (
            <>
              <dt>Last change here</dt>
              <dd>{fdY(String(d.lastStatusChange.at).slice(0, 10))}</dd>
            </>
          ) : null}
        </dl>
      </div>
    </>
  );
}

void useQuery;
