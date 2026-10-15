// The Friday update for one project: the switch, the next post as it would read, and a Post now button. Only the project lead or an
// admin changes the switch. The update posts to the project's Chat channel on Fridays from 3 PM Eastern once it is on.
// Ported from public/js/projects/status.js.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ago } from '../lib/dates';
import type { Project } from '../types';
import { openSheet } from '../kit/overlays';
import { toast } from '../kit/toast';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function StatusBody({ project, close }: { project: Project; close: () => void }) {
  const [st, setSt] = useState<Any>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [err, setErr] = useState('');
  const [posting, setPosting] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .statusGet(project.id)
      .then((d) => {
        if (!live) return;
        setSt(d);
        api
          .statusDraft(project.id)
          .then((x) => live && setDraft(x.text))
          .catch(() => live && setDraft('The update could not be read right now.'));
      })
      .catch((ex) => live && setLoadErr(ex.message || 'The update settings did not load.'));
    return () => {
      live = false;
    };
  }, [project.id]);

  if (loadErr) return <p className="pj-err">{loadErr}</p>;
  if (!st)
    return (
      <div className="pj-skel" aria-busy="true">
        <i />
        <i />
      </div>
    );
  const on = !!st.status.enabled;
  const can = !!st.can.manage;
  return (
    <div className="pj-st">
      <label className={'pj-st__sw' + (can ? '' : ' is-locked')}>
        <input
          type="checkbox"
          checked={on}
          disabled={!can || busy}
          onChange={async (e) => {
            const want = e.target.checked;
            setBusy(true);
            try {
              const r = await api.statusSet(project.id, want);
              setSt({ ...st, status: r.status, channel: r.channel || st.channel });
              toast(want ? 'Friday update is on' : 'Friday update is off');
            } catch (ex) {
              setErr((ex as Error).message || 'That did not save.');
            }
            setBusy(false);
          }}
        />
        <span className="pj-st__box" aria-hidden="true" />
        <span className="pj-st__lab">
          <b>Post every Friday at 3 PM</b>
          <small>
            {st.channel ? `In the project channel, #${st.channel.name}.` : 'In a project channel that is made when this is turned on.'}
            {can ? '' : ' The project lead or an admin turns this on.'}
          </small>
        </span>
      </label>
      {on && st.status.last_posted_at ? <p className="pj-st__meta">Last posted {ago(st.status.last_posted_at)}.</p> : null}
      {st.status.last_error ? <p className="pj-err">{st.status.last_error}</p> : null}
      <span className="pj-label">This week so far</span>
      <pre className="pj-st__pre">{draft === null ? 'Loading' : draft}</pre>
      {err ? <p className="pj-err">{err}</p> : null}
      <div className="pj-sheet__foot">
        <button type="button" className="pj-btn" data-sheet-x>
          Close
        </button>
        {can ? (
          <button
            type="button"
            className="pj-btn pj-btn--primary"
            disabled={!on || posting}
            title={on ? '' : 'Turn the update on first'}
            onClick={async () => {
              setPosting(true);
              setErr('');
              try {
                const r = await api.statusPost(project.id);
                toast('Posted to #' + r.channel);
                close();
              } catch (ex) {
                setErr((ex as Error).message || 'That did not post.');
                setPosting(false);
              }
            }}
          >
            {posting ? 'Posting' : 'Post now'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function openStatus(project: Project) {
  return openSheet({ title: 'Friday update', cls: 'pj-sheet--status', render: (s) => <StatusBody project={project} close={() => s.close()} /> });
}
