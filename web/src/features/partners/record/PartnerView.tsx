// One partner, one view everywhere (port of public/js/partner.js): the slide-over drawer (mode 'drawer'), the full page (mode 'full') and
// the compact copy beside the Work Center's edit panel (mode 'compact'). Reads /api/work/partners/:id (the D1 copy of Blackbaud) and the
// partner's notes. Writes go through /api/work/batches like the Work Center: saved, sent to Blackbaud, checked, and undone from the toast.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Boundary } from './Boundary';
import { Comm } from './Comm';
import { Composer } from './Composer';
import { CRM_TABS, CrmTab } from './Crm';
import { codesQuery, freshNotes, mailQuery, notesQuery, partnerQuery, prKeys, storyQuery, timelineQuery } from './queries';
import { RecordsTab } from './Records';
import { StoryCard, briefEvents } from './Story';
import { Acts, Chart, Details, Due, Giving, Head, InstrBox, NotesSection, OweCards, Opps, Timeline, tasksOf } from './Sections';
import { Ic } from './Ic';
import { CAT_IC, ApiFail, useMounted, fd, holderOf, href, instructionOf, plain, rPost, todayEt, type Note, type Partner, giftHow } from './lib';
import { emptyLocal, initialView, type Ctx, type Ev, type LocalState, type Mode, type SaveForm, type ViewState } from './types';
import { toast } from './toast';
import { runBatch } from './writes';
import { openPrep, openCall } from '../tools/store';
import { ThankPop, type ThankGift } from '../tools/thank';
import { setEscGuard } from './drawerStore';
import { loadScript } from '@/lib/legacy';

const RECENT_KEY = 'favor.hub.recent.v1';
/** Recent partners: the last eight opened in this browser (localStorage, never sent anywhere), and on every device in All partners. */
function remember(p: Partner) {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    const rest = (Array.isArray(raw) ? raw : []).filter((x: any) => x && x.cid && String(x.cid) !== String(p.id));
    localStorage.setItem(RECENT_KEY, JSON.stringify([{ cid: String(p.id), name: p.name, place: p.place || '', lookup: p.lookup || '', deceased: !!p.deceased }, ...rest].slice(0, 8)));
  } catch {
    // private mode: the list stays empty
  }
  rPost('/api/partners/recent/' + encodeURIComponent(p.id)).catch(() => {});
}

const Skeleton = () => (
  <div className="pp-skel">
    <i style={{ height: 16, width: '34%' }} />
    <i style={{ height: 40, width: '68%' }} />
    <i style={{ height: 14, width: '44%' }} />
    <i style={{ height: 38 }} />
    <i style={{ height: 76 }} />
    <i style={{ height: 160 }} />
  </div>
);

export interface PartnerViewProps {
  id: string;
  mode: Mode;
  as?: string;
  focusGift?: string;
  focusOpp?: string;
  /** The tab and form to open on arrival (the drawer opened from Call prep's Add a note). */
  compose?: string | null;
  /** Called with the partner once it is read. */
  onLoaded?: (p: Partner) => void;
}

/** The partner view with its own loading skeleton and error message. */
export function PartnerView(props: PartnerViewProps) {
  const qc = useQueryClient();
  return (
    <Boundary
      key={props.id}
      fallback={(e, retry) => (
        <div className="pp-err">
          <h2>{(e as ApiFail).status === 404 ? 'No partner found' : 'The partner did not load'}</h2>
          <p>{e.message}</p>
          <p style={{ marginTop: 12 }}>
            <button
              type="button"
              className="h-btn h-btn--ghost h-btn--sm"
              onClick={() => {
                qc.resetQueries({ predicate: (q) => q.state.status === 'error' });
                retry();
              }}
            >
              Try again
            </button>
          </p>
        </div>
      )}
    >
      <Suspense fallback={<Skeleton />}>
        <Inner {...props} />
      </Suspense>
    </Boundary>
  );
}

