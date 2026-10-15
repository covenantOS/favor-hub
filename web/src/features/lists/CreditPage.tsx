// Reporting > Credit and assignments (/lists/credit/): proposed credit and assignment changes waiting for approval, a look-up of one gift or
// partner, recent changes, and the apply switch for admins. Every rule is on the server (functions/_lib/lists/credit.ts); this page shows
// what the server returns and posts the person's choices.
import '@hub/styles/reports.css';
import '@hub/styles/lists.css';
import { Suspense, useRef, useState, type FormEvent } from 'react';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { creditCall, creditQuery, type Change, type CreditOverview } from './api';
import { day as dayOf, money } from './fmt';
import { Toast, useToast } from './kit';

const day = (s: unknown) => dayOf(String(s).slice(0, 10));
const STATE: Record<string, string> = { proposed: 'Waiting', approved: 'Approved', queued: 'Queued', applied: 'Applied', failed: 'Failed', rejected: 'Rejected', cancelled: 'Taken back' };
const who = (e: string | null) => (e === 'scan' ? 'Scan' : String(e || '').split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
const noRdd = (t: unknown) => String(t).replace(' (RDD)', '');

export function CreditFallback() {
  return (
    <>
      <div id="cr-app" data-api="/api/lists/credit">
        <p className="rp-note rp-loading">Loading</p>
      </div>
      <div className="rp-toast" id="cr-toast" role="status" />
    </>
  );
}

export function CreditError({ message }: { message: string }) {
  return (
    <div id="cr-app" data-api="/api/lists/credit">
      <div className="h-card ls-pad">
        <p className="rp-note">{message || 'Credit did not load.'}</p>
      </div>
    </div>
  );
}

export function CreditPage() {
  return (
    <Suspense fallback={<CreditFallback />}>
      <Credit />
    </Suspense>
  );
}

// ---- what a look-up finds ----
interface Credit { name: string; amount: number }
interface Assignment { id: string; cid: string; fid: string; name: string; type: string; from: string; to: string | null; onDate?: boolean }
interface Proposal { op: string; name: string; reason: string; fundraiserId: string; amount: number }
interface GiftFound {
  gift: { gift: { id: string; date: string; amount: number; category: string }; credits: Credit[]; assignments: Assignment[]; proposals: Proposal[]; odd: { name: string; reason: string }[] };
}
interface PartnerFound {
  partner: { assignments: Assignment[]; gifts: { id: string; date: string; amount: number; category: string; credits: Credit[] }[] };
  rid: string;
  name: string;
}
type Found = GiftFound | PartnerFound;
type View = { kind: 'empty' } | { kind: 'looking' } | { kind: 'text'; text: string } | { kind: 'matches'; matches: { rid: string; name: string; lookup?: string }[] } | { kind: 'found' };

function Credit() {
  const { data: o } = useSuspenseQuery(creditQuery);
  const qc = useQueryClient();
  const { toast, msg, on } = useToast(4200);
  const [found, setFound] = useState<Found | null>(null);
  const [view, setView] = useState<View>({ kind: 'empty' });
  const [scanning, setScanning] = useState(false);
  const q = useRef<HTMLInputElement>(null);

  /** Read the overview again. What a look-up found stays; the matches and messages of an earlier search go, as when the page redraws. */
  const load = async () => {
    await qc.invalidateQueries({ queryKey: creditQuery.queryKey });
    setView(found ? { kind: 'found' } : { kind: 'empty' });
  };

  const decide = async (c: Change, decision: 'approve' | 'reject') => {
    const note = decision === 'reject' ? window.prompt('Why is it rejected?') || '' : '';
    if (decision === 'reject' && !note) return;
    const r = await creditCall('/decide', { id: c.id, decision, note });
    if (r.ok === false) {
      toast(r.message || 'Not saved.');
      return;
    }
    toast(r.state === 'queued' ? 'Approved and queued' : r.state === 'applied' ? 'Approved and saved in Blackbaud' : r.state === 'rejected' ? 'Rejected' : 'Approved. ' + (r.note || 'Apply is off, so nothing changed in Blackbaud.'));
    void load();
  };

  const scan = async () => {
    setScanning(true);
    const r = await creditCall('/scan', { days: 45 });
    if (r.ok === false) {
      toast(r.message || 'The scan did not run.');
      setScanning(false);
      return;
    }
    setScanning(false);
    toast(r.added + ' new, ' + r.gifts + ' gifts read');
    void load();
  };

  const search = async (text: string) => {
    const r = await creditCall<{ matches: { rid: string; name: string; lookup?: string }[] }>('/lookup?q=' + encodeURIComponent(text));
    if (r.ok === false) {
      setView({ kind: 'text', text: r.message || '' });
      return;
    }
    if (!r.matches.length) {
      setView({ kind: 'text', text: 'No match' });
      return;
    }
    setView({ kind: 'matches', matches: r.matches });
  };
  const find = async (text: string) => {
    if (!text) return;
    setView({ kind: 'looking' });
    if (/^\d{4,}$/.test(text)) {
      // A gift ID and a partner lookup ID are both numbers; try the gift first, then the partner.
      const g = await creditCall<GiftFound['gift']>('/lookup?gift=' + encodeURIComponent(text));
      if (g.ok !== false && g.gift) {
        setFound({ gift: g as unknown as GiftFound['gift'] });
        setView({ kind: 'found' });
        return;
      }
    }
    await search(text);
  };
  const openPartner = async (m: { rid: string; name: string }) => {
    const p = await creditCall<PartnerFound['partner']>('/lookup?rid=' + encodeURIComponent(m.rid));
    if (p.ok === false) {
      toast(p.message || '');
      return;
    }
    setFound({ partner: p as unknown as PartnerFound['partner'], rid: m.rid, name: m.name });
    setView({ kind: 'found' });
  };
  const propose = async (body: Record<string, unknown>) => {
    const r = await creditCall('/propose', body);
    toast(r.ok === false ? r.message || '' : 'Proposed');
    if (r.ok !== false) void load();
  };

  return (
    <>
      <div id="cr-app" data-api="/api/lists/credit">
        <div className="cr-grid">
          <div className="cr-col">
            <div className="h-card cr-card">
              <div className="cr-h">
                <b>
                  Waiting for approval <small>{o.waiting.length}</small>
                </b>
                {o.mayApprove ? (
                  <button type="button" className="ls-quiet" id="cr-scan" disabled={scanning} onClick={scan}>
                    {scanning ? 'Scanning' : 'Scan the last 45 days'}
                  </button>
                ) : null}
              </div>
              {o.waiting.length ? o.waiting.map((c) => <ChangeRow key={c.id} c={c} act={o.mayApprove && c.proposedBy !== o.me} onDecide={decide} />) : <p className="cr-none">Nothing waiting</p>}
            </div>
            <div className="h-card cr-card">
              <div className="cr-h">
                <b>Recent changes</b>
              </div>
              {o.recent.length ? o.recent.slice(0, 15).map((c) => <ChangeRow key={c.id} c={c} act={false} onDecide={decide} />) : <p className="cr-none">None yet</p>}
            </div>
          </div>
          <div className="cr-col">
            <div className="h-card cr-card">
              <div className="cr-h">
                <b>Look up</b>
              </div>
              <form
                className="cr-find"
                id="cr-form"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  void find((q.current?.value || '').trim());
                }}
              >
                <input type="text" id="cr-q" ref={q} placeholder="Partner name or ID, or gift ID" aria-label="Partner name or ID, or gift ID" autoComplete="off" />
                <button type="submit" className="h-btn h-btn--ghost h-btn--sm">
                  Find
                </button>
              </form>
              <div id="cr-out">
                {view.kind === 'looking' ? <p className="cr-none">Looking</p> : null}
                {view.kind === 'text' ? <p className="cr-none">{view.text}</p> : null}
                {view.kind === 'matches'
                  ? view.matches.map((m) => (
                      <button key={m.rid} type="button" className="ls-opt" data-rid={m.rid} onClick={() => openPartner(m)}>
                        <b>{m.name}</b>
                        <small>{m.lookup || ''}</small>
                      </button>
                    ))
                  : null}
                {view.kind === 'found' && found ? <FoundView f={found} onFind={find} onPropose={propose} /> : null}
              </div>
            </div>
            {o.admin ? <ApplyCard o={o} toast={toast} load={load} /> : null}
          </div>
        </div>
      </div>
      <Toast id="cr-toast" msg={msg} on={on} />
    </>
  );
}

