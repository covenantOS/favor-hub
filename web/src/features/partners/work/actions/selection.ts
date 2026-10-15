// Selecting rows in a Work Center list: click, Shift click for a range, drag down the checkbox column, Space or x, Ctrl A for every row
// that matches, and the banner that offers it (public/js/work.js "selection"). The selection lives in the store so a batch can clear it.
import { useMemo } from 'react';
import type { Selection } from '../../../../ui/table';
import { clearSel, setSel, useWc, wcGet } from './store';

export interface SelOpts {
  /** Every id in the list, in the order shown (a range runs along it). */
  ids: string[];
  /** The ids on the page being shown. A range and Select page only touch these. */
  page: string[];
  /** A row whose change is still being sent cannot be picked. */
  selectable: (id: string) => boolean;
  /** Select all leaves out rows that are picked by hand (stale tasks about a gift of $1,000 or more). */
  bulkable?: (id: string) => boolean;
}

export function useRowSelection(o: SelOpts) {
  const selected = useWc((s) => s.sel);
  const bulk = (id: string) => o.selectable(id) && (!o.bulkable || o.bulkable(id));
  const put = (id: string, on: boolean, next: Set<string>) => {
    if (on) next.add(id);
    else next.delete(id);
  };
  const rangeTo = (id: string) => {
    const s = wcGet();
    const a = o.ids.indexOf(s.anchor || '');
    const b = o.ids.indexOf(id);
    const next = new Set(s.sel);
    if (a < 0 || b < 0) {
      put(id, !s.sel.has(id), next);
      setSel(next, id);
      return;
    }
    const on = s.sel.has(s.anchor!);
    const onPage = new Set(o.page);
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (o.selectable(o.ids[i]) && onPage.has(o.ids[i])) put(o.ids[i], on, next);
    setSel(next);
  };
  const toggle = (id: string, on: boolean, shift: boolean) => {
    const s = wcGet();
    if (!o.selectable(id)) return;
    if (shift && s.anchor) {
      rangeTo(id);
      return;
    }
    const next = new Set(s.sel);
    put(id, on, next);
    setSel(next, id);
  };
  const select: Selection = {
    selected,
    onToggle: toggle,
    drag: true,
    disabled: (id) => !o.selectable(id),
    onPage: (on) => {
      const next = new Set(wcGet().sel);
      o.page.filter(bulk).forEach((id) => put(id, on, next));
      setSel(next);
    },
  };
  const allMatching = () => {
    const next = new Set(wcGet().sel);
    o.ids.filter(bulk).forEach((id) => next.add(id));
    setSel(next);
  };
  /** The row press of the classic list: a click on the row toggles it, Shift click extends from the last one picked. */
  const rowClick = (id: string, e: { shiftKey: boolean }) => {
    const s = wcGet();
    if (!o.selectable(id)) return;
    if (e.shiftKey && s.anchor) rangeTo(id);
    else {
      const next = new Set(s.sel);
      put(id, !s.sel.has(id), next);
      setSel(next, id);
    }
    window.getSelection()?.removeAllRanges();
  };
  const banner = useMemo(() => {
    const onPage = o.page.filter(bulk);
    const allShown = o.page.length > 0 && o.page.every((id) => selected.has(id));
    const bulkAll = o.ids.filter(bulk);
    const allList = bulkAll.length > 0 && bulkAll.every((id) => selected.has(id));
    if (allShown && o.ids.length > o.page.length && !allList) return { kind: 'page' as const, shown: o.page.length, total: o.ids.length };
    if (allList && o.ids.length > 1 && selected.size >= o.ids.length && o.ids.length > o.page.length) return { kind: 'all' as const, shown: o.page.length, total: o.ids.length };
    void onPage;
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, o.ids, o.page]);
  return { selected, select, rowClick, allMatching, clear: clearSel, banner, rangeTo };
}
