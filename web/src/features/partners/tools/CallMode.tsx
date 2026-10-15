// Call mode: one screen for a phone call (port of public/js/call-mode.js). The script (Thank, Pray, Report, Ask), the partner's giving, the
// last notes and contacts on the left; on the right a big Log it. The person says or types what happened, /api/brief/call-summary turns it
// into the action's summary and notes, and Log it saves a completed phone call on the partner through the same batch the partner page uses.
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { BodyPortal } from '@/shell/BodyPortal';
import { Boundary } from '../record/Boundary';
import { Ic } from '../record/Ic';
import { ApiFail, N, digits, fd, money, newReq, plusDays, rApi, rPost, short, sleep, todayEt } from '../record/lib';
import { toast } from '../record/toast';
import { Steps, prepQuery, useLayer } from './Prep';
import { ThankPop } from './thank';

const OUTCOMES: [string, string][] = [
  ['talked', 'Talked'],
  ['left', 'Left a message'],
  ['none', 'No answer'],
];

interface Follow { what: string; days: number }

async function logIt(cid: string, b: any, st: { outcome: string; summary: string | null; notes: string; follow: Follow | null; followOn: boolean; thanked: boolean }) {
  const C = await rApi('/api/work/codes').catch(() => ({ me: {}, types: {} }));
  let holder = '';
  try {
    const p = (await rApi('/api/work/partners/' + encodeURIComponent(cid))).partner;
    const h = (p.assignments || []).find((a: any) => a.current);
    holder = h ? String(h.fid) : '';
  } catch {
    // the signed-in person's own id is used
  }
  const fid = holder || (C.me && C.me.fid) || '';
  const type = (fid && C.types && C.types[fid]) || (C.me && C.me.type) || 'RDD Action';
  const stamp = todayEt();
  const lead = st.outcome === 'left' ? 'Left a message. ' : st.outcome === 'none' ? 'Called, no answer. ' : '';
  const summary = (lead + (st.summary || '')).trim().slice(0, 255) || (st.outcome === 'none' ? 'Called, no answer' : 'Phone call');
  const set = { category: 'Phone call', type, date: stamp, summary, description: st.notes || '', fundraisers: fid ? [fid] : [], completed: true, status: 'Completed', direction: 'Outbound' };
  const tags = st.thanked ? { add: [{ category: 'Thanked' }] } : undefined;
  const out = await rPost('/api/work/batches', { req: newReq(), op: 'new', cids: [cid], set, tags });
  const ids: string[] = [];
  const run = async (batch: any): Promise<string> => {
    ids.push(batch.id);
    if (batch.run_when === 'tonight') return 'tonight';
    for (let i = 0; i < 40; i++) {
      const r: any = await rPost(`/api/work/batches/${batch.id}/run`);
      if (r.held === 'busy') {
        await sleep(1500);
        continue;
      }
      if (r.held) return r.held;
      if (!r.left) return '';
      await sleep(900);
    }
    return 'wait';
  };
  let held = await run(out.batch || {});
  if (st.follow && st.followOn) {
    const due = plusDays(st.follow.days);
    const t = await rPost('/api/work/batches', { req: newReq(), op: 'new', cids: [cid], set: { category: 'Task/Other', type, date: due, summary: st.follow.what.slice(0, 255), fundraisers: fid ? [fid] : [], completed: false, status: 'Open' } });
    held = (await run(t.batch || {})) || held;
  }
  try {
    const recent = ((await rApi('/api/work/recent')).batches || []) as any[];
    for (const r of recent) if (ids.includes(r.id)) {
      const bad = (r.items || []).find((x: any) => x.state === 'failed');
      if (bad) throw new Error(bad.error || 'Blackbaud turned it down.');
    }
  } catch (e) {
    if (e && (e as Error).message && !/recent/i.test((e as Error).message)) throw e;
  }
  toast(held === 'tonight' ? 'Call logged. It goes to Blackbaud tonight.' : 'Call logged for ' + b.name + '.', ids, false, 'wg');
  document.dispatchEvent(new CustomEvent('favor:call-logged', { detail: { cid, batches: ids } }));
}

