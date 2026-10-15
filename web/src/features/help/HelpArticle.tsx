// One help article: the topic list on the left, the article, "Was this helpful?" and the page's own contents on the right.
// The article's HTML is rendered at build time from src/content/help (vite-content.ts), so no Markdown code ships to the browser.
import { useState, type MouseEvent } from 'react';
import docs, { type HelpDoc } from 'virtual:help-meta';
import { TOPICS } from '@hub/data/help-topics';
import { NavLink } from '@/shell/NavLink';
import { RelBadge } from '@/shell/RelBadge';
import { HelpSide } from './HelpSide';
import { Gate, visibleFor } from './tags';
import { useGo } from './nav';
import './css';

export interface ArticleData {
  html: string;
  toc: Array<{ slug: string; text: string }>;
  meta: HelpDoc;
}

const cue = (n: string) => document.dispatchEvent(new CustomEvent('favor:cue', { detail: n }));

type RateState = 'ask' | 'thanks' | 'why' | 'sent';

function Rate({ what }: { what: string }) {
  const [state, setState] = useState<RateState>('ask');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const send = (rating: string, comment: string) =>
    fetch('/api/feedback', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: what.startsWith('video:') ? 'video' : 'help', rating, comment, page: location.pathname }),
    });
  return (
    <div className="hd-rate" data-rate={what}>
      {state === 'ask' && (
        <>
          <span>Was this helpful?</span>
          <button
            type="button"
            className="h-btn h-btn--ghost h-btn--sm"
            data-rate-v="helpful"
            onClick={() => {
              setState('thanks');
              cue('droplet');
              send('helpful', '').catch(() => undefined);
            }}
          >
            Yes
          </button>
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-rate-v="not-helpful" onClick={() => setState('why')}>
            Not really
          </button>
        </>
      )}
      {state === 'thanks' && <span>Thanks. Glad it helped.</span>}
      {state === 'sent' && <span>Thanks. Will reads every note and fixes the article.</span>}
      {state === 'why' && (
        <form
          className="hd-why"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr(false);
            try {
              const r = await send('not-helpful', text.trim());
              if (!r.ok) throw new Error('not sent');
              setState('sent');
              cue('success');
            } catch {
              setBusy(false);
              setErr(true);
            }
          }}
        >
          <label htmlFor="hd-why">What was missing or unclear?</label>
          <textarea
            id="hd-why"
            rows={3}
            maxLength={1200}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="A step that's missing, a word that doesn't match the screen, a question it didn't answer"
          />
          <div>
            <button type="submit" className="h-btn h-btn--primary h-btn--sm" disabled={busy}>
              Send
            </button>
          </div>
          {err && <p className="hd-err">Did not send. Try again.</p>}
        </form>
      )}
    </div>
  );
}

export function HelpArticle({ data }: { data: ArticleData }) {
  const { html, toc, meta: doc } = data;
  const go = useGo();
  const topic = TOPICS.find((t) => t.id === doc.topic);
  const related = doc.related.map((r) => docs.find((d) => d.id === r)).filter((d): d is HelpDoc => !!d);
  const updated = new Date(doc.updated + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  // A link inside the article to another page of the web app moves inside the app, as the links around it do.
  const onBody = (e: MouseEvent<HTMLElement>) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href') || '';
    if (!a || a.target || !href.startsWith('/') || href.startsWith('//') || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(href);
  };
  return (
    <Gate>
      {(tags) => {
        const show = visibleFor(doc.for, tags);
        return (
          <div className="hd-wrap" data-for={doc.for.join(' ')} hidden={!show}>
            <HelpSide current={doc.id} />
            <article className="hd-article">
              <div className="hd-kicker">
                <NavLink href="/help/">Help</NavLink>
                <span aria-hidden="true">/</span>
                {topic?.label}
              </div>
              <h1>
                {doc.title}
                <RelBadge k={`help:${doc.id}`} />
              </h1>
              <p className="hd-lede">{doc.summary}</p>
              {doc.tool && (
                <NavLink className="h-btn h-btn--ghost h-btn--sm hd-tool" href={doc.tool}>
                  {doc.toolLabel || 'Open it'}
                  <svg className="h-i" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 12h14" />
                    <path d="m13 6 6 6-6 6" />
                  </svg>
                </NavLink>
              )}
              <div className="hd-body" onClick={onBody} dangerouslySetInnerHTML={{ __html: html }} />
              {related.length > 0 && (
                <aside className="hd-related">
                  <b>Related</b>
                  <div>
                    {related.map((r) => (
                      <NavLink key={r.id} href={`/help/${r.id}/`}>
                        {r.title}
                        <span>{r.summary}</span>
                      </NavLink>
                    ))}
                  </div>
                </aside>
              )}
              <Rate what={doc.id} />
              <p className="hd-updated">Updated {updated}</p>
            </article>
            {toc.length > 1 && (
              <nav className="hd-toc" aria-label="On this page">
                <b>On this page</b>
                {toc.map((h) => (
                  <a key={h.slug} href={`#${h.slug}`}>
                    {h.text}
                  </a>
                ))}
              </nav>
            )}
          </div>
        );
      }}
    </Gate>
  );
}
