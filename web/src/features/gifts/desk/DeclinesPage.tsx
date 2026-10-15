// Gifts > Declines: declined recurring payments and zeroed gifts with the reason the card processor gave, the partner's phone, and a button that
// logs the follow-up (call, text, email, card or note) as an Information Update action on the partner. The follow-up is saved as a batch and
// sent to Blackbaud 15 rows at a time, with Undo. Nothing here charges a card or changes a schedule. Ported from public/js/work-declines.js.
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { BodyPortal } from '@/shell/BodyPortal';
import { Ic } from '../../partners/work/lists/icons';
import { SheetsButton, sheetScreen, useSheetSource } from '../../partners/work/lists/legacy';
import { UNDONE_EVENT, driveBatch, failureOf, showToast } from '../../partners/work/lists/toast';
import { WorkError, reqId, workPost } from '../../partners/work/lists/core';
import { fd, money } from '../../partners/record/lib';
import { DeskFrame, n0, type DeskSearch } from './kit';
import { HOWS, HOW_LABEL, KINDS, PAGE, STATUS, declinesQuery, inKind, telHref, type DeclineRow, type DeclinesData, type How } from './declines';

const toast = (msg: string, bids?: string[] | null, bad?: boolean) => showToast(msg, { undo: bids && bids.length ? { batches: bids } : null, bad });

export function DeclinesPage({ search }: { search: DeskSearch }) {
  return (
    <DeskFrame tab="declines">
      <Desk as={search.as || ''} />
    </DeskFrame>
  );
}

const Row = memo(function Row({ r, st, window: win, onLog }: { r: DeclineRow; st: string; window: number; onLog: (r: DeclineRow, el: HTMLElement) => void }) {
  const amt = r.amount != null && r.amount > 0 ? money(r.amount) : '';
  const hard = r.kind === 'hard';
  const who = r.holders.length ? r.holders.join(', ') : '';
  const tag =
    st === 'paid' ? (
      <span className="wc-tag wc-tag--done">Paid since {fd(r.paidSince)}</span>
    ) : st === 'ended' ? (
      <span className="wc-tag">Schedule {String(r.scheduleStatus || 'ended').toLowerCase()}</span>
    ) : st === 'done' ? (
      <span className="wc-tag wc-tag--done">{STATUS[r.status] || 'Closed'}</span>
    ) : null;
  return (
    <div className="wg-row wfn-row" data-key={r.key}>
      <div className="wfn-who">
        <a className="wg-name" href={'/work/partner/' + r.cid} data-partner-id={r.cid}>
          {r.name}
        </a>
        <span className="wg-sub">
          {r.place ? r.place + ' · ' : ''}
          {r.method}
          {amt ? ' · ' + amt : ''}
        </span>
        {who ? <span className="wg-sub">Held by {who}</span> : null}
      </div>
      <div className="wfn-why">
        <span className={'wc-tag' + (hard ? ' wc-tag--gift' : '')}>{r.kindLabel}</span>
        {tag}
        <span className="wg-sub">{r.reason || ''}</span>
        {r.attempts > 1 ? (
          <span className="wg-sub">
            {r.attempts} declines in {win} days
          </span>
        ) : null}
      </div>
      <div className="wfn-due">
        <b className={r.age >= 7 && st === 'open' ? 'is-late' : ''}>{fd(r.date)}</b>
        <span className="wg-sub">{r.age === 0 ? 'Today' : r.age === 1 ? 'Yesterday' : r.age + ' days ago'}</span>
      </div>
      <div className="wfn-last">
        <span className="wg-sub">
          {r.last ? `Last: ${HOW_LABEL[r.last.how] || r.last.how}${r.last.outcome === 'left' ? ', left a message' : ''} ${fd(r.last.at.slice(0, 10))} by ${r.last.by}` : 'No follow-up yet'}
        </span>
      </div>
      <div className="wg-acts">
        {r.phone ? (
          <a className="wg-icon" href={telHref(r.phone)} title={'Call ' + r.phone} aria-label={'Call ' + r.name}>
            <Ic n="phone" />
          </a>
        ) : (
          <span className="wg-icon is-off" title="No phone to call">
            <Ic n="phone" />
          </span>
        )}
        <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={(e) => onLog(r, e.currentTarget)}>
          <Ic n="check" />
          Log
        </button>
      </div>
    </div>
  );
});

