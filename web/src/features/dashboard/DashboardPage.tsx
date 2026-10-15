// Reporting > Executive and the team tabs (/dashboard/): the KPI dashboard inside FavorOS. Port of src/pages/dashboard/index.astro.
// The hub signs the person in to the dashboard with /api/kpi/enter (no second sign-in) and shows its pages in a frame in hub mode (?embed=1).
// The dashboard tells the hub which page it shows (title, address, menu entry) and when its numbers are in; the hub's menu picks the page.
// The frame's address is in the server's HTML, so the browser starts loading the dashboard before any script runs.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from '@tanstack/react-router';
import '@hub/styles/qa-reporting.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import { KPI_ORIGIN, freshText, pageOf, withEmbed } from './pages';

const enterSrc = (page: string) => '/api/kpi/enter?next=' + encodeURIComponent(withEmbed(page));

// Messages the dashboard sends before the page has hydrated are kept here by this script, which runs as the HTML is read.
const EARLY = `(function(){var q=window.__kpiq=[];addEventListener('message',function(e){if(e.origin==='${KPI_ORIGIN}'&&e.data&&e.data.source==='kpi-dashboard'&&!window.__kpiLive)q.push(e.data);});})();`;

interface KpiMessage {
  source?: string;
  type?: string;
  path?: string;
  title?: string;
  lastUpdated?: unknown;
  stale?: boolean;
}

/** The "Updated ..." note in the top bar, drawn into the bar's actions slot (the stylesheet shows it only when the numbers are stale). */
function Fresh({ text, stale }: { text: string; stale: boolean }) {
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => {
    const el = document.getElementById('h-actions');
    if (el !== host) setHost(el);
  });
  if (!text || !host) return null;
  return createPortal(
    <span className={'h-kpi-fresh' + (stale ? ' is-stale' : '')} id="kpi-fresh">
      {text}
    </span>,
    host,
  );
}

export function DashboardPage({ page }: { page: string }) {
  const navigate = useNavigate({ from: '/dashboard/' });
  const frame = useRef<HTMLIFrameElement>(null);
  // The frame's address is set once, here. Later pages are loaded by hand so a new address in the hub never reloads the frame it already shows.
  const [src] = useState(() => enterSrc(page));
  const shown = useRef(page);
  const [cover, setCover] = useState<'wait' | 'done' | 'gone'>('wait');
  const [fresh, setFresh] = useState({ text: '', stale: false });
  const [heard, setHeard] = useState('');
  const coverTimer = useRef(0);
  const goneTimer = useRef(0);

  const lift = (on: boolean) => {
    clearTimeout(coverTimer.current);
    clearTimeout(goneTimer.current);
    if (on) {
      setCover('wait');
      return;
    }
    setCover('done');
    goneTimer.current = window.setTimeout(() => setCover('gone'), 220);
  };
  // A dashboard that never says it is ready still shows, a few seconds after it loaded.
  const lateLift = (ms: number) => {
    clearTimeout(coverTimer.current);
    coverTimer.current = window.setTimeout(() => lift(false), ms);
  };

  useEffect(() => {
    const onMessage = (data: KpiMessage) => {
      if (data.type === 'page') {
        // The header keeps the area name; the browser tab names the page.
        setHeard(data.title || 'KPI dashboard');
        const p = pageOf(data.path);
        shown.current = p;
        void navigate({ search: p === '/' ? {} : { page: p }, replace: true, resetScroll: false });
      }
      if (data.type === 'freshness') {
        lift(false);
        const text = freshText(data.lastUpdated, Boolean(data.stale));
        if (text) setFresh({ text, stale: Boolean(data.stale) });
      }
    };
    const w = window as unknown as { __kpiq?: KpiMessage[]; __kpiLive?: boolean };
    (w.__kpiq || []).splice(0).forEach(onMessage);
    w.__kpiLive = true;
    const listen = (e: MessageEvent) => {
      if (e.origin !== KPI_ORIGIN || !e.data || e.data.source !== 'kpi-dashboard') return;
      onMessage(e.data as KpiMessage);
    };
    window.addEventListener('message', listen);
    lateLift(8000);
    return () => {
      w.__kpiLive = false;
      window.removeEventListener('message', listen);
      clearTimeout(coverTimer.current);
      clearTimeout(goneTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A menu tab, Back or Forward changed the address: show that page.
  useEffect(() => {
    if (page === shown.current) return;
    shown.current = page;
    lift(true);
    lateLift(8000);
    if (frame.current) frame.current.src = KPI_ORIGIN + withEmbed(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // The browser tab names the dashboard page that is showing. The shell sets its own title after a menu change, so this waits a tick.
  useEffect(() => {
    if (!heard) return;
    const t = window.setTimeout(() => {
      document.title = heard + ' - Reporting - FavorOS';
    }, 0);
    return () => clearTimeout(t);
  }, [heard, page]);

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: EARLY }} />
      <Fresh text={fresh.text} stale={fresh.stale} />
      <div className="h-frame-wrap">
        <div className={'h-frame-wait' + (cover === 'done' ? ' is-done' : '')} id="kpi-wait" role="status" hidden={cover === 'gone'}>
          <span className="h-spin" aria-hidden="true" />
          Opening the KPI dashboard
        </div>
        <iframe ref={frame} className="h-frame h-frame--kpi" id="kpi-frame" title="KPI dashboard" src={src} onLoad={() => lateLift(5000)} />
      </div>
    </>
  );
}
