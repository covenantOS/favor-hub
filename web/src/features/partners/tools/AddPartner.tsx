// Add a partner: the full new-partner form in a slide-over (port of public/js/add-partner.js). Individual, household (two people joined as
// spouses) or organization (a type code and a main contact joined to it), with links to partners already in Blackbaud. Records already in
// Blackbaud show beside the form as you type (FavorOS's copy at once, Blackbaud's own duplicate search a moment after you stop). Add
// stays locked until "None of these is the same person" is ticked, and any edit to a name, phone, email or city clears the tick.
// Support and admins only; the server checks again on save and repeats the duplicate check. ?standin=1 sends the add to the stand-in route,
// which builds the same calls and makes nothing in Blackbaud.
import { useEffect, useMemo, useRef, useState } from 'react';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { BodyPortal } from '@/shell/BodyPortal';
import { hubOv } from '@/lib/hubOv';
import { Ic } from '../record/Ic';
import { openPartner } from '../record/drawerStore';
import { digits, rApi, rPost } from '../record/lib';
import { closeAdd, openAdd } from './store';

const STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'PR', 'GU', 'VI'];
const KINDS: [string, string][] = [
  ['individual', 'Individual'],
  ['household', 'Household'],
  ['organization', 'Organization'],
];
const MAX_LIVE = 8;

export const addOptionsQuery = queryOptions({
  queryKey: ['pr', 'add-options'],
  queryFn: async () => (await rApi('/api/work/partner-add/options').catch(() => ({ can: false }))) as any,
  staleTime: 10 * 60_000,
});
/** True when this person may add a partner (Support and admins). */
export const useCanAddPartner = (): boolean => !!useQuery(addOptionsQuery).data?.can;

/** The Add partner button: hidden until the options say this person may add one. */
export function AddPartnerButton({ className = 'h-btn h-btn--primary', children = 'Add partner' }: { className?: string; children?: React.ReactNode }) {
  const can = useCanAddPartner();
  return (
    <button type="button" className={className} data-add-partner="" hidden={!can} onClick={openAdd}>
      {children}
    </button>
  );
}

interface Rel { id: string; name: string; q: string; type: string; hits: any[] | null }
const blank = () => ({
  kind: 'individual', title: '', first: '', middle: '', last: '', suffix: '',
  stitle: '', sfirst: '', smiddle: '', slast: '', ssuffix: '', sphone: '', sphoneType: '', semail: '',
  org: '', typeCode: '', cfirst: '', clast: '', ctitle: '', crole: 'Employee', cposition: '', cphone: '', cemail: '',
  phone: '', phoneType: '', email: '', street: '', city: '', state: '', zip: '',
  code: 'Prospect', holder: '',
});
type Fields = ReturnType<typeof blank>;

