// Admin > Appeal codes (/admin/appeal-codes/): build an appeal code from the scheme, create it in Blackbaud, and keep the list of funds and campaigns
// waiting to be created. Port of public/js/admin-appeals.js with the same markup, classes, words and calls.
// POST /api/admin/appeal-codes {op: preview|create|request|close}; GET lists the newest appeals, the categories and the open requests.
import { useEffect, useRef, useState } from 'react';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import '@hub/styles/admin.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/work-functions.css';
import { hubSend } from '../../lib/write';
import { appealsQuery, type AppealsAnswer } from './api';
import { AdminPage, msgClass, type Msg } from './AdminPage';
import { When } from './Time';
import { canCreate, createdText, kindFill, type Draft } from './appeals';
import { todayET } from './format';

interface Built {
  code: string;
  description: string;
}
interface Preview {
  built: Built[];
  exists: string[];
  error?: string;
}

function NewCode({ data, reload }: { data: AppealsAnswer; reload: () => void }) {
  const first = kindFill(data, data.prefixes[0].letter);
  const [letter, setLetter] = useState(data.prefixes[0].letter);
  const [date, setDate] = useState(todayET());
  const [suffix, setSuffix] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [cat, setCat] = useState(first.category);
  const [online, setOnline] = useState(first.online);
  const [prev, setPrev] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [tick, setTick] = useState(0);
  const fill = kindFill(data, letter);
  const draft = (): Draft => ({ letter, date, suffix, title, description: desc, category: cat });

  // The preview follows the form: 220 ms after the last change it asks which codes the draft builds and whether Blackbaud has them.
  useEffect(() => {
    if (!date) {
      setPrev(null);
      return;
    }
    let stale = false;
    const t = setTimeout(() => {
      hubSend('/api/admin/appeal-codes', 'POST', { op: 'preview', draft: draft(), online }, (d) => d as { built?: Built[]; exists?: string[] })
        .then((d) => {
          if (!stale) setPrev({ built: d.built || [], exists: d.exists || [] });
        })
        .catch((e: Error) => {
          if (!stale) setPrev({ built: [], exists: [], error: e.message });
        });
    }, 220);
    return () => {
      stale = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letter, date, suffix, title, desc, cat, online, tick]);

  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    // A new draft clears the last result line, as the classic page's preview does.
    setMsg(null);
  };
  const pickKind = (l: string) => {
    const f = kindFill(data, l);
    setLetter(l);
    setCat(f.category);
    setOnline(f.online);
    setMsg(null);
  };
  const create = () => {
    setBusy(true);
    setMsg({ ok: false, text: 'Creating' });
    hubSend('/api/admin/appeal-codes', 'POST', { op: 'create', draft: draft(), online }, (d) => d as { created: Array<{ ok: boolean; code: string; error?: string }>; wiring: string[] })
      .then((d) => {
        setBusy(false);
        setMsg({ ok: !d.created.some((c) => !c.ok), text: createdText(d) });
        reload();
        setTick((n) => n + 1);
      })
      .catch((e: Error) => {
        setBusy(false);
        setMsg({ ok: false, text: e.message });
        setTick((n) => n + 1);
      });
  };
  const ok = !!prev && !prev.error && canCreate(busy, prev.built, prev.exists);
  return (
    <section className="ad-card" id="ap-new" aria-label="New appeal code">
      <h2>New appeal code</h2>
      <div className="ap-grid">
        <label className="bu-f">
          <span>Kind</span>
          <select className="ad-field" id="ap-kind" value={letter} onChange={(e) => pickKind(e.target.value)}>
            {data.prefixes.map((p) => (
              <option key={p.letter} value={p.letter}>
                {p.label} ({p.letter})
              </option>
            ))}
          </select>
        </label>
        <label className="bu-f">
          <span id="ap-datelab">{fill.dateLabel}</span>
          <input className="ad-field" type="date" id="ap-date" value={date} onChange={(e) => edit(setDate)(e.target.value)} />
        </label>
        <label className="bu-f">
          <span>Suffix</span>
          <input className="ad-field" id="ap-suffix" maxLength={14} autoComplete="off" placeholder={fill.placeholder} value={suffix} onChange={(e) => edit(setSuffix)(e.target.value)} />
          <small id="ap-hint" className="ap-hint">
            {fill.hint}
          </small>
        </label>
        <label className="bu-f">
          <span>
            Title <i className="ap-opt">(optional)</i>
          </span>
          <input className="ad-field" id="ap-title" maxLength={120} autoComplete="off" value={title} onChange={(e) => edit(setTitle)(e.target.value)} />
        </label>
        <label className="bu-f ap-wide">
          <span>Description</span>
          <input className="ad-field" id="ap-desc" maxLength={255} autoComplete="off" value={desc} onChange={(e) => edit(setDesc)(e.target.value)} />
        </label>
        <label className="bu-f">
          <span>Category</span>
          <select className="ad-field" id="ap-cat" value={cat} onChange={(e) => edit(setCat)(e.target.value)}>
            <option value="">Same as the kind</option>
            {data.categories.map((c) => (
              <option key={c.category} value={c.category}>
                {c.category}
              </option>
            ))}
          </select>
        </label>
        <label className="bu-check ap-twin">
          <input type="checkbox" id="ap-online" checked={online} onChange={(e) => edit(setOnline)(e.target.checked)} /> Also create the online -WS code
        </label>
      </div>
      <div className="ap-preview" id="ap-preview" aria-live="polite">
        {prev && prev.error ? <div className="is-bad">{prev.error}</div> : null}
        {prev && !prev.error
          ? prev.built.map((b) => (
              <div key={b.code}>
                <code>{b.code}</code> {b.description}
                {prev.exists.indexOf(b.code.toUpperCase()) >= 0 ? <span className="is-bad"> already exists in Blackbaud</span> : null}
              </div>
            ))
          : null}
      </div>
      <p className={msg && msg.text === 'Creating' ? 'ad-msg' : msgClass(msg)} id="ap-msg" role="status">
        {msg ? msg.text : ''}
      </p>
      <div className="bu-row">
        <button type="button" className="ad-btn ad-btn--primary" id="ap-create" disabled={!ok} onClick={create}>
          Create in Blackbaud
        </button>
      </div>
    </section>
  );
}

