// The giving pattern card and the timeline events: the port of public/js/partner-brief.js. The answers come from /api/brief/story/:id and
// /api/brief/timeline/:id, which hold the rules; this file draws them.
import type { Ev } from './types';
import { fd, type Partner } from './lib';

export const HEALTH: Record<string, string> = { growing: 'Growing', steady: 'Steady', slipping: 'Slipping', lapsing: 'Lapsing', atrisk: 'At risk', new: 'New', none: 'No gifts yet' };
const ICON: Record<string, string> = { call: 'phone', email: 'mail', meeting: 'meet', mail: 'letter', note: 'note', task: 'task', event: 'meet', chat: 'text', clip: 'link', mention: 'text' };

/** The timeline answer in the shape the page draws: gifts, contacts (t act), notes, and things from this hub (t hub). */
export function briefEvents(tl: { events?: any[] } | null | undefined): Ev[] {
  return ((tl && tl.events) || []).map((e: any): Ev => {
    if (e.kind === 'gift') return { t: 'gift', d: e.at.slice(0, 10), a: e.amount, what: e.fund || 'No fund on file', how: e.text };
    if (e.kind === 'note') return { t: 'note', d: e.at.slice(0, 10), what: e.title, text: e.text, by: e.by };
    // Mentions and meetings carry a prefilled "Add to contact log" (log) and whether it was added (logged).
    if (e.kind === 'chat' || e.kind === 'clip' || e.kind === 'mention' || String(e.id).startsWith('meet:'))
      return { t: 'hub', src: e.id, d: e.at.slice(0, 10), icon: ICON[e.kind], what: e.title, text: e.text, by: e.by, href: e.href, log: e.log || null, logged: !!e.logged };
    return { t: 'act', id: String(e.id).replace(/^act:/, ''), d: e.at.slice(0, 10), icon: ICON[e.kind] || 'task', what: e.title, text: e.text, by: (e.by || '') + (e.open ? (e.by ? ' · ' : '') + 'Open' : '') };
  });
}

export function StoryCard({ story, loading, p, onCallMode, onLog }: { story: any; loading: boolean; p: Partner; onCallMode: () => void; onLog: () => void }) {
  if (!loading && (!story || !story.story)) return null;
  if (loading || !story) {
    return (
      <section className="pp-story" aria-busy="true">
        <div className="pp-story__h">
          <h3>Giving pattern</h3>
        </div>
        <div className="pp-skel">
          <i style={{ height: 14, width: '92%' }} />
          <i style={{ height: 14, width: '78%' }} />
          <i style={{ height: 14, width: '60%' }} />
        </div>
      </section>
    );
  }
  const st = story.story;
  const n = story.nba || {};
  const callable = (p.contact.phones || []).some((x) => !x.doNotCall);
  const go =
    n.kind === 'none' ? null : (n.channel === 'call' || n.channel === 'visit') && callable ? (
      <button type="button" className="h-btn h-btn--primary h-btn--sm" onClick={onCallMode}>
        Call mode
      </button>
    ) : (
      <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={onLog}>
        Log a contact
      </button>
    );
  const r = story.rhythm || {};
  const day = (d: string) => (d ? fd(String(d).slice(0, 10)) : '');
  const CAD: Record<string, string> = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly', 'twice a year': 'Twice a year' };
  const facts = [
    CAD[r.cadence] ? ['Gives', CAD[r.cadence], ''] : null,
    r.lastDate ? ['Last gift', day(r.lastDate), ''] : null,
    r.lateDays > 0 ? ['Next gift', r.lateDays + (r.lateDays === 1 ? ' day late' : ' days late'), 'late'] : r.expectedNext ? ['Next gift', 'About ' + day(r.expectedNext), ''] : null,
  ].filter(Boolean) as string[][];
  // A written summary shows only when it is short (two sentences at most). Longer text gives way to the facts.
  const txt = String(st.text || '').trim();
  const shortText = txt && txt.length <= 180 && (txt.match(/[.!?](\s|$)/g) || []).length <= 2 ? txt : '';
  return (
    <section className="pp-story">
      <div className="pp-story__h">
        <h3>Giving pattern</h3>
        <span className={'pp-health pp-health--' + st.health}>{st.health === 'none' && /passes gifts on/.test(st.why || '') ? 'Passes gifts on' : HEALTH[st.health] || st.health}</span>
      </div>
      <p className="pp-story__t">{shortText || st.why || ''}</p>
      {facts.length ? (
        <dl className="pp-story__f">
          {facts.map(([k, v, c]) => (
            <div key={k} className={c ? 'is-' + c : undefined}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {n.label ? (
        <div className={'pp-nba pp-nba--' + n.kind}>
          <div>
            <small>Next</small>
            <b>{n.label}</b>
            <span>{n.why}</span>
          </div>
          {go}
        </div>
      ) : null}
    </section>
  );
}
