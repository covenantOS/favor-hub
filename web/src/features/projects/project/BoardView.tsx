// The Board view: columns by section or by status, cards you drag between them, an add field at the foot of each column. Ported from
// public/js/projects/board.js.
import { memo, useEffect, useRef, useState, type FormEvent, type MouseEvent as RMouseEvent } from 'react';
import { STATUS } from '../lib/dates';
import { isTmp, useCtx, type TaskCtx } from '../lib/store';
import type { Task } from '../types';
import { Icon } from '../kit/Icon';
import { dnd } from '../kit/dnd';
import { askText, choose } from '../kit/overlays';
import { pickOwner } from '../kit/pickers';
import { CheckBtn, CodeChips, Counts, DueTag, FromMeeting, hasStateTag, OwnerBtn, PriorityIcon, StateTag, taskSig } from '../kit/rows';

const STATUSES = ['open', 'doing', 'waiting', 'done'];
const PAGE = 40;
const STEP = 80;

interface Col {
  id: string;
  name: string;
  tasks: Task[];
  status?: boolean;
  section?: boolean;
}

const Card = memo(
  function Card({ t }: { t: Task; sig: string }) {
    const done = t.status === 'done';
    const hasCodes = t.appeal_code || t.source_code || t.fund_code || t.campaign_code;
    return (
      <article className={'pj-card' + (done ? ' is-done' : '') + (t.pending ? ' is-pending' : '') + (t.overdue ? ' is-late' : '')} data-id={t.id} tabIndex={-1}>
        <div className="pj-card__top">
          <CheckBtn t={t} />
          <span className="pj-title" data-act="open">
            {t.title}
          </span>
        </div>
        {hasCodes ? (
          <div className="pj-card__chips">
            <CodeChips t={t} max={4} />
          </div>
        ) : null}
        {hasStateTag(t) ? (
          <div className="pj-card__tags">
            <StateTag t={t} />
          </div>
        ) : null}
        {t.meeting ? (
          <div className="pj-card__tags">
            <FromMeeting t={t} />
          </div>
        ) : null}
        <div className="pj-card__foot">
          {t.code ? <span className="pj-code-id">{t.code}</span> : null}
          <span className="pj-card__counts">
            <Counts t={t} />
          </span>
          <span className="pj-sp" />
          <PriorityIcon t={t} />
          <DueTag t={t} />
          <OwnerBtn t={t} />
        </div>
      </article>
    );
  },
  (a, b) => a.sig === b.sig
);

