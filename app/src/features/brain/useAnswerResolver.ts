// Drag an answer into what you are writing, or Send to email (public/js/ask-brain.js): that script finds the answer an element
// belongs to through a resolver; this one reads the engine's open chat by the answer's data-abody index.
import { useEffect } from 'react';
import type { BrainEngine } from './engine';

const engines = new Set<BrainEngine>();
let registered = false;
function register() {
  const FAB = (window as unknown as { FavorAskBrain?: { register(fn: (el: Element) => unknown): void } }).FavorAskBrain;
  if (registered || !FAB) return;
  registered = true;
  FAB.register((el: Element) => {
    const i = Number(el.getAttribute('data-abody'));
    for (const e of engines) {
      const t = e.s.cur && e.s.cur.turns[i];
      if (t && document.contains(el)) return t;
    }
    return null;
  });
}

export function useAnswerResolver(e: BrainEngine) {
  useEffect(() => {
    engines.add(e);
    register();
    const t = setTimeout(register, 1500);
    return () => {
      engines.delete(e);
      clearTimeout(t);
    };
  }, [e]);
}
