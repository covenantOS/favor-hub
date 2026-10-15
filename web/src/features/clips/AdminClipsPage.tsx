// Admin > Clips (/admin/clips/): storage for each person, the longest recording, the sharing default and who can record. Port of
// src/pages/admin/clips/index.astro with the settings rows of public/js/admin-settings.js (area clips) and the same markup and classes.
// Each setting saves on its own. Admins only: the API refuses everyone else.
import { Suspense, useState } from 'react';
import { QueryErrorResetBoundary, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import '@hub/styles/admin.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import { Boundary } from '../partners/record/Boundary';
import { hubSend } from '../../lib/write';
import { AdminHead } from '../admin-reports/AdminHead';
import { clipsSettingsQuery, type AdminSetting, type ClipsSettingsAnswer } from './queries';
import { settingChanged, usageRows } from './logic';

const idOf = (s: AdminSetting) => 'f-' + s.id.replace(/\W/g, '-');
const dayOf = (iso: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }).format(new Date(iso));

function Control({ s, id, value, onChange }: { s: AdminSetting; id: string; value: string; onChange: (v: string) => void }) {
  if (s.kind === 'enum') {
    return (
      <select className="ad-field" id={id} data-id={s.id} value={value} onChange={(e) => onChange(e.target.value)}>
        {s.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (s.kind === 'int') {
    return (
      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input className="ad-field ad-field--num" id={id} data-id={s.id} type="number" inputMode="numeric" min={s.min} max={s.max} value={value} onChange={(e) => onChange(e.target.value)} />
        <span className="ad-set__who">{s.unit}</span>
      </span>
    );
  }
  if (s.kind === 'date') return <input className="ad-field" id={id} data-id={s.id} type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
  return (
    <input
      className="ad-field"
      id={id}
      data-id={s.id}
      type="text"
      value={value}
      placeholder={s.id === 'clips.list' ? 'name@favorintl.org, name@favorintl.org' : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

interface Msg {
  ok: boolean;
  text: string;
}

function Row({ s, onSend }: { s: AdminSetting; onSend: (s: AdminSetting, body: Record<string, unknown>) => Promise<Msg> }) {
  const [value, setValue] = useState(s.value);
  const [saved, setSaved] = useState(s.value);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [ask, setAsk] = useState<string | null>(null);
  // The value the server holds is the starting point again after a save or a reset.
  if (saved !== s.value) {
    setSaved(s.value);
    setValue(s.value);
  }
  const id = idOf(s);
  const who = s.saved && s.at ? 'Changed ' + dayOf(s.at) + (s.by ? ' by ' + s.by : '') : '';
  const run = async (body: Record<string, unknown>) => {
    setMsg({ ok: true, text: 'Saving' });
    setAsk(null);
    setMsg(await onSend(s, body));
  };
  const shown = (v: string) => {
    const o = s.options.find((x) => x.value === v);
    return o ? o.label : v === '' ? 'blank' : v + (s.unit ? ' ' + s.unit : '');
  };
  return (
    <div className="ad-set" data-row={s.id}>
      <div>
        <label className="ad-set__name" htmlFor={id}>
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
          id={id}
          value={value}
          onChange={(v) => {
            setValue(v);
            setMsg(null);
          }}
        />
      </div>
      <div className="ad-acts">
        <button
          type="button"
          className="ad-btn ad-btn--primary"
          data-save={s.id}
          disabled={!settingChanged(value, s.value)}
          onClick={() => {
            if (s.bb || s.contact || s.spend) setAsk(value);
            else void run({ value });
          }}
        >
          Save
        </button>
        {s.canReset ? (
          <button type="button" className="ad-btn" data-reset={s.id} onClick={() => void run({ reset: true })}>
            Use the default
          </button>
        ) : null}
      </div>
      <p className={'ad-msg' + (msg ? (msg.ok ? ' ad-msg--ok' : ' ad-msg--bad') : '')} data-msg={s.id} role="status">
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
            <button type="button" className="ad-btn ad-btn--warn" data-yes autoFocus onClick={() => void run({ value: ask, confirm: true })}>
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

function Settings() {
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(clipsSettingsQuery);
  const send = async (s: AdminSetting, body: Record<string, unknown>): Promise<Msg> => {
    try {
      const d = await hubSend('/api/admin/settings', 'POST', { id: s.id, ...body }, (x) => x as { setting: AdminSetting });
      qc.setQueryData(clipsSettingsQuery.queryKey, (old: ClipsSettingsAnswer | undefined) => (old ? { ...old, settings: old.settings.map((x) => (x.id === s.id ? d.setting : x)) } : old));
      return { ok: true, text: 'Saved' };
    } catch (e) {
      return { ok: false, text: (e as Error).message };
    }
  };
  const groups: { name: string; rows: AdminSetting[] }[] = [];
  for (const s of data.settings) {
    const g = s.group || '';
    const hit = groups.find((x) => x.name === g);
    if (hit) hit.rows.push(s);
    else groups.push({ name: g, rows: [s] });
  }
  const cap = Number(data.settings.find((s) => s.id === 'clips.cap_gb')?.value || 10) * 1024 * 1024 * 1024;
  const people = usageRows(data.extras.usage || [], cap);
  return (
    <div className="ad" data-ad-area="clips">
      {groups.map((g) => (
        <section className="ad-card ad-group" key={g.name}>
          {g.name ? <h3>{g.name}</h3> : null}
          {g.rows.map((s) => (
            <Row key={s.id} s={s} onSend={send} />
          ))}
        </section>
      ))}
      <section className="ad-card">
        <h2>Storage by person</h2>
        <div className="ad-scroll">
          <table className="ad-table sc-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Clips</th>
                <th>Used</th>
                <th>Of the cap</th>
              </tr>
            </thead>
            <tbody>
              {people.length ? (
                people.map((u) => (
                  <tr key={u.email}>
                    <td>
                      {u.name}
                      <br />
                      <span className="mute">{u.email}</span>
                    </td>
                    <td className="num">{u.clips}</td>
                    <td className="num">{u.used}</td>
                    <td className="num">{u.pct}%</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="mute">
                    Nothing yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const Wait = () => (
  <div className="ad" data-ad-area="clips" aria-busy="true">
    <div className="ad-tile h-skel" style={{ minHeight: 140 }} />
  </div>
);

const statusOf = (e: Error) => (e.name === 'HubReadError' ? (e as Error & { status?: number }).status || 0 : 0);

/** A read that failed replaces the page body, as the classic page does: the card says why, or that settings are for admins. */
function Failed({ e }: { e: Error }) {
  const denied = statusOf(e) === 401 || statusOf(e) === 403;
  return denied ? (
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
  );
}

export function AdminClipsPage() {
  return (
    <div className="ad" id="ad-root">
      <AdminHead on="clips" title="Clips" />
      <QueryErrorResetBoundary>
        {() => (
          <Boundary fallback={(e) => <Failed e={e} />}>
            <Suspense fallback={<Wait />}>
              <Settings />
            </Suspense>
          </Boundary>
        )}
      </QueryErrorResetBoundary>
    </div>
  );
}
