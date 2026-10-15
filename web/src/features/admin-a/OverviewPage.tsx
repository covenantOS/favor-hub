// Admin > Overview (/admin/): the health of the jobs FavorOS depends on, a link to every settings page, and the last five settings changes. Port of
// src/pages/admin/index.astro and public/js/admin-home.js with the same markup and classes. Admins only: every read behind it checks the role.
import { Suspense } from 'react';
import { QueryErrorResetBoundary, useSuspenseQuery } from '@tanstack/react-query';
import { ADMIN_PAGES } from '@hub/data/admin-pages';
import '@hub/styles/admin.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import { NavLink } from '@/shell/NavLink';
import { Boundary } from '../partners/record/Boundary';
import { navQuery } from '../../lib/queries';
import { AdminHead } from '../admin-reports/AdminHead';
import { Failed } from './Frame';
import { healthQuery, recentAuditQuery, type HealthItem } from './api';
import { Day, Full, When } from './Time';
import { when, num } from './format';

const LABEL = { ok: 'OK', late: 'Late', failed: 'Failed', unknown: 'No answer' } as const;
const CARDS = ADMIN_PAGES.filter((p) => p.live && p.card);

function Tile({ it }: { it: HealthItem }) {
  return (
    <article className="ad-tile" data-health={it.id} data-status={it.status}>
      <div className="ad-tile__top">
        <span className="ad-tile__label">{it.label}</span>
        <span className={'ad-pill ad-pill--' + it.status}>{LABEL[it.status]}</span>
      </div>
      <div className="ad-tile__when">{it.dayOnly ? <Day iso={it.at} /> : <When iso={it.at} />}</div>
      {it.meter ? (
        <>
          <div className="ad-meter" role="img" aria-label={it.meter.used + ' of ' + it.meter.of}>
            <i style={{ width: Math.max(Math.min(100, (it.meter.used / it.meter.of) * 100), it.meter.used ? 1.5 : 0) + '%' }} />
          </div>
          <div className="ad-meter__note">
            <span>
              {num(it.meter.used)} of {num(it.meter.of)}
            </span>
            <span>{it.meter.shareLabel || ''}</span>
          </div>
        </>
      ) : null}
      {it.parts ? (
        <ul className="ad-parts">
          {it.parts.map((p, i) => (
            <li key={i}>
              <span>
                <i className={'ad-dot ad-dot--' + p.status} />
                {p.label}
              </span>
              <span suppressHydrationWarning>{p.at ? when(p.at).replace(' ET', '') : 'No run'}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="ad-tile__detail">{it.detail || ''}</div>
      )}
    </article>
  );
}

function Health() {
  const q = useSuspenseQuery(healthQuery);
  const d = q.data;
  const bad = d.items.filter((i) => i.status === 'failed').length;
  const late = d.items.filter((i) => i.status === 'late').length;
  return (
    <section aria-labelledby="ad-h-health">
      <div className="ad-head" style={{ marginBottom: 10 }}>
        <h2 id="ad-h-health" style={{ margin: 0, fontSize: 18 }}>
          Health
        </h2>
        <div className="ad-sub">
          <span className="ad-stamp" id="ad-stamp" role="status" suppressHydrationWarning>
            {q.isFetching ? 'Checking' : (bad ? bad + ' failed' : late ? late + ' late' : 'All clear') + ' as of ' + when(d.at).replace('Today ', '')}
          </span>
          <button type="button" className="ad-btn" id="ad-refresh" onClick={() => void q.refetch()}>
            Check again
          </button>
        </div>
      </div>
      <div className="ad-strip" id="ad-strip">
        {d.items.map((it) => (
          <Tile key={it.id} it={it} />
        ))}
      </div>
    </section>
  );
}

function HealthWait() {
  return (
    <section aria-labelledby="ad-h-health">
      <div className="ad-head" style={{ marginBottom: 10 }}>
        <h2 id="ad-h-health" style={{ margin: 0, fontSize: 18 }}>
          Health
        </h2>
        <div className="ad-sub">
          <span className="ad-stamp" id="ad-stamp" role="status" />
          <button type="button" className="ad-btn" id="ad-refresh">
            Check again
          </button>
        </div>
      </div>
      <div className="ad-strip" id="ad-strip" aria-busy="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="ad-tile h-skel" style={{ minHeight: 120 }} />
        ))}
      </div>
    </section>
  );
}

function Grid({ counts }: { counts: Record<string, number> }) {
  return (
    <section aria-labelledby="ad-h-go">
      <h2 id="ad-h-go" style={{ margin: '0 0 10px', fontSize: 18 }}>
        Settings
      </h2>
      <div className="ad-grid" id="ad-go">
        {CARDS.map((p) => {
          const n = p.count ? Number(counts[p.count]) || 0 : 0;
          return (
            <NavLink key={p.id} className="ad-go" href={p.href}>
              <b>{p.label}</b>
              <span>{p.desc}</span>
              {p.count ? (
                <em data-ad-count={p.count} hidden={!n}>
                  {n ? n + ' waiting' : ''}
                </em>
              ) : null}
            </NavLink>
          );
        })}
      </div>
    </section>
  );
}

/** The menu's counts ("2 waiting") ride along once the menu read answers; the links draw without them until then. */
function Counted() {
  const { data } = useSuspenseQuery(navQuery);
  return <Grid counts={(data.counts as Record<string, number>) || {}} />;
}

/** The settings links. Every admin page is listed here whether it is a web page or a classic one yet; NavLink moves inside the app only for a route the app serves. */
function Settings() {
  return (
    <Suspense fallback={<Grid counts={{}} />}>
      <Counted />
    </Suspense>
  );
}

function Recent() {
  const { data } = useSuspenseQuery(recentAuditQuery);
  if (!data.entries.length) return <p className="ad-empty">No settings have been changed yet.</p>;
  return (
    <>
      <ul className="ad-feed">
        {data.entries.map((e) => (
          <li key={e.id}>
            <b>{e.label}</b>
            <span className="ad-feed__chg">
              <span className="mute">{e.before == null ? '' : e.before}</span> to {e.after == null ? '' : e.after}
            </span>
            <span className="ad-feed__who">
              {e.actor}, <Full iso={e.at} />
            </span>
          </li>
        ))}
      </ul>
      <p>
        <NavLink href="/admin/audit/">Open the audit log</NavLink>
      </p>
    </>
  );
}

export function OverviewPage() {
  return (
    <QueryErrorResetBoundary>
      {() => (
        <Boundary fallback={(e) => <Failed e={e} />}>
          <div className="ad" id="ad-root">
            <AdminHead on="overview" title="Admin" />
            <Suspense fallback={<HealthWait />}>
              <Health />
            </Suspense>
            <Settings />
            <section className="ad-card" aria-labelledby="ad-h-recent">
              <h2 id="ad-h-recent">Recent changes</h2>
              <div id="ad-recent">
                <Boundary fallback={() => <p className="ad-empty">The log did not load.</p>}>
                  <Suspense fallback={<p className="ad-empty">Loading.</p>}>
                    <Recent />
                  </Suspense>
                </Boundary>
              </div>
            </section>
          </div>
        </Boundary>
      )}
    </QueryErrorResetBoundary>
  );
}
