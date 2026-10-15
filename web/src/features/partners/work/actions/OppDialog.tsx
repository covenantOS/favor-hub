// The opportunity dialog: open a row to edit it, or start a new one. Port of dlgOpp in public/js/work-edit.js. A change goes to Blackbaud as
// one batch (op opp_edit or opp_new) through sendChange, and only the fields that changed are sent. The edit panel and the Opportunities
// list both open it through openOpp.
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { wcApi, asParam } from './api';
import { getClient, sendChange, toast } from './engine';
import { openEditPanel } from './EditPanel';
import { PartnerPicker } from './PartnerPicker';
import { boardQuery, codesQuery, oppsQuery, wcKeys, type OppRow } from './queries';
import { closeDialog, openDialog } from './store';
import { useWork } from './useWork';
import { Dialog, DialogHead, Skel } from './ui';

export interface OppPre {
  cid?: string;
  name?: string;
  link?: string;
  after?: () => void;
}

interface Linked {
  id: string;
  summary: string;
  type: string;
  date: string;
  category: string;
  done: boolean;
}

/** Open the dialog for an existing opportunity, or a new one when o is left out. pre fills the partner and links an action to the new one. */
export function openOpp(o?: OppRow | null, pre: OppPre = {}): void {
  openDialog(<OppDialog o={o || undefined} pre={pre} />);
}

// Dialog.focus looks for [autofocus]; React's autoFocus prop does not write the attribute, so set it by hand.
const autofocus = (el: HTMLElement | null) => el?.setAttribute('autofocus', '');

function OppDialog({ o, pre }: { o?: OppRow; pre: OppPre }) {
  return (
    <Suspense
      fallback={
        <Dialog cls="ep-dlg" label={o ? o.name : 'New opportunity'}>
          <DialogHead title={o ? o.name : 'New opportunity'} />
          <div className="wc-dlg__body">
            <Skel rows={4} />
          </div>
        </Dialog>
      }
    >
      <OppForm o={o} pre={pre} />
    </Suspense>
  );
}

const amount = (n: number | undefined) => (n ? String(n) : '');

