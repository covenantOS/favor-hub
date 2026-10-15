// Admin > Fundraiser goals. Every fundraiser's annual and quarterly goals for a year, edited in place, with the check against the
// KPI dashboard that has to pass before the hub reads goals from FavorOS.
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { goalSaved, goalSeeded, goalSource, goalsResponse, type GoalRowData, type GoalValues, type GoalsResponse } from '@shared/schemas';
import { hubGet } from '../../lib/hub';
import { hubSend } from '../../lib/write';

const FIELDS: Array<{ key: keyof GoalValues; label: string }> = [
  { key: 'annual_goal', label: 'Annual' },
  { key: 'q1_goal', label: 'Q1' },
  { key: 'q2_goal', label: 'Q2' },
  { key: 'q3_goal', label: 'Q3' },
  { key: 'q4_goal', label: 'Q4' },
  { key: 'prev_q4_goal', label: 'Last year Q4' },
];

const usd = (n: number | null) => (n === null ? '' : '$' + Math.round(n).toLocaleString('en-US'));
const parse = (s: string): number | null => {
  const t = s.replace(/[$,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

export function goalsQuery(year?: number) {
  return {
    queryKey: ['admin', 'goals', year ?? 'now'],
    queryFn: async (): Promise<GoalsResponse> => goalsResponse.parse(await hubGet('/api/admin/goals' + (year ? `?year=${year}` : ''))),
    staleTime: 10_000,
  };
}

export function GoalsPage() {
  const [year, setYear] = useState<number | undefined>(undefined);
  const q = useQuery(goalsQuery(year));
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'goals'] });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showAll, setShowAll] = useState(false);

  const seed = useMutation({
    mutationFn: () => hubSend('/api/admin/goals', 'POST', { action: 'seed', year: q.data!.year }, (d) => goalSeeded.parse(d)),
    onSuccess: (r) => {
      setMsg({ ok: true, text: `Copied goals for ${r.added} fundraisers from Blackbaud. ${r.kept} already had goals saved.` });
      void refresh();
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });
  const source = useMutation({
    mutationFn: (to: 'dashboard' | 'favoros') => hubSend('/api/admin/goals', 'POST', { action: 'source', to }, (d) => goalSource.parse(d)),
    onSuccess: (r) => {
      setMsg({ ok: true, text: r.source === 'favoros' ? 'FavorOS now reads goals from this page.' : 'FavorOS reads goals from the KPI dashboard again.' });
      void refresh();
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });

  const rows = useMemo(() => {
    const all = q.data?.rows ?? [];
    return showAll ? all : all.filter((r) => r.active || r.saved);
  }, [q.data, showAll]);

  if (q.isLoading) {
    return (
      <section className="h-card" style={{ padding: 24, minHeight: 320 }} aria-busy="true">
        <div className="r2t-skel" style={{ height: 28, width: 260 }} />
      </section>
    );
  }
  if (q.error || !q.data) {
    return (
      <section className="h-card" style={{ padding: 24 }}>
        <p>{(q.error as Error | null)?.message || 'Goals did not load. Try again.'}</p>
      </section>
    );
  }
  const d = q.data;
  const editable = d.year === d.currentYear;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section className="h-card" style={{ padding: 20, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22 }}>Fundraiser goals</h1>
            <p style={{ margin: '4px 0 0', color: 'var(--h-ink-3)' }}>
              {d.source === 'favoros' ? 'FavorOS reads goals from this page.' : 'FavorOS still reads goals from the KPI dashboard. Switch after every line below matches.'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label htmlFor="goal-year" style={{ fontWeight: 600 }}>Year</label>
            <select id="goal-year" value={d.year} onChange={(e) => setYear(Number(e.target.value))} className="h-btn h-btn--ghost h-btn--sm">
              {[d.currentYear + 1, d.currentYear, d.currentYear - 1, d.currentYear - 2].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>
        {msg && (
          <p role="status" style={{ margin: 0, color: msg.ok ? 'var(--h-brand-ink)' : '#a1251b', fontWeight: 600 }}>{msg.text}</p>
        )}
        <TieOut d={d} onSwitch={(to) => source.mutate(to)} busy={source.isPending} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" disabled={seed.isPending || !editable} onClick={() => seed.mutate()}>
            Copy goals from Blackbaud where none are saved
          </button>
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Hide ended fundraisers' : 'Show ended fundraisers'}
          </button>
        </div>
      </section>

      <section className="h-card" style={{ padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--h-line)' }}>
              <th style={{ padding: '10px 12px' }}>Fundraiser</th>
              {FIELDS.map((f) => (
                <th key={f.key} style={{ padding: '10px 6px' }}>{f.label}</th>
              ))}
              <th style={{ padding: '10px 12px' }}>Saved</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <GoalLine key={`${d.year}-${r.id}-${r.updatedAt}`} row={r} year={d.year} editable={editable} onSaved={() => void refresh()} />
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function TieOut({ d, onSwitch, busy }: { d: GoalsResponse; onSwitch: (to: 'dashboard' | 'favoros') => void; busy: boolean }) {
  if (!d.tie) return <p style={{ margin: 0, color: 'var(--h-ink-3)' }}>The check against the KPI dashboard runs for the current year.</p>;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <table style={{ borderCollapse: 'collapse', maxWidth: 560 }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th style={{ padding: '4px 8px 4px 0' }}>Goal</th>
            <th style={{ padding: '4px 8px' }}>KPI dashboard</th>
            <th style={{ padding: '4px 8px' }}>FavorOS</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {d.tie.lines.map((l) => (
            <tr key={l.key}>
              <td style={{ padding: '4px 8px 4px 0' }}>{l.name}</td>
              <td style={{ padding: '4px 8px' }}>{usd(l.dashboard)}</td>
              <td style={{ padding: '4px 8px' }}>{usd(l.favoros)}</td>
              <td style={{ padding: '4px 8px', fontWeight: 700, color: l.match ? '#1d6b31' : '#a1251b' }}>{l.match ? 'Matches' : 'Different'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.source === 'dashboard' ? (
        <div>
          <button type="button" className="h-btn h-btn--primary h-btn--sm" disabled={busy || !d.tie.allMatch} onClick={() => onSwitch('favoros')}>
            Read goals from FavorOS
          </button>
        </div>
      ) : (
        <div>
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" disabled={busy} onClick={() => onSwitch('dashboard')}>
            Go back to the KPI dashboard goals
          </button>
        </div>
      )}
    </div>
  );
}

function GoalLine({ row, year, editable, onSaved }: { row: GoalRowData; year: number; editable: boolean; onSaved: () => void }) {
  const start = Object.fromEntries(FIELDS.map((f) => [f.key, row.goals[f.key] === null ? '' : String(row.goals[f.key])])) as Record<keyof GoalValues, string>;
  const [vals, setVals] = useState(start);
  const [err, setErr] = useState('');
  const dirty = FIELDS.some((f) => vals[f.key] !== start[f.key]);
  const save = useMutation({
    mutationFn: () => {
      const goals: Record<string, number | null> = {};
      for (const f of FIELDS) {
        const n = parse(vals[f.key]);
        if (Number.isNaN(n)) throw new Error(`${row.name}: ${f.label} must be an amount.`);
        goals[f.key] = n;
      }
      return hubSend('/api/admin/goals', 'PUT', { fundraiserId: row.id, year, goals }, (d) => goalSaved.parse(d));
    },
    onSuccess: () => {
      setErr('');
      onSaved();
    },
    onError: (e: Error) => setErr(e.message),
  });
  return (
    <>
      <tr style={{ borderBottom: '1px solid var(--h-line)' }}>
        <td style={{ padding: '8px 12px' }}>
          <div style={{ fontWeight: 600 }}>{row.name}</div>
          <div style={{ fontSize: 13, color: 'var(--h-ink-3)' }}>
            {row.type}
            {row.lead ? ', team lead' : ''}
            {row.active ? '' : ', ended'}
          </div>
        </td>
        {FIELDS.map((f) => (
          <td key={f.key} style={{ padding: '6px 4px' }}>
            <input
              aria-label={`${row.name} ${f.label}`}
              inputMode="decimal"
              value={vals[f.key]}
              disabled={!editable}
              onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
              style={{ width: 104, height: 32, padding: '0 8px', border: '1px solid var(--h-line-2)', borderRadius: 8 }}
            />
            {row.bb[f.key] !== null && row.bb[f.key] !== row.goals[f.key] && <div style={{ fontSize: 12, color: 'var(--h-ink-3)' }}>Blackbaud {usd(row.bb[f.key])}</div>}
          </td>
        ))}
        <td style={{ padding: '8px 12px', fontSize: 13, color: 'var(--h-ink-3)' }}>
          {row.updatedAt ? `${(row.updatedBy || '').split('@')[0]}, ${row.updatedAt.slice(0, 10)}` : 'Not saved'}
        </td>
        <td style={{ padding: '8px 12px' }}>
          <button type="button" className="h-btn h-btn--primary h-btn--sm" disabled={!editable || !dirty || save.isPending} onClick={() => save.mutate()}>
            Save
          </button>
        </td>
      </tr>
      {err && (
        <tr>
          <td colSpan={9} role="alert" style={{ padding: '0 12px 8px', color: '#a1251b', fontWeight: 600 }}>{err}</td>
        </tr>
      )}
    </>
  );
}
