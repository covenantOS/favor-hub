// "One contact, many partners": one date, one summary and one way it went out, entered as one action on each partner picked.
// Port of dlgMany in public/js/work.js. POST /api/work/entry/many saves the batch, then driveBatch sends it 15 at a time.
import { useEffect, useRef, useState } from 'react';
import { reqId, wcPost } from '../api';
import { budgetLine, clearBusy, driveBatch, loadRecent, meterNow, reloadEntry, setBusy, toast } from '../engine';
import { norm, plural } from '../model';
import { searchPartners, type PartnerHit } from '../PartnerPicker';
import { closeDialog, setMany, wcSet } from '../store';
import { Dialog, Ic } from '../ui';
import { partnerOf, rememberHits } from './edits';
import { HOWS, TAGS, type EntryData, type EntryOwner } from './types';

const CHUNK = 15;

interface Props {
  owner: EntryOwner | undefined;
  ownerFid: string;
  data: EntryData;
  today: string;
  nameOf: (fid: string) => string;
  /** The page shows All rows after the entry, so the new rows are in view. */
  onDone: () => void;
}

export function ManyDialog(p: Props) {
  const [date, setDate] = useState(p.today);
  const [ch, setCh] = useState('mail');
  const [sum, setSum] = useState('');
  const [tags, setTags] = useState<string[]>(['thanked']);
  const [picks, setPicks] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [res, setRes] = useState<PartnerHit[]>([]);
  const [pool, setPool] = useState<PartnerHit[]>([]);
  const [, bump] = useState(0);
  const qBox = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const seq = useRef(0);
  const keepFocus = useRef(false);
  const me = p.owner;
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (keepFocus.current) {
      keepFocus.current = false;
      const el = qBox.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  });

  const nameFor = (c: string) => (partnerOf(p.data, c) || { n: c }).n;
  const shown = res.filter((h) => !picks.includes(h.cid));
  // Two picked partners that share a last name and a city may be one household.
  const household: [string, { n: string; cid: string }][] = [];
  picks.forEach((c) => {
    const d = partnerOf(p.data, c);
    if (!d) return;
    const last = d.n.split(' ').pop();
    pool
      .filter((x) => x.cid !== c && !picks.includes(x.cid) && x.place && x.place === d.loc && x.name.split(' ').pop() === last)
      .slice(0, 1)
      .forEach((x) => household.push([d.n, { n: x.name, cid: x.cid }]));
  });
  const calls = picks.length + picks.length * tags.length + Math.ceil(picks.length / CHUNK) + picks.length * 2;
  const tonight = budgetLine(calls).tonight;

  const pick = (cid: string) => {
    setPicks((x) => [...x, cid]);
    setQ('');
    setRes([]);
    keepFocus.current = true;
  };

  // Pasted names (one per line, or separated by semicolons or commas) pick every name that matches a single record.
  const pasteNames = (v: string) => {
    const names = v.split(/[\n;]+/).map((x) => x.trim()).filter(Boolean).slice(0, 40);
    void (async () => {
      const add: string[] = [];
      for (const nm of names) {
        const flip = nm.includes(',') ? nm.split(',').slice(1).join(' ') + ' ' + nm.split(',')[0] : nm;
        try {
          const hits = (await searchPartners(flip, { owner: p.ownerFid, wide: false })).filter((h) => norm(h.name) === norm(flip));
          rememberHits(hits);
          if (hits.length === 1 && !add.includes(hits[0].cid)) add.push(hits[0].cid);
        } catch {
          // that name is left out
        }
      }
      setPicks((x) => [...x, ...add.filter((c) => !x.includes(c))]);
      setQ('');
      setRes([]);
      keepFocus.current = true;
      bump((n) => n + 1);
    })();
  };

  const type = (v: string) => {
    setQ(v);
    if (/[\n;]/.test(v) || (v.match(/,/g) || []).length > 1) {
      pasteNames(v);
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const mine = ++seq.current;
      if (v.length < 2) {
        setRes([]);
        keepFocus.current = true;
        return;
      }
      let hits: PartnerHit[] = [];
      try {
        hits = await searchPartners(v, { owner: p.ownerFid, wide: false });
        rememberHits(hits);
      } catch {
        hits = [];
      }
      if (mine !== seq.current) return;
      setRes(hits);
      setPool((x) => x.concat(hits));
      setHi(0);
      keepFocus.current = true;
    }, 220);
  };

  const go = async () => {
    const chosen = picks.slice();
    closeDialog();
    setBusy('Entering…');
    let out: { batch?: { id?: string; run_when?: string }; items?: { id: string }[]; created: number; dups: number; owner: string };
    try {
      out = await wcPost('/api/work/entry/many', { owner: p.ownerFid, date, channel: ch, summary: sum, tags, constituent_ids: chosen, req: reqId() });
    } catch (err) {
      clearBusy();
      toast((err as Error).message);
      return;
    }
    p.onDone();
    if (out.batch && out.batch.id && out.batch.run_when !== 'tonight') {
      const ids = (out.items || []).map((i) => i.id);
      setMany('saving', ids, 'saving');
      await reloadEntry();
      setBusy('Entering…');
      const run = await driveBatch(out.batch.id, ids, { entry: true });
      wcSet({ saving: {} });
      await reloadEntry();
      await loadRecent();
      clearBusy();
      toast(run.held ? 'Some contacts are saved and go to Blackbaud when it answers.' : `Entered ${plural(out.created, 'contact')} for ${out.owner}${out.dups ? `. ${out.dups} were already in Blackbaud and were skipped` : ''}.`, out.batch.id);
    } else {
      await reloadEntry();
      await loadRecent();
      clearBusy();
      toast(out.batch && out.batch.id ? `Saved. Blackbaud gets them after ${meterNow().resets}.` : `All ${out.dups} were already in Blackbaud. Nothing was added twice.`, out.batch && out.batch.id ? out.batch.id : undefined);
    }
  };

  const canGo = picks.length > 0 && sum.trim().length > 0;
  return (
    <Dialog label="One contact, many partners">
      <div className="wc-dlg__head">
        <div>
          <h2>One contact, many partners</h2>
          <p>One date, one summary, one way it went out. Blackbaud gets one {me ? me.type : 'RDD Action'} on each partner, with {me ? me.name : 'the owner'} as fundraiser.</p>
        </div>
        <button type="button" className="wc-dlg__x" aria-label="Close" onClick={closeDialog}>
          <Ic n="x" />
        </button>
      </div>
      <div className="wc-dlg__body">
        <div className="wc-row2">
          <div className="wc-field">
            <label htmlFor="m-date">Date of the contact</label>
            <input type="date" id="m-date" value={date} max={p.today} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="wc-field">
            <span className="lab">How</span>
            <div className="wc-choices">
              {HOWS.map(([k, l]) => (
                <button key={k} type="button" className={'wc-choice' + (ch === k ? ' is-on' : '')} onClick={() => setCh(k)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="wc-field">
          <label htmlFor="m-sum">Summary</label>
          <input type="text" id="m-sum" maxLength={255} placeholder="For example: Sent thank you letter for the September gift" value={sum} onChange={(e) => setSum(e.target.value)} />
        </div>
        <div className="wc-field">
          <span className="lab">Tags</span>
          <div className="wc-ttog">
            {TAGS.map(([k, l]) => (
              <button key={k} type="button" className={'wc-tt' + (tags.includes(k) ? ' is-on' : '')} onClick={() => setTags((t) => (t.includes(k) ? t.filter((x) => x !== k) : t.concat([k])))}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="wc-field">
          <label htmlFor="m-q">
            Partners <span style={{ fontWeight: 400, color: 'var(--h-ink-3)' }}>({picks.length} picked)</span>
          </label>
          <div className="wc-chipsel">
            {picks.map((c) => (
              <button key={c} type="button" className="wc-fchip" onClick={() => setPicks((x) => x.filter((y) => y !== c))}>
                {nameFor(c)}
                <i>×</i>
              </button>
            ))}
            <input
              ref={qBox}
              type="search"
              id="m-q"
              placeholder="Type a name, or paste a list of names"
              value={q}
              autoComplete="off"
              onChange={(e) => type(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const h = shown[hi];
                  if (h) pick(h.cid);
                }
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  setHi((x) => Math.min(Math.max(0, shown.length - 1), Math.max(0, x + (e.key === 'ArrowDown' ? 1 : -1))));
                  keepFocus.current = true;
                }
              }}
            />
          </div>
          {shown.length ? (
            <div className="wc-ta">
              <div className="wc-ta__list" style={{ position: 'static' }}>
                {shown.map((d, i) => (
                  <button key={d.cid} type="button" className={i === hi ? 'is-hi' : ''} onClick={() => pick(d.cid)}>
                    {d.name}
                    <span>
                      {d.place || 'no city'} · {d.lookup}
                      {d.holders.length ? ' · ' + d.holders.map(p.nameOf).join(', ') : ''}
                      {d.deceased ? ' · deceased' : ''}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {household.map(([a, b]) => (
            <div key={b.cid} className="wc-hh">
              {a} and {b.n} share a last name and a city. If it is one household, pick one record so the contact counts once.{' '}
              <button type="button" className="wc-clear" onClick={() => pick(b.cid)}>
                Add {b.n.split(' ')[0]} anyway
              </button>
            </div>
          ))}
          <small>Pasting several names at once picks every one that matches a single record.</small>
        </div>
        {tonight ? (
          <div className="wc-warn">
            <Ic n="clock" />
            <span>
              <b>These go to Blackbaud tonight.</b> They send after {meterNow().resets}, when the daily count starts again.
            </span>
          </div>
        ) : null}
      </div>
      <div className="wc-dlg__foot">
        <span className="wc-cost">{picks.length ? plural(picks.length, 'action') : 'Pick at least one partner'}</span>
        <button type="button" className="h-btn h-btn--ghost" onClick={closeDialog}>
          Cancel
        </button>
        <button type="button" className="h-btn h-btn--primary" disabled={!canGo} onClick={() => void go()}>
          <Ic n="check" />
          Enter for {plural(picks.length, 'partner')}
        </button>
      </div>
    </Dialog>
  );
}
