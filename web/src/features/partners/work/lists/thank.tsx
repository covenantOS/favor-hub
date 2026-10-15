// Saying thank you for a gift: the Thank form (a small popover on a gift row), thank many at once, and the save-send-check run behind both.
// Ported from public/js/thank.js. Writes through POST /api/work/gifts/thank, which saves ordinary batches (Recent and Undo apply), then
// sends each one with /api/work/batches/:id/run. The page that asked hears favor:thanked once the batches are saved, so each list
// updates its own rows; the partner drawer and the call-prep brief (classic scripts) hear the same event.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BodyPortal } from '@/shell/BodyPortal';
import { WgDialog } from './Dlg';
import { Ic } from './icons';
import { driveBatch, failureOf, sentToast, showToast } from './toast';
import { dateWords, moneyExact, moneyWhole, reqId, workPost } from './core';

export interface ThankGift {
  giftId: string;
  cid: string;
  name: string;
  amount: number;
  date: string;
  fund?: string;
  phone?: string | null;
  team?: string;
  left?: { date: string; by?: string } | null;
  tasks?: number;
}
export type How = 'call' | 'text' | 'email' | 'letter' | 'card' | 'visit';
export const HOWS: [How, string, string][] = [
  ['call', 'Call', 'phone'],
  ['text', 'Text', 'text'],
  ['email', 'Email', 'mail'],
  ['letter', 'Letter', 'letter'],
  ['card', 'Card', 'card'],
  ['visit', 'Visit', 'meet'],
];
const WORD: Record<string, string> = { call: 'call', text: 'text', email: 'email', letter: 'letter', card: 'card', visit: 'visit' };

export const THANKED_EVENT = 'favor:thanked';
export interface ThankedDetail {
  items: { giftId: string; cid: string }[];
  gone?: string[];
  outcome?: string;
  how?: string;
  batches?: string[];
  left?: boolean;
  followUp?: boolean;
}

export interface ThankResult extends ThankedDetail {
  ok: boolean;
}

/**
 * Thank the gifts. Resolves to the items saved, or null when nothing was saved. Shows the result at once (the event), then sends; if
 * Blackbaud turns something down, the list is told (favor:thanked-failed) and puts the gift back.
 */
export async function thankGifts(items: { giftId: string; cid: string }[], o: { how: string; outcome: string; line?: string; followUp?: boolean; owner?: string; label?: string; today: string }): Promise<ThankResult | null> {
  const label = o.label || 'Thank-you saved';
  showToast('Saving…');
  let out: any;
  try {
    out = await workPost('/api/work/gifts/thank', { items: items.map((i) => ({ giftId: i.giftId, cid: i.cid })), how: o.how, outcome: o.outcome, line: o.line || '', followUp: !!o.followUp, owner: o.owner || undefined, req: reqId() });
  } catch (e) {
    showToast((e as Error).message, { bad: true });
    return null;
  }
  const batches: any[] = out.batches || [];
  if (!batches.length) {
    showToast((out.skipped && out.skipped[0] && out.skipped[0].why) || 'Nothing was saved. Those gifts were already thanked.', { bad: true });
    document.dispatchEvent(new CustomEvent(THANKED_EVENT, { detail: { items: [], gone: (out.skipped || []).map((s: any) => s.giftId) } }));
    return null;
  }
  const bids: string[] = batches.map((b) => b.id);
  const detail: ThankedDetail = { items: items.filter((i) => batches.some((b) => (b.gifts || []).includes(String(i.giftId)))), outcome: out.outcome, how: o.how, batches: bids, left: !!out.left, followUp: !!o.followUp };
  // Show the result at once; the send follows.
  document.dispatchEvent(new CustomEvent(THANKED_EVENT, { detail }));
  let held = '';
  try {
    for (const b of batches) {
      if (b.run_when !== 'tonight') held = (await driveBatch(b.id)) || held;
      else held = 'tonight';
    }
  } catch (e) {
    showToast((e as Error).message + ' It is saved, and Recent can send it again.', { undo: { batches: bids }, bad: true });
    return { ok: false, ...detail };
  }
  const bad = await failureOf(bids);
  if (bad) {
    showToast(`${bad} Nothing was lost. Recent has Try again.`, { undo: { batches: bids }, bad: true });
    document.dispatchEvent(new CustomEvent('favor:thanked-failed', { detail }));
    return { ok: false, ...detail };
  }
  sentToast(label, held, bids);
  return { ok: true, ...detail };
}

