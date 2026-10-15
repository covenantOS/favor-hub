// The entry form: one gift from a DAF, foundation, wire, stock or phone gift, with the soft credit named here, saved into this person's batch.
import { useEffect, useRef, useState } from 'react';
import type { OgGift, OgIndex, OgKindId } from '@shared/schemas';
import { money2 } from '@/lib/format';
import { lastCoding, recommenders, searchPartners, useOgActions } from './data';
import { GiftTerm } from '../gifts/Term';
import { ListPicker, Picker } from './pickers';

interface Person {
  id: string;
  lookup: string;
  name: string;
  place: string;
}

interface Form {
  kind: OgKindId;
  partner: Person | null;
  fundNamed: string;
  soft: Person | null;
  noSoft: boolean;
  amount: string;
  date: string;
  fundId: string;
  fundName: string;
  appealId: string;
  appealName: string;
  refText: string;
  memo: string;
  tributeKind: '' | 'honor' | 'memorial';
  tributeName: string;
  tributeNotify: string;
  file: File | null;
}

const COPY: Record<OgKindId, { from: string; named: string; namedRequired: boolean; ref: string; refRequired: boolean; soft: string; place: string }> = {
  daf: { from: 'From (the DAF sponsor)', named: 'Giving fund named on the notice', namedRequired: true, ref: '', refRequired: false, soft: 'Recommended by (soft credit)', place: 'The Denton Family Giving Fund' },
  foundation: { from: 'From (the foundation)', named: 'Grant or program named on the notice', namedRequired: false, ref: '', refRequired: false, soft: 'Recommended by (soft credit)', place: 'Foundation name' },
  wire: { from: 'From (who sent it)', named: '', namedRequired: false, ref: 'Wire confirmation number', refRequired: false, soft: 'Soft credit to (if one applies)', place: '' },
  stock: { from: 'From (who gave the stock)', named: '', namedRequired: false, ref: 'Ticker and number of shares', refRequired: true, soft: 'Soft credit to (if one applies)', place: 'For example ABCD, 120 shares' },
  phone: { from: 'From (the partner)', named: '', namedRequired: false, ref: '', refRequired: false, soft: 'Soft credit to (if one applies)', place: '' },
};

const empty = (kind: OgKindId, today: string, defaultFund: string, funds: OgIndex['funds']): Form => ({
  kind,
  partner: null,
  fundNamed: '',
  soft: null,
  noSoft: false,
  amount: '',
  date: today,
  fundId: defaultFund,
  fundName: funds.find((f) => f.id === defaultFund)?.name || '',
  appealId: '',
  appealName: '',
  refText: '',
  memo: '',
  tributeKind: '',
  tributeName: '',
  tributeNotify: '',
  file: null,
});

const fromGift = (g: OgGift): Form => ({
  kind: g.kind,
  partner: g.partnerId ? { id: g.partnerId, lookup: g.partnerLookup, name: g.partnerName, place: g.partnerPlace } : null,
  fundNamed: g.fundNamed,
  soft: g.softPartnerId ? { id: g.softPartnerId, lookup: '', name: g.softPartnerName, place: '' } : null,
  noSoft: g.noSoft,
  amount: g.amountCents ? (g.amountCents / 100).toFixed(2) : '',
  date: g.giftDate,
  fundId: g.fundId,
  fundName: g.fundName,
  appealId: g.appealId,
  appealName: g.appealName,
  refText: g.refText,
  memo: g.memo,
  tributeKind: g.tributeKind === 'honor' || g.tributeKind === 'memorial' ? g.tributeKind : '',
  tributeName: g.tributeName,
  tributeNotify: g.tributeNotify,
  file: null,
});

