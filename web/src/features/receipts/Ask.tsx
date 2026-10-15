// "Ask before marking or throwing a file away." The browser's own box is used when it shows one. The question opens under the button instead when
// "Your name" is empty (the name box sits at the top of the page, out of sight of step 3), and when the browser refuses the box: some phone and
// in-app browsers answer Cancel at once without showing anything. (Port of askFirst and askHere in public/js/receipts.js.)
import { useCallback, useEffect, useRef, useState } from 'react';

export interface AskOpts {
  anchor: string;
  question: string;
  yes: string;
  no: string;
  danger?: boolean;
}

interface Open extends AskOpts {
  named: boolean;
  resolve: (ok: boolean) => void;
}

export function useAsk(getWho: () => string, saveWho: (name: string) => void) {
  const [open, setOpen] = useState<Open | null>(null);
  const ref = useRef<Open | null>(null);
  ref.current = open;

  const close = useCallback((ok: boolean) => {
    const cur = ref.current;
    if (!cur) return;
    ref.current = null;
    setOpen(null);
    cur.resolve(ok);
  }, []);

  const askHere = useCallback(
    (o: AskOpts) =>
      new Promise<boolean>((resolve) => {
        if (ref.current) ref.current.resolve(false);
        const next: Open = { ...o, named: Boolean(getWho().trim()), resolve };
        ref.current = next;
        setOpen(next);
      }),
    [getWho]
  );

  /** True when the person said yes. */
  const askFirst = useCallback(
    async (o: AskOpts): Promise<boolean> => {
      if (getWho().trim()) {
        if (!o.question) return true;
        const asked = performance.now();
        if (confirm(o.question)) return true;
        if (performance.now() - asked > 80) return false; // a person pressed Cancel
      }
      return askHere(o);
    },
    [getWho, askHere]
  );

  const box = (anchor: string) =>
    open && open.anchor === anchor ? (
      <AskBox key={anchor} ask={open} onYes={(name) => {
        if (name !== undefined) saveWho(name);
        close(true);
      }} onNo={() => close(false)} />
    ) : null;

  return { askFirst, box };
}

function AskBox({ ask, onYes, onNo }: { ask: Open; onYes: (name?: string) => void; onNo: () => void }) {
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const nameEl = useRef<HTMLInputElement>(null);
  const yesEl = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    root.current?.scrollIntoView({ block: 'nearest' });
    (nameEl.current || yesEl.current)?.focus({ preventScroll: true });
  }, []);
  const yes = () => {
    if (!ask.named) {
      const who = name.trim();
      if (!who) {
        setMsg('Type your name first.');
        nameEl.current?.focus();
        return;
      }
      onYes(who);
      return;
    }
    onYes();
  };
  return (
    <div ref={root} className={`rcp-ask${ask.danger ? ' is-danger' : ''}`} role="group">
      {ask.question ? <p>{ask.question}</p> : null}
      {ask.named ? null : (
        <label className="fnd-who rcp-ask__who">
          <span>Your name</span>
          <input ref={nameEl} list="rcp-staff" autoComplete="off" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && yes()} />
        </label>
      )}
      <p className="rcp-ask__msg" role="alert">
        {msg}
      </p>
      <div className="rcp-ask__row">
        <button ref={yesEl} type="button" className={`req-submit${ask.danger ? ' rcp-danger' : ''}`} onClick={yes}>
          {ask.yes}
        </button>
        <button type="button" className="fnd-textbtn is-quiet" onClick={onNo}>
          {ask.no}
        </button>
      </div>
    </div>
  );
}
