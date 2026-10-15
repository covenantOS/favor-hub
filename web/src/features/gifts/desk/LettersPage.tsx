// Gifts > Thank-you letters: every gift of $5,000 and up, newest first, grouped by month, with where its letter stands (To write, Printed,
// Signed, Mailed, Cannot send). Print opens one PDF and marks the gifts Printed; Signed is a mark; Mark mailed writes one HQTY Letter action
// per gift in Blackbaud (with Undo). Ported from public/js/work-hqty.js and work-letter.js; the classic page stays at ?classic=1.
// The read is the D1 copy of Blackbaud (GET /api/work/hqty). Every step goes to the same routes the classic desk calls.
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { BodyPortal } from '@/shell/BodyPortal';
import { Ic } from '../../partners/work/lists/icons';
import { SheetsButton, sheetScreen, useSheetSource } from '../../partners/work/lists/legacy';
import { UNDONE_EVENT, driveBatch, showToast } from '../../partners/work/lists/toast';
import { asOf, reqId, workApi, workPost } from '../../partners/work/lists/core';
import { fd, money } from '../../partners/record/lib';
import { CannotDialog, PreviewDialog, RowMenu, TextDialog } from './HqtyDialogs';
import { DeskFrame, n0, type DeskSearch } from './kit';
import { PAGE, STATE, applyStep, blocked, cloneDesk, hqtyQuery, monthLabel, recentFrom, recount, visibleRows, type HqtyData, type HqtyRow } from './hqty';

const toast = (msg: string, bids?: string[] | null, bad?: boolean) => showToast(msg, { undo: bids && bids.length ? { batches: bids } : null, bad });

const Dots = () => (
  <svg className="h-i" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="5" cy="12" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="19" cy="12" r="1.7" />
  </svg>
);

interface RowActs {
  pick: (key: string, on: boolean) => void;
  signer: (key: string, signer: string) => void;
  preview: (key: string) => void;
  print: (key: string) => void;
  step: (key: string, to: string) => void;
  menu: (key: string, el: HTMLElement) => void;
}

const StateCell = ({ r, today }: { r: HqtyRow; today: string }) => {
  const [l, cls] = STATE[r.state];
  let sub = '';
  if (r.state === 'write') sub = monthLabel(r.month, today) + ' letter';
  else if (r.state === 'mailed') sub = (r.source === 'blackbaud' ? 'Logged ' : 'Mailed ') + fd(r.stateDate);
  else if (r.state === 'cannot') sub = r.why;
  else sub = r.stateDate ? fd(r.stateDate) : '';
  return (
    <>
      <span className={('wc-tag ' + cls).trim()}>{l}</span>
      <span className="wg-sub">{sub}</span>
    </>
  );
};

function Acts({ r, a }: { r: HqtyRow; a: RowActs }) {
  const off = blocked(r);
  const prev = (
    <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => a.preview(r.key)}>
      <Ic n="brief" />
      Preview
    </button>
  );
  const menu = (
    <button type="button" className="hq-more" data-hq-menu={r.key} aria-label={'More for ' + r.partner.name} aria-haspopup="menu" onClick={(e) => a.menu(r.key, e.currentTarget)}>
      <Dots />
    </button>
  );
  if (r.state === 'write')
    return (
      <>
        {prev}
        <button type="button" className="h-btn h-btn--primary h-btn--sm" disabled={off} title={off ? 'No mailing address or no partner credited' : undefined} onClick={() => a.print(r.key)}>
          <Ic n="print" />
          Print
        </button>
        {menu}
      </>
    );
  if (r.state === 'printed')
    return (
      <>
        {prev}
        <button type="button" className="h-btn h-btn--primary h-btn--sm" onClick={() => a.step(r.key, 'signed')}>
          <Ic n="check" />
          Signed
        </button>
        {menu}
      </>
    );
  if (r.state === 'signed')
    return (
      <>
        {prev}
        <button type="button" className="h-btn h-btn--primary h-btn--sm" onClick={() => a.step(r.key, 'mailed')}>
          <Ic n="mail" />
          Mark mailed
        </button>
        {menu}
      </>
    );
  if (r.state === 'mailed') return <span className="hq-ref">{r.actionId ? 'Action ' + r.actionId : 'In Blackbaud'}</span>;
  return (
    <>
      <span className="hq-ref">{r.why}</span>
      {menu}
    </>
  );
}

