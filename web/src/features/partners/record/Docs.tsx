// Documents on the partner record: letters of inquiry, DAF letters, award letters, W-9s. Prominent on foundation and DAF partners,
// folded on everyone else. The list shows FavorOS's copies and the attachments Blackbaud holds.
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiFail, rApi, todayEt, type Partner } from './lib';
import { toast } from './toast';

interface Row {
  id: string;
  kind: string;
  name: string;
  fileName: string;
  size: number;
  inFavorOS: boolean;
  blackbaud: 'done' | 'pending' | 'failed' | 'standin' | 'only';
  blackbaudError: string;
  date: string;
  by: string;
  url: string;
  mine: boolean;
}
const BB: Record<Row['blackbaud'], string> = {
  done: 'In Blackbaud',
  pending: 'Sending to Blackbaud',
  failed: 'Not in Blackbaud yet',
  standin: 'Test copy',
  only: 'Held in Blackbaud',
};
const kb = (n: number) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n ? n + ' B' : '');
const prominent = (p: Partner) => p.codes.some((c) => /foundation|daf/i.test(c));

export function Docs({ p }: { p: Partner }) {
  const qc = useQueryClient();
  const key = ['pr', 'docs', p.id];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => rApi<{ rows: Row[]; kinds: string[]; can: boolean; bbRead: boolean }>(`/api/work/partners/${p.id}/documents`),
    staleTime: 30_000,
  });
  const [open, setOpen] = useState(prominent(p));
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const rows = data?.rows || [];
  useEffect(() => setOpen(prominent(p)), [p.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async (f: HTMLFormElement) => {
    const fd = new FormData(f);
    const picked = fd.get('file') as File | null;
    if (!picked || !picked.size) {
      toast('Pick a file first.', null, true);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/work/partners/${p.id}/documents`, { method: 'POST', credentials: 'same-origin', headers: { 'X-Hub-Request': '1' }, body: fd });
      const d = (await res.json().catch(() => ({}))) as any;
      if (!res.ok || d.ok === false) throw new ApiFail(d.message || 'The file did not save.', res.status, d);
      toast(d.doc && d.doc.blackbaud === 'failed' ? 'Saved in FavorOS. ' + (d.doc.blackbaudError || 'Blackbaud did not take it yet.') : 'Document added.');
      setAdding(false);
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast((e as Error).message, null, true);
    }
    setBusy(false);
  };
  const act = async (r: Row, what: 'remove' | 'retry') => {
    if (what === 'remove' && !window.confirm('Remove ' + r.name + '?' + (r.blackbaud === 'done' ? ' The copy in Blackbaud is removed too.' : ''))) return;
    try {
      await rApi(`/api/work/partners/${p.id}/documents/${r.id}`, { method: what === 'remove' ? 'DELETE' : 'POST' });
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast((e as Error).message, null, true);
    }
  };
  return (
    <section className={'pp-sec pp-docs' + (open ? '' : ' is-folded')} aria-label="Documents">
      <h3>
        <span>Documents{rows.length ? ` (${rows.length})` : ''}</span>
        <span>
          {data?.can && open ? (
            <button type="button" onClick={() => setAdding((v) => !v)}>
              {adding ? 'Cancel' : 'Add a document'}
            </button>
          ) : null}{' '}
          <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : 'Show'}
          </button>
        </span>
      </h3>
      {open ? (
        <>
          {adding ? (
            <form
              className="pp-compose pp-docs__form"
              onSubmit={(e) => {
                e.preventDefault();
                void send(e.currentTarget);
              }}
            >
              <div className="pp-compose__row">
                <label className="pp-lab">
                  Type
                  <select name="kind" defaultValue={prominent(p) ? 'Letter of inquiry' : 'Other'}>
                    {(data?.kinds || []).map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                </label>
                <label className="pp-lab">
                  Date
                  <input type="date" name="date" defaultValue={todayEt()} />
                </label>
              </div>
              <label className="pp-lab">
                Name
                <input type="text" name="name" maxLength={150} placeholder="Defaults to the type and file name" />
              </label>
              <label className="pp-lab">
                File (PDF, Word, Excel or image, up to 10 MB)
                <input type="file" name="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" required />
              </label>
              <div className="pp-compose__foot">
                <small>Saved in FavorOS and attached to the Blackbaud record</small>
                <button type="submit" className="h-btn h-btn--primary h-btn--sm" disabled={busy}>
                  {busy ? 'Saving' : 'Save document'}
                </button>
              </div>
            </form>
          ) : null}
          {isLoading ? <p className="pp-empty">Loading documents.</p> : null}
          {!isLoading && !rows.length ? <p className="pp-empty">No documents on this partner.</p> : null}
          <ul className="pp-docs__list">
            {rows.map((r) => (
              <li key={r.id}>
                <div>
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noreferrer">
                      {r.name}
                    </a>
                  ) : (
                    <b>{r.name}</b>
                  )}
                  <small>{[r.kind, r.date, kb(r.size), r.by].filter(Boolean).join(' · ')}</small>
                </div>
                <span className={'pp-docs__bb is-' + r.blackbaud} title={r.blackbaudError || undefined}>
                  {BB[r.blackbaud]}
                </span>
                {r.inFavorOS && data?.can ? (
                  <span className="pp-docs__act">
                    {r.blackbaud === 'failed' ? (
                      <button type="button" className="pp-edit" onClick={() => void act(r, 'retry')}>
                        Send again
                      </button>
                    ) : null}
                    <button type="button" className="pp-edit" onClick={() => void act(r, 'remove')}>
                      Remove
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {data && !data.bbRead ? <p className="pp-empty">The attachments held in Blackbaud could not be read just now.</p> : null}
        </>
      ) : null}
    </section>
  );
}