function OppForm({ o, pre }: { o?: OppRow; pre: OppPre }) {
  const as = asParam();
  const isNew = !o;
  const codes = useSuspenseQuery(codesQuery(as || undefined)).data;
  const names = useSuspenseQuery(oppsQuery(as || undefined)).data.names || {};
  const board = useSuspenseQuery(boardQuery(as || undefined)).data;
  const wc = useWork(board);
  const C = codes.codes || {};
  const myFid = codes.me?.fid || null;
  const purposes = C.oppPurposes || [];
  const statuses = C.oppStatuses || [];
  const v: OppRow = o || {
    id: '',
    cid: pre.cid || '',
    name: '',
    status: 'Planned',
    purpose: purposes.includes('Engagement') ? 'Engagement' : purposes[0] || '',
    ask: 0,
    expected: 0,
    funded: 0,
    askDate: '',
    expectedDate: '',
    fundedDate: '',
    deadline: '',
    inactive: false,
    summary: '',
    fundraisers: myFid ? [myFid] : [],
  };
  const [cid, setCid] = useState(v.cid);
  const [pname, setPname] = useState(pre.name || names[v.cid] || '');
  const [fr, setFr] = useState<string[]>(v.fundraisers.slice());
  const [f, setF] = useState({
    name: v.name,
    status: v.status || '',
    purpose: v.purpose,
    ask_amount: amount(v.ask),
    expected_amount: amount(v.expected),
    funded_amount: amount(v.funded),
    ask_date: v.askDate,
    expected_date: v.expectedDate,
    funded_date: v.fundedDate,
    deadline: v.deadline,
    inactive: v.inactive,
    summary: v.summary,
  });
  const set = <K extends keyof typeof f>(k: K, val: (typeof f)[K]) => setF((x) => ({ ...x, [k]: val }));
  const nameRef = useRef<HTMLInputElement>(null);

  // The actions linked to this opportunity.
  const [linked, setLinked] = useState<Linked[] | null>(null);
  useEffect(() => {
    if (!o) return;
    let live = true;
    wcApi<{ actions: Linked[] }>('/api/work/opps?linked=' + encodeURIComponent(o.id))
      .then((d) => live && setLinked(d.actions || []))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [o]);

  const staff = Object.keys(board.people)
    .filter((k) => wc.live(k) && wc.mayAssign(k))
    .sort((a, b) => wc.P(a).n.localeCompare(wc.P(b).n));
  const purposeList = purposes.includes(f.purpose) || !f.purpose ? purposes : [...purposes, f.purpose];

  const save = () => {
    const out: Record<string, unknown> = { name: f.name, summary: f.summary, fundraisers: fr, status: f.status, purpose: f.purpose, ask_amount: f.ask_amount, expected_amount: f.expected_amount, funded_amount: f.funded_amount, ask_date: f.ask_date, expected_date: f.expected_date, funded_date: f.funded_date, deadline: f.deadline, inactive: f.inactive };
    if (o) {
      // Send only what changed.
      const was: Record<string, unknown> = { name: o.name, summary: o.summary, status: o.status, purpose: o.purpose, ask_amount: String(o.ask || ''), expected_amount: String(o.expected || ''), funded_amount: String(o.funded || ''), ask_date: o.askDate, expected_date: o.expectedDate, funded_date: o.fundedDate, deadline: o.deadline, inactive: o.inactive, fundraisers: o.fundraisers };
      for (const k of Object.keys(out)) if (JSON.stringify(was[k] ?? '') === JSON.stringify(out[k] ?? '')) delete out[k];
      if (!Object.keys(out).length) {
        closeDialog();
        return;
      }
    } else if (!cid) {
      toast('Pick the partner first.');
      return;
    }
    closeDialog();
    const params = o ? { op: 'opp_edit', opp_id: o.id, opp: out } : { op: 'opp_new', cid, opp: out, ids: pre.link ? [pre.link] : [] };
    const qc = getClient();
    const key = wcKeys.opps(as);
    const reload = () => qc.invalidateQueries({ queryKey: key });
    // Optimistic: the list shows the change at once.
    if (o) {
      qc.setQueryData<{ rows: OppRow[]; names: Record<string, string> }>(key, (old) =>
        old ? { ...old, rows: old.rows.map((r) => (r.id === o.id ? { ...r, name: (out.name as string) ?? r.name, status: (out.status as string) ?? r.status, inactive: (out.inactive as boolean) ?? r.inactive } : r)) } : old
      );
    }
    void sendChange(params, { label: o ? 'Saved the opportunity' : `Added the opportunity ${out.name}`, revert: reload, after: reload }).then(() => {
      if (pre.after) pre.after();
    });
  };

  const title = isNew ? 'New opportunity' : v.name;
  return (
    <Dialog cls="ep-dlg" label={title}>
      <DialogHead title={title} sub={isNew ? undefined : pname} />
      <div className="wc-dlg__body">
        {isNew ? (
          <div className="wc-field">
            <span className="lab">Partner</span>
            <div className="ep-people">{cid ? <span className="ep-person">{pname}</span> : null}</div>
            {cid ? null : (
              <PartnerPicker
                autoFocus
                onPick={(h) => {
                  setCid(h.cid);
                  setPname(h.name);
                  setTimeout(() => nameRef.current?.focus(), 0);
                }}
              />
            )}
          </div>
        ) : null}
        <div className="wc-field">
          <label className="lab" htmlFor="op-name">
            Name
          </label>
          <input
            type="text"
            id="op-name"
            ref={(el) => {
              nameRef.current = el;
              if (!isNew || cid) autofocus(el);
            }}
            maxLength={255}
            value={f.name}
            placeholder="For example: 2026 year-end gift"
            onChange={(e) => set('name', e.target.value)}
          />
        </div>
        <div className="wc-row2">
          <div className="wc-field">
            <span className="lab">Status</span>
            <select aria-label="Status" value={f.status} onChange={(e) => set('status', e.target.value)}>
              <option value="">No status</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="wc-field">
            <span className="lab">Purpose</span>
            <select aria-label="Purpose" value={f.purpose} onChange={(e) => set('purpose', e.target.value)}>
              {purposeList.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="wc-row3">
          {(
            [
              ['Ask', 'ask_amount'],
              ['Expected', 'expected_amount'],
              ['Funded', 'funded_amount'],
            ] as const
          ).map(([label, k]) => (
            <div className="wc-field" key={k}>
              <span className="lab">{label}</span>
              <input type="text" inputMode="decimal" aria-label={label} value={f[k]} placeholder="$" onChange={(e) => set(k, e.target.value)} />
            </div>
          ))}
        </div>
        <div className="wc-row3">
          {(
            [
              ['Asked on', 'ask_date'],
              ['Expected by', 'expected_date'],
              ['Funded on', 'funded_date'],
            ] as const
          ).map(([label, k]) => (
            <div className="wc-field" key={k}>
              <span className="lab">{label}</span>
              <input type="date" aria-label={label} value={f[k]} onChange={(e) => set(k, e.target.value)} />
            </div>
          ))}
        </div>
        <div className="wc-row2">
          <div className="wc-field">
            <span className="lab">Deadline</span>
            <input type="date" aria-label="Deadline" value={f.deadline} onChange={(e) => set('deadline', e.target.value)} />
          </div>
          <div className="wc-field">
            <span className="lab"></span>
            <label className="wc-toggle">
              <input type="checkbox" checked={f.inactive} onChange={(e) => set('inactive', e.target.checked)} />
              Inactive
            </label>
          </div>
        </div>
        <div className="wc-field">
          <span className="lab">Fundraisers</span>
          <div>
            <div className="ep-people">
              {fr.map((k) => (
                <span key={k} className={'ep-person' + (wc.live(k) ? '' : ' is-left')}>
                  {wc.P(k).n}
                  {wc.goneTag(k)}
                  <button type="button" aria-label={'Remove ' + wc.P(k).n} onClick={() => setFr(fr.filter((x) => x !== k))}>
                    ×
                  </button>
                </span>
              ))}
              <select
                className="ep-addperson"
                aria-label="Add a fundraiser"
                value=""
                onChange={(e) => {
                  if (e.target.value) setFr([...fr, e.target.value]);
                }}
              >
                <option value="">Add a person…</option>
                {staff
                  .filter((k) => !fr.includes(k))
                  .map((k) => (
                    <option key={k} value={k}>
                      {wc.P(k).n}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        </div>
        <div className="wc-field">
          <label className="lab" htmlFor="op-sum">
            Notes on it
          </label>
          <textarea id="op-sum" rows={3} value={f.summary} onChange={(e) => set('summary', e.target.value)} />
        </div>
        {isNew ? null : (
          <div className="wc-field">
            <span className="lab">Linked actions</span>
            <div>
              {linked === null ? (
                <div className="h-skel" style={{ height: 60, borderRadius: 12 }} />
              ) : linked.length ? (
                <ul className="ep-linked">
                  {linked.map((x) => (
                    <li key={x.id}>
                      <button
                        type="button"
                        className="wc-linkbtn"
                        onClick={() => {
                          closeDialog();
                          setTimeout(() => openEditPanel(x.id), 240);
                        }}
                      >
                        {x.summary || x.type}
                      </button>
                      <span className="wc-sub">
                        {wc.fd(x.date)} · {x.category}
                        {x.done ? ' · done' : ' · open'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="wc-note">No linked actions.</p>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="wc-dlg__foot">
        <span className="wc-cost">{isNew ? null : (
            <Link to="/work/partner/$id/" params={{ id: v.cid }} onClick={closeDialog}>
              Partner page
            </Link>
          )}</span>
        <button type="button" className="h-btn h-btn--ghost" onClick={closeDialog}>
          Cancel
        </button>
        <button type="button" className="h-btn h-btn--primary" onClick={save}>
          {isNew ? 'Add opportunity' : 'Save'}
        </button>
      </div>
    </Dialog>
  );
}