const Row = memo(function Row({ r, today, signers, picked, working, a }: { r: HqtyRow; today: string; signers: HqtyData['signers']; picked: boolean; working: boolean; a: RowActs }) {
  const sub = r.through ? 'Given through ' + r.through : r.partner.place || '';
  const canPick = r.state !== 'mailed';
  const amt = money(r.amount);
  const opts = signers.filter((c) => c.key !== 'rdd' || r.rdd);
  return (
    <div className={'wg-row hq-row' + (picked ? ' is-picked' : '') + (working ? ' is-working' : '')} data-key={r.key}>
      <label className="wg-cb">{canPick ? <input type="checkbox" checked={picked} onChange={(e) => a.pick(r.key, e.target.checked)} aria-label={'Select ' + r.partner.name} /> : null}</label>
      <div className={'wg-amt wg-c-amt' + (amt.length > 10 ? ' is-long' : '')}>
        {amt}
        <small>
          {fd(r.date)} · {r.pay || r.type}
        </small>
      </div>
      <div className="wg-c-who">
        <a className="wg-name" href={'/work/partner/' + r.cid} data-partner-id={r.cid}>
          {r.partner.name}
        </a>
        <span className="wg-sub">{sub}</span>
        {r.flags.length ? (
          <div className="wg-badges">
            {r.flags.map((x) => (
              <span className="wc-tag wc-tag--warn" key={x}>
                {x}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="hq-addr">
        <b>{r.fund || 'No fund on file'}</b>
        {r.address ? <span className="wg-sub">{r.address}</span> : <span className="wg-sub is-bad">No mailing address</span>}
        <label className="hq-signer">
          <span>Signed by</span>
          <select
            value={r.signer || ''}
            onChange={(e) => a.signer(r.key, e.target.value)}
            aria-label={'Signed by, ' + r.partner.name}
            disabled={r.state !== 'write'}
            title={r.state !== 'write' ? 'A letter that is printed, signed or mailed keeps the signer it went out with' : undefined}
          >
            {r.signer ? null : (
              <option value="" disabled>
                Pick a signer
              </option>
            )}
            {opts.map((c) => (
              <option value={c.key} key={c.key}>
                {c.key === 'rdd' ? 'RDD: ' + r.rdd : c.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="hq-state">
        <StateCell r={r} today={today} />
      </div>
      <div className="wg-acts hq-acts">
        <Acts r={r} a={a} />
      </div>
    </div>
  );
});

type Dlg = { kind: 'preview'; key: string } | { kind: 'text' } | { kind: 'cannot'; keys: string[]; clear: boolean } | null;

export function LettersPage({ search }: { search: DeskSearch }) {
  const as = search.as || '';
  return (
    <DeskFrame tab="hqty">
      <Desk as={as} />
    </DeskFrame>
  );
}

function Desk({ as }: { as: string }) {
  const q0 = hqtyQuery(as);
  const { data: d } = useSuspenseQuery(q0);
  const qc = useQueryClient();
  const [filter, setFilter] = useState('');
  const [qIn, setQ] = useState('');
  const q = useDeferredValue(qIn);
  const [shown, setShown] = useState(PAGE);
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [working, setWorking] = useState<Set<string>>(() => new Set());
  const [dlg, setDlg] = useState<Dlg>(null);
  const [menu, setMenu] = useState<{ key: string; el: HTMLElement } | null>(null);

  const cur = useCallback(() => qc.getQueryData(q0.queryKey) as HqtyData, [qc, q0.queryKey]);
  const edit = useCallback(
    (fn: (c: HqtyData) => void) => {
      qc.setQueryData(q0.queryKey, (old: HqtyData | undefined) => {
        if (!old) return old;
        const c = cloneDesk(old);
        fn(c);
        return c;
      });
    },
    [qc, q0.queryKey]
  );
  const rowOf = useCallback((k: string) => cur().rows.find((r) => r.key === k), [cur]);

  const list = useMemo(() => visibleRows(d, filter, q), [d, filter, q]);
  const picked = useMemo(() => d.rows.filter((r) => sel.has(r.key)), [d, sel]);

  /** Read the desk again (after a Blackbaud change or an undo). Selection keeps only the gifts still listed. */
  const reload = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: q0.queryKey });
    const fresh = cur();
    setSel((s) => new Set([...s].filter((k) => fresh.rows.some((r) => r.key === k))));
  }, [qc, q0.queryKey, cur]);

  useEffect(() => {
    const on = () => void reload();
    document.addEventListener(UNDONE_EVENT, on);
    return () => document.removeEventListener(UNDONE_EVENT, on);
  }, [reload]);

  useSheetSource('hqty-letters', () => {
    const cols = [
      { key: 'date', label: 'Gift date', type: 'date' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'partner', label: 'Partner', type: 'text' },
      { key: 'through', label: 'Given through', type: 'text' },
      { key: 'fund', label: 'Fund', type: 'text' },
      { key: 'address', label: 'Mailing address', type: 'text' },
      { key: 'state', label: 'Letter', type: 'text' },
      { key: 'signer', label: 'Signed by', type: 'text' },
      { key: 'on', label: 'On', type: 'date' },
      { key: 'action', label: 'Blackbaud action', type: 'text' },
      { key: 'flags', label: 'Flags', type: 'text' },
    ];
    const data = list.map((r) => ({
      date: r.date,
      amount: r.amount,
      partner: r.partner.name,
      through: r.through || '',
      fund: r.fund,
      address: r.address,
      state: STATE[r.state][0] + (r.why ? ': ' + r.why : ''),
      signer: r.signerName,
      on: r.stateDate || null,
      action: r.actionId,
      flags: r.flags.join(', '),
    }));
    return sheetScreen('HQTY letters', [{ name: 'HQTY letters', columns: cols, rows: data }], { filters: filter ? 'Filter: ' + filter : '', classes: ['partner'] });
  });

  /* ------------------------------------------------------------------ steps */

  /** Sets who signs for the gifts named. Only letters still To write change; the server says which did. */
  const setSigner = useCallback(
    async (keys: string[], key: string) => {
      const rows = keys.map(rowOf).filter((r): r is HqtyRow => !!r && r.state === 'write');
      if (!rows.length) {
        toast('Only letters still To write take a signer. Put a printed letter back to To write first.', null, true);
        return;
      }
      try {
        const out = await workPost('/api/work/hqty/signer', { ids: rows.map((r) => r.giftId), signer: key });
        let n = 0;
        edit((c) => {
          for (const r of c.rows) {
            const v = out.resolved[r.giftId];
            if (v) {
              r.signer = v.signer;
              r.signerName = v.signerName;
              r.signerTitle = v.signerTitle;
              r.picked = true;
              n++;
            }
          }
        });
        if (n) toast(`Signer set for ${n} ${n === 1 ? 'letter' : 'letters'}.`);
        if (out.skipped.length) toast(out.skipped[0].why, null, !n);
      } catch (err) {
        toast((err as Error).message, null, true);
      }
    },
    [rowOf, edit]
  );

  /** One step for the gifts named by key. Resolves true when something changed. */
  const step = useCallback(
    async (keys: string[], to: string, why?: string): Promise<boolean> => {
      const rows = keys.map(rowOf).filter((r): r is HqtyRow => !!r);
      const ids = rows.map((r) => r.giftId);
      if (!ids.length) return false;
      setWorking((w) => new Set([...w, ...ids]));
      const unwork = () => setWorking((w) => new Set([...w].filter((x) => !ids.includes(x))));
      let out: any;
      try {
        out = await workPost('/api/work/hqty/bulk', { ids, to, why: why || '', req: reqId() });
      } catch (err) {
        unwork();
        toast((err as Error).message, null, true);
        return false;
      }
      unwork();
      const skip: string[] = (out.skipped || []).map((x: { why: string }) => x.why);
      if (to === 'mailed') {
        if (!out.batch) {
          toast(skip[0] || 'Nothing was saved.', null, true);
          await reload();
          return false;
        }
        edit((c) => {
          for (const r of c.rows)
            if ((out.done || []).includes(r.giftId)) {
              r.state = 'mailed';
              r.source = 'hub';
              r.stateDate = c.today;
              r.actionId = '';
            }
          recount(c);
        });
        setSel((s) => new Set([...s].filter((k) => cur().rows.find((r) => r.key === k)?.state !== 'mailed')));
        toast(`Saving ${out.done.length} ${out.done.length === 1 ? 'letter' : 'letters'} to Blackbaud…`);
        try {
          const held = out.batch.run_when === 'tonight' ? 'tonight' : await driveBatch(out.batch.id);
          const recent = (await workApi('/api/work/recent')).batches || [];
          const bad = ((recent.find((b: { id: string }) => b.id === out.batch.id) || { items: [] }).items as { state: string; error?: string }[]).find((x) => x.state === 'failed');
          if (bad) {
            toast(`${bad.error || 'Blackbaud turned it down.'} Nothing was lost. Recent has Try again.`, [out.batch.id], true);
            await reload();
            return true;
          }
          toast(
            held === 'tonight'
              ? 'Mailed. It goes to Blackbaud tonight.'
              : held
                ? 'Mailed. Blackbaud is slow, so the rest goes when it answers.'
                : `Mailed ${out.done.length} ${out.done.length === 1 ? 'letter' : 'letters'}. One HQTY Letter action each.`,
            [out.batch.id]
          );
        } catch (err) {
          toast((err as Error).message + ' It is saved, and Recent can send it again.', [out.batch.id], true);
        }
        await reload();
        return true;
      }
      edit((c) => applyStep(c, ids, to, why || '', out.done));
      if (skip.length && !(out.done || []).length) toast(skip[0], null, true);
      return (out.done || []).length > 0;
    },
    [rowOf, edit, reload, cur]
  );

  const print = useCallback(
    async (keys: string[]) => {
      const rows = keys.map(rowOf).filter((r): r is HqtyRow => !!r && r.state !== 'mailed' && r.state !== 'cannot' && !blocked(r));
      const skipped = keys.length - rows.length;
      if (!rows.length) {
        toast('Nothing to print. Gifts with no mailing address or no partner credited stay off the print file.', null, true);
        return;
      }
      // The window opens inside the press, so a pop-up blocker lets the print file through.
      const win = window.open('', '_blank');
      const toMark = rows.filter((r) => r.state === 'write').map((r) => r.key);
      try {
        if (toMark.length) await step(toMark, 'printed');
      } catch {
        // the print file still opens
      }
      const as0 = asOf();
      const href = '/api/work/hqty/pdf?ids=' + rows.map((r) => r.giftId).join(',') + (as0 ? '&as=' + encodeURIComponent(as0) : '');
      if (win) win.location.href = href;
      else window.open(href, '_blank');
      toast(`Print file ready for ${rows.length} ${rows.length === 1 ? 'letter' : 'letters'}${skipped ? `. ${skipped} left out for no mailing address or partner` : ''}. Press Signed once they are signed.`);
    },
    [rowOf, step]
  );

  /* ------------------------------------------------------------------ row actions (stable, so a row redraws only when its own data changes) */
  const latest = useRef({ setSigner, step, print, sel });
  latest.current = { setSigner, step, print, sel };
  const acts = useMemo<RowActs>(
    () => ({
      pick: (key, on) => setSel((s) => {
        const n = new Set(s);
        if (on) n.add(key);
        else n.delete(key);
        return n;
      }),
      signer: (key, signer) => {
        if (signer) void latest.current.setSigner([key], signer);
      },
      preview: (key) => setDlg({ kind: 'preview', key }),
      print: (key) => {
        setDlg(null);
        void latest.current.print([key]);
      },
      step: (key, to) => void latest.current.step([key], to),
      menu: (key, el) => setMenu((m) => (m && m.key === key ? null : { key, el })),
    }),
    []
  );

  const s = d.stats;
  const mo = monthLabel(d.today.slice(0, 7), d.today);
  const stats: [string, string, number, boolean?][] = [
    ['write', 'To write', s.write],
    ['printed', 'Printed, to sign', s.printed],
    ['signed', 'Signed, to mail', s.signed],
    ['mailed', 'Mailed this month', s.mailedMonth],
    ['earlier', 'Earlier gifts, no letter logged', s.earlier, true],
  ];
  const perMonth: Record<string, number> = {};
  for (const r of list) perMonth[r.month] = (perMonth[r.month] || 0) + 1;
  const groups: { m: string; rows: HqtyRow[] }[] = [];
  for (const r of list.slice(0, shown)) {
    const g = groups[groups.length - 1];
    if (g && g.m === r.month) g.rows.push(r);
    else groups.push({ m: r.month, rows: [r] });
  }
  const has = (...st: string[]) => picked.some((r) => st.includes(r.state));
  const pickFilter = (k: string) => {
    setFilter((f) => (f === k ? '' : k));
    setShown(PAGE);
  };
  const menuRow = menu ? rowOf(menu.key) : undefined;

  return (
    <>
      <div className="h-card wc-band wg-band" style={{ '--n': 5 } as React.CSSProperties}>
        {stats.map(([k, l, n, warn]) => (
          <button type="button" key={k} className={'wc-stat' + (filter === k ? ' is-on' : '') + (warn && n ? ' is-warn' : '')} onClick={() => pickFilter(k)}>
            <b>{n0(n)}</b>
            <span>{l}</span>
          </button>
        ))}
      </div>
      <section className="h-card wc-sheet" id="hq-sheet" aria-label="HQTY letters">
        <div className="wg-tools">
          <button type="button" className={'hq-all' + (filter ? '' : ' is-on')} onClick={() => pickFilter('')}>
            All gifts of $5,000 and up<span>{n0(s.total)}</span>
          </button>
          <label className="wc-find">
            <Ic n="search" />
            <input
              type="search"
              id="hq-q"
              placeholder="Find a partner"
              value={qIn}
              onChange={(e) => {
                setQ(e.target.value);
                setShown(PAGE);
              }}
              autoComplete="off"
            />
          </label>
          <span className="wg-spacer" />
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => setDlg({ kind: 'text' })}>
            <Ic n="letter" />
            {mo} letter
          </button>
          <SheetsButton name="hqty-letters" />
        </div>
        <div className="wg-list">
          {groups.map((g) => (
            <div key={g.m}>
              <div className="wg-group">
                <span>
                  {monthLabel(g.m, d.today)} · {n0(perMonth[g.m])}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const all = list.filter((r) => r.month === g.m && r.state !== 'mailed');
                    const on = all.every((r) => sel.has(r.key));
                    setSel((p) => {
                      const n = new Set(p);
                      all.forEach((r) => (on ? n.delete(r.key) : n.add(r.key)));
                      return n;
                    });
                  }}
                >
                  Select all
                </button>
              </div>
              {g.rows.map((r) => (
                <Row key={r.key} r={r} today={d.today} signers={d.signers} picked={sel.has(r.key)} working={working.has(r.giftId)} a={acts} />
              ))}
            </div>
          ))}
          {list.length > shown ? (
            <div className="wc-more">
              <button type="button" className="h-more" onClick={() => setShown((n) => n + PAGE)}>
                Show {Math.min(PAGE, list.length - shown)} more{' '}
                <span>
                  {n0(list.length - shown)} left of {n0(list.length)}
                </span>
              </button>
            </div>
          ) : null}
          {!list.length ? (
            <div className="wg-empty">
              <b>{d.rows.length ? 'Nothing matches' : 'No gifts yet'}</b>
              {d.rows.length ? 'Clear the filter above to see the rest.' : 'Gifts of $5,000 and up show here after the Blackbaud copy refreshes at 5 AM and 5 PM.'}
            </div>
          ) : null}
        </div>
        <div className="wg-foot">
          <span>
            {n0(s.total)} {Number(s.total) === 1 ? 'gift' : 'gifts'} of $5,000 and up since {fd(d.since)}. A gift counts as written when Blackbaud holds an HQTY Letter on its partner dated on or after the gift.
          </span>
        </div>
      </section>

      {BodyPortal(
        <div id="hq-bulk" className={'wg-bulk' + (picked.length ? ' is-on' : '')} role="region" aria-label="Selected gifts">
          {picked.length ? (
            <>
              <b>{picked.length} selected</b>
              {has('write', 'printed', 'signed') ? (
                <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => void print([...sel])}>
                  <Ic n="print" />
                  Print one PDF
                </button>
              ) : null}
              {has('write') ? (
                <label className="hq-signer hq-signer--bulk">
                  <span>Signed by</span>
                  <select
                    value=""
                    aria-label="Set the signer for the selected letters"
                    onChange={(e) => {
                      if (e.target.value) void setSigner([...sel], e.target.value);
                    }}
                  >
                    <option value="">Set for all selected</option>
                    {d.signers.map((c) => (
                      <option value={c.key} key={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {has('printed', 'write') ? (
                <button
                  type="button"
                  className="h-btn h-btn--ghost h-btn--sm"
                  onClick={async () => {
                    await step([...sel], 'signed');
                    setSel(new Set());
                  }}
                >
                  <Ic n="check" />
                  Signed
                </button>
              ) : null}
              {has('signed', 'printed') ? (
                <button
                  type="button"
                  className="h-btn h-btn--ghost h-btn--sm"
                  onClick={async () => {
                    await step([...sel], 'mailed');
                    setSel(new Set());
                  }}
                >
                  <Ic n="mail" />
                  Mark mailed
                </button>
              ) : null}
              <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => setDlg({ kind: 'cannot', keys: [...sel], clear: true })}>
                Cannot send
              </button>
              <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => setSel(new Set())}>
                Clear
              </button>
            </>
          ) : null}
        </div>
      )}

      {menu && menuRow ? (
        <RowMenu
          row={menuRow}
          anchor={menu.el}
          onClose={() => setMenu(null)}
          onPick={(k) => {
            const key = menu.key;
            setMenu(null);
            if (k === 'print') void print([key]);
            else if (k === 'cannot') setDlg({ kind: 'cannot', keys: [key], clear: false });
            else if (k === 'reset') void step([key], 'reset');
          }}
        />
      ) : null}

      {dlg && dlg.kind === 'preview' && rowOf(dlg.key) ? <PreviewDialog row={rowOf(dlg.key)!} d={d} onClose={() => setDlg(null)} onPrint={(key) => {
        setDlg(null);
        void print([key]);
      }} /> : null}
      {dlg && dlg.kind === 'text' ? (
        <TextDialog
          d={d}
          sample={list.find((r) => r.month === d.today.slice(0, 7)) || d.rows.find((r) => r.month === d.today.slice(0, 7)) || d.rows[0]}
          onClose={() => setDlg(null)}
          onSaved={async (m) => {
            setDlg(null);
            toast(`${m} letter saved.`);
            await reload();
          }}
        />
      ) : null}
      {dlg && dlg.kind === 'cannot' ? (
        <CannotDialogHost keys={dlg.keys} clear={dlg.clear} rowOf={rowOf} d={d} onClose={() => setDlg(null)} onGo={async (keys, why) => {
          setDlg(null);
          await step(keys, 'cannot', why);
          setSel(new Set());
        }} />
      ) : null}
    </>
  );
}

function CannotDialogHost({ keys, clear, rowOf, d, onClose, onGo }: { keys: string[]; clear: boolean; rowOf: (k: string) => HqtyRow | undefined; d: HqtyData; onClose: () => void; onGo: (keys: string[], why: string, clear: boolean) => void }) {
  const rows = keys.map(rowOf).filter((r): r is HqtyRow => !!r && r.state !== 'mailed');
  if (!rows.length) return null;
  return <CannotDialog rows={rows} whys={d.whys} onClose={onClose} onGo={(why) => onGo(rows.map((r) => r.key), why, clear)} />;
}

// recentFrom stays exported for the tests that check the "Earlier gifts" cut.
export { recentFrom };
