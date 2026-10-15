// Reporting > Highlights > My dashboard: the answers a person pinned from Favor Brain. Port of the pins half of public/js/reporting.js.
// A pin is drawn with the Favor Brain page's own block components (app/src/features/brain/blocks), so it reads as it did in the chat.
// Pins are private to the person (the server filters by sign-in); this file only draws what /api/reporting/pins answers.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { BrainEngine } from '@/features/brain/engine';
import { BlockView } from '@/features/brain/blocks/registry';
import { Html } from '@/features/brain/blocks/basic';
import { md } from '@/features/brain/fmt';
import { Ic, Sprite } from '@/features/brain/icons';
import type { Block, Turn } from '@/features/brain/types';
import { pinsQuery, sendPin, type Pin, type PinsAnswer } from './api';
import { askedAt } from './format';
import { toast } from './toast';

const enc = encodeURIComponent;
const EXAMPLES = ['How much did RDDs raise this month compared with last month?', 'Which partners gave for the first time this month?', 'Which major partners have not given in a year?'];

function Empty() {
  return (
    <div className="h-card rg-empty">
      <h2>Nothing pinned yet</h2>
      <p>Pin an answer from Favor Brain to keep it here. Refresh asks it again with today's numbers.</p>
      <p>
        <a className="h-btn h-btn--primary h-btn--sm" href="/brain/">
          Open Favor Brain
        </a>
      </p>
      <div className="rg-eg">
        <span>Try asking</span>
        {EXAMPLES.map((q) => (
          <a key={q} href={'/brain/?ask=' + enc(q)}>
            {q}
          </a>
        ))}
      </div>
    </div>
  );
}

interface Focus {
  id: string;
  kind: string;
}

interface CardProps {
  p: Pin;
  i: number;
  n: number;
  engine: BrainEngine;
  now: number;
  busy: boolean;
  editing: boolean;
  onAct: (p: Pin, kind: string) => void;
  onRename: (p: Pin, value: string | null) => void;
}

function PinCard({ p, i, n, engine, now, busy, editing, onAct, onRename }: CardProps) {
  const blocks = useMemo(() => (p.answer.blocks || []) as Block[], [p]);
  const turn = useMemo<Turn>(() => ({ q: p.question, blocks, reading: [], follow: [] }), [p, blocks]);
  const done = useRef(false);
  const body = blocks.length ? (
    blocks.map((b, bi) => <BlockView key={bi} b={b} ctx={{ engine, turn, ti: -1, bi, expired: false, where: 'page', ask: () => undefined, openTable: () => undefined }} />)
  ) : p.answer.markdown ? (
    <Html className="blk-text" html={md(p.answer.markdown)} />
  ) : (
    <p className="rg-note">No answer is kept for this pin. Refresh asks again.</p>
  );
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onRename(p, value);
  };
  return (
    <article className="rg-pin h-card" data-pin={p.id}>
      <header className="rg-pin__h">
        <div className="rg-pin__t">
          {editing ? (
            <input
              className="rg-pin__edit"
              defaultValue={p.title}
              maxLength={120}
              aria-label="Pin title"
              autoFocus
              onFocus={(e) => {
                done.current = false;
                e.currentTarget.select();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  finish(e.currentTarget.value);
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  finish(null);
                }
              }}
              onBlur={(e) => finish(e.currentTarget.value)}
            />
          ) : (
            <h3 className="rg-pin__title" tabIndex={-1}>
              {p.title}
            </h3>
          )}
          <p className="rg-pin__q">{p.question}</p>
        </div>
        <div className="rg-pin__acts">
          <span className="rg-pin__when">Asked {askedAt(p.asked_at, now)}</span>
          <button type="button" className="h-btn h-btn--ghost h-btn--xs" data-pin-act="refresh" disabled={busy} onClick={() => onAct(p, 'refresh')}>
            {busy ? 'Asking' : 'Refresh'}
          </button>
          <button type="button" className="ib ib--sm" data-pin-act="up" aria-label="Move up" disabled={i === 0} onClick={() => onAct(p, 'up')}>
            <Ic n="sort" />
          </button>
          <button type="button" className="ib ib--sm" data-pin-act="down" aria-label="Move down" disabled={i === n - 1} onClick={() => onAct(p, 'down')}>
            <Ic n="sort" className="h-i rg-flip" />
          </button>
          <button type="button" className="ib ib--sm" data-pin-act="rename" aria-label="Rename" onClick={() => onAct(p, 'rename')}>
            <Ic n="edit" />
          </button>
          <button type="button" className="ib ib--sm" data-pin-act="remove" aria-label="Unpin" onClick={() => onAct(p, 'remove')}>
            <Ic n="trash" />
          </button>
        </div>
      </header>
      <div className="rg-pin__body m-a">{body}</div>
    </article>
  );
}

