import { useEffect, useRef, useState } from 'react';
import { BodyPortal } from './BodyPortal';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { Icon } from './Icon';
import { hubOv } from '@/lib/hubOv';

const learnIndex = z.object({
  articles: z.record(z.string(), z.object({ title: z.string(), summary: z.string(), href: z.string(), videos: z.array(z.never()).optional() })),
  pages: z.record(z.string(), z.string()),
});

/** The ? button and its side panel: the help article for the page you are on. Port of src/components/LearnPanel.astro. */
export function HelpPanel({ navId }: { navId: string }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [asked, setAsked] = useState(false);
  const idx = useQuery({
    queryKey: ['help-index'],
    enabled: asked,
    staleTime: 60 * 60_000,
    queryFn: async () => learnIndex.parse(await (await fetch('/help/learn.json', { credentials: 'same-origin' })).json()),
  });

  // The index loads while the page is idle, so the panel opens with its answer already in it.
  useEffect(() => {
    const w = window as unknown as { requestIdleCallback?: (f: () => void) => void };
    const run = () => setAsked(true);
    if (w.requestIdleCallback) w.requestIdleCallback(run);
    else setTimeout(run, 1200);
  }, []);

  const open = () => {
    setAsked(true);
    const d = dlg.current;
    if (d && !d.open) d.showModal();
  };

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    let tok: ReturnType<typeof hubOv.on> | null = null;
    const sync = () => {
      if (d.open && !tok) tok = hubOv.on(() => { tok = null; d.close(); });
      else if (!d.open && tok) { const t = tok; tok = null; hubOv.off(t); }
    };
    const mo = new MutationObserver(sync);
    mo.observe(d, { attributes: true, attributeFilter: ['open'] });
    return () => mo.disconnect();
  }, []);

  const slug = idx.data ? idx.data.pages[navId] : '';
  const a = idx.data && slug ? idx.data.articles[slug] : null;
  let downOn: EventTarget | null = null;

  return (
    <>
      <QuestionMenu onHelp={open} />
      {BodyPortal(
      <dialog
        className="lp"
        id="lp-dlg"
        ref={dlg}
        aria-labelledby="lp-title"
        onPointerDownCapture={(e) => { downOn = e.target; }}
        onClick={(e) => {
          if (e.target === dlg.current && (downOn === dlg.current || downOn === null)) dlg.current?.close();
          downOn = null;
        }}
      >
        <div className="lp__in">
          <div className="lp__bar">
            <span>Help</span>
            <button type="button" className="lp__x" data-lp-close aria-label="Close help" onClick={() => dlg.current?.close()}>
              &times;
            </button>
          </div>
          <div id="lp-body">
            {idx.isLoading ? (
              <div className="lp__skel" role="status" aria-label="Loading">
                <i />
                <i />
                <i />
              </div>
            ) : a ? (
              <>
                <h2 id="lp-title">{a.title}</h2>
                <p>{a.summary}</p>
                <a className="lp__go" href={a.href}>
                  Read the full article
                </a>
              </>
            ) : (
              <>
                <h2 id="lp-title">Help</h2>
                <p>No article for this page yet.</p>
                <div className="lp__more">
                  <a className="lp__go" href="/help/">
                    Open the help home
                  </a>
                </div>
              </>
            )}
          </div>
        </div>
      </dialog>)}
    </>
  );
}

/** The ? menu (2026-10-15 chrome cleanup): help for this page, the help home, the tour and what is new, Feedback and the keyboard shortcuts. */
function QuestionMenu({ onHelp }: { onHelp: () => void }) {
  const [on, setOn] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!on) return;
    const click = (e: MouseEvent) => { if (!(e.target as Element).closest('#h-qm')) setOn(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOn(false); btn.current?.focus(); } };
    document.addEventListener('click', click);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('click', click); document.removeEventListener('keydown', key); };
  }, [on]);
  return (
    <div className="h-qm" id="h-qm">
      <button type="button" ref={btn} className="h-top__cam h-qm__btn" id="h-qm-btn" aria-haspopup="menu" aria-expanded={on} aria-controls="h-qmenu" aria-label="Help and feedback" title="Help and feedback" onClick={() => setOn((v) => !v)}>
        <Icon name="help" />
      </button>
      <div className="h-qmenu" id="h-qmenu" role="menu" aria-label="Help and feedback" hidden={!on} onClick={(e) => { if ((e.target as Element).closest('[role=menuitem]')) setOn(false); }}>
        <button type="button" role="menuitem" className="lp-btn" id="lp-btn" aria-haspopup="dialog" onClick={onHelp}>
          <Icon name="help" />
          Help for this page
        </button>
        <a role="menuitem" href="/help/">
          <Icon name="book" />
          Help home
        </a>
        <button type="button" role="menuitem" data-tour-start>
          <Icon name="play" />
          Tour and what is new
          <span className="h-nav__count" data-count="tours" hidden />
        </button>
        <button type="button" role="menuitem" data-feedback="hub">
          <Icon name="chat" />
          Feedback
        </button>
        <button type="button" role="menuitem" data-keys-open onClick={() => (window as unknown as { hubKeys?: { open?: () => void } }).hubKeys?.open?.()}>
          <Icon name="tools" />
          Keyboard shortcuts
        </button>
      </div>
    </div>
  );
}
