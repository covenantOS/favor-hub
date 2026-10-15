// One deposit. While it is open this is the working screen (the tie-out band, the capture card, the gift list beside the photo, the
// review pane); once it is sent the status screen takes over. Follows deposit(), band(), captureCard(), giftList(), historyHtml(),
// flagsHtml() and the click, key, drop and submit handlers in public/js/gift-entry.js.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { BodyPortal } from '@/shell/BodyPortal';
import { Camera } from './Camera';
import { Icon } from './Icon';
import { GeTerm } from './fields';
import { Pane, type PaneApi } from './Pane';
import { RejectedLine, Status, ranAt } from './Status';
import { catalogQuery, depositQuery, geWrites, historyQuery, indexQuery, lastCoding, useDepositCache } from './data';
import { LISTF, bandOf, cashCents, countFor, crumbName, etTime, filterRows, firstRow, longDay, money, moveTo, nameOf, nextLook, primaryOf, queueWord, rowName, stateOf } from './logic';
import { fileToJpeg } from './image';
import { useUploads } from './uploads';
import { geToast } from './toast';
import type { Catalog, DepositView, GeIndex, History, Row } from './types';

function useCrumb(text: string) {
  // The top bar draws after the page (it waits on the menu read), so the crumb element may not exist yet: ask again until it does.
  useEffect(() => {
    let el: HTMLElement | null = null;
    const put = () => {
      el = document.getElementById('h-crumb2');
      if (el && text) el.textContent = 'Gift entry / ' + text;
      return !!el;
    };
    let t: ReturnType<typeof setInterval> | undefined;
    if (!put()) {
      let n = 0;
      t = setInterval(() => {
        if (put() || ++n > 100) clearInterval(t);
      }, 100);
    }
    return () => {
      clearInterval(t);
      if (el) el.textContent = '';
    };
  }, [text]);
}

function HistoryBox({ r }: { r: Row }) {
  const cid = r.partner && r.partner.id ? r.partner.id : '';
  const q = useQuery({ ...historyQuery(cid, r.giftDate || ''), enabled: !!cid });
  if (!cid) return null;
  const box = (inner: React.ReactNode) => (
    <section className="ge-hist" aria-label="Giving history">
      <div className="ge-hist__hd">
        <b>Giving history</b>
        <a href={'/work/partner/' + encodeURIComponent(cid)} data-partner-id={cid}>
          Open the record
        </a>
      </div>
      {inner}
    </section>
  );
  const h: History | undefined = q.data;
  if (q.isError) return box(<p className="ge-muted">The history did not load.</p>);
  if (!h) {
    return box(
      <div className="ge-hist__row">
        <div>
          <b className="n">&nbsp;</b>
          <span>gifts before this one</span>
        </div>
        <div>
          <b className="n">&nbsp;</b>
          <span>lifetime</span>
        </div>
        <div>
          <b className="n">&nbsp;</b>
          <span>last gift</span>
        </div>
      </div>
    );
  }
  const none = h.passesOn ? 'Passes gifts on' : 'None';
  const lastLine = h.last ? 'last gift, ' + longDay(h.last.date) + (h.last.through ? ' through ' + h.last.through : '') : 'last gift';
  return box(
    <>
      <div className="ge-hist__row">
        <div>
          <b className="n">{h.count}</b>
          <span>{h.count === 1 ? 'gift before this one' : 'gifts before this one'}</span>
        </div>
        <div>
          <b className="n ge-money">{money(h.lifetimeCents)}</b>
          <span>
            <GeTerm k="lifetime" label="lifetime" />
          </span>
        </div>
        <div>
          <b className="n ge-money">{h.last ? money(h.last.cents) : none}</b>
          <span>{lastLine}</span>
        </div>
      </div>
      {h.source ? <p className="ge-muted">{h.source}</p> : null}
    </>
  );
}

