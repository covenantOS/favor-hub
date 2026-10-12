import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { Icon } from './Icon';
import { hubOv } from '@/lib/hubOv';

const vid = z.object({ slug: z.string(), title: z.string(), length: z.string(), src: z.string(), poster: z.string(), track: z.string() });
const learnIndex = z.object({
  articles: z.record(z.string(), z.object({ title: z.string(), summary: z.string(), href: z.string(), videos: z.array(vid) })),
  pages: z.record(z.string(), z.string()),
});

/** The ? button and its side panel: the help article for the page you are on, with its videos. Port of src/components/LearnPanel.astro. */
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
      <button type="button" className="h-top__cam lp-btn" id="lp-btn" aria-haspopup="dialog" aria-label="Help for this page" title="Help for this page" onClick={open}>
        <Icon name="help" />
      </button>
      {createPortal(
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
                {a.videos.map((v) => (
                  <figure key={v.slug}>
                    <video controls preload="none" playsInline poster={v.poster} data-video={v.slug}>
                      <source src={v.src} type="video/mp4" />
                      <track kind="captions" src={v.track} srcLang="en" label="English" default />
                    </video>
                    <figcaption>
                      {v.title} <span>{v.length}</span>
                    </figcaption>
                  </figure>
                ))}
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
                  <a className="lp__go" href="/help/videos/">
                    Training videos
                  </a>
                </div>
              </>
            )}
          </div>
        </div>
      </dialog>,
      document.body
      )}
    </>
  );
}
