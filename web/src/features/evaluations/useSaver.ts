// Autosave for the three forms. Each answer is queued as it is typed and sent 0.7 s later in one batch per form, the way the Astro page
// did. A batch goes out only after the one before it finished, a failed batch is tried again after 5 s, and what is still unsaved when the
// person leaves the evaluation is sent once more on the way out.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { evalCall } from './api';
import { byId, SOURCE_OF, type Ans, type Answers, type CaseView, type FormId } from './logic';
import { evKeys } from './queries';

export type Edits = Record<FormId, Answers>;
const none = (): Edits => ({ A: {}, B: {}, C: {} });
const FORMS: FormId[] = ['A', 'B', 'C'];

export interface Saver {
  /** Unsaved edits, by form. */
  edits: Edits;
  /** "Saving", "Saved 3:04 PM", or "Not saved. <why>". */
  saving: string;
  queue: (form: FormId, ans: Ans) => void;
  /** Send what is waiting for this form and resolve when it has been tried. */
  flush: (form: FormId) => Promise<void>;
  /** True while anything is waiting to be sent. */
  pending: () => boolean;
}

export function useSaver(caseId: string): Saver {
  const qc = useQueryClient();
  const ref = useRef<Edits>(none());
  const [edits, setEdits] = useState<Edits>(none());
  const [saving, setSaving] = useState('');
  const timers = useRef<Partial<Record<FormId, ReturnType<typeof setTimeout>>>>({});
  const chain = useRef<Promise<void>>(Promise.resolve());
  const alive = useRef(true);

  const sync = () => setEdits({ A: ref.current.A, B: ref.current.B, C: ref.current.C });

  const send = useCallback(
    async (form: FormId): Promise<void> => {
      const cur = ref.current[form];
      const keys = Object.keys(cur);
      if (!keys.length) return;
      const batch = keys.map((k) => cur[k]);
      const snap: Record<string, string> = {};
      keys.forEach((k) => {
        snap[k] = JSON.stringify(cur[k]);
      });
      try {
        await evalCall('PUT', 'case/' + encodeURIComponent(caseId) + '/answers', { form, answers: batch });
      } catch (e) {
        if (!alive.current) return;
        setSaving('Not saved. ' + (e as Error).message);
        timers.current[form] = setTimeout(() => void flush(form), 5000);
        return;
      }
      const now = ref.current[form];
      const left: Answers = { ...now };
      const saved: Answers = {};
      keys.forEach((k) => {
        if (now[k] && JSON.stringify(now[k]) === snap[k]) {
          saved[k] = now[k];
          delete left[k];
        }
      });
      ref.current = { ...ref.current, [form]: left };
      if (!alive.current) return;
      qc.setQueryData<CaseView>(evKeys.case(caseId), (v) => {
        const src = v && v[SOURCE_OF[form]];
        if (!v || !src) return v;
        const m = byId(src.answers);
        Object.keys(saved).forEach((k) => {
          m[k] = saved[k];
        });
        return { ...v, [SOURCE_OF[form]]: { ...src, answers: Object.keys(m).map((k) => m[k]) } };
      });
      sync();
      setSaving('Saved ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
      if (Object.keys(left).length) timers.current[form] = setTimeout(() => void flush(form), 300);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [caseId, qc],
  );

  const flush = useCallback(
    (form: FormId): Promise<void> => {
      clearTimeout(timers.current[form]);
      const next = chain.current.then(() => send(form));
      chain.current = next.catch(() => undefined);
      return next;
    },
    [send],
  );

  const queue = useCallback(
    (form: FormId, ans: Ans) => {
      ref.current = { ...ref.current, [form]: { ...ref.current[form], [ans.qid]: ans } };
      sync();
      setSaving('Saving');
      clearTimeout(timers.current[form]);
      timers.current[form] = setTimeout(() => void flush(form), 700);
    },
    [flush],
  );

  const pending = useCallback(() => FORMS.some((f) => Object.keys(ref.current[f]).length > 0), []);

  useEffect(() => {
    alive.current = true;
    const t = timers.current;
    // A person who closes the tab with unsaved answers is asked first.
    const leave = (e: BeforeUnloadEvent) => {
      if (FORMS.some((f) => Object.keys(ref.current[f]).length > 0)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', leave);
    return () => {
      window.removeEventListener('beforeunload', leave);
      FORMS.forEach((f) => clearTimeout(t[f]));
      // Leaving this evaluation (another tab of the site, another page) sends what is waiting, once.
      const waiting = FORMS.filter((f) => Object.keys(ref.current[f]).length > 0);
      alive.current = false;
      waiting.forEach((f) => void chain.current.then(() => send(f)));
    };
  }, [send]);

  return { edits, saving, queue, flush, pending };
}
