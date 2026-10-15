// The review pane beside the photo: partner, amount, check number and dates, name on the check, fund, appeal, memo, soft credit, and the
// Approve, Hold and Reject bar. Follows pane(), actionBar() and appealReason() in public/js/gift-entry.js. Saving goes through the
// callbacks the deposit screen passes in, which call PATCH /api/gift-entry/gifts/:id.
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { ChangeArea, ChangeInput, GeTerm } from './fields';
import { ENCLOSURES, money, nameOf, primaryOf, toCents, whenText } from './logic';
import { searchPartners } from './data';
import { geToast } from './toast';
import type { Catalog, Row } from './types';

const FSRC: Record<string, string> = { slip: 'Reply slip', letter: 'Letter', expected: 'Expected gift', memo: 'Memo' };
const CONF_TIP: Record<string, string> = { high: 'The two readers agree', medium: 'One reader, or no second check', low: 'The readers disagree or nothing was read' };

function Dot({ r, k }: { r: Row; k: string }) {
  const c = r.conf && r.conf[k];
  if (!c || k === 'appeal' || k === 'designation') return null;
  return <i className={'ge-dot is-' + c} title={CONF_TIP[c]}></i>;
}
const flagged = (r: Row, n: string) => (r.flags.includes(n as never) && !r.confirmed ? ' is-flag' : '');
function Why({ r, n }: { r: Row; n: string }) {
  const w = r.why[n as never];
  return r.flags.includes(n as never) && !r.confirmed && w ? <span className="ge-why">{w}</span> : null;
}

/** The fund and appeal lists, drawn once per catalog (hundreds of options). */
export const Lists = memo(function Lists({ catalog }: { catalog: Catalog | undefined }) {
  return (
    <>
      <datalist id="ge-funds">{catalog ? catalog.funds.map((f) => <option key={f.id} value={f.name}></option>) : null}</datalist>
      <datalist id="ge-appeals">{catalog ? catalog.appeals.map((a) => <option key={a.id} value={a.code + ' · ' + a.name}></option>) : null}</datalist>
    </>
  );
});

/** The search box and its results under Partner and under Recommended by. */
function Search({ inputId, boxId, placeholder, onPick, pickAttr }: { inputId: string; boxId: string; placeholder: string; onPick: (h: { cid: string; name: string; place: string; lookup: string }) => void; pickAttr: string }) {
  const [hits, setHits] = useState<{ cid: string; name: string; place: string; lookup: string }[] | null>(null);
  const [text, setText] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const input = (v: string) => {
    setText(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const q = v.trim();
      if (q.length < 2) {
        setHits(null);
        return;
      }
      try {
        setHits(await searchPartners(q));
      } catch (er) {
        geToast((er as Error).message);
      }
    }, 250);
  };
  return (
    <>
      <input className="ge-input" id={inputId} placeholder={placeholder} autoComplete="off" value={text} onChange={(e) => input(e.target.value)} />
      <div className="ge-opts" id={boxId} hidden={hits === null}>
        {hits === null
          ? null
          : hits.length
            ? hits.map((h) => (
                <button
                  type="button"
                  key={h.cid}
                  {...{ [pickAttr]: h.cid }}
                  data-n={h.name}
                  data-p={h.place}
                  data-l={h.lookup}
                  onClick={() => {
                    setText('');
                    setHits(null);
                    onPick(h);
                  }}
                >
                  {h.name}
                  <small>
                    {h.place} · {h.lookup}
                  </small>
                </button>
              ))
            : [
                <button type="button" key="none" disabled>
                  No partner found
                </button>,
              ]}
      </div>
    </>
  );
}

export interface PaneApi {
  catalog: Catalog | undefined;
  /** The fund and appeal lists, read now if they have not arrived (a pick must not fail because the list is late). */
  getCatalog: () => Promise<Catalog>;
  ask: string;
  setAsk: (a: '' | 'hold' | 'reject') => void;
  me: { email: string };
  today: string;
  save: (id: string, set: Record<string, unknown> | null, action?: string, extra?: Record<string, unknown>) => Promise<boolean>;
  act: (id: string, action: string, extra?: Record<string, unknown>) => Promise<void>;
  pickPartner: (r: Row, cid: string, name: string, place: string, lookup: string) => Promise<void>;
  reread: (r: Row) => Promise<void>;
  addEnclosure: (r: Row, kind: string, files: File[]) => Promise<void>;
  /** The history panel and the flags, drawn by the deposit screen so they can read the cached history. */
  children?: ReactNode;
}