function ChangeRow({ c, act, onDecide }: { c: Change; act: boolean; onDecide: (c: Change, d: 'approve' | 'reject') => void }) {
  const ch = c.change || {};
  const what = c.kind === 'credit' ? (ch.op === 'add' ? 'Add credit' : 'Remove credit') : ch.op === 'add' ? 'Add assignment' : 'End assignment';
  const bits: string[] = [];
  if (c.kind === 'credit') {
    bits.push(money(ch.amount));
    bits.push('gift ' + c.giftId);
    if (ch.closedMonth) bits.push('closed month');
  } else if (ch.type) bits.push(noRdd(ch.type));
  const meta = [c.reason, who(c.proposedBy) + ', ' + day(c.proposedAt)];
  if (c.decidedBy && c.state !== 'proposed') meta.push(who(c.decidedBy) + ' ' + String(STATE[c.state] || c.state).toLowerCase());
  return (
    <div className="cr-row" data-id={c.id}>
      <div className="cr-main">
        <b>{what + ' · ' + c.fundraiser}</b>
        <span className="cr-fact2">{bits.join(' · ')}</span>
        <span>{meta.filter(Boolean).join(' · ')}</span>
        {c.result ? <span className="cr-res">{c.result}</span> : null}
      </div>
      {act ? (
        <div className="cr-acts">
          <button type="button" className="ls-link" data-act="approve" onClick={() => onDecide(c, 'approve')}>
            Approve
          </button>
          <button type="button" className="ls-link cr-no" data-act="reject" onClick={() => onDecide(c, 'reject')}>
            Reject
          </button>
        </div>
      ) : (
        <span className={'ls-st ls-st--' + c.state}>{STATE[c.state] || c.state}</span>
      )}
    </div>
  );
}

