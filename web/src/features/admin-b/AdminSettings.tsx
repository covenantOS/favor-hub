// An Admin settings tab (Work Center, Receipts, Giving statements, Expenses): each setting saves on its own and asks to confirm when it changes what
// FavorOS sends to Blackbaud or whether it emails partners. Port of public/js/admin-settings.js with the same markup and classes.
// GET /api/admin/settings?area=X lists the rows and the read-only facts; POST /api/admin/settings {id, value, confirm?, reset?} saves one.
import { useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import '@hub/styles/admin.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import { hubSend } from '../../lib/write';
import { settingsQuery, type Setting, type SettingsAnswer, type Sub, type WorkExtras } from './api';
import { AdminPage, msgClass, type Msg } from './AdminPage';
import { Full } from './Time';
import { Mail } from './Mail';
import { controlId, confirmLead, grouped, needsConfirm, resetWord, shown } from './settings';
import { num, shortDay } from './format';

function Control({ s, draft, set }: { s: Setting; draft: string; set: (v: string) => void }) {
  const id = controlId(s.id);
  if (s.kind === 'enum')
    return (
      <select className="ad-field" id={id} data-id={s.id} value={draft} onChange={(e: ChangeEvent<HTMLSelectElement>) => set(e.target.value)}>
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
        <input className="ad-field ad-field--num" id={id} data-id={s.id} type="number" inputMode="numeric" min={s.min} max={s.max} value={draft} onChange={(e) => set(e.target.value)} />
        <span className="ad-set__who">{s.unit}</span>
      </span>
    );
  if (s.kind === 'date') return <input className="ad-field" id={id} data-id={s.id} type="date" value={draft} onChange={(e) => set(e.target.value)} />;
  if (s.kind === 'text' && s.id.indexOf('statements.w.') === 0)
    return <textarea className="ad-field" id={id} data-id={s.id} rows={s.value.length > 160 ? 4 : 2} value={draft} onChange={(e) => set(e.target.value)} />;
  return <input className="ad-field" id={id} data-id={s.id} type="text" value={draft} onChange={(e) => set(e.target.value)} />;
}

function Row({ s, onChanged }: { s: Setting; onChanged: (next: Setting) => void }) {
  const [draft, setDraft] = useState(s.value);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const id = controlId(s.id);
  const who = s.saved && s.at ? 'Changed ' + shortDay(s.at) + (s.by ? ' by ' + s.by : '') : '';

  const send = (body: Record<string, unknown>) => {
    setMsg({ ok: true, text: 'Saving' });
    return hubSend('/api/admin/settings', 'POST', { id: s.id, ...body }, (d) => (d as { setting: Setting }).setting)
      .then((next) => {
        // The row is drawn again from the answer: the new value, the "Changed" line, no confirm box.
        setConfirm(null);
        setDraft(next.value);
        onChanged(next);
        setMsg({ ok: true, text: 'Saved' });
      })
      .catch((e: Error) => setMsg({ ok: false, text: e.message }));
  };
  const save = () => {
    if (needsConfirm(s)) setConfirm(draft);
    else void send({ value: draft });
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
        {who ? (
          <div className="ad-set__where">
            <Mail text={who} />
          </div>
        ) : null}
      </div>
      <div>
        <Control
          s={s}
          draft={draft}
          set={(v) => {
            setDraft(v);
            setMsg(null);
          }}
        />
      </div>
      <div className="ad-acts">
        <button type="button" className="ad-btn ad-btn--primary" data-save={s.id} disabled={draft === s.value} onClick={save}>
          Save
        </button>
        {s.canReset ? (
          <button type="button" className="ad-btn" data-reset={s.id} onClick={() => void send({ reset: true })}>
            Use {resetWord(s)}
          </button>
        ) : null}
      </div>
      <p className={msgClass(msg)} data-msg={s.id} role="status">
        {msg ? msg.text : ''}
      </p>
      {confirm !== null ? (
        <div className="ad-confirm">
          <p>
            {confirmLead(s)}
            <b>{shown(s, s.value)}</b> now. Change it to <b>{shown(s, confirm)}</b>?
          </p>
          <div className="ad-acts" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="ad-btn ad-btn--warn" data-yes autoFocus onClick={() => void send({ value: confirm, confirm: true })}>
              Confirm the change
            </button>
            <button type="button" className="ad-btn" data-no onClick={() => setConfirm(null)}>
              Keep {shown(s, s.value)}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[] }) {
  return (
    <div className="ad-scroll">
      <table className="ad-table sc-table">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows
          ) : (
            <tr>
              <td colSpan={head.length} className="mute">
                Nothing yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function WorkExtrasView({ x }: { x: Partial<WorkExtras> }) {
  const cal = x.calls || { used: 0, cap: 0, lane: 0 };
  return (
    <>
      <section className="ad-card">
        <h2>Blackbaud calls today</h2>
        <div className="ad-meter" role="img" aria-label={cal.used + ' of ' + cal.cap}>
          <i style={{ width: Math.min(100, (cal.used / (cal.cap || 1)) * 100) + '%' }} />
        </div>
        <div className="ad-meter__note">
          <span>
            {num(cal.used)} of {num(cal.cap)} upkeep calls
          </span>
          <span>Work Center lane {num(cal.lane)}</span>
        </div>
      </section>
      <div className="ad-cols">
        <section className="ad-card">
          <h2>Cadence rules</h2>
          <p className="ad-card__meta">Read only. These come from the Partner Care manual.</p>
          <Table
            head={['Rule', 'What it asks']}
            rows={(x.rules || []).map((r, i) => (
              <tr key={i}>
                <td className="ad-nw">
                  <b>{r.rule}</b>
                </td>
                <td>{r.text}</td>
              </tr>
            ))}
          />
        </section>
        <section className="ad-card">
          <h2>Action tags</h2>
          <p className="ad-card__meta">
            Read only. Blackbaud holds the list{x.tagsAt ? ', read ' : ''}
            {x.tagsAt ? <Full iso={x.tagsAt} /> : null}.
          </p>
          <Table
            head={['Tag', 'Type', 'Values']}
            rows={(x.tags || []).map((t, i) => (
              <tr key={i}>
                <td className="ad-nw">
                  <b>{t.name}</b>
                </td>
                <td className="ad-nw">{t.type}</td>
                <td className="mute">{(t.values || []).join(', ')}</td>
              </tr>
            ))}
          />
        </section>
      </div>
    </>
  );
}

const EMPTY_SUB = { start: '', end: '', name: '', email: '' };

function Substitutes({ subs, onSubs }: { subs: Sub[]; onSubs: (s: Sub[]) => void }) {
  const [f, setF] = useState(EMPTY_SUB);
  const [msg, setMsg] = useState<Msg | null>(null);
  const post = (body: Record<string, unknown>) => {
    setMsg({ ok: true, text: 'Saving' });
    return hubSend('/api/admin/expense-subs', 'POST', body, (d) => (d as { subs: Sub[] }).subs)
      .then((list) => {
        onSubs(list);
        setF(EMPTY_SUB);
        setMsg({ ok: true, text: 'Saved' });
      })
      .catch((e: Error) => setMsg({ ok: false, text: e.message }));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void post({ start: f.start, end: f.end, name: f.name, email: f.email });
  };
  const bind = (k: keyof typeof EMPTY_SUB) => ({ name: k, value: f[k], onChange: (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value }) });
  return (
    <section className="ad-card" id="ex-subs">
      <h2>Substitute approvers</h2>
      <Table
        head={['Dates', 'Name', 'Email', '']}
        rows={subs.map((o) => (
          <tr key={o.id}>
            <td>
              {o.start} to {o.end}
            </td>
            <td>{o.name}</td>
            <td className="mute">
              <Mail text={o.email} />
            </td>
            <td>
              <button type="button" className="ad-btn" data-sub-del={o.id} onClick={() => void post({ remove: o.id })}>
                Remove
              </button>
            </td>
          </tr>
        ))}
      />
      <form className="ad-sub" id="ex-sub-form" autoComplete="off" onSubmit={submit}>
        <label>
          From
          <input className="ad-field" type="date" required {...bind('start')} />
        </label>
        <label>
          To
          <input className="ad-field" type="date" required {...bind('end')} />
        </label>
        <label>
          Name
          <input className="ad-field" required {...bind('name')} />
        </label>
        <label>
          Email
          <input className="ad-field" type="email" required {...bind('email')} />
        </label>
        <button className="ad-btn ad-btn--primary" type="submit">
          Add substitute
        </button>
      </form>
      <p className={msgClass(msg)} id="ex-sub-msg" role="status">
        {msg ? msg.text : ''}
      </p>
    </section>
  );
}

function Tab({ area }: { area: string }) {
  const qc = useQueryClient();
  const q = settingsQuery(area);
  const { data } = useSuspenseQuery(q);
  const changed = (next: Setting) =>
    qc.setQueryData(q.queryKey, (old: SettingsAnswer | undefined) => (old ? { ...old, settings: old.settings.map((s) => (s.id === next.id ? next : s)) } : old));
  const setSubs = (subs: Sub[]) => qc.setQueryData(q.queryKey, (old: SettingsAnswer | undefined) => (old ? { ...old, extras: { ...old.extras, overrides: subs } } : old));
  return (
    <div className="ad" data-ad-area={area}>
      {grouped(data.settings).map((g) => (
        <section className="ad-card ad-group" key={g.group}>
          {g.group ? <h3>{g.group}</h3> : null}
          {g.rows.map((s) => (
            <Row key={s.id} s={s} onChanged={changed} />
          ))}
        </section>
      ))}
      {area === 'work' ? <WorkExtrasView x={data.extras} /> : null}
      {area === 'expenses' ? <Substitutes subs={data.extras.overrides || []} onSubs={setSubs} /> : null}
    </div>
  );
}

/** One settings tab as a whole page. `children` draws between the head and the settings (the Giving statements links). */
export function AdminSettingsPage({ area, on, title, fact, children }: { area: string; on: string; title: string; fact?: string; children?: ReactNode }) {
  return (
    <AdminPage
      on={on}
      title={title}
      fact={fact}
      intro={children}
      wait={
        <div className="ad" data-ad-area={area} aria-busy="true">
          <div className="ad-tile h-skel" style={{ minHeight: 140 }} />
        </div>
      }
    >
      <Tab area={area} />
    </AdminPage>
  );
}
