// Small inputs for the review pane. The classic page saved a field on the browser's own "change" event (when the person leaves the field,
// presses Enter, or picks a date or a list entry), not on every key, so these listen for that event and nothing else. The field keeps what
// the person typed while they are in it and takes the stored value when they leave.
import { useEffect, useRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { TERMS } from '@shared/giving';

type Base = { value: string; onCommit: (v: string) => void };

function useNative<T extends HTMLInputElement | HTMLTextAreaElement>(value: string, onCommit: (v: string) => void) {
  const ref = useRef<T>(null);
  const commit = useRef(onCommit);
  useEffect(() => {
    commit.current = onCommit;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = () => commit.current(el.value);
    el.addEventListener('change', h);
    return () => el.removeEventListener('change', h);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el && el.value !== value && document.activeElement !== el) el.value = value;
  }, [value]);
  return ref;
}

export function ChangeInput({ value, onCommit, ...rest }: Base & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange'>) {
  const ref = useNative<HTMLInputElement>(value, onCommit);
  return <input ref={ref} defaultValue={value} {...rest} />;
}

export function ChangeArea({ value, onCommit, ...rest }: Base & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'defaultValue' | 'onChange'>) {
  const ref = useNative<HTMLTextAreaElement>(value, onCommit);
  return <textarea ref={ref} defaultValue={value} {...rest} />;
}

/** A word with its plain meaning on hover, focus and tap (the hub's [data-term] tooltip reads these attributes). The words come from shared/giving.ts. */
export function GeTerm({ k, label }: { k: keyof typeof TERMS; label?: string }) {
  const t = TERMS[k];
  const text = label || t.label;
  return (
    <span className="h-term" tabIndex={0} role="button" aria-label={text + '. ' + t.tip} data-term={t.tip}>
      {text}
    </span>
  );
}