/* ------------------------------------------------------------------ the Thank form */

export function ThankPop({ anchor, gift, owner, today, onClose, onDone }: { anchor: HTMLElement; gift: ThankGift; owner?: string; today: string; onClose: () => void; onDone?: (r: ThankResult) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [how, setHow] = useState<How>('call');
  const [reach, setReach] = useState<'talked' | 'left'>('talked');
  const [line, setLine] = useState('');
  const [fu, setFu] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const attempt = how === 'call' && reach === 'left';
  const g = gift;

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const width = Math.min(360, innerWidth - 24);
    const left = Math.max(12, Math.min(r.right - width, innerWidth - width - 12));
    const h = box.current?.offsetHeight || 0;
    let top = r.bottom + 8;
    if (top + h > innerHeight - 12) top = Math.max(12, r.top - h - 8);
    setPos({ left, top, width });
  }, [anchor, how, reach]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', esc, true);
    const off = (ev: MouseEvent) => {
      const path = ev.composedPath ? ev.composedPath() : [];
      if (box.current && !path.includes(box.current) && !path.includes(anchor)) onClose();
    };
    const t = setTimeout(() => document.addEventListener('click', off), 0);
    const rs = () => onClose();
    addEventListener('resize', rs);
    const f = setTimeout(() => box.current?.querySelector<HTMLInputElement>('#wg-line')?.focus(), 30);
    return () => {
      document.removeEventListener('keydown', esc, true);
      clearTimeout(t);
      clearTimeout(f);
      document.removeEventListener('click', off);
      removeEventListener('resize', rs);
    };
  }, [anchor, onClose]);

  const save = async () => {
    const left = how === 'call' && reach === 'left';
    onClose();
    const label = left ? `Logged a message for ${g.name}. A reminder comes tomorrow` : `Thanked ${g.name} by ${WORD[how]}`;
    const res = await thankGifts([{ giftId: g.giftId, cid: g.cid }], { how, outcome: left ? 'left' : 'talked', line: line.trim(), followUp: fu, owner, label, today });
    if (res && onDone) onDone(res);
  };

  return BodyPortal(
    <div ref={box} className="wg-pop" role="dialog" aria-label={'Thank ' + g.name} style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { visibility: 'hidden', left: 0, top: 0 }}>
      <h4>
        <span>
          Thank {g.name}
          <small>
            {moneyExact(g.amount)} on {dateWords(g.date, today)} · {g.fund || ''}
          </small>
        </span>
        <button type="button" className="pp-iconbtn" aria-label="Close" onClick={onClose}>
          <Ic n="x" />
        </button>
      </h4>
      <div className="pp-seg wg-how" role="group" aria-label="How">
        {HOWS.filter(([k]) => g.team !== 'pc' || !['text', 'visit'].includes(k)).map(([k, l, i]) => (
          <button
            key={k}
            type="button"
            className={how === k ? 'is-on' : ''}
            onClick={() => {
              setHow(k);
              if (k !== 'call') setReach('talked');
            }}
          >
            <Ic n={i} />
            {l}
          </button>
        ))}
      </div>
      {how === 'call' ? (
        <div className="pp-seg" role="group" aria-label="Result">
          <button type="button" className={reach === 'talked' ? 'is-on' : ''} onClick={() => setReach('talked')}>
            Talked
          </button>
          <button type="button" className={reach === 'left' ? 'is-on' : ''} onClick={() => setReach('left')}>
            Left a message
          </button>
        </div>
      ) : null}
      {g.left ? (
        <p className="wg-note">
          You left a message {dateWords(g.left.date, today)}
          {g.left.by ? ' (' + g.left.by + ')' : ''}. The gift stays on the list until it is thanked.
        </p>
      ) : null}
      <input
        type="text"
        id="wg-line"
        maxLength={200}
        placeholder={attempt ? 'Anything to note' : 'What was said'}
        value={line}
        autoComplete="off"
        onChange={(e) => setLine(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void save();
          }
        }}
      />
      <label className="wg-check">
        <input type="checkbox" id="wg-fu" checked={fu} onChange={(e) => setFu(e.target.checked)} /> Follow up in 2 weeks
      </label>
      {g.tasks ? <p className="wg-note">An open thank-you task for this gift closes with it.</p> : null}
      <div className="wg-pop__foot">
        <small>{attempt ? 'Logs the attempt. The gift stays here and a reminder comes tomorrow.' : g.phone ? g.phone : 'No phone on file'}</small>
        <button type="button" className="h-btn h-btn--primary h-btn--sm" onClick={() => void save()}>
          {attempt ? 'Save attempt' : 'Save thank-you'}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ thank many */

