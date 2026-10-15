// A deposit that has been sent: the steps of the batch, its gifts, the Daily Revenue Report and the rejected rows. Follows status() and
// revenueCard() in public/js/gift-entry.js. The page asks Blackbaud's batch for its state when it opens and every minute after.
import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from './Icon';
import { Pill } from './Home';
import { geKeys, geWrites, revenueQuery, useDepositCache } from './data';
import { canUndoBatch, etTime, hasRevenue, money, nameOf, polls, sentStatus, timelineOf } from './logic';
import { geToast } from './toast';
import type { DepositView, GeIndex } from './types';

/** Set when a send has just run the deposit, so opening the status screen does not run it a second time. */
export const ranAt = new Map<string, number>();

export function RejectedLine({ v }: { v: DepositView }) {
  if (!v.rejected || !v.rejected.length) return null;
  return (
    <section className="h-card ge-card">
      <div className="ge-hd">
        <h2>Rejected</h2>
        <span className="sp"></span>
        <span className="ge-muted">
          {v.rejected.length} · {money(v.rejected.reduce((s, x) => s + (x.amountCents || 0), 0))}
        </span>
      </div>
      {v.rejected.map((x) => (
        <div className="ge-sumrow" key={x.id}>
          <b>{x.payer || 'Gift ' + x.seq}</b>
          <span className="f">
            {x.reason} · {nameOf(x.by || '')}
          </span>
          <span className="a ge-money">{x.amountCents != null ? money(x.amountCents) : ''}</span>
        </div>
      ))}
    </section>
  );
}

function RevenueCard({ id, status }: { id: string; status: string }) {
  const on = hasRevenue(status);
  const q = useQuery({ ...revenueQuery(id, status), enabled: on });
  if (!on) return null;
  const head = (
    <div className="ge-hd">
      <h2>Daily revenue report</h2>
    </div>
  );
  if (q.isError) {
    return (
      <section className="h-card ge-card">
        {head}
        <div className="ge-note ge-note--red">{(q.error as Error).message || 'The report did not build. Try Check now.'}</div>
      </section>
    );
  }
  const r = q.data;
  if (!r) {
    return (
      <section className="h-card ge-card">
        {head}
        <div className="ge-muted">Building from this batch</div>
      </section>
    );
  }
  const copy = async () => {
    if (!r.text) return;
    try {
      await navigator.clipboard.writeText(r.text);
      geToast('Copied. Paste it in WhatsApp.');
    } catch {
      geToast('Copy did not work. Open The post and copy it.');
    }
  };
  return (
    <section className="h-card ge-card ge-rev">
      <div className="ge-hd">
        <h2>Daily revenue report</h2>
        <span className="sp"></span>
        <button className="ge-btn ge-btn--primary" type="button" data-rev-copy="" onClick={copy}>
          Copy for WhatsApp
        </button>
      </div>
      <div className="ge-tape">
        <div className="ge-tile">
          <span className="n ge-money">{money(Math.round(r.total * 100))}</span>
          <span className="l">{r.dateLabel}</span>
        </div>
        <div className="ge-tile">
          <span className="n">{Number(r.count).toLocaleString('en-US')}</span>
          <span className="l">Gifts in this batch</span>
        </div>
        <div className="ge-tile">
          <span className="n">{Number(r.highlights).toLocaleString('en-US')}</span>
          <span className="l">$1,000 and up</span>
        </div>
      </div>
      {r.blocks
        .filter((b) => b.total)
        .map((b) => (
          <div className="ge-sumrow" key={b.name}>
            <b>{b.name}</b>
            <span className="f">{b.entries ? b.entries + ' highlighted' : ''}</span>
            <span className="a ge-money">{money(Math.round(b.total * 100))}</span>
          </div>
        ))}
      {r.noPartner ? (
        <div className="ge-note" style={{ marginTop: 8 }}>
          {r.noPartner} {r.noPartner === 1 ? 'gift has' : 'gifts have'} no partner and {r.noPartner === 1 ? 'is' : 'are'} not in the report.
        </div>
      ) : null}
      <details className="ge-revtext">
        <summary>The post</summary>
        <pre>{r.text}</pre>
      </details>
    </section>
  );
}

