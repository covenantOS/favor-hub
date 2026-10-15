// The call-prep brief: one screen before a call or a visit (port of public/js/prep.js). Reads GET /api/work/prep/:id (the D1 copy of
// Blackbaud plus the partner's notes) and sets the call in Partner Care's order: Thank, Pray, Report, Ask, Thank, Pray.
import { Suspense, useEffect, useState } from 'react';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { BodyPortal } from '@/shell/BodyPortal';
import { Boundary } from '../record/Boundary';
import { Ic } from '../record/Ic';
import { ApiFail, N, dayn, digits, fd, lateText, rGet, short, money } from '../record/lib';
import { openPartner } from '../record/drawerStore';
import { ThankPop } from './thank';

export const prepQuery = (id: string) =>
  queryOptions({ queryKey: ['pr', 'prep', id], queryFn: async () => (await rGet('/api/work/prep/' + encodeURIComponent(id))) as { brief: any; instruction: { text: string } | null; owedRows: any[] }, staleTime: 0, gcTime: 30_000 });

export function Steps({ steps }: { steps: any[] }) {
  return (
    <ol className="wg-steps">
      {steps.map((s, i) => (
        <li key={i}>
          <div>
            <b>{s.title}</b>
            <p>
              {s.pre ? s.pre : ''}
              {s.strong ? <em>{s.strong}</em> : null}
              {s.post ? s.post : ''}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Locks the page behind a tool and closes it on Escape. */
export function useLayer(onClose: () => void) {
  useEffect(() => {
    document.documentElement.classList.add('wg-locked');
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.documentElement.classList.remove('wg-locked');
      document.removeEventListener('keydown', key, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function Brief({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: d } = useSuspenseQuery(prepQuery(id));
  const b = d.brief;
  const [thanked, setThanked] = useState(false);
  const [pop, setPop] = useState<HTMLElement | null>(null);
  const gifts = b.giving;
  const house = b.household && b.household.length ? b.household.map((h: any) => `${h.relation || 'Household'} ${h.name}`).join(', ') : 'No household on file';
  const dnc = b.flags.includes('Do not call');
  const dne = b.flags.includes('Do not email');
  const owedRows: any[] = thanked ? [] : d.owedRows || [];
  const owed = owedRows.length ? owedRows.slice().sort((a, c) => (a.date < c.date ? -1 : 1))[0] : null;
  const m = (b.monthly || []).find((x: any) => /active/i.test(x.status)) || (b.monthly || [])[0];
  const monthly = m ? `${money(m.amount)} a month${m.status && !/active/i.test(m.status) ? ', ' + String(m.status).toLowerCase() : ''}${m.since ? ', since ' + fd(m.since, true) : ''}` : 'None';
  const iw = b.iwave && b.iwave.overall != null ? `${b.iwave.overall} of 10${b.iwave.band ? ' · ' + b.iwave.band : ''}` : 'Not rated';
  const steps = thanked ? b.steps.map((s: any, i: number) => (i === 0 ? { n: 1, title: 'Thank', post: 'Thanked just now.' } : s)) : b.steps;
  return (
    <>
      <div className="wg-dlg__head">
        <div>
          <span className="wg-kick">
            Call prep · {b.kind} · {b.lookup}
            {b.since ? ' · Partner since ' + b.since : b.onRecord ? ' · On record since ' + b.onRecord : ''}
          </span>
          <h2>{b.name}</h2>
          <p>{[b.place || 'No city on file', house].join(' · ')}</p>
        </div>
        <button type="button" className="pp-iconbtn" aria-label="Close (Esc)" onClick={onClose}>
          <Ic n="x" />
        </button>
      </div>
      <div className="wg-brief__acts">
        {b.call && !dnc ? (
          <a className="pp-tap" href={'tel:' + digits(b.call.number)}>
            <Ic n="phone" />
            Call <small>{b.call.number}</small>
          </a>
        ) : (
          <span className="pp-tap is-off">
            <Ic n="phone" />
            {dnc ? 'Do not call' : 'No phone to call'}
          </span>
        )}
        {b.text && !dnc ? (
          <a className="pp-tap" href={'sms:' + digits(b.text.number)}>
            <Ic n="text" />
            Text
          </a>
        ) : null}
        <button
          type="button"
          className="h-btn h-btn--primary h-btn--sm"
          onClick={() => {
            onClose();
            openPartner(id, { compose: 'contact' });
          }}
        >
          <Ic n="plus" />
          Log this call
        </button>
        <button
          type="button"
          className="h-btn h-btn--ghost h-btn--sm"
          onClick={() => {
            onClose();
            openPartner(id, { compose: 'note' });
          }}
        >
          <Ic n="plus" />
          Add a note
        </button>
        {owed ? (
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={(e) => setPop(e.currentTarget)}>
            <Ic n="check" />
            Thank
            <Ic n="down" cls="wg-caret" />
          </button>
        ) : null}
        <button
          type="button"
          className="h-btn h-btn--ghost h-btn--sm"
          onClick={() => {
            document.documentElement.classList.add('wg-printing');
            setTimeout(() => {
              window.print();
              setTimeout(() => document.documentElement.classList.remove('wg-printing'), 400);
            }, 50);
          }}
        >
          <Ic n="print" />
          Print
        </button>
        <button
          type="button"
          className="h-btn h-btn--ghost h-btn--sm"
          onClick={() => {
            onClose();
            openPartner(id);
          }}
        >
          <Ic n="expand" />
          Partner
        </button>
      </div>
      {d.instruction ? (
        <div className="wg-instr" role="note">
          <b>Instruction</b>
          <span>{d.instruction.text}</span>
        </div>
      ) : null}
      <div className="wg-dlg__body">
        <div className="wg-brief__grid">
          <div className="wg-bsec">
            <h3>The call</h3>
            <Steps steps={steps} />
            {b.notesLive ? null : <p className="wg-note">Notes on the partner record did not load, so the prayer line reads the logged contacts only.</p>}
          </div>
          <div>
            {b.flags.length ? (
              <div className="wg-bsec">
                <div className="wg-alert">
                  {b.flags.map((x: string) => (
                    <span key={x} className="wc-tag wc-tag--warn">
                      {x}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="wg-bsec">
              <h3>Giving</h3>
              <div className="wg-facts">
                <div>
                  <b>{short(gifts.lifetime)}</b>
                  <span>
                    Lifetime, {N(gifts.count)} {gifts.count === 1 ? 'gift' : 'gifts'}
                  </span>
                </div>
                <div>
                  <b>{short(gifts.last12)}</b>
                  <span>
                    12 months{gifts.prior12 ? ', ' + short(gifts.prior12) + ' the year before' : ''}
                  </span>
                </div>
                <div>
                  <b>{gifts.largest ? short(gifts.largest.amount) : '-'}</b>
                  <span>
                    Largest{gifts.largest ? ', ' + fd(gifts.largest.date, true) : ''}
                  </span>
                </div>
              </div>
            </div>
            <div className="wg-bsec">
              <dl className="wg-kv">
                <dt>Gives to</dt>
                <dd>{b.gives ? b.gives.fund : gifts.last && gifts.last.fund ? gifts.last.fund : 'No designation on record'}</dd>
                <dt>Monthly</dt>
                <dd>{monthly}</dd>
                <dt>iWave</dt>
                <dd>{iw}</dd>
                <dt>Email</dt>
                <dd className={dne ? 'is-bad' : ''}>{dne ? 'Do not email' : b.email || 'None on file'}</dd>
              </dl>
            </div>
            <div className="wg-bsec">
              <h3>Last contacts</h3>
              <ul className="wg-said">
                {b.contacts.length ? (
                  b.contacts.map((c: any, i: number) => (
                    <li key={i}>
                      <b>
                        {fd(c.date, true)} · {c.category}
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
            <div className="wg-bsec">
              <h3>Open tasks</h3>
              <ul className="wg-said">
                {b.open.length ? (
                  b.open.map((t: any, i: number) => (
                    <li key={i}>
                      <b>{t.what}</b> · {t.due && dayn(t.due) < 0 ? <span className="is-late">{lateText(-dayn(t.due))}</span> : 'due ' + fd(t.due, true)}
                    </li>
                  ))
                ) : (
                  <li>None.</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      </div>
      {pop && owed ? (
        <ThankPop
          anchor={pop}
          g={{ giftId: owed.giftId, cid: owed.cid, name: b.name, amount: owed.amount, date: owed.date, fund: owed.fund, phone: b.call ? b.call.number : null }}
          onClose={() => setPop(null)}
          onDone={() => setThanked(true)}
        />
      ) : null}
    </>
  );
}

const Skel = () => (
  <div className="wg-skel">
    <i style={{ width: '30%' }} />
    <i style={{ height: 34, width: '60%' }} />
    <i style={{ height: 200 }} />
  </div>
);

export function Prep({ id, onClose }: { id: string; onClose: () => void }) {
  useLayer(onClose);
  return BodyPortal(
    <div className="wg-layer wg-prt">
      <div className="wg-scrim" onClick={onClose} />
      <div className="wg-dlg wg-dlg--wide wg-brief" role="dialog" aria-modal="true" aria-label="Call prep">
        <Boundary
          fallback={(e) => (
            <div className="wg-dlg__head">
              <div>
                <h2>{(e as ApiFail).status === 404 ? 'No partner found' : 'The brief did not load'}</h2>
                <p>{e.message}</p>
              </div>
              <button type="button" className="pp-iconbtn" aria-label="Close" onClick={onClose}>
                <Ic n="x" />
              </button>
            </div>
          )}
        >
          <Suspense fallback={<Skel />}>
            <Brief id={id} onClose={onClose} />
          </Suspense>
        </Boundary>
      </div>
    </div>
  );
}
