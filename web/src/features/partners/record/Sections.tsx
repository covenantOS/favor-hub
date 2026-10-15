// The Overview sections of the partner view: head, action row, owe cards, giving, due and open, timeline, notes, giving by year,
// opportunities and the contact details fold. Each draws the same markup and classes as public/js/partner.js.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Ic, Term } from './Ic';
import { StarTags } from './Crm';
import { clockLabel } from '../tools/clock';
import { copyText } from './clip';
import { toast } from './toast';
import {
  N, dayn, digits, fd, href, holderOf, ini, lateText, money, noteParts, plain, plusDays, short, todayEt, whole,
  type Note, type Opp, type Partner,
} from './lib';
import type { Ctx, Ev, LocalTask } from './types';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ------------------------------------------------------------------ head */
export function Head({ c }: { c: Ctx }) {
  const { p, mode } = c;
  const g = p.giving;
  const holders = holderOf(p);
  const iw = p.iwave;
  const flags = [p.deceased ? 'Deceased' : '', p.inactive ? 'Inactive' : '', p.flags.doNotCall ? 'Do not call' : '', p.flags.doNotEmail ? 'Do not email' : '', p.flags.doNotMail ? 'Do not mail' : ''].filter(Boolean);
  // Data care: no mailing address, or a possible duplicate (the flags come from /api/work/partners/:id).
  const dc = p.dataCare || {};
  const care = [
    dc.noAddress && dc.noAddress.state === 'open' ? { text: 'No mailing address', href: '/data-care/' } : null,
    ...((dc.pairs || []).slice(0, 1).map((x: any) => ({ text: 'Possible duplicate: ' + (x.otherName || 'another record'), href: '/data-care/?pair=' + encodeURIComponent(x.id) }))),
  ].filter(Boolean) as { text: string; href: string }[];
  const name = String(p.name || '').trim() || 'No name on file';
  return (
    <div className="pp-head">
      <div>
        <span className="pp-kicker">
          {p.kind} · ID {p.lookup}
          {g.firstDate ? ' · Giving since ' + String(g.firstDate).slice(0, 4) : ''}
        </span>
        <h1>
          {mode === 'full' ? (
            name
          ) : (
            <a href={href(p.id)} className="pp-h1link">
              {name}
            </a>
          )}
        </h1>
        <p className="pp-house">
          {p.place || 'No city on file'}
          {p.household && p.household.length ? ' · ' : ''}
          {(p.household || []).map((h, i) => (
            <Fragment key={h.id}>
              {i ? ', ' : ''}
              {h.relation || 'Household'}{' '}
              <a href={href(h.id)} className="pp-link" data-partner-id={h.id}>
                {h.name}
              </a>
            </Fragment>
          ))}
        </p>
        {mode === 'compact' ? null : (
          <div className="pc-head">
            <StarTags id={p.id} />
          </div>
        )}
      </div>
      <div className="pp-meta">
        {holders.length ? (
          holders.slice(0, 2).map((h) => (
            <div key={h.fid} className="pp-holder">
              <i>{ini(h.name)}</i>
              <span>
                <b>{h.name}</b>
                {h.type ? ' · ' + h.type : ''}
              </span>
            </div>
          ))
        ) : (
          <div className="pp-holder">
            <span>No current holder</span>
          </div>
        )}
        {iw ? (
          <div className="pp-iw" title={'iWave' + (iw.ratedOn ? ', rated ' + fd(iw.ratedOn, true) : '')}>
            iWave{' '}
            <span className="pp-iw__dots">
              {Array.from({ length: 10 }, (_, i) => (
                <s key={i} className={iw.overall != null && i < iw.overall ? 'on' : ''} />
              ))}
            </span>{' '}
            {iw.overall != null ? iw.overall : 'Not rated'}
            {iw.capacityBand ? ' · ' + iw.capacityBand : iw.capacity ? ' · ' + short(iw.capacity) : ''}
          </div>
        ) : null}
        {flags.length || care.length ? (
          <div className="pp-flags">
            {flags.map((f) => (
              <span key={f} className="pp-flag">
                {f}
              </span>
            ))}
            {care.map((x) => (
              <a key={x.href} className="pp-flag pp-flag--care" href={x.href}>
                {x.text}
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function InstrBox({ instr }: { instr: { title: string; text: string; date?: string; author?: string } | null }) {
  if (!instr) return null;
  return (
    <div className="pp-instr" role="note">
      <span className="pp-instr__k">Instruction</span>
      <p>
        {instr.title}
        {instr.text ? ' ' + instr.text : ''}
      </p>
      <small>
        {fd(instr.date, true)}
        {instr.author ? ' · ' + instr.author : ''}
      </small>
    </div>
  );
}

/* ------------------------------------------------------------------ the action row */
export function Acts({ c, onPrep, onCallMode }: { c: Ctx; onPrep: () => void; onCallMode: () => void }) {
  const { p } = c;
  const phones = p.contact.phones || [];
  const callable = phones.find((x) => !x.doNotCall);
  const mobile = phones.find((x) => !x.doNotCall && /mobile|cell/i.test(x.type || '')) || null;
  const email = (p.contact.emails || []).find((x) => !x.doNotEmail);
  const open = (k: string) => () => c.act.compose(k);
  return (
    <div className="pp-acts">
      {callable ? (
        <a className="pp-tap" href={'tel:' + digits(callable.number)}>
          <Ic n="phone" />
          Call <small>{callable.number}</small>
        </a>
      ) : (
        <span className="pp-tap is-off">
          <Ic n="phone" />
          No phone to call
        </span>
      )}
      {mobile ? (
        <a className="pp-tap" href={'sms:' + digits(mobile.number)}>
          <Ic n="text" />
          Text
        </a>
      ) : null}
      {email ? (
        <a className="pp-tap" href={'mailto:' + email.address}>
          <Ic n="mail" />
          Email
        </a>
      ) : null}
      <span className="pp-acts__sep" />
      <button type="button" className="h-btn h-btn--primary h-btn--sm" onClick={open('contact')}>
        <Ic n="plus" />
        Log a contact
      </button>
      <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={onPrep}>
        Call prep
      </button>
      {callable ? (
        <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={onCallMode}>
          <Ic n="phone" />
          Call mode
        </button>
      ) : null}
      <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={open('task')}>
        Task
      </button>
      <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={open('note')}>
        Note
      </button>
      <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-handoff-kind="partner" data-handoff-id={p.id} data-handoff-title={String(p.name || '').trim()}>
        Hand off
      </button>
      <CopyLink id={p.id} />
      {c.ix ? (
        <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-ix-ft={JSON.stringify({ kind: 'partner', ref: String(p.id), title: 'Meeting with ' + p.name, people: email ? [{ email: email.address, name: p.name }] : [] })}>
          Find a time
        </button>
      ) : null}
      {c.ix && email ? (
        <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-ix-clip={JSON.stringify({ kind: 'partner', ref: String(p.id), people: [{ email: email.address, name: p.name }] })}>
          Send a clip
        </button>
      ) : null}
    </div>
  );
}

function CopyLink({ id }: { id: string }) {
  return (
    <button
      type="button"
      className="h-btn h-btn--ghost h-btn--sm"
      onClick={async () => {
        const ok = await copyText(window.location.origin + href(id));
        toast(ok ? 'Link copied' : 'Your browser would not copy. Select the text and copy it.', null, !ok);
      }}
    >
      <Ic n="link" />
      Copy link
    </button>
  );
}

/* ------------------------------------------------------------------ gifts to thank */
export function OweCards({ c }: { c: Ctx }) {
  const { p, L } = c;
  const list = (p.toThank || []).filter((g) => !L.thanked.has(g.key));
  if (!list.length) {
    return L.thankedNow ? (
      <div className="wg-owe is-done">
        <div>
          <b>Thanked just now</b>
          <span>By {L.thankedNow}</span>
        </div>
      </div>
    ) : null;
  }
  return (
    <>
      {list.slice(0, 3).map((g) => (
        <div key={g.key} className="wg-owe" data-wg-owe={g.key}>
          <div>
            <b>{money(g.amount)} to thank</b>
            <span>
              {[
                fd(g.date),
                g.fund || '',
                g.clock && g.clock.state !== 'older' ? clockLabel(g.clock.due) : (g.ageDays || 0) > 1 ? N(g.ageDays) + ' days' : g.ageDays === 1 ? 'Yesterday' : 'Today',
              ]
                .filter(Boolean)
                .join(' · ')}
              {g.soft ? (
                <>
                  {' · '}
                  <Term k="soft" />
                </>
              ) : null}
            </span>
          </div>
          <button type="button" className="h-btn h-btn--primary h-btn--sm" onClick={(e) => c.act.thank(e.currentTarget, g)}>
            <Ic n="check" />
            Thank
          </button>
        </div>
      ))}
      {list.length > 3 ? (
        <p className="pp-empty" style={{ margin: '6px 28px 0' }}>
          {N(list.length - 3)} more {list.length - 3 === 1 ? 'gift' : 'gifts'} to thank
        </p>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ giving figures */
const Fig = ({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) => (
  <div className="pp-fig">
    <b>{value}</b>
    <span>{label}</span>
    {sub ? <small>{sub}</small> : null}
  </div>
);

export function Giving({ p }: { p: Partner }) {
  const g = p.giving;
  const spouse = (g.household || []).find((m: any) => m.relation === 'Spouse');
  const notes: ReactNode[] = [];
  if (g.source) notes.push(<span key="s"><Term k={(g.through || []).some((t: any) => t.kind === 'daf') ? 'daf' : 'soft'} label={g.source} /></span>);
  if (spouse) notes.push(<span key="h"><Term k="household" label={'Counts ' + spouse.name + '’s gifts too'} /></span>);
  if (g.status) notes.push(<span key="st"><Term k={g.status === 'LYBUNT' ? 'lybunt' : String(g.status).toLowerCase()} label={g.status} />{g.major ? <> · <Term k="major" /></> : null}</span>);
  if (g.passedOn && g.passedOn.count) notes.push(<span key="p"><Term k="passedOn" label="Passed on for others" />: {g.passedOn.line}</span>);
  return (
    <>
      <div className="pp-giving">
        <Fig label={<Term k="lifetime" label="Lifetime" />} value={whole(g.total)} sub={g.count ? N(g.count) + (g.count === 1 ? ' gift' : ' gifts') : g.passedOn && g.passedOn.count ? 'None of its own' : 'No gifts yet'} />
        <Fig label="This year" value={whole(g.ytd)} sub={'Last 12 months ' + whole(g.last12)} />
        <Fig
          label="Last gift"
          value={g.last ? money(g.last.credited != null ? g.last.credited : g.last.amount) : 'None'}
          sub={g.last ? fd(g.last.date) + (g.last.fund ? ' · ' + g.last.fund : '') + (g.last.through ? ' · through ' + g.last.through : '') : ''}
        />
        <Fig label="Largest" value={g.largest ? money(g.largest.credited != null ? g.largest.credited : g.largest.amount) : 'None'} sub={g.largest ? fd(g.largest.date, true) : ''} />
      </div>
      {notes.length ? <p className="pp-givenote">{notes}</p> : null}
    </>
  );
}

/* ------------------------------------------------------------------ due and open */
function MovePop({ anchor, onPick, onClose }: { anchor: HTMLElement; onPick: (v: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = anchor.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, r.right - el.offsetWidth)), top: r.bottom + 6 });
    const off = (ev: MouseEvent) => {
      if (!el.contains(ev.target as Node)) onClose();
    };
    const t = setTimeout(() => document.addEventListener('click', off), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('click', off);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="pp-pop" ref={ref} style={pos ? { left: pos.left, top: pos.top } : { left: -999, top: 0 }}>
      {[
        ['Tomorrow', plusDays(1)],
        ['+1 week', plusDays(7)],
        ['+2 weeks', plusDays(14)],
        ['+1 month', plusDays(30)],
      ].map(([l, v]) => (
        <button key={l} type="button" onClick={() => onPick(v)}>
          {l}
        </button>
      ))}
      <input type="date" min={todayEt()} aria-label="New due date" onChange={(e) => e.target.value && onPick(e.target.value)} />
    </div>
  );
}

export function tasksOf(p: Partner, c: Pick<Ctx, 'L'>): (LocalTask & { id: string })[] {
  const L = c.L;
  const list: LocalTask[] = (p.actions.open || []).map((a) => ({ id: a.id, what: a.summary || plain(a.type), kind: a.category || '', by: (a.fundraisers || []).map((f) => f.name).join(', '), due: L.moved[a.id] || a.due, done: L.done.has(a.id) }));
  for (const t of L.tasks) if (!list.some((x) => x.what === t.what && x.due === t.due)) list.push(t);
  return list.sort((a, b) => (a.due < b.due ? -1 : 1));
}

export function Due({ c, tasks }: { c: Ctx; tasks: LocalTask[] }) {
  const { p, mode } = c;
  const [mv, setMv] = useState<{ id: string; el: HTMLElement } | null>(null);
  if (mode === 'compact') {
    return (
      <section className="pp-sec">
        <h3>Due and open</h3>
        <div className="pp-due">
          {tasks.length ? (
            tasks.map((t) => (
              <div key={t.id} className="pp-task pp-task--ro">
                <span />
                <div className="pp-task__what">
                  <b>{t.what}</b>
                  <span>
                    {t.kind || ''}
                    {t.by ? ' · ' + t.by : ''}
                  </span>
                </div>
                <span className={'pp-datechip' + (dayn(t.due) < 0 ? ' is-late' : '')}>{dayn(t.due) < 0 ? lateText(-dayn(t.due)) : 'Due ' + fd(t.due)}</span>
              </div>
            ))
          ) : (
            <p className="pp-empty">Nothing due.</p>
          )}
        </div>
      </section>
    );
  }
  return (
    <section className="pp-sec">
      <h3>
        Due and open{' '}
        <button type="button" onClick={() => c.act.compose('task')}>
          Add a task
        </button>
      </h3>
      <div className="pp-due">
        {tasks.length ? (
          tasks.map((t) => {
            const n = dayn(t.due);
            return (
              <div key={t.id} className={'pp-task' + (t.done ? ' is-done' : '')}>
                <button type="button" className="pp-check" aria-label={'Complete ' + t.what} disabled={!!t.local} onClick={() => c.act.done(t.id)}>
                  <Ic n="check" />
                </button>
                <div className="pp-task__what">
                  {t.local ? (
                    <b>{t.what}</b>
                  ) : (
                    <button type="button" className="pp-taskopen" onClick={() => c.act.taskOpen(t.id)}>
                      {t.what}
                    </button>
                  )}
                  <span>
                    {t.kind || ''}
                    {t.by ? ' · ' + t.by : ''}
                    {t.local ? ' · Saving' : ''}
                  </span>
                </div>
                <button type="button" className={'pp-datechip' + (n < 0 && !t.done ? ' is-late' : '')} disabled={!!t.local || !!t.done} onClick={(e) => setMv({ id: t.id, el: e.currentTarget })}>
                  {t.done ? 'Done today' : n < 0 ? lateText(-n) : n === 0 ? 'Today' : 'Due ' + fd(t.due)}
                </button>
              </div>
            );
          })
        ) : (
          <p className="pp-empty">Nothing due.</p>
        )}
      </div>
      {p.actions.openCount > (p.actions.open || []).length ? (
        <p className="pp-empty pp-openmore">
          Showing {(p.actions.open || []).length} of {N(p.actions.openCount)} open. The rest are in Blackbaud.
        </p>
      ) : null}
      {mv ? (
        <MovePop
          anchor={mv.el}
          onClose={() => setMv(null)}
          onPick={(v) => {
            const id = mv.id;
            setMv(null);
            void c.act.move(id, v);
          }}
        />
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ timeline */
export function Timeline({ c }: { c: Ctx }) {
  const { V, mode, tl } = c;
  const compact = mode === 'compact';
  const evs = c.events.filter((e) => V.filter === 'all' || (V.filter === 'gifts' && e.t === 'gift') || (V.filter === 'contacts' && e.t === 'act') || (V.filter === 'notes' && e.t === 'note') || (V.filter === 'more' && e.t === 'hub'));
  const shown = compact ? 5 : V.shown;
  const filters: [string, string][] = [['all', 'All'], ['gifts', 'Gifts'], ['contacts', 'Contacts']];
  if (tl && tl.events.some((x: any) => x.kind === 'chat' || x.kind === 'clip' || x.kind === 'mention' || (x.kind === 'meeting' && String(x.id).startsWith('meet:')))) filters.push(['more', 'Mentions and meetings']);
  let month = '';
  const items: ReactNode[] = [];
  evs.slice(0, shown).forEach((e, i) => {
    const m = String(e.d).slice(0, 7);
    if (m !== month) items.push(<li key={'m' + m} className="pp-month">{MON[Number(m.slice(5)) - 1]} {m.slice(0, 4)}</li>);
    month = m;
    items.push(<EventRow key={i} e={e} c={c} compact={compact} />);
  });
  return (
    <section className="pp-sec">
      <h3>
        Timeline{' '}
        <span className="pp-filter" hidden={compact}>
          {filters.map(([k, l]) => (
            <button key={k} type="button" className={V.filter === k ? 'is-on' : ''} onClick={() => c.setV({ filter: k })}>
              {l}
            </button>
          ))}
        </span>
      </h3>
      <ul className="pp-tl">{items.length ? items : <li className="pp-empty" style={{ paddingLeft: 34 }}>Nothing here yet.</li>}</ul>
      {evs.length > shown && !compact ? (
        <button type="button" className="pp-more" onClick={() => c.setV({ shown: V.shown + 30 })}>
          Show {Math.min(30, evs.length - shown)} older
        </button>
      ) : null}
    </section>
  );
}

function EventRow({ e, c, compact }: { e: Ev; c: Ctx; compact: boolean }) {
  const when = <span className="when">{fd(e.d)}</span>;
  if (e.t === 'gift') {
    return (
      <li className={'pp-ev pp-ev--gift' + (e.fresh ? ' pp-ev--new' : '') + (e.gid && e.gid === c.focusGift ? ' is-focus' : '')} data-gift={e.gid || undefined}>
        <span className="pp-ev__dot"><Ic n="gift" /></span>
        <div>
          <span className="pp-amt">{money(e.a)}</span> <b>to {e.what}</b>
          {e.how ? <p className="by">{e.how}</p> : null}
        </div>
        {when}
      </li>
    );
  }
  if (e.t === 'note') {
    return (
      <li className={'pp-ev pp-ev--note' + (e.fresh ? ' pp-ev--new' : '')}>
        <span className="pp-ev__dot"><Ic n="note" /></span>
        <div>
          <b>{e.what}</b>
          {e.text ? <p>{e.text}</p> : null}
          <p className="by">Note{e.by ? ' · ' + e.by : ''}</p>
        </div>
        {when}
      </li>
    );
  }
  // A mention or a meeting: one press adds it to the contact log, prefilled. It is never logged by itself.
  const logged = e.logged || (e.src ? c.L.logged.has(e.src) : false);
  const logBtn = e.log && !compact ? (logged ? <p className="by pp-logged">In the contact log</p> : <button type="button" className="pp-edit pp-logit" onClick={() => c.act.logit(e.src || '')}>Add to contact log</button>) : null;
  return (
    <li className={'pp-ev' + (e.fresh ? ' pp-ev--new' : '')}>
      <span className="pp-ev__dot"><Ic n={e.icon || 'task'} /></span>
      <div>
        <b>{e.href ? <a href={e.href}>{e.what}</a> : e.what}</b>
        {e.text ? <p>{String(e.text).slice(0, 400)}</p> : null}
        {e.by ? <p className="by">{e.by}</p> : null}
        {logBtn}
      </div>
      {when}
    </li>
  );
}

/* ------------------------------------------------------------------ notes */
function NoteItem({ n, c }: { n: Note; c: Ctx }) {
  const x = noteParts(n);
  const long = x.text.length > 220 || x.text.split('\n').length > 3;
  const open = c.V.noteOpen.has(String(n.id));
  return (
    <li className={'pp-nt' + (x.instr ? ' pp-nt--instr' : '') + (n.local ? ' is-local' : '')}>
      <div className="pp-nt__top">
        <span className="pp-nt__type">{x.label}</span>
        <span className="pp-nt__when">
          {fd(n.date, true)}
          {n.author ? ' · ' + n.author : ''}
        </span>
      </div>
      <b>{x.title}</b>
      {x.text ? (
        <>
          <p className={'pp-nt__text' + (long && !open ? ' is-clamped' : '')}>{x.text}</p>
          {long ? (
            <button
              type="button"
              className="pp-nt__more"
              aria-expanded={open}
              onClick={() => {
                const s = new Set(c.V.noteOpen);
                if (s.has(String(n.id))) s.delete(String(n.id));
                else s.add(String(n.id));
                c.setV({ noteOpen: s });
              }}
            >
              {open ? 'Show less' : 'Read all'}
            </button>
          ) : null}
        </>
      ) : null}
      {n.local ? (
        <div className="pp-nt__foot"><span className="pp-nt__st">Saving</span></div>
      ) : null}
    </li>
  );
}

export function NotesSection({ c, list }: { c: Ctx; list: Note[] | null }) {
  const { V, mode } = c;
  return (
    <section className="pp-sec pp-notes">
      <h3>
        Notes{list ? <> <span className="pp-count">{list.length}</span></> : null}
        {mode === 'compact' ? null : (
          <>
            {' '}
            <button type="button" onClick={() => c.act.compose('note')}>
              Add a note
            </button>
          </>
        )}
      </h3>
      {list === null ? (
        <p className="pp-empty">Loading notes.</p>
      ) : list.length ? (
        <>
          <ul className="pp-nl">
            {list.slice(0, V.notesShown).map((n) => (
              <NoteItem key={n.id} n={n} c={c} />
            ))}
          </ul>
          {list.length > V.notesShown ? (
            <button type="button" className="pp-more" onClick={() => c.setV({ notesShown: V.notesShown + 10 })}>
              Show {Math.min(10, list.length - V.notesShown)} older
            </button>
          ) : null}
        </>
      ) : (
        <p className="pp-empty">No notes on this partner.</p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ giving by year */
export function Chart({ p }: { p: Partner }) {
  const g = p.giving;
  const years = (g.years || []).slice(0, 8).reverse() as { year: string; total: number; count: number; soft?: number }[];
  if (!years.length) return null;
  const max = Math.max(1, ...years.map((y) => y.total));
  const nowYear = todayEt().slice(0, 4);
  return (
    <section className="pp-sec">
      <h3>Giving by year</h3>
      <div className="pp-chart" style={{ gridTemplateColumns: `repeat(${years.length}, minmax(0, 1fr))` }}>
        {years.map((y) => {
          const via = Math.min(y.soft || 0, y.total);
          const words = `${y.year}: ${whole(y.total)} in ${y.count} ${y.count === 1 ? 'gift' : 'gifts'}${via ? (via >= y.total - 0.005 ? ', all through another record (soft credit)' : `, ${whole(via)} of it through another record (soft credit)`) : ''}`;
          return (
            <div key={y.year} className={'pp-bar2' + (y.year === nowYear ? ' is-now' : '')} title={words} aria-label={words}>
              <em>{short(y.total)}</em>
              <i style={{ height: Math.max(4, Math.round((y.total / max) * 92)) }}>{via ? <b className="pp-bar2__via" style={{ height: Math.round((via / Math.max(y.total, 1)) * 100) + '%' }} /> : null}</i>
              <span>{y.year}</span>
            </div>
          );
        })}
      </div>
      {years.some((y) => y.soft) ? (
        <p className="pp-chartkey">
          <s />
          <Term k="soft" label="Through a DAF, foundation or business" />
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ opportunities */
function OppForm({ c, x, codes }: { c: Ctx; x: Opp | null; codes: any }) {
  const C = (codes && codes.codes) || {};
  const st: string[] = C.oppStatuses || ['Researching', 'Planned', 'Application in Progress', 'Application Submitted', 'Awarded - Active', 'Awarded - Closed', 'Declined', 'Abandoned'];
  const v = x || { id: '', name: '', status: 'Planned', ask: undefined, expected: undefined, deadline: '', expectedDate: '' };
  return (
    <form
      className="pp-compose pp-oppform"
      onSubmit={(e) => {
        e.preventDefault();
        const f = e.currentTarget.elements as unknown as Record<string, HTMLInputElement>;
        void c.act.saveOpp(x ? x.id : '', { name: f.name.value, status: f.status.value, ask_amount: f.ask.value, expected_amount: f.expected.value, expected_date: f.expected_date.value, deadline: f.deadline.value });
      }}
    >
      <div className="pp-compose__row">
        <input type="text" name="name" defaultValue={v.name} placeholder="Opportunity name" required />
        <select name="status" defaultValue={v.status}>
          {st.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="pp-compose__row">
        <input type="text" name="ask" inputMode="decimal" defaultValue={v.ask || ''} placeholder="Ask $" />
        <input type="text" name="expected" inputMode="decimal" defaultValue={v.expected || ''} placeholder="Expected $" />
      </div>
      <div className="pp-compose__row">
        <label className="pp-lab">
          Expected by
          <input type="date" name="expected_date" defaultValue={v.expectedDate || ''} />
        </label>
        <label className="pp-lab">
          Deadline
          <input type="date" name="deadline" defaultValue={v.deadline || ''} />
        </label>
      </div>
      <div className="pp-compose__foot">
        <span />
        <span>
          <button type="button" className="pp-edit" onClick={() => c.setV({ editing: null })}>
            Cancel
          </button>{' '}
          <button type="submit" className="h-btn h-btn--primary h-btn--sm">
            {x ? 'Save' : 'Add opportunity'}
          </button>
        </span>
      </div>
    </form>
  );
}

export function Opps({ c }: { c: Ctx }) {
  const { p, V } = c;
  return (
    <section className="pp-sec">
      <h3>
        Opportunities{' '}
        <button type="button" onClick={() => c.setV({ editing: 'oppnew' })}>
          New opportunity
        </button>
      </h3>
      {(p.opportunities || []).length ? (
        p.opportunities.map((x) =>
          V.editing === 'opp' + x.id ? (
            <OppForm key={x.id} c={c} x={x} codes={c.codes} />
          ) : (
            <div key={x.id} className={'pp-opp' + (x.id && String(x.id) === c.focusOpp ? ' is-focus' : '')} data-opp={x.id || ''}>
              <div>
                <b>{String(x.name || '').trim() || 'No name'}</b>
                <span className="sub">
                  {[x.ask ? 'Ask ' + money(x.ask) : '', x.expected ? 'Expected ' + money(x.expected) : '', x.funded ? 'Funded ' + money(x.funded) : '', x.deadline || x.expectedDate ? 'By ' + fd(x.deadline || x.expectedDate, true) : ''].filter(Boolean).join(' · ') || x.purpose}
                </span>
              </div>
              <span className={'pp-stage' + (/awarded|application|submitted/i.test(x.status || '') ? ' pp-stage--warm' : '')}>{x.status || 'No status'}</span>
              <button type="button" className="pp-iconbtn" aria-label={'Edit ' + x.name} onClick={() => c.setV({ editing: 'opp' + x.id })}>
                <Ic n="edit" />
              </button>
            </div>
          )
        )
      ) : (
        <p className="pp-empty">None.</p>
      )}
      {V.editing === 'oppnew' ? <OppForm c={c} x={null} codes={c.codes} /> : null}
    </section>
  );
}

/* ------------------------------------------------------------------ contact details fold */
function CopyBtn({ v, what }: { v: string; what: string }) {
  if (!v) return null;
  return (
    <button
      type="button"
      className="pp-copy"
      aria-label={'Copy ' + what}
      onClick={async () => {
        const ok = await copyText(v);
        toast(ok ? 'Copied' : 'Your browser would not copy. Select the text and copy it.', null, !ok);
      }}
    >
      {v}
    </button>
  );
}

function recurringList(list: any[]): ReactNode {
  const FREQ: Record<string, string> = { WEEKLY: 'weekly', MONTHLY: 'monthly', QUARTERLY: 'quarterly', ANNUALLY: 'yearly' };
  const by = new Map<string, { n: number; node: ReactNode }>();
  for (const r of list) {
    const freq = FREQ[String(r.frequency || '').toUpperCase()] || '';
    const open = (r.declines || []).filter((d: any) => !d.recovered);
    const missed: ReactNode[] = [];
    if (open.length) missed.push(<span key="d" className="pp-missed">{open.length > 1 ? open.length + ' declined charges, last ' : 'Declined '}{fd(open[0].date)}{open[0].reason ? ': ' + open[0].reason : ''}</span>);
    if (r.pastDue) missed.push(<span key="p" className="pp-missed">Next charge {lateText(r.daysLate)}</span>);
    const text = `${money(r.amount)}${freq ? ' ' + freq : ''}${r.method ? ' by ' + String(r.method).toLowerCase() : ''} ${r.status}${r.fund ? ' · ' + r.fund : ''}${r.since ? ' · started ' + fd(r.since) : ''}${r.lastPayment ? ' · last paid ' + fd(r.lastPayment) : ''}${r.nextCharge && r.status === 'Active' && !r.pastDue ? ' · next ' + fd(r.nextCharge) : ''}${r.endDate && r.status === 'Active' ? ' · ends ' + fd(r.endDate) : ''}`;
    const key = text + '|' + missed.map((m: any) => m.key).join('') + open.length + (r.daysLate || '');
    const hit = by.get(key);
    if (hit) hit.n++;
    else by.set(key, { n: 1, node: <>{text}{missed.length ? <><br />{missed.map((m, i) => <Fragment key={i}>{i ? ' ' : ''}{m}</Fragment>)}</> : null}</> });
  }
  const lines = [...by.values()].map((l, i) => <Fragment key={i}>{l.node}{l.n > 1 ? <> <small>({l.n} on this date)</small></> : null}</Fragment>);
  const join = (a: ReactNode[]) => a.map((x, i) => <Fragment key={i}>{i ? <br /> : null}{x}</Fragment>);
  return lines.length > 4 ? (
    <>
      {join(lines.slice(0, 4))}
      <details className="pp-more">
        <summary>{lines.length - 4} more</summary>
        {join(lines.slice(4))}
      </details>
    </>
  ) : (
    join(lines)
  );
}

export function Details({ c, open }: { c: Ctx; open?: boolean }) {
  const { p } = c;
  const ct = p.contact;
  const edit = (i: boolean) => (i && p.canEdit !== false ? <button type="button" className="pp-edit" onClick={() => c.act.setTab('contact')}>Edit</button> : <span />);
  const row = (dt: ReactNode, dd: ReactNode, btn?: ReactNode, k?: string) => (
    <Fragment key={k}>
      <dt>{dt}</dt>
      <dd>{dd}</dd>
      {btn ?? <span />}
    </Fragment>
  );
  const a = ct.address;
  return (
    <details className="pp-fold" open={open || undefined}>
      <summary>Contact details, codes and assignments</summary>
      <dl className="pp-dl">
        {(ct.phones || []).map((x, i) =>
          row(x.type || 'Phone', <><CopyBtn v={x.number} what="phone number" />{x.primary ? <small>Primary</small> : null}{x.doNotCall ? <small className="is-bad">Do not call</small> : null}</>, edit(!!x.id), 'ph' + i)
        )}
        {(ct.emails || []).map((x, i) =>
          row('Email', <><CopyBtn v={x.address} what="email address" />{x.primary ? <small>Primary</small> : null}{x.doNotEmail ? <small className="is-bad">Do not email</small> : null}</>, edit(!!x.id), 'em' + i)
        )}
        {a
          ? row('Address', <><CopyBtn v={[a.lines, a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')} what="address" />{a.doNotMail ? <small className="is-bad">Do not mail</small> : null}{ct.otherAddresses ? <small>{ct.otherAddresses} more on file</small> : null}</>, edit(!!a.id), 'ad')
          : row('Address', 'None on file', undefined, 'ad')}
        {row('Codes', (p.codes || []).join(' · ') || 'None', undefined, 'co')}
        {row('Assignments', (p.assignments || []).length ? (p.assignments || []).map((x, i) => <Fragment key={i}>{i ? <br /> : null}{x.name}{x.type ? ' (' + x.type + ')' : ''}{x.current ? '' : ' until ' + fd(x.to, true)}</Fragment>) : 'None', undefined, 'as')}
        {(p.recurring || []).length ? row('Recurring', recurringList(p.recurring), undefined, 'rc') : null}
        {row('Added', fd(p.addedOn, true), undefined, 'ad2')}
      </dl>
      <p className="pp-links">
        <a className="h-btn h-btn--ghost h-btn--sm" href={`https://host.nxt.blackbaud.com/constituent/records/${p.id}?envid=p-5_k5FlbubEyEQnUJw7C9Rw`} target="_blank" rel="noopener">
          <Ic n="ext" />
          Open in Blackbaud
        </a>
      </p>
    </details>
  );
}