function AssignLines({ list, marks, onEnd }: { list: Assignment[]; marks: boolean; onEnd: (a: Assignment) => void }) {
  if (!list.length) return <p className="cr-none">None</p>;
  return (
    <>
      {list.map((a) => (
        <div className="cr-line" key={a.id}>
          <span>{a.name + ' · ' + noRdd(a.type) + ' · ' + day(a.from) + ' to ' + (a.to ? day(a.to) : 'now')}</span>
          {marks && a.onDate ? (
            <b className="cr-on">On the gift date</b>
          ) : !a.to && !marks ? (
            <button type="button" className="ls-link" data-end={a.id} data-rec={a.cid} data-fr={a.fid} onClick={() => onEnd(a)}>
              End
            </button>
          ) : null}
        </div>
      ))}
    </>
  );
}

function FoundView({ f, onFind, onPropose }: { f: Found; onFind: (q: string) => void; onPropose: (body: Record<string, unknown>) => void }) {
  const op = useRef<HTMLSelectElement>(null);
  const fid = useRef<HTMLInputElement>(null);
  const why = useRef<HTMLInputElement>(null);
  const end = (a: Assignment) => {
    const reason = window.prompt('Why does this assignment end?') || '';
    if (!reason) return;
    onPropose({ kind: 'assignment', op: 'end', recordId: a.cid, assignmentId: a.id, fundraiserId: a.fid, reason });
  };
  if ('gift' in f) {
    const g = f.gift;
    return (
      <>
        <div className="cr-fact">
          <b>{'Gift ' + g.gift.id}</b>
          <span>{day(g.gift.date) + ' · ' + money(g.gift.amount) + ' · ' + (g.gift.category || 'No category')}</span>
        </div>
        <div className="cr-sub">Credit</div>
        {g.credits.length ? (
          g.credits.map((c, i) => (
            <div className="cr-line" key={i}>
              <span>{c.name}</span>
              <b>{money(c.amount)}</b>
            </div>
          ))
        ) : (
          <p className="cr-none">No fundraiser credit</p>
        )}
        <div className="cr-sub">Assignments</div>
        <AssignLines list={g.assignments} marks onEnd={end} />
        {g.proposals.length ? (
          <>
            <div className="cr-sub">By the rules</div>
            {g.proposals.map((p, i) => (
              <div className="cr-line" key={i}>
                <span>{(p.op === 'add' ? 'Add ' : 'Remove ') + p.name + ' · ' + p.reason}</span>
                <button type="button" className="ls-link" data-prop={i} onClick={() => onPropose({ kind: 'credit', giftId: g.gift.id, fundraiserId: p.fundraiserId, op: p.op, amount: p.amount, reason: p.reason })}>
                  Propose
                </button>
              </div>
            ))}
          </>
        ) : null}
        {g.odd.length ? (
          <>
            <div className="cr-sub">To look at</div>
            {g.odd.map((x, i) => (
              <div className="cr-line" key={i}>
                <span>{x.name + ' · ' + x.reason}</span>
              </div>
            ))}
          </>
        ) : null}
        <div className="cr-sub">Suggest a change</div>
        <div className="cr-man">
          <select id="cr-op" ref={op}>
            <option value="add">Add credit</option>
            <option value="remove">Remove credit</option>
          </select>
          <input type="text" id="cr-fid" ref={fid} placeholder="Fundraiser ID" inputMode="numeric" />
          <input type="text" id="cr-why" ref={why} placeholder="Reason" />
          <button
            type="button"
            className="h-btn h-btn--ghost h-btn--sm"
            id="cr-go"
            onClick={() => onPropose({ kind: 'credit', giftId: g.gift.id, fundraiserId: (fid.current?.value || '').trim(), op: op.current?.value, reason: why.current?.value || '' })}
          >
            Propose
          </button>
        </div>
      </>
    );
  }
  const p = f.partner;
  return (
    <>
      <div className="cr-fact">
        <b>{f.name}</b>
      </div>
      <div className="cr-sub">Assignments</div>
      <AssignLines list={p.assignments} marks={false} onEnd={end} />
      <div className="cr-sub">Recent gifts</div>
      {p.gifts.length ? (
        p.gifts.slice(0, 12).map((g) => (
          <button type="button" className="cr-line cr-gift" data-gid={g.id} key={g.id} onClick={() => onFind(g.id)}>
            <span>{day(g.date) + ' · ' + (g.category || 'No category')}</span>
            <b>{money(g.amount)}</b>
            <small>{g.credits.map((c) => c.name).join(', ') || 'No credit'}</small>
          </button>
        ))
      ) : (
        <p className="cr-none">No gifts</p>
      )}
    </>
  );
}

