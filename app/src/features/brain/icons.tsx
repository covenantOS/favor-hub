// Favor Brain's icons: one SVG sprite (bci-<name>, src/pages/brain/_icons.ts, the same file the classic page used) put on the
// page once, and <Ic n="copy" /> to draw one.
import { SPRITE } from '../../../../src/pages/brain/_icons';

const ALIAS: Record<string, string> = { dollar: 'coin', gift: 'coin', team: 'chart', people: 'users' };

export function Ic({ n, className = 'h-i' }: { n: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={'#bci-' + (ALIAS[n] || n)} />
    </svg>
  );
}

/** The sprite, drawn once where the Brain is. A second copy (page and dock together) does no harm: ids resolve to the first. */
export function Sprite() {
  return <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: SPRITE }} />;
}
