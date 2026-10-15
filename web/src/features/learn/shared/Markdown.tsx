import { Fragment } from 'react';
import { parseMarkdown, type Inline } from './parse';

function Inl({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) => {
        if (p.t === 'text') return <Fragment key={i}>{p.s}</Fragment>;
        if (p.t === 'b') return <strong key={i}><Inl parts={p.c} /></strong>;
        if (p.t === 'i') return <em key={i}><Inl parts={p.c} /></em>;
        return (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer">
            <Inl parts={p.c} />
          </a>
        );
      })}
    </>
  );
}

/** A written page's text, drawn as elements. */
export function Markdown({ src }: { src: string }) {
  return (
    <>
      {parseMarkdown(src).map((b, i) => {
        if (b.t === 'h2' || b.t === 'h3') {
          const H = b.t;
          return (
            <H key={i}>
              <Inl parts={b.c} />
            </H>
          );
        }
        if (b.t === 'ul' || b.t === 'ol') {
          const Tag = b.t;
          return (
            <Tag key={i}>
              {b.items.map((it, j) => (
                <li key={j}><Inl parts={it} /></li>
              ))}
            </Tag>
          );
        }
        if (b.t !== 'p') return null;
        return (
          <p key={i}>
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Inl parts={l} />
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}
