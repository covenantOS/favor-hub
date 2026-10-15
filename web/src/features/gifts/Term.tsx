// A word with its plain meaning on hover, focus and tap (the hub's [data-term] tooltip reads these attributes). The words come from
// TERMS in shared/giving.ts, the one place that defines them.
import { TERMS } from '@shared/giving';

export function GiftTerm({ k, label }: { k: keyof typeof TERMS; label?: string }) {
  const t = TERMS[k];
  const text = label || t.label;
  return (
    <span className="h-term" tabIndex={0} role="button" aria-label={text + '. ' + t.tip} data-term={t.tip}>
      {text}
    </span>
  );
}
