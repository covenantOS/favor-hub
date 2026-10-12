/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState } from 'react';
import { Sheet } from './Sheet';
import { MI } from './util';
import { getApi } from './mailApi';

const esc = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const Empty = ({ t }: { t: string }) => (
  <div className="ml-empty">
    <span>{t}</span>
  </div>
);
const stamp = (d: Date) => d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });

export const sendTimes = (): Array<[string, Date]> => {
  const now = new Date();
  const at = (d: Date | number, h: number) => {
    const x = new Date(d);
    x.setHours(h, 0, 0, 0);
    return x;
  };
  let later = new Date(now.getTime() + 3 * 36e5);
  later.setMinutes(0, 0, 0);
  if (now.getHours() < 15) later = at(now, 18);
  const tom = at(now.getTime() + 864e5, 8);
  const sat = new Date(now);
  sat.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7 || 7));
  const mon = new Date(now);
  mon.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  const list: Array<[string, Date]> = [['Later today', later], ['Tomorrow', tom], ['This weekend', at(sat, 8)], ['Next week', at(mon, 8)]];
  if (later.toDateString() !== now.toDateString()) list.shift();
  return list;
};

export function LaterMenu({ onClose, onPick, say }: { onClose: () => void; onPick: (at: Date, remindDays: number) => void; say: (m: string) => void }) {
  const opts = sendTimes();
  const [remind, setRemind] = useState(true);
  const [pick, setPick] = useState('');
  const go = (at: Date) => {
    if (!at || !isFinite(at.getTime()) || at < new Date()) return say('Pick a time later than now');
    onPick(at, remind ? 3 : 0);
  };
  return (
    <Sheet title="Send later" onClose={onClose}>
      <div className="ml-menu">
        {opts.map((o, k) => (
          <button type="button" className="ml-menu__i" key={k} onClick={() => go(o[1])}>
            <MI n="clock" />
            <span>{o[0]}</span>
            <small>{stamp(o[1])}</small>
          </button>
        ))}
        <div className="ml-menu__pick">
          <label htmlFor="ml-lt-at">Pick a date and time</label>
          <input id="ml-lt-at" type="datetime-local" className="ml-input" value={pick} onChange={(e) => setPick(e.target.value)} />
          <button type="button" className="ml-btn ml-btn--primary" onClick={() => go(new Date(pick))}>
            Schedule
          </button>
        </div>
        <label className="ml-menu__i ml-check">
          <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} />
          <span>Remind me if there is no reply in 3 days</span>
        </label>
      </div>
    </Sheet>
  );
}

export function TemplatesMenu({ onClose, to, bodyText, insert, say }: { onClose: () => void; to: string[]; bodyText: () => string; insert: (html: string) => void; say: (m: string) => void }) {
  const [list, setList] = useState<any[] | null>(null);
  const [name, setName] = useState('');
  const started = useRef(false);
  if (!started.current) {
    started.current = true;
    getApi().templates().then((d: any) => setList(d.templates || [])).catch((e: any) => say(e.message));
  }
  return (
    <Sheet title="Templates" onClose={onClose}>
      {!list ? <Empty t="Loading" /> : (
        <>
          <p className="ml-p">Fields fill from the partner on the To line: {'{first_name}'}, {'{name}'}, {'{last_gift}'}, {'{last_gift_date}'}, {'{total_giving}'}, {'{my_name}'}.</p>
          <div className="ml-menu">
            {list.length ? (
              list.map((t) => (
                <div className="ml-menu__i ml-mrow" key={t.id}>
                  <button
                    type="button"
                    className="ml-linkbtn"
                    onClick={() =>
                      getApi()
                        .fillTemplate(t.body, to)
                        .then((r: any) => {
                          onClose();
                          insert('<div>' + esc(r.text).replace(/\n/g, '<br>') + '</div>');
                        })
                        .catch((e: any) => say(e.message))
                    }
                  >
                    {t.name}
                  </button>
                  <button type="button" className="ml-btn" onClick={() => getApi().dropTemplate(t.id).then(() => setList((l) => (l || []).filter((x) => x.id !== t.id))).catch((e: any) => say(e.message))}>
                    Remove
                  </button>
                </div>
              ))
            ) : (
              <p className="ml-p">No templates yet.</p>
            )}
          </div>
          <form
            className="ml-form"
            onSubmit={(e) => {
              e.preventDefault();
              getApi()
                .saveTemplate(name.trim(), bodyText())
                .then(() => {
                  say('Template saved');
                  onClose();
                })
                .catch((er: any) => say(er.message));
            }}
          >
            <label>
              Save this message as a template
              <input className="ml-input" required maxLength={60} placeholder="Template name" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="ml-sheet__acts">
              <button type="submit" className="ml-btn">
                Save
              </button>
            </div>
          </form>
        </>
      )}
    </Sheet>
  );
}

export function DrivePick({ title, first, onClose, insert }: { title: string; first?: string; onClose: () => void; insert: (html: string) => void }) {
  const [q, setQ] = useState(first || '');
  const [items, setItems] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  const timer = useRef(0);
  const run = (v: string) => {
    clearTimeout(timer.current);
    if (v.trim().length < 2) return setItems(null);
    timer.current = window.setTimeout(() => {
      getApi()
        .drive(v.trim())
        .then((d: any) => (setErr(''), setItems(d.files || [])))
        .catch((e: any) => setErr(e.message));
    }, 220);
  };
  const started = useRef(false);
  if (!started.current && first) {
    started.current = true;
    run(first);
  }
  return (
    <Sheet title={title} onClose={onClose}>
      <input className="ml-input" placeholder="Search the Drive library" aria-label="Search the Drive library" autoComplete="off" value={q} onChange={(e) => (setQ(e.target.value), run(e.target.value))} />
      <div className="ml-pick">
        {err ? <Empty t={err} /> : !items ? <Empty t="Type to search" /> : !items.length ? <Empty t="Nothing found" /> : items.map((f, i) => (
          <button
            type="button"
            className="ml-menu__i"
            key={i}
            onClick={() => {
              onClose();
              insert('<a href="' + esc(f.url) + '">' + esc(f.name) + '</a>&nbsp;');
            }}
          >
            <MI n="drive" />
            <span>{f.name}</span>
            <small>{f.path || ''}</small>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export function ClipPick({ onClose, insert, say }: { onClose: () => void; insert: (html: string) => void; say: (m: string) => void }) {
  const [items, setItems] = useState<any[] | null>(null);
  const started = useRef(false);
  if (!started.current) {
    started.current = true;
    getApi().clips().then((d: any) => setItems(d.clips || [])).catch((e: any) => say(e.message));
  }
  return (
    <Sheet title="Link a clip" onClose={onClose}>
      <div className="ml-pick">
        {!items ? <Empty t="Loading your clips" /> : !items.length ? <Empty t="No clips yet" /> : items.map((c, i) => (
          <button
            type="button"
            className="ml-menu__i"
            key={i}
            onClick={() => {
              onClose();
              insert('<a href="' + esc(c.url) + '">' + esc(c.title) + '</a>&nbsp;');
            }}
          >
            <MI n="rec" />
            <span>{c.title}</span>
            <small>{[c.duration, c.when].filter(Boolean).join(' · ')}</small>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
