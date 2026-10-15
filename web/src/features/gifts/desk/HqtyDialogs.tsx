// The dialogs and the row menu of Gifts > Thank-you letters: the letter preview, the month's wording editor, the Cannot send reasons and the
// small menu behind the three dots. Same markup and words as public/js/work-hqty.js.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BodyPortal } from '@/shell/BodyPortal';
import { WgDialog } from '../../partners/work/lists/Dlg';
import { Ic } from '../../partners/work/lists/icons';
import { workPost } from '../../partners/work/lists/core';
import { fd, money } from '../../partners/record/lib';
import { Paper } from './Paper';
import { blocked, monthLabel, type HqtyData, type HqtyRow, type LetterDoc } from './hqty';

const Head = ({ title, sub, onClose }: { title: string; sub: string; onClose: () => void }) => (
  <div className="wg-dlg__head">
    <div>
      <h2>{title}</h2>
      <p>{sub}</p>
    </div>
    <button type="button" className="pp-iconbtn" onClick={onClose} aria-label="Close">
      <Ic n="x" />
    </button>
  </div>
);

/** A merged letter read from the server: paper when it came, the server's words when it did not. */
function usePaper(giftId: string | undefined, text?: string, wait = 0) {
  const [doc, setDoc] = useState<LetterDoc | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!giftId) return;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const out = await workPost('/api/work/hqty/pdf', text === undefined ? { ids: [giftId] } : { ids: [giftId], text });
        if (live) {
          setDoc(out.letters[0]);
          setErr('');
        }
      } catch (e) {
        if (live) setErr((e as Error).message);
      }
    }, wait);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [giftId, text, wait]);
  return { doc, err };
}

function PaperBox({ doc, err }: { doc: LetterDoc | null; err: string }) {
  return <div className="hq-sheet" id="hq-pv">{err ? <div className="hq-note is-bad">{err}</div> : doc ? <Paper d={doc} /> : <div className="hq-skel" />}</div>;
}

export function PreviewDialog({ row, d, onClose, onPrint }: { row: HqtyRow; d: HqtyData; onClose: () => void; onPrint: (key: string) => void }) {
  const { doc, err } = usePaper(row.giftId);
  const live = row.state === 'write' || row.state === 'printed' || row.state === 'signed';
  return (
    <WgDialog onClose={onClose} label={'Letter for ' + row.partner.name}>
      <Head title={row.partner.name} sub={`${money(row.amount)} on ${fd(row.date)} · ${row.fund || 'No fund on file'} · ${monthLabel(row.month, d.today)} letter`} onClose={onClose} />
      <div className="hq-previewbody">
        <PaperBox doc={doc} err={err} />
      </div>
      <div className="wg-dlg__foot">
        <small>{row.state === 'write' ? 'Printing marks the gift Printed.' : 'The letter as it prints.'}</small>
        <span>
          <button type="button" className="h-btn h-btn--ghost" onClick={onClose}>
            Close
          </button>
          {live ? (
            <button type="button" className="h-btn h-btn--primary" disabled={blocked(row)} onClick={() => onPrint(row.key)}>
              <Ic n="print" />
              Print
            </button>
          ) : null}
        </span>
      </div>
    </WgDialog>
  );
}