function Desk({ as }: { as: string }) {
  const q0 = declinesQuery(as);
  const { data: d } = useSuspenseQuery(q0);
  const qc = useQueryClient();
  const [kind, setKind] = useState('');
  const [closed, setClosed] = useState(false);
  const [qIn, setQ] = useState('');
  const q = useDeferredValue(qIn);
  const [shown, setShown] = useState(PAGE);
  // Declines closed on this page since it last read the list. A read from the server starts it again.
  const [local, setLocal] = useState<Record<string, string>>({});
  const [pop, setPop] = useState<{ row: DeclineRow; anchor: HTMLElement } | null>(null);

  const stateOf = useCallback((r: DeclineRow) => local[r.key] || r.state, [local]);
  const open = useMemo(() => d.rows.filter((r) => stateOf(r) === 'open'), [d, stateOf]);
  const list = useMemo(() => {
    const needle = q.toLowerCase();
    return d.rows.filter((r) => (closed ? stateOf(r) !== 'open' : stateOf(r) === 'open') && inKind(r, kind) && (!q || (r.name + ' ' + r.place + ' ' + r.reason).toLowerCase().includes(needle)));
  }, [d, closed, kind, q, stateOf]);

  const reload = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: q0.queryKey });
    setLocal({});
    setShown(PAGE);
  }, [qc, q0.queryKey]);

  useEffect(() => {
    const on = () => void reload();
    document.addEventListener(UNDONE_EVENT, on);
    return () => document.removeEventListener(UNDONE_EVENT, on);
  }, [reload]);

  useSheetSource('declines', () => {
    const cols = [
      { key: 'partner', label: 'Partner', type: 'text' },
      { key: 'place', label: 'Place', type: 'text' },
      { key: 'kind', label: 'Kind', type: 'text' },
      { key: 'reason', label: 'Reason', type: 'text' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'method', label: 'Method', type: 'text' },
      { key: 'amount', label: 'Schedule amount', type: 'currency' },
      { key: 'attempts', label: 'Declines', type: 'number' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'holder', label: 'Held by', type: 'text' },
      { key: 'state', label: 'State', type: 'text' },
    ];
    const rows = list.map((r) => {
      const s = stateOf(r);
      return {
        partner: r.name,
        place: r.place,
        kind: r.kindLabel,
        reason: r.reason,
        date: r.date,
        method: r.method,
        amount: r.amount,
        attempts: r.attempts,
        phone: r.phone || '',
        email: r.email || '',
        holder: r.holders.join(', '),
        state: s === 'open' ? 'Open' : s === 'paid' ? 'Paid since' : s === 'ended' ? 'Schedule ended' : STATUS[r.status] || 'Closed',
      };
    });
    return sheetScreen('Declines', [{ name: 'Declines', columns: cols, rows }], { filters: (closed ? 'Closed or paid' : 'Open') + (kind ? ', ' + KINDS[kind] : ''), classes: ['partner'] });
  });

  /** Save one follow-up, show it at once, then send it to Blackbaud. */
  const save = useCallback(
    async (r: DeclineRow, how: How, reach: string, status: string, line: string) => {
      const left = how === 'call' && reach === 'left';
      toast('Saving…');
      let out: any;
      try {
        out = await workPost('/api/work/declines/log', { giftId: r.giftId, cid: r.cid, how, outcome: how === 'call' ? reach : '', status, line, req: reqId() });
      } catch (e) {
        toast((e as Error).message, null, true);
        if (e instanceof WorkError && e.status === 409) await reload();
        return;
      }
      if (!out.batch) {
        toast('That follow-up was already saved.', null, true);
        return;
      }
      const bid: string = out.batch.id;
      if (!left && status !== 'open') setLocal((l) => ({ ...l, [r.key]: 'done' }));
      qc.setQueryData(q0.queryKey, (old: DeclinesData | undefined) =>
        old
          ? {
              ...old,
              rows: old.rows.map((x) =>
                x.key === r.key ? { ...x, last: { how, at: new Date().toISOString(), by: 'You', outcome: left ? 'left' : 'sent' }, status: !left && status !== 'open' ? status : x.status } : x
              ),
            }
          : old
      );
      let held = '';
      try {
        held = out.batch.run_when !== 'tonight' ? await driveBatch(bid) : 'tonight';
      } catch (e) {
        toast((e as Error).message + ' It is saved, and Recent can send it again.', [bid], true);
        return;
      }
      const bad = await failureOf([bid]);
      if (bad) {
        toast(`${bad} Nothing was lost. Recent has Try again.`, [bid], true);
        await reload();
        return;
      }
      const what = left ? `Message logged for ${r.name}. Call again tomorrow` : `Follow-up logged for ${r.name}`;
      toast(held === 'tonight' ? `${what}. It goes to Blackbaud tonight.` : held ? `${what}. Blackbaud is slow, so the rest goes when it answers.` : what + '.', [bid]);
    },
    [qc, q0.queryKey, reload]
  );

  const closePop = useCallback(() => setPop(null), []);
  const onLog = useCallback((r: DeclineRow, anchor: HTMLElement) => setPop((p) => (p && p.row.key === r.key ? p : { row: r, anchor })), []);

  const hard = open.filter((r) => r.kind === 'hard').length;
  const soft = open.filter((r) => r.kind === 'soft').length;
  const other = open.length - hard - soft;
  const stats: [string, string, number, boolean?][] = [
    ['', 'Open', open.length],
    ['hard', KINDS.hard, hard, hard > 0],
    ['soft', KINDS.soft, soft],
    ['other', KINDS.other, other],
    ['', 'Closed this week', d.stats.closedWeek],
  ];

  return (
    <>
      <div className="h-card wc-band wg-band" style={{ '--n': 5 } as React.CSSProperties}>
        {stats.map(([k, l, n, warn], i) => (
          <button
            type="button"
            key={i}
            className={'wc-stat' + (k && kind === k ? ' is-on' : '') + (warn ? ' is-warn' : '')}
            onClick={() => {
              if (!k) return;
              setKind((c) => (c === k ? '' : k));
              setShown(PAGE);
            }}
          >
            <b>{n}</b>
            <span>{l}</span>
          </button>
        ))}
      </div>
      <section className="h-card wc-sheet" aria-label="Declines">
        <div className="wg-tools">
          <div className="pp-seg" role="group" aria-label="Which list">
            <button
              type="button"
              className={!closed ? 'is-on' : ''}
              onClick={() => {
                setClosed(false);
                setShown(PAGE);
              }}
            >
              Open
            </button>
            <button
              type="button"
              className={closed ? 'is-on' : ''}
              onClick={() => {
                setClosed(true);
                setShown(PAGE);
              }}
            >
              Closed or paid
            </button>
          </div>
          <label className="wc-find">
            <Ic n="search" />
            <input
              type="search"
              id="wfn-q"
              placeholder="Find a partner"
              value={qIn}
              onChange={(e) => {
                setQ(e.target.value);
                setShown(PAGE);
              }}
              autoComplete="off"
            />
          </label>
          {kind ? (
            <button
              type="button"
              className="wcd-chip"
              onClick={() => {
                setKind('');
                setShown(PAGE);
              }}
            >
              <Ic n="x" />
              {KINDS[kind]}
            </button>
          ) : null}
          <span className="wg-spacer" />
          <SheetsButton name="declines" />
        </div>
        <div className="wg-list">
          {list.slice(0, shown).map((r) => (
            <Row key={r.key} r={r} st={stateOf(r)} window={d.window} onLog={onLog} />
          ))}
          {!list.length ? (
            <div className="wg-empty">
              <b>{closed ? 'Nothing closed yet' : 'No open declines'}</b>
              {closed ? 'Declines you close, and declines that were paid since, show here.' : 'New declines appear after the Blackbaud copy refreshes at 5 AM and 5 PM.'}
            </div>
          ) : null}
          {list.length > shown ? (
            <div className="wg-group">
              <span>{list.length - shown} more</span>
              <button type="button" onClick={() => setShown((n) => n + PAGE)}>
                Show {Math.min(100, list.length - shown)} more
              </button>
            </div>
          ) : null}
        </div>
        <div className="wg-foot">
          <span>
            {n0(list.length)} {list.length === 1 ? 'decline' : 'declines'} from the last {d.window} days. Each follow-up you log adds an Information Update action on the partner. A decline clears itself once a later payment on the same schedule goes through.
          </span>
        </div>
      </section>
      {pop ? (
        <LogPop
          row={pop.row}
          anchor={pop.anchor}
          onClose={closePop}
          onSave={(how, reach, status, line) => {
            const r = pop.row;
            setPop(null);
            void save(r, how, reach, status, line);
          }}
        />
      ) : null}
    </>
  );
}

