// Batches: the person's own batches and the ones waiting for a second look. The enterer sends a batch for approval; a second person approves it,
// and approving posts every gift to Blackbaud. A gift that Blackbaud turns down stays in the batch with the reason, and Try again posts it after a fix.
import { Suspense, useState } from 'react';
import type { OgBatchRow, OgGift, OgIndex } from '@shared/schemas';
import { EntityChip } from '@/features/entity/EntityChip';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { dayKey, money2 } from '@/lib/format';
import { uploadLetter, useOgActions, useOgBatch } from './data';

export const STATUS_LABEL: Record<string, string> = {
  open: 'Entering',
  waiting: 'Waiting for a second look',
  posting: 'Posting to Blackbaud',
  posted: 'Approved and posted',
  needs_person: 'A gift needs a person',
};

const KIND: Record<string, string> = { daf: 'DAF', foundation: 'Foundation', wire: 'Wire', stock: 'Stock', phone: 'Phone' };

function GiftLine({ g, batchStatus, canFix, onEdit }: { g: OgGift; batchStatus: string; canFix: boolean; onEdit: (g: OgGift) => void }) {
  const act = useOgActions();
  const [err, setErr] = useState('');
  const editable = (batchStatus === 'open' && g.mine) || (batchStatus === 'needs_person' && g.status === 'failed' && canFix);
  const addLetter = async (file: File | undefined) => {
    if (!file) return;
    setErr('');
    try {
      await uploadLetter(g.id, file);
      act.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <li className={'og-gift' + (g.status === 'failed' ? ' is-bad' : '')}>
      <div className="og-gift__top">
        <span className="og-gift__who">
          {g.partnerId ? <EntityChip kind="partner" id={g.partnerId} label={g.partnerName} /> : <i>Not picked yet</i>}
          <small>
            {KIND[g.kind]}
            {g.fundNamed ? ` · ${g.fundNamed}` : ''}
          </small>
        </span>
        <b className="og-amt">{money2(g.amountCents / 100)}</b>
      </div>
      <div className="og-gift__meta">
        <span>{g.giftDate ? dayKey(g.giftDate + 'T12:00:00Z') : 'No date'}</span>
        <span>{g.fundName || 'No fund'}</span>
        <span>{g.appealName || 'No appeal'}</span>
        {g.softPartnerId ? (
          <span>
            Soft credit to <EntityChip kind="partner" id={g.softPartnerId} label={g.softPartnerName} />
          </span>
        ) : g.noSoft ? (
          <span>No partner named</span>
        ) : null}
        <span className={'og-tag og-tag--' + g.letter}>
          {{ attached: 'Letter attached', pending: 'Letter attaches on approval', failed: 'Letter did not attach', needed: 'Letter needed', none: 'No letter' }[g.letter] || ''}
        </span>
        {g.tributeKind ? (
          <span>
            {g.tributeKind === 'honor' ? 'In honor of' : 'In memory of'} {g.tributeName}
            {g.tributeNotify ? `, notify ${g.tributeNotify}` : ''}
          </span>
        ) : null}
        {g.bbGiftId ? <span>Blackbaud gift {g.bbGiftId}</span> : null}
      </div>
      {g.blockers.length && batchStatus === 'open' ? <ul className="og-blockers">{g.blockers.map((b) => <li key={b}>{b}</li>)}</ul> : null}
      {g.dup && g.dup.decision === null && batchStatus === 'open' ? (
        <div className="og-dup">
          <span>{g.dup.message}</span>
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => act.editGift.mutate({ id: g.id, dupDecision: 'keep' })}>
            It is a different gift
          </button>
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => act.removeGift.mutate(g.id)}>
            Remove this one
          </button>
        </div>
      ) : null}
      {g.error ? (
        <p className="og-err">
          {g.status === 'check' ? 'Blackbaud did not answer, so FavorOS will look for the gift before it tries again. ' : ''}
          {g.error}
          {g.retryAt ? ` It tries again after ${new Date(g.retryAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.` : ''}
        </p>
      ) : null}
      {err ? <p className="og-err">{err}</p> : null}
      <div className="og-gift__acts">
        {editable ? (
          <button type="button" className="og-link" onClick={() => onEdit(g)}>
            Change
          </button>
        ) : null}
        {batchStatus === 'open' && g.mine ? (
          <button type="button" className="og-link" onClick={() => act.removeGift.mutate(g.id)}>
            Remove
          </button>
        ) : null}
        {g.letter !== 'attached' && g.status === 'posted' ? (
          <label className="og-link og-filelink">
            Add the letter
            <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => void addLetter(e.target.files?.[0])} />
          </label>
        ) : null}
        {g.letter !== 'none' && g.letter !== 'needed' ? (
          <a className="og-link" href={`/api/other-gifts/gifts/${g.id}/letter`} target="_blank" rel="noreferrer">
            Open the letter
          </a>
        ) : null}
      </div>
    </li>
  );
}