export function AddPartner({ onClose }: { onClose: () => void }) {
  const { data: o } = useQuery(addOptionsQuery);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const f = requestAnimationFrame(() => setOn(true));
    document.documentElement.classList.add('pp-locked');
    const tok = hubOv.on(() => onClose());
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      cancelAnimationFrame(f);
      document.documentElement.classList.remove('pp-locked');
      hubOv.off(tok);
      document.removeEventListener('keydown', key, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return BodyPortal(
    <div className="pp-layer">
      <div className={'pp-scrim' + (on ? ' is-on' : '')} onClick={onClose} />
      <aside className={'pp-drawer ad-drawer' + (on ? ' is-on' : '')} role="dialog" aria-modal="true" aria-label="Add a partner">
        <div className="pp-bar">
          <span className="pp-bar__name">Add a partner</span>
          <span className="pp-bar__acts">
            <button type="button" className="pp-iconbtn" aria-label="Close (Esc)" onClick={onClose}>
              <Ic n="x" />
            </button>
          </span>
        </div>
        <div className="pp-scroll ad-scroll">{o && o.can ? <Form o={o} onClose={onClose} /> : <div className="pp-skel"><i style={{ height: 16, width: '34%' }} /><i style={{ height: 40, width: '68%' }} /><i style={{ height: 160 }} /></div>}</div>
      </aside>
    </div>
  );
}

function Form({ o, onClose }: { o: any; onClose: () => void }) {
  const [S, setS] = useState<Fields>(blank);
  const [relations, setRelations] = useState<Rel[]>([]);
  const [notSame, setNotSame] = useState(false);
  const [matches, setMatches] = useState<any[]>([]);
  const [status, setStatus] = useState('');
  const [warn, setWarn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);
  const [err, setErr] = useState('');
  const [holderNote, setHolderNote] = useState('');
  const [standin, setStandin] = useState(false);
  const holderTouched = useRef(false);
  const seq = useRef(0);
  const liveSig = useRef('');
  const liveCount = useRef(0);
  const tickSig = useRef('');
  const set = (p: Partial<Fields>) => setS((s) => ({ ...s, ...p }));
  useEffect(() => setStandin(new URLSearchParams(window.location.search).get('standin') === '1'), []);

  const sig = useMemo(() => JSON.stringify([S.kind, S.first, S.last, S.sfirst, S.slast, S.org, digits(S.phone).replace(/\D/g, ''), S.email, S.city, S.state, S.zip].map((x) => String(x).trim().toLowerCase())), [S.kind, S.first, S.last, S.sfirst, S.slast, S.org, S.phone, S.email, S.city, S.state, S.zip]);
  const probe = () => ({ kind: S.kind, first: S.first, last: S.last, spouse_first: S.sfirst, spouse_last: S.slast || S.last, org: S.org, phone: S.phone, email: S.email, city: S.city, state: S.state, zip: S.zip });
  const mailOk = (v: string) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
  const phoneOk = (v: string) => !v || v.replace(/\D/g, '').length === 10;
  const ready = (S.kind === 'organization' ? S.org.trim().length >= 3 : S.last.trim().length >= 2) || S.phone.replace(/\D/g, '').length >= 10 || /@/.test(S.email);
  const valid = () => {
    if (S.kind === 'organization') {
      if (S.org.trim().length < 3) return false;
      if ((S.cfirst.trim() || S.clast.trim()) && !(S.cfirst.trim() && S.clast.trim())) return false;
    } else {
      if (!S.first.trim() || !S.last.trim()) return false;
      if (S.kind === 'household' && !S.sfirst.trim()) return false;
    }
    return phoneOk(S.phone) && mailOk(S.email) && phoneOk(S.sphone) && mailOk(S.semail) && phoneOk(S.cphone) && mailOk(S.cemail) && relations.every((r) => r.id);
  };

  // Matching records: FavorOS's copy 250 ms after typing, Blackbaud's own search once the person pauses.
  const probeRef = useRef(probe);
  probeRef.current = probe;
  const sigRef = useRef(sig);
  sigRef.current = sig;
  useEffect(() => {
    if (notSame && sig !== tickSig.current) setNotSame(false);
    const check = async (live: boolean) => {
      const my = ++seq.current;
      const s = sigRef.current;
      try {
        const out: any = await rPost('/api/work/partner-add/matches', { ...probeRef.current(), live });
        if (my !== seq.current && !live) return;
        if (s !== sigRef.current) {
          if (live) setStatus((x) => (/^Checking/.test(x) ? '' : x));
          return;
        }
        setMatches(out.matches);
        if (live) {
          liveSig.current = s;
          liveCount.current++;
        }
        setStatus(!out.ready ? '' : out.live === 'ran' ? 'Checked in Blackbaud at ' + new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET' : out.live === 'failed' ? "Blackbaud did not answer. These are from FavorOS's copy." : '');
        setWarn(out.live === 'failed');
      } catch (e) {
        setStatus((e as Error).message);
        setWarn(true);
      }
    };
    const t1 = setTimeout(() => check(false), 250);
    const t2 = setTimeout(() => {
      if (liveCount.current < MAX_LIVE && sigRef.current !== liveSig.current && readyRef.current) {
        setStatus('Checking Blackbaud…');
        setWarn(false);
        check(true);
      }
    }, 1300);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  // The holder follows the state until the person picks one.
  useEffect(() => {
    const t = setTimeout(async () => {
      if (holderTouched.current) return;
      try {
        const g: any = await rApi('/api/work/partner-add/holder?state=' + encodeURIComponent(S.state));
        if (holderTouched.current) return;
        setS((s) => ({ ...s, holder: g.fid || '' }));
        setHolderNote(g.source === 'territory' ? `${g.name} holds ${S.state.toUpperCase()}.` : g.source === 'partner_care' ? (S.state.trim() ? `No region lists ${S.state.toUpperCase()}. Partner Care holds it.` : 'No state yet. Partner Care holds it.') : '');
      } catch {
        // the picker stays as it is
      }
    }, S.state ? 400 : 0);
    return () => clearTimeout(t);
  }, [S.state]);

  const relTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const setRel = (i: number, p: Partial<Rel>) => setRelations((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const searchRel = (i: number, q: string) => {
    setRel(i, { q, id: '', name: '' });
    clearTimeout(relTimers.current[i]);
    relTimers.current[i] = setTimeout(async () => {
      if (q.trim().length < 2) {
        setRel(i, { hits: null });
        return;
      }
      try {
        setRel(i, { hits: ((await rApi('/api/work/partners?wide=1&q=' + encodeURIComponent(q.trim()))).rows || []) as any[] });
      } catch {
        setRel(i, { hits: [] });
      }
    }, 250);
  };

  const go = async () => {
    setBusy(true);
    setErr('');
    const org = S.kind === 'organization';
    const body = {
      ...probe(),
      title: S.title, middle: S.middle, suffix: S.suffix, phone_type: S.phoneType || (org ? 'Business Phone' : 'Cell Phone'),
      spouse_title: S.stitle, spouse_middle: S.smiddle, spouse_suffix: S.ssuffix, spouse_phone: S.sphone, spouse_email: S.semail,
      type_code: org ? S.typeCode : '',
      contact: org && (S.cfirst.trim() || S.clast.trim()) ? { first: S.cfirst, last: S.clast, title: S.ctitle, phone: S.cphone, email: S.cemail, position: S.cposition, role: S.crole } : null,
      relations: relations.filter((r) => r.id).map((r) => ({ id: r.id, type: r.type })),
      street: S.street, code: S.code, holder: S.holder, none_same: true,
    };
    try {
      setDone(await rPost(standin ? '/api/work/partner-add/standin' : '/api/work/partner-add', body));
      setBusy(false);
    } catch (e) {
      setBusy(false);
      setErr((e as Error).message);
    }
  };

  const sel = (name: keyof Fields, list: string[], blankLabel?: string, fallback?: string) => (
    <select value={(S[name] as string) || fallback || ''} onChange={(e) => set({ [name]: e.target.value } as Partial<Fields>)}>
      {blankLabel != null ? <option value="">{blankLabel}</option> : null}
      {list.map((x) => (
        <option key={x}>{x}</option>
      ))}
    </select>
  );
  const inp = (name: keyof Fields, label: string, type = 'text', extra: Record<string, unknown> = {}) => (
    <label>
      {label}
      <input type={type} value={S[name] as string} onChange={(e) => set({ [name]: e.target.value } as Partial<Fields>)} autoComplete="off" {...extra} />
    </label>
  );
  const person = (p: '' | 's', title: keyof Fields, first: keyof Fields, middle: keyof Fields, last: keyof Fields, suffix: keyof Fields) => (
    <div className="ad-grid ad-grid--name">
      <label>Title{sel(title, o.titles, '')}</label>
      {inp(first, 'First name')}
      {inp(middle, 'Middle')}
      {inp(last, 'Last name')}
      <label>Suffix{sel(suffix, o.suffixes, '')}</label>
      <span hidden>{p}</span>
    </div>
  );

  if (done) {
    return (
      <div className="ad ad-done">
        {standin ? (
          <>
            <h1>Stand-in answered</h1>
            <p>Nothing was made in Blackbaud. {done.calls.length} calls built for {done.name}:</p>
            <pre>{done.calls.map((c: any) => c.method + ' ' + c.path).join('\n')}</pre>
            <p>
              <button type="button" className="h-btn h-btn--primary" onClick={onClose}>
                Close
              </button>
            </p>
          </>
        ) : (
          <>
            <span className="pp-kicker">Added</span>
            <h1>{done.name}</h1>
            <p>Record {done.lookup || ''}. The code, the holder and the links are in Blackbaud. Source code, addressee and salutation come from the record review the next weekday.</p>
            {done.warnings && done.warnings.length ? (
              <div className="rc-conflict" role="alert">
                <b>Finish in Blackbaud</b>
                <p>{done.warnings.join(' ')}</p>
              </div>
            ) : null}
            <p className="ad-done__acts">
              <button
                type="button"
                className="h-btn h-btn--primary"
                onClick={() => {
                  onClose();
                  openPartner(done.cid);
                }}
              >
                Open the record
              </button>{' '}
              <button
                type="button"
                className="h-btn h-btn--ghost"
                onClick={() => {
                  setS(blank());
                  setRelations([]);
                  setNotSame(false);
                  setMatches([]);
                  setStatus('');
                  setDone(null);
                  holderTouched.current = false;
                }}
              >
                Add another
              </button>
            </p>
          </>
        )}
      </div>
    );
  }

  const org = S.kind === 'organization';
  const okToAdd = !busy && notSame && valid() && ready;
  const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
  return (
    <div className="ad">
      <div className="ad-head">
        <span className="pp-kicker">New partner</span>
        <h1>Add a partner</h1>
        <p>{standin ? 'Stand-in: nothing is made in Blackbaud.' : 'Matching records show as you type.'}</p>
      </div>
      <div className="ad-body">
        <form className="ad-form" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
          <div className="ad-kinds" role="group" aria-label="What kind of record">
            {KINDS.map(([k, l]) => (
              <button
                key={k}
                type="button"
                className={S.kind === k ? 'is-on' : ''}
                onClick={() => {
                  set({ kind: k });
                  setNotSame(false);
                }}
              >
                {l}
              </button>
            ))}
          </div>
          {org ? (
            <>
              <div className="ad-sec">
                <h3>Organization</h3>
                <div className="ad-grid">
                  {inp('org', 'Organization name')}
                  <label>Type{sel('typeCode', o.typeCodes, '')}</label>
                </div>
              </div>
              <div className="ad-sec">
                <h3>Main contact</h3>
                <div className="ad-grid ad-grid--name">
                  <label>Title{sel('ctitle', o.titles, '')}</label>
                  {inp('cfirst', 'First name')}
                  {inp('clast', 'Last name')}
                  <label>Is the organization&apos;s{sel('crole', o.contactRoles)}</label>
                  {inp('cposition', 'Position')}
                </div>
                <div className="ad-grid">
                  {inp('cphone', 'Contact phone', 'tel')}
                  {inp('cemail', 'Contact email', 'email')}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="ad-sec">
                <h3>{S.kind === 'household' ? 'First person' : 'Person'}</h3>
                {person('', 'title', 'first', 'middle', 'last', 'suffix')}
              </div>
              {S.kind === 'household' ? (
                <div className="ad-sec">
                  <h3>Second person</h3>
                  {person('s', 'stitle', 'sfirst', 'smiddle', 'slast', 'ssuffix')}
                  <div className="ad-grid">
                    {inp('sphone', 'Phone', 'tel')}
                    {inp('semail', 'Email', 'email')}
                  </div>
                </div>
              ) : null}
            </>
          )}
          <div className="ad-sec">
            <h3>Reach</h3>
            <div className="ad-grid">
              {inp('phone', org ? 'Organization phone' : 'Phone', 'tel')}
              <label>Phone type{sel('phoneType', o.phoneTypes, undefined, org ? 'Business Phone' : 'Cell Phone')}</label>
              {inp('email', org ? 'Organization email' : 'Email', 'email')}
            </div>
            {inp('street', 'Street')}
            <div className="ad-grid ad-grid--3">
              {inp('city', 'City')}
              <label>
                State
                <input type="text" value={S.state} list="ad-states" maxLength={30} autoComplete="off" onChange={(e) => set({ state: e.target.value })} />
              </label>
              {inp('zip', 'ZIP')}
            </div>
            <datalist id="ad-states">
              {STATES.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </div>
          <div className="ad-sec">
            <h3>
              Relationships
              <button type="button" className="rc-add" onClick={() => setRelations((r) => [...r, { id: '', name: '', q: '', type: o.relations[0], hits: null }])}>
                Add a relationship
              </button>
            </h3>
            {relations.length ? (
              relations.map((r, i) => (
                <div key={i} className="ad-rel" data-i={i}>
                  <label>
                    Related to
                    <input type="text" value={r.name || r.q || ''} placeholder="Find a partner" autoComplete="off" autoFocus={i === relations.length - 1 && !r.q} onChange={(e) => searchRel(i, e.target.value)} />
                    {r.hits && !r.id ? (
                      <ul className="ad-hits">
                        {r.hits.length ? (
                          r.hits.map((h) => (
                            <li key={h.cid}>
                              <button type="button" onClick={() => setRel(i, { id: h.cid, name: h.name, hits: null })}>
                                {h.name}
                                <span>{h.place || ''}</span>
                              </button>
                            </li>
                          ))
                        ) : (
                          <li className="is-none">No partner found.</li>
                        )}
                      </ul>
                    ) : null}
                  </label>
                  <label>
                    The other partner is their
                    <select value={r.type || o.relations[0]} onChange={(e) => setRel(i, { type: e.target.value })}>
                      {o.relations.map((x: string) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="rc-link rc-link--bad" onClick={() => setRelations((x) => x.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </div>
              ))
            ) : (
              <p className="rc-none">No relationship to a partner already in Blackbaud.</p>
            )}
          </div>
          <div className="ad-sec">
            <h3>Code and holder</h3>
            <div className="ad-grid">
              <label>Code{sel('code', ['Prospect', 'Partner'])}</label>
              <label>
                Held by
                <select
                  value={S.holder}
                  onChange={(e) => {
                    holderTouched.current = true;
                    setHolderNote('');
                    set({ holder: e.target.value });
                  }}
                >
                  <option value="">No one yet</option>
                  {o.holders.map((h: any) => (
                    <option key={h.fid} value={h.fid}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="ad-note">{holderNote}</p>
          </div>
        </form>
        <div className="ad-matches" id="ad-matches">
          {!ready ? (
            <div className="ad-matches__idle">Records already in Blackbaud show here as you type a name, phone or email.</div>
          ) : (
            <>
              <div className="ad-matches__head">
                <b>{matches.length ? matches.length + (matches.length === 1 ? ' record' : ' records') + ' already in Blackbaud' : 'Already in Blackbaud'}</b>
                <span className={warn ? 'is-warn' : ''} aria-live="polite">
                  {status}
                </span>
              </div>
              {matches.length ? (
                matches.map((m) => {
                  const strong = m.reasons.some((x: string) => /phone|email|and city|domain/i.test(x));
                  const meta = [m.since ? (m.gifts ? 'Partner since ' + m.since.slice(0, 4) : 'Added ' + m.since.slice(0, 4)) : '', m.gifts ? `last gift ${money(m.lastAmount)}` : 'no gifts', m.holders.length ? 'held by ' + m.holders.join(', ') : ''].filter(Boolean).join(' · ');
                  return (
                    <div key={m.cid} className={'ad-match' + (strong ? ' is-strong' : '')}>
                      <div>
                        <b>
                          {m.name}
                          {m.deceased ? ' (deceased)' : ''}
                        </b>
                        <p>
                          {m.place || 'No address'}
                          {m.lookup ? ' · ' + m.lookup : ''}
                          {meta ? (
                            <>
                              <br />
                              {meta}
                            </>
                          ) : null}
                        </p>
                        <div className="ad-why">
                          {m.reasons.map((w: string) => (
                            <span key={w} className={'rc-chip' + (/phone|email|and city|domain/i.test(w) ? ' rc-chip--gold' : '')}>
                              {w}
                            </span>
                          ))}
                        </div>
                      </div>
                      <a className="h-btn h-btn--ghost h-btn--sm" href={'/work/partner/' + encodeURIComponent(m.cid)} target="_blank" rel="noopener">
                        Open this record
                      </a>
                    </div>
                  );
                })
              ) : (
                <div className="ad-clear">No match on name, phone, email or city</div>
              )}
              <label className="ad-tick">
                <input
                  type="checkbox"
                  checked={notSame}
                  onChange={(e) => {
                    setNotSame(e.target.checked);
                    tickSig.current = sig;
                  }}
                />{' '}
                None of these is the same person
              </label>
            </>
          )}
        </div>
      </div>
      <div className="ad-foot" id="ad-foot">
        {err ? (
          <p className="ad-err" role="alert">
            {err}
          </p>
        ) : null}
        <span className="ad-foot__hint">{notSame ? '' : ready ? 'Tick the box above to continue.' : ''}</span>
        <span>
          <button type="button" className="h-btn h-btn--ghost" onClick={onClose}>
            Cancel
          </button>{' '}
          <button type="button" className="h-btn h-btn--primary" disabled={!okToAdd} onClick={go}>
            {busy ? 'Adding…' : standin ? 'Try the stand-in' : 'Add as new partner'}
          </button>
        </span>
      </div>
    </div>
  );
}

void closeAdd;
