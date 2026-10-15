// Actions > Gift images: the gifts whose check or letter image belongs in Blackbaud (a gift of $5,000 or more, a gift from a giving fund or
// foundation, a designated gift) and that are not known to have one. Port of public/js/work-giftimages.js.
// Check asks Blackbaud whether a gift has an attachment (1 call each, POST /api/work/giftimages/check). Attach puts an image on the gift
// (POST /api/work/giftimages/attach, a form post). The list reads GET /api/work/giftimages, which makes no Blackbaud calls.
import { Suspense, useDeferredValue, useRef, useState } from 'react';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { WcError, wcForm, wcPost } from './api';
import { toast } from './engine';
import { money } from './model';
import { giftImagesQuery, wcKeys, type GiftImageRow } from './queries';
import { useDensity } from '../../../../ui/table';
import { Ic, Skel } from './ui';
import './gift-images.css';
import { useBoard, useWork } from './useWork';

const WHYS: Record<string, string> = { big: '$5,000 or more', giving_fund: 'Giving funds and foundations', designated: 'Designated funds' };
const PAGE = 100;

export function GiftImages({ as }: { as?: string }) {
  return (
    <ErrorBoundary label="The list did not load." className="h-card">
      <Suspense fallback={<Skel rows={5} />}>
        <GiftImageList as={as} />
      </Suspense>
    </ErrorBoundary>
  );
}