function Body({ id, say, onClose, onDone }: { id: string; say?: string; onClose: () => void; onDone?: () => void }) {
  const { data: d } = useSuspenseQuery(prepQuery(id));
  const b = d.brief;
  const [owedRows, setOwedRows] = useState<any[]>(d.owedRows || []);
  const [outcome, setOutcome] = useState('talked');
  const [text, setText] = useState(say || '');
  const [summary, setSummary] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [follow, setFollow] = useState<Follow | null>(null);
  const [followOn, setFollowOn] = useState(true);
  const [thanked, setThanked] = useState(!!(d.owedRows && d.owedRows.length));
  const [canSpeak, setCanSpeak] = useState(false);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pop, setPop] = useState<{ el: HTMLElement; g: any } | null>(null);
  const rec = useRef<any>(null);
  const SRRef = useRef<any>(null);
  useEffect(() => {
    const w = window as any;
    SRRef.current = w.SpeechRecognition || w.webkitSpeechRecognition;
    setCanSpeak(!!SRRef.current);
    return () => {
      if (rec.current) {
        try {
          rec.current.stop();
        } catch {
          // already stopped
        }
        rec.current = null;
      }
    };
  }, []);
  const dnc = b.flags.includes('Do not call');
  const g = b.giving;
  const m = (b.monthly || []).find((x: any) => /active/i.test(x.status));
  const mic = () => {
    if (rec.current) {
      rec.current.stop();
      return;
    }
    const SR = SRRef.current;
    const r = new SR();
    rec.current = r;
    r.lang = 'en-US';
    r.continuous = true;
    r.interimResults = true;
    const base = text ? text.trim() + ' ' : '';
    r.onresult = (ev: any) => {
      let t = '';
      for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
      setText(base + t);
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
    };
    r.onerror = () => {
      rec.current = null;
      setListening(false);
      setError('The microphone is not available. Type it instead.');
    };
    setListening(true);
    setError('');
    r.start();
  };
  const write = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await rPost('/api/brief/call-summary', { cid: id, transcript: text });
      setSummary(r.summary);
      setNotes(r.notes);
      setFollow(r.followUp);
      setFollowOn(true);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  const log = async () => {
    const sum = summary === null ? text.trim().slice(0, 140) : summary;
    const nts = notes || text.trim();
    setSummary(sum);
    setNotes(nts);
    setSaving(true);
    setError('');
    try {
      await logIt(id, b, { outcome, summary: sum, notes: nts, follow, followOn, thanked });
      onClose();
      if (onDone) onDone();
    } catch (e) {
      setSaving(false);
      setError((e as Error).message || 'It was not saved. Try again.');
    }
  };
  const flagsDnc = b.flags.includes('Do not call');
  return (
    <>
      <div className="wg-dlg__head">
        <div>
          <span className="wg-kick">
            Call mode · {b.kind}
            {b.since ? ' · Partner since ' + b.since : b.onRecord ? ' · On record since ' + b.onRecord : ''}
          </span>
          <h2>{b.name}</h2>
          <p>{b.place || 'No city on file'}</p>
        </div>
        <button type="button" className="pp-iconbtn" aria-label="Close" onClick={onClose}>
          <Ic n="x" />
        </button>
      </div>
      {b.comm && b.comm.banner.show ? (
        <div className="pp-comm pp-comm--inline" role="status" data-comm-banner="call" style={{ margin: '0 20px 12px' }}>
          <span className="pp-comm__k">Contact marks</span>
          {b.comm.channels
            .filter((x: any) => x.state !== 'ok')
            .map((x: any) => (
              <p key={x.key} className={'pp-comm__row is-' + x.state}>
                <b>{x.state === 'blocked' ? 'Do not ' + x.label.toLowerCase() : x.label}</b>
                <small>{x.reasons.map((r: any) => r.text).join(' · ')}</small>
              </p>
            ))}
        </div>
      ) : null}
      <div className="cm-bar">
        {b.call && !flagsDnc ? (
          <a className="cm-dial" href={'tel:' + digits(b.call.number)}>
            <Ic n="phone" />
            Call <b>{b.call.number}</b>
          </a>
        ) : (
          <span className="cm-dial is-off">
            <Ic n="phone" />
            {dnc ? 'Do not call' : 'No phone to call'}
          </span>
        )}
        {b.flags.map((x: string) => (
          <span key={x} className="wc-tag wc-tag--warn">
            {x}
          </span>
        ))}
      </div>
      <div className="wg-dlg__body cm-grid">
        <div className="cm-left">
          {d.instruction ? (
            <div className="wg-instr" role="note">
              <b>Instruction</b>
              <span>{d.instruction.text}</span>
            </div>
          ) : null}
          {owedRows.length ? (
            <div className="cm-sec">
              <h3>Gifts to thank</h3>
              {owedRows.slice(0, 3).map((o) => (
                <div key={o.giftId + ':' + o.cid} className="cm-owe">
                  <span>
                    <b>{money(o.amount)}</b> to {o.fund || 'no fund on file'}, {fd(o.date)}
                  </span>
                  <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={(e) => setPop({ el: e.currentTarget, g: o })}>
                    Thanked
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="cm-sec">
            <h3>The call</h3>
            <Steps steps={b.steps} />
          </div>
          <div className="cm-sec">
            <h3>Giving</h3>
            <div className="wg-facts">
              <div>
                <b>{short(g.lifetime)}</b>
                <span>
                  Lifetime, {N(g.count)} {g.count === 1 ? 'gift' : 'gifts'}
                </span>
              </div>
              <div>
                <b>{short(g.last12)}</b>
                <span>
                  12 months{g.prior12 ? ', ' + short(g.prior12) + ' before' : ''}
                </span>
              </div>
              <div>
                <b>{g.last ? money(g.last.amount) : 'None'}</b>
                <span>{g.last ? 'Last gift ' + fd(g.last.date, true) + (g.last.through ? ' through ' + g.last.through : '') : g.passedOn ? 'Passes gifts on for others' : 'No gifts yet'}</span>
              </div>
              <div>
                <b>{m ? money(m.amount) : 'None'}</b>
                <span>Monthly</span>
              </div>
            </div>
          </div>
          <div className="cm-sec">
            <h3>Last contacts</h3>
            <ul className="wg-said">
              {(b.contacts || []).length ? (
                (b.contacts || []).slice(0, 3).map((c: any, i: number) => (
                  <li key={i}>
                    <b>
                      {fd(c.date, true)}, {c.category}
                    </b>{' '}
                    {c.text || c.summary || ''}
                    {c.by ? <small>{c.by}</small> : null}
                  </li>
                ))
              ) : (
                <li>No contact on file.</li>
              )}
            </ul>
          </div>
        </div>
        <div className="cm-right">
          <div className="cm-sec">
            <h3>How did it go</h3>
            <div className="pp-seg" role="group" aria-label="Result">
              {OUTCOMES.map(([k, l]) => (
                <button key={k} type="button" className={outcome === k ? 'is-on' : ''} aria-pressed={outcome === k} onClick={() => setOutcome(k)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="cm-sec">
            <h3>What happened</h3>
            <textarea id="cm-say" rows={5} placeholder="Say it or type it. A prayer request, family news, what they plan to give." value={text} onChange={(e) => setText(e.target.value)} />
            <div className="cm-tools">
              {canSpeak ? (
                <button type="button" className={'h-btn h-btn--ghost h-btn--sm' + (listening ? ' is-on' : '')} onClick={mic}>
                  <Ic n="mic" />
                  {listening ? 'Stop listening' : 'Speak it'}
                </button>
              ) : null}
              <button type="button" className="h-btn h-btn--ghost h-btn--sm" disabled={text.trim().length < 3 || busy} onClick={write}>
                {busy ? 'Writing it up' : 'Write it up'}
              </button>
            </div>
          </div>
          {summary !== null ? (
            <div className="cm-sec">
              <h3>What gets logged</h3>
              <label className="cm-lab">
                Summary
                <input type="text" id="cm-sum" maxLength={140} value={summary} onChange={(e) => setSummary(e.target.value)} />
              </label>
              <label className="cm-lab">
                Notes
                <textarea id="cm-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
              {follow ? (
                <label className="wg-check">
                  <input type="checkbox" id="cm-fu" checked={followOn} onChange={(e) => setFollowOn(e.target.checked)} /> {'Add a task: ' + follow.what + ' (in ' + follow.days + (follow.days === 1 ? ' day' : ' days') + ')'}
                </label>
              ) : null}
            </div>
          ) : null}
          <div className="cm-sec">
            <label className="wg-check">
              <input type="checkbox" id="cm-th" checked={thanked} onChange={(e) => setThanked(e.target.checked)} /> Tag it Thanked
            </label>
          </div>
          {error ? <p className="cm-err">{error}</p> : null}
          <button type="button" className="h-btn h-btn--primary cm-log" disabled={saving} onClick={log}>
            {saving ? 'Saving' : 'Log it'}
          </button>
        </div>
      </div>
      {pop ? (
        <ThankPop
          anchor={pop.el}
          g={{ giftId: pop.g.giftId, cid: pop.g.cid, name: b.name, amount: pop.g.amount, date: pop.g.date, fund: pop.g.fund, phone: b.call ? b.call.number : null, left: null, tasks: 0 }}
          onClose={() => setPop(null)}
          onDone={() => {
            setOwedRows((rows) => rows.filter((x) => x !== pop.g));
            setThanked(false);
          }}
        />
      ) : null}
    </>
  );
}

const Skel = () => (
  <div className="wg-skel">
    <i style={{ width: '30%' }} />
    <i style={{ height: 34, width: '60%' }} />
    <i style={{ height: 240 }} />
  </div>
);

export function CallMode({ id, say, onClose, onDone }: { id: string; say?: string; onClose: () => void; onDone?: () => void }) {
  useLayer(onClose);
  return BodyPortal(
    <div className="wg-layer wg-prt cm-layer">
      <div className="wg-scrim" onClick={onClose} />
      <div className="wg-dlg wg-dlg--wide wg-brief cm" role="dialog" aria-modal="true" aria-label="Call mode">
        <Boundary
          fallback={(e) => (
            <div className="wg-dlg__head">
              <div>
                <h2>{(e as ApiFail).status === 404 ? 'No partner found' : 'Call mode did not load'}</h2>
                <p>{e.message}</p>
              </div>
              <button type="button" className="pp-iconbtn" aria-label="Close" onClick={onClose}>
                <Ic n="x" />
              </button>
            </div>
          )}
        >
          <Suspense fallback={<Skel />}>
            <Body id={id} say={say} onClose={onClose} onDone={onDone} />
          </Suspense>
        </Boundary>
      </div>
    </div>
  );
}
