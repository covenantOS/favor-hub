// Communication picture: every touch with one partner in the last 12 months and the thank-you count against the yearly target
// (port of public/js/comm-picture.js). Reads GET /api/work/partners/:id/comm. The No texts flag posts to /api/work/cadence/notext.
import { Suspense, useState } from 'react';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { commQuery } from './queries';
import { fd, rPost } from './lib';

const PLURAL: Record<string, [string, string]> = {
  call: ['call', 'calls'],
  text: ['text', 'texts'],
  email: ['email', 'emails'],
  card: ['card or mailing', 'cards or mailings'],
  meeting: ['meeting', 'meetings'],
  letter: ['HQ letter', 'HQ letters'],
  receipt: ['receipt', 'receipts'],
};
const KIND: Record<string, string> = { text: 'Text', call: 'Call', email: 'Email', card: 'Card or mailing', meeting: 'Meeting', letter: 'HQ letter' };

function Picture({ id, canFlag }: { id: string; canFlag: boolean }) {
  const qc = useQueryClient();
  const { data: c } = useSuspenseQuery(commQuery(id));
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const t = c.tally;
  const kinds = t.byKind.map((k: any) => `${k.n} ${PLURAL[k.kind][k.n === 1 ? 0 : 1]}`).join(' · ');
  const shown = all ? c.touches : c.touches.slice(0, 8);
  const flag = async (on: boolean) => {
    setBusy(true);
    setErr('');
    try {
      await rPost('/api/work/cadence/notext', { cid: id, on, reason: 'Replied STOP' });
      qc.setQueryData(commQuery(id).queryKey, { ...c, noText: on ? { reason: 'Replied STOP', by: '', at: '' } : null });
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <div className="cm" data-cm={c.cid}>
      <div className="cm-head">
        <div className="cm-count">
          {t.count > t.target ? (
            <>
              <b>{t.count}</b>
              <span>
                thank-yous in {t.year}, past the target of {t.target}
              </span>
            </>
          ) : (
            <>
              <b>
                {t.count} of {t.target}
              </b>
              <span>thank-yous in {t.year}</span>
            </>
          )}
        </div>
        {c.noText ? (
          <button type="button" className="cm-flag is-on" title="Clear the flag" disabled={busy} onClick={() => flag(false)}>
            {err || `No texts: ${c.noText.reason} · Clear`}
          </button>
        ) : canFlag ? (
          <button type="button" className="cm-flag" disabled={busy} onClick={() => flag(true)}>
            {err || 'Mark no texts'}
          </button>
        ) : null}
      </div>
      <div className="cm-tally" role="img" aria-label={`${t.count} thank-yous, target ${t.target}`}>
        {Array.from({ length: t.target }, (_, i) => (
          <span key={i} className={i < t.count ? 'on' : ''} />
        ))}
      </div>
      <div className="cm-sub">{[kinds, t.last12 + ' in the last 12 months'].filter(Boolean).join(' · ')}</div>
      <ul className="cm-list">
        {shown.length ? (
          shown.map((x: any, i: number) => (
            <li key={i} className={'cm-row' + (x.left ? ' is-left' : '')}>
              <span className="cm-d">{fd(x.date)}</span>
              <span className="cm-k">
                {KIND[x.kind] || 'Receipt'}
                {x.left ? ' · left a message' : ''}
              </span>
              <span className="cm-w">{x.what}</span>
              <span className="cm-s">
                {x.thanks ? (
                  <>
                    <em>Thank-you</em> ·{' '}
                  </>
                ) : null}
                {x.source}
              </span>
            </li>
          ))
        ) : (
          <li className="cm-empty">No contact in the last 12 months.</li>
        )}
      </ul>
      {c.touches.length > 8 && !all ? (
        <button type="button" className="cm-more" onClick={() => setAll(true)}>
          Show {c.touches.length - 8} older
        </button>
      ) : null}
      <div className="cm-foot">Not listed: monthly appeal mailings and GoHighLevel emails</div>
    </div>
  );
}

const Loading = () => (
  <div className="cm cm--load" aria-busy="true">
    <div className="cm-sk" />
    <div className="cm-sk" />
    <div className="cm-sk" />
  </div>
);

export function Comm({ id, canFlag }: { id: string; canFlag: boolean }) {
  return (
    <section className="pp-sec" data-pp-comm="">
      <h3>Communication</h3>
      <div>
        <Suspense fallback={<Loading />}>
          <Picture id={id} canFlag={canFlag} />
        </Suspense>
      </div>
    </section>
  );
}