export function TextDialog({ d, sample, onClose, onSaved }: { d: HqtyData; sample: HqtyRow | undefined; onClose: () => void; onSaved: (mo: string) => void }) {
  const mo = monthLabel(d.today.slice(0, 7), d.today);
  const [body, setBody] = useState(d.text.body);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const { doc, err } = usePaper(sample?.giftId, body, 300);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await workPost('/api/work/hqty/text', { month: d.text.month, body });
      onSaved(mo);
    } catch (e) {
      setBusy(false);
      setMsg((e as Error).message);
    }
  };
  return (
    <WgDialog onClose={onClose} wide label={mo + ' letter'}>
      <Head title={mo + ' letter'} sub={`One text for every ${mo} gift. Blank lines start a new paragraph.`} onClose={onClose} />
      <div className="hq-compose">
        <div className="hq-compose__form">
          <label className="wg-lab" htmlFor="hq-body">
            The {mo} letter, used for every gift this month
          </label>
          <textarea id="hq-body" rows={12} maxLength={2500} value={body} onChange={(e) => setBody(e.target.value)} />
          <p className="hq-fields">Fields: {'{amount} {fund} {date}'}</p>
          <button type="button" className="hq-link" onClick={() => setBody(d.text.defaultBody)}>
            Use the starting text
          </button>
          {msg ? <p className="hq-note is-bad">{msg}</p> : null}
        </div>
        <div className="hq-compose__page">
          {sample ? (
            <PaperBox doc={doc} err={err} />
          ) : (
            <div className="hq-sheet" id="hq-pv">
              <div className="hq-skel" />
            </div>
          )}
        </div>
      </div>
      <div className="wg-dlg__foot">
        <small>
          {sample ? 'The page shows ' + sample.partner.name + '.' : ''} Letters already printed keep the text they printed with.
        </small>
        <span>
          <button type="button" className="h-btn h-btn--ghost" onClick={onClose}>
            Close
          </button>
          <button type="button" className="h-btn h-btn--primary" disabled={busy} onClick={save}>
            Save the {mo} letter
          </button>
        </span>
      </div>
    </WgDialog>
  );
}

export function CannotDialog({ rows, whys, onClose, onGo }: { rows: HqtyRow[]; whys: string[]; onClose: () => void; onGo: (why: string) => void }) {
  const [why, setWhy] = useState(whys[0] || '');
  return (
    <WgDialog onClose={onClose} label="Cannot send">
      <Head title={'Cannot send ' + (rows.length === 1 ? rows[0].partner.name : rows.length + ' letters')} sub="Pick the reason. The gift leaves To write and the reason stays on the row." onClose={onClose} />
      <div className="wg-dlg__body">
        <div className="hq-whys" role="radiogroup" aria-label="Reason">
          {whys.map((w) => (
            <label className="hq-why" key={w}>
              <input type="radio" name="hq-why" value={w} checked={why === w} onChange={() => setWhy(w)} />
              <span>{w}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="wg-dlg__foot">
        <small />
        <span>
          <button type="button" className="h-btn h-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="h-btn h-btn--primary" onClick={() => onGo(why)}>
            Mark Cannot send
          </button>
        </span>
      </div>
    </WgDialog>
  );
}

function MenuBox({ row, anchor, onPick, onClose }: { row: HqtyRow; anchor: HTMLElement; onPick: (k: string) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const items: [string, string][] = [];
  if (row.state === 'printed' || row.state === 'signed') items.push(['print', 'Print again']);
  if (row.state !== 'cannot') items.push(['cannot', 'Cannot send']);
  if (row.source === 'hub' && row.state !== 'write' && row.state !== 'mailed') items.push(['reset', 'Put back to To write']);
  useLayoutEffect(() => {
    const m = box.current;
    if (!m) return;
    const b = anchor.getBoundingClientRect();
    const w = m.offsetWidth;
    m.style.left = Math.max(8, Math.min(b.right - w, innerWidth - w - 8)) + 'px';
    const h = m.offsetHeight;
    m.style.top = (b.bottom + h + 12 > innerHeight ? Math.max(8, b.top - h - 6) : b.bottom + 6) + 'px';
    m.querySelector<HTMLElement>('button')?.focus();
  }, [anchor]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.hq-menu') && !t.closest('[data-hq-menu]')) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('click', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('click', down);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return (
    <div className="hq-menu" role="menu" ref={box}>
      {items.map(([k, l]) => (
        <button type="button" role="menuitem" key={k} onClick={() => onPick(k)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** The menu behind a row's three dots (a body-level box under the button, flipped above it near the foot of the screen). */
export function RowMenu(p: { row: HqtyRow; anchor: HTMLElement; onPick: (k: string) => void; onClose: () => void }) {
  return BodyPortal(<MenuBox {...p} />);
}