/** The follow-up form: a small box under the Log button (a sheet from the foot on a phone). */
function LogPop(p: { row: DeclineRow; anchor: HTMLElement; onClose: () => void; onSave: (how: How, reach: string, status: string, line: string) => void }) {
  return BodyPortal(<PopBox {...p} />);
}

function PopBox({ row: r, anchor, onClose, onSave }: { row: DeclineRow; anchor: HTMLElement; onClose: () => void; onSave: (how: How, reach: string, status: string, line: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [how, setHow] = useState<How>(r.phone ? 'call' : r.email ? 'email' : 'note');
  const [reach, setReach] = useState('talked');
  const [status, setStatus] = useState('open');
  const [line, setLine] = useState('');
  const attempt = how === 'call' && reach === 'left';
  const off = (h: string) => (h === 'call' || h === 'text' ? !r.phone : h === 'email' ? !r.email : h === 'card' ? !r.hasAddress : false);
  const inp = useRef<HTMLInputElement>(null);

  // Place the box under the button, or above it near the foot of the screen. Runs again when the form changes height.
  useLayoutEffect(() => {
    const m = box.current;
    if (!m) return;
    const b = anchor.getBoundingClientRect();
    const w = Math.min(360, innerWidth - 24);
    m.style.width = w + 'px';
    m.style.left = Math.max(12, Math.min(b.left - w + b.width, innerWidth - w - 12)) + 'px';
    const h = m.offsetHeight;
    let top = b.bottom + 8;
    if (top + h > innerHeight - 12) top = Math.max(12, b.top - h - 8);
    m.style.top = top + 'px';
  }, [anchor, how, reach]);

  useEffect(() => {
    inp.current?.focus();
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const away = (e: MouseEvent) => {
      const path = e.composedPath ? e.composedPath() : [];
      if (!path.includes(box.current as EventTarget) && !path.includes(anchor)) onClose();
    };
    document.addEventListener('keydown', key, true);
    // The press that opened the box has already happened; listen for the next one.
    const t = setTimeout(() => document.addEventListener('click', away), 0);
    addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('click', away);
      clearTimeout(t);
      removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  const go = () => {
    const t = line.trim();
    if (how === 'note' && !t) {
      inp.current?.focus();
      return;
    }
    onSave(how, reach, status, t);
  };

  return (
    <div ref={box} className="wg-pop" role="dialog" aria-label={`Log a follow-up for ${r.name}`}>
      <h4>
        <span>
          {r.name}
          <small>
            {r.kindLabel} · {fd(r.date)}
            {r.phone && (how === 'call' || how === 'text') ? ' · ' + r.phone : ''}
          </small>
        </span>
        <button type="button" className="pp-iconbtn" onClick={onClose} aria-label="Close">
          <Ic n="x" />
        </button>
      </h4>
      <div className="pp-seg" role="group" aria-label="How">
        {HOWS.map((h) => (
          <button type="button" key={h} className={how === h ? 'is-on' : ''} disabled={off(h)} title={off(h) ? 'Nothing on file for this' : undefined} onClick={() => setHow(h)}>
            {HOW_LABEL[h]}
          </button>
        ))}
      </div>
      {how === 'call' ? (
        <div className="pp-seg" role="group" aria-label="Result">
          <button type="button" className={reach === 'talked' ? 'is-on' : ''} onClick={() => setReach('talked')}>
            Talked
          </button>
          <button type="button" className={reach === 'left' ? 'is-on' : ''} onClick={() => setReach('left')}>
            Left a message
          </button>
        </div>
      ) : null}
      <input
        ref={inp}
        type="text"
        id="wfn-line"
        maxLength={240}
        placeholder={how === 'note' ? 'What happened' : attempt ? 'Anything to note' : 'What was said'}
        value={line}
        onChange={(e) => setLine(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            go();
          }
        }}
        autoComplete="off"
      />
      {attempt ? null : (
        <label className="wfn-status">
          <span>Where it stands</span>
          <select id="wfn-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="wg-pop__foot">
        <small>{attempt ? 'Logs the attempt. The decline stays open and a reminder comes tomorrow.' : ''}</small>
        <button type="button" className="h-btn h-btn--primary h-btn--sm" onClick={go}>
          {attempt ? 'Save attempt' : 'Save'}
        </button>
      </div>
    </div>
  );
}
