// The list of reports this person may open (/reports/): grouped, searchable, each marked ready or coming soon. Port of the list half of
// public/js/reports.js with the same markup and classes.
import { Fragment, useState } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { NavLink } from '@/shell/NavLink';
import { BASE, listQuery, type ListEntry } from './api';

function Flags({ r }: { r: ListEntry }) {
  if (!r.ready) return <span className="rp-tag rp-tag--soon">Coming soon</span>;
  return r.kpiTie ? <span className="rp-tag rp-tag--ok">Ties to KPI</span> : null;
}

export function List() {
  const { data } = useSuspenseQuery(listQuery);
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');
  const { groups, reports } = data;
  const needle = q.toLowerCase();
  const segs: Array<[string, string, number]> = ([['all', 'All', reports.length]] as Array<[string, string, number]>)
    .concat(groups.map((g): [string, string, number] => [g.id, g.label, reports.filter((r) => r.group === g.id).length]))
    .filter((c) => c[0] === 'all' || c[2] > 0);
  let any = false;
  const sections = groups.map((g) => {
    if (group !== 'all' && group !== g.id) return null;
    const rows = reports.filter((r) => r.group === g.id && (!needle || (r.name + ' ' + (r.replaces || '') + ' ' + r.who).toLowerCase().indexOf(needle) >= 0));
    if (!rows.length) return null;
    any = true;
    return (
      <Fragment key={g.id}>
        {/* The group buttons above carry each group's count; the heading repeats it only when a search has narrowed the list. */}
        <div className="rp-grp">
          {g.label}
          {needle ? (
            <>
              {' '}
              <b>{rows.length}</b>
            </>
          ) : null}
        </div>
        {rows.map((r) => {
          const inner = (
            <>
              <b className="rp-name">{r.name}</b>
              <span className="rp-c" title={r.freq}>
                {r.freq}
              </span>
              <span className="rp-c" title={r.who}>
                {r.who}
              </span>
              <span className="rp-flags">
                <Flags r={r} />
              </span>
            </>
          );
          return r.ready ? (
            <NavLink key={r.id} className="rp-row" role="row" href={BASE + '?r=' + r.id}>
              {inner}
            </NavLink>
          ) : (
            <div key={r.id} className="rp-row is-soon" role="row">
              {inner}
            </div>
          );
        })}
      </Fragment>
    );
  });
  return (
    <>
      <div className="rp-top">
        <div className="rp-seg2" role="group" aria-label="Kind">
          <button type="button" className="is-on">
            Reports <small>{reports.length}</small>
          </button>
          <NavLink className="rp-segl" href={BASE + '?r=query-map'}>
            {data.queryMap.name}
          </NavLink>
        </div>
        <label className="rp-find">
          <svg className="h-i" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input type="search" id="rp-q" placeholder="Find a report or query" value={q} aria-label="Find a report or query" onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className="rp-groups">
        <div className="rp-seg2" role="group" aria-label="Group">
          {segs.map((c) => (
            <button type="button" key={c[0]} data-g={c[0]} className={group === c[0] ? 'is-on' : ''} onClick={() => setGroup(c[0])}>
              {c[1]}
              {c[0] === 'all' ? null : (
                <>
                  {' '}
                  <small>{c[2]}</small>
                </>
              )}
            </button>
          ))}
        </div>
      </div>
      {any ? (
        <div className="h-card rp-list" role="table" aria-label="Reports">
          <div className="rp-head" role="row">
            <span>Report</span>
            <span>How often</span>
            <span>Used by</span>
            <span>Flags</span>
          </div>
          {sections}
        </div>
      ) : (
        <div className="h-card rp-box">
          <p className="rp-note">No report matches that.</p>
        </div>
      )}
      {!reports.length ? (
        <div className="h-card rp-box">
          <p className="rp-note">No report is set up for your role yet. Ask the technology team through Feedback if you use a Blackbaud query that is missing.</p>
        </div>
      ) : null}
    </>
  );
}
