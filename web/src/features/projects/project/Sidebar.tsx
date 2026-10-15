// The projects sidebar: every project the person can see, with its sections. The open project is expanded and follows the page
// (sections added or renamed show up at once). Other projects load their sections when expanded. On a phone it is a panel that opens
// from the Projects button. Ported from public/js/projects/sidebar.js.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink } from '@/shell/NavLink';
import { api } from '../lib/api';
import { useCtx, type TaskCtx } from '../lib/store';
import { projectHref } from '../lib/url';
import type { Project, Section } from '../types';
import { Icon } from '../kit/Icon';
import { projectList } from '../sheets/Switcher';

interface Props {
  ctx: TaskCtx;
  pkey: string;
  collapsed: boolean;
  onCollapse: () => void;
  /** Phone panel state. */
  open: boolean;
  onClose: () => void;
  onSection: (id: string) => void;
}

export function Sidebar({ ctx, pkey, collapsed, onCollapse, open, onClose, onSection }: Props) {
  useCtx(ctx);
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set([pkey.toUpperCase()]));
  const [secs, setSecs] = useState<Record<string, Section[]>>({});
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [q, setQ] = useState('');
  const [phone, setPhone] = useState(false);
  const [mounted, setMounted] = useState(false);
  const find = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
    const m = matchMedia('(max-width: 860px)');
    const f = () => setPhone(m.matches);
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  useEffect(() => {
    let live = true;
    projectList()
      .then((l) => live && setProjects(l))
      .catch(() => live && setProjects([]));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('pj-side-open', open && phone);
    return () => document.documentElement.classList.remove('pj-side-open');
  }, [open, phone]);

  const sectionsOf = (p: Project): Section[] | null => {
    if (ctx.project && (p.key === ctx.project.key || p.id === ctx.project.id)) return ctx.sections;
    return secs[p.key] || null;
  };
  const ensure = async (key: string) => {
    if (secs[key] || (ctx.project && ctx.project.key === key)) return;
    let s: Section[] = [];
    try {
      s = (await api.project(key)).sections || [];
    } catch {
      s = [];
    }
    setSecs((m) => ({ ...m, [key]: s }));
  };

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = projects || [];
  const rows = list.filter((p) => p.status === 'active' && words.every((w) => (p.name + ' ' + p.key).toLowerCase().includes(w)));
  const cur = pkey.toUpperCase();

  const body = (
    <>
      <div className="pj-side__head">
        <span className="pj-side__t">Projects</span>
        <button type="button" className="pj-side__x" aria-label="Collapse the sidebar" onClick={onCollapse}>
          <Icon name="back" />
        </button>
      </div>
      <nav className="pj-side__nav" aria-label="Projects">
        <NavLink className="pj-side__a" href="/projects/?tab=mine">
          <Icon name="check" />
          <span>My tasks</span>
        </NavLink>
        <NavLink className="pj-side__a" href="/projects/?tab=projects">
          <Icon name="list" />
          <span>All projects</span>
        </NavLink>
      </nav>
      {list.length > 8 ? (
        <label className="pj-side__find">
          <Icon name="search" />
          <input ref={find} type="search" placeholder="Find a project" aria-label="Find a project" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      ) : null}
      <ul className="pj-side__list">
        {rows.map((p) => {
          const isOpen = openKeys.has(p.key);
          const ss = isOpen ? sectionsOf(p) : null;
          return (
            <li key={p.key} className={'pj-side__p' + (p.key === cur ? ' is-cur' : '')}>
              <div className="pj-side__row">
                <button
                  type="button"
                  className={'pj-side__car' + (isOpen ? ' is-open' : '')}
                  aria-expanded={isOpen}
                  aria-label={(isOpen ? 'Hide' : 'Show') + ' sections of ' + p.name}
                  onClick={() => {
                    const n = new Set(openKeys);
                    if (n.has(p.key)) n.delete(p.key);
                    else {
                      n.add(p.key);
                      void ensure(p.key);
                    }
                    setOpenKeys(n);
                  }}
                >
                  <Icon name="right" />
                </button>
                <NavLink className="pj-side__link" href={projectHref(p.key)} aria-current={p.key === cur ? 'page' : undefined}>
                  <i className="pj-dot" data-c={p.color} />
                  <span>{p.name}</span>
                </NavLink>
              </div>
              {isOpen ? (
                <ul className="pj-side__secs">
                  {ss ? (
                    ss.length ? (
                      ss.map((s) => (
                        <li key={s.id}>
                          <NavLink
                            className="pj-side__sec"
                            href={projectHref(p.key, '&section=' + encodeURIComponent(s.id))}
                            onClick={(e) => {
                              if (ctx.project && p.key === ctx.project.key) {
                                e.preventDefault();
                                onSection(s.id);
                                if (phone) onClose();
                              }
                            }}
                          >
                            {s.name}
                          </NavLink>
                        </li>
                      ))
                    ) : (
                      <li className="pj-side__none">No sections</li>
                    )
                  ) : (
                    <li className="pj-side__none">Loading</li>
                  )}
                </ul>
              ) : null}
            </li>
          );
        })}
        {rows.length ? null : <li className="pj-side__none">{list.length ? 'No match' : projects === null ? 'Loading' : 'No projects'}</li>}
      </ul>
    </>
  );

  // On a phone the panel opens over the page, so it is drawn into the body, with a scrim behind it.
  if (phone && mounted) {
    return open
      ? createPortal(
          <>
            <aside className="pj-side is-open" aria-label="Projects">
              {body}
            </aside>
            <div className="pj-side__scrim" onClick={onClose} />
          </>,
          document.body
        )
      : null;
  }
  return (
    <aside className={'pj-side' + (collapsed ? ' is-collapsed' : '')} aria-label="Projects">
      {body}
    </aside>
  );
}