function ReasonBar({ api, r }: { api: PaneApi; r: Row }) {
  const hold = api.ask === 'hold';
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const go = () => {
    if (!text.trim()) {
      geToast('Say why first.');
      return;
    }
    void api.act(r.id, api.ask, { reason: text });
  };
  return (
    <div className="ge-reason">
      <input
        ref={ref}
        className="ge-input"
        id="ge-reason"
        placeholder={hold ? 'Why is it on hold' : 'Why is it rejected'}
        maxLength={200}
        autoComplete="off"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            go();
          } else if (e.key === 'Escape') api.setAsk('');
        }}
      />
      <button type="button" className={'ge-btn' + (hold ? '' : ' ge-btn--red')} data-reason-go={api.ask} onClick={go}>
        {hold ? 'Hold' : 'Reject'}
      </button>
      <button type="button" className="ge-link" data-reason-no="" onClick={() => api.setAsk('')}>
        Cancel
      </button>
    </div>
  );
}

function ActionBar({ api, r }: { api: PaneApi; r: Row }) {
  if (api.ask === 'hold' || api.ask === 'reject') return <ReasonBar api={api} r={r} />;
  const p = primaryOf(r, r.needsSecond, (api.me.email || '').toLowerCase());
  let primary: ReactNode;
  if (p.act === 'approve2') {
    primary = p.disabled ? (
      <button type="button" className="ge-btn ge-btn--primary" disabled>
        Needs a second person
      </button>
    ) : (
      <button type="button" className="ge-btn ge-btn--primary" data-act="approve2" onClick={() => void api.act(r.id, 'approve2')}>
        <Icon n="check" />
        Approve as second
      </button>
    );
  } else if (p.act === 'unconfirm') {
    primary = (
      <button type="button" className="ge-btn" data-act="unconfirm" onClick={() => void api.act(r.id, 'unconfirm')}>
        Undo approval
      </button>
    );
  } else {
    primary = (
      <button type="button" className="ge-btn ge-btn--primary" data-act="approve" disabled={p.disabled} onClick={() => void api.act(r.id, 'approve')}>
        <Icon n="check" />
        Approve
      </button>
    );
  }
  return (
    <div className="ge-acts">
      {primary}
      <button type="button" className="ge-btn" data-ask="hold" onClick={() => api.setAsk('hold')}>
        Hold
      </button>
      <button type="button" className="ge-btn ge-btn--red" data-ask="reject" onClick={() => api.setAsk('reject')}>
        Reject
      </button>
      {p.block ? <span className="ge-why">{p.block}</span> : null}
    </div>
  );
}

