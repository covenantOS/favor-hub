// An Admin settings tab (React twin of public/js/admin-settings.js): a card per group, a row per setting, each saving on its own and asking
// to confirm when it changes what FavorOS sends to Blackbaud, emails to partners or spends money. Port of the rows and the save/reset/confirm
// calls; the extras the Work, Brain, Clips, AI and Expenses tabs add under or over the groups come with those tabs.
// This file draws the kinds the Meetings tab uses (enum, int, date, text). The people-and-teams picker (kind "access") comes with the tabs that use it.
import { Suspense, useState } from 'react';
import { QueryErrorResetBoundary, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import '@hub/styles/admin.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import { Boundary } from '../partners/record/Boundary';
import { hubSend } from '../../lib/write';
import { AdminHead } from '../admin-reports/AdminHead';
import { settingsQuery, type Setting, type SettingsAnswer } from './api';

const idOf = (s: Setting) => 'f-' + s.id.replace(/\W/g, '-');
const changedOn = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });

function Control({ s, val, setVal }: { s: Setting; val: string; setVal: (v: string) => void }) {
  const id = idOf(s);
  if (s.kind === 'enum')
    return (
      <select className="ad-field" id={id} data-id={s.id} value={val} onChange={(e) => setVal(e.target.value)}>
        {s.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  if (s.kind === 'int')
    return (
      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input className="ad-field ad-field--num" id={id} data-id={s.id} type="number" inputMode="numeric" min={s.min} max={s.max} value={val} onChange={(e) => setVal(e.target.value)} />
        <span className="ad-set__who">{s.unit}</span>
      </span>
    );
  if (s.kind === 'date') return <input className="ad-field" id={id} data-id={s.id} type="date" value={val} onChange={(e) => setVal(e.target.value)} />;
  return <input className="ad-field" id={id} data-id={s.id} type="text" value={val} onChange={(e) => setVal(e.target.value)} />;
}

function Row({ s, onSend }: { s: Setting; onSend: (id: string, body: Record<string, unknown>) => Promise<boolean> }) {
  const [val, setVal] = useState(s.value);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ask, setAsk] = useState<string | null>(null);
  // A saved answer from the server is the starting point again.
  const [from, setFrom] = useState(s.value);
  if (from !== s.value) {
    setFrom(s.value);
    setVal(s.value);
    setAsk(null);
  }
  const who = s.saved && s.at ? 'Changed ' + changedOn.format(new Date(s.at)) + (s.by ? ' by ' + s.by : '') : '';
  const shown = (v: string) => {
    const o = s.options.filter((x) => x.value === v)[0];
    return o ? o.label : v === '' ? 'blank' : v + (s.unit ? ' ' + s.unit : '');
  };
  const send = async (body: Record<string, unknown>) => {
    setMsg({ ok: true, text: 'Saving' });
    const ok = await onSend(s.id, body).catch((e: Error) => {
      setMsg({ ok: false, text: e.message });
      return false;
    });
    if (ok) setMsg({ ok: true, text: 'Saved' });
  };
  return (
    <div className="ad-set" data-row={s.id}>
      <div>
        <label className="ad-set__name" htmlFor={idOf(s)}>
          {s.label}
          {s.bb ? <span className="ad-bbtag">Blackbaud</span> : null}
          {s.contact ? <span className="ad-bbtag">Contacts partners</span> : null}
        </label>
        {s.hint ? <div className="ad-set__hint">{s.hint}</div> : null}
        {who ? <div className="ad-set__where">{who}</div> : null}
      </div>
      <div>
        <Control
          s={s}
          val={val}
          setVal={(v) => {
            setVal(v);
            setMsg(null);
          }}
        />
      </div>
      <div className="ad-acts">
        <button
          type="button"
          className="ad-btn ad-btn--primary"
          data-save={s.id}
          disabled={val === s.value}
          onClick={() => {
            if (s.bb || s.contact || s.spend) setAsk(val);
            else void send({ value: val });
          }}
        >
          Save
        </button>
        {s.canReset ? (
          <button type="button" className="ad-btn" data-reset={s.id} onClick={() => void send({ reset: true })}>
            Use {s.id.indexOf('meet.') === 0 || s.id === 'receipts.report' ? 'the Pages value' : 'the default'}
          </button>
        ) : null}
      </div>
      <p className={'ad-msg' + (msg && msg.text ? (msg.ok ? ' ad-msg--ok' : ' ad-msg--bad') : '')} data-msg={s.id} role="status">
        {msg ? msg.text : ''}
      </p>
      {ask !== null ? (
        <div className="ad-confirm">
          <p>
            {s.label}
            {s.spend ? ' can add model charges past the free allowance. It is ' : s.contact ? ' changes whether FavorOS emails partners. It is ' : ' changes what FavorOS sends to Blackbaud. It is '}
            <b>{shown(s.value)}</b> now. Change it to <b>{shown(ask)}</b>?
          </p>
          <div className="ad-acts" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="ad-btn ad-btn--warn" data-yes autoFocus onClick={() => void send({ value: ask, confirm: true })}>
              Confirm the change
            </button>
            <button type="button" className="ad-btn" data-no onClick={() => setAsk(null)}>
              Keep {shown(s.value)}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Groups({ area }: { area: string }) {
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(settingsQuery(area));
  const order: string[] = [];
  const by: Record<string, Setting[]> = {};
  data.settings.forEach((s) => {
    const g = s.group || '';
    if (!by[g]) {
      by[g] = [];
      order.push(g);
    }
    by[g].push(s);
  });
  const onSend = async (id: string, body: Record<string, unknown>) => {
    const d = await hubSend('/api/admin/settings', 'POST', { id, ...body }, (x) => x as { setting: Setting });
    qc.setQueryData(settingsQuery(area).queryKey, (old: SettingsAnswer | undefined) => (old ? { ...old, settings: old.settings.map((s) => (s.id === id ? d.setting : s)) } : old));
    return true;
  };
  return (
    <>
      {order.map((g) => (
        <section className="ad-card ad-group" key={g}>
          {g ? <h3>{g}</h3> : null}
          {by[g].map((s) => (
            <Row key={s.id} s={s} onSend={onSend} />
          ))}
        </section>
      ))}
    </>
  );
}

const statusOf = (e: Error) => (e.name === 'HubReadError' ? (e as Error & { status?: number }).status || 0 : 0);

/** A read that failed replaces the whole page, as the classic page does: the card says why, or that settings are for admins. */
function Failed({ e }: { e: Error }) {
  const denied = statusOf(e) === 401 || statusOf(e) === 403;
  return (
    <div className="ad" id="ad-root">
      {denied ? (
        <div className="ad-card ad-denied">
          <p>Settings are for FavorOS admins.</p>
          <p>
            <a href="/">Back to Today</a>
          </p>
        </div>
      ) : (
        <div className="ad-card">
          <p className="ad-msg ad-msg--bad">{e.name === 'HubReadError' && e.message ? e.message : 'That did not load.'}</p>
        </div>
      )}
    </div>
  );
}

export function SettingsArea({ area, on, title }: { area: string; on: string; title: string }) {
  return (
    <QueryErrorResetBoundary>
      {() => (
        <Boundary fallback={(e) => <Failed e={e} />}>
          <div className="ad" id="ad-root">
            <AdminHead on={on} title={title} />
            <Suspense
              fallback={
                <div className="ad" data-ad-area={area} aria-busy="true">
                  <div className="ad-tile h-skel" style={{ minHeight: 140 }} />
                </div>
              }
            >
              <div className="ad" data-ad-area={area}>
                <Groups area={area} />
              </div>
            </Suspense>
          </div>
        </Boundary>
      )}
    </QueryErrorResetBoundary>
  );
}
