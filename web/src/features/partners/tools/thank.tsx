// Saying thank you for a gift (port of public/js/thank.js): the Thank form (a small popover on a gift row or the partner page), thank many
// at once, and the writes behind them. Writes through POST /api/work/gifts/thank, which saves ordinary batches (Recent and Undo apply),
// then sends each one with /api/work/batches/:id/run. The page that asked hears 'favor:thanked' once the batches are saved, so each
// screen updates its own rows. Used by the partner page, Call prep, Call mode and the Gifts to thank tab.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BodyPortal } from '@/shell/BodyPortal';
import { Ic } from '../record/Ic';
import { fd, money, newReq, rApi, rPost, whole } from '../record/lib';
import { toast } from '../record/toast';
import { drive } from '../record/writes';

export const HOWS: [string, string, string][] = [
  ['call', 'Call', 'phone'],
  ['text', 'Text', 'text'],
  ['email', 'Email', 'mail'],
  ['letter', 'Letter', 'letter'],
  ['card', 'Card', 'card'],
  ['visit', 'Visit', 'meet'],
];
const WORD: Record<string, string> = { call: 'call', text: 'text', email: 'email', letter: 'letter', card: 'card', visit: 'visit' };

export interface ThankItem {
  giftId: string;
  cid: string;
}
export interface ThankOpts {
  how: string;
  outcome: string;
  line?: string;
  followUp?: boolean;
  owner?: string;
  label?: string;
}
export interface ThankResult {
  ok: boolean;
  items: ThankItem[];
  outcome?: string;
  how: string;
  batches: string[];
  left: boolean;
  followUp: boolean;
}

/**
 * Thank the gifts. Resolves to the result, or null when nothing was saved. The toast carries Undo for the batches.
 */
export async function thankGifts(items: ThankItem[], o: ThankOpts): Promise<ThankResult | null> {
  const label = o.label || 'Thank-you saved';
  toast('Saving…', null, false, 'wg');
  let out: any;
  try {
    out = await rPost('/api/work/gifts/thank', { items: items.map((i) => ({ giftId: i.giftId, cid: i.cid })), how: o.how, outcome: o.outcome, line: o.line || '', followUp: !!o.followUp, owner: o.owner || undefined, req: newReq() });
  } catch (e) {
    toast((e as Error).message, null, true, 'wg');
    return null;
  }
  const batches: any[] = out.batches || [];
  if (!batches.length) {
    toast((out.skipped && out.skipped[0] && out.skipped[0].why) || 'Nothing was saved. Those gifts were already thanked.', null, true, 'wg');
    document.dispatchEvent(new CustomEvent('favor:thanked', { detail: { items: [], gone: (out.skipped || []).map((s: any) => s.giftId) } }));
    return null;
  }
  const bids = batches.map((b) => b.id as string);
  const detail = { items: items.filter((i) => batches.some((b) => b.gifts.includes(String(i.giftId)))), outcome: out.outcome, how: o.how, batches: bids, left: !!out.left, followUp: !!o.followUp };
  // Show the result at once; the send follows. If Blackbaud turns something down, the list puts the gift back.
  document.dispatchEvent(new CustomEvent('favor:thanked', { detail }));
  let held = '';
  try {
    for (const b of batches) {
      if (b.run_when !== 'tonight') held = (await drive(b.id)) || held;
      else held = 'tonight';
    }
  } catch (e) {
    toast((e as Error).message + ' It is saved, and Recent can send it again.', bids, true, 'wg');
    return { ok: false, ...detail };
  }
  let bad: string | null = null;
  try {
    const recent = ((await rApi('/api/work/recent')).batches || []) as any[];
    for (const b of recent) if (bids.includes(b.id)) {
      const f = (b.items || []).find((x: any) => x.state === 'failed');
      if (f) bad = f.error || 'Blackbaud turned it down.';
    }
  } catch {
    // the change is saved; the toast still offers Undo
  }
  if (bad) {
    toast(`${bad} Nothing was lost. Recent has Try again.`, bids, true, 'wg');
    document.dispatchEvent(new CustomEvent('favor:thanked-failed', { detail }));
    return { ok: false, ...detail };
  }
  toast(held === 'tonight' ? `${label}. It goes to Blackbaud tonight.` : held ? `${label}. Blackbaud is slow, so the rest goes when it answers.` : label + '.', bids, false, 'wg');
  return { ok: true, ...detail };
}

export interface ThankGift {
  giftId: string;
  cid: string;
  name: string;
  amount: number;
  date: string;
  fund?: string;
  phone?: string | null;
  left?: { date: string; by?: string } | null;
  tasks?: number;
  team?: string;
}

