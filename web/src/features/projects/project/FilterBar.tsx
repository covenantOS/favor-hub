// The filter bar under a project's view tabs: assignee, due, status, tag, Show completed, and saved views. Ported from
// public/js/projects/filters.js.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { STATUS } from '../lib/dates';
import { useCtx, type TaskCtx } from '../lib/store';
import { Icon } from '../kit/Icon';
import { askText, choose } from '../kit/overlays';
import { toast } from '../kit/toast';
import { activeCount, codesIn, DUE, FILTER_KEYS } from './filters';

interface SavedView {
  id: string;
  name: string;
  query: Record<string, unknown>;
}

function Chip({ k, label, value, on, onClick }: { k: string; label: string; value: string; on: boolean; onClick: (el: HTMLElement) => void }) {
  return (
    <button type="button" className={'pj-fchip' + (on ? ' is-on' : '')} data-f={k} aria-haspopup="listbox" onClick={(e) => onClick(e.currentTarget)}>
      <span className="pj-fchip__k">{label}</span>
      {on ? <span className="pj-fchip__v">{value}</span> : null}
      <Icon name="down" />
    </button>
  );
}

export function FilterBar({ ctx, project }: { ctx: TaskCtx; project: string }) {
  useCtx(ctx);
  const [views, setViews] = useState<SavedView[]>([]);
  const loadViews = useCallback(
    () =>
      api
        .views(project)
        .then((d) => setViews((d.views || []) as SavedView[]))
        .catch(() => setViews([])),
    [project]
  );
  useEffect(() => {
    void loadViews();
  }, [loadViews]);

  const f = ctx.filter;
  const o2 = f.owner;
  const ownerName = o2 === 'me' ? 'Me' : o2 === 'none' ? 'Unassigned' : o2 ? ctx.staff.nameOf(o2) || o2 : '';
  const n = activeCount(ctx) + (f.q ? 1 : 0);

  const set = (k: keyof typeof f, v: string | undefined) => {
    ctx.filter[k] = v || '';
    if (k === 'status' && v === 'done' && !ctx.showDone) void ctx.setShowDone(true);
    ctx.emit('filter');
  };
  const queryNow = () => ({ q: f.q, owner: f.owner, due: f.due, status: f.status, code: f.code, priority: f.priority, show_done: ctx.showDone });
  const applyView = async (v: SavedView) => {
    const q = v.query || {};
    for (const k of FILTER_KEYS) ctx.filter[k] = typeof q[k] === 'string' ? (q[k] as string) : '';
    ctx.filter.priority = typeof q.priority === 'string' ? q.priority : '';
    const want = !!q.show_done || ctx.filter.status === 'done';
    if (want !== ctx.showDone) await ctx.setShowDone(want);
    else ctx.emit('filter');
  };

  const pickOwner = async (b: HTMLElement) => {
    const mem = (ctx.members || []).map((m) => ({ value: m.email, label: m.name || ctx.staff.nameOf(m.email) || m.email, on: f.owner === m.email }));
    const v = await choose<string>({ anchor: b, title: 'Assignee', search: mem.length > 8, placeholder: 'Find a person', items: [{ value: '', label: 'Anyone', on: !f.owner }, { value: 'me', label: 'Me', on: f.owner === 'me' }, { value: 'none', label: 'Unassigned', on: f.owner === 'none' }, ...mem] });
    if (v !== undefined) set('owner', v);
  };
  const pickDue = async (b: HTMLElement) => {
    const v = await choose<string>({ anchor: b, title: 'Due', items: [{ value: '', label: 'Any time', on: !f.due }, ...Object.entries(DUE).map(([value, label]) => ({ value, label, on: f.due === value }))] });
    if (v !== undefined) set('due', v);
  };
  const pickStatus = async (b: HTMLElement) => {
    const v = await choose<string>({ anchor: b, title: 'Status', items: [{ value: '', label: 'Any status', on: !f.status }, ...['open', 'doing', 'waiting', 'done'].map((value) => ({ value, label: STATUS[value], on: f.status === value }))] });
    if (v !== undefined) set('status', v);
  };
  const pickTag = async (b: HTMLElement) => {
    const cs = codesIn(ctx.tasks);
    const v = await choose<string>({ anchor: b, title: 'Tag', search: cs.length > 8, placeholder: 'Find a code', items: [{ value: '', label: 'Any tag', on: !f.code }, ...cs.map(([value, hint]) => ({ value, label: value, hint, on: f.code === value }))] });
    if (v !== undefined) set('code', v);
  };
  const viewsMenu = async (b: HTMLElement) => {
    const items = views.map((v) => ({ value: 'v:' + v.id, label: v.name, icon: 'filter' }));
    items.push({ value: 'save', label: 'Save these filters as a view', icon: 'plus' });
    if (views.length) items.push({ value: 'delete', label: 'Delete a view', icon: 'trash' });
    const pick = await choose<string>({ anchor: b, title: 'Saved views', items });
    if (pick === 'save') {
      const name = await askText({ title: 'Save view', label: 'Name', action: 'Save', placeholder: 'Overdue and mine' });
      if (!name || !name.trim()) return;
      try {
        await api.saveView({ name: name.trim(), project_id: project || undefined, query: queryNow() });
        toast('View saved');
        await loadViews();
      } catch (err) {
        toast((err as Error).message || 'The view did not save.', { error: true });
      }
    } else if (pick === 'delete') {
      const del = await choose<string>({ anchor: b, title: 'Delete a view', items: views.map((v) => ({ value: v.id, label: v.name, icon: 'trash' })) });
      if (!del) return;
      try {
        await api.deleteView(del);
        await loadViews();
      } catch (err) {
        toast((err as Error).message || 'The view was not deleted.', { error: true });
      }
    } else if (typeof pick === 'string' && pick.startsWith('v:')) {
      const v = views.find((x) => 'v:' + x.id === pick);
      if (v) void applyView(v);
    }
  };

  return (
    <>
      <Chip k="owner" label="Assignee" value={ownerName} on={!!o2} onClick={pickOwner} />
      <Chip k="due" label="Due" value={DUE[f.due] || ''} on={!!f.due} onClick={pickDue} />
      <Chip k="status" label="Status" value={STATUS[f.status] || ''} on={!!f.status} onClick={pickStatus} />
      <Chip k="code" label="Tag" value={f.code} on={!!f.code} onClick={pickTag} />
      <label className="pj-fshow">
        <input type="checkbox" data-f="done" checked={ctx.showDone} onChange={(e) => void ctx.setShowDone(e.target.checked)} />
        <span>Show completed</span>
      </label>
      {n ? (
        <button
          type="button"
          className="pj-fclear"
          data-f="clear"
          onClick={() => {
            for (const x of FILTER_KEYS) ctx.filter[x] = '';
            ctx.filter.priority = '';
            ctx.emit('filter');
          }}
        >
          Clear filters
        </button>
      ) : null}
      <span className="pj-fsp" />
      <button type="button" className="pj-fchip" data-f="views" aria-haspopup="listbox" onClick={(e) => void viewsMenu(e.currentTarget)}>
        <span className="pj-fchip__k">Views</span>
        {views.length ? <span className="pj-fchip__n">{views.length}</span> : null}
        <Icon name="down" />
      </button>
    </>
  );
}
