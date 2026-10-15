// The help docs' topic list, beside every article.
import docs from 'virtual:help-meta';
import { TOPICS } from '@hub/data/help-topics';
import { NavLink } from '@/shell/NavLink';
import { Gate, visibleFor, type Tags } from './tags';

function Side({ current, tags }: { current: string; tags: Tags | null }) {
  return (
    <nav className="hd-side" aria-label="Help topics">
      <NavLink className={`hd-side__home${current === 'home' ? ' is-on' : ''}`} href="/help/">
        Help home
      </NavLink>
      {TOPICS.map((t) => (
        <div className="hd-side__group" key={t.id}>
          <div className="hd-side__label">{t.label}</div>
          {docs
            .filter((d) => d.topic === t.id && visibleFor(d.for, tags))
            .map((d) => (
              <NavLink key={d.id} href={`/help/${d.id}/`} className={d.id === current ? 'is-on' : undefined} aria-current={d.id === current ? 'page' : undefined} data-for={d.for.join(' ')}>
                {d.title}
              </NavLink>
            ))}
        </div>
      ))}
    </nav>
  );
}

export function HelpSide({ current = '' }: { current?: string }) {
  return <Gate>{(tags) => <Side current={current} tags={tags} />}</Gate>;
}
