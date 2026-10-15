// The List view: sections (or due-date groups on My tasks), rows, instant inline add, drag to reorder, multi-select with a bulk bar, and
// the keyboard. It draws from a TaskCtx and changes things only through it. Ported from public/js/projects/list.js.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as RKeyboardEvent, type MouseEvent as RMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { addDays, dueLabel, todayStr } from '../lib/dates';
import { isTmp, useCtx, type TaskCtx } from '../lib/store';
import type { Task } from '../types';
import { Icon } from '../kit/Icon';
import { usePhone } from '../kit/usePhone';
import { dnd } from '../kit/dnd';
import { choose, isPhone, sheetOpen } from '../kit/overlays';
import { drawerOpen } from '../drawer';
import { pickDate, pickOwner, pickPriority, pickSection } from '../kit/pickers';
import { CheckBtn, CodeChips, Counts, DueTag, FromMeeting, OwnerBtn, PriorityIcon, ProjChip, StateTag, taskSig } from '../kit/rows';

const FOLD_KEY = 'favor.hub.projects.folded.v1';
const readFolded = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(FOLD_KEY) || '{}');
  } catch {
    return {};
  }
};
const writeFolded = (m: Record<string, number>) => {
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify(m));
  } catch {
    // private mode
  }
};
const typing = (el: Element | null) => !!el && ((el as HTMLElement).isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

interface Group {
  id: string;
  name: string;
  tasks: Task[];
  drop?: ((t: Task) => Record<string, unknown>) | null;
  tone?: string;
  noAdd?: boolean;
  add?: Record<string, unknown>;
  section?: boolean;
  plain?: boolean;
}

/** Due-date groups for My tasks. */
function dueGroups(ctx: TaskCtx): Group[] {
  const t = todayStr();
  const week = addDays(t, 7);
  const g: Record<string, Task[]> = { overdue: [], today: [], week: [], later: [], none: [], done: [] };
  for (const x of ctx.tasks) {
    if (!ctx.matches(x)) continue;
    if (x.status === 'done') g.done.push(x);
    else if (!x.due_date) g.none.push(x);
    else if (x.due_date < t) g.overdue.push(x);
    else if (x.due_date === t) g.today.push(x);
    else if (x.due_date <= week) g.week.push(x);
    else g.later.push(x);
  }
  const by = (a: Task, b: Task) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.sort - b.sort || a.title.localeCompare(b.title);
  Object.values(g).forEach((a) => a.sort(by));
  const out: Group[] = [
    { id: 'overdue', name: 'Overdue', tasks: g.overdue, drop: null, tone: 'late', noAdd: true },
    { id: 'today', name: 'Today', tasks: g.today, drop: () => ({ due_date: t }), add: { due_date: t } },
    { id: 'week', name: 'Next 7 days', tasks: g.week, drop: () => ({ due_date: addDays(t, 1) }), add: { due_date: addDays(t, 1) } },
    { id: 'later', name: 'Later', tasks: g.later, drop: () => ({ due_date: addDays(t, 14) }), add: { due_date: addDays(t, 14) } },
    { id: 'none', name: 'No date', tasks: g.none, drop: () => ({ due_date: null }), add: {} },
  ];
  if (ctx.showDone) out.push({ id: 'done', name: 'Completed', tasks: g.done, drop: null, noAdd: true });
  return out.filter((x) => x.id !== 'overdue' || x.tasks.length);
}

function sectionGroups(ctx: TaskCtx): Group[] {
  const m = ctx.grouped();
  const filtering = !!(ctx.filter.q || ctx.filter.owner || ctx.filter.priority);
  const out: Group[] = ctx.sections.map((s) => ({ id: s.id, name: s.name, tasks: m.get(s.id) || [], section: true }));
  const none = m.get('') || [];
  if (none.length || !ctx.sections.length) out.push({ id: '', name: ctx.sections.length ? 'No section' : 'Tasks', tasks: none, section: false, plain: !ctx.sections.length });
  return filtering ? out.filter((g) => g.tasks.length) : out;
}

const PAGE = 60;
const STEP = 120;

interface RowProps {
  t: Task;
  mine: boolean;
  sel: boolean;
  cur: boolean;
  editing: boolean;
  sig: string;
  chipMax: number;
  onEditEnd: (id: string, value: string | null) => void;
}

const Row = memo(
  function Row({ t, mine, sel, cur, editing, chipMax, onEditEnd }: RowProps) {
    const done = t.status === 'done';
    const cls = 'pj-row' + (done ? ' is-done' : '') + (sel ? ' is-sel' : '') + (cur ? ' is-cur' : '') + (t.pending ? ' is-pending' : '') + (t.blocked ? ' is-blocked' : '') + (t.overdue ? ' is-late' : '');
    return (
      <div className={cls} role="listitem" data-id={t.id} tabIndex={-1}>
        <span className="pj-row__lead">
          <span className="pj-grip" data-grip aria-hidden="true">
            <Icon name="grip" />
          </span>
          <input type="checkbox" className="pj-sel" data-act="sel" aria-label={'Select ' + t.title} checked={sel} onChange={() => undefined} />
        </span>
        <CheckBtn t={t} />
        <span className="pj-row__title">
          {editing ? (
            <TitleEdit t={t} onEnd={onEditEnd} />
          ) : (
            <span className="pj-title" data-act="open">
              {t.title}
            </span>
          )}
          <StateTag t={t} />
          <span className="pj-row__counts">
            <Counts t={t} />
          </span>
          <FromMeeting t={t} />
        </span>
        <span className="pj-row__meta">
          <span className="pj-row__chips">
            {mine ? <ProjChip t={t} /> : null}
            <CodeChips t={t} max={chipMax} />
          </span>
          {t.code ? <span className="pj-code-id">{t.code}</span> : null}
          <button type="button" className="pj-duebtn" data-act="due" aria-label={t.due_date ? 'Due ' + dueLabel(t.due_date, t.due_time) : 'Add date'}>
            {t.due_date ? <DueTag t={t} /> : <span className="pj-due pj-due--empty">Add date</span>}
          </button>
          <button type="button" className="pj-pribtn" data-act="pri" data-ui-tooltip="pj-tip" aria-label="Priority">
            {t.priority && t.priority !== 'normal' ? (
              <PriorityIcon t={t} />
            ) : (
              <span className="pj-pri pj-pri--normal">
                <Icon name="flag" />
              </span>
            )}
          </button>
        </span>
        <OwnerBtn t={t} />
      </div>
    );
  },
  (a, b) => a.sig === b.sig
);

function TitleEdit({ t, onEnd }: { t: Task; onEnd: (id: string, value: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const end = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    onEnd(t.id, save ? ref.current?.value.trim() ?? null : null);
  };
  return (
    <input
      ref={ref}
      className="pj-title-edit"
      defaultValue={t.title}
      maxLength={300}
      aria-label="Task title"
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          end(true);
        }
        if (e.key === 'Escape') {
          e.stopPropagation();
          end(false);
        }
      }}
      onBlur={() => end(true)}
    />
  );
}

