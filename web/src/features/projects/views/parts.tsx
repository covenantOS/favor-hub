// Small pieces the views draw: the icons and the avatar of views-common.js, with the same markup (styled by projects-views.css).
import type { Person } from '../types';
import { hashColor, initials } from './common';

const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {children}
  </svg>
);

export const IChev = () => (
  <Svg>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);
export const IChevL = () => (
  <Svg>
    <path d="M15 6l-6 6 6 6" />
  </Svg>
);
export const IPlus = () => (
  <Svg>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const ICheck = () => (
  <Svg>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);
export const IX = () => (
  <Svg>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
export const ICal = () => (
  <Svg>
    <rect x="4" y="5" width="16" height="15" rx="2" />
    <path d="M4 10h16M9 3v4M15 3v4" />
  </Svg>
);

/** A small round-cornered avatar for a person ({ email, name, picture }); size is '', 'xs', 'sm' or 'lg'. */
export function PjvAvatar({ p, size }: { p: Pick<Person, 'email' | 'name' | 'picture'> | null | undefined; size?: string }) {
  if (!p) return <span className={'pjv-av pjv-av--none' + (size ? ' pjv-av--' + size : '')} aria-hidden="true" />;
  const c = hashColor(p.email || p.name);
  const label = p.name || p.email;
  return (
    <span
      className={'pjv-av' + (size ? ' pjv-av--' + size : '')}
      {...(p.email ? { 'data-entity': 'person:' + p.email, 'data-label': label } : {})}
      data-pc={c}
      title={label}
    >
      {p.picture ? <img src={p.picture} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = 'none')} /> : null}
      <b>{initials(p.name, p.email)}</b>
    </span>
  );
}
