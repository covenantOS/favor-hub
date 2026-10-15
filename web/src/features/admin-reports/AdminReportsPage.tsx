// Admin > Reports (/admin/reports/): which roles see each report. Admins see every report whatever is saved here. Port of
// src/pages/admin/reports/index.astro and public/js/admin-reports.js with the same markup and classes. Admins only: the API refuses everyone else.
import { Suspense, useState } from 'react';
import { QueryErrorResetBoundary, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import '@hub/styles/admin.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import { Boundary } from '../partners/record/Boundary';
import { hubSend } from '../../lib/write';
import { AdminHead } from './AdminHead';
import { adminReportsQuery, type AdminReports, type AdminReport } from './api';

const same = (a: string[], b: string[]) => a.slice().sort().join() === b.slice().sort().join();

function Row({ r, audiences, msg, onSave }: { r: AdminReport; audiences: AdminReports['audiences']; msg: { ok: boolean; text: string } | null; onSave: (r: AdminReport, body: Record<string, unknown>) => void }) {
  const [picked, setPicked] = useState<string[]>(r.roles);
  // The roles saved for the report are the starting point again after a save.
  const [from, setFrom] = useState(r.roles.join());
  if (from !== r.roles.join()) {
    setFrom(r.roles.join());
    setPicked(r.roles);
  }
  return (
    <div className="ad-set ad-set--rep" data-rep={r.id}>
      <div>
        <div className="ad-set__name">{r.name}</div>
        <div className="ad-set__where">
          {r.ready ? 'Live' : 'Coming soon'}
          {r.saved ? '. Changed from the catalog.' : '.'}
        </div>
      </div>
      <div className="ad-roles" role="group" aria-label={'Roles that see ' + r.name}>
        {audiences.map((a) => (
          <label key={a.value}>
            <input type="checkbox" value={a.value} checked={picked.indexOf(a.value) >= 0} onChange={(e) => setPicked(e.target.checked ? picked.concat(a.value) : picked.filter((x) => x !== a.value))} />
            {a.label}
          </label>
        ))}
      </div>
      <div className="ad-acts">
        <button type="button" className="ad-btn ad-btn--primary" data-save disabled={same(picked, r.roles)} onClick={() => onSave(r, { roles: audiences.map((a) => a.value).filter((v) => picked.indexOf(v) >= 0) })}>
          Save
        </button>
        {r.saved ? (
          <button type="button" className="ad-btn" data-reset onClick={() => onSave(r, { reset: true })}>
            Use the catalog
          </button>
        ) : null}
      </div>
      <p className={'ad-msg' + (msg ? (msg.ok ? ' ad-msg--ok' : ' ad-msg--bad') : '')} data-msg role="status" style={{ gridColumn: '1/-1' }}>
        {msg ? msg.text : ''}
      </p>
    </div>
  );
}

function Rows() {
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(adminReportsQuery);
  const [msgs, setMsgs] = useState<Record<string, { ok: boolean; text: string }>>({});
  // Every answer redraws the rows from the list the server sent, as the classic page does.
  const [rev, setRev] = useState(0);
  const save = (r: AdminReport, body: Record<string, unknown>) => {
    setMsgs((m) => ({ ...m, [r.id]: { ok: true, text: 'Saving' } }));
    hubSend('/api/admin/reports', 'POST', { id: r.id, ...body }, (d) => d as AdminReports)
      .then((d) => {
        qc.setQueryData(adminReportsQuery.queryKey, (old: AdminReports | undefined) => (old ? { ...old, reports: d.reports } : d));
        setRev((n) => n + 1);
        setMsgs((m) => ({ ...m, [r.id]: { ok: true, text: 'Saved' } }));
      })
      .catch((e: Error) => setMsgs((m) => ({ ...m, [r.id]: { ok: false, text: e.message } })));
  };
  return (
    <div className="ad" id="rp-box">
      {data.groups.map((g) => (
        <section className="ad-card" key={g.id}>
          <h2>{g.label}</h2>
          {data.reports
            .filter((r) => r.group === g.id)
            .map((r) => (
              <Row key={r.id + ':' + rev} r={r} audiences={data.audiences} msg={msgs[r.id] || null} onSave={save} />
            ))}
        </section>
      ))}
    </div>
  );
}

const Wait = () => (
  <div className="ad" id="rp-box" aria-busy="true">
    <div className="ad-tile h-skel" style={{ minHeight: 140 }} />
  </div>
);

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

export function AdminReportsPage() {
  return (
    <QueryErrorResetBoundary>
      {() => (
        <Boundary fallback={(e) => <Failed e={e} />}>
          <div className="ad" id="ad-root">
            <AdminHead on="reports" title="Reports" fact="Admins see every report." />
            <Suspense fallback={<Wait />}>
              <Rows />
            </Suspense>
          </div>
        </Boundary>
      )}
    </QueryErrorResetBoundary>
  );
}
