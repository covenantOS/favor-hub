// The cells of an Entry row: the partner (matched, to pick, or to find), the date, how it went out, the state, the summary, and the tags
// with the ask. They draw the classic classes (wc-pname, wc-match, wc-how, wc-tt ...), so the rows look the way the classic page's do.
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Ic } from '../ui';
import { FindBox } from './FindBox';
import { MATCH_HOW, SOURCE_LABEL, type RowState } from './logic';
import { HOWS, TAGS, type EntryPartner, type EntryRow } from './types';

export interface RowActions {
  edit: (id: string, f: { local?: Partial<EntryRow>; server: Record<string, unknown> }, soon?: boolean) => void;
  pick: (id: string, cid: string) => void;
  unpick: (id: string) => void;
  addPartner: (id: string) => void;
}

const PartnerLink = ({ cid, children }: { cid: string; children: string }) => (
  <Link to="/work/partner/$id/" params={{ id: cid }} className="wc-ppage wc-ppage--name" data-partner-id={cid}>
    {children}
  </Link>
);

export function PartnerCell(p: { r: EntryRow; st: RowState; d: EntryPartner | null; locked: boolean; ownerFirst: string; ownerFid: string; canAdd: boolean; partnerOf: (cid: string) => EntryPartner | null; nameOf: (fid: string) => string; act: RowActions }) {
  const { r, d, locked, act } = p;
  const how = r.how === 'name_portfolio' ? "name, in " + p.ownerFirst + "'s portfolio" : MATCH_HOW[r.how] || 'matched by name';
  if (r.cid && d)
    return (
      <>
        <b className="wc-pname">
          <PartnerLink cid={r.cid}>{d.n}</PartnerLink>
        </b>
        <span className="wc-match">
          {d.loc || 'No city on file'} · {d.lk} · <i>{how}</i>
          {locked ? null : (
            <span style={{ whiteSpace: 'nowrap' }}>
              {' · '}
              <button type="button" className="wc-linkbtn" onClick={() => act.unpick(r.id)}>
                Change
              </button>
            </span>
          )}
        </span>
      </>
    );
  if (r.cid)
    return (
      <>
        <b className="wc-pname">
          <PartnerLink cid={r.cid}>{r.name}</PartnerLink>
        </b>
        <span className="wc-match">
          Partner {r.cid} · <i>{how}</i>
          {locked ? null : (
            <>
              {' · '}
              <button type="button" className="wc-linkbtn" onClick={() => act.unpick(r.id)}>
                Change
              </button>
            </>
          )}
        </span>
      </>
    );
  if (r.cands.length)
    return (
      <>
        <b className="wc-pname">{r.name}</b>
        <span className="wc-match">{r.cands.length === 1 ? 'One record has this name. Is it the partner?' : r.cands.length + ' records match. Pick one:'}</span>
        <div className="wc-pickp">
          {r.cands.map((c) => {
            const x = p.partnerOf(c) || { n: 'Record ' + c, loc: '', lk: '', hold: [] };
            return (
              <button key={c} type="button" onClick={() => act.pick(r.id, c)}>
                {x.n}
                <span>
                  {x.loc || 'no city'} · {x.lk}
                  {x.hold.length ? ' · ' + p.nameOf(x.hold[0]) : ''}
                </span>
              </button>
            );
          })}
        </div>
      </>
    );
  return (
    <>
      <b className="wc-pname">{r.name}</b>
      <span className="wc-match">
        {r.isNew && /y/i.test(r.isNew) ? 'Marked new on the sheet. ' : ''}No record found by {r.email ? 'email or ' : ''}name.
      </span>
      <FindBox rowId={r.id} name={r.name} owner={p.ownerFid} nameOf={p.nameOf} onPick={(cid) => act.pick(r.id, cid)} />
      {p.canAdd ? (
        <div className="wc-addp">
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => act.addPartner(r.id)}>
            <Ic n="user" />
            Add partner
          </button>
        </div>
      ) : null}
    </>
  );
}

export function DateCell({ r, locked, act }: { r: EntryRow; locked: boolean; act: RowActions }) {
  // The box keeps what is typed; the row changes once the date is whole.
  const [v, setV] = useState(r.date);
  useEffect(() => setV(r.date), [r.date]);
  return (
    <>
      <input
        className="cell"
        type="date"
        value={v}
        disabled={locked}
        aria-label="Date of the contact"
        onChange={(e) => {
          const x = e.target.value;
          setV(x);
          if (/^\d{4}-\d{2}-\d{2}$/.test(x) && x >= '2000-01-01') act.edit(r.id, { local: { date: x }, server: { contact_date: x } });
        }}
      />
      <span className="wc-sub">{SOURCE_LABEL(r)}</span>
    </>
  );
}

export function HowCell({ r, locked, act }: { r: EntryRow; locked: boolean; act: RowActions }) {
  return (
    <>
      <div className="wc-hows" role="group" aria-label="How">
        {HOWS.map(([k, l]) => (
          <button
            key={k}
            type="button"
            className={'wc-how' + (r.ch === k ? ' is-on' : '')}
            disabled={locked}
            onClick={() => {
              const v = r.ch === k ? '' : k;
              act.edit(r.id, { local: { ch: v }, server: { channel: v } });
            }}
          >
            {l}
          </button>
        ))}
      </div>
      {r.act && !r.ch ? <span className="wc-sub">The sheet says “{r.act.slice(0, 40)}”</span> : null}
    </>
  );
}

export function StateCell({ st }: { st: RowState }) {
  return (
    <>
      <span className={'wc-state wc-state--' + (st.k === 'saving' || st.k === 'queued' ? 'dup' : st.k)} title={st.note || ''}>
        {st.k === 'saving' ? <span className="wc-spin" /> : null}
        {st.l}
      </span>
      {st.note ? <small>{st.note}</small> : null}
    </>
  );
}

export function SumCell({ r, locked, act }: { r: EntryRow; locked: boolean; act: RowActions }) {
  return (
    <>
      <input className="cell" type="text" maxLength={255} value={r.sum} title={r.notes} disabled={locked} aria-label="Summary" placeholder="Summary" onChange={(e) => act.edit(r.id, { local: { sum: e.target.value }, server: { summary: e.target.value } }, true)} />
      <div className="notes" title={r.notes}>
        {r.notes || 'No notes on the sheet'}
      </div>
    </>
  );
}

export function TagsCell({ r, locked, act }: { r: EntryRow; locked: boolean; act: RowActions }) {
  return (
    <div className="wc-ttog">
      {TAGS.map(([k, l]) => (
        <button
          key={k}
          type="button"
          className={'wc-tt' + (r.tags.includes(k) ? ' is-on' : '')}
          disabled={locked}
          onClick={() => {
            const tags = r.tags.includes(k) ? r.tags.filter((x) => x !== k) : r.tags.concat([k]);
            act.edit(r.id, { local: { tags }, server: { tags } });
          }}
        >
          {l}
        </button>
      ))}
      <label className="wc-ask">
        Ask $
        <input type="text" inputMode="decimal" value={r.ask} disabled={locked} aria-label="Amount of ask" onChange={(e) => act.edit(r.id, { local: { ask: e.target.value }, server: { ask_amount: e.target.value } }, true)} />
      </label>
    </div>
  );
}
