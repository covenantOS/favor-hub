// One merged letter as a sheet of paper (the twin of WCLetter.paper in public/js/work-letter.js).
import type { LetterDoc } from './hqty';

export function Paper({ d }: { d: LetterDoc }) {
  return (
    <article className="hq-paper" aria-label="Letter preview">
      <div className="hq-paper__brand">Favor International</div>
      <div className="hq-paper__date">{d.dateLine}</div>
      <div className="hq-paper__addr">
        {d.addressLines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
      <p className="hq-paper__greet">{d.greeting}</p>
      {d.paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      <p>{d.closing}</p>
      <div className="hq-paper__sig" />
      {d.signerName ? <div className="hq-paper__name">{d.signerName}</div> : null}
      {d.signerTitle ? <div className="hq-paper__title">{d.signerTitle}</div> : null}
    </article>
  );
}
