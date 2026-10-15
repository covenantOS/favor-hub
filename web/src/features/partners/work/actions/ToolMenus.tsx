// The menus above the Open actions list: saved Views, Export, and the phone's More (public/js/work-edit.js menu, csv, applyView).
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { asParam, wcDelete, wcPost } from './api';
import { toast } from './engine';
import { AnchoredPop, type PopState } from './InlinePops';
import { plural } from './model';
import type { Work } from './model';
import { viewsQuery, type SavedWorkView } from './queries';
import { Ic } from './ui';
import type { Act, WorkFilters } from './types';

export interface MenuState {
  kind: 'views' | 'export' | 'more';
  rect: PopState['rect'];
}

export interface ViewSpec {
  view: string;
  f: WorkFilters;
  sort: string;
  dir: number;
  cols: Record<string, number>;
}

export function ToolPop(p: {
  menu: MenuState;
  onClose: () => void;
  w: Work;
  list: Act[];
  views: SavedWorkView[];
  spec: () => ViewSpec;
  onApply: (v: SavedWorkView) => void;
  onSelectPage: () => void;
  canAddPartner: boolean;
  onAddPartner: () => void;
  onMenu: (k: MenuState['kind'], rect: PopState['rect']) => void;
}) {
  const { menu, onClose, w } = p;
  if (menu.kind === 'views') return <ViewsPop {...p} />;
  if (menu.kind === 'export') {
    const csv = () => {
      const rows = p.list.map((a) => {
        const c = w.cur(a);
        return { id: a.id, due: c.due, partner: a.p, lookup: a.lk || '', place: a.loc || '', type: c.type, category: c.cat, summary: c.sum || '', fundraisers: c.f.map((x) => w.P(x).n).join(', '), added: a.add || '', priority: a.pri || '' };
      });
      const cols: [keyof (typeof rows)[number], string][] = [['id', 'Action id'], ['due', 'Due'], ['partner', 'Partner'], ['lookup', 'Lookup id'], ['place', 'City'], ['type', 'Type'], ['category', 'Category'], ['summary', 'Summary'], ['fundraisers', 'Fundraisers'], ['added', 'Added'], ['priority', 'Priority']];
      const q = (v: unknown) => {
        const s = String(v == null ? '' : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const text = [cols.map((c) => c[1]).join(',')].concat(rows.map((r) => cols.map((c) => q(r[c[0]])).join(','))).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
      a.download = `work-center-${w.today}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast(`Downloaded ${plural(rows.length, 'action')}.`);
    };
    return (
      <AnchoredPop rect={menu.rect} onClose={onClose} keep="[data-menu]">
        <b className="lab">Export the {plural(p.list.length, 'action')} that match</b>
        <div className="ep-pop__list">
          <button
            type="button"
            onClick={() => {
              csv();
              onClose();
            }}
          >
            <Ic n="ext" />
            Download a CSV file
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              window.print();
            }}
          >
            Print this list
          </button>
        </div>
      </AnchoredPop>
    );
  }
  return (
    <AnchoredPop rect={menu.rect} onClose={onClose} keep="[data-menu]">
      <div className="ep-pop__list ep-pop__list--more">
        <button
          type="button"
          onClick={() => {
            onClose();
            p.onSelectPage();
          }}
        >
          Select all
        </button>
        <button type="button" onClick={() => (onClose(), setTimeout(() => p.onMenu('views', menu.rect), 0))}>
          <Ic n="filter" />
          Views{p.views.length ? ' (' + p.views.length + ')' : ''}
        </button>
        <button type="button" onClick={() => (onClose(), setTimeout(() => p.onMenu('export', menu.rect), 0))}>
          <Ic n="ext" />
          Export
        </button>
        {p.canAddPartner ? (
          <button
            type="button"
            onClick={() => {
              onClose();
              p.onAddPartner();
            }}
          >
            <Ic n="plus" />
            Add partner
          </button>
        ) : null}
      </div>
    </AnchoredPop>
  );
}

function ViewsPop(p: { menu: MenuState; onClose: () => void; views: SavedWorkView[]; spec: () => ViewSpec; onApply: (v: SavedWorkView) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [def, setDef] = useState(false);
  const key = viewsQuery(asParam() || undefined).queryKey;
  const del = async (id: string) => {
    try {
      const out = await wcDelete<{ views: SavedWorkView[] }>('/api/work/views?id=' + encodeURIComponent(id));
      qc.setQueryData(key, out.views);
    } catch (e) {
      toast((e as Error).message);
    }
    p.onClose();
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const out = await wcPost<{ views: SavedWorkView[] }>('/api/work/views', { name, default: def, spec: p.spec() });
      qc.setQueryData(key, out.views);
      toast('Saved the view ' + name + '.');
    } catch (er) {
      toast((er as Error).message);
    }
    p.onClose();
  };
  return (
    <AnchoredPop rect={p.menu.rect} onClose={p.onClose} keep="[data-menu]">
      <b className="lab">Saved views</b>
      <div className="ep-pop__list">
        {p.views.length ? (
          p.views.map((v) => (
            <div key={v.id} className="ep-viewrow">
              <button
                type="button"
                onClick={() => {
                  p.onApply(v);
                  p.onClose();
                }}
              >
                {v.name}
                {v.default ? (
                  <>
                    {' '}
                    <i>opens first</i>
                  </>
                ) : null}
              </button>
              <button type="button" className="ep-x" aria-label={'Delete ' + v.name} onClick={() => void del(v.id)}>
                ×
              </button>
            </div>
          ))
        ) : (
          <p className="wc-note">No saved views.</p>
        )}
      </div>
      <form className="ep-viewsave" onSubmit={(e) => void save(e)}>
        <input type="text" name="name" maxLength={60} placeholder="Name this view" required value={name} onChange={(e) => setName(e.target.value)} />
        <label className="wc-toggle">
          <input type="checkbox" name="def" checked={def} onChange={(e) => setDef(e.target.checked)} />
          Open with it
        </label>
        <button type="submit" className="h-btn h-btn--primary h-btn--sm">
          Save
        </button>
      </form>
    </AnchoredPop>
  );
}
