// The "What do you need?" composer. One big box; the words are read on every keystroke into chips (Goes to, Kind, Where, Who sees it,
// Needed by, Asked for), each with the reason beside it on hover or tap, and each editable before sending. A request about money
// sends the person to the expense form. After sending it shows the status and where to follow it. Opened by the Make a request button
// and by /projects/?compose=1 (see useIntakeParams in hooks.ts).
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { easternDay, parseRequest, AUDIENCE_OPTIONS, KIND_OPTIONS, PLACE_OPTIONS, TEAM_OPTIONS, type PersonLite } from './parse';
import type { IntakeItem } from '@shared/intake-model';
import { useStaff } from '../lib/staff';
import { goto } from '../lib/url';
import { Icon } from '../kit/Icon';
import { openSheet, type SheetHandle } from '../kit/overlays';
import { pickDate, pickOwner } from '../kit/pickers';
import { intakeApi, intakeKeys, expenseHref, isExpense } from './api';
import { addFiles, applyEdit, effective, fullDate, submitBody, triagerOf, whereParts, MAX_FILES, type Edits, type TeamValue } from './logic';
import { StopBar, Word } from './parts';
import './intake.css';

const EXAMPLES = ["Add Sarah's bio to the team page on the website by Friday", 'We need a flyer for the church banquet by October 30', 'Please reimburse my hotel for the conference'];

/** What was typed and not sent, kept until the next time the composer opens. */
let draft = '';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf,.doc,.docx,text/plain,.txt';

type Guess = { email: string; name: string; why: string } | null;