/** What this gift sets off: the letters list, a personal contact appeal, a first gift. */
function Flags({ r }: { r: Row }) {
  const cid = r.partner && r.partner.id ? r.partner.id : '';
  const q = useQuery({ ...historyQuery(cid, r.giftDate || ''), enabled: !!cid });
  const out: React.ReactNode[] = [];
  if ((r.amountCents || 0) >= 500000)
    out.push(
      <div className="ge-flag" key="big">
        <b>$5,000 and up.</b> Goes to the thank-you letters list after approval. The check photo copies to the gift in Blackbaud.
      </div>
    );
  const ap = (r.appeal && r.appeal.name) || '';
  if (/personal contact/i.test(ap))
    out.push(
      <div className="ge-flag ge-flag--who" key="who">
        <b>Personal contact appeal.</b> {ap}, from the gift&apos;s fundraiser.
      </div>
    );
  if (q.data && q.data.first)
    out.push(
      <div className="ge-flag ge-flag--new" key="new">
        <b>First gift.</b> No gift is credited to this partner or their spouse before this one.
      </div>
    );
  return <>{out}</>;
}

function GiftList({ v, cur, listF, setListF, pick }: { v: DepositView; cur: string; listF: string; setListF: (f: string) => void; pick: (id: string) => void }) {
  const items = filterRows(v.rows, listF);
  return (
    <>
      <div className="ge-lchips" role="group" aria-label="Show">
        {LISTF.map(([k, l]) => (
          <button type="button" key={k} data-listf={k} className={listF === k ? 'is-on' : ''} aria-pressed={listF === k} onClick={() => setListF(k)}>
            {l} <b>{countFor(v.rows, k)}</b>
          </button>
        ))}
      </div>
      <ol className="ge-list">
        {items.length ? (
          items.map(({ r, i }) => {
            const place = r.partner && r.partner.place ? r.partner.place : '';
            return (
              <li key={r.id}>
                <button type="button" className={'ge-li is-' + stateOf(r) + (r.id === cur ? ' is-cur' : '')} data-row={r.id} aria-current={r.id === cur} onClick={() => pick(r.id)}>
                  <span className="i">{i + 1}</span>
                  <i className="dot" aria-hidden="true"></i>
                  <span className="t">
                    <b>{rowName(r)}</b>
                    <small>
                      {r.kind === 'cash' ? 'Cash' : 'Check'}
                      {place ? ' · ' + place : ''}
                    </small>
                  </span>
                  <span className="a ge-money">{r.amountCents != null ? money(r.amountCents) : ''}</span>
                </button>
              </li>
            );
          })
        ) : (
          <li className="ge-empty">Nothing here.</li>
        )}
      </ol>
    </>
  );
}

