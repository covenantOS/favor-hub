// The foundation drawer: one foundation's details, what Blackbaud holds, its history, and the forms to log a contact, mark a dead end,
// edit details and add a foundation (port of the drawer in public/js/foundations.js). Nothing goes to Blackbaud until someone logs a contact.
import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { BodyPortal } from '@/shell/BodyPortal';
import { hubOv } from '@/lib/hubOv';
import { Boundary } from '../record/Boundary';
import { bbQuery, checkQuery, detailQuery, fApi, fKeys, FndError, listQuery } from './api';
import { toast } from './toast';
import { day, money, plural, pill, today } from './util';

type SlotKind = 'log' | 'dead' | 'edit' | null;

const DEAD_RE = /not interested|does not fund|does not work/i;

export interface DrawerProps {
  /** A foundation id, 'new' for the add form, or null when closed. */
  openId: string | null;
  addName: string;
  onClose: () => void;
  onOpen: (id: string) => void;
  needWho: () => boolean;
  /** After a write: the list and the open foundation are read again. */
  onChanged: (id?: string) => Promise<void>;
}

export function FoundationDrawer(p: DrawerProps) {
  const open = !!p.openId;
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    document.documentElement.style.overflow = 'hidden';
    const tok = hubOv.on(() => p.onClose());
    if (panel.current) panel.current.scrollTop = 0;
    return () => {
      document.documentElement.style.overflow = '';
      hubOv.off(tok);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return BodyPortal(
    <div className="req-drawer fnd-drawer" id="fnd-drawer" hidden={!open}>
      <div className="req-drawer__scrim" onClick={p.onClose} />
      <aside className="req-drawer__panel" id="fnd-panel" aria-live="polite" ref={panel}>
        {p.openId === 'new' ? (
          <AddForm {...p} />
        ) : p.openId ? (
          <Boundary
            key={p.openId}
            fallback={(e) => (
              <>
                <button type="button" className="req-ghost fnd-close" onClick={p.onClose}>
                  Close
                </button>
                <p className="req-msg">{e.message}</p>
              </>
            )}
          >
            <Suspense
              fallback={
                <>
                  <button type="button" className="req-ghost fnd-close" onClick={p.onClose}>
                    Close
                  </button>
                  <p className="req-empty">Loading</p>
                </>
              }
            >
              <Detail key={p.openId} id={p.openId} {...p} />
            </Suspense>
          </Boundary>
        ) : null}
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ detail */
function Detail({ id, onClose, onOpen, needWho, onChanged }: DrawerProps & { id: string }) {
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(detailQuery(id));
  const list = useQuery(listQuery);
  const meta = list.data;
  const f = data.foundation;
  const C: any[] = data.contacts;
  const [slot, setSlot] = useState<SlotKind>(null);
  const [deadPrefill, setDeadPrefill] = useState('');
  const slotRef = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const listRow = (meta?.foundations || []).find((x: any) => x.id === f.id) || { contacts: C.length, rdds: [...new Set(C.map((c) => c.rdd).filter(Boolean))].join(','), status: f.status, bb_lookup_id: f.bb_lookup_id };
  const facts: React.ReactNode[] = [];
  if (f.phone) facts.push(f.phone);
  if (f.website) {
    facts.push(
      <a href={/^https?:/i.test(f.website) ? f.website : 'https://' + f.website} target="_blank" rel="noopener">
        {f.website.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')}
      </a>
    );
  }
  if (f.email) facts.push(f.email);
  if (f.assets) facts.push('Assets ' + f.assets);
  useEffect(() => {
    if (!slot || !slotRef.current) return;
    const first = slotRef.current.querySelector<HTMLElement>('input:not([type=radio]):not([type=checkbox]), select, textarea');
    first?.focus();
    slotRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [slot]);
  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const patch = (body: unknown) => fApi('/api/foundations/' + encodeURIComponent(id), { method: 'PATCH', body });
  return (
    <>
      <button type="button" className="req-ghost fnd-close" onClick={onClose}>
        Close
      </button>
      <div className="req-card__kicker">
        <span>{f.location || 'No address on file'}</span>
        <span>{f.ein ? 'EIN ' + f.ein : ''}</span>
      </div>
      <h2>{f.name}</h2>
      <div className="req-drawer__meta">
        {pill({ ...listRow, status: f.status, bb_lookup_id: f.bb_lookup_id, contacts: C.length })}
        <span className="req-chip">{plural(C.length, 'contact')}</span>
      </div>
      {facts.length ? (
        <p className="fnd-facts">
          {facts.map((x, i) => (
            <span key={i}>
              {i ? ' · ' : ''}
              {x}
            </span>
          ))}
        </p>
      ) : null}
      {f.notes ? <p className="fnd-facts">{f.notes}</p> : null}
      {f.status === 'dead' ? (
        <div className="fnd-bb is-warn">
          <span className="fnd-bb__kicker">Dead end</span>
          {f.dead_reason || 'No reason given.'}
          <small>It stays on the list so nobody calls it cold again. Nothing about this went to Blackbaud.</small>
        </div>
      ) : null}
      <BbBox id={id} f={f} contacts={C} meta={meta} needWho={needWho} onChanged={onChanged} />
      <div className="req-actions">
        <button type="button" className="primary" onClick={() => setSlot('log')}>
          Log a contact
        </button>
        <button
          type="button"
          onClick={() =>
            f.status === 'dead'
              ? act(async () => {
                  if (needWho()) return;
                  await patch({ status: 'open' });
                  await onChanged(id);
                  toast('Reopened.');
                })
              : (setDeadPrefill(''), setSlot('dead'))
          }
        >
          {f.status === 'dead' ? 'Reopen' : 'Mark dead end'}
        </button>
        <button type="button" onClick={() => setSlot('edit')}>
          Edit details
        </button>
      </div>
      <div id="fnd-slot" ref={slotRef}>
        {slot === 'log' && meta ? (
          <LogForm
            f={f}
            m={meta}
            needWho={needWho}
            onCancel={() => setSlot(null)}
            onSaved={async (res, dataSent) => {
              localStorage.setItem('fnd_last_rdd', dataSent.rdd);
              const c = res.contact || {};
              const dead = DEAD_RE.test(dataSent.outcome);
              await onChanged(id);
              toast(c.bb_state === 'posted' ? 'Logged and posted to Blackbaud.' : 'Saved here. ' + (c.bb_error || 'It will post to Blackbaud shortly.'));
              const fresh = qc.getQueryData<any>(detailQuery(id).queryKey);
              if (dead && fresh && fresh.foundation.status !== 'dead') {
                setDeadPrefill(`${dataSent.outcome}. ${dataSent.note}`.slice(0, 280));
                setSlot('dead');
              } else setSlot(null);
            }}
          />
        ) : null}
        {slot === 'dead' ? (
          <DeadForm
            prefill={deadPrefill}
            needWho={needWho}
            onCancel={() => setSlot(null)}
            onSave={async (reason) => {
              await patch({ status: 'dead', dead_reason: reason });
              await onChanged(id);
              toast('Marked a dead end. Nothing went to Blackbaud.');
              setSlot(null);
            }}
          />
        ) : null}
        {slot === 'edit' ? (
          <EditForm
            f={f}
            needWho={needWho}
            onCancel={() => setSlot(null)}
            onSave={async (d) => {
              await patch(d);
              await onChanged(id);
              toast('Saved.');
              setSlot(null);
            }}
          />
        ) : null}
      </div>
      <span className="exp-legend">History</span>
      <ul className="fnd-tl">
        {C.length ? (
          C.map((c) => (
            <ContactItem
              key={c.id}
              c={c}
              armed={armed === c.id}
              onArm={() => {
                setArmed(c.id);
                setTimeout(() => setArmed((a) => (a === c.id ? null : a)), 5000);
              }}
              onRetry={() =>
                act(async () => {
                  const res = await fApi(`/api/foundations/contacts/${encodeURIComponent(c.id)}`, { method: 'POST' });
                  await onChanged(id);
                  toast(res.contact && res.contact.bb_state === 'posted' ? 'Posted to Blackbaud.' : 'Still waiting. ' + ((res.contact && res.contact.bb_error) || ''));
                })
              }
              onRemove={() =>
                act(async () => {
                  if (needWho()) return;
                  if (armed !== c.id) {
                    setArmed(c.id);
                    setTimeout(() => setArmed((a) => (a === c.id ? null : a)), 5000);
                    return;
                  }
                  setArmed(null);
                  await fApi(`/api/foundations/contacts/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
                  await onChanged(id);
                  toast('Removed here and in Blackbaud.');
                })
              }
            />
          ))
        ) : (
          <li>
            <p className="is-blank">No contact logged yet.</p>
          </li>
        )}
      </ul>
    </>
  );
  void onOpen;
}

function ContactItem({ c, armed, onArm, onRetry, onRemove }: { c: any; armed: boolean; onArm: () => void; onRetry: () => void; onRemove: () => void }) {
  void onArm;
  const pills: React.ReactNode[] = [];
  if (c.bb_state === 'posted') pills.push(<span key="s" className="exp-pill approved">In Blackbaud · #{c.bb_on || ''}</span>);
  else if (c.bb_state === 'failed') pills.push(<span key="s" className="exp-pill fnd-pill-two">Did not post</span>);
  else if (c.bb_state === 'held') pills.push(<span key="s" className="exp-pill fnd-pill-work">Held, posting is off</span>);
  else pills.push(<span key="s" className="exp-pill fnd-pill-work">Waiting to post</span>);
  if (c.outcome) pills.push(<span key="o" className="exp-pill pending">{c.outcome}</span>);
  (c.tags || []).forEach((t: string) => pills.push(<span key={'t' + t} className="exp-pill pending">{t}</span>));
  if (c.bb_tags_state === 'waiting') pills.push(<span key="w" className="exp-pill fnd-pill-work" title="The tags are saved here and go to Blackbaud once the connection allows it.">Tags waiting</span>);
  return (
    <li data-contact={c.id}>
      <div className="fnd-tl__head">
        <b>
          {c.how === 'Other' ? c.category : c.how}
          {c.rdd ? ` · ${c.rdd}` : ''}
        </b>
        <span>{day(c.date)}</span>
      </div>
      <p className={c.note ? '' : 'is-blank'}>{c.note || 'No note.'}</p>
      <div className="fnd-tl__foot">
        {pills}
        {c.source === 'app' && c.bb_state !== 'posted' ? (
          <button type="button" className="fnd-textbtn" onClick={onRetry}>
            Try again
          </button>
        ) : null}
        {c.source === 'app' ? (
          <button type="button" className="fnd-textbtn is-danger" onClick={onRemove}>
            {armed ? 'Click again to remove it here and in Blackbaud' : 'Remove'}
          </button>
        ) : null}
      </div>
      {c.bb_state !== 'posted' && c.bb_error ? <div className="fnd-tl__err">{c.bb_error}</div> : null}
    </li>
  );
}

/* ------------------------------------------------------------------ Blackbaud box */
function BbBox({ id, f, contacts, meta, needWho, onChanged }: { id: string; f: any; contacts: any[]; meta: any; needWho: () => boolean; onChanged: (id?: string) => Promise<void> }) {
  const bbq = useQuery(bbQuery(id));
  const bb = bbq.data;
  const [unlinkArmed, setUnlinkArmed] = useState(false);
  const [linkId, setLinkId] = useState('');
  const link = useRef<HTMLInputElement>(null);
  const catchAll = meta?.catch_all;
  if (!catchAll) return <div className="fnd-bb" id="fnd-bb"><span className="fnd-bb__kicker">Blackbaud</span>Checking Blackbaud.</div>;
  const onCatch = contacts.filter((c) => c.bb_state === 'posted' && c.bb_on === catchAll.lookup).length;
  const doLink = async (v: string, reason?: string) => {
    try {
      if (needWho()) return;
      await fApi('/api/foundations/' + encodeURIComponent(id), { method: 'PATCH', body: reason ? { link: v, reason } : { link: v } });
      await onChanged(id);
      toast('Tied to its Blackbaud record. New contacts post there.');
    } catch (e) {
      toast((e as Error).message);
    }
  };
  if (f.bb_lookup_id) {
    const o = bb && bb.linked;
    const line = o
      ? [o.where, o.held.length ? 'Held by ' + o.held.join(', ') : 'No one assigned', o.gifts ? `${plural(o.gifts, 'gift')}, ${money(o.gift_total)}` : 'No gifts', o.grant_actions ? plural(o.grant_actions, 'grant action') : ''].filter(Boolean).join(' · ')
      : bb && bb.offline
        ? 'Blackbaud could not be reached for the details.'
        : '';
    return (
      <div className="fnd-bb is-in" id="fnd-bb">
        <span className="fnd-bb__kicker">
          In Blackbaud · #{f.bb_lookup_id}
          {o && o.codes.length ? ' · ' + o.codes.join(' · ') : ''}
        </span>
        <b>{f.bb_name || f.name}</b>
        {line ? (
          <>
            <br />
            {line}
          </>
        ) : null}
        <small>
          New contacts post to this record.
          {onCatch ? ` ${plural(onCatch, 'earlier contact')} still ${onCatch === 1 ? 'sits' : 'sit'} on the ${catchAll.name} record (#${catchAll.lookup}).` : ''}
          {f.bb_match_reason ? ` Matched on: ${f.bb_match_reason.charAt(0).toLowerCase() + f.bb_match_reason.slice(1)}.` : ''}
        </small>
        <div className="fnd-link">
          <button
            type="button"
            className="fnd-textbtn is-quiet"
            onClick={async () => {
              try {
                if (needWho()) return;
                if (!unlinkArmed) {
                  setUnlinkArmed(true);
                  return;
                }
                await fApi('/api/foundations/' + encodeURIComponent(id), { method: 'PATCH', body: { link: null } });
                await onChanged(id);
                toast('Untied. New contacts post to Unsolicited Foundations again.');
              } catch (e) {
                toast((e as Error).message);
              }
            }}
          >
            {unlinkArmed ? 'Click again to untie it' : 'Not the same foundation? Untie it'}
          </button>
        </div>
      </div>
    );
  }
  const sug: any[] = (bb && bb.suggestions) || [];
  return (
    <div className="fnd-bb" id="fnd-bb">
      <span className="fnd-bb__kicker">Not in Blackbaud</span>
      Each contact posts to Blackbaud as an action on the {catchAll.name} record (#{catchAll.lookup}), so the fundraiser&apos;s activity still counts.
      {sug.length ? (
        <>
          <small>Blackbaud has {sug.length === 1 ? 'a record' : 'records'} with a similar name. Tie one only when it is the same foundation.</small>
          <ul className="fnd-sug">
            {sug.map((o) => (
              <li key={o.lookup_id}>
                <div>
                  <b>{o.name}</b> #{o.lookup_id}
                  <span>{[o.where, o.held.length ? 'held by ' + o.held.join(', ') : 'no one assigned', o.gifts ? plural(o.gifts, 'gift') : ''].filter(Boolean).join(' · ')}</span>
                </div>
                <button type="button" className="fnd-textbtn" onClick={() => doLink(o.lookup_id, 'Picked from the Blackbaud look-alikes')}>
                  This is the one
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <div className="fnd-link">
        <input ref={link} id="fnd-link-id" inputMode="numeric" placeholder="Constituent ID" aria-label="Blackbaud constituent ID" value={linkId} onChange={(e) => setLinkId(e.target.value)} />
        <button
          type="button"
          className="fnd-textbtn"
          onClick={() => {
            if (needWho()) return;
            const v = linkId.trim();
            if (!v) return link.current?.focus();
            void doLink(v);
          }}
        >
          Tie to its Blackbaud record
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ forms */
const formData = (form: HTMLFormElement) => {
  const o: Record<string, any> = {};
  new FormData(form).forEach((v, k) => {
    if (k === 'tags') (o.tags = o.tags || []).push(v);
    else o[k] = typeof v === 'string' ? v.trim() : v;
  });
  return o;
};

/** Runs a form's save: the name is asked for first, errors show under the button. */
function useSubmit(needWho: () => boolean, run: (d: Record<string, any>, form: HTMLFormElement) => Promise<void>, openExisting?: (id: string) => void) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [again, setAgain] = useState<string | null>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    setMsg('');
    setAgain(null);
    if (needWho()) return;
    const d = formData(form);
    setBusy(true);
    try {
      await run(d, form);
    } catch (err) {
      setBusy(false);
      const fe = err as FndError;
      if (fe.data && fe.data.error === 'already_listed' && fe.data.id) {
        setMsg(fe.message);
        setAgain(fe.data.id);
      } else setMsg(fe.message);
    }
  };
  void openExisting;
  return { msg, busy, again, submit };
}

function Foot({ label, busy, msg, again, onCancel, onOpen }: { label: string; busy: boolean; msg: string; again: string | null; onCancel: () => void; onOpen?: (id: string) => void }) {
  return (
    <div className="fnd-form__foot">
      <button type="submit" className="req-submit" disabled={busy}>
        {label}
      </button>
      <button type="button" className="req-ghost" onClick={onCancel}>
        Cancel
      </button>
      <p className="req-msg" aria-live="polite">
        {msg}
        {again && onOpen ? (
          <>
            {' '}
            <button type="button" className="fnd-textbtn" onClick={() => onOpen(again)}>
              Open it
            </button>
          </>
        ) : null}
      </p>
    </div>
  );
}

function LogForm({ f, m, needWho, onCancel, onSaved }: { f: any; m: any; needWho: () => boolean; onCancel: () => void; onSaved: (res: any, sent: Record<string, any>) => Promise<void> }) {
  const target = f.bb_lookup_id ? `${f.bb_name || f.name} (#${f.bb_lookup_id})` : `${m.catch_all.name} (#${m.catch_all.lookup})`;
  const [lastRdd, setLastRdd] = useState('');
  useEffect(() => setLastRdd(localStorage.getItem('fnd_last_rdd') || ''), []);
  const teams = [...new Set<string>(m.people.map((p: any) => p.team))];
  const s = useSubmit(needWho, async (d) => {
    if (!d.outcome) throw new FndError('Choose the outcome.', 0, {});
    const res = await fApi(`/api/foundations/${encodeURIComponent(f.id)}/contacts`, { method: 'POST', body: d });
    await onSaved(res, d);
  });
  return (
    <form className="fnd-form" id="fnd-log" onSubmit={s.submit}>
      <h3>Log a contact</h3>
      <div className="exp-grid2">
        <label className="req-field">
          <span>Whose contact</span>
          <select name="rdd" required key={lastRdd} defaultValue={lastRdd}>
            <option value="">Choose</option>
            {teams.map((t) => (
              <optgroup key={t} label={t}>
                {m.people.filter((p: any) => p.team === t).map((p: any) => (
                  <option key={p.name}>{p.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="req-field">
          <span>Date</span>
          <input type="date" name="date" defaultValue={today()} max={today()} required />
        </label>
      </div>
      <fieldset className="make-pills">
        <legend>How</legend>
        {m.hows.map((h: string, i: number) => (
          <label key={h}>
            <input type="radio" name="how" value={h} defaultChecked={i === 0} />
            {h}
          </label>
        ))}
      </fieldset>
      <label className="req-field">
        <span>Outcome</span>
        <select name="outcome" defaultValue="">
          <option value="">Choose</option>
          {m.outcomes.map((o: string) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </label>
      <label className="req-field">
        <span>What happened</span>
        <textarea name="note" autoCapitalize="sentences" maxLength={4000} placeholder="Who you reached and what they said" required />
      </label>
      <fieldset className="make-pills">
        <legend>Mark what applies</legend>
        {m.tags.map((t: string) => (
          <label key={t}>
            <input type="checkbox" name="tags" value={t} />
            {t}
          </label>
        ))}
      </fieldset>
      <p className="fnd-posts">
        {m.settings.posting === 'on' ? (
          <>
            Saves here and posts to Blackbaud as an action on <b>{target}</b>.
          </>
        ) : (
          'Saves here. Posting to Blackbaud is switched off, so it waits.'
        )}
      </p>
      <Foot label="Save and post" busy={s.busy} msg={s.msg} again={null} onCancel={onCancel} />
    </form>
  );
}

function DeadForm({ prefill, needWho, onCancel, onSave }: { prefill: string; needWho: () => boolean; onCancel: () => void; onSave: (reason: string) => Promise<void> }) {
  const s = useSubmit(needWho, async (d) => onSave(d.reason));
  return (
    <form className="fnd-form" id="fnd-dead" onSubmit={s.submit}>
      <h3>Mark a dead end</h3>
      <label className="req-field">
        <span>Why</span>
        <input name="reason" maxLength={300} autoComplete="off" autoCapitalize="sentences" enterKeyHint="done" defaultValue={prefill} placeholder="Only funds in Texas. Number disconnected. Not interested." required />
      </label>
      <p className="fnd-posts">Nothing goes to Blackbaud. The foundation stays on this list with its history, so nobody calls it cold again.</p>
      <Foot label="Mark dead end" busy={s.busy} msg={s.msg} again={null} onCancel={onCancel} />
    </form>
  );
}

function Fields({ f, onName }: { f: any; onName?: (v: string) => void }) {
  const gap = <div style={{ height: 14 }} />;
  return (
    <>
      <label className="req-field">
        <span>Foundation name</span>
        <input name="name" maxLength={160} defaultValue={f.name || ''} autoComplete="off" autoCapitalize="words" enterKeyHint="next" required onChange={onName ? (e) => onName(e.target.value) : undefined} />
      </label>
      {onName ? <div id="fnd-dupes" /> : null}
      <div className="exp-grid2">
        <label className="req-field">
          <span>City and state</span>
          <input name="location" maxLength={120} autoComplete="off" autoCapitalize="words" enterKeyHint="next" defaultValue={f.location || ''} />
        </label>
        <label className="req-field">
          <span>Phone</span>
          <input name="phone" type="tel" inputMode="tel" autoComplete="off" enterKeyHint="next" maxLength={40} defaultValue={f.phone || ''} />
        </label>
      </div>
      {gap}
      <div className="exp-grid2">
        <label className="req-field">
          <span>Website</span>
          <input name="website" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" enterKeyHint="next" maxLength={200} defaultValue={f.website || ''} />
        </label>
        <label className="req-field">
          <span>Email</span>
          <input name="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" enterKeyHint="next" maxLength={120} defaultValue={f.email || ''} />
        </label>
      </div>
      {gap}
      <div className="exp-grid2">
        <label className="req-field">
          <span>EIN</span>
          <input name="ein" autoComplete="off" autoCapitalize="none" enterKeyHint="next" maxLength={20} defaultValue={f.ein || ''} />
        </label>
        <label className="req-field">
          <span>Assets</span>
          <input name="assets" autoComplete="off" enterKeyHint="next" maxLength={60} defaultValue={f.assets || ''} />
        </label>
      </div>
      {gap}
      <label className="req-field">
        <span>Notes</span>
        <textarea name="notes" maxLength={2000} style={{ minHeight: 80 }} defaultValue={f.notes || ''} />
      </label>
    </>
  );
}

function EditForm({ f, needWho, onCancel, onSave }: { f: any; needWho: () => boolean; onCancel: () => void; onSave: (d: Record<string, any>) => Promise<void> }) {
  const s = useSubmit(needWho, async (d) => onSave(d));
  return (
    <form className="fnd-form" id="fnd-edit" onSubmit={s.submit}>
      <h3>Edit details</h3>
      <Fields f={f} />
      <Foot label="Save" busy={s.busy} msg={s.msg} again={null} onCancel={onCancel} />
    </form>
  );
}

/* ------------------------------------------------------------------ add a foundation */
function Dupes({ name, onOpen }: { name: string; onOpen: (id: string) => void }) {
  const [dq, setDq] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDq(name.trim().length >= 3 ? name.trim() : ''), 320);
    return () => clearTimeout(t);
  }, [name]);
  const q = useQuery({ ...checkQuery(dq), enabled: !!dq });
  if (!dq || !q.data) return <div id="fnd-dupes" />;
  const d = q.data;
  const lines = [
    ...d.prospects.slice(0, 3).map((p: any) => (
      <li key={'p' + p.id}>
        <div>
          <b>{p.name}</b>
          <span>Already on the list, {plural(p.contacts, 'contact')}</span>
        </div>
        <button type="button" className="fnd-textbtn" onClick={() => onOpen(p.id)}>
          Open it
        </button>
      </li>
    )),
    ...d.blackbaud.slice(0, 3).map((o: any) => (
      <li key={'b' + o.lookup_id}>
        <div>
          <b>{o.name}</b> #{o.lookup_id}
          <span>Already in Blackbaud{o.held.length ? ', held by ' + o.held.join(', ') : ''}</span>
        </div>
      </li>
    )),
  ];
  return (
    <div id="fnd-dupes">
      {lines.length ? (
        <div className="fnd-bb is-warn" style={{ marginBottom: 14 }}>
          <span className="fnd-bb__kicker">Check these first</span>
          <ul className="fnd-sug" style={{ marginTop: 0 }}>
            {lines}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function AddForm({ addName, onClose, onOpen, needWho, onChanged }: DrawerProps) {
  const qc = useQueryClient();
  const [name, setName] = useState(addName);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const s = useSubmit(needWho, async (d) => {
    const res = await fApi('/api/foundations', { method: 'POST', body: d });
    window.dispatchEvent(new Event('fnd:added'));
    await onChanged(res.id);
    void qc.invalidateQueries({ queryKey: fKeys.list });
    toast('Added to the list.');
    onOpen(res.id);
  });
  return (
    <>
      <button type="button" className="req-ghost fnd-close" onClick={onClose}>
        Close
      </button>
      <div className="req-card__kicker">
        <span>New prospect</span>
      </div>
      <h2>Add a foundation</h2>
      <p className="fnd-facts">Nothing goes to Blackbaud until someone logs a contact.</p>
      <form className="fnd-form" id="fnd-new" onSubmit={s.submit}>
        <label className="req-field">
          <span>Foundation name</span>
          <input ref={ref} name="name" maxLength={160} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoCapitalize="words" enterKeyHint="next" required />
        </label>
        <Dupes name={name} onOpen={onOpen} />
        <FieldsRest />
        <Foot label="Add to the list" busy={s.busy} msg={s.msg} again={s.again} onCancel={onClose} onOpen={onOpen} />
      </form>
    </>
  );
}

/** Every field after the name (the add form draws the name itself, to keep the duplicate check beside it). */
function FieldsRest() {
  const gap = <div style={{ height: 14 }} />;
  return (
    <>
      <div className="exp-grid2">
        <label className="req-field">
          <span>City and state</span>
          <input name="location" maxLength={120} autoComplete="off" autoCapitalize="words" enterKeyHint="next" />
        </label>
        <label className="req-field">
          <span>Phone</span>
          <input name="phone" type="tel" inputMode="tel" autoComplete="off" enterKeyHint="next" maxLength={40} />
        </label>
      </div>
      {gap}
      <div className="exp-grid2">
        <label className="req-field">
          <span>Website</span>
          <input name="website" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" enterKeyHint="next" maxLength={200} />
        </label>
        <label className="req-field">
          <span>Email</span>
          <input name="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" enterKeyHint="next" maxLength={120} />
        </label>
      </div>
      {gap}
      <div className="exp-grid2">
        <label className="req-field">
          <span>EIN</span>
          <input name="ein" autoComplete="off" autoCapitalize="none" enterKeyHint="next" maxLength={20} />
        </label>
        <label className="req-field">
          <span>Assets</span>
          <input name="assets" autoComplete="off" enterKeyHint="next" maxLength={60} />
        </label>
      </div>
      {gap}
      <label className="req-field">
        <span>Notes</span>
        <textarea name="notes" maxLength={2000} style={{ minHeight: 80 }} />
      </label>
    </>
  );
}
void Fields;
