// Household giving on the partner page: each member's own credited giving, the combined figures, and the years side by side.
// The server computes every figure by the shared rule (shared/giving.ts), so a gift that credits both spouses counts once in the combined line.
import { Term } from './Ic';
import { useIsAdmin } from './admin';
import { fd, href, whole, type Partner } from './lib';

interface Member {
  id: string;
  name: string;
  relation: string;
  total: number;
  count: number;
  ytd: number;
  last12: number;
  first: string;
  lastDate: string;
  lastAmount: number;
  years: { year: string; total: number }[];
}

export function HouseholdGiving({ p, className = '' }: { p: Partner; className?: string }) {
  const admin = useIsAdmin();
  const g = p.giving;
  const members: Member[] = g.members || [];
  if (!admin || members.length < 2) return null;
  const once: number = g.sharedOnce || 0;
  const years: { year: string; total: number; count: number }[] = (g.years || []).slice(0, 6);
  const cell = (m: Member, y: string) => m.years.find((x) => x.year === y)?.total || 0;
  return (
    <section className={'pp-sec pp-hh ' + className} aria-label="Household giving">
      <h3>
        <span>
          <Term k="household" label="Household giving" />
        </span>
      </h3>
      <div className="pp-hh__scroll">
        <table className="pp-hh__t">
          <thead>
            <tr>
              <th scope="col">Member</th>
              <th scope="col">Lifetime</th>
              <th scope="col">This year</th>
              <th scope="col">Last 12 months</th>
              <th scope="col">Last gift</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <th scope="row">
                  {m.relation === 'This partner' ? <b>{m.name}</b> : <a href={href(m.id)}>{m.name}</a>}
                  <small>{m.count ? m.count + (m.count === 1 ? ' gift' : ' gifts') : 'No gifts credited'}</small>
                </th>
                <td>{whole(m.total)}</td>
                <td>{whole(m.ytd)}</td>
                <td>{whole(m.last12)}</td>
                <td>{m.lastDate ? fd(m.lastDate) : 'None'}</td>
              </tr>
            ))}
            {once > 0.005 ? (
              <tr className="pp-hh__adj">
                <th scope="row">Credited to both, counted once</th>
                <td>-{whole(once)}</td>
                <td />
                <td />
                <td />
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Household</th>
              <td>{whole(g.total)}</td>
              <td>{whole(g.ytd)}</td>
              <td>{whole(g.last12)}</td>
              <td>{g.last ? fd(g.last.date) : 'None'}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {years.length ? (
        <div className="pp-hh__scroll">
          <table className="pp-hh__t pp-hh__years">
            <thead>
              <tr>
                <th scope="col">Year</th>
                {members.map((m) => (
                  <th scope="col" key={m.id}>
                    {m.name.split(' ')[0]}
                  </th>
                ))}
                <th scope="col">Household</th>
              </tr>
            </thead>
            <tbody>
              {years.map((y) => (
                <tr key={y.year}>
                  <th scope="row">{y.year}</th>
                  {members.map((m) => (
                    <td key={m.id}>{cell(m, y.year) ? whole(cell(m, y.year)) : ''}</td>
                  ))}
                  <td>
                    <b>{whole(y.total)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