export function Status({ v, me, id, goHome }: { v: DepositView; me: GeIndex['me']; id: string; goHome: () => void }) {
  const d = v.deposit;
  const cache = useDepositCache();
  const qc = useQueryClient();
  const busy = useRef(false);

  const run = async (quiet: boolean) => {
    if (busy.current) return;
    busy.current = true;
    try {
      cache.set(id, await geWrites.run(id, !quiet));
    } catch (e) {
      if (!quiet) geToast((e as Error).message);
    } finally {
      busy.current = false;
    }
  };

  // Opening a sent deposit reads its batch from Blackbaud once (unless a send just did), then every minute while it is in flight.
  useEffect(() => {
    const t = ranAt.get(id);
    if (!(t && Date.now() - t < 8000)) void run(true);
    ranAt.delete(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (!polls(d.status)) return;
    const t = setInterval(() => {
      if (document.hidden || busy.current) return;
      void run(true);
    }, 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.status, id]);

  const tl = timelineOf(v);
  const wm = v.watch && v.watch.mismatch;
  const canUndo = canUndoBatch(d.status, me.canPost);

  const retry = async () => {
    try {
      await geWrites.retry(id);
      await run(false);
    } catch (er) {
      geToast((er as Error).message);
    }
  };
  const undo = async () => {
    const reason = prompt('Why are you taking the batch back?');
    if (!reason || !reason.trim()) return;
    try {
      const out = await geWrites.undo(id, reason);
      cache.set(id, out);
      geToast('Batch ' + (out.undone.batch || '') + ' taken back');
      await cache.refetch(id);
      void qc.invalidateQueries({ queryKey: geKeys.revenue(id, d.status) });
    } catch (e) {
      geToast((e as Error).message);
    }
  };

  return (
    <>
      <div>
        <button type="button" className="ge-link" data-home="" onClick={goHome}>
          <Icon n="back" />
          Gift entry
        </button>
      </div>
      <section className="h-card ge-card">
        <div className="ge-hd">
          <h2>{d.name}</h2>
          <Pill status={d.status} />
          <span className="sp"></span>
          {d.status === 'needs_person' && me.canPost ? (
            <button type="button" className="ge-btn ge-btn--primary" data-retry="" onClick={retry}>
              Try again
            </button>
          ) : null}
          <button type="button" className="ge-link" data-refresh="" onClick={() => void run(false)}>
            Check now
          </button>
          {canUndo ? (
            <button type="button" className="ge-link ge-link--red" data-undo="" onClick={undo}>
              Take batch back
            </button>
          ) : null}
        </div>
        <div className="ge-muted ge-money">
          {money(d.tapeCents)} · {d.tapeCount} items{d.undoneAt ? ' · taken back ' + etTime(d.undoneAt) + ' by ' + d.undoneBy + ': ' + d.undoneReason : ''}
        </div>
        {d.note ? (
          <div className="ge-note ge-note--red" style={{ marginTop: 12 }}>
            {d.note}
          </div>
        ) : null}
        {wm ? (
          <div className="ge-note" style={{ marginTop: 12 }}>
            {wm}
          </div>
        ) : null}
        <div className="ge-steps" style={{ marginTop: 8 }}>
          {tl.map((x, i) => (
            <div className={'ge-step is-' + x.k} key={x.t}>
              <span className="d">{x.k === 'done' ? <Icon n="check" /> : i + 1}</span>
              <div>
                <b>{x.t}</b>
                <span>{x.s}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="h-card ge-card">
        <div className="ge-hd">
          <h2>Gifts</h2>
          <span className="sp"></span>
          <span className="ge-muted">
            {v.rows.length} · {money(v.tape.cents)}
          </span>
        </div>
        {v.rows.map((r) => (
          <div className="ge-sumrow" key={r.id}>
            <b>{r.payer || 'Gift ' + r.seq}</b>
            <span className="f">
              {r.partner && r.partner.id ? (
                <a href={'/work/partner/' + encodeURIComponent(r.partner.id)} data-partner-id={r.partner.id}>
                  {r.partner.name}
                </a>
              ) : r.partner ? (
                r.partner.name
              ) : (
                'No partner'
              )}{' '}
              · {sentStatus(r.status)}
              {r.confirmedBy ? ' · approved by ' + nameOf(r.confirmedBy) : ''}
              {r.error ? ' · ' + r.error : ''}
            </span>
            <span className="a ge-money">{money(r.amountCents)}</span>
          </div>
        ))}
      </section>
      <div id="ge-revenue">
        <RevenueCard id={id} status={d.status} />
      </div>
      <RejectedLine v={v} />
    </>
  );
}
