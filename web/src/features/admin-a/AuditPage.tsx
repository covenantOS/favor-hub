// Admin > Audit log (/admin/audit/): the newest settings changes first, filtered by area or a word. Port of src/pages/admin/audit/index.astro and
// public/js/admin-audit.js with the same markup and classes. Admins only: the API refuses everyone else.
import { Suspense, useState, useTransition } from 'react';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import '@hub/styles/crit-reportadmin.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import { hubGet } from '../../lib/hub';
import { Frame } from './Frame';
import { AUDIT_PAGE, auditPath, auditQuery, type AuditEntry } from './api';
import { Full } from './Time';

const AREAS: Array<[string, string]> = [
  ['', 'All'],
  ['work', 'Work Center'],
  ['meetings', 'Meetings'],
  ['brain', 'Favor Brain'],
  ['clips', 'Clips'],
  ['reports', 'Reports'],
  ['people', 'People'],
];

const text = (v: string | null | undefined) => (v == null ? '' : v);

function Rows({ area, q }: { area: string; q: string }) {
  const { data } = useSuspenseQuery(auditQuery(area));
  const qc = useQueryClient();
  // Older pages ride on top of the first answer; a new area is a new component (key), so they start over.
  const [more, setMore] = useState<AuditEntry[]>([]);
  const [done, setDone] = useState(data.entries.length < AUDIT_PAGE);
  const [busy, setBusy] = useState(false);
  const rows = data.entries.concat(more);
  const needle = q.trim().toLowerCase();
  const list = rows.filter((e) => !needle || (e.actor + ' ' + e.label + ' ' + e.key + ' ' + e.before + ' ' + e.after + ' ' + e.note).toLowerCase().indexOf(needle) >= 0);
  const showMore = () => {
    const last = rows.length ? rows[rows.length - 1].id : 0;
    setBusy(true);
    hubGet(auditPath(area, last))
      .then((d) => {
        const next = (d as { entries: AuditEntry[] }).entries;
        setMore((m) => m.concat(next));
        setDone(next.length < AUDIT_PAGE);
      })
      .catch(() => undefined)
      .finally(() => setBusy(false));
    void qc;
  };
  return (
    <>
      <div className="ad-scroll">
        <table className="ad-table sc-table" id="au-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Setting</th>
              <th>Before</th>
              <th>After</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody id="au-body">
            {list.length ? (
              list.map((e) => (
                <tr key={e.id}>
                  <td data-label="When">
                    <Full iso={e.at} />
                  </td>
                  <td data-label="Who">{e.actor}</td>
                  <td data-label="Setting">{e.label}</td>
                  <td data-label="Before" className="mute">
                    {text(e.before)}
                  </td>
                  <td data-label="After">{text(e.after)}</td>
                  <td data-label="Note" className="mute">
                    {e.note || ''}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="au-empty">
                  {rows.length ? 'No changes match that search.' : 'No settings changes recorded for this area yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div>
        <button type="button" className="ad-btn" id="au-more" hidden={done} disabled={busy} onClick={showMore}>
          Show more
        </button>
      </div>
    </>
  );
}

function Wait() {
  return (
    <div className="ad-scroll" aria-busy="true">
      <table className="ad-table sc-table" id="au-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>Setting</th>
            <th>Before</th>
            <th>After</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody id="au-body">
          <tr>
            <td colSpan={6} className="au-empty">
              Loading
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function AuditPage() {
  const [area, setArea] = useState('');
  const [q, setQ] = useState('');
  const [, start] = useTransition();
  return (
    <Frame on="audit" title="Audit log" wait={<Wait />} cls="ad" root="ad-root">
      <section className="ad-card">
        <div className="ad-sub">
          <label className="h-label" htmlFor="au-area" style={{ margin: 0 }}>
            Area
          </label>
          <select id="au-area" className="ad-field" style={{ width: 'auto' }} value={area} onChange={(e) => start(() => setArea(e.target.value))}>
            {AREAS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <input id="au-find" className="ad-field ad-find" type="search" placeholder="Find a person or setting" aria-label="Find a person or setting" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Suspense fallback={<Wait />}>
          <Rows key={area} area={area} q={q} />
        </Suspense>
      </section>
    </Frame>
  );
}
