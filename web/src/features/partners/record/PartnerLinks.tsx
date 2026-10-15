// Mount this once from a component every page renders. It draws the partner drawer, the tools (Call prep, Call mode, Add a partner) and
// the toast, and it listens for presses: a link to /work/partner/<id> or any element with data-partner-id (or data-partner-lookup) opens
// the drawer the way classic partner.js does on every page; any element with data-prep="<id>" opens Call prep; any element with
// data-add-partner opens the Add a partner form. Staff without the Work Center keep the link's own behavior.
// A second copy mounted on the same page stays quiet, so the partner page can mount its own safely.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PartnerDrawer } from './PartnerDrawer';
import { ToastHost } from './toast';
import { gateQuery } from './queries';
import { openPartner, useDrawer } from './drawerStore';
import { rApi } from './lib';
import { AddPartner, addOptionsQuery } from '../tools/AddPartner';
import { CallMode } from '../tools/CallMode';
import { Prep } from '../tools/Prep';
import { closeAdd, closeCall, closePrep, openAdd, openPrep, useTools } from '../tools/store';

// Only the first mounted PartnerLinks is active.
const hosts: symbol[] = [];
const hostSubs = new Set<() => void>();
const hostEmit = () => hostSubs.forEach((f) => f());

const NAME_SEL = 'a[href^="/work/partner/"]:not([data-pp-full]):not([data-i]), [data-partner-id], [data-partner-lookup]';
function idOf(el: HTMLElement): string | null {
  if (el.dataset.partnerId) return el.dataset.partnerId;
  const m = (el.getAttribute('href') || '').match(/^\/work\/partner\/(\d+)/);
  return m ? m[1] : null;
}
async function idForLookup(lk: string): Promise<string | null> {
  try {
    const d = await rApi('/api/work/partners?wide=1&q=' + encodeURIComponent(lk));
    const hit = (d.rows || []).find((h: any) => String(h.lookup) === String(lk)) || (d.rows || [])[0];
    return hit ? hit.cid : null;
  } catch {
    return null;
  }
}

function Host() {
  const gate = useQuery(gateQuery);
  const add = useQuery(addOptionsQuery);
  const d = useDrawer();
  const tools = useTools();
  const gateOn = gate.data === true;
  const gateRef = useRef(false);
  gateRef.current = gateOn;
  // The drawer stays drawn for the length of its slide-out.
  const [shown, setShown] = useState<{ id: string; compose: string | null; seq: number } | null>(null);
  useEffect(() => {
    if (d.id) {
      setShown({ id: d.id, compose: d.compose, seq: d.seq });
      return;
    }
    const t = setTimeout(() => setShown(null), 260);
    return () => clearTimeout(t);
  }, [d.id, d.compose, d.seq]);

  useEffect(() => {
    const click = async (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t || !t.closest) return;
      const prep = t.closest<HTMLElement>('[data-prep]');
      if (prep && /^\d{1,12}$/.test(prep.dataset.prep || '')) {
        e.preventDefault();
        e.stopPropagation();
        openPrep(prep.dataset.prep as string);
        return;
      }
      const addBtn = t.closest('[data-add-partner]');
      if (addBtn) {
        e.preventDefault();
        openAdd();
        return;
      }
      const name = t.closest<HTMLElement>(NAME_SEL);
      if (name && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
        // Staff without the Work Center keep the link's own behavior (the gate answer is read when the page loads).
        if (!gateRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        let id = idOf(name);
        if (!id && name.dataset.partnerLookup) id = await idForLookup(name.dataset.partnerLookup);
        if (!id) return;
        const onPage = window.location.pathname.match(/^\/work\/partner\/(\d+)/);
        if (onPage && onPage[1] === id) return;
        openPartner(id);
      }
    };
    document.addEventListener('click', click, true);
    return () => document.removeEventListener('click', click, true);
  }, []);

  // Buttons marked data-add-partner stay hidden until this person may add a partner.
  const can = !!(add.data && add.data.can);
  useEffect(() => {
    if (!can) return;
    const show = () => document.querySelectorAll<HTMLElement>('[data-add-partner][hidden]').forEach((b) => (b.hidden = false));
    show();
    const mo = new MutationObserver(show);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [can]);

  return (
    <>
      {shown ? <PartnerDrawer id={shown.id} compose={shown.compose} open={!!d.id} /> : null}
      {tools.prep ? <Prep id={tools.prep} onClose={closePrep} /> : null}
      {tools.call ? <CallMode id={tools.call.id} say={tools.call.say} onDone={tools.call.done} onClose={closeCall} /> : null}
      {tools.add ? <AddPartner onClose={closeAdd} /> : null}
      <ToastHost />
    </>
  );
}

export function PartnerLinks() {
  const id = useRef(Symbol('partner-links'));
  const first = useSyncExternalStore(
    (f) => {
      hostSubs.add(f);
      return () => hostSubs.delete(f);
    },
    () => hosts[0] === id.current,
    () => false
  );
  useEffect(() => {
    hosts.push(id.current);
    hostEmit();
    return () => {
      const i = hosts.indexOf(id.current);
      if (i >= 0) hosts.splice(i, 1);
      hostEmit();
    };
  }, []);
  return first ? <Host /> : null;
}