export function BoardView({ ctx, projectKey, onOpen }: { ctx: TaskCtx; projectKey?: string; onOpen: (t: Task) => void }) {
  useCtx(ctx);
  const rootRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<Record<string, number>>({});
  const mode = ctx.boardBy === 'status' ? 'status' : 'section';
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const colKey = (id: string) => mode + ':' + id;
  const limitOf = (id: string) => shown[colKey(id)] || PAGE;

  const columns = (): Col[] => {
    if (mode === 'status') {
      const m = new Map<string, Task[]>(STATUSES.map((s) => [s, []]));
      for (const t of ctx.tasks) {
        if (!ctx.matches(t)) continue;
        (m.get(t.status === 'dropped' ? 'done' : t.status) || m.get('open')!).push(t);
      }
      for (const a of m.values()) a.sort((x, y) => x.sort - y.sort);
      return STATUSES.map((s) => ({ id: s, name: STATUS[s], tasks: m.get(s)!, status: true }));
    }
    const m = ctx.grouped();
    const cols: Col[] = ctx.sections.map((s) => ({ id: s.id, name: s.name, tasks: m.get(s.id) || [], section: true }));
    const none = m.get('') || [];
    if (none.length || !ctx.sections.length) cols.push({ id: '', name: ctx.sections.length ? 'No section' : 'Tasks', tasks: none });
    return cols;
  };

  const onClick = async (e: RMouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const act = target.closest('[data-act]') as HTMLElement | null;
    const a = act ? act.dataset.act : '';
    if (a === 'retry') {
      void ctx.load(projectKey);
      return;
    }
    if (a === 'more') {
      const z = target.closest('.pj-col') as HTMLElement;
      const id = z.dataset.zone as string;
      setShown((s) => ({ ...s, [colKey(id)]: limitOf(id) + STEP }));
      return;
    }
    if (a === 'addsec') {
      const s = await ctx.addSection('New section');
      if (s) requestAnimationFrame(() => rootRef.current && (rootRef.current.scrollLeft = rootRef.current.scrollWidth));
      return;
    }
    if (a === 'secmenu') {
      const z = target.closest('.pj-col') as HTMLElement;
      const sid = z.dataset.zone as string;
      const i = ctx.sections.findIndex((s) => s.id === sid);
      const items = [{ value: 'rename', label: 'Rename', icon: 'list' }] as { value: string; label: string; icon: string; hint?: string }[];
      if (i > 0) items.push({ value: 'up', label: 'Move left', icon: 'back' });
      if (i < ctx.sections.length - 1) items.push({ value: 'down', label: 'Move right', icon: 'right' });
      items.push({ value: 'del', label: 'Delete section', hint: 'Its tasks stay, with no section', icon: 'trash' });
      const v = await choose<string>({ anchor: act, title: 'Section', items });
      if (v === 'rename') {
        const name = await askText({ title: 'Rename section', value: ctx.sections[i].name, label: 'Name' });
        if (name) void ctx.renameSection(sid, name);
      } else if (v === 'up') void ctx.moveSection(sid, -1);
      else if (v === 'down') void ctx.moveSection(sid, 1);
      else if (v === 'del') void ctx.deleteSection(sid);
      return;
    }
    const card = target.closest('.pj-card') as HTMLElement | null;
    if (!card) return;
    const t = ctx.by.get(card.dataset.id as string);
    if (!t) return;
    if (a === 'done') {
      void ctx.patch(t.id, { done: t.status !== 'done' });
      return;
    }
    if (a === 'owner') {
      const r = await pickOwner({ title: 'Assign to', current: t.owner_email });
      if (r) void ctx.patch(t.id, { owner_email: r.email });
      return;
    }
    if (isTmp(t.id)) return;
    onOpen(t);
  };

  const onSubmit = (e: FormEvent<HTMLDivElement>) => {
    const f = (e.target as HTMLElement).closest('.pj-add') as HTMLFormElement | null;
    if (!f) return;
    e.preventDefault();
    const inp = f.querySelector('input') as HTMLInputElement;
    const title = inp.value.trim();
    if (!title) return;
    inp.value = '';
    const gid = f.dataset.gid || '';
    setShown((s) => ({ ...s, [colKey(gid)]: Infinity }));
    const body: Record<string, unknown> = { title };
    if (mode === 'status') body.section_id = null;
    else body.section_id = gid || null;
    const ow = ctx.filter.owner;
    if (ow && ow !== 'none') body.owner_email = ow === 'me' ? ctx.me : ow;
    const p = ctx.create(body);
    if (mode === 'status' && gid !== 'open') void p.then((t) => { if (t && t.id) void ctx.patch(t.id, { status: gid }, { quiet: true }); });
    inp.focus({ preventScroll: true });
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return dnd(root, {
      item: '.pj-card',
      zone: '.pj-col:not(.pj-col--new)',
      body: '[data-cards]',
      scrollX: '.pj-board',
      canStart: (item) => !isTmp(item.dataset.id),
      onDrop: async (d) => {
        const t = ctx.by.get(d.id);
        if (!t) return;
        if (modeRef.current === 'status') {
          if (d.zone === t.status) return;
          if (d.zone === 'done') {
            void ctx.patch(t.id, { done: true });
            return;
          }
          if (t.status === 'done') {
            const ok = await ctx.patch(t.id, { done: false });
            if (!ok) return;
            if (d.zone === 'open') return;
          }
          void ctx.patch(t.id, { status: d.zone });
          return;
        }
        void ctx.move(d.id, { section_id: d.zone || null, before: d.beforeId || undefined, after: d.afterId || undefined });
      },
    });
  }, [ctx]);

  if (ctx.loading) {
    return (
      <div className="pj-board" role="group" aria-label="Board" ref={rootRef}>
        <div className="pj-skel pj-skel--board" aria-busy="true">
          <i />
          <i />
          <i />
        </div>
      </div>
    );
  }
  if (ctx.error) {
    return (
      <div className="pj-board" role="group" aria-label="Board" ref={rootRef} onClick={onClick}>
        <div className="pj-empty pj-empty--err">
          <p>{ctx.error}</p>
          <button type="button" className="pj-btn" data-act="retry">
            Try again
          </button>
        </div>
      </div>
    );
  }
  const cols = columns();
  return (
    <div className="pj-board" role="group" aria-label="Board" ref={rootRef} onClick={onClick} onSubmit={onSubmit} onKeyDown={(e) => {
      const i = (e.target as HTMLElement).closest?.('.pj-add__in') as HTMLInputElement | null;
      if (i && e.key === 'Escape') {
        e.stopPropagation();
        i.value = '';
        i.blur();
      }
    }}>
      {cols.map((c) => {
        const sc = mode === 'section' && ctx.counts && !ctx.showDone && !ctx.filter.q ? (ctx.counts.by_section[c.id || ''] || {}).done : 0;
        const lim = limitOf(c.id);
        const left = Math.max(0, c.tasks.length - lim);
        const part = left ? c.tasks.slice(0, lim) : c.tasks;
        return (
          <section key={c.id} className="pj-col" data-zone={c.id} data-status={c.status ? c.id : ''} role="group" aria-label={c.name}>
            <header className="pj-col__h">
              {c.status ? <i className="pj-sdot" data-s={c.id} /> : null}
              <h3>{c.name}</h3>
              <span className="pj-sec__n">{c.tasks.length + (sc ? ' · ' + sc + ' done' : '')}</span>
              <span className="pj-sec__sp" />
              {c.section ? (
                <button type="button" className="pj-sec__more" data-act="secmenu" aria-label={'Section menu for ' + c.name}>
                  <Icon name="more" />
                </button>
              ) : null}
            </header>
            <div className="pj-col__cards" data-cards>
              {part.map((t) => (
                <Card key={t.id} t={t} sig={taskSig(t)} />
              ))}
            </div>
            <button type="button" className="pj-showmore" data-act="more" hidden={!left}>
              {left ? 'Show ' + Math.min(left, STEP) + ' more of ' + left : ''}
            </button>
            {c.status && c.id === 'done' ? null : (
              <form className="pj-add" data-gid={c.id} autoComplete="off">
                <span className="pj-add__plus">
                  <Icon name="plus" />
                </span>
                <input className="pj-add__in" type="text" maxLength={300} placeholder="Add a task" aria-label={'Add a task to ' + c.name} enterKeyHint="done" />
              </form>
            )}
          </section>
        );
      })}
      {mode === 'section' && ctx.project ? (
        <div className="pj-col pj-col--new">
          <button type="button" className="pj-addsec" data-act="addsec">
            <Icon name="plus" />
            Add section
          </button>
        </div>
      ) : null}
    </div>
  );
}
