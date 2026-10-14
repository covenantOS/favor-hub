import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { hubOv } from '@/lib/hubOv';
import { loadScript } from '@/lib/legacy';
import { keys } from '@/lib/query';
import { initials } from '@/lib/format';
import { entityResponse, type EntityOut } from '@shared/schemas';
import { NavLink } from '@/shell/NavLink';
import { EntityIcon } from './EntityChip';
import { installTaskLinks } from './taskPanel';
import { askText, entityStore, KIND_LABEL, normId } from './store';

const phone = () => !matchMedia('(hover: hover)').matches || matchMedia('(max-width: 860px)').matches;

function useEntity(kind: string, id: string) {
  const nid = normId(kind, id);
  return useQuery({
    queryKey: keys.entity(kind, nid),
    queryFn: async () => (await api('/api/hub/entity?kind=' + encodeURIComponent(kind) + '&id=' + encodeURIComponent(nid), entityResponse)).item,
    staleTime: 120_000,
  });
}

function Avatar({ it, fallback }: { it: Pick<EntityOut, 'kind' | 'title' | 'pic'>; fallback?: string }) {
  if (it.kind === 'person') return <span className="fe-av">{it.pic ? <img src={it.pic} alt="" referrerPolicy="no-referrer" /> : initials(it.title || fallback || '')}</span>;
  return (
    <span className={'fe-av fe-av--' + it.kind}>
      <EntityIcon name={it.kind} />
    </span>
  );
}

const can = (act: string) => {
  const r = document.documentElement.classList;
  return act === 'message' ? r.contains('has-chat') : act === 'task' ? r.contains('has-projects') : true;
};

/** Helpers from before the app that Send to, Message and Make a task still run on (public/js). Loaded the first time a card needs one. */
async function legacy(): Promise<void> {
  await loadScript('/js/favor-ui.js?v=1');
  await loadScript('/js/favor-share.js?v=1');
}

async function run(act: string, it: EntityOut, anchor: HTMLElement | null | undefined) {
  const w = window as unknown as {
    FavorShare?: { dm(id: string): void; menu(a: HTMLElement, o: Record<string, unknown>): void };
    PJLinks?: { makeTask(o: Record<string, unknown>): void };
  };
  const lookup = it.facts.find((f) => f.k === 'Lookup ID')?.v;
  if (act === 'brain') {
    entityStore.close();
    location.href = '/brain/?ask=' + encodeURIComponent(askText(it.kind, it.title, it.id, lookup));
    return;
  }
  if (act === 'message') {
    await legacy();
    entityStore.close();
    w.FavorShare?.dm(it.id);
    return;
  }
  if (act === 'task') {
    entityStore.close();
    await loadScript('/js/projects/links.js?v=1');
    w.PJLinks?.makeTask({ title: it.kind === 'person' ? 'Follow up with ' + it.title : it.kind === 'task' ? 'Follow up on ' + it.title : it.title, owner: it.kind === 'person' ? it.id : undefined });
    return;
  }
  if (act === 'send') {
    await legacy();
    entityStore.close();
    w.FavorShare?.menu(anchor || document.body, { kind: it.kind, id: it.id, title: it.title, url: it.url, sub: it.sub, lookup });
  }
}

/** The hover card (computer) or sheet (phone) for whatever chip or search row opened it. Mounted once in the shell. */
export function EntityHost() {
  const ref = useSyncExternalStore(entityStore.subscribe, entityStore.getSnapshot);
  useEffect(() => installTaskLinks(), []);
  if (!ref) return null;
  return createPortal(<Card key={ref.kind + ':' + ref.id} />, document.body);
}

