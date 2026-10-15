// The partner's CRM tabs and header extras (port of public/js/partner-crm.js): Gifts, Actions and Relationships, and the star and tags
// under the name. Reads /api/partners/record/<id>/* (the D1 copy of Blackbaud) and writes /api/partners/stars and /tags (FavorOS's own).
// Nothing here writes to Blackbaud.
import { Fragment, Suspense, useDeferredValue, useMemo, useState } from 'react';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { queryOptions } from '@tanstack/react-query';
import { DataTable, Pager, Seg, usePageSize, type Column, type Sort } from '../../../ui/table';
import { extrasQuery } from './queries';
import { N, fdY, useMounted, money0, rGet, rPost, todayEt, asParam } from './lib';
import { Boundary } from './Boundary';
import { Term } from './Ic';
import { RelationshipMap } from './RelationshipMap';
import { AdminOnly } from './admin';

export const CRM_TABS: [string, string][] = [
  ['gifts', 'Gifts'],
  ['actions', 'Actions'],
  ['connections', 'Relationships'],
];

const STAR = <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />;

/* ------------------------------------------------------------------ header: star and tags */
function Tag({ id, tag, onGone }: { id: string; tag: string; onGone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <span className="pc-tag">
      {tag}
      <button
        type="button"
        aria-label={'Remove the tag ' + tag}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await rPost('/api/partners/tags', { cids: [id], tag, remove: true });
            onGone();
          } catch (e) {
            setBusy(false);
            window.alert((e as Error).message);
          }
        }}
      >
        ×
      </button>
    </span>
  );
}

function AddTag({ id, onAdded }: { id: string; onAdded: () => void }) {
  return (
    <button
      type="button"
      className="pc-addtag"
      onClick={async () => {
        const tag = window.prompt('Add a tag to this partner. Tags are FavorOS labels everyone can see and filter by; they do not go to Blackbaud.', '');
        if (!tag || !tag.trim()) return;
        try {
          await rPost('/api/partners/tags', { cids: [id], tag });
          onAdded();
        } catch (e) {
          window.alert((e as Error).message);
        }
      }}
    >
      + Tag
    </button>
  );
}