function GiftImageList({ as }: { as?: string }) {
  const qc = useQueryClient();
  // Sets the page's row size (compact or comfortable) so the rows draw like the other lists.
  useDensity();
  const data = useSuspenseQuery(giftImagesQuery(as)).data;
  const wc = useWork(useBoard(as));
  const [why, setWhy] = useState('');
  const [q, setQ] = useState('');
  const [designated, setDesignated] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const pick = useRef<HTMLInputElement>(null);
  const pickFor = useRef('');
  const dq = useDeferredValue(q).trim().toLowerCase();

  const s = data.stats;
  const lane = data.lane;
  const list = data.rows.filter((r) => (why ? r.why === why : designated || r.why !== 'designated') && (!dq || (r.name + ' ' + r.fund + ' ' + r.batch).toLowerCase().includes(dq)));
  const unchecked = list.filter((r) => r.state === 'unknown').slice(0, data.checkMax);
  const stats: [string, string, number][] = [
    ['', 'To attach', s.need],
    ['', 'Not checked', s.unchecked],
    ['big', WHYS.big, s.big],
    ['giving_fund', WHYS.giving_fund, s.giving],
    ['designated', WHYS.designated, s.designated],
  ];

  const mark = (ids: string[], on: boolean) =>
    setBusy((cur) => {
      const n = new Set(cur);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  const reload = () => qc.invalidateQueries({ queryKey: wcKeys.giftImages(as || '') });

  async function check(ids: string[]) {
    mark(ids, true);
    toast(ids.length > 1 ? `Checking ${ids.length} gifts…` : 'Checking…');
    try {
      const out = await wcPost<{ has: number; none: number; failed?: unknown[]; checked?: number }>('/api/work/giftimages/check', { giftIds: ids });
      const bad = out.failed && out.failed.length;
      toast(`${out.has} already ${out.has === 1 ? 'has' : 'have'} an attachment, ${out.none} ${out.none === 1 ? 'has' : 'have'} none${bad ? `, ${bad} could not be read` : ''}.`);
    } catch (e) {
      toast((e as Error).message);
    }
    mark(ids, false);
    await reload();
  }

  async function attach(id: string, file: File) {
    mark([id], true);
    toast('Attaching ' + file.name + '…');
    const form = new FormData();
    form.append('giftId', id);
    form.append('kind', 'check');
    form.append('file', file);
    try {
      await wcForm('/api/work/giftimages/attach', form);
      toast('Attached ' + file.name + '.');
    } catch (e) {
      const err = e as WcError;
      toast((err.data && (err.data.message as string)) || 'The image did not attach.');
    }
    mark([id], false);
    await reload();
  }

  const row = (r: GiftImageRow) => {
    const b = busy.has(r.giftId);
    return (
      <div className="wg-row wgi-row" data-id={r.giftId} key={r.giftId}>
        <div className="wg-amt wg-c-amt">
          {money(r.amount)}
          <small className={r.age > 14 ? 'is-late' : ''}>
            {wc.fd(r.date)} · {r.age === 0 ? 'Today' : r.age + (r.age === 1 ? ' day' : ' days')}
          </small>
        </div>
        <div className="wgi-who">
          <Link className="wg-name" to="/work/partner/$id/" params={{ id: r.cid }}>
            {r.name}
          </Link>
          <span className="wg-sub">
            {r.method}
            {r.batch ? ' · batch ' + r.batch : ''}
          </span>
        </div>
        <div className="wgi-why">
          <span className="wc-tag">{r.whyLabel}</span>
          {r.state === 'none' ? <span className="wc-tag wc-tag--gift">No attachment</span> : <span className="wc-tag">Not checked</span>}
          <span className="wg-sub">{r.fund}</span>
        </div>
        <div className="wg-acts">
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" disabled={b} onClick={() => void check([r.giftId])}>
            <Ic n="search" />
            Check
          </button>
          <button
            type="button"
            className="h-btn h-btn--primary h-btn--sm"
            disabled={b}
            onClick={() => {
              pickFor.current = r.giftId;
              pick.current?.click();
            }}
          >
            <Ic n="plus" />
            Attach
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="h-card wc-band wg-band" style={{ ['--n' as string]: 5 }}>
        {stats.map(([k, l, n]) => (
          <button key={l} type="button" className={'wc-stat' + (k && why === k ? ' is-on' : '')} onClick={k ? () => { setWhy(why === k ? '' : k); setShown(PAGE); } : undefined}>
            <b>{n}</b>
            <span>{l}</span>
          </button>
        ))}
      </div>
      <section className="h-card wc-sheet" aria-label="Gift images">
        <div className="wg-tools">
          <label className="wc-find">
            <Ic n="search" />
            <input
              type="search"
              id="wgi-q"
              placeholder="Find a partner or batch number"
              autoComplete="off"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setShown(PAGE);
              }}
            />
          </label>
          <label className="wgi-toggle">
            <input
              type="checkbox"
              checked={designated}
              onChange={(e) => {
                setDesignated(e.target.checked);
                setShown(PAGE);
              }}
            />
            Include designated funds
          </label>
          {why ? (
            <button type="button" className="wcd-chip" onClick={() => { setWhy(''); setShown(PAGE); }}>
              <Ic n="x" />
              {WHYS[why]}
            </button>
          ) : null}
          <span className="wg-spacer" />
          <button type="button" className="h-btn h-btn--primary h-btn--sm" disabled={!(unchecked.length && (!lane || lane.left >= unchecked.length))} onClick={() => unchecked.length && void check(unchecked.map((r) => r.giftId))}>
            <Ic n="search" />
            Check {unchecked.length} in Blackbaud
          </button>
        </div>
        <div className="wg-list">
          {list.length ? (
            list.slice(0, shown).map(row)
          ) : (
            <div className="wg-empty">
              <b>Every image is in</b>Gifts that need a check or letter image show here until one is attached.
            </div>
          )}
          {list.length > shown ? (
            <div className="wg-group">
              <span>{list.length - shown} more</span>
              <button type="button" onClick={() => setShown(shown + PAGE)}>
                Show {Math.min(PAGE, list.length - shown)} more
              </button>
            </div>
          ) : null}
        </div>
        <div className="wg-foot">
          <span>
            {list.length.toLocaleString('en-US')} {list.length === 1 ? 'gift' : 'gifts'} from the last {data.window} days. The Blackbaud copy holds no attachments, so Check asks Blackbaud (1 call per gift)
            {lane ? `; ${lane.left} calls are left in today's allowance for this` : ''}. Attach costs 3 calls.
          </span>
        </div>
      </section>
      <input
        ref={pick}
        type="file"
        accept="image/*,.pdf,.jpg,.jpeg,.png"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          const id = pickFor.current;
          e.target.value = '';
          if (file && id) void attach(id, file);
        }}
      />
    </>
  );
}