/** The pins, drawn in the browser only (an "Asked 3 hours ago" line depends on the clock). */
export function Pins() {
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(pinsQuery);
  const engine = useMemo(() => new BrainEngine('page'), []);
  // A block that changes itself (a table filter) tells the engine; drawing again picks the change up.
  useSyncExternalStore(
    engine.subscribe,
    () => engine.get().v,
    () => 0
  );
  const seenToast = useRef(0);
  useEffect(() => {
    const off = engine.subscribe(() => {
      const t = engine.get().toast;
      if (t && t.id !== seenToast.current) {
        seenToast.current = t.id;
        toast(t.text);
      }
    });
    return () => {
      off();
    };
  }, [engine]);
  const [now] = useState(() => Date.now());
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const pins = data.pins || [];
  const set = (next: Pin[]) => qc.setQueryData<PinsAnswer>(pinsQuery.queryKey, (old) => (old ? { ...old, pins: next } : old));

  useEffect(() => {
    if (!focus) return;
    const root = host.current;
    const card = root && Array.from(root.querySelectorAll<HTMLElement>('[data-pin]')).find((c) => c.dataset.pin === focus.id);
    const again = card && (card.querySelector<HTMLElement>(`[data-pin-act="${focus.kind}"]:not([disabled])`) || card.querySelector<HTMLElement>('.rg-pin__title'));
    if (again) again.focus();
    setFocus(null);
  }, [focus, pins]);

  async function act(p: Pin, kind: string) {
    if (kind === 'rename') return setEditing(p.id);
    const id = enc(p.id);
    if (kind === 'refresh') {
      setBusy(p.id);
      const d = await sendPin(`/api/reporting/pins/${id}/refresh`, 'POST');
      setBusy(null);
      if (d.ok && d.pin) {
        set(pins.map((x) => (x.id === p.id ? (d.pin as Pin) : x)));
        toast('Refreshed');
      } else toast(d.message || 'That did not refresh. Try again.');
    } else if (kind === 'up' || kind === 'down') {
      const d = await sendPin(`/api/reporting/pins/${id}`, 'PATCH', { move: kind });
      if (!d.ok) return toast(d.message || 'That did not move.');
      const next = pins.slice();
      const at = next.findIndex((x) => x.id === p.id);
      const j = kind === 'up' ? at - 1 : at + 1;
      if (at >= 0 && j >= 0 && j < next.length) [next[at], next[j]] = [next[j], next[at]];
      set(next);
      setFocus({ id: p.id, kind });
    } else if (kind === 'remove') {
      const d = await sendPin(`/api/reporting/pins/${id}`, 'DELETE');
      if (!d.ok) return toast(d.message || 'That did not unpin.');
      set(pins.filter((x) => x.id !== p.id));
      toast('Unpinned');
    }
  }

  async function rename(p: Pin, value: string | null) {
    const v = (value || '').trim();
    setEditing(null);
    if (value !== null && v && v !== p.title) {
      const d = await sendPin(`/api/reporting/pins/${enc(p.id)}`, 'PATCH', { title: v });
      if (d.ok) set(pins.map((x) => (x.id === p.id ? { ...x, title: v.slice(0, 120) } : x)));
      else toast(d.message || 'That did not save.');
    }
  }

  return (
    <div className="bc-root">
      <Sprite />
      <div id="rg-mine-body" ref={host}>
        {pins.length ? (
          <div className="rg-pins">
            {pins.map((p, i) => (
              <PinCard key={p.id} p={p} i={i} n={pins.length} engine={engine} now={now} busy={busy === p.id} editing={editing === p.id} onAct={act} onRename={rename} />
            ))}
          </div>
        ) : (
          <Empty />
        )}
      </div>
    </div>
  );
}
