// The Recent card: What changed (the last two weeks across FavorOS), Your recent changes (each with Undo for 24 hours) and Shared with you.
import { Suspense, useState } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { NavLink } from '@/shell/NavLink';
import { ago, clock, dayKey, et, n0, type J } from './rank';
import { dayQ, homeQ, todayQ } from './queries';
import { Ic, helpers, useNow } from './ui';

const FEED_FIRST = 6;
const APPICON: Record<string, string> = { expenses: 'expense', receipts: 'mail', requests: 'request', meetings: 'meeting', projects: 'task', tasks: 'task', chat: 'chat', feedback: 'note', learn: 'learn' };

function Feed() {
  const now = useNow();
  const { data } = useSuspenseQuery(todayQ);
  const [all, setAll] = useState(false);
  const list: J[] = data.activity || [];
  const cut = all ? list : list.slice(0, FEED_FIRST);
  const today = dayKey(now);
  const yest = dayKey(now - 864e5);
  let last = '';
  return (
    <div className="td-recent__c td-feed">
      <header className="td-ch"><h2 id="td-feed-h">What changed</h2><span className="td-ch__r td-ch__meta">Last two weeks</span></header>
      <ul className="td-flist" id="t-feed" aria-labelledby="td-feed-h">
        {list.length ? (
          cut.map((a, i) => {
            const k = dayKey(a.at);
            const head = k !== last;
            last = k;
            const inner = (
              <>
                <Ic n={APPICON[String(a.app || '').toLowerCase()] || 'flag'} cls="td-fi" />
                <span>{a.text}</span>
                <time>{clock(a.at)}</time>
              </>
            );
            return (
              <FeedItem key={i} head={head ? (k === today ? 'Today' : k === yest ? 'Yesterday' : et(a.at, { weekday: 'long', month: 'short', day: 'numeric' })) : ''}>
                {a.href ? <NavLink href={a.href}>{inner}</NavLink> : <div>{inner}</div>}
              </FeedItem>
            );
          })
        ) : (
          <li className="td-empty">Nothing in the last two weeks.</li>
        )}
      </ul>
      <button type="button" className="td-more" id="t-feed-more" hidden={list.length <= FEED_FIRST} onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show ${n0(list.length - FEED_FIRST)} more`}</button>
    </div>
  );
}

function FeedItem({ head, children }: { head: string; children: React.ReactNode }) {
  return (
    <>
      {head ? <li className="td-fg">{head}</li> : null}
      <li className="td-fr">{children}</li>
    </>
  );
}

function Changes() {
  const now = useNow();
  const { data } = useSuspenseQuery(homeQ);
  const list: J[] = ((data && data.work && data.work.recent) || []).filter((b: J) => b.mine && Date.parse(b.undo_until) > now);
  // Read in the browser only: the server has no window, and that throw was React error 419.
  const undoing = typeof window === 'undefined' ? undefined : (window as unknown as { favorUndoing?: Set<string> }).favorUndoing;
  return (
    <div className="td-recent__c td-changes wh-card" id="wh-changes" hidden={!list.length}>
      <header className="td-ch"><h2 id="wh-changes-h">Your recent changes</h2><span className="td-ch__r td-ch__meta">Undo for 24 hours</span></header>
      <ul className="wh-list wh-list--changes td-flist" id="wh-changes-list" aria-labelledby="wh-changes-h">
        {list.map((b) => {
          const off = !!b.undoing || !!(undoing && undoing.has(b.id));
          return (
            <li className="wh-chg" key={b.id}>
              <p>{b.label}{b.failed ? ` (${n0(b.failed)} not sent)` : ''}</p>
              <time dateTime={b.at}>{ago(b.at, now)}</time>
              <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-wg-undo={b.id} disabled={off} aria-busy={off || undefined}>{off ? 'Undoing' : 'Undo'}</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const fileItem = (f: J) => {
  const m = String(f.mime || '');
  const enc = encodeURIComponent(f.id);
  const base = '/api/hub/day-file?id=' + enc;
  const common = { name: f.name, sub: f.by ? 'Shared by ' + f.by : 'Google Drive', external: f.link, externalShort: 'Drive', externalLabel: 'Open in Google Drive' };
  if (/^image\//.test(m)) return { kind: 'image', url: base + '&v=thumb&s=2000', download: '', ...common };
  return { kind: 'drive', url: base + '&v=content', page: base + '&v=thumb&s=1600', embed: /folder$/.test(m) ? '' : 'https://drive.google.com/file/d/' + enc + '/preview', ...common };
};

function Files() {
  const now = useNow();
  const { data } = useSuspenseQuery(dayQ);
  const files: J[] = ((data && data.google && data.google.files) || []).slice(0, 6);
  const open = (f: J) => {
    const V = helpers().FavorChatView;
    if (!V) { location.href = f.link; return; }
    let tok: unknown = null;
    V.onClose = () => { if (tok && helpers().hubOv) { const t = tok; tok = null; helpers().hubOv!.off(t); } };
    V.open(fileItem(f));
    const ov = helpers().hubOv;
    if (ov) tok = ov.on(() => { tok = null; V.close(); });
  };
  return (
    <div className="td-recent__c td-files" id="td-files" hidden={!files.length}>
      <header className="td-ch"><h2 id="td-files-h">Shared with you</h2><span className="td-ch__r td-ch__meta">This week</span></header>
      <ul className="td-flist" id="td-files-list" aria-labelledby="td-files-h">
        {files.map((f) => {
          const a = ago(f.modified, now);
          return (
            <li className="td-fr" key={f.id}>
              <button type="button" onClick={() => open(f)}>
                <Ic n="doc" cls="td-fi" />
                <span><b>{f.name}</b><small>{[f.by, a + (a === 'now' ? '' : ' ago')].filter(Boolean).join(' · ')}</small></span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function RecentCard() {
  return (
    <section className="h-card td-card td-recent" id="td-more" aria-label="Recent">
      <ErrorBoundary label="What changed could not load.">
        <Suspense fallback={<div className="td-recent__c td-feed"><header className="td-ch"><h2 id="td-feed-h">What changed</h2><span className="td-ch__r td-ch__meta">Last two weeks</span></header><ul className="td-flist" id="t-feed" /></div>}>
          <Feed />
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary label="Your recent changes could not load.">
        <Suspense fallback={<div className="td-recent__c td-changes wh-card" id="wh-changes" hidden />}>
          <Changes />
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary label="Shared with you could not load.">
        <Suspense fallback={<div className="td-recent__c td-files" id="td-files" hidden />}>
          <Files />
        </Suspense>
      </ErrorBoundary>
    </section>
  );
}
