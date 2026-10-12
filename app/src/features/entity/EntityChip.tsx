import { useRef, type ReactNode } from 'react';
import type { EntityKind } from '@shared/schemas';
import { NavLink } from '@/shell/NavLink';
import { entityStore, KIND_LABEL } from './store';

const PATHS: Record<string, string> = {
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-4 3.4-6 7-6s6.2 2 7 6"/>',
  partner: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c.8-3.5 3.2-5.5 6-5.5s5.2 2 6 5.5"/>',
  fund: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10.2c0-1 1.1-1.7 2.5-1.7s2.5.7 2.5 1.7-1.1 1.5-2.5 1.8-2.5.8-2.5 1.8 1.1 1.7 2.5 1.7 2.5-.7 2.5-1.7"/>',
  appeal: '<path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/>',
  task: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
  request: '<path d="M4 13h4l1.5 3h5L16 13h4"/><path d="M5 13 7 5h10l2 8v6H5z"/>',
  meeting: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
  clip: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
  course: '<path d="M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4z"/><path d="M20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  open: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>',
  message: '<path d="M4 5h16v11H9l-5 4z"/>',
  brain: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  send: '<path d="M21 3 3 11l7 3 3 7z"/><path d="m10 14 4-4"/>',
  x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
};

export const EntityIcon = ({ name }: { name: string }) => <svg className="fe-i" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: PATHS[name] || '' }} />;

interface Props {
  kind: EntityKind;
  id: string;
  label?: ReactNode;
  /** Where the chip goes when pressed on a computer. A partner links to its page by default. */
  href?: string;
}

const phone = () => !matchMedia('(hover: hover)').matches || matchMedia('(max-width: 860px)').matches;

/** A name FavorOS knows (colleague, partner, fund, appeal code, task, request, meeting, clip, course). Hover opens its card; on a phone a press does. */
export function EntityChip({ kind, id, label, href }: Props) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const text = typeof label === 'string' ? label : '';
  const link = href || (kind === 'partner' ? '/work/partner/' + encodeURIComponent(id) : '');
  const show = (el: HTMLElement) => entityStore.openCard(kind, id, text, el);
  const handlers = {
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'mouse' || phone()) return;
      const el = e.currentTarget;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => show(el), 420);
    },
    onPointerLeave: () => clearTimeout(timer.current),
  };
  const inner = (
    <>
      <span className="fe-chip__i">
        <EntityIcon name={kind} />
      </span>
      <span className="fe-chip__t">{label ?? id}</span>
    </>
  );
  const cls = 'fe-chip fe-chip--' + kind;
  if (link) {
    return (
      <NavLink
        className={cls}
        href={link}
        data-entity={kind + ':' + id}
        {...handlers}
        onClick={(e) => {
          if (phone()) {
            e.preventDefault();
            show(e.currentTarget);
          }
        }}
      >
        {inner}
      </NavLink>
    );
  }
  return (
    <button type="button" className={cls} data-entity={kind + ':' + id} title={KIND_LABEL[kind]} {...handlers} onClick={(e) => show(e.currentTarget)}>
      {inner}
    </button>
  );
}