/** The apply switch (admins): whether approved changes go to Blackbaud, the one record they are limited to while testing, and who else may approve. */
function ApplyCard({ o, toast, load }: { o: CreditOverview; toast: (m: string) => void; load: () => Promise<void> }) {
  const lim = useRef<HTMLInputElement>(null);
  const app = useRef<HTMLInputElement>(null);
  return (
    <div className="h-card cr-card" key={o.testLimit + '|' + (o.approvers || '')}>
      <div className="cr-h">
        <b>Apply</b>
        <span className={'ls-st ls-st--' + (o.apply ? 'applied' : 'rejected')}>{o.apply ? 'On' : 'Off'}</span>
      </div>
      <div className="cr-set">
        <label>
          Only record
          <input type="text" id="cr-lim" ref={lim} defaultValue={o.testLimit} placeholder="All records" />
        </label>
        <label>
          Also may approve
          <input type="text" id="cr-approvers" ref={app} defaultValue={o.approvers || ''} placeholder="email, email" />
        </label>
        <div className="ls-prow">
          <button
            type="button"
            className="h-btn h-btn--ghost h-btn--sm"
            id="cr-save"
            onClick={async () => {
              const r = await creditCall('/setting', { testLimit: lim.current?.value, approvers: app.current?.value });
              toast(r.ok === false ? r.message || '' : 'Saved');
              void load();
            }}
          >
            Save
          </button>
          <button
            type="button"
            className="ls-quiet"
            id="cr-flip"
            onClick={async () => {
              if (!o.apply && !window.confirm('Approved changes will go to Blackbaud' + (o.testLimit ? ' for record ' + o.testLimit + ' only' : ' for every record') + '. Turn apply on?')) return;
              const r = await creditCall('/setting', { apply: o.apply ? 'off' : 'on' });
              toast(r.ok === false ? r.message || '' : 'Apply is ' + (r.apply ? 'on' : 'off'));
              void load();
            }}
          >
            {'Turn apply ' + (o.apply ? 'off' : 'on')}
          </button>
        </div>
      </div>
    </div>
  );
}