const cents = (s: string): number => {
  const n = Number(String(s).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};

export function AddGift({
  index,
  editing,
  batchName,
  onDone,
  onCancelEdit,
}: {
  index: OgIndex;
  editing: OgGift | null;
  batchName: string;
  onDone: (batchId: string, openBatch: boolean) => void;
  onCancelEdit: () => void;
}) {
  const [f, setF] = useState<Form>(() => (editing ? fromGift(editing) : empty('daf', index.today, index.defaultFund, index.funds)));
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState('');
  const act = useOgActions();
  const fileRef = useRef<HTMLInputElement>(null);
  const copy = COPY[f.kind];
  const kindInfo = index.kinds.find((k) => k.id === f.kind);
  const busy = act.saveGift.isPending || act.editGift.isPending;

  useEffect(() => {
    setErr('');
    setF(editing ? fromGift(editing) : (cur) => empty(cur.kind, index.today, index.defaultFund, index.funds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);

  const set = (patch: Partial<Form>) => setF((cur) => ({ ...cur, ...patch }));

  const pickPartner = async (p: Person) => {
    set({ partner: p });
    // The SOP's fallback: the fund and appeal on the last gift, when nothing else says.
    if (!f.appealId) {
      const last = await lastCoding(p.id).catch(() => null);
      if (last && last.appealId) {
        const a = index.appeals.find((x) => x.id === last.appealId);
        const fd = index.funds.find((x) => x.id === last.fundId);
        setF((cur) => (cur.appealId ? cur : { ...cur, appealId: last.appealId, appealName: a?.name || '', fundId: fd ? fd.id : cur.fundId, fundName: fd ? fd.name : cur.fundName }));
      }
    }
  };

  const payload = () => ({
    partner_id: f.partner?.id ?? null,
    partner_lookup: f.partner?.lookup ?? null,
    partner_name: f.partner?.name ?? null,
    partner_place: f.partner?.place ?? null,
    fund_named: f.fundNamed.trim() || null,
    soft_partner_id: f.soft?.id ?? null,
    soft_partner_name: f.soft?.name ?? null,
    no_soft: f.noSoft && !f.soft ? 1 : 0,
    amount_cents: cents(f.amount) || null,
    gift_date: f.date || null,
    fund_id: f.fundId || null,
    fund_name: f.fundName || null,
    appeal_id: f.appealId || null,
    appeal_name: f.appealName || null,
    ref_text: f.refText.trim() || null,
    memo: f.memo.trim() || null,
    tribute_kind: f.tributeKind || null,
    tribute_name: f.tributeKind ? f.tributeName.trim() || null : null,
    tribute_notify: f.tributeKind ? f.tributeNotify.trim() || null : null,
  });

  const missing = (): string => {
    if (!f.partner) return 'Pick who the gift is from.';
    if (!cents(f.amount)) return 'Enter the amount.';
    if (!f.date) return 'Set the gift date.';
    if (!f.fundId) return 'Pick the fund.';
    if (!f.appealId) return 'Pick the appeal.';
    if (copy.namedRequired && !f.fundNamed.trim()) return 'Enter the giving fund named on the notice.';
    if (copy.refRequired && !f.refText.trim()) return 'Enter the ticker and the number of shares.';
    if (f.tributeKind && !f.tributeName.trim()) return 'Enter who the tribute is for.';
    if (kindInfo?.needsSoft && !f.soft && !f.noSoft) return 'Name who recommended this gift, or choose No partner named.';
    return '';
  };

  const save = async (another: boolean) => {
    const why = missing();
    if (why) return setErr(why);
    setErr('');
    try {
      if (editing) {
        const r = await act.editGift.mutateAsync({ id: editing.id, set: { ...payload(), kind: f.kind }, file: f.file });
        setSaved('Saved.');
        onDone(r.batch.id, true);
        onCancelEdit();
        return;
      }
      const r = await act.saveGift.mutateAsync({ kind: f.kind, set: payload(), file: f.file });
      setSaved(`${money2(cents(f.amount) / 100)} from ${f.partner?.name} is in ${r.batch.name}.`);
      setF(empty(f.kind, index.today, index.defaultFund, index.funds));
      if (fileRef.current) fileRef.current.value = '';
      onDone(r.batch.id, !another);
    } catch (e) {
      setErr((e as Error).message || 'That did not save. Try again.');
    }
  };

  return (
    <form
      className="og-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
    >
      <div className="og-head">
        <h2>{editing ? 'Change this gift' : 'Add a gift'}</h2>
        <span className="og-chip" title="Each person enters into their own batch. A second person approves it.">
          Batch: {batchName || 'a new batch'}
        </span>
      </div>
      <div className="og-seg" role="tablist" aria-label="Kind of gift">
        {index.kinds.map((k) => (
          <button key={k.id} type="button" role="tab" aria-selected={f.kind === k.id} className={f.kind === k.id ? 'is-on' : ''} onClick={() => set({ kind: k.id, noSoft: false })}>
            {k.label}
          </button>
        ))}
      </div>

      <Picker<Person>
        id="og-from"
        label={copy.from === 'From (the DAF sponsor)' ? <>From (the <GiftTerm k="daf" label="DAF" /> sponsor)</> : copy.from}
        placeholder="Find a partner by name, ID or email"
        chosen={f.partner ? (<><b>{f.partner.name}</b> <small>#{f.partner.lookup || f.partner.id}{f.partner.place ? ` · ${f.partner.place}` : ''}</small></>) : null}
        onClear={() => set({ partner: null })}
        load={async (t) => (await searchPartners(t)).map((h) => ({ id: h.cid, lookup: h.lookup, name: h.name, place: h.place }))}
        toOption={(p) => ({ key: p.id, value: p.id, label: p.name, hint: `#${p.lookup || p.id}${p.place ? ` · ${p.place}` : ''}` })}
        onPick={(p) => void pickPartner(p)}
      />

      {copy.named ? (
        <div className="og-field">
          <label htmlFor="og-named">{copy.named}</label>
          <input id="og-named" className="og-input" value={f.fundNamed} placeholder={copy.place} onChange={(e) => set({ fundNamed: e.target.value })} />
        </div>
      ) : null}

      {copy.ref ? (
        <div className="og-field">
          <label htmlFor="og-ref">{copy.ref}</label>
          <input id="og-ref" className="og-input" value={f.refText} placeholder={copy.place} onChange={(e) => set({ refText: e.target.value })} />
        </div>
      ) : null}

      <Picker<{ id: string; lookup: string; name: string; place: string; usedBefore: number; lastDate: string }>
        id="og-soft"
        label={copy.soft === 'Recommended by (soft credit)' ? <>Recommended by (<GiftTerm k="soft" label="soft credit" />)</> : copy.soft}
        placeholder={f.partner && kindInfo?.needsSoft ? 'Pick from past recommenders or search' : 'Find a partner'}
        chosen={f.soft ? (<><b>{f.soft.name}</b> <small>#{f.soft.lookup || f.soft.id}</small></>) : f.noSoft ? <i>No partner named</i> : null}
        onClear={() => set({ soft: null, noSoft: false })}
        minChars={2}
        openOnFocus={!!f.partner}
        load={(t) => recommenders(f.partner?.id || '', t)}
        toOption={(p) => ({ key: p.id, value: p.id, label: p.name, hint: `#${p.lookup || p.id}${p.usedBefore ? ` · used this fund before (${p.usedBefore})` : ''}` })}
        onPick={(p) => set({ soft: { id: p.id, lookup: p.lookup, name: p.name, place: p.place }, noSoft: false })}
        extra={
          !f.soft && !f.noSoft && kindInfo?.needsSoft ? (
            <button type="button" className="og-link" onClick={() => set({ noSoft: true })}>
              No partner named
            </button>
          ) : null
        }
      />

      <div className="og-two">
        <div className="og-field">
          <label htmlFor="og-amt">Amount</label>
          <input id="og-amt" className="og-input" inputMode="decimal" placeholder="$0.00" value={f.amount} onChange={(e) => set({ amount: e.target.value })} />
        </div>
        <div className="og-field">
          <label htmlFor="og-date">Gift date</label>
          <input id="og-date" className="og-input" type="date" max={index.today} value={f.date} onChange={(e) => set({ date: e.target.value })} />
        </div>
      </div>

      <div className="og-two">
        <ListPicker id="og-fund" label="Fund" items={index.funds} value={f.fundId} onChange={(id, name) => set({ fundId: id, fundName: name })} placeholder="Search funds" />
        <ListPicker id="og-appeal" label="Appeal" items={index.appeals} value={f.appealId} onChange={(id, name) => set({ appealId: id, appealName: name })} placeholder="Search appeal codes" />
      </div>

      {f.soft && cents(f.amount) ? (
        <p className="og-note">
          The soft credit counts this {money2(cents(f.amount) / 100)} in {f.soft.name}&rsquo;s giving by year and on the director&rsquo;s numbers.
        </p>
      ) : null}

      <div className="og-field">
        <label htmlFor="og-memo">Memo (optional)</label>
        <input id="og-memo" className="og-input" value={f.memo} onChange={(e) => set({ memo: e.target.value })} />
      </div>

      <div className="og-field">
        <label htmlFor="og-tribute">Tribute (optional)</label>
        <select id="og-tribute" className="og-input" value={f.tributeKind} onChange={(e) => set({ tributeKind: e.target.value as Form['tributeKind'] })}>
          <option value="">Not a tribute gift</option>
          <option value="honor">In honor of</option>
          <option value="memorial">In memory of</option>
        </select>
      </div>
      {f.tributeKind ? (
        <>
          <div className="og-field">
            <label htmlFor="og-tribute-name">{f.tributeKind === 'honor' ? 'In honor of' : 'In memory of'}</label>
            <input id="og-tribute-name" className="og-input" value={f.tributeName} onChange={(e) => set({ tributeName: e.target.value })} />
          </div>
          <div className="og-field">
            <label htmlFor="og-tribute-notify">Who to notify (optional)</label>
            <input id="og-tribute-notify" className="og-input" value={f.tributeNotify} onChange={(e) => set({ tributeNotify: e.target.value })} placeholder="Name and address or email" />
          </div>
        </>
      ) : null}

      <div className="og-field">
        <label htmlFor="og-file">{kindInfo?.needsLetter ? 'Letter or notice' : 'Letter or notice (optional)'}</label>
        <div className="og-drop">
          <input id="og-file" ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => set({ file: e.target.files?.[0] || null })} />
          <span>{f.file ? `${f.file.name} attaches to the gift when the batch is approved` : editing?.letterName ? `${editing.letterName} is attached to this gift` : 'A PDF, PNG or JPG. It attaches to the gift when the batch is approved.'}</span>
        </div>
      </div>

      {f.kind === 'phone' ? <p className="og-note">Card numbers are never entered here. A card taken by phone goes in with Add gift on the partner&rsquo;s record.</p> : null}
      {err ? (
        <p className="og-err" role="alert">
          {err}
        </p>
      ) : null}
      {saved && !err ? (
        <p className="og-ok" role="status">
          {saved}
        </p>
      ) : null}

      <div className="og-actions">
        <button type="submit" className="h-btn h-btn--primary" disabled={busy}>
          {busy ? 'Saving' : editing ? 'Save changes' : 'Save to the batch'}
        </button>
        {editing ? (
          <button type="button" className="h-btn h-btn--ghost" onClick={onCancelEdit}>
            Cancel
          </button>
        ) : (
          <button type="button" className="h-btn h-btn--ghost" disabled={busy} onClick={() => void save(true)}>
            Save and add another
          </button>
        )}
      </div>
      <p className="og-foot">A second person approves the batch in FavorOS. Approving posts the gifts to Blackbaud.</p>
    </form>
  );
}