function BatchLoaded({ id, me, onEdit }: { id: string; me: OgIndex['me']; onEdit: (g: OgGift) => void }) {
  const { data } = useOgBatch(id);
  const act = useOgActions();
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState('');
  const { batch, gifts, approve } = data;
  const allReady = gifts.length > 0 && gifts.every((g) => g.blockers.length === 0);
  const press = async (action: 'submit' | 'withdraw' | 'approve' | 'retry' | 'remove') => {
    setErr('');
    try {
      await act.step.mutateAsync({ id, action });
      setConfirm(false);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const busy = act.step.isPending;
  return (
    <div className="og-batch">
      <div className="og-batch__head">
        <div>
          <h3>{batch.name}</h3>
          <p>
            {batch.gifts} {batch.gifts === 1 ? 'gift' : 'gifts'}, {money2(batch.cents / 100)}. Entered by {batch.createdBy}
            {batch.approvedBy ? `, approved by ${batch.approvedBy}` : ''}.
          </p>
        </div>
        <span className={'og-status og-status--' + batch.status}>{STATUS_LABEL[batch.status] || batch.status}</span>
      </div>

      {batch.status === 'posting' ? (
        <p className="og-note" role="status">
          Posting to Blackbaud: {batch.posted} of {batch.gifts} done.
        </p>
      ) : null}

      <ul className="og-gifts">
        {gifts.map((g) => (
          <GiftLine key={g.id} g={g} batchStatus={batch.status} canFix={batch.iEntered || me.canApprove || me.admin} onEdit={onEdit} />
        ))}
        {!gifts.length ? <li className="og-none">No gifts yet. Add one on the left.</li> : null}
      </ul>

      {err ? <p className="og-err" role="alert">{err}</p> : null}

      {batch.status === 'open' && batch.mine ? (
        <div className="og-actions">
          <button type="button" className="h-btn h-btn--primary" disabled={!allReady || busy} onClick={() => void press('submit')}>
            Send for a second look
          </button>
          <button type="button" className="h-btn h-btn--ghost" disabled={busy} onClick={() => void press('remove')}>
            Remove the batch
          </button>
          {!allReady && gifts.length ? <small className="og-hint">Every gift needs its fixes first.</small> : null}
        </div>
      ) : null}

      {batch.status === 'waiting' ? (
        <div className="og-approve">
          {approve.allowed ? (
            confirm ? (
              <div className="og-confirm" role="alertdialog" aria-label="Approve and post">
                <p>
                  Post {batch.gifts} {batch.gifts === 1 ? 'gift' : 'gifts'}, {money2(batch.cents / 100)}, to Blackbaud as {me.name}&rsquo;s approval? Each gift posts once, with its soft credit.
                </p>
                <div className="og-actions">
                  <button type="button" className="h-btn h-btn--primary" disabled={busy} onClick={() => void press('approve')}>
                    {busy ? 'Posting' : 'Approve and post'}
                  </button>
                  <button type="button" className="h-btn h-btn--ghost" disabled={busy} onClick={() => setConfirm(false)}>
                    Not yet
                  </button>
                </div>
              </div>
            ) : (
              <div className="og-actions">
                <button type="button" className="h-btn h-btn--primary" onClick={() => setConfirm(true)}>
                  Approve this batch
                </button>
              </div>
            )
          ) : (
            <p className="og-note">{approve.why}</p>
          )}
          {batch.mine ? (
            <div className="og-actions">
              <button type="button" className="h-btn h-btn--ghost" disabled={busy} onClick={() => void press('withdraw')}>
                Take it back to change a gift
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {batch.status === 'needs_person' ? (
        <div className="og-actions">
          <button type="button" className="h-btn h-btn--primary" disabled={busy} onClick={() => void press('retry')}>
            {busy ? 'Trying' : 'Try again'}
          </button>
          <small className="og-hint">Change the gift Blackbaud turned down, then try again. The gifts that posted stay posted.</small>
        </div>
      ) : null}

      {batch.status === 'posted' ? <p className="og-ok">Every gift is in Blackbaud. The 6 AM gift phase sets constituency and fundraiser credit.</p> : null}
    </div>
  );
}

export function BatchDetail({ id, me, onEdit }: { id: string; me: OgIndex['me']; onEdit: (g: OgGift) => void }) {
  return (
    <ErrorBoundary label="This batch did not load." className="og-err">
      <Suspense fallback={<div className="og-skel" aria-busy="true" />}>
        <BatchLoaded id={id} me={me} onEdit={onEdit} />
      </Suspense>
    </ErrorBoundary>
  );
}

export function BatchesPanel({ rows, me, selected, onSelect, onEdit }: { rows: OgBatchRow[]; me: OgIndex['me']; selected: string | null; onSelect: (id: string | null) => void; onEdit: (g: OgGift) => void }) {
  const live = rows.filter((b) => b.status !== 'posted' || b.id === selected);
  const recent = rows.filter((b) => b.status === 'posted' && b.id !== selected).slice(0, 5);
  if (selected) {
    return (
      <div className="og-batches">
        <button type="button" className="og-link og-back" onClick={() => onSelect(null)}>
          All batches
        </button>
        <BatchDetail id={selected} me={me} onEdit={onEdit} />
      </div>
    );
  }
  const card = (b: OgBatchRow) => (
    <li key={b.id}>
      <button type="button" className="og-bcard" onClick={() => onSelect(b.id)}>
        <span>
          <b>{b.name}</b>
          <small>
            {b.mine ? 'Yours' : b.createdBy} · {b.gifts} {b.gifts === 1 ? 'gift' : 'gifts'} · {money2(b.cents / 100)}
          </small>
        </span>
        <span className={'og-status og-status--' + b.status}>{STATUS_LABEL[b.status] || b.status}</span>
      </button>
    </li>
  );
  return (
    <div className="og-batches">
      <div className="og-head">
        <h2>Batches</h2>
      </div>
      <ul className="og-bcards">{live.length ? live.map(card) : <li className="og-none">No batches waiting. Add a gift to start one.</li>}</ul>
      {recent.length ? (
        <>
          <h4 className="og-sub">Recently posted</h4>
          <ul className="og-bcards">{recent.map(card)}</ul>
        </>
      ) : null}
    </div>
  );
}