function Card() {
  const ref = useSyncExternalStore(entityStore.subscribe, entityStore.getSnapshot)!;
  const q = useEntity(ref.kind, ref.id);
  const el = useRef<HTMLDivElement>(null);
  const hide = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const sheet = !!ref.sheet || phone();
  const it = q.data;
  const label = ref.label || KIND_LABEL[ref.kind];

  // Place the card under its chip, or above when there is no room below. A sheet needs no position.
  useLayoutEffect(() => {
    const card = el.current;
    const a = ref.anchor;
    if (sheet || !card || !a) return;
    const r = a.getBoundingClientRect();
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const m = 10;
    const left = Math.max(m, Math.min(document.documentElement.clientWidth - w - m, r.left + r.width / 2 - w / 2));
    const below = r.bottom + 8;
    const top = below + h > innerHeight - m && r.top - h - 8 > m ? r.top - h - 8 : Math.min(below, Math.max(m, innerHeight - h - m));
    setPos({ left: Math.round(left), top: Math.round(top) });
  }, [sheet, ref.anchor, it, q.isLoading]);

  useEffect(() => {
    // A person who does not resolve gets no card at all.
    if (!q.isLoading && ref.kind === 'person' && !it) entityStore.close();
  }, [q.isLoading, it, ref.kind]);

  useEffect(() => {
    const tok = sheet ? hubOv.on(() => entityStore.close()) : null;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const a = ref.anchor;
        entityStore.close();
        a?.focus?.();
      }
    };
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!el.current?.contains(t) && !ref.anchor?.contains(t)) entityStore.close();
    };
    const scroll = () => {
      if (!sheet) entityStore.close();
    };
    // Leaving the chip closes the card after a moment, unless the pointer moves onto the card.
    const a = ref.anchor;
    const leave = () => {
      if (!sheet) hide.current = setTimeout(() => entityStore.close(), 260);
    };
    const enter = () => clearTimeout(hide.current);
    a?.addEventListener('pointerleave', leave);
    a?.addEventListener('pointerenter', enter);
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', down);
    addEventListener('scroll', scroll, true);
    return () => {
      if (tok) hubOv.off(tok);
      clearTimeout(hide.current);
      a?.removeEventListener('pointerleave', leave);
      a?.removeEventListener('pointerenter', enter);
      document.removeEventListener('keydown', key);
      document.removeEventListener('mousedown', down);
      removeEventListener('scroll', scroll, true);
    };
  }, [sheet, ref.anchor]);

  const head = (title: string, sub: string, avatar: React.ReactNode) => (
    <div className="fe-card__head">
      {avatar}
      <div className="fe-card__who">
        <b>{title}</b>
        <span>{sub}</span>
      </div>
      {sheet && (
        <button type="button" className="fe-x" aria-label="Close" onClick={() => entityStore.close()}>
          <EntityIcon name="x" />
        </button>
      )}
    </div>
  );

  let body: React.ReactNode;
  if (q.isLoading) {
    body = (
      <>
        {head(label, KIND_LABEL[ref.kind], <span className="fe-av fe-av--wait" />)}
        <div className="fe-wait">
          <i />
          <i />
          <i />
        </div>
      </>
    );
  } else if (!it || it.restricted) {
    body = (
      <>
        {head(label, KIND_LABEL[ref.kind], <Avatar it={{ kind: ref.kind, title: label }} />)}
        <p className="fe-card__note">{it?.restricted && ref.kind === 'task' ? 'Projects access shows task details.' : 'Not available to you.'}</p>
      </>
    );
  } else {
    const acts = it.acts.filter(can);
    body = (
      <>
        {head(it.title || label, it.sub || KIND_LABEL[it.kind], <Avatar it={it} />)}
        {it.facts.length > 0 && (
          <dl className="fe-facts">
            {it.facts.map((f) => (
              <div key={f.k}>
                <dt>{f.k}</dt>
                <dd>{f.v}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="fe-acts">
          {acts.map((a) => {
            if (a === 'open')
              return it.url ? (
                <NavLink key={a} className="fe-btn fe-btn--main" href={it.url} onClick={() => entityStore.close()}>
                  <EntityIcon name="open" />
                  Open
                </NavLink>
              ) : null;
            const name = ({ message: 'Message', task: 'Make a task', brain: 'Ask Brain', send: 'Send to' } as Record<string, string>)[a];
            return name ? (
              <button key={a} type="button" className={'fe-btn' + (a === 'message' ? ' fe-btn--main' : '')} onClick={() => void run(a, it, ref.anchor)}>
                <EntityIcon name={a === 'task' ? 'task' : a} />
                {name}
                {a === 'send' ? '…' : ''}
              </button>
            ) : null;
          })}
        </div>
      </>
    );
  }

  return (
    <>
      {sheet && <div className="fe-scrim" onClick={() => entityStore.close()} />}
      <div
        ref={el}
        className={'fe-card' + (sheet ? ' fe-sheet' : '')}
        role="dialog"
        aria-label={label}
        style={!sheet && pos ? { left: pos.left, top: pos.top } : !sheet ? { left: -9999, top: 0 } : undefined}
        onPointerEnter={() => clearTimeout(hide.current)}
        onPointerLeave={() => {
          if (!sheet) hide.current = setTimeout(() => entityStore.close(), 220);
        }}
      >
        {body}
      </div>
    </>
  );
}
