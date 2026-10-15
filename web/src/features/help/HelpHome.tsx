// Help home: search, the tour, topics, and "For your work". Articles come from src/content/help at build time.
import docs from 'virtual:help-meta';
import { TOPICS } from '@hub/data/help-topics';
import { NavLink } from '@/shell/NavLink';
import { Gate, visibleFor, type Tags } from './tags';
import { SearchBox } from './Search';
import './css';

const ICON: Record<string, string> = {
  start: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  work: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
  partners: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  numbers: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  ask: '<path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z"/>',
  blackbaud: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/>',
  help: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8"/><path d="M8 12h5"/>',
};
const Ico = ({ d }: { d: string }) => <svg className="h-i" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />;

const STARTERS = ['getting-started', 'ask-favor', 'feedback'];

function ForYou({ tags }: { tags: Tags | null }) {
  if (!tags) {
    // The same six cards the page held space with before.
    return (
      <section className="hd-foryou" id="hd-foryou">
        <div className="h-section">
          <h2>For your work</h2>
        </div>
        <div className="hd-cards" id="hd-foryou-list" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-card hd-card hd-card--skel h-skel" aria-hidden="true" />
          ))}
        </div>
      </section>
    );
  }
  const picks = docs.filter((d) => visibleFor(d.for, tags) && !d.for.includes('all') && d.for.some((x) => tags.has(x)));
  const starters = STARTERS.map((id) => docs.find((d) => d.id === id)).filter((d): d is NonNullable<typeof d> => !!d);
  const list = [...new Map([...picks, ...starters].map((d) => [d.id, d])).values()].slice(0, 6);
  if (!list.length) return null;
  return (
    <section className="hd-foryou" id="hd-foryou">
      <div className="h-section">
        <h2>For your work</h2>
      </div>
      <div className="hd-cards" id="hd-foryou-list">
        {list.map((d) => (
          <NavLink key={d.id} className="h-card hd-card" href={`/help/${d.id}/`}>
            <b>{d.title}</b>
            <span>{d.summary}</span>
          </NavLink>
        ))}
      </div>
    </section>
  );
}

function Topics({ tags }: { tags: Tags | null }) {
  return (
    <div className="hd-topics">
      {TOPICS.map((t) => (
        <section className="h-card hd-topic" key={t.id}>
          <div className="hd-topic__head">
            <span className="hd-topic__icon">
              <Ico d={ICON[t.id] || ''} />
            </span>
            <div>
              <h3>{t.label}</h3>
            </div>
          </div>
          <ul>
            {docs
              .filter((d) => d.topic === t.id && visibleFor(d.for, tags))
              .map((d) => (
                <li key={d.id} data-for={d.for.join(' ')}>
                  <NavLink href={`/help/${d.id}/`} data-doc={d.id} data-summary={d.summary}>
                    {d.title}
                  </NavLink>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function HelpHome() {
  return (
    <div className="hd-home">
      <section className="hd-hero">
        <h1 className="sr-only">Help docs</h1>
        <SearchBox />
        <div className="hd-hero__acts">
          <button type="button" className="h-btn h-btn--primary" data-tour-start="">
            <Ico d='<path d="M5 3.5 19 12l-6.5 1.4L10 20z"/>' />
            Tours and what is new
          </button>
          <button type="button" className="h-btn h-btn--ghost" data-feedback="help" data-title="What's missing from the help docs?">
            <Ico d='<path d="M4 5h16v11H9l-5 4z"/>' />
            Can't find it? Tell us
          </button>
        </div>
      </section>
      <Gate>{(tags) => <ForYou tags={tags} />}</Gate>
      <div className="h-section">
        <h2>Topics</h2>
      </div>
      <Gate>{(tags) => <Topics tags={tags} />}</Gate>
    </div>
  );
}
