// The relationship map: a partner's relationships as a graph (spouse, family, pastor and church, employer, board, foundation contacts),
// each related partner with their giving by the shared rule. Click a person or row to open their record. Self-contained; the partner
// record mounts it with one line. Read: /api/moves/relations. Add: POST /api/moves/relations (goes to Blackbaud, or stays in FavorOS only).
import '../../../styles/moves.css';
import { Suspense, useState } from 'react';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { NavLink } from '@/shell/NavLink';
import { send } from '@/lib/api';
import { money0, dayShort } from '@/lib/format';
import { hubGet } from '../../../lib/hub';
import { mvKeys, relQuery } from '../../moves/queries';
import type { MapNode, RelGraph } from '../../moves/types';

const GROUPS: { id: MapNode['group']; label: string }[] = [
  { id: 'family', label: 'Family' },
  { id: 'church', label: 'Church' },
  { id: 'work', label: 'Work and ministry' },
  { id: 'board', label: 'Board' },
  { id: 'foundation', label: 'Foundation' },
  { id: 'other', label: 'Other' },
];
const SOURCE: Record<MapNode['source'], string> = { blackbaud: 'Blackbaud', favoros: 'Added here, sent to Blackbaud', 'favoros-only': 'FavorOS only' };
const MAX_DRAWN = 14;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '...' : s);
const W = 600;
const H = 380;

export function RelationshipMap({ id, compact = false, canAdd = true }: { id: string; compact?: boolean; canAdd?: boolean }) {
  return (
    <section className={'mv-map' + (compact ? ' is-compact' : '')} aria-label="Relationship map">
      <ErrorBoundary label="The relationship map could not load." className="pt-empty">
        <Suspense fallback={<div className="mv-map-skel r2t-skel" style={{ height: compact ? 260 : 420 }} aria-hidden="true" />}>
          <Body id={id} compact={compact} canAdd={canAdd} />
        </Suspense>
      </ErrorBoundary>
    </section>
  );
}

function Body({ id, compact, canAdd }: { id: string; compact: boolean; canAdd: boolean }) {
  const { data } = useSuspenseQuery(relQuery(id));
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const open = (cid: string) => router.history.push('/work/partner/' + cid);
  const drawn = data.nodes.slice(0, MAX_DRAWN);
  const cx = W / 2;
  const cy = H / 2;
  const rx = 215;
  const ry = 128;
  const pos = drawn.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(drawn.length, 1);
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  });
  return (
    <>
      <header className="mv-map-h">
        <h3>Relationships</h3>
        <span>
          {data.nodes.length ? `${data.nodes.length} ${data.nodes.length === 1 ? 'person' : 'people'} linked to ${data.center.name}` : `No relationships on ${data.center.name}`}
        </span>
        {canAdd ? (
          <button type="button" className="mv-link" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
            {adding ? 'Close' : 'Add a relationship'}
          </button>
        ) : null}
      </header>
      {adding ? <AddForm id={id} graph={data} onDone={() => setAdding(false)} /> : null}
      {data.nodes.length ? (
        <>
          <svg className="mv-svg" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`Relationship map for ${data.center.name}`}>
            {drawn.map((n, i) => (
              <line key={'l' + n.cid + n.role} x1={cx} y1={cy} x2={pos[i].x} y2={pos[i].y} className={'mv-edge g-' + n.group + (n.source === 'favoros-only' ? ' is-dash' : '')} />
            ))}
            {drawn.map((n, i) => {
              const right = pos[i].x >= cx;
              return (
                <g
                  key={n.cid + n.role}
                  className={'mv-node g-' + n.group}
                  transform={`translate(${pos[i].x},${pos[i].y})`}
                  role="link"
                  tabIndex={0}
                  aria-label={`${n.name}, ${n.role}, open the record`}
                  onClick={() => open(n.cid)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      open(n.cid);
                    }
                  }}
                >
                  <circle r={n.major ? 11 : 8} />
                  <text x={right ? 15 : -15} y={-2} textAnchor={right ? 'start' : 'end'} className="mv-nt">{clip(n.name, 22)}</text>
                  <text x={right ? 15 : -15} y={13} textAnchor={right ? 'start' : 'end'} className="mv-ns">{clip(n.role + (n.lifetime ? ' · ' + money0(n.lifetime) : ''), 28)}</text>
                </g>
              );
            })}
            <g className="mv-center" transform={`translate(${cx},${cy})`}>
              <circle r={26} />
              <text y={5} textAnchor="middle">{clip(data.center.name.split(' ').slice(-1)[0] || data.center.name, 9)}</text>
            </g>
          </svg>
          {data.nodes.length > MAX_DRAWN ? <p className="mv-note">The map draws the first {MAX_DRAWN}. Every person is in the list below.</p> : null}
          <List nodes={data.nodes} />
        </>
      ) : (
        <p className="mv-note">Nothing is linked to this partner in Blackbaud or FavorOS yet.</p>
      )}
    </>
  );
}