function Recent({ data }: { data: AppealsAnswer }) {
  return (
    <section className="ad-card" aria-label="Recent appeals">
      <h2>Newest appeals</h2>
      <div className="ad-scroll">
        <table className="ad-table sc-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Description</th>
              <th>Category</th>
              <th>Starts</th>
            </tr>
          </thead>
          <tbody id="ap-recent">
            {data.recent.length ? (
              data.recent.map((r) => (
                <tr key={r.code}>
                  <td data-label="Code">
                    <b>{r.code}</b>
                    {r.inactive ? (
                      <>
                        {' '}
                        <span className="bu-chip">Inactive</span>
                      </>
                    ) : null}
                  </td>
                  <td data-label="Description">{r.description}</td>
                  <td data-label="Category">{r.category}</td>
                  <td data-label="Starts">{r.start}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="au-empty">
                  No appeals in the Blackbaud copy.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Waiting({ data, reload }: { data: AppealsAnswer; reload: () => Promise<unknown> }) {
  const [kind, setKind] = useState('fund');
  const [code, setCode] = useState('');
  const [desc, setDesc] = useState('');
  const [cat, setCat] = useState('');
  const [start, setStart] = useState('');
  const [msg, setMsg] = useState<Msg | null>(null);
  const [gone, setGone] = useState<Record<string, boolean>>({});
  const add = () => {
    setMsg({ ok: false, text: 'Saving' });
    hubSend('/api/admin/appeal-codes', 'POST', { op: 'request', kind, code, description: desc, category: cat, start_date: start }, (d) => d)
      .then(() => {
        setCode('');
        setDesc('');
        setCat('');
        setStart('');
        setMsg(null);
        return reload();
      })
      .catch((e: Error) => setMsg({ ok: false, text: e.message }));
  };
  const close = (id: string, state: string) => {
    setGone((g) => ({ ...g, [id]: true }));
    hubSend('/api/admin/appeal-codes', 'POST', { op: 'close', id, state }, (d) => d)
      .then(() => reload())
      .then(() => setGone((g) => ({ ...g, [id]: false })))
      .catch((e: Error) => {
        setGone((g) => ({ ...g, [id]: false }));
        setMsg({ ok: false, text: e.message });
      });
  };
  return (
    <section className="ad-card" aria-label="Funds and campaigns waiting">
      <h2>Funds and campaigns waiting</h2>
      <p className="ad-card__meta">The Blackbaud connection cannot create a fund or a campaign yet. A request waits here until someone creates it in Blackbaud and marks it done.</p>
      <div className="ap-grid">
        <label className="bu-f">
          <span>Kind</span>
          <select className="ad-field" id="rq-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="fund">Fund</option>
            <option value="campaign">Campaign</option>
          </select>
        </label>
        <label className="bu-f">
          <span>Code</span>
          <input className="ad-field" id="rq-code" maxLength={30} autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        <label className="bu-f ap-wide">
          <span>Description</span>
          <input className="ad-field" id="rq-desc" maxLength={255} autoComplete="off" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </label>
        <label className="bu-f">
          <span>
            Category <i className="ap-opt">(optional)</i>
          </span>
          <input className="ad-field" id="rq-cat" maxLength={80} autoComplete="off" value={cat} onChange={(e) => setCat(e.target.value)} />
        </label>
        <label className="bu-f">
          <span>
            Start date <i className="ap-opt">(optional)</i>
          </span>
          <input className="ad-field" type="date" id="rq-start" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
      </div>
      <p className={msg && msg.text === 'Saving' ? 'ad-msg' : msgClass(msg)} id="rq-msg" role="status">
        {msg ? msg.text : ''}
      </p>
      <div className="bu-row">
        <button type="button" className="ad-btn" id="rq-add" onClick={add}>
          Add to the list
        </button>
      </div>
      <div id="rq-list">
        {data.requests.length ? (
          <div className="ad-scroll">
            <table className="ad-table">
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Asked</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.requests.map((r) => {
                  const open = r.state === 'open';
                  return (
                    <tr key={r.id}>
                      <td data-label="Request">
                        <b>
                          {r.kind === 'fund' ? 'Fund' : 'Campaign'} {r.code}
                        </b>
                        <br />
                        <span className="bu-mail">
                          {r.description}
                          {r.category ? ' · ' + r.category : ''}
                          {r.start_date ? ' · starts ' + r.start_date : ''}
                        </span>
                      </td>
                      <td data-label="Asked">
                        <When iso={r.requested_at} />
                        <br />
                        <span className="bu-mail">{r.requested_by}</span>
                      </td>
                      <td data-label="Status">
                        <span className={'bu-chip' + (r.state === 'done' ? ' bu-chip--ok' : '')}>{r.state === 'open' ? 'Waiting' : r.state === 'done' ? 'Created' : 'Dropped'}</span>
                      </td>
                      <td data-label="">
                        {open ? (
                          <>
                            <button type="button" className="ad-btn" data-rq="done" data-id={r.id} disabled={!!gone[r.id]} onClick={() => close(r.id, 'done')}>
                              Mark created
                            </button>{' '}
                            <button type="button" className="ad-btn" data-rq="dropped" data-id={r.id} disabled={!!gone[r.id]} onClick={() => close(r.id, 'dropped')}>
                              Drop
                            </button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="bu-none">Nothing waiting.</p>
        )}
      </div>
    </section>
  );
}

function Body() {
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(appealsQuery);
  // The first read is the form's starting point; a later read only refreshes the two lists, so a half-typed draft is never replaced.
  const first = useRef(data);
  const reload = () => qc.refetchQueries({ queryKey: appealsQuery.queryKey });
  return (
    <>
      <NewCode data={first.current} reload={() => void reload()} />
      <Recent data={data} />
      <Waiting data={data} reload={reload} />
    </>
  );
}

const Wait = () => (
  <div className="ad" aria-busy="true">
    <div className="ad-tile h-skel" style={{ minHeight: 420 }} />
  </div>
);

export function AppealCodesPage() {
  return (
    <AdminPage on="appeals" title="Appeal codes" fact="Funds and campaigns wait in a list until someone creates them." wait={<Wait />}>
      <Body />
    </AdminPage>
  );
}