/** The star and the partner's FavorOS tags under the name. */
export function StarTags({ id }: { id: string }) {
  const qc = useQueryClient();
  const mounted = useMounted();
  const q = useQuery({ ...extrasQuery(id), enabled: mounted });
  const [pending, setPending] = useState<boolean | null>(null);
  const x = q.data && !q.data.error ? q.data : null;
  const on = pending ?? !!(x && x.star);
  const tags: { tag: string }[] = (x && x.tags) || [];
  const reread = () => qc.invalidateQueries({ queryKey: extrasQuery(id).queryKey });
  if (!mounted || q.isPending) return null;
  return (
    <>
      <button
        type="button"
        className={'pc-star' + (on ? ' is-on' : '')}
        aria-pressed={on}
        title={on ? 'Starred: it shows under Starred in All partners' : 'Star this partner'}
        onClick={async () => {
          const next = !on;
          setPending(next);
          try {
            await rPost('/api/partners/stars/' + encodeURIComponent(id), { on: next });
            await reread();
          } catch {
            // put it back
          }
          setPending(null);
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {STAR}
        </svg>
        <span>{on ? 'Starred' : 'Star'}</span>
      </button>
      {tags.map((t) => (
        <Tag key={t.tag} id={id} tag={t.tag} onGone={reread} />
      ))}
      <AddTag id={id} onAdded={reread} />
    </>
  );
}

/* ------------------------------------------------------------------ the tabs */
const Skel = () => (
  <div className="pc-skel">
    <i />
    <i />
    <i />
    <i />
    <i />
  </div>
);

interface GiftRow {
  id: string; date: string; amount: number; giftAmount: number; type: string; fund: string; appeal: string; credit: string; through: { id: string; name: string } | null; to: { id: string; name: string }[]; method: string; ack: string; comment: string;
}
const ACK: Record<string, string> = { Acknowledged: 'Yes', NotAcknowledged: 'Not yet', DoNotAcknowledge: 'Do not thank' };

const PL = ({ id, name, cls }: { id: string; name: string; cls?: string }) => (
  <a className={cls} href={'/work/partner/' + encodeURIComponent(id)} data-partner-id={id}>
    {name}
  </a>
);

/** A tribute kept in FavorOS (GET /api/tributes): in honor of or in memory of someone, on one Blackbaud gift. */
interface Tribute { id: string; giftId: string; partnerId: string; kind: 'honor' | 'memorial'; honoree: string; notify: string; source: string; comment: string; giftDate: string }
const tributeWords = (t: Tribute) => (t.kind === 'memorial' ? 'In memory of ' : 'In honor of ') + t.honoree;
// Tributes share the Other gifts audience; anyone outside it gets none (the read answers 403), and the page draws as before.
const tributesQuery = (id: string, as: string) =>
  queryOptions({
    queryKey: ['pr', 'crm', id, 'tributes', as],
    queryFn: async () => (((await rGet('/api/tributes?partner=' + encodeURIComponent(id), as).catch(() => ({ tributes: [] }))) as { tributes?: Tribute[] }).tributes || []),
    staleTime: 60_000,
  });
// The gifts on the page that carry a tribute but sit on another record (a soft credit) are found by gift id.
const giftTributesQuery = (ids: string[], as: string) =>
  queryOptions({
    queryKey: ['pr', 'crm', 'tributes-by-gift', ids.join(','), as],
    queryFn: async () => (((await rGet('/api/tributes?gift=' + ids.map(encodeURIComponent).join(','), as).catch(() => ({ tributes: [] }))) as { tributes?: Tribute[] }).tributes || []),
    enabled: ids.length > 0,
    staleTime: 60_000,
  });

const giftsQuery = (id: string, page: number, size: number, sort: string, dir: string, as: string) =>
  queryOptions({
    queryKey: ['pr', 'crm', id, 'gifts', page, size, sort, dir, as],
    queryFn: async () => (await rGet(`/api/partners/record/${encodeURIComponent(id)}/gifts?${new URLSearchParams({ page: String(page), size: String(size), sort, dir })}`, as)) as { total: number; rows: GiftRow[] },
    staleTime: 30_000,
  });

const giftColsWith = (tribute: (g: GiftRow) => Tribute | undefined): Column<GiftRow>[] => [
  { key: 'date', label: 'Date', sort: 'date', firstDir: 'desc', fixed: true, cell: (g) => fdY(g.date) },
  {
    key: 'amount',
    label: 'Amount',
    sort: 'amount',
    num: true,
    fixed: true,
    cell: (g) => (
      <>
        {money0(g.amount)}
        {g.amount !== g.giftAmount ? <div className="pt-sub">of {money0(g.giftAmount)}</div> : null}
      </>
    ),
  },
  { key: 'type', label: 'Type', sort: 'type', firstDir: 'asc', fixed: true, cell: (g) => (g.type === 'RecurringGiftPayment' ? 'Recurring payment' : g.type) },
  {
    key: 'fund',
    label: 'Fund',
    className: 'is-clip',
    fixed: true,
    cell: (g) => {
      const t = tribute(g);
      return (
        <>
          {g.fund}
          {t ? (
            <div className="pt-sub pc-tribute" title={t.comment || undefined}>
              {tributeWords(t)}
            </div>
          ) : null}
        </>
      );
    },
  },
  { key: 'appeal', label: 'Appeal', fixed: true, cell: (g) => g.appeal },
  {
    key: 'how',
    label: 'Counts as',
    className: 'is-wrap',
    fixed: true,
    cell: (g) =>
      g.credit === 'soft' && g.through ? (
        <>
          <span className="pt-badge">
            <Term k="soft" />
          </span>{' '}
          <span className="pt-sub">
            through <PL id={g.through.id} name={g.through.name} />
          </span>
        </>
      ) : g.credit === 'passed' ? (
        <>
          <span className="pt-badge pt-badge--gold">
            <Term k="passedOn" />
          </span>{' '}
          <span className="pt-sub">
            for{' '}
            {g.to.slice(0, 2).map((t, i) => (
              <span key={t.id}>
                {i ? ', ' : ''}
                <PL id={t.id} name={t.name} />
              </span>
            ))}
            {g.to.length > 2 ? ' and ' + (g.to.length - 2) + ' more' : ''}
          </span>
        </>
      ) : (
        <span className="pt-badge pt-badge--good">Own</span>
      ),
  },
  { key: 'method', label: 'Method', fixed: true, cell: (g) => g.method },
  { key: 'ack', label: 'Thanked', fixed: true, cell: (g) => ACK[g.ack] || g.ack || '' },
];

function Recurring({ x }: { x: any }) {
  const r: any[] = (x && x.recurring) || [];
  if (!r.length) return null;
  const freq = (f: string) => ({ MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', WEEKLY: 'Weekly', ANNUALLY: 'Yearly', SEMIANNUALLY: 'Twice a year', BIWEEKLY: 'Every two weeks' } as Record<string, string>)[String(f).toUpperCase()] || f;
  const today = todayEt();
  return (
    <section className="pc-sec pc-recur">
      <h3>Recurring gifts</h3>
      <table className="pt-table">
        <thead>
          <tr>
            <th>Status</th>
            <th className="is-num">Amount</th>
            <th>How often</th>
            <th className="is-num">A year</th>
            <th>Since</th>
            <th>Next charge</th>
            <th>Set up by</th>
          </tr>
        </thead>
        <tbody>
          {r.map((y, i) => {
            const missed = y.status === 'Active' && y.next && y.next < today;
            return (
              <tr key={i}>
                <td>
                  <span className={'pt-badge' + (y.status === 'Active' ? ' pt-badge--good' : y.status === 'Held' ? ' pt-badge--gold' : '')}>{y.status}</span>
                  {missed ? (
                    <>
                      {' '}
                      <span className="pt-badge pt-badge--warn" title="Active, and the next charge date has passed">Missed a charge</span>
                    </>
                  ) : null}
                </td>
                <td className="is-num">{money0(y.amount)}</td>
                <td>{freq(y.frequency)}</td>
                <td className="is-num">{y.annual ? money0(y.annual) : ''}</td>
                <td>{fdY(y.start)}</td>
                <td>{y.status === 'Active' ? fdY(y.next) : y.statusDate ? y.status + ' ' + fdY(y.statusDate) : ''}</td>
                <td>{y.origin}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function Tributes({ list }: { list: Tribute[] }) {
  if (!list.length) return null;
  return (
    <section className="pc-sec pc-tributes">
      <h3>Tributes</h3>
      <ul className="pc-tlist">
        {list.map((t) => (
          <li key={t.id} title={t.comment || undefined}>
            <b>{tributeWords(t)}</b>
            <span className="pt-sub">
              {t.giftDate ? ' · gift of ' + fdY(t.giftDate) : ''}
              {t.notify ? ' · tell ' + t.notify : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Ask({ x }: { x: any }) {
  const r: any[] = (x && x.ratings) || [];
  const pick = (cat: string) => r.find((y) => y.category === cat);
  const lo = pick('Minimum ask amount - NXT');
  const hi = pick('Maximum ask amount - NXT');
  const type = pick('Recommended donor type - NXT');
  const wealth = pick('Overall wealth rating - NXT');
  if (!lo && !hi && !type) return null;
  const amt = (y: any) => (y && y.num != null ? money0(y.num) : y ? y.value : '');
  const when = (lo || hi || type).date;
  return (
    <p className="pc-ask">
      <b>Ask guidance from Blackbaud:</b> {lo || hi ? 'ask ' + [amt(lo), amt(hi)].filter(Boolean).join(' to ') : ''}
      {type ? (lo || hi ? ' · ' : '') + type.value : ''}
      {wealth ? ' · wealth rating ' + wealth.value : ''}
      {when ? <> <span className="pt-sub">({fdY(when)})</span></> : null}
    </p>
  );
}

function GiftsBody({ id }: { id: string }) {
  const [size, setSize] = usePageSize('pc-gifts', 25);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<Sort>({ col: 'date', dir: 'desc' });
  const cur = useMemo(() => ({ page, size, sort }), [page, size, sort]);
  const p = useDeferredValue(cur);
  const as = asParam();
  const { data: d } = useSuspenseQuery(giftsQuery(id, p.page, p.size, p.sort.col, p.sort.dir, as));
  // Data that streams in after the server draws is used only after mount, so the server HTML matches the first browser frame (React 418).
  const mounted = useMounted();
  const xq = useQuery(extrasQuery(id));
  const x = mounted ? xq.data : undefined;
  const tq = useQuery(tributesQuery(id, as));
  const own = useMemo(() => (mounted && tq.data) || [], [mounted, tq.data]);
  const missing = useMemo(() => (tq.data ? d.rows.map((g) => g.id).filter((gid) => gid && !own.some((t) => t.giftId === gid)) : []), [tq.data, d.rows, own]);
  const gq = useQuery(giftTributesQuery(missing, as));
  const byGift = useMemo(() => {
    const m = new Map<string, Tribute>();
    for (const t of [...own, ...((mounted && gq.data) || [])]) if (t.giftId) m.set(t.giftId, t);
    return m;
  }, [own, gq.data, mounted]);
  const cols = useMemo(() => giftColsWith((g) => byGift.get(g.id)), [byGift]);
  return (
    <>
      <Ask x={x} />
      <Recurring x={x} />
      <Tributes list={own} />
      <div className="pc-bar">
        <b>
          {N(d.total)} {d.total === 1 ? 'gift' : 'gifts'}
        </b>
        <span className="pt-sub">On this record and soft credited to it. Own and soft credit gifts count toward the partner&apos;s giving; passed-on gifts count for the partners named.</span>
      </div>
      <DataTable<GiftRow>
        listKey="pc-gifts"
        label="Gifts"
        columns={cols}
        rows={d.rows}
        rowKey={(g) => g.id + ':' + g.date + ':' + g.amount}
        rowTitle={(g) => g.comment || undefined}
        sort={sort}
        onSort={(s) => {
          setSort(s);
          setPage(1);
        }}
        noFit
        busy={p !== cur}
        empty={
          <div className="pt-empty">
            <b>No gifts yet</b>
          </div>
        }
      />
      <Pager listKey={'pc-gifts-' + id} total={d.total} page={page} size={size} onPage={(pg, sz) => (sz !== size ? (setSize(sz), setPage(1)) : setPage(pg))} />
    </>
  );
}

interface ActRow { id: string; due: string; done: string; open: boolean; type: string; category: string; summary: string; description: string; outcome: string; by: string[] }
const actionsQuery = (id: string, page: number, size: number, filter: string, as: string) =>
  queryOptions({
    queryKey: ['pr', 'crm', id, 'actions', page, size, filter, as],
    queryFn: async () => {
      const q = new URLSearchParams({ page: String(page), size: String(size) });
      if (filter) q.set('filter', filter);
      return (await rGet(`/api/partners/record/${encodeURIComponent(id)}/actions?${q}`, as)) as { total: number; rows: ActRow[] };
    },
    staleTime: 30_000,
  });
const actCols: Column<ActRow>[] = [
  { key: 'date', label: 'Date', fixed: true, cell: (a) => fdY(a.open ? a.due : a.done || a.due) },
  { key: 'status', label: 'Status', fixed: true, cell: (a) => (a.open ? <span className="pt-badge pt-badge--gold">Open</span> : <span className="pt-badge">Done</span>) },
  { key: 'category', label: 'Category', fixed: true, cell: (a) => a.category },
  { key: 'type', label: 'Type', fixed: true, cell: (a) => a.type },
  {
    key: 'summary',
    label: 'Summary',
    className: 'is-wrap',
    fixed: true,
    cell: (a) => (
      <>
        <b className="pc-sum">{a.summary || 'No summary'}</b>
        {a.description ? <div className="pt-sub pc-desc">{a.description}</div> : null}
        {a.outcome ? <div className="pt-sub">Outcome: {a.outcome}</div> : null}
      </>
    ),
  },
  { key: 'by', label: 'Fundraiser', fixed: true, cell: (a) => a.by.join(', ') },
];

function ActionsBody({ id }: { id: string }) {
  const [size, setSize] = usePageSize('pc-actions', 25);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');
  const cur = useMemo(() => ({ page, size, filter }), [page, size, filter]);
  const p = useDeferredValue(cur);
  const as = asParam();
  const { data: d } = useSuspenseQuery(actionsQuery(id, p.page, p.size, p.filter, as));
  return (
    <>
      <div className="pc-bar">
        <b>
          {N(d.total)} {d.total === 1 ? 'action' : 'actions'}
        </b>
        <Seg
          label="Show"
          value={filter}
          onChange={(k) => {
            setFilter(k);
            setPage(1);
          }}
          items={[
            { k: '', label: 'All' },
            { k: 'open', label: 'Open' },
            { k: 'contacts', label: 'Contacts' },
          ]}
        />
      </div>
      <DataTable<ActRow>
        listKey="pc-actions"
        label="Actions"
        columns={actCols}
        rows={d.rows}
        rowKey={(a) => a.id}
        noFit
        busy={p !== cur}
        empty={
          <div className="pt-empty">
            <b>No actions</b>
          </div>
        }
      />
      <Pager listKey={'pc-actions-' + id} total={d.total} page={page} size={size} onPage={(pg, sz) => (sz !== size ? (setSize(sz), setPage(1)) : setPage(pg))} />
    </>
  );
}

function Dl({ rows }: { rows: { dt: React.ReactNode; dd: React.ReactNode }[] }) {
  return (
    <dl className="pc-dl">
      {rows.map((r, i) => (
        <Fragment key={i}>
          <dt>{r.dt}</dt>
          <dd>{r.dd}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
const Sec = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="pc-sec">
    <h3>{title}</h3>
    {children}
  </section>
);
const None = ({ children }: { children: React.ReactNode }) => <p className="pt-mute pc-p">{children}</p>;

function ConnectionsBody({ id, household }: { id: string; household: { id: string; name: string }[] }) {
  const qc = useQueryClient();
  const { data: d } = useSuspenseQuery(extrasQuery(id));
  if (d.error) return <div className="pt-empty"><b>This did not load</b>{d.error}</div>;
  const rel: any[] = d.relationships || [];
  const relCols: Column<any>[] = [
    {
      key: 'name',
      label: 'Name',
      fixed: true,
      cell: (r) => (
        <>
          {r.id ? <PL id={r.id} name={r.name || 'Record ' + r.id} cls="pt-name" /> : r.name}
          {r.spouse ? <> <span className="pt-badge">Spouse</span></> : null}
          {r.contact ? <> <span className="pt-badge">Contact</span></> : null}
          {r.business ? <> <span className="pt-badge">Employer</span></> : null}
        </>
      ),
    },
    { key: 'type', label: 'Relationship', fixed: true, cell: (r) => r.type },
    { key: 'recip', label: 'Their side', fixed: true, cell: (r) => r.reciprocal },
    { key: 'pos', label: 'Position', fixed: true, cell: (r) => r.position || r.contactType },
    { key: 'since', label: 'Since', fixed: true, cell: (r) => fdY(r.start) + (r.end ? ' to ' + fdY(r.end) : '') },
    { key: 'note', label: 'Note', className: 'is-wrap', fixed: true, cell: (r) => r.comment },
  ];
  const dd = (a: any) => (a.start ? 'From ' + fdY(a.start) : '') + (a.end ? ' to ' + fdY(a.end) : '');
  const contact: { dt: React.ReactNode; dd: React.ReactNode }[] = [
    ...(d.addresses || []).map((a: any) => ({
      dt: (
        <>
          {a.type || 'Address'}
          {a.primary ? <> <span className="pt-badge pt-badge--good">Preferred</span></> : null}
        </>
      ),
      dd: (
        <>
          {[a.lines, a.city, [a.state, a.zip].filter(Boolean).join(' '), a.country && a.country !== 'United States' ? a.country : ''].filter(Boolean).join(', ')}
          {a.doNotMail ? <> <span className="pt-badge pt-badge--warn">Do not mail</span></> : null}
          {a.seasonal ? <div className="pt-sub">Seasonal {a.seasonal}</div> : null}
        </>
      ),
    })),
    ...(d.emails || []).map((e: any) => ({
      dt: (
        <>
          {e.type || 'Email'}
          {e.primary ? <> <span className="pt-badge pt-badge--good">Primary</span></> : null}
        </>
      ),
      dd: (
        <>
          <a href={'mailto:' + e.value}>{e.value}</a>
          {e.doNotEmail ? <> <span className="pt-badge pt-badge--warn">Do not email</span></> : null}
        </>
      ),
    })),
    ...(d.phones || []).map((e: any) => ({
      dt: (
        <>
          {e.type || 'Phone'}
          {e.primary ? <> <span className="pt-badge pt-badge--good">Primary</span></> : null}
        </>
      ),
      dd: (
        <>
          <a href={'tel:' + String(e.value).replace(/[^\d+]/g, '')}>{e.value}</a>
          {e.doNotCall ? <> <span className="pt-badge pt-badge--warn">Do not call</span></> : null}
        </>
      ),
    })),
    ...(d.web || []).map((w: any) => ({
      dt: w.type || 'Web',
      dd: (
        <a href={/^https?:\/\//i.test(w.value) ? w.value : 'https://' + w.value} target="_blank" rel="noopener">
          {w.value}
        </a>
      ),
    })),
  ];
  const sol = (d.solicit || []).map((x: any) => ({ dt: x.value, dd: (x.start ? 'From ' + fdY(x.start) : 'Always') + (x.end ? ' to ' + fdY(x.end) : '') }));
  const codes = (d.codes || []).map((x: any) => ({
    dt: x.value,
    dd: (
      <>
        {dd(x)}
        {x.inactive ? <> <span className="pt-badge">Inactive</span></> : null}
      </>
    ),
  }));
  const attrs = (d.attributes || []).map((x: any) => ({
    dt: x.category,
    dd: (
      <>
        {x.value}
        {x.date ? <> <span className="pt-sub">{fdY(x.date)}</span></> : null}
        {x.comment ? <div className="pt-sub">{x.comment}</div> : null}
      </>
    ),
  }));
  const ratings = (d.ratings || []).map((x: any) => ({
    dt: x.category.replace(/ - NXT$/, ''),
    dd: (
      <>
        {x.num != null && /amount|assets|income|worth|capacity value|investments/i.test(x.category) ? money0(x.num) : x.value}
        {x.date ? <> <span className="pt-sub">{fdY(x.date)}</span></> : null}
      </>
    ),
  }));
  const reread = () => qc.invalidateQueries({ queryKey: extrasQuery(id).queryKey });
  return (
    <div className="pc-grid">
      <AdminOnly>
        <RelationshipMap id={id} />
      </AdminOnly>
      <Sec title="Relationships">
        {rel.length ? (
          <DataTable<any> listKey="pc-rel" label="Relationships" columns={relCols} rows={rel} rowKey={(r) => String(r.id || r.name) + ':' + r.type} noFit />
        ) : (
          <None>
            {household.length ? (
              <>
                Household:{' '}
                {household.map((h, i) => (
                  <span key={h.id}>
                    {i ? ', ' : ''}
                    <PL id={h.id} name={h.name} />
                  </span>
                ))}
                .{' '}
              </>
            ) : null}
            No relationships on the record.
          </None>
        )}
      </Sec>
      <Sec title="Contact on file">{contact.length ? <Dl rows={contact} /> : <None>None on file.</None>}</Sec>
      <Sec title="Communication preferences (solicit codes)">{sol.length ? <Dl rows={sol} /> : <None>None. Favor may write, call and email.</None>}</Sec>
      <Sec title="Constituent codes">{codes.length ? <Dl rows={codes} /> : <None>None.</None>}</Sec>
      <Sec title="Attributes">{attrs.length ? <Dl rows={attrs} /> : <None>None.</None>}</Sec>
      <Sec title="Ratings">{ratings.length ? <Dl rows={ratings} /> : <None>None in Blackbaud.</None>}</Sec>
      <Sec title="Tags in FavorOS">
        <div className="pc-tags">
          {((d.tags || []) as { tag: string }[]).map((t) => (
            <Tag key={t.tag} id={id} tag={t.tag} onGone={reread} />
          ))}
          <AddTag id={id} onAdded={reread} />
        </div>
        <p className="pt-sub pc-p">Tags are FavorOS labels everyone can see and filter by in All partners. They do not go to Blackbaud.</p>
      </Sec>
    </div>
  );
}

/** One of Gifts, Actions or Relationships. */
export function CrmTab({ id, tab, household }: { id: string; tab: string; household: { id: string; name: string }[] }) {
  const qc = useQueryClient();
  return (
    <ErrorBoundaryLite onRetry={() => qc.resetQueries({ predicate: (q) => q.state.status === 'error' })}>
      <Suspense fallback={<Skel />}>{tab === 'gifts' ? <GiftsBody id={id} /> : tab === 'actions' ? <ActionsBody id={id} /> : <ConnectionsBody id={id} household={household} />}</Suspense>
    </ErrorBoundaryLite>
  );
}

function ErrorBoundaryLite({ children, onRetry }: { children: React.ReactNode; onRetry: () => void }) {
  return (
    <Boundary
      fallback={(e, retry) => (
        <div className="pt-empty">
          <b>This did not load</b>
          {e.message}{' '}
          <button
            type="button"
            className="h-btn h-btn--ghost h-btn--sm"
            onClick={() => {
              onRetry();
              retry();
            }}
          >
            Try again
          </button>
        </div>
      )}
    >
      {children}
    </Boundary>
  );
}