interface ListProps {
  ctx: TaskCtx;
  mode: 'project' | 'mine';
  projectKey?: string;
  onOpen: (t: Task) => void;
  /** Hands the page a way to focus the add box and the cursor group (used by Add task). */
  handleRef?: React.MutableRefObject<ListHandle | null>;
}
export interface ListHandle {
  currentGroupId: () => string | undefined;
  focusAdd: (gid?: string) => void;
}

export function ListView({ ctx, mode, projectKey, onOpen, handleRef }: ListProps) {
  useCtx(ctx);
  const mine = mode === 'mine';
  const phone = usePhone();
  const rootRef = useRef<HTMLDivElement>(null);
  const [folded, setFolded] = useState<Record<string, number>>({});
  const [shown, setShown] = useState<Record<string, number>>({});
  const [cur, setCur] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const lastSel = useRef<string | null>(null);
  const curRef = useRef<string | null>(null);
  curRef.current = cur;
  const editingRef = useRef<string | null>(null);
  editingRef.current = editing;
  const focusCur = useRef(false);

  useEffect(() => setFolded(readFolded()), []);

  const foldKey = (g: Group) => (mine ? 'mine:' : (ctx.project ? ctx.project.id : '') + ':') + g.id;
  const groups = mine ? dueGroups(ctx) : sectionGroups(ctx);
  const limitOf = (g: Group) => shown[foldKey(g)] || PAGE;
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  /* ----- the cursor: scroll to it, and focus it when the keyboard moved it */
  useLayoutEffect(() => {
    if (!cur || !focusCur.current) return;
    focusCur.current = false;
    const row = rootRef.current?.querySelector<HTMLElement>(`.pj-row[data-id="${CSS.escape(cur)}"]`);
    if (row) {
      row.scrollIntoView({ block: 'nearest' });
      row.focus({ preventScroll: true });
    }
  }, [cur]);
  const setCursor = useCallback((id: string | null, focus = true) => {
    focusCur.current = focus;
    setCur(id);
  }, []);
  const visibleRows = () => [...(rootRef.current?.querySelectorAll<HTMLElement>('.pj-sec:not(.is-folded) .pj-row') || [])];

  /* ----- selection */
  const toggleSelect = (id: string, e?: { shiftKey?: boolean }) => {
    if (e && e.shiftKey && lastSel.current) {
      const ids = visibleRows().map((r) => r.dataset.id as string);
      const a = ids.indexOf(lastSel.current || id);
      const b = ids.indexOf(id);
      if (b >= 0) {
        const [x, y] = a < 0 ? [b, b] : [Math.min(a, b), Math.max(a, b)];
        for (let i = x; i <= y; i++) ctx.sel.add(ids[i]);
      }
    } else if (ctx.sel.has(id)) ctx.sel.delete(id);
    else ctx.sel.add(id);
    lastSel.current = id;
    ctx.emit('select');
  };

  /* ----- adding */
  const addTask = (gid: string, title: string) => {
    const gg = groupsRef.current.find((x) => String(x.id) === String(gid));
    if (gg) setShown((s) => ({ ...s, [foldKey(gg)]: Infinity }));
    const f: Record<string, unknown> = { title };
    if (mine) {
      const g = groupsRef.current.find((x) => x.id === gid);
      Object.assign(f, g && g.add ? g.add : {}, { owner_email: ctx.me });
    } else {
      f.section_id = gid || null;
      const ow = ctx.filter.owner;
      if (ow && ow !== 'none') f.owner_email = ow === 'me' ? ctx.me : ow;
    }
    return ctx.create(f);
  };
  const focusAdd = useCallback((gid?: string) => {
    const root = rootRef.current;
    if (!root) return;
    const z = gid !== undefined ? root.querySelector(`.pj-add[data-gid="${CSS.escape(gid)}"]`) : null;
    const f = z || root.querySelector('.pj-add');
    if (f) {
      const i = f.querySelector('input');
      if (i) {
        i.focus();
        i.scrollIntoView({ block: 'nearest' });
      }
    }
  }, []);
  useEffect(() => {
    if (handleRef) handleRef.current = { currentGroupId: () => { const t = curRef.current && ctx.by.get(curRef.current); return t ? t.section_id || '' : undefined; }, focusAdd };
    return () => {
      if (handleRef) handleRef.current = null;
    };
  }, [ctx, focusAdd, handleRef]);

  const onSubmit = (e: FormEvent<HTMLDivElement>) => {
    const f = (e.target as HTMLElement).closest('.pj-add') as HTMLFormElement | null;
    if (!f) return;
    e.preventDefault();
    const inp = f.querySelector('input') as HTMLInputElement;
    const title = inp.value.trim();
    if (!title) return;
    inp.value = '';
    void addTask(f.dataset.gid || '', title);
    inp.focus({ preventScroll: true });
    requestAnimationFrame(() => inp.scrollIntoView({ block: 'nearest' }));
  };

  /* ----- titles and sections */
  const onEditEnd = (id: string, value: string | null) => {
    const t = ctx.by.get(id);
    setEditing(null);
    if (t && value && value !== t.title) void ctx.patch(id, { title: value });
    setCursor(id);
  };
  const toggleFold = (zone: HTMLElement | null) => {
    if (!zone) return;
    const k = zone.dataset.fold as string;
    const m = { ...folded };
    if (m[k]) delete m[k];
    else m[k] = 1;
    setFolded(m);
    writeFolded(m);
  };
  const sectionMenu = async (zone: HTMLElement, anchor: HTMLElement) => {
    const sid = zone.dataset.zone as string;
    const i = ctx.sections.findIndex((s) => s.id === sid);
    const items = [{ value: 'rename', label: 'Rename', icon: 'list' }] as { value: string; label: string; icon: string; hint?: string }[];
    if (i > 0) items.push({ value: 'up', label: 'Move up', icon: 'up' });
    if (i < ctx.sections.length - 1) items.push({ value: 'down', label: 'Move down', icon: 'down' });
    items.push({ value: 'del', label: 'Delete section', hint: 'Its tasks stay, with no section', icon: 'trash' });
    const v = await choose<string>({ anchor, title: 'Section', items });
    if (v === 'rename') setRenaming(sid);
    else if (v === 'up') void ctx.moveSection(sid, -1);
    else if (v === 'down') void ctx.moveSection(sid, 1);
    else if (v === 'del') void ctx.deleteSection(sid);
  };
  const addSection = async () => {
    const s = await ctx.addSection('New section');
    if (!s) return;
    setRenaming(s.id);
    requestAnimationFrame(() => rootRef.current?.querySelector(`.pj-sec[data-zone="${CSS.escape(s.id)}"]`)?.scrollIntoView({ block: 'nearest' }));
  };

  /* ----- clicks */
  const onClick = async (e: RMouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const act = target.closest('[data-act]') as HTMLElement | null;
    const a = act ? act.dataset.act : '';
    if (a === 'retry') {
      void ctx.load(projectKey);
      return;
    }
    if (a === 'fold') {
      toggleFold(target.closest('.pj-sec') as HTMLElement);
      return;
    }
    if (a === 'secmenu') {
      void sectionMenu(target.closest('.pj-sec') as HTMLElement, act as HTMLElement);
      return;
    }
    if (a === 'addsec') {
      void addSection();
      return;
    }
    if (a === 'more') {
      const z = target.closest('.pj-sec') as HTMLElement;
      const g = groupsRef.current.find((x) => String(x.id) === z.dataset.zone);
      if (g) setShown((s) => ({ ...s, [foldKey(g)]: limitOf(g) + STEP }));
      return;
    }
    const hdr = target.closest('.pj-sec__h');
    if (hdr && !a) {
      toggleFold(hdr.closest('.pj-sec') as HTMLElement);
      return;
    }
    const row = target.closest('.pj-row') as HTMLElement | null;
    if (!row) return;
    const t = ctx.by.get(row.dataset.id as string);
    if (!t) return;
    setCursor(t.id, false);
    if (a === 'done') {
      void ctx.patch(t.id, { done: t.status !== 'done' });
      return;
    }
    if (a === 'sel') {
      toggleSelect(t.id, e);
      return;
    }
    if (a === 'owner') {
      const r = await pickOwner({ title: 'Assign to', current: t.owner_email });
      if (r) void ctx.patch(t.id, { owner_email: r.email });
      return;
    }
    if (a === 'due') {
      const v = await pickDate({ anchor: act, value: t.due_date });
      if (v !== undefined) void ctx.patch(t.id, { due_date: v });
      return;
    }
    if (a === 'pri') {
      const v = await pickPriority({ anchor: act, value: t.priority });
      if (v) void ctx.patch(t.id, { priority: v });
      return;
    }
    if (ctx.selecting || ctx.sel.size || e.metaKey || e.ctrlKey || e.shiftKey) {
      toggleSelect(t.id, e);
      return;
    }
    if (isTmp(t.id)) return;
    onOpen(t);
  };
  const onDouble = (e: RMouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const title = target.closest('.pj-title');
    if (title) {
      e.preventDefault();
      const row = title.closest('.pj-row') as HTMLElement | null;
      const t = row ? ctx.by.get(row.dataset.id as string) : null;
      if (t) setEditing(t.id);
      return;
    }
    const nm = target.closest('.pj-sec__name[data-act="rename"]') as HTMLElement | null;
    if (nm) setRenaming((nm.closest('.pj-sec') as HTMLElement).dataset.zone || null);
  };
  const onKeyDownRoot = (e: RKeyboardEvent<HTMLDivElement>) => {
    const inp = (e.target as HTMLElement).closest?.('.pj-add__in') as HTMLInputElement | null;
    if (inp && e.key === 'Escape') {
      e.stopPropagation();
      inp.value = '';
      inp.blur();
    } else if (inp && e.key === 'ArrowUp' && !inp.value) {
      e.preventDefault();
      const rows = visibleRows();
      const own = [...(inp.closest('.pj-sec')?.querySelectorAll<HTMLElement>('.pj-row') || [])];
      const last = own[own.length - 1] || rows[rows.length - 1];
      if (last) {
        setCursor(last.dataset.id as string);
        inp.blur();
      }
    }
  };

  /* ----- the keyboard (document level, as before) */
  const moveBy = useCallback(
    (id: string, dir: number) => {
      if (mine) return;
      const t = ctx.by.get(id);
      if (!t) return;
      const sib = ctx.grouped().get(t.section_id || '') || [];
      const i = sib.findIndex((x) => x.id === id);
      const j = i + dir;
      if (j < 0 || j >= sib.length) return;
      void ctx.move(id, dir > 0 ? { section_id: t.section_id, after: sib[j].id } : { section_id: t.section_id, before: sib[j].id }).then(() => setCursor(id));
    },
    [ctx, mine, setCursor]
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.metaKey && e.key !== 'a') return;
      const el = document.activeElement;
      if (sheetOpen() || drawerOpen()) return;
      if (typing(el)) return;
      const k = e.key;
      const root = rootRef.current;
      if (!root) return;
      const rows = visibleRows();
      const c = curRef.current;
      const idx = rows.findIndex((r) => r.dataset.id === c);
      const inList = root.contains(el) || el === document.body || !el;
      if (!inList) return;
      if (k === 'ArrowDown' || k === 'j') {
        e.preventDefault();
        if (e.altKey && c) {
          moveBy(c, 1);
          return;
        }
        const n = rows[Math.min(rows.length - 1, idx + 1)];
        if (n) setCursor(n.dataset.id as string);
      } else if (k === 'ArrowUp' || k === 'k') {
        e.preventDefault();
        if (e.altKey && c) {
          moveBy(c, -1);
          return;
        }
        const n = rows[Math.max(0, idx < 0 ? rows.length - 1 : idx - 1)];
        if (n) setCursor(n.dataset.id as string);
      } else if (k === ' ' && c) {
        e.preventDefault();
        const ids = ctx.sel.size ? [...ctx.sel] : [c];
        const all = ids.every((id) => (ctx.by.get(id) || ({} as Task)).status === 'done');
        void ctx.bulk(ids, { done: !all });
      } else if (k === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const t = c && ctx.by.get(c);
        if (t && !isTmp(t.id)) onOpen(t);
        else focusAdd(undefined);
      } else if ((k === 'o' || k === 'ArrowRight') && c) {
        const t = ctx.by.get(c);
        if (t && !isTmp(t.id)) {
          e.preventDefault();
          onOpen(t);
        }
      } else if (k === 'n' || k === 'c') {
        e.preventDefault();
        const t = c && ctx.by.get(c);
        focusAdd(t && !mine ? t.section_id || '' : undefined);
      } else if (k === 'x' && c) {
        e.preventDefault();
        if (ctx.sel.has(c)) ctx.sel.delete(c);
        else ctx.sel.add(c);
        lastSel.current = c;
        ctx.emit('select');
      } else if (k === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        rows.forEach((r) => ctx.sel.add(r.dataset.id as string));
        ctx.emit('select');
      } else if (k === 'F2' && c) {
        e.preventDefault();
        setEditing(c);
      } else if ((k === 'Delete' || k === 'Backspace') && (ctx.sel.size || c)) {
        e.preventDefault();
        void ctx.remove(ctx.sel.size ? [...ctx.sel] : [c as string]);
      } else if (k === 'Escape') {
        if (ctx.sel.size || ctx.selecting) {
          ctx.sel.clear();
          ctx.selecting = false;
          ctx.emit('select');
        } else if (c) setCursor(null, false);
      } else if (k === 'd' && c) {
        e.preventDefault();
        const t = ctx.by.get(c);
        const btn = root.querySelector<HTMLElement>(`.pj-row[data-id="${CSS.escape(c)}"] [data-act="due"]`);
        void pickDate({ anchor: btn, value: t?.due_date }).then((v) => {
          if (v !== undefined) void ctx.patch(c, { due_date: v });
        });
      } else if (k === 'a' && c) {
        e.preventDefault();
        const t = ctx.by.get(c);
        void pickOwner({ title: 'Assign to', current: t?.owner_email }).then((r) => {
          if (r) void ctx.patch(c, { owner_email: r.email });
        });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ctx, mine, onOpen, focusAdd, moveBy, setCursor]);

  /* ----- drag */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return dnd(root, {
      item: '.pj-row',
      zone: '.pj-sec',
      body: '[data-rows]',
      grip: '[data-grip]',
      canStart: (item) => !(ctx.selecting || (ctx.sel.size > 0 && isPhone())) && item.dataset.id !== editingRef.current && !isTmp(item.dataset.id),
      onDrop: (d) => {
        if (mine) {
          const g = dueGroups(ctx).find((x) => x.id === d.zone);
          if (g && g.drop) {
            const t = ctx.by.get(d.id);
            if (!t) return;
            const body = g.drop(t);
            if (body && body.due_date !== t.due_date) void ctx.patch(d.id, body);
          }
          return;
        }
        void ctx.move(d.id, { section_id: d.zone || null, before: d.beforeId || undefined, after: d.afterId || undefined });
      },
    });
  }, [ctx, mine]);

  /* ----- the bulk bar */
  const nSel = ctx.sel.size;
  useEffect(() => {
    document.documentElement.classList.toggle('pj-bulk-open', nSel > 0);
    return () => document.documentElement.classList.remove('pj-bulk-open');
  }, [nSel]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const onBulk = async (e: RMouseEvent<HTMLDivElement>) => {
    const b = (e.target as HTMLElement).closest('[data-b]') as HTMLElement | null;
    if (!b) return;
    const ids = [...ctx.sel];
    const k = b.dataset.b;
    if (k === 'clear') {
      ctx.sel.clear();
      ctx.selecting = false;
      ctx.emit('select');
    } else if (k === 'done') {
      const all = ids.every((id) => (ctx.by.get(id) || ({} as Task)).status === 'done');
      await ctx.bulk(ids, { done: !all });
    } else if (k === 'owner') {
      const r = await pickOwner({ title: 'Assign ' + ids.length + ' tasks' });
      if (r) await ctx.bulk(ids, { owner_email: r.email });
    } else if (k === 'due') {
      const v = await pickDate({ anchor: b, title: 'Due date for ' + ids.length + ' tasks', value: '' });
      if (v !== undefined) await ctx.bulk(ids, { due_date: v });
    } else if (k === 'pri') {
      const v = await pickPriority({ anchor: b });
      if (v) await ctx.bulk(ids, { priority: v });
    } else if (k === 'section') {
      const v = await pickSection({ anchor: b, sections: ctx.sections });
      if (v === undefined) return;
      for (const id of ids) await ctx.move(id, { section_id: v });
    } else if (k === 'del') await ctx.remove(ids);
  };
  const bulkTasks = [...ctx.sel].map((id) => ctx.by.get(id)).filter(Boolean) as Task[];
  const allDone = bulkTasks.length > 0 && bulkTasks.every((t) => t.status === 'done');

  /* ----- draw */
  const sections = useMemo(() => null, []);
  void sections;
  if (ctx.loading) {
    return (
      <div className="pj-list" ref={rootRef}>
        <div className="pj-skel" aria-busy="true">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
    );
  }
  if (ctx.error) {
    return (
      <div className="pj-list" ref={rootRef} onClick={onClick}>
        <div className="pj-empty pj-empty--err">
          <p>{ctx.error}</p>
          <button type="button" className="pj-btn" data-act="retry">
            Try again
          </button>
        </div>
      </div>
    );
  }
  const selecting = !!ctx.selecting || ctx.sel.size > 0;
  return (
    <div className={'pj-list' + (selecting ? ' is-selecting' : '')} ref={rootRef} onClick={onClick} onDoubleClick={onDouble} onSubmit={onSubmit} onKeyDown={onKeyDownRoot}>
      {ctx.tasks.length === 0 && !ctx.filter.q ? (
        <div className="pj-empty pj-empty--first">
          <b>{mine ? 'Nothing assigned to you' : 'No tasks yet'}</b>
          <span>{mine ? 'Add a task below, or ask someone to assign you one.' : 'Type a title below and press Enter. Keep typing to add the next one.'}</span>
        </div>
      ) : null}
      {groups.map((g) => {
        const f = !!folded[foldKey(g)];
        const lim = limitOf(g);
        const left = Math.max(0, g.tasks.length - lim);
        const part = left ? g.tasks.slice(0, lim) : g.tasks;
        const sc = !mine && ctx.counts && !ctx.showDone && !ctx.filter.q ? (ctx.counts.by_section[g.id || ''] || {}).done : 0;
        return (
          <section key={g.id} className={'pj-sec' + (f ? ' is-folded' : '')} data-zone={g.id} data-fold={foldKey(g)} role="group" aria-label={g.name}>
            {g.plain ? null : (
              <header className={'pj-sec__h' + (g.tone ? ' is-' + g.tone : '')}>
                <button type="button" className="pj-sec__tog" data-act="fold" aria-expanded={!f} aria-label={(f ? 'Open ' : 'Close ') + g.name}>
                  <Icon name="right" />
                </button>
                <SectionName g={g} renaming={renaming === g.id} onDone={(v) => { setRenaming(null); if (v) void ctx.renameSection(g.id, v); }} />
                <span className="pj-sec__n">{g.tasks.length + (sc ? ' · ' + sc + ' completed' : '')}</span>
                <span className="pj-sec__sp" />
                {g.section ? (
                  <button type="button" className="pj-sec__more" data-act="secmenu" aria-label={'Section menu for ' + g.name}>
                    <Icon name="more" />
                  </button>
                ) : null}
              </header>
            )}
            <div className="pj-sec__b">
              <div className="pj-sec__rows" data-rows role="list">
                {f
                  ? null
                  : part.map((t) => {
                      const sel = ctx.sel.has(t.id);
                      const isCur = cur === t.id;
                      const isEd = editing === t.id;
                      return <Row key={t.id} t={t} mine={mine} sel={sel} cur={isCur} editing={isEd} chipMax={phone ? 2 : 4} sig={taskSig(t, (sel ? 's' : '') + (isCur ? 'c' : '') + (isEd ? 'e' : '') + (phone ? 'p' : ''))} onEditEnd={onEditEnd} />;
                    })}
              </div>
              <button type="button" className="pj-showmore" data-act="more" hidden={!left}>
                {left ? 'Show ' + Math.min(left, STEP) + ' more of ' + left : ''}
              </button>
              {g.noAdd ? null : (
                <form className="pj-add" data-gid={g.id} autoComplete="off">
                  <span className="pj-add__plus">
                    <Icon name="plus" />
                  </span>
                  <input className="pj-add__in" type="text" maxLength={300} placeholder={mine && g.id !== 'none' ? 'Add a task for ' + g.name.toLowerCase() : 'Add a task'} aria-label={'Add a task to ' + g.name} enterKeyHint="done" />
                </form>
              )}
            </div>
          </section>
        );
      })}
      {!mine && ctx.project && !ctx.filter.q ? (
        <button type="button" className="pj-addsec" data-act="addsec">
          <Icon name="plus" />
          Add section
        </button>
      ) : null}
      {mounted && nSel
        ? createPortal(
            <div className="pj-bulk" role="toolbar" aria-label="Selected tasks" onClick={onBulk}>
              <span className="pj-bulk__n">{nSel} selected</span>
              <button type="button" className="pj-bulk__b" data-b="done">
                <Icon name="check" />
                {allDone ? 'Reopen' : 'Complete'}
              </button>
              <button type="button" className="pj-bulk__b" data-b="owner">
                <Icon name="user" />
                Assign
              </button>
              <button type="button" className="pj-bulk__b" data-b="due">
                <Icon name="cal" />
                Due date
              </button>
              <button type="button" className="pj-bulk__b" data-b="pri">
                <Icon name="flag" />
                Priority
              </button>
              {mine ? null : (
                <button type="button" className="pj-bulk__b" data-b="section">
                  <Icon name="list" />
                  Move
                </button>
              )}
              <button type="button" className="pj-bulk__b pj-bulk__b--danger" data-b="del">
                <Icon name="trash" />
                Remove
              </button>
              <button type="button" className="pj-bulk__x" data-b="clear" aria-label="Clear selection">
                <Icon name="x" />
              </button>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function SectionName({ g, renaming, onDone }: { g: Group; renaming: boolean; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const ended = useRef(false);
  useEffect(() => {
    const h = ref.current;
    if (!renaming || !h) return;
    ended.current = false;
    h.focus();
    const sel = getSelection();
    const r = document.createRange();
    r.selectNodeContents(h);
    sel?.removeAllRanges();
    sel?.addRange(r);
  }, [renaming]);
  const end = (save: boolean) => {
    if (ended.current) return;
    ended.current = true;
    const h = ref.current;
    const v = h ? (h.textContent || '').trim() : '';
    if (h && !(save && v)) h.textContent = g.name;
    onDone(save && v ? v : null);
  };
  return (
    <h3
      ref={ref}
      className="pj-sec__name"
      {...(g.section ? { 'data-act': 'rename', title: 'Double-click to rename' } : {})}
      contentEditable={renaming ? ('plaintext-only' as unknown as boolean) : false}
      suppressContentEditableWarning
      onKeyDown={(e) => {
        if (!renaming) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          end(true);
          ref.current?.blur();
        }
        if (e.key === 'Escape') {
          e.stopPropagation();
          end(false);
          ref.current?.blur();
        }
      }}
      onBlur={() => renaming && end(true)}
    >
      {g.name}
    </h3>
  );
}
