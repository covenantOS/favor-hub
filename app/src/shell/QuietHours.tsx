// Quiet hours in the bell's footer (functions/_lib/quiet.ts, /api/hub/quiet). Pushes and notice emails wait during these hours and
// arrive as one summary when they end. The bell itself still lists everything.
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { api, send } from '@/lib/api';

const quietSchema = z.object({ on: z.boolean(), start: z.number(), end: z.number(), weekends: z.boolean(), tz: z.string() }).passthrough();
type Q = z.infer<typeof quietSchema>;
const hm = (n: number) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');

export function QuietHours() {
  const [q, setQ] = useState<Q | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    void api('/api/hub/quiet', quietSchema).then(setQ).catch((e: Error) => setErr(e.message));
  }, []);
  const save = (b: Record<string, unknown>) =>
    void send('/api/hub/quiet', b)
      .then((v) => setQ(quietSchema.parse(v)))
      .catch((e: Error) => setErr(e.message));
  if (!q) return err ? <p className="wm-note" role="alert">{err}</p> : null;
  return (
    <div className="wm-quiet" style={{ display: 'grid', gap: 8, padding: '10px 14px', borderTop: '1px solid var(--tc-line, #e6e2da)' }}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <span>
          <b>Quiet hours</b>
          <br />
          <small>{q.on ? 'Pushes and emails wait, then arrive as one summary' : 'Off'}</small>
        </span>
        <input type="checkbox" className="wm-switch" checked={q.on} aria-label="Quiet hours" onChange={(e) => save({ on: e.target.checked })} />
      </label>
      {q.on && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <label>
            From <input type="time" defaultValue={hm(q.start)} onChange={(e) => e.target.value && save({ start: e.target.value })} />
          </label>
          <label>
            to <input type="time" defaultValue={hm(q.end)} onChange={(e) => e.target.value && save({ end: e.target.value })} />
          </label>
          <label>
            <input type="checkbox" checked={q.weekends} onChange={(e) => save({ weekends: e.target.checked })} /> All weekend
          </label>
          <small style={{ flexBasis: '100%', opacity: 0.7 }}>{q.tz} time</small>
        </div>
      )}
      {err && <p className="wm-note" role="alert">{err}</p>}
    </div>
  );
}
