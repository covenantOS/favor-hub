// The drawer panel itself: a sheet on a phone (Back closes it), a panel on the right on a desktop that opens over the page without moving
// it. Drawn into document.body after the page has mounted, so the server never renders it. Same markup and class names as build() in
// public/js/projects/drawer.js.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../kit/Icon';
import { IntakeSlot } from '../intake/slot';
import type { Task } from '../types';
import { Fields } from './Fields';
import { TaskLinks, installClipIntent } from './links';
import { Activity, Composer, Dependencies, Description, Files, Subtasks } from './Sections';
import { closeDrawer, commitTitle, copyTaskLink, more, openParent, orderIds, projectUrl, registerFlush, retry, S, stepTask, taskItem, toggleDone, useDrawer } from './state';

/** The title: one editable line. Enter or leaving it saves; an empty title goes back to the old one. */
function Title({ t }: { t: Task | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const title = t ? t.title : '';
  // Show the stored title unless the person is typing in it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.textContent !== title) el.textContent = title;
  });
  const commit = () => {
    const el = ref.current;
    if (!el || !S.task) return;
    const v = (el.textContent || '').trim();
    if (!v) {
      el.textContent = S.task.title;
      return;
    }
    commitTitle(v);
  };
  useEffect(() => registerFlush(commit), []);
  return (
    <div
      ref={ref}
      className="pj-dr__title"
      role="textbox"
      aria-label="Task title"
      aria-multiline="false"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck
      onInput={(e) => {
        const el = e.currentTarget;
        if ((el.textContent || '').length > 300) el.textContent = (el.textContent || '').slice(0, 300);
      }}
      onPaste={(e) => {
        e.preventDefault();
        const t0 = e.clipboardData.getData('text').replace(/\s+/g, ' ');
        document.execCommand('insertText', false, t0);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === 'Escape' && S.task && e.currentTarget.textContent !== S.task.title) {
          e.stopPropagation();
          e.currentTarget.textContent = S.task.title;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function Crumb({ t }: { t: Task }) {
  const src = t.source as { url?: unknown; label?: string } | undefined;
  return (
    <>
      {t.parent_id && S.parentRef ? (
        <button type="button" className="pj-crumb__up" data-a="parent" onClick={openParent}>
          <Icon name="up" />
          {S.parentRef.code || 'Parent task'}
        </button>
      ) : null}
      {t.code ? (
        <button
          type="button"
          className="pj-code-id pj-code-id--btn"
          data-a="copy"
          draggable
          data-task-drag=""
          title="Copy a link to this task, or drag it into an email"
          onClick={() => copyTaskLink(t)}
          onDragStart={(e) => {
            const it = taskItem(t);
            e.dataTransfer.setData('application/x-favoros-item', JSON.stringify(it));
            e.dataTransfer.setData('text/uri-list', it.url);
            e.dataTransfer.setData('text/plain', it.url);
            e.dataTransfer.effectAllowed = 'copy';
          }}
        >
          {t.code}
          <Icon name="copy" />
        </button>
      ) : null}
      {src && typeof src.url === 'string' && src.url.charAt(0) === '/' ? (
        <a className="pj-src" href={src.url}>
          <Icon name="link" />
          <span>{src.label}</span>
        </a>
      ) : null}
    </>
  );
}

function DrawerView() {
  const s = useDrawer();
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const t = s.task;

  // The phone keyboard: --pj-kb is the part of the screen the keyboard covers, so the sheet and its composer stay above it.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const fit = () => {
      wrapRef.current?.style.setProperty('--pj-kb', Math.max(0, Math.round(innerHeight - vv.offsetTop - vv.height)) + 'px');
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
    };
  }, []);

  // Opening puts focus on the panel so Tab and the keys work at once.
  useEffect(() => {
    if (!s.open) return;
    const r = requestAnimationFrame(() => {
      const p = panelRef.current;
      if (p && wrapRef.current && !wrapRef.current.contains(document.activeElement)) p.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(r);
  }, [s.open]);

  const scrollDown = () => {
    const el = scrollRef.current;
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const nodes = [...wrap.querySelectorAll<HTMLElement>('.pj-dr button:not([disabled]):not([hidden]), .pj-dr input:not([hidden]), .pj-dr textarea, .pj-dr a[href]')].filter((n) => n.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const a = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (a === first || (a && a.classList.contains('pj-dr')))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && a === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const ids = s.open ? orderIds() : [];
  const i = t ? ids.indexOf(t.id) : -1;
  const onProjects = location.pathname.indexOf('/projects') === 0;
  const done = !!t && t.status === 'done';
  const ref = t ? t.code || t.id : '';
  const err = s.error;

  return (
    <div ref={wrapRef} className={'pj-dr-wrap' + (s.open ? ' is-open' : '')} onKeyDown={onKey}>
      <div className="pj-dr__scrim" data-close="" onClick={closeDrawer} />
      <aside ref={panelRef} className="pj-dr" role="dialog" aria-modal="true" aria-label="Task" tabIndex={-1}>
        <header className="pj-dr__bar">
          <a className="pj-dr__open" data-open-pj="" href={t ? projectUrl(t) : '/projects/'} hidden={!t || onProjects}>
            Open in Projects
          </a>
          <span className="pj-dr__sp" />
          <button type="button" className="pj-dr__ib pj-dr__nav" data-a="prev" aria-label="Previous task" disabled={i <= 0} hidden={ids.length < 2} onClick={() => stepTask(-1)}>
            <Icon name="up" />
          </button>
          <button type="button" className="pj-dr__ib pj-dr__nav" data-a="next" aria-label="Next task" disabled={i < 0 || i >= ids.length - 1} hidden={ids.length < 2} onClick={() => stepTask(1)}>
            <Icon name="down" />
          </button>
          <button type="button" className="pj-dr__ib" data-a="more" aria-label="More" onClick={(e) => void more(e.currentTarget)}>
            <Icon name="more" />
          </button>
          <button type="button" className="pj-dr__ib" data-close="" aria-label="Close" onClick={closeDrawer}>
            <Icon name="x" />
          </button>
        </header>
        <div ref={scrollRef} className="pj-dr__scroll" data-scroll="">
          <div className="pj-dr__crumb" data-crumb="">
            {t ? <Crumb t={t} /> : null}
          </div>
          <div className="pj-dr__trow">
            {t ? (
              <button type="button" className={'pj-check pj-dr__done' + (done ? ' is-on' : '')} data-a="done" role="checkbox" aria-checked={done} aria-label={done ? 'Mark not done' : 'Mark complete'} onClick={toggleDone}>
                <Icon name="check" />
              </button>
            ) : (
              <button type="button" className="pj-check pj-dr__done" data-a="done" />
            )}
            <Title t={t} />
          </div>
          <div data-fields="">
            {err ? (
              <div className="pj-empty pj-empty--err">
                <p>{err.status === 403 || err.status === 404 ? 'Not available to you.' : err.message || 'This task did not load.'}</p>
                {err.status === 403 || err.status === 404 ? null : (
                  <button type="button" className="pj-btn" data-a="retry" onClick={retry}>
                    Try again
                  </button>
                )}
              </div>
            ) : t ? (
              <Fields t={t} />
            ) : (
              <div className="pj-skel pj-skel--drawer" aria-busy="true">
                <i />
                <i />
                <i />
                <i />
              </div>
            )}
          </div>
          {t ? <IntakeSlotHost t={t} /> : null}
          <Description t={t} />
          {t ? <Subtasks t={t} /> : <section className="pj-dr__sec" />}
          {t ? <Dependencies /> : <section className="pj-dr__sec" />}
          {t ? <Files /> : <section className="pj-dr__sec" />}
          <section className="pj-dr__sec" data-pjl="">
            {t ? (
              <>
                <h3 className="rt-h">Links</h3>
                <TaskLinks key={ref} taskRef={ref} />
              </>
            ) : null}
          </section>
          <Activity />
        </div>
        <footer className="rt-dfoot" data-comp="">
          {t ? <Composer key={t.id} scrollDown={scrollDown} /> : null}
        </footer>
      </aside>
    </div>
  );
}

function IntakeSlotHost({ t }: { t: Task }) {
  return <IntakeSlot task={t} ctx={S.main} />;
}

/** Mount once on every Projects page. Draws nothing until a task has been opened. */
export function DrawerHost() {
  const s = useDrawer();
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(true);
    return installClipIntent();
  }, []);
  if (!on || !s.everOpened) return null;
  return createPortal(<DrawerView />, document.body);
}
