// The forms above the timeline: Log a contact, Add a task, Add a note (port of composer() and noteComposer() in public/js/partner.js).
import { useEffect, useRef, useState } from 'react';
import { Ic } from './Ic';
import { CommBanner } from './Prefs';
import { holderOf, plusDays, todayEt, type Partner } from './lib';
import type { SaveForm, ViewState } from './types';
import { TOPICS } from './lib';

const KINDS: [string, string, string][] = [
  ['Phone call', 'Call', 'phone'],
  ['Email', 'Email', 'mail'],
  ['Meeting', 'Meeting', 'meet'],
  ['Mailing', 'Mailing', 'letter'],
  ['Task/Other', 'Task', 'task'],
];

export function Composer({ kind, p, prefill, codes, onClose, onSave }: { kind: string; p: Partner; prefill: ViewState['prefill']; codes: any; onClose: () => void; onSave: (f: SaveForm) => void }) {
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => first.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [kind]);
  return kind === 'note' ? <NoteForm onClose={onClose} onSave={onSave} first={first} /> : <ContactTaskForm kind={kind} p={p} prefill={prefill} codes={codes} onClose={onClose} onSave={onSave} first={first} />;
}

function NoteForm({ onClose, onSave, first }: { onClose: () => void; onSave: (f: SaveForm) => void; first: React.RefObject<HTMLInputElement | null> }) {
  const [topic, setTopic] = useState('General');
  return (
    <form
      className="pp-compose"
      data-pp-save="note"
      onSubmit={(e) => {
        e.preventDefault();
        const f = e.currentTarget.elements as unknown as Record<string, HTMLInputElement>;
        const what = f.what.value.trim();
        if (!what) return;
        onSave({ what, text: f.text ? f.text.value : '', topic, instruction: !!(f.instruction && f.instruction.checked) });
      }}
    >
      <div className="pp-compose__top">
        <b>Add a note</b>
        <button type="button" className="pp-iconbtn" aria-label="Cancel" onClick={onClose}>
          <Ic n="x" />
        </button>
      </div>
      <div className="pp-seg" role="group" aria-label="Topic">
        {TOPICS.map((t) => (
          <button key={t} type="button" className={t === topic ? 'is-on' : ''} aria-pressed={t === topic} onClick={() => setTopic(t)}>
            {t}
          </button>
        ))}
      </div>
      <label className="pp-lab">
        Summary
        <input ref={first} type="text" name="what" maxLength={200} required />
      </label>
      <label className="pp-lab">
        The note
        <textarea name="text" />
      </label>
      <label className="pp-chk">
        <input type="checkbox" name="instruction" />
        Show at the top as an instruction
      </label>
      <div className="pp-compose__foot">
        <small>Note on the partner record</small>
        <button type="submit" className="h-btn h-btn--primary h-btn--sm">
          Save note
        </button>
      </div>
    </form>
  );
}

function ContactTaskForm({ kind, p, prefill, codes, onClose, onSave, first }: { kind: string; p: Partner; prefill: ViewState['prefill']; codes: any; onClose: () => void; onSave: (f: SaveForm) => void; first: React.RefObject<HTMLInputElement | null> }) {
  const pf = kind === 'contact' && prefill ? prefill : null;
  const title = pf ? 'Add to contact log' : ({ contact: 'Log a contact', task: 'Add a task' } as Record<string, string>)[kind];
  const [pick, setPick] = useState(kind === 'task' ? 'Task/Other' : pf && KINDS.some(([v]) => v === pf.type) ? (pf.type as string) : 'Phone call');
  const [tags, setTags] = useState<Set<string>>(new Set());
  const holders = holderOf(p);
  const me = codes && codes.me && codes.me.fid ? codes.me : null;
  const who = holders[0] ? holders[0].name : me ? me.name : '';
  const defaultDate = kind === 'task' ? plusDays(7) : pf && pf.date && /^\d{4}-\d{2}-\d{2}$/.test(pf.date) ? pf.date : todayEt();
  return (
    <form
      className="pp-compose"
      data-pp-save={kind}
      onSubmit={(e) => {
        e.preventDefault();
        const f = e.currentTarget.elements as unknown as Record<string, HTMLInputElement>;
        const what = f.what.value.trim();
        if (!what) return;
        onSave({ what, when: f.when ? f.when.value : todayEt(), kind: pick, tags: [...tags] });
      }}
    >
      <div className="pp-compose__top">
        <b>{title}</b>
        <button type="button" className="pp-iconbtn" aria-label="Cancel" onClick={onClose}>
          <Ic n="x" />
        </button>
      </div>
      {pf ? <p className="pp-from">Filled in from the timeline: {pf.from || 'a mention'}. It goes in the contact log when you press Save.</p> : null}
      <div className="pp-seg">
        {KINDS.map(([v, l, i]) => (
          <button key={v} type="button" className={v === pick ? 'is-on' : ''} onClick={() => setPick(v)}>
            <Ic n={i} />
            {l}
          </button>
        ))}
      </div>
      {kind === 'contact' ? <CommBanner p={p} kind={pick} /> : null}
      <label className="pp-lab">
        {kind === 'task' ? 'What to do' : 'What happened'}
        <input ref={first} type="text" name="what" maxLength={255} required defaultValue={pf ? pf.summary : ''} />
      </label>
      <div className="pp-compose__row">
        <label className="pp-lab">
          {kind === 'task' ? 'Due' : 'Date'}
          <input type="date" name="when" defaultValue={defaultDate} />
        </label>
        {kind === 'contact' ? (
          <div className="pp-seg pp-seg--tags">
            {['Thanked', 'Stewardship', 'Scheduling'].map((t) => (
              <button
                key={t}
                type="button"
                className={tags.has(t) ? 'is-on' : ''}
                onClick={() => {
                  const s = new Set(tags);
                  if (s.has(t)) s.delete(t);
                  else s.add(t);
                  setTags(s);
                }}
              >
                {t}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
      </div>
      <div className="pp-compose__foot">
        <small>{who ? 'For ' + who : ''}</small>
        <button type="submit" className="h-btn h-btn--primary h-btn--sm">
          Save
        </button>
      </div>
    </form>
  );
}