export function BulkThankDialog({ gifts, how, owner, today, onClose, onDone }: { gifts: ThankGift[]; how: How; owner?: string; today: string; onClose: () => void; onDone?: (r: ThankResult) => void }) {
  const [line, setLine] = useState('');
  const [fu, setFu] = useState(false);
  const total = gifts.reduce((n, g) => n + g.amount, 0);
  const go = async () => {
    onClose();
    const res = await thankGifts(
      gifts.map((g) => ({ giftId: g.giftId, cid: g.cid })),
      { how, outcome: how === 'call' || how === 'visit' || how === 'text' ? 'talked' : 'sent', line: line.trim(), followUp: fu, owner, label: `Thanked ${gifts.length} ${gifts.length === 1 ? 'partner' : 'partners'} by ${WORD[how]}`, today }
    );
    if (res && onDone) onDone(res);
  };
  return (
    <WgDialog onClose={onClose} label={`Thank ${gifts.length} partners`}>
      <div className="wg-dlg__head">
        <div>
          <h2>
            Thank {gifts.length} {gifts.length === 1 ? 'partner' : 'partners'} by {WORD[how]}
          </h2>
          <p>{moneyWhole(total)} in gifts. Each partner gets one {WORD[how]} record with the Thanked tag, and any open thank-you task for that gift closes.</p>
        </div>
        <button type="button" className="pp-iconbtn" aria-label="Close" onClick={onClose}>
          <Ic n="x" />
        </button>
      </div>
      <div className="wg-dlg__body">
        <ul className="wg-bulklist">
          {gifts.slice(0, 8).map((g) => (
            <li key={g.giftId + ':' + g.cid}>
              <b>{g.name}</b>
              <span>
                {moneyExact(g.amount)} · {dateWords(g.date, today)}
              </span>
            </li>
          ))}
          {gifts.length > 8 ? <li className="is-more">and {gifts.length - 8} more</li> : null}
        </ul>
        <label className="wg-lab">
          One line for every record (optional)
          <input type="text" id="wg-bline" maxLength={200} placeholder="For example: Sent the September thank-you letter" value={line} autoFocus onChange={(e) => setLine(e.target.value)} />
        </label>
        <label className="wg-check">
          <input type="checkbox" checked={fu} onChange={(e) => setFu(e.target.checked)} /> Follow up in 2 weeks
        </label>
      </div>
      <div className="wg-dlg__foot">
        <small>Undo stays for 24 hours.</small>
        <span>
          <button type="button" className="h-btn h-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="h-btn h-btn--primary" onClick={() => void go()}>
            <Ic n="check" />
            Thank {gifts.length}
          </button>
        </span>
      </div>
    </WgDialog>
  );
}
