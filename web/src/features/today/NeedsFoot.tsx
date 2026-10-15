// The foot of Needs you: Show all, Log a contact and New task, whose partners the briefing shows, and how fresh the Blackbaud copy is.
// The foot is hidden when none of those has anything to say. The partner picker opens under it.
import { useEffect, useRef, useState } from 'react';
import { n0, TZ, type J } from './rank';
import { useShared } from './state';
import { helpers, renderNow } from './ui';

const stamp = (synced: string) => {
  const at = new Date(synced);
  if (isNaN(at.getTime())) return null;
  const ET = { timeZone: TZ };
  const day = (x: Date) => x.toLocaleDateString('en-CA', ET);
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...ET });
  const when = day(at) === day(new Date(renderNow())) ? time : at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...ET }) + ', ' + time;
  return { when, old: renderNow() - at.getTime() > 26 * 60 * 60 * 1000 };
};

function Picker({ kind, close }: { kind: 'contact' | 'task'; close: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    // The partner tools load after the first paint: wait for them for up to six seconds.
    let n = 0;
    let t: ReturnType<typeof setTimeout>;
    const go = () => {
      const P = helpers().FavorPartner;
      if (!P || !helpers().FavorWG) {
        if (n++ < 60) t = setTimeout(go, 100);
        return;
      }
      const el = host.current;
      if (!el) return;
      const input = P.search(el, { placeholder: 'Find a partner', onPick: (h: { cid: string }) => { closeRef.current(); P.openCompose(h.cid, kind); } });
      if (input) input.focus();
    };
    go();
    return () => clearTimeout(t);
  }, [kind]);
  return (
    <div className="wh-pick td-pick" id="wh-pick">
      <p>{kind === 'task' ? 'Which partner is the task for?' : 'Which partner did you contact?'}</p>
      <div id="wh-pick-s" ref={host} />
    </div>
  );
}

export function NeedsFoot({ home, brief, more }: { home: J | null; brief: J | null; more: { all: boolean; count: number; toggle: () => void } | null }) {
  const { owner, setOwner } = useShared();
  const [pick, setPick] = useState<'contact' | 'task' | null>(null);
  const wc = !!home && !(home.access && home.access.workCenter === false);
  // Ctrl K's Log a contact opens Today with ?quick=contact.
  useEffect(() => {
    const q = new URLSearchParams(location.search).get('quick');
    if (q === 'contact' || q === 'task') {
      setPick(q);
      setTimeout(() => document.getElementById('wh-pick')?.scrollIntoView({ block: 'center' }), 400);
    }
  }, []);
  const ds: J[] = (brief && brief.directors) || [];
  const own = brief && ds.find((d) => d.fid === brief.me);
  const opts: [string, string][] = brief && brief.partners && ds.length ? [...(own ? [] : [['', 'All partners'] as [string, string]]), ...ds.map((d) => [d.fid, d.fid === brief.me ? 'My partners' : d.name] as [string, string])] : [];
  const showScope = opts.length >= 2;
  const cur = owner || (brief && brief.owner) || '';
  const w = home && home.work;
  const s = w && w.synced ? stamp(w.synced) : null;
  const who = home && home.name && home.name !== 'Admin' ? home.name : '';
  const hasStamp = !!(who || s);
  const foot = !!more || wc || showScope || hasStamp;
  return (
    <>
      <footer className="td-foot" hidden={!foot}>
        <button type="button" className="td-more" id="td-all" hidden={!more} onClick={more?.toggle}>{more ? (more.all ? 'Show fewer' : `Show all ${n0(more.count)}`) : ''}</button>
        <div className="td-quick tw-quick" data-need="workCenter" hidden={!wc}>
          <button type="button" className="td-btn td-btn--quiet" onClick={() => setPick('contact')}>Log a contact</button>
          <button type="button" className="td-btn td-btn--quiet" onClick={() => setPick('task')}>New task</button>
        </div>
        <span className="td-scopebox" id="td-scope">
          {showScope ? (
            <label className="td-scope">
              <span className="sr-only">Whose partners</span>
              <select value={cur} onChange={(e) => setOwner(e.target.value)}>
                {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          ) : null}
        </span>
        <span className="td-stamp">
          <span className="wh-meta" id="wh-meta">
            {who}
            {who && s ? ' · ' : ''}
            {s ? (
              <>
                Blackbaud data <span className={'copy-stamp' + (s.old ? ' is-old' : '')} title={s.old ? 'The Blackbaud copy has not finished a full sync in over 26 hours, so these numbers may be behind.' : 'Numbers from the Blackbaud copy, as of its last complete sync.'}>{`as of ${s.when}`}</span>
              </>
            ) : null}
          </span>
        </span>
      </footer>
      {pick ? <Picker kind={pick} close={() => setPick(null)} /> : null}
    </>
  );
}