function List({ nodes }: { nodes: MapNode[] }) {
  return (
    <div className="mv-rel-groups">
      {GROUPS.map((g) => {
        const rows = nodes.filter((n) => n.group === g.id);
        if (!rows.length) return null;
        return (
          <div key={g.id} className="mv-rel-group">
            <h4 className={'g-' + g.id}>{g.label}</h4>
            <table className="mv-rel">
              <tbody>
                {rows.map((n) => (
                  <tr key={n.cid + n.role}>
                    <td className="name">
                      <NavLink href={'/work/partner/' + n.cid}>{n.name}</NavLink>
                      {n.deceased ? <em className="mv-tag">Passed on</em> : null}
                      {n.major ? <em className="mv-tag is-major">Major partner</em> : null}
                    </td>
                    <td>{n.role + (n.position ? ', ' + n.position : '')}</td>
                    <td className="n">{n.lifetime ? money0(n.lifetime) : <span className="dim">No giving</span>}</td>
                    <td className="n">{n.lastGift ? dayShort(n.lastGift) : ''}</td>
                    <td className="src">{n.source === 'blackbaud' ? '' : SOURCE[n.source]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

interface Hit { cid: string; name: string; place: string }

function AddForm({ id, graph, onDone }: { id: string; graph: RelGraph; onDone: () => void }) {
  const qc = useQueryClient();
  const [find, setFind] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [pick, setPick] = useState<Hit | null>(null);
  const [type, setType] = useState('');
  const [position, setPosition] = useState('');
  const [msg, setMsg] = useState('');
  const search = async (v: string) => {
    setFind(v);
    setPick(null);
    if (v.trim().length < 2) return setHits([]);
    try {
      const r = (await hubGet('/api/work/partners?q=' + encodeURIComponent(v.trim()))) as { rows: Hit[] };
      setHits(r.rows.filter((h) => h.cid !== id).slice(0, 6));
    } catch {
      setHits([]);
    }
  };
  const save = useMutation({
    mutationFn: async () => (await send('/api/moves/relations', { cid: id, otherCid: pick!.cid, type, position })) as { label: string; why: string; state: string },
    onSuccess: (r) => {
      setMsg(r.label + (r.why ? '. ' + r.why : ''));
      void qc.invalidateQueries({ queryKey: mvKeys.rel(id) });
      void qc.invalidateQueries({ queryKey: ['partner'] });
      setPick(null);
      setFind('');
      setType('');
      setPosition('');
      window.setTimeout(onDone, 1600);
    },
    onError: (e) => setMsg((e as Error).message),
  });
  const back = graph.types.find((t) => t.type === type)?.back;
  return (
    <form
      className="mv-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (pick && type) save.mutate();
      }}
    >
      <label>
        Who
        <input type="search" value={pick ? pick.name : find} onChange={(e) => void search(e.target.value)} placeholder="Name, email or phone" autoComplete="off" />
      </label>
      {!pick && hits.length ? (
        <ul className="mv-hits">
          {hits.map((h) => (
            <li key={h.cid}>
              <button type="button" onClick={() => setPick(h)}>
                <b>{h.name}</b> <span>{h.place}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label>
        {pick ? pick.name : 'They'} {pick ? 'is' : 'are'} {graph.center.name}'s
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Pick one</option>
          {graph.types.map((t) => (
            <option key={t.type} value={t.type}>
              {t.type}
            </option>
          ))}
        </select>
      </label>
      <label>
        Position (optional)
        <input value={position} maxLength={60} onChange={(e) => setPosition(e.target.value)} />
      </label>
      {back ? <p className="mv-note">Blackbaud files the other side as {back}.</p> : null}
      <div className="mv-add-act">
        <button type="submit" className="h-btn h-btn--primary" disabled={!pick || !type || save.isPending}>
          {save.isPending ? 'Saving' : 'Add relationship'}
        </button>
        {msg ? <span role="status">{msg}</span> : null}
      </div>
    </form>
  );
}