/** The Thank form for one gift, a popover under the button that opened it. owner is the director whose list it is (Support thanking for someone). */
export function ThankPop({ anchor, g, owner, onClose, onDone }: { anchor: HTMLElement; g: ThankGift; owner?: string; onClose: () => void; onDone?: (r: ThankResult) => void }) {
  const [how, setHow] = useState('call');
  const [reach, setReach] = useState('talked');
  const [line, setLine] = useState('');
  const [fu, setFu] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const attempt = how === 'call' && reach === 'left';
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = anchor.getBoundingClientRect();
    const w = Math.min(360, window.innerWidth - 24);
    const h = el.offsetHeight;
    let top = r.bottom + 8;
    if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 8);
    setPos({ left: Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12)), top, width: w });
  }, [anchor, how, reach, g.left, g.tasks]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const away = (ev: MouseEvent) => {
      const path = ev.composedPath ? ev.composedPath() : [];
      if (!path.includes(box.current as EventTarget) && !path.includes(anchor)) onClose();
    };
    const size = () => onClose();
    document.addEventListener('keydown', key, true);
    const t = setTimeout(() => document.addEventListener('click', away), 0);
    window.addEventListener('resize', size);
    const f = setTimeout(() => box.current?.querySelector<HTMLInputElement>('#wg-line')?.focus(), 30);
    return () => {
      document.removeEventListener('keydown', key, true);
      clearTimeout(t);
      clearTimeout(f);
      document.removeEventListener('click', away);
      window.removeEventListener('resize', size);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const save = async () => {
    const left = how === 'call' && reach === 'left';
    onClose();
    const label = left ? `Logged a message for ${g.name}. A reminder comes tomorrow` : `Thanked ${g.name} by ${WORD[how]}`;
    const res = await thankGifts([{ giftId: g.giftId, cid: g.cid }], { how, outcome: left ? 'left' : 'talked', line: line.trim(), followUp: fu, owner, label });
    if (res && onDone) onDone(res);
  };
  return BodyPortal(
    <div ref={box} className="wg-pop" role="dialog" aria-label={'Thank ' + g.name} style={pos ? { width: pos.width, left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0, width: Math.min(360, 600) }}>
      <h4>
        <span>
          Thank {g.name}
          <small>
            {money(g.amount)} on {fd(g.date)} · {g.fund || ''}
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
          You left a message {fd(g.left.date)}
          {g.left.by ? ' (' + g.left.by + ')' : ''}. The gift stays on the list until it is thanked.
        </p>
      ) : null}
      <input id="wg-line" type="text" maxLength={200} placeholder={attempt ? 'Anything to note' : 'What was said'} value={line} onChange={(e) => setLine(e.target.value)} autoComplete="off" />
      <label className="wg-check">
        <input type="checkbox" id="wg-fu" checked={fu} onChange={(e) => setFu(e.target.checked)} /> Follow up in 2 weeks
      </label>
      {g.tasks ? <p className="wg-note">An open thank-you task for this gift closes with it.</p> : null}
      <div className="wg-pop__foot">
        <small>{attempt ? 'Logs the attempt. The gift stays here and a reminder comes tomorrow.' : g.phone ? g.phone : 'No phone on file'}</small>
        <button type="button" className="h-btn h-btn--primary h-btn--sm" onClick={save}>
          {attempt ? 'Save attempt' : 'Save thank-you'}
        </button>
      </div>
    </div>
  );
}

/** Thank many partners at once, in one dialog. */
export function ThankBulk({ gifts, how, owner, onClose, onDone }: { gifts: (ThankGift & { name: string })[]; how: string; owner?: string; onClose: () => void; onDone?: (r: ThankResult) => void }) {
  const total = gifts.reduce((n, g) => n + g.amount, 0);
  const [line, setLine] = useState('');
  const [fu, setFu] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [onClose]);
  const go = async () => {
    onClose();
    const res = await thankGifts(gifts.map((g) => ({ giftId: g.giftId, cid: g.cid })), {
      how,
      outcome: how === 'call' || how === 'visit' || how === 'text' ? 'talked' : 'sent',
      line: line.trim(),
      followUp: fu,
      owner,
      label: `Thanked ${gifts.length} ${gifts.length === 1 ? 'partner' : 'partners'} by ${WORD[how]}`,
    });
    if (res && onDone) onDone(res);
  };
  return BodyPortal(
    <div className="wg-layer">
      <div className="wg-scrim" onClick={onClose} />
      <div className="wg-dlg" role="dialog" aria-modal="true" aria-label={`Thank ${gifts.length} partners`}>
        <div className="wg-dlg__head">
          <div>
            <h2>
              Thank {gifts.length} {gifts.length === 1 ? 'partner' : 'partners'} by {WORD[how]}
            </h2>
            <p>{whole(total)} in gifts. Each partner gets one {WORD[how]} record with the Thanked tag, and any open thank-you task for that gift closes.</p>
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
                  {money(g.amount)} · {fd(g.date)}
                </span>
              </li>
            ))}
            {gifts.length > 8 ? <li className="is-more">and {gifts.length - 8} more</li> : null}
          </ul>
          <label className="wg-lab">
            One line for every record (optional)
            <input type="text" maxLength={200} placeholder="For example: Sent the September thank-you letter" value={line} onChange={(e) => setLine(e.target.value)} autoFocus />
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
            <button type="button" className="h-btn h-btn--primary" onClick={go}>
              <Ic n="check" />
              Thank {gifts.length}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