export function Pane({ r, api }: { r: Row; api: PaneApi }) {
  const d = r.defaults || {};
  const cands = r.candidates.filter((c) => !(r.partner && r.partner.id === c.cid));
  const c = r.coding || ({} as Row['coding']);
  const tags: ReactNode[] = [];
  if (r.ruleLabel)
    tags.push(
      <span className="ge-pill" key="rule">
        Photo goes to Blackbaud · {r.ruleLabel}
      </span>
    );
  if (r.prayer)
    tags.push(
      <span className="ge-pill ge-pill--warn" key="prayer">
        Prayer request
      </span>
    );
  if (r.kind === 'cash')
    tags.push(
      <span className="ge-pill" key="cash">
        Cash
      </span>
    );
  const approval = r.confirmed ? `Approved by ${nameOf(r.confirmedBy)}${r.confirmedAt ? ', ' + whenText(r.confirmedAt, api.today) : ''}${r.secondDone ? ' · second by ' + nameOf(r.secondBy) : ''}` : '';
  const num = (v: string) => toCents(v);
  const go = (set: Record<string, unknown>) => void api.save(r.id, set);
  const catalog = api.catalog;
  const sug = (c.suggestions || []).map((x) => (
    <button type="button" className="ge-cand" key={x.appealId} data-sug={x.appealId} data-n={x.name} data-why={x.reason} onClick={() => void api.save(r.id, { appeal_id: x.appealId, appeal_name: x.name })}>
      {x.code}
      <small>{x.reason}</small>
    </button>
  ));
  return (
    <div className="ge-pane" data-pane={r.id}>
      {r.card ? <div className="ge-note ge-note--red">A card number showed in the photo. The photo was not kept. Use Add gift on the partner record, then reject this row.</div> : null}
      {r.dup ? (
        <div className="ge-note ge-note--red">
          <b>{r.dup.message}</b>
          {r.dup.decision === null ? (
            <div className="acts">
              <button type="button" className="ge-btn" data-act="dup_remove" onClick={() => void api.act(r.id, 'dup_remove')}>
                Remove this row
              </button>
              <button type="button" className="ge-btn" data-act="dup_keep" onClick={() => void api.act(r.id, 'dup_keep')}>
                Different gift, keep it
              </button>
            </div>
          ) : r.dup.decision === 'keep' ? (
            <span>Kept as a different gift.</span>
          ) : null}
        </div>
      ) : null}
      {r.error ? <div className="ge-note ge-note--red">{r.error}</div> : null}
      {r.held ? (
        <div className="ge-note">
          <b>On hold</b>
          <span>
            {r.held.reason || ''} · {r.held.by || ''}
          </span>
          <div className="acts">
            <button type="button" className="ge-btn" data-act="release" onClick={() => void api.act(r.id, 'release')}>
              Take off hold
            </button>
          </div>
        </div>
      ) : null}
      <div className="ge-field">
        <label>Partner {r.partner ? <Dot r={r} k="payer" /> : null}</label>
        {r.partner ? (
          <div className="ge-who">
            <b>
              {r.partner.id ? (
                <a href={'/work/partner/' + encodeURIComponent(r.partner.id)} data-partner-id={r.partner.id}>
                  {r.partner.name}
                </a>
              ) : (
                r.partner.name
              )}
            </b>
            <span>
              {r.partner.place || ''}
              {r.partner.lookup ? ' · ' + r.partner.lookup : ''}
            </span>
          </div>
        ) : (
          <div className="ge-note ge-note--red">No partner matched yet.</div>
        )}
        {cands.length ? (
          <div className="ge-cands">
            {cands.map((x) => (
              <button type="button" className="ge-cand" key={x.cid} data-pickp={x.cid} data-n={x.name} data-p={x.place} data-l={x.lookup} onClick={() => void api.pickPartner(r, x.cid, x.name, x.place, x.lookup)}>
                {x.name}
                <small>
                  {x.place || ''}
                  {x.exact ? ' · same name' : ''}
                  {x.addr ? ' · same address' : ''}
                </small>
              </button>
            ))}
          </div>
        ) : null}
        <Search inputId="ge-ps" boxId="ge-pr" placeholder="Search by name, street, phone or email" pickAttr="data-pickp" onPick={(h) => void api.pickPartner(r, h.cid, h.name, h.place, h.lookup)} />
        {r.address ? <span className="ge-src">Address on the check: {r.address}</span> : null}
      </div>
      <div className="ge-row2">
        <div className={'ge-field' + flagged(r, 'amount')}>
          <label htmlFor="gf-amount">
            Amount <Dot r={r} k="amount" />
          </label>
          <ChangeInput id="gf-amount" inputMode="decimal" value={r.amountCents != null ? (r.amountCents / 100).toFixed(2) : ''} onCommit={(v) => go({ amount_cents: num(v) })} />
          <Why r={r} n="amount" />
        </div>
        {r.kind === 'check' ? (
          <div className={'ge-field' + flagged(r, 'number')}>
            <label htmlFor="gf-number">
              Check number <Dot r={r} k="number" />
            </label>
            <ChangeInput id="gf-number" value={r.checkNumber || ''} onCommit={(v) => go({ check_number: v.trim() })} />
            <Why r={r} n="number" />
          </div>
        ) : (
          <div></div>
        )}
      </div>
      <div className="ge-row2">
        {r.kind === 'check' ? (
          <div className={'ge-field' + flagged(r, 'date')}>
            <label htmlFor="gf-cdate">
              Check date <Dot r={r} k="date" />
            </label>
            <ChangeInput id="gf-cdate" type="date" value={r.checkDate || ''} onCommit={(v) => go({ check_date: v })} />
            <Why r={r} n="date" />
          </div>
        ) : (
          <div></div>
        )}
        <div className="ge-field">
          <label htmlFor="gf-gdate">Gift date</label>
          <ChangeInput id="gf-gdate" type="date" value={r.giftDate || ''} onCommit={(v) => go({ gift_date: v })} />
        </div>
      </div>
      {r.kind === 'check' ? (
        <div className={'ge-field' + flagged(r, 'payer')}>
          <label htmlFor="gf-payer">
            Name on the check <Dot r={r} k="payer" />
          </label>
          <ChangeInput id="gf-payer" value={r.payer || ''} onCommit={(v) => go({ payer: v.trim() })} />
          <Why r={r} n="payer" />
        </div>
      ) : null}
      <div className="ge-row2 ge-row2--stack">
        <div className="ge-field">
          <label htmlFor="gf-fund">
            Fund <Dot r={r} k="designation" />
          </label>
          <ChangeInput
            id="gf-fund"
            list="ge-funds"
            autoComplete="off"
            value={r.fund ? r.fund.name : ''}
            onCommit={async (v) => {
              const cat = await api.getCatalog();
              const f = cat.funds.find((x) => x.name === v);
              if (f) go({ fund_id: f.id, fund_name: f.name });
              else geToast('Pick a fund from the list.');
            }}
          />
          <Lists catalog={catalog} />
          {d.fundSource && FSRC[d.fundSource] ? <span className="ge-src">{d.fundSource === 'expected' && r.coding && r.coding.fundReason ? 'Suggested · ' + r.coding.fundReason : 'From the ' + FSRC[d.fundSource].toLowerCase()}</span> : null}
        </div>
        <div className="ge-field">
          <label htmlFor="gf-appeal">
            Appeal <Dot r={r} k="appeal" />
          </label>
          <ChangeInput
            id="gf-appeal"
            list="ge-appeals"
            placeholder="Search appeals"
            autoComplete="off"
            value={r.appeal ? r.appeal.name : ''}
            onCommit={async (v) => {
              const cat = await api.getCatalog();
              const a = cat.appeals.find((x) => x.code + ' · ' + x.name === v || x.name === v);
              if (a) go({ appeal_id: a.id, appeal_name: a.name });
              else if (v) geToast('Pick an appeal from the list.');
            }}
          />
          {c.reason ? (
            <>
              <span className="ge-src">{c.reason}</span>
              {c.needs && sug.length ? (
                <div className="ge-cands" aria-label="Suggestions, not decided">
                  {sug}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      <div className={'ge-field' + flagged(r, 'memo')}>
        <label htmlFor="gf-memo">
          Memo <Dot r={r} k="memo" />
        </label>
        <ChangeArea id="gf-memo" value={r.memo || ''} onCommit={(v) => go({ memo: v.trim() })} />
        <Why r={r} n="memo" />
      </div>
      {r.rule === 'giving_fund' || r.soft ? (
        <div className="ge-field">
          <label>
            Recommended by (<GeTerm k="soft" label="soft credit" />)
          </label>
          {r.soft ? (
            <div className="ge-who">
              <b>{r.soft.name}</b>
            </div>
          ) : (
            <div className="ge-note">Name who recommended this gift, or choose No partner named.</div>
          )}
          <Search inputId="ge-sp" boxId="ge-sr" placeholder="Search for the recommending partner" pickAttr="data-picks" onPick={(h) => void api.save(r.id, { soft_partner_id: h.cid, soft_partner_name: h.name })} />
          <div>
            <button type="button" className="ge-btn" data-nosoft="" onClick={() => void api.save(r.id, { soft_partner_id: null, soft_partner_name: 'No partner named' })}>
              No partner named
            </button>
          </div>
        </div>
      ) : null}
      {tags.length ? <div className="ge-tags">{tags}</div> : null}
      <ActionBar api={api} r={r} />
      {approval ? <span className="ge-src">{approval}</span> : null}
      <details className="ge-details">
        <summary>What each reader saw</summary>
        <div className="ge-read" style={{ marginTop: 8 }}>
          {(r.readers || []).length ? (
            (r.readers || []).map((x, i) => (
              <div key={i}>
                <b>{x.reader === 'scout' ? 'Reader A' : 'Reader B'}</b>
                <span>
                  {x.fields
                    ? [x.fields.payer, x.fields.amountCents != null ? money(x.fields.amountCents) : null, x.fields.checkNumber && 'no. ' + x.fields.checkNumber, x.fields.checkDate, x.fields.memo && 'memo: ' + x.fields.memo, x.fields.slipAppeal && 'slip: ' + x.fields.slipAppeal]
                        .filter(Boolean)
                        .join(' · ') || 'nothing read'
                    : x.error || 'no answer'}
                </span>
              </div>
            ))
          ) : (
            <span className="ge-muted">Nothing was read.</span>
          )}
        </div>
        <div className="ge-acts">
          {r.images[0] ? (
            <button type="button" className="ge-btn" data-reread="" onClick={() => void api.reread(r)}>
              Read the photo again
            </button>
          ) : null}
          {r.kind === 'check'
            ? ENCLOSURES.map(([k, l]) => (
                <label className="ge-btn" style={{ cursor: 'pointer' }} key={k}>
                  {l}
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    data-enc={k}
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      e.target.value = '';
                      void api.addEnclosure(r, k, files);
                    }}
                  />
                </label>
              ))
            : null}
        </div>
      </details>
    </div>
  );
}