function Pick<T extends string>({ label, value, options, onChange }: { label: string; value: string; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <select aria-label={label} value={value} onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

interface ChipProps {
  label: string;
  shown: string;
  why: string;
  guess?: boolean;
  edited?: boolean;
  onSee: (why: string) => void;
  onPress?: (el: HTMLElement) => void;
  children?: ReactNode;
}

/** One chip: the label, the answer, a small arrow, and the control on top (a list, or a button that opens a picker). */
function CxChip({ label, shown, why, guess, edited, onSee, onPress, children }: ChipProps) {
  const text = edited ? 'You changed this.' : 'Why: ' + why;
  const cls = 'cx-chip' + (guess && !edited ? ' guess' : '') + (edited ? ' edited' : '');
  const body = (
    <>
      <i>{label}</i>
      {shown}
      <Icon name="down" />
    </>
  );
  if (onPress) {
    return (
      <button type="button" className={cls} data-why={text} aria-label={`${label}: ${shown}`} onClick={(e) => { onSee(edited ? 'you changed this' : why); onPress(e.currentTarget); }}>
        {body}
      </button>
    );
  }
  return (
    <span className={cls} data-why={text} onClick={() => onSee(edited ? 'you changed this' : why)} onFocusCapture={() => onSee(edited ? 'you changed this' : why)}>
      {body}
      {children}
    </span>
  );
}

function ComposerBody({ sheet, initial }: { sheet: SheetHandle; initial: string }) {
  const staff = useStaff();
  const qc = useQueryClient();
  const [text, setText] = useState(initial);
  const [edits, setEdits] = useState<Edits>({});
  const [files, setFiles] = useState<File[]>([]);
  const [see, setSee] = useState('');
  const [guess, setGuess] = useState<Guess>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState<IntakeItem | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const sentRef = useRef(false);
  const today = useMemo(() => easternDay(), []);
  const people: PersonLite[] = useMemo(() => staff.list.map((p) => ({ email: p.email, name: p.name, team: p.team, title: p.title })), [staff]);

  useEffect(() => {
    const t = setTimeout(() => {
      const b = box.current;
      if (b) {
        b.focus();
        b.setSelectionRange(b.value.length, b.value.length);
      }
    }, 40);
    return () => {
      clearTimeout(t);
      draft = sentRef.current ? '' : textRef.current;
    };
  }, []);

  const parsed = useMemo(() => (text.trim().length > 2 ? parseRequest(text, today, { people, ownerGuess: guess }) : null), [text, today, people, guess]);

  // The suggested owner comes from the board's history, so it is asked from the server once typing pauses.
  useEffect(() => {
    if (text.trim().length < 3) {
      setGuess(null);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      intakeApi
        .parse(text, { signal: ctl.signal })
        .then((r) => {
          const a = r.parsed.assignee;
          setGuess(a && a.guess ? { email: a.value, name: a.label, why: a.why } : null);
        })
        .catch(() => undefined);
    }, 500);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [text]);

  const v = parsed ? effective(parsed, edits) : null;
  const team: TeamValue | null = v ? v.team : null;
  const pack = team === 'marketing' ? 'marketing' : 'tech';
  const expense = team === 'expense';
  const triager = team && team !== 'expense' ? triagerOf(team, people)?.name || null : null;
  const where = whereParts(team, triager);
  const can = !!parsed && !expense && !busy && text.trim().length > 1;
  const change = (v: string) => {
    setText(v);
    if (!v.trim()) setEdits({});
  };
  const set = (key: keyof Edits, value: string) => setEdits((e) => applyEdit(e, key, value));

  const addPicked = (list: File[]) => {
    const r = addFiles(files, list);
    setFiles(r.files);
    if (r.refused) setErr(`Only pictures, PDF, Word and text files under 4 MB, up to ${MAX_FILES}. ${r.refused} not added.`);
    else setErr('');
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = [...e.clipboardData.items].map((i) => i.getAsFile()).filter((f): f is File => !!f && f.type.startsWith('image/'));
    if (pasted.length) addPicked(pasted);
  };

  const send = async () => {
    if (!can || !parsed) return;
    setBusy(true);
    setErr('');
    try {
      const r = await intakeApi.submit(submitBody(text, parsed, edits), files);
      if (isExpense(r)) {
        window.location.href = r.href;
        return;
      }
      sentRef.current = true;
      draft = '';
      void qc.invalidateQueries({ queryKey: intakeKeys.all });
      setSent(r.request);
    } catch (e) {
      setErr((e as Error).message || 'That did not send. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    const w = whereParts(sent.team, triager || triagerOf(sent.team, people)?.name || null);
    return (
      <>
        <div className="cx-body cx-sent" role="status">
          <div className="cx-sent__top">
            <Word item={sent} />
            <h3>{sent.title}</h3>
          </div>
          <StopBar item={sent} />
          <p className="cx-sent__where">
            <b>{w.strong}</b>
            {w.rest} You get an email when it is done.
          </p>
        </div>
        <div className="cx-foot">
          <button
            type="button"
            className="pj-btn"
            onClick={() => {
              sentRef.current = false;
              setSent(null);
              setText('');
              setEdits({});
              setFiles([]);
              setSee('');
              setTimeout(() => box.current?.focus(), 40);
            }}
          >
            Make another request
          </button>
          <button
            type="button"
            className="pj-btn pj-btn--primary"
            onClick={() => {
              sheet.close();
              goto('/projects/?tab=requests');
            }}
          >
            See it on My requests
          </button>
        </div>
      </>
    );
  }

  const teamOpts = TEAM_OPTIONS.map((o) => ({ value: o.value, label: o.label }));
  const placeOpts = PLACE_OPTIONS[pack].map((o) => ({ value: o.value as string, label: o.label }));
  const audOpts = AUDIENCE_OPTIONS[pack].map((a) => ({ value: a, label: a }));
  const labelOf = (opts: { value: string; label: string }[], val: string) => opts.find((o) => o.value === val)?.label || val;
  const askName = v && v.ask ? staff.nameOf(v.ask) || v.ask : 'Nobody in particular';

  return (
    <>
      <div className="cx-body">
        <textarea
          ref={box}
          className="cx-box"
          aria-label="What do you need?"
          placeholder="Say it the way you would to a coworker. Add Sarah's bio to the team page by Friday."
          value={text}
          maxLength={4000}
          onChange={(e) => change(e.target.value)}
          // The guided tour types into the box with plain input events, which a controlled box only hears here.
          onInput={(e) => change((e.target as HTMLTextAreaElement).value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {!text ? (
          <div className="cx-ex">
            <span>Try</span>
            {EXAMPLES.map((x) => (
              <button key={x} type="button" onClick={() => { setText(x); setEdits({}); box.current?.focus(); }}>
                {x}
              </button>
            ))}
          </div>
        ) : null}
        {parsed && v ? (
          <>
            <div className="cx-chips" role="group" aria-label="How it was read">
              <CxChip label="Goes to" shown={labelOf(teamOpts, v.team)} why={parsed.team.why} guess={parsed.team.guess} edited={edits.team !== undefined} onSee={setSee}>
                <Pick label="Goes to" value={v.team} options={teamOpts} onChange={(x) => set('team', x)} />
              </CxChip>
              {expense ? null : (
                <>
                  <CxChip label="Kind" shown={labelOf(KIND_OPTIONS, v.kind)} why={parsed.kind.why} edited={edits.kind !== undefined} onSee={setSee}>
                    <Pick label="Kind" value={v.kind} options={KIND_OPTIONS} onChange={(x) => set('kind', x)} />
                  </CxChip>
                  <CxChip label="Where" shown={labelOf(placeOpts, v.place)} why={parsed.place.why} guess={parsed.place.guess} edited={edits.place !== undefined} onSee={setSee}>
                    <Pick label="Where" value={v.place} options={placeOpts} onChange={(x) => set('place', x)} />
                  </CxChip>
                  <CxChip label="Who sees it" shown={labelOf(audOpts, v.audience)} why={parsed.audience.why} guess={parsed.audience.guess} edited={edits.audience !== undefined} onSee={setSee}>
                    <Pick label="Who sees it" value={v.audience} options={audOpts} onChange={(x) => set('audience', x)} />
                  </CxChip>
                  <CxChip
                    label="Needed by"
                    shown={v.due ? fullDate(v.due) : 'No date'}
                    why={parsed.due.why}
                    guess={parsed.due.guess}
                    edited={edits.due !== undefined}
                    onSee={setSee}
                    onPress={async (el) => {
                      const d = await pickDate({ anchor: el, value: v.due || null, title: 'Needed by' });
                      if (d !== undefined) set('due', d || '');
                    }}
                  />
                  <CxChip
                    label="Asked for"
                    shown={askName}
                    why={parsed.assignee ? parsed.assignee.why : 'nobody is named'}
                    guess={parsed.assignee ? parsed.assignee.guess : true}
                    edited={edits.ask !== undefined}
                    onSee={setSee}
                    onPress={async () => {
                      const r = await pickOwner({ title: 'Asked for', current: v.ask || null, clear: 'Nobody in particular' });
                      if (r) set('ask', r.email || '');
                    }}
                  />
                </>
              )}
            </div>
            <p className="cx-why" aria-live="polite">
              {see ? (
                <>
                  <b>Why:</b> {see}
                </>
              ) : (
                <span className="cx-hint">Hover or tap a chip to see why. Change any of them before you send.</span>
              )}
            </p>
            {expense ? (
              <div className="cx-money">
                <span>This is about money, so it goes on an expense request.</span>
                <a className="pj-btn" href={expenseHref(text)}>
                  Open the expense form
                </a>
              </div>
            ) : null}
          </>
        ) : null}
        <div className="cx-attach">
          <input ref={pick} type="file" hidden multiple accept={ACCEPT} onChange={(e) => { addPicked([...(e.target.files || [])]); e.target.value = ''; }} />
          <button type="button" className="attach" onClick={() => pick.current?.click()}>
            Add pictures or files
          </button>
          {files.map((f, i) => (
            <span key={f.name + i} className="cx-file">
              {f.name}
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((l) => l.filter((_, j) => j !== i))}>
                <Icon name="x" />
              </button>
            </span>
          ))}
        </div>
        {err ? (
          <p className="cx-err" role="alert">
            {err}
          </p>
        ) : null}
      </div>
      <div className="cx-foot">
        <span className="where">
          <b>{where.strong}</b>
          {where.rest}
        </span>
        <button type="button" className="pj-btn" onClick={() => sheet.close()}>
          Cancel
        </button>
        <button type="button" className="pj-btn pj-btn--primary" disabled={!can} onClick={() => void send()}>
          {busy ? 'Sending' : 'Send request'}
        </button>
      </div>
    </>
  );
}

/** Opens the composer. Words typed and not sent come back the next time. */
export function openComposer(opts: { text?: string } = {}): SheetHandle {
  return openSheet({
    title: 'What do you need?',
    cls: 'pj-sheet--compose',
    render: (s) => <ComposerBody sheet={s} initial={opts.text ?? draft} />,
  });
}