function OpenDeposit({ v, me, today, id, goHome }: { v: DepositView; me: GeIndex['me']; today: string; id: string; goHome: () => void }) {
  const qc = useQueryClient();
  const cache = useDepositCache();
  const [curId, setCurId] = useState('');
  const [ask, setAskState] = useState<'' | 'hold' | 'reject'>('');
  const [photo, setPhoto] = useState(0);
  const [listF, setListF] = useState('all');
  const [big, setBig] = useState(false);
  const [dropOn, setDropOn] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const acting = useRef(false);

  const catalog = useQuery(catalogQuery).data;
  const getCatalog = useCallback((): Promise<Catalog> => qc.ensureQueryData(catalogQuery), [qc]);

  const rows = v.rows;
  // The current row: the one picked, else the first that needs a look (the classic page chose this when the deposit opened).
  const cur: Row | null = rows.find((r) => r.id === curId) || rows.find((r) => r.id === firstRow(rows)) || null;
  const curRef = cur ? cur.id : '';

  const refresh = useCallback(async () => {
    try {
      await cache.refetch(id);
    } catch {
      // keep what is on screen
    }
  }, [cache, id]);
  const uploads = useUploads(id, refresh);

  const setAsk = (a: '' | 'hold' | 'reject') => setAskState(a);
  const pickRow = (rid: string) => {
    setCurId(rid);
    setAskState('');
    setPhoto(0);
    setBig(false);
  };

  const save = useCallback(
    async (rid: string, set: Record<string, unknown> | null, action?: string, extra?: Record<string, unknown>) => {
      try {
        const out = await geWrites.patchGift(rid, { set, action, ...(extra || {}) });
        cache.set(id, out.view);
        return true;
      } catch (e) {
        geToast((e as Error).message);
        return false;
      }
    },
    [cache, id]
  );
  const act = useCallback(
    async (rid: string, action: string, extra?: Record<string, unknown>) => {
      if (acting.current) return;
      acting.current = true;
      try {
        const wasCur = rid === curRef;
        const ok = await save(rid, null, action, extra);
        if (!ok) return;
        setAskState('');
        if (wasCur && ['approve', 'approve2', 'hold', 'reject'].includes(action)) {
          const latest = qc.getQueryData<DepositView>(depositQuery(id).queryKey);
          const list = latest ? latest.rows : [];
          const n = nextLook(list, rid);
          if (n) {
            setCurId(n);
            setPhoto(0);
          } else if (action === 'reject') setCurId((list[0] || { id: '' }).id);
        }
      } finally {
        acting.current = false;
      }
    },
    [curRef, id, qc, save]
  );
  const pickPartner = useCallback(
    async (r: Row, cid: string, name: string, place: string, lookup: string) => {
      await save(r.id, { partner_id: cid, partner_name: name, partner_place: place, partner_lookup: lookup });
      const last = await lastCoding(cid);
      const latest = qc.getQueryData<DepositView>(depositQuery(id).queryKey);
      const now = latest ? latest.rows.find((x) => x.id === r.id) : null;
      if (last && now && !now.appeal) await save(r.id, { appeal_id: last.appealId });
    },
    [id, qc, save]
  );
  const reread = useCallback(
    async (r: Row) => {
      geToast('Reading the photo again');
      try {
        const out = await geWrites.reread(r.id);
        cache.set(id, out.view);
      } catch (er) {
        geToast((er as Error).message);
      }
    },
    [cache, id]
  );
  const addFiles = async (files: File[]) => {
    for (const f of files) {
      try {
        const j = await fileToJpeg(f);
        uploads.enqueue(j.blob, (f.name || 'Photo').slice(0, 18));
      } catch {
        geToast('Could not open ' + f.name);
      }
    }
  };
  const addEnclosure = useCallback(
    async (r: Row, kind: string, files: File[]) => {
      const label = { slip: 'Reply slip', envelope: 'Reply envelope', letter: 'Letter' }[kind] || kind;
      for (const f of files) {
        try {
          const j = await fileToJpeg(f);
          uploads.enqueue(j.blob, label, kind, r.id);
        } catch {
          geToast('Could not open that photo.');
        }
      }
    },
    [uploads]
  );

  const addCash = async () => {
    const val = prompt('Cash amount in dollars');
    if (!val) return;
    const cents = cashCents(val);
    if (!cents) {
      geToast('Enter the cash amount in dollars.');
      return;
    }
    try {
      const out = await geWrites.addCash(id, cents);
      await refresh();
      setCurId(out.giftId);
      setPhoto(0);
    } catch (e) {
      geToast((e as Error).message);
    }
  };
  const sendDeposit = async () => {
    if (!v.canSend.ok) return;
    if (!confirm('Create the unapproved batch in Blackbaud with ' + v.tape.count + ' gifts and ' + money(v.tape.cents) + '?')) return;
    try {
      await geWrites.send(id);
      const out = await geWrites.run(id, false);
      ranAt.set(id, Date.now());
      cache.set(id, out);
    } catch (e) {
      geToast((e as Error).message);
      await refresh();
    }
  };
  const discard = async () => {
    if (!confirm('Throw away this deposit and its rows?')) return;
    try {
      await geWrites.discard(id);
      cache.drop(id);
      goHome();
    } catch (e) {
      geToast((e as Error).message);
    }
  };
  const openCamera = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      geToast('This browser has no live camera. Use Choose photos.');
      return;
    }
    try {
      setStream(await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false }));
    } catch {
      geToast('The camera did not open. Use Choose photos.');
    }
  };
  const closeCamera = () => {
    setStream(null);
    void refresh();
  };

  // The keys in the queue: A approve, H hold, R reject, J and K move, E the amount. They stay quiet while a person types in a field.
  const live = useRef({ cur, ask, rows, stream, me });
  live.current = { cur, ask, rows, stream, me };
  const keyApi = useRef({ act, pickRow });
  keyApi.current = { act, pickRow };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const s = live.current;
      if (s.stream) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tgt = e.target as HTMLElement | null;
      const tag = ((tgt && tgt.tagName) || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (typing) {
        if (e.key === 'Escape' && s.ask) setAskState('');
        return;
      }
      const r = s.cur;
      if (!r) return;
      const k = e.key.toLowerCase();
      if (k === 'a' || k === 'enter') {
        // Enter on a focused button or link presses that control; only the A key and Enter elsewhere approve.
        if (k === 'enter' && (tag === 'button' || tag === 'a' || tag === 'summary')) return;
        if (s.ask) return;
        const p = primaryOf(r, r.needsSecond, (s.me.email || '').toLowerCase());
        if ((p.act === 'approve' || p.act === 'approve2') && !p.disabled) {
          e.preventDefault();
          void keyApi.current.act(r.id, p.act);
        }
      } else if (k === 'h') {
        e.preventDefault();
        setAskState('hold');
      } else if (k === 'r') {
        e.preventDefault();
        setAskState('reject');
      } else if (k === 'j' || k === 'arrowright' || k === 'arrowdown') {
        e.preventDefault();
        keyApi.current.pickRow(moveTo(s.rows, r.id, 1));
      } else if (k === 'k' || k === 'arrowleft' || k === 'arrowup') {
        e.preventDefault();
        keyApi.current.pickRow(moveTo(s.rows, r.id, -1));
      } else if (k === 'e') {
        const a = document.getElementById('gf-amount') as HTMLInputElement | null;
        if (a) {
          e.preventDefault();
          a.focus();
          a.select();
        }
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  // The current row scrolls into view in the list when it changes.
  useEffect(() => {
    const el = document.querySelector('.ge-li.is-cur');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [curRef]);

  const b = bandOf(v, me.canPost);
  const d = v.deposit;
  const shown = cur ? cur.images[photo] || cur.images[0] : null;
  const idx = cur ? rows.findIndex((x) => x.id === cur.id) + 1 : 0;
  const api: PaneApi = { catalog, getCatalog, ask, setAsk, me, today, save, act, pickPartner, reread, addEnclosure };

  return (
    <div className="ge-dep2">
      <section className="h-card ge-band" id="ge-band">
        <div className="ge-band__c">
          <span className="l">Tape</span>
          <b className="n ge-money">{money(b.tapeCents)}</b>
          <span className="s">
            {b.tapeCount} {b.tapeCount === 1 ? 'item' : 'items'}
          </span>
        </div>
        <div className={'ge-band__c ' + (b.ties ? 'is-ok' : b.count ? 'is-bad' : '')}>
          <span className="l">Entered</span>
          <b className="n ge-money">{money(b.cents)}</b>
          <span className="s">
            {b.count} {b.count === 1 ? 'gift' : 'gifts'} · {b.ties ? 'ties to the tape' : b.off}
          </span>
        </div>
        <div className="ge-band__c">
          <span className="l">Approved</span>
          <b className="n">
            {b.approved} of {b.total}
          </b>
          <span className="s">{b.look} to review</span>
        </div>
        <div className={'ge-band__c ' + (b.needs ? 'is-warn' : '')}>
          <span className="l">Needs a look</span>
          <b className="n">{b.needs}</b>
          <span className="s">{b.held} held</span>
        </div>
        <div className="ge-band__send">
          <span className="s">
            Started by {nameOf(d.createdBy || '')}
            {d.createdAt ? ', ' + etTime(d.createdAt) : ''}
          </span>
          <div className="ge-prog" aria-label={`${b.approved} of ${b.total} approved`}>
            <i className="a" style={{ width: b.pct.a }}></i>
            <i className="h" style={{ width: b.pct.h }}></i>
            <i className="x" style={{ width: b.pct.x }}></i>
          </div>
          <div className="ge-band__row">
            <span className="s">{b.why}</span>
            <button type="button" className="ge-btn ge-btn--primary" data-send="" disabled={!b.canSend} onClick={() => void sendDeposit()}>
              <Icon n="send" />
              Send to Blackbaud
            </button>
          </div>
          <button type="button" className="ge-link ge-link--red ge-band__discard" data-discard="" onClick={() => void discard()}>
            Throw away this deposit
          </button>
        </div>
      </section>
      <section
        className="h-card ge-card ge-capcard"
        id="ge-drop"
        onDragEnter={(e) => {
          e.preventDefault();
          setDropOn(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDropOn(true);
        }}
        onDragLeave={() => setDropOn(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropOn(false);
          void addFiles(Array.from(e.dataTransfer.files || []).filter((f) => /^image\//.test(f.type)));
        }}
      >
        <div className={'ge-cap' + (dropOn ? ' is-drop' : '')}>
          <button type="button" className="ge-btn ge-btn--primary" data-cam="" onClick={() => void openCamera()}>
            <Icon n="cam" />
            Take photos
          </button>
          <label className="ge-btn" style={{ cursor: 'pointer' }}>
            <Icon n="img" />
            Choose photos
            <input
              type="file"
              accept="image/*"
              multiple
              hidden
              data-pick=""
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = '';
                void addFiles(files);
              }}
            />
          </label>
          <button type="button" className="ge-btn" data-addcash="" onClick={() => void addCash()}>
            <Icon n="plus" />
            Cash row
          </button>
          <span className="sp"></span>
          <span className="ge-muted">Drop scans here</span>
        </div>
        <div className="ge-queue" id="ge-queue">
          {uploads.items.map((x, i) => (
            <span key={i} className={x.state === 'error' ? 'err' : ''} data-retryq={i} onClick={() => uploads.retry(i)}>
              {x.label}: {queueWord(x)}
            </span>
          ))}
        </div>
      </section>
      <section className="h-card ge-card ge-rev" id="ge-review">
        {!rows.length ? (
          <>
            <div className="ge-hd">
              <h2>Gifts</h2>
            </div>
            <div className="ge-empty">No photos yet. Take photos of each check, or add a cash row.</div>
          </>
        ) : (
          <div className="ge-rev__grid">
            <div className="ge-rev__list">
              <GiftList v={v} cur={cur ? cur.id : ''} listF={listF} setListF={setListF} pick={pickRow} />
            </div>
            <div className="ge-rev__photo">
              {cur ? (
                <>
                  {shown ? (
                    <img className={'ge-photo' + (big ? ' is-big' : '')} data-zoom="" src={'/api/gift-entry/images/' + shown.id} alt="Photo of the item" onClick={() => setBig(!big)} />
                  ) : (
                    <div className="ge-photo-empty">No photo for this row</div>
                  )}
                  {cur.images.length > 1 ? (
                    <div className="ge-thumbs">
                      {cur.images.map((m, i) => (
                        <img
                          key={m.id}
                          src={'/api/gift-entry/images/' + m.id}
                          alt={'Photo ' + (i + 1)}
                          data-ph={i}
                          className={i === photo ? 'is-cur' : ''}
                          onClick={() => {
                            setPhoto(i);
                            setBig(false);
                          }}
                        />
                      ))}
                    </div>
                  ) : null}
                  <div id="ge-histbox">
                    <HistoryBox r={cur} />
                  </div>
                </>
              ) : null}
            </div>
            <div className="ge-rev__pane">
              {cur ? (
                <>
                  <div className="ge-rev__nav">
                    <span className="ge-muted">
                      {idx} of {rows.length}
                    </span>
                    <span className="ge-keys">
                      <kbd>A</kbd> approve <kbd>H</kbd> hold <kbd>R</kbd> reject <kbd>J</kbd> <kbd>K</kbd> move
                    </span>
                  </div>
                  <Pane key={cur.id} r={cur} api={api} />
                  <div id="ge-flags" className="ge-flags">
                    <Flags r={cur} />
                  </div>
                </>
              ) : null}
            </div>
          </div>
        )}
      </section>
      <div id="ge-rejected">
        <RejectedLine v={v} />
      </div>
      {stream
        ? BodyPortal(
            <Camera
              stream={stream}
              count={v.tape.count + uploads.items.length}
              total={v.deposit.tapeCount}
              onShot={(blob) => uploads.enqueue(blob, 'Photo ' + (uploads.items.length + 1))}
              onClose={closeCamera}
            />
          )
        : null}
    </div>
  );
}

/** The deposit named by ?d=. A deposit that cannot be read sends the person back to the front page with the reason in the toast. */
export function Deposit({ id, goHome }: { id: string; goHome: () => void }) {
  const v = useSuspenseQuery(depositQuery(id)).data;
  const me = useSuspenseQuery(indexQuery).data;
  useCrumb(crumbName(v.deposit.name));
  if (v.deposit.status !== 'open') return <Status v={v} me={me.me} id={id} goHome={goHome} />;
  return <OpenDeposit v={v} me={me.me} today={me.today} id={id} goHome={goHome} />;
}