function Inner({ id, mode, as = '', focusGift = '', focusOpp = '', compose = null, onLoaded }: PartnerViewProps) {
  const qc = useQueryClient();
  const { data: p } = useSuspenseQuery(partnerQuery(id, as));
  const mounted = useMounted();
  const full = mode !== 'compact';
  // These reads arrive after the partner; they wait for the first browser render so it matches the server's HTML.
  const notesQ = useQuery({ ...notesQuery(id, as), enabled: mounted });
  const storyQ = useQuery({ ...storyQuery(id), enabled: full && mounted });
  const tlQ = useQuery({ ...timelineQuery(id), enabled: full && mounted });
  const mailQ = useQuery({ ...mailQuery(id), enabled: full && mounted });
  const codesQ = useQuery({ ...codesQuery, enabled: mounted });
  const seen = <T,>(d: T | undefined): T | undefined => (mounted ? d : undefined);
  const [V, setVs] = useState<ViewState>(() => ({ ...initialView(), compose }));
  const [L, setL] = useState<LocalState>(emptyLocal);
  const [visited, setVisited] = useState<string[]>([]);
  const [thank, setThank] = useState<{ el: HTMLElement; g: ThankGift } | null>(null);
  const [ix, setIx] = useState(false);
  const setV = useCallback((patch: Partial<ViewState>) => setVs((v) => ({ ...v, ...patch })), []);
  const patchL = useCallback((fn: (l: LocalState) => LocalState) => setL((l) => fn(l)), []);
  const pRef = useRef(p);
  pRef.current = p;
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onLoaded?.(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id]);
  useEffect(() => {
    remember(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id]);
  // Find a time and Send a clip come from the integrations script.
  useEffect(() => {
    if (!full) return;
    let live = true;
    const w = window as unknown as { FavorIx?: unknown };
    if (w.FavorIx) {
      setIx(true);
      return;
    }
    loadScript('/js/integrations.js?v=2')
      .then(() => live && setIx(!!w.FavorIx))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [full]);
  // /work/partner/<id>?gift=<gift id> or ?opp=<id> opens on that line.
  useEffect(() => {
    if (!focusGift && !focusOpp) return;
    const t = setTimeout(() => {
      const el = root.current?.querySelector(focusOpp ? `.pp-opp[data-opp="${CSS.escape(focusOpp)}"]` : `.pp-ev[data-gift="${CSS.escape(focusGift)}"]`);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 400);
    return () => clearTimeout(t);
  }, [focusGift, focusOpp, tlQ.data]);

  // The partner's copy follows what a record tab read live.
  const merge = useCallback(
    (part: Record<string, any>) => {
      qc.setQueryData(partnerQuery(id, as).queryKey, (old: Partner | undefined) => {
        if (!old) return old;
        const q: Partner = { ...old, contact: { ...old.contact } };
        if (part.phones) q.contact.phones = part.phones.filter((x: any) => !x.inactive).map((x: any) => ({ id: x.id, number: x.number, type: x.type, primary: x.primary, doNotCall: x.doNotCall }));
        if (part.emails) q.contact.emails = part.emails.filter((x: any) => !x.inactive).map((x: any) => ({ id: x.id, address: x.address, primary: x.primary, doNotEmail: x.doNotEmail }));
        if (part.addresses) {
          const live = part.addresses.filter((x: any) => !x.inactive);
          const pick = live.find((x: any) => x.preferred) || live[0];
          q.contact.address = pick ? { id: pick.id, lines: pick.lines, city: pick.city, state: pick.state, zip: pick.zip, country: pick.country, doNotMail: pick.doNotMail } : null;
          q.contact.otherAddresses = Math.max(0, live.length - (pick ? 1 : 0));
          if (pick) q.place = [pick.city, pick.state].filter(Boolean).join(', ') || q.place;
        }
        if (part.flags) {
          q.deceased = !!part.flags.deceased;
          q.inactive = !!part.flags.inactive;
        }
        if (part.codes) q.codes = part.codes.filter((x: any) => !x.inactive).map((x: any) => x.code);
        return q;
      });
    },
    [qc, id, as]
  );

  const refresh = useCallback(
    async (fresh?: boolean) => {
      try {
        await qc.invalidateQueries({ queryKey: partnerQuery(id, as).queryKey });
      } catch {
        // keep what is shown
      }
      if (fresh) {
        try {
          qc.setQueryData(notesQuery(id, as).queryKey, await freshNotes(id));
        } catch {
          // the notes stay as they were
        }
      }
    },
    [qc, id, as]
  );

  // A thank-you saved here, the Gifts to thank tab or the brief clears the card here too, and an undo brings it back.
  useEffect(() => {
    const thanked = (e: Event) => {
      const dt = (e as CustomEvent).detail || {};
      let hit = false;
      const keys: string[] = [];
      for (const i of dt.items || []) if (String(i.cid) === pRef.current.id) {
        keys.push(`${i.giftId}:${i.cid}`);
        hit = true;
      }
      if (hit) setL((l) => ({ ...l, thanked: new Set([...l.thanked, ...keys]), thankedNow: !dt.left ? 'you' : l.thankedNow }));
    };
    const undone = () => {
      setL(emptyLocal());
      void refresh(true);
      void qc.invalidateQueries({ queryKey: ['pr', 'crm', id] });
      void qc.invalidateQueries({ queryKey: ['pr', 'rec', id] });
      void qc.invalidateQueries({ queryKey: prKeys.extras(id) });
      void qc.invalidateQueries({ queryKey: prKeys.comm(id) });
    };
    const failed = () => {
      setL((l) => ({ ...l, thanked: new Set(), thankedNow: '' }));
      void refresh(true);
    };
    document.addEventListener('favor:thanked', thanked);
    document.addEventListener('favor:undone', undone);
    document.addEventListener('favor:thanked-failed', failed);
    return () => {
      document.removeEventListener('favor:thanked', thanked);
      document.removeEventListener('favor:undone', undone);
      document.removeEventListener('favor:thanked-failed', failed);
    };
  }, [id, qc, refresh]);

  // Notes: the ones saved here and not yet read back come first.
  const notesData = seen(notesQ.data);
  const notes: Note[] | null = notesData ? (L.notes.length ? [...L.notes, ...notesData] : notesData) : L.notes.length ? L.notes : null;

  // The timeline: the answer plus this person's email, newest first; saved-here lines join it.
  const tl = useMemo(() => {
    const t = seen(tlQ.data);
    if (!t) return null;
    const mail = seen(mailQ.data) || [];
    return mail.length ? { ...t, events: (t.events || []).concat(mail).sort((a: any, b: any) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)) } : t;
  }, [tlQ.data, mailQ.data, mounted]);
  const events = useMemo<Ev[]>(() => {
    if (tl) {
      const all = briefEvents(tl);
      for (const e of L.events) if (!all.some((x) => x.t === e.t && x.what === e.what && x.d === e.d)) all.push(e);
      return all.filter((e) => e.d).sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
    }
    const ev: Ev[] = [];
    for (const g of p.giving.recent || []) ev.push({ t: 'gift', gid: g.id, d: g.date, a: g.amount, what: g.fund || 'No fund on file', how: giftHow(g) });
    // Older pages sent soft credits apart; the list above now holds them, so only add ones it lacks.
    for (const g of (p.giving.soft && p.giving.soft.recent) || []) if (!(p.giving.recent || []).some((x: any) => x.id === g.id)) ev.push({ t: 'gift', gid: g.id, d: g.date, a: g.amount, what: g.fund || 'No fund on file', how: giftHow(g) });
    for (const a of p.actions.recent || []) ev.push({ t: 'act', id: a.id, d: (a.done || a.due) as string, icon: CAT_IC[a.category || ''] || 'task', what: a.summary || plain(a.type), text: a.description, by: (a.fundraisers || []).map((f) => f.name).join(', ') + (a.outcome ? ' · ' + a.outcome : '') });
    for (const e of L.events) if (!ev.some((x) => x.t === e.t && x.what === e.what && x.d === e.d)) ev.push(e);
    return ev.filter((e) => e.d).sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
  }, [tl, L.events, p]);

  /* -------------------------------------------------------------- actions */
  const act = useMemo<Ctx['act']>(
    () => ({
      compose: (kind) => setVs((v) => ({ ...v, prefill: null, compose: kind, editing: null })),
      closeCompose: () => setVs((v) => ({ ...v, compose: null, prefill: null })),
      setTab: (tab) => {
        setVs((v) => (v.tab === tab ? v : { ...v, tab, compose: null }));
        setVisited((a) => (a.includes(tab) ? a : [...a, tab]));
      },
      reload: () => void refresh(true),
      thank: (el, g) => {
        const cur = pRef.current;
        const ph = (cur.contact.phones || []).find((x) => !x.doNotCall);
        setThank({ el, g: { giftId: g.giftId, cid: g.cid, name: cur.name, amount: g.amount, date: g.date, fund: g.fund, phone: ph ? ph.number : null, left: g.left, tasks: (g.taskIds || []).length } });
      },
      taskOpen: (tid) => {
        // On the Work Center the action opens in its edit panel; elsewhere the Work Center opens on it.
        window.location.href = '/work/?action=' + encodeURIComponent(tid);
      },
      logit: (src) => {
        const ev = events.find((x) => x.src === src);
        if (!ev || !ev.log) return;
        setVs((v) => ({ ...v, prefill: { ...ev.log, source: ev.src, from: ev.what }, compose: 'contact', editing: null }));
      },
      done: async (tid) => {
        const cur = pRef.current;
        const task = (cur.actions.open || []).find((a) => a.id === tid);
        setL((l) => ({ ...l, done: new Set([...l.done, tid]) }));
        const ok = await runBatch({ op: 'edit', ids: [tid], set: { status: 'Completed' }, seen: { status: 'Open' } }, 'Marked complete', () => {
          setL((l) => ({ ...l, events: [...l.events, { t: 'act', d: todayEt(), icon: CAT_IC[task?.category || ''] || 'task', what: task ? task.summary || (task.type as string) : 'Completed', by: 'Completed just now', fresh: 1 }] }));
        });
        if (!ok) setL((l) => ({ ...l, done: new Set([...l.done].filter((x) => x !== tid)) }));
      },
      move: async (tid, date) => {
        const cur = pRef.current;
        const task = (cur.actions.open || []).find((a) => a.id === tid);
        let was: string | undefined;
        setL((l) => {
          was = l.moved[tid];
          return { ...l, moved: { ...l.moved, [tid]: date } };
        });
        const ok = await runBatch({ op: 'edit', ids: [tid], set: { date }, seen: { date: task ? task.due : undefined } }, 'Moved to ' + fd(date));
        if (!ok)
          setL((l) => {
            const m = { ...l.moved };
            if (was) m[tid] = was;
            else delete m[tid];
            return { ...l, moved: m };
          });
      },
      save: async (kind, f) => {
        const cur = pRef.current;
        const today = todayEt();
        if (kind === 'note') {
          const topic = f.topic || 'General';
          const instruction = !!f.instruction;
          const text = f.text || '';
          const lead = instruction ? 'Instruction: ' : topic !== 'General' ? topic + ': ' : '';
          const local: Note = { id: 'local' + Date.now(), type: 'Note (general)', summary: lead + f.what, text, date: today, author: 'You', local: true };
          setL((l) => ({ ...l, notes: [local, ...l.notes] }));
          setVs((v) => ({ ...v, compose: null }));
          const ok = await runBatch({ op: 'pnote', cid: cur.id, note: { topic, instruction, summary: f.what, text } }, instruction ? 'Instruction added' : 'Note added', async () => {
            try {
              qc.setQueryData(notesQuery(id, as).queryKey, await freshNotes(cur.id));
              setL((l) => ({ ...l, notes: l.notes.filter((n) => n.id !== local.id) }));
            } catch {
              setL((l) => ({ ...l, notes: l.notes.map((n) => (n.id === local.id ? { ...n, local: false } : n)) }));
            }
          });
          if (!ok) setL((l) => ({ ...l, notes: l.notes.filter((n) => n.id !== local.id) }));
          return;
        }
        const cat = f.kind || 'Phone call';
        const when = f.when || today;
        const C: any = codesQ.data || (await qc.fetchQuery(codesQuery));
        const holders = holderOf(cur);
        const fr = holders[0] ? [holders[0].fid] : C.me && C.me.fid ? [C.me.fid] : [];
        const type = (fr[0] && C.types && C.types[fr[0]]) || (C.me && C.me.type) || 'RDD Action';
        const tags = (f.tags || []).map((x) => ({ category: x }));
        const set: Record<string, unknown> = { category: cat, type, date: when, summary: f.what, fundraisers: fr, completed: kind === 'contact', status: kind === 'contact' ? 'Completed' : 'Open' };
        if (['Phone call', 'Email', 'Mailing'].includes(cat)) set.direction = 'Outbound';
        const what = f.what;
        const fromLine = kind === 'contact' && V.prefill ? V.prefill.source : '';
        if (kind === 'contact') setL((l) => ({ ...l, events: [...l.events, { t: 'act', d: when, icon: CAT_IC[cat], what, by: 'Saving', fresh: 1 }] }));
        else setL((l) => ({ ...l, tasks: [...l.tasks, { id: 'local' + Date.now(), what, kind: cat, by: holders[0] ? holders[0].name : '', due: when, local: true }] }));
        setVs((v) => ({ ...v, compose: null, prefill: null }));
        const ok = await runBatch({ op: 'new', cids: [cur.id], set, tags: tags.length ? { add: tags } : undefined }, kind === 'contact' ? 'Contact logged' : 'Task added', () => {
          // The timeline line this contact came from shows as added from now on.
          if (fromLine) {
            fetch('/api/today/mention-logged', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' }, body: JSON.stringify({ cid: cur.id, source: fromLine }) }).catch(() => {});
            setL((l) => ({ ...l, logged: new Set([...l.logged, fromLine]) }));
          }
          setL((l) => ({
            ...l,
            events: l.events.map((ev) => (ev.what === what && ev.by === 'Saving' ? { ...ev, by: 'Saved just now' } : ev)),
            tasks: l.tasks.map((t) => (t.what === what ? { ...t, by: (t.by ? t.by + ' · ' : '') + 'saved' } : t)),
          }));
          // Blackbaud's copy reads the new action in within a minute; the list then comes from it.
          setTimeout(() => {
            setL((l) => ({ ...l, tasks: l.tasks.filter((t) => t.what !== what) }));
            void refresh(true);
          }, 45000);
        });
        if (!ok) setL((l) => ({ ...l, events: l.events.filter((x) => x.what !== what), tasks: l.tasks.filter((x) => x.what !== what) }));
      },
      saveOpp: async (oid, opp) => {
        const cur = pRef.current;
        const num = (s: string) => Number(String(s).replace(/[$,]/g, '')) || 0;
        qc.setQueryData(partnerQuery(id, as).queryKey, (old: Partner | undefined) => {
          if (!old) return old;
          if (oid) return { ...old, opportunities: old.opportunities.map((x) => (x.id === oid ? { ...x, name: opp.name, status: opp.status, ask: num(opp.ask_amount), expected: num(opp.expected_amount), expectedDate: opp.expected_date, deadline: opp.deadline } : x)) };
          return { ...old, opportunities: [{ id: 'new', name: opp.name, status: opp.status, ask: num(opp.ask_amount), expected: 0, funded: 0, purpose: '', deadline: opp.deadline, expectedDate: opp.expected_date }, ...old.opportunities] };
        });
        setVs((v) => ({ ...v, editing: null }));
        const ok = await runBatch(oid ? { op: 'opp_edit', opp_id: oid, opp } : { op: 'opp_new', cid: cur.id, opp }, oid ? 'Opportunity saved' : 'Opportunity added', () => {
          void qc.invalidateQueries({ queryKey: partnerQuery(id, as).queryKey });
        });
        if (!ok) void refresh(true);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, id, as, events, codesQ.data, V.prefill, refresh]
  );

  // Esc closes an open form before the drawer.
  const escRef = useRef(V);
  escRef.current = V;
  useEffect(() => {
    if (mode !== 'drawer') return;
    setEscGuard(() => {
      if (escRef.current.compose || escRef.current.editing) {
        setVs((v) => ({ ...v, compose: null, editing: null }));
        return true;
      }
      return false;
    });
    return () => setEscGuard(null);
  }, [mode]);
  // The form asked for by the opener (Call prep's Add a note, a Hand off) shows once the partner is read.
  useEffect(() => {
    if (compose) setVs((v) => ({ ...v, compose }));
  }, [compose, id]);

  const instr = instructionOf(notes);
  const tasks = tasksOf(p, { L });
  const ctx: Ctx = {
    id, mode, p, as, notes, story: seen(storyQ.data) ?? null, storyLoading: full && (!mounted || storyQ.isPending), tl, codes: seen(codesQ.data), V, setV, L, events, focusGift, focusOpp, ix, act,
  };
  const ro = p.canEdit === false ? ' pp-ro' : '';
  const holderStory = (
    <StoryCard
      story={seen(storyQ.data)}
      loading={full && (!mounted || storyQ.isPending)}
      p={p}
      onCallMode={() => openCall(p.id)}
      onLog={() => act.compose('contact')}
    />
  );
  const composer = (
    <div className="pp-composer">
      {V.compose ? <Composer key={V.compose + ':' + (V.prefill?.source || '')} kind={V.compose} p={p} prefill={V.prefill} codes={codesQ.data} onClose={act.closeCompose} onSave={(f: SaveForm) => void act.save(V.compose as string, f)} /> : null}
    </div>
  );
  const tabs = (
    <nav className="pp-tabs" role="tablist" aria-label="Partner sections">
      {[['overview', 'Overview'], ...CRM_TABS, ['contact', 'Contact'], ['codes', 'Codes'], ['record', 'Record']].map(([k, l]) => (
        <button key={k} type="button" role="tab" className={V.tab === k ? 'is-on' : ''} aria-selected={V.tab === k} onClick={() => act.setTab(k)}>
          {l}
        </button>
      ))}
    </nav>
  );
  const thankPop = thank ? <ThankPop anchor={thank.el} g={thank.g} onClose={() => setThank(null)} /> : null;

  if (mode === 'compact') {
    return (
      <div className={'pp pp--compact' + ro} ref={root}>
        <Head c={ctx} />
        <OweCards c={ctx} />
        <Giving p={p} />
        <Comm id={p.id} canFlag={p.canEdit !== false} />
        <Due c={ctx} tasks={tasks} />
        <Timeline c={ctx} />
        <p className="pp-compactfoot">
          <a className="h-btn h-btn--ghost h-btn--sm" href={href(p.id)}>
            <Ic n="expand" />
            Full partner page
          </a>
        </p>
        {thankPop}
      </div>
    );
  }
  const top = (
    <>
      <Head c={ctx} />
      <InstrBox instr={instr} />
      <Acts c={ctx} onPrep={() => openPrep(p.id)} onCallMode={() => openCall(p.id)} />
      {tabs}
    </>
  );
  if (V.tab !== 'overview') {
    const panes = visited.length ? visited : [V.tab];
    return (
      <div className={'pp' + ro} ref={root}>
        {top}
        {(panes.includes(V.tab) ? panes : [...panes, V.tab]).map((t) => (
          <div key={t} hidden={t !== V.tab} className={CRM_TABS.some((x) => x[0] === t) ? 'pc-pane' : 'rc-pane'}>
            {CRM_TABS.some((x) => x[0] === t) ? <CrmTab id={p.id} tab={t} household={p.household} /> : <RecordsTab id={p.id} tab={t as 'contact' | 'codes' | 'record'} partner={p} merge={merge} />}
          </div>
        ))}
        <div className="pp-pad" />
        {thankPop}
      </div>
    );
  }
  if (mode === 'full') {
    return (
      <div className={'pp pp--cols' + ro} ref={root}>
        {top}
        <OweCards c={ctx} />
        {composer}
        {holderStory}
        <Giving p={p} />
        <div className="pp-cols">
          <div className="pp-colmain">
            <Comm id={p.id} canFlag={p.canEdit !== false} />
            <Due c={ctx} tasks={tasks} />
            <Timeline c={ctx} />
            <NotesSection c={ctx} list={notes} />
          </div>
          <aside className="pp-colside">
            <Chart p={p} />
            <Opps c={ctx} />
            <Details c={ctx} open />
          </aside>
        </div>
        <div className="pp-pad" />
        {thankPop}
      </div>
    );
  }
  return (
    <div className={'pp' + ro} ref={root}>
      {top}
      <OweCards c={ctx} />
      {composer}
      {holderStory}
      <Giving p={p} />
      <Comm id={p.id} canFlag={p.canEdit !== false} />
      <Due c={ctx} tasks={tasks} />
      <NotesSection c={ctx} list={notes} />
      <Timeline c={ctx} />
      <Chart p={p} />
      <Opps c={ctx} />
      <Details c={ctx} />
      <div className="pp-pad" />
      {thankPop}
    </div>
  );
}

