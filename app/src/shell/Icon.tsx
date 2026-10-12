import { ICONS } from '@hub/data/icons';

interface Props {
  name: string;
  className?: string;
}

/** The hub's line icons (src/data/icons.ts), drawn as an svg that is a direct child, the way the classic menu draws them. */
export function Icon({ name, className = 'h-i' }: Props) {
  if (name === 'brain') return <BrainMark />;
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] || '' }} />;
}

/** Favor Brain's ring of light (round2.css, .fbr). Same markup as brainMark() in src/data/icons.ts. */
export function BrainMark({ state = 'idle' }: { state?: string }) {
  return (
    <span className="fbr" data-state={state} aria-hidden="true">
      <i className="fbr__halo" />
      <i className="fbr__in">
        <i className="fbr__lit" />
        <i className="fbr__rg" />
        <i className="fbr__cm" />
      </i>
    </span>
  );
}

/** A path-only icon with its own svg paths (Today's tiles keep their own small set). */
export function PathIcon({ d, className = 'h-i' }: { d: string; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />;
}
