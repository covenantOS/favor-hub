/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MI, hue, initials, size } from './util';
import { getApi } from './mailApi';
import { ClipPick, DrivePick, LaterMenu, TemplatesMenu } from './ComposeSheets';

export interface ComposeInit {
  title?: string;
  to?: any[];
  cc?: any[];
  bcc?: any[];
  subject?: string;
  body?: string;
  quote?: string;
  threadId?: string;
  replyTo?: string;
  draftId?: string;
  mb?: string;
  noSig?: boolean;
  forward?: any[];
  files?: any[];
}
export interface Outgoing {
  to: any[];
  cc: any[];
  bcc: any[];
  subject: string;
  html: string;
  threadId: string;
  replyTo: string;
  draftId: string;
  mb: string;
  from?: string;
  files: any[];
  forward: any[];
  init: ComposeInit;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function Chips({ k, label, list, setList, extra }: { k: string; label: string; list: any[]; setList: (l: any[]) => void; extra?: React.ReactNode }) {
  const [val, setVal] = useState('');
  const [sug, setSug] = useState<any[]>([]);
  const [hi, setHi] = useState(0);
  const timer = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const commit = (text: string) => {
    const parts = text.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    const left: string[] = [];
    const add: any[] = [];
    parts.forEach((p) => (EMAIL.test(p) ? add.push({ email: p.toLowerCase(), name: '' }) : left.push(p)));
    if (add.length) setList(list.concat(add.filter((a) => !list.some((x) => x.email === a.email))));
    setVal(left.join(' '));
  };
  const find = (q: string) => {
    clearTimeout(timer.current);
    if (q.trim().length < 1) return setSug([]);
    timer.current = window.setTimeout(() => {
      getApi()
        .contacts(q.trim())
        .then((d: any) => {
          const have = list.map((a) => a.email);
          setSug((d.people || []).filter((p: any) => have.indexOf(p.email) < 0).slice(0, 8));
          setHi(0);
        })
        .catch(() => setSug([]));
    }, 140);
  };
  const pick = (p: any) => {
    setList(list.concat([{ email: p.email, name: p.name }]));
    setVal('');
    setSug([]);
    input.current?.focus();
  };
  return (
    <div className="ml-c__row" data-field={k}>
      <label htmlFor={'ml-c-' + k}>{label}</label>
      <div className="ml-c__chips">
        {list.map((a) => (
          <span className="ml-to" key={a.email} data-email={a.email} title={a.email}>
            {a.name || a.email}
            <button type="button" aria-label={'Remove ' + (a.name || a.email)} onClick={() => setList(list.filter((x) => x.email !== a.email))}>
              <MI n="x" />
            </button>
          </span>
        ))}
        <input
          id={'ml-c-' + k}
          ref={input}
          className="ml-c__in"
          type="email"
          multiple
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          data-addr={k}
          value={val}
          onChange={(e) => {
            setVal(e.target.value);
            if (/[,;\s]$/.test(e.target.value)) commit(e.target.value);
            else find(e.target.value);
          }}
          onBlur={() => setTimeout(() => (val.trim() ? commit(val) : undefined), 150)}
          onKeyDown={(e) => {
            if (sug.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault();
              setHi((h) => (h + (e.key === 'ArrowDown' ? 1 : -1) + sug.length) % sug.length);
            } else if ((e.key === 'Enter' || e.key === 'Tab') && sug.length) {
              e.preventDefault();
              pick(sug[hi]);
            } else if ((e.key === 'Enter' || e.key === ',') && val.trim()) {
              e.preventDefault();
              commit(val);
            } else if (e.key === 'Backspace' && !val && list.length) setList(list.slice(0, -1));
          }}
        />
      </div>
      {extra}
      {sug.length > 0 && (
        <div className="ml-sug" role="listbox">
          {sug.map((p, i) => (
            <button type="button" role="option" aria-selected={i === hi} className={'ml-sug__i' + (i === hi ? ' is-on' : '')} key={p.email} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}>
              <span className="ml-av ml-av--sm" data-h={hue(p.email)}>
                {p.picture ? <img src={p.picture} alt="" referrerPolicy="no-referrer" /> : initials(p.name || p.email)}
              </span>
              <span className="ml-sug__t">
                <b>{p.name || p.email}</b>
                <small>{p.email}</small>
              </span>
              {p.title ? <em>{p.title}</em> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const readFile = (file: File) =>
  new Promise<any>((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok({ name: file.name, mime: file.type || 'application/octet-stream', size: file.size, data: String(r.result).split(',')[1] || '' });
    r.onerror = no;
    r.readAsDataURL(file);
  });

interface Props {
  init: ComposeInit;
  me: string;
  signature: string;
  fromOpts: any[] | null;
  canWrite: boolean;
  defaultBox: string;
  onSend: (o: Outgoing) => void;
  onClose: (keep: boolean, o: { dirtyDraft: boolean; draftId: string; mb: string }) => void;
  onDiscard: (draftId: string, mb: string, pending: Promise<unknown> | null) => void;
  onAsk: (what: string) => void;
  onToast: (msg: string) => void;
  onLater: (o: Outgoing, at: Date, remindDays: number) => void;
}

export function Compose({ init, me, signature, fromOpts, canWrite, defaultBox, onSend, onClose, onDiscard, onAsk, onToast, onLater }: Props) {
  const [to, setTo] = useState<any[]>(init.to || []);
  const [cc, setCc] = useState<any[]>(init.cc || []);
  const [bcc, setBcc] = useState<any[]>(init.bcc || []);
  const [showCc, setShowCc] = useState(!!((init.cc && init.cc.length) || (init.bcc && init.bcc.length)));
  const [subject, setSubject] = useState(init.subject || '');
  const [files, setFiles] = useState<any[]>(init.files || []);
  const [forward, setForward] = useState<any[]>(init.forward || []);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [saved, setSaved] = useState('');
  const [sheet, setSheet] = useState<'' | 'templates' | 'later' | 'drive' | 'photos' | 'clips'>('');
  const range = useRef<Range | null>(null);
  const ed = useRef<HTMLDivElement>(null);
  const qd = useRef<HTMLDivElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const draftId = useRef(init.draftId || '');
  const dirty = useRef(false);
  const saving = useRef<Promise<unknown> | null>(null);
  const saveT = useRef(0);
  const sent = useRef(false);
  const [on, setOn] = useState(false);
  const mbDefault = init.mb != null ? init.mb : defaultBox && defaultBox !== me ? defaultBox : '';
  const fromPick = (() => {
    if (!fromOpts || fromOpts.length < 2) return '';
    const want = mbDefault || me;
    const p = fromOpts.find((x) => x.mailbox === want && x.default) || fromOpts.find((x) => x.mailbox === want) || fromOpts[0];
    return p.mailbox + '|' + p.email;
  })();
  const [from, setFrom] = useState(fromPick);
  const sig = !init.noSig && signature ? '<br><br><div class="gmail_signature">' + signature + '</div>' : '';

  const collect = useCallback((): Outgoing => {
    const html = (ed.current?.innerHTML || '') + (qd.current ? qd.current.innerHTML : '');
    let mb = mbDefault;
    let fromEmail: string | undefined;
    if (from) {
      const parts = from.split('|');
      mb = parts[0] === me ? '' : parts[0];
      fromEmail = parts[1];
    }
    return { to, cc, bcc, subject, html, threadId: init.threadId || '', replyTo: init.replyTo || '', draftId: draftId.current, mb, from: fromEmail, files, forward, init };
  }, [to, cc, bcc, subject, files, forward, from, me, mbDefault, init]);
  const collectRef = useRef(collect);
  collectRef.current = collect;

  const save = useCallback(() => {
    if (sent.current || !dirty.current) return Promise.resolve();
    const b = collectRef.current();
    if (!b.to.length && !b.cc.length && !b.subject.trim() && !(ed.current?.textContent || '').trim()) return Promise.resolve();
    dirty.current = false;
    setSaved('Saving');
    const p = getApi()
      .saveDraft({ to: b.to, cc: b.cc, bcc: b.bcc, subject: b.subject, html: b.html, threadId: b.threadId, replyTo: b.replyTo, draftId: b.draftId, mb: b.mb, from: b.from })
      .then((d: any) => {
        draftId.current = d.draftId;
        setSaved('Draft saved');
      })
      .catch((e: any) => {
        dirty.current = true;
        setSaved('');
        if (e.code === 'mail_scope') onAsk('draft');
      });
    saving.current = p;
    return p;
  }, [onAsk]);

  const changed = useCallback(() => {
    dirty.current = true;
    clearTimeout(saveT.current);
    if (canWrite) saveT.current = window.setTimeout(() => void save(), 2500);
  }, [canWrite, save]);

  useEffect(() => {
    if (ed.current) ed.current.innerHTML = init.body || '<div><br></div>' + sig;
    if (qd.current && init.quote) qd.current.innerHTML = init.quote;
    const id = requestAnimationFrame(() => {
      setOn(true);
      const first = init.to && init.to.length ? ed.current : document.getElementById('ml-c-to');
      if (first) {
        (first as HTMLElement).focus({ preventScroll: true });
        if (first === ed.current) {
          const r = document.createRange();
          r.setStart(first, 0);
          r.collapse(true);
          const s = getSelection();
          s?.removeAllRanges();
          s?.addRange(r);
        }
      }
    });
    document.body.classList.add('ml-composing');
    return () => {
      cancelAnimationFrame(id);
      clearTimeout(saveT.current);
      document.body.classList.remove('ml-composing');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (to.length || cc.length || bcc.length || subject) changed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, cc, bcc, subject, files, forward]);

  const close = () => {
    clearTimeout(saveT.current);
    onClose(true, { dirtyDraft: dirty.current && !sent.current, draftId: draftId.current, mb: collectRef.current().mb });
    if (dirty.current && !sent.current) void save().then(() => onToast('Draft saved'));
  };
  const fmt = (cmd: string) => {
    ed.current?.focus();
    if (cmd === 'link') {
      const u = window.prompt('Link address');
      if (u) document.execCommand('createLink', false, /^(https?:|mailto:)/i.test(u) ? u : 'https://' + u);
    } else document.execCommand(cmd);
    changed();
  };
  const trySend = () => {
    const b = collect();
    if (!b.to.length && !b.cc.length && !b.bcc.length) {
      onToast('Add who it goes to');
      document.getElementById('ml-c-to')?.focus();
      return;
    }
    const big = files.reduce((n, f) => n + f.size, 0);
    if (big > 24 * 1048576) {
      onToast('Files can add up to 24 MB. Link a big file from Drive instead.');
      return;
    }
    sent.current = true;
    clearTimeout(saveT.current);
    onSend(b);
  };
  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const add = await Promise.all(Array.from(list).map(readFile));
    setFiles((f) => f.concat(add));
  };

  const keepRange = () => {
    const sel = getSelection();
    if (sel && sel.rangeCount && ed.current && ed.current.contains(sel.anchorNode)) range.current = sel.getRangeAt(0).cloneRange();
  };
  const insertHtml = (html: string) => {
    const e = ed.current;
    if (!e) return;
    e.focus();
    if (range.current && e.contains(range.current.startContainer)) {
      const s2 = getSelection();
      s2?.removeAllRanges();
      s2?.addRange(range.current);
    }
    if (!document.execCommand('insertHTML', false, html)) e.insertAdjacentHTML('afterbegin', html);
    changed();
  };
  const open = (k: typeof sheet) => {
    keepRange();
    setSheet(k);
  };
  const photoWords = subject.replace(/^(re|fwd?):\s*/gi, '').replace(/[^\w\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3).slice(0, 4).join(' ') || 'photos';

  const all = forward.map((f, i) => ({ f, k: 'w' + i })).concat(files.map((f, i) => ({ f, k: 'u' + i })));
  return createPortal(
    <div
      className={'ml-c' + (on ? ' is-in' : '')}
      role="dialog"
      aria-label={init.title || 'New message'}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          trySend();
        } else if (e.key === 'Escape' && !(e.target as HTMLElement).closest('[data-addr]')) {
          e.preventDefault();
          close();
        } else if ((e.metaKey || e.ctrlKey) && /^[bik]$/i.test(e.key) && (e.target as HTMLElement).closest('[data-ed]')) {
          e.preventDefault();
          fmt(e.key.toLowerCase() === 'b' ? 'bold' : e.key.toLowerCase() === 'i' ? 'italic' : 'link');
        }
      }}
    >
      <div className="ml-c__box">
        <div className="ml-c__bar">
          <button type="button" className="ml-c__cancel" onClick={close}>
            Cancel
          </button>
          <b>{init.title || 'New message'}</b>
          <span className="ml-c__save">{saved}</span>
          <button type="button" className="ml-iconbtn ml-dt" onClick={close} aria-label="Close and keep the draft" title="Close and keep the draft">
            <MI n="x" />
          </button>
        </div>
        <div className="ml-c__scroll">
          {fromOpts && fromOpts.length > 1 && (
            <div className="ml-c__row">
              <label htmlFor="ml-c-from">From</label>
              <select id="ml-c-from" className="ml-c__in ml-c__from" value={from} onChange={(e) => (setFrom(e.target.value), changed())}>
                {fromOpts.map((x) => (
                  <option key={x.mailbox + '|' + x.email} value={x.mailbox + '|' + x.email}>
                    {(x.name ? x.name + ' ' : '') + '<' + x.email + '>'}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Chips k="to" label="To" list={to} setList={setTo} extra={!showCc ? <button type="button" className="ml-c__ccb" onClick={() => setShowCc(true)}>Cc Bcc</button> : null} />
          {showCc && (
            <div className="ml-c__cc">
              <Chips k="cc" label="Cc" list={cc} setList={setCc} />
              <Chips k="bcc" label="Bcc" list={bcc} setList={setBcc} />
            </div>
          )}
          <div className="ml-c__row">
            <label htmlFor="ml-c-subj">Subject</label>
            <input id="ml-c-subj" className="ml-c__in ml-c__subj" maxLength={900} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="ml-c__ed" ref={ed} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="Message" data-ed onInput={changed} />
          {init.quote && (
            <button type="button" className="ml-fold ml-fold--c" onClick={() => setQuoteOpen((v) => !v)} aria-label="Show the earlier message" title="Show the earlier message">
              <MI n="more" />
            </button>
          )}
          <div className="ml-c__q" ref={qd} hidden={!quoteOpen} contentEditable suppressContentEditableWarning onInput={changed} />
          <div className="ml-c__files">
            {all.map((x) => (
              <span className="ml-cf" key={x.k}>
                <MI n="file" />
                <span>{x.f.name}</span>
                <small>{size(x.f.size)}</small>
                <button
                  type="button"
                  aria-label={'Remove ' + x.f.name}
                  onClick={() => (x.k[0] === 'w' ? setForward((f) => f.filter((_, i) => 'w' + i !== x.k)) : setFiles((f) => f.filter((_, i) => 'u' + i !== x.k)))}
                >
                  <MI n="x" />
                </button>
              </span>
            ))}
          </div>
        </div>
        <div className="ml-c__tools">
          <button type="button" className="ml-iconbtn" onClick={() => fileIn.current?.click()} aria-label="Attach a file" title="Attach a file">
            <MI n="clip" />
          </button>
          <button type="button" className="ml-iconbtn" onClick={() => open('drive')} aria-label="Link a Drive file" title="Link a Drive file">
            <MI n="drive" />
          </button>
          <button type="button" className="ml-iconbtn" onClick={() => open('clips')} aria-label="Link a clip" title="Link a clip">
            <MI n="rec" />
          </button>
          <button type="button" className="ml-iconbtn" onClick={() => open('photos')} aria-label="Photos from Drive" title="Photos from the Drive library">
            <MI n="image" />
          </button>
          <button type="button" className="ml-iconbtn" onClick={() => open('templates')} aria-label="Templates" title="Templates with the partner's details">
            <MI n="draft" />
          </button>
          <span className="ml-c__sep" />
          {[['bold', 'bold', 'Bold (Ctrl B)'], ['italic', 'ital', 'Italic (Ctrl I)'], ['link', 'link', 'Link (Ctrl K)'], ['insertUnorderedList', 'list', 'Bulleted list']].map(([c, i, t]) => (
            <button type="button" className="ml-iconbtn" key={c} onMouseDown={(e) => e.preventDefault()} onClick={() => fmt(c)} aria-label={t.replace(/ \(.*/, '')} title={t}>
              <MI n={i} />
            </button>
          ))}
          <span className="ml-c__grow" />
          <button type="button" className="ml-iconbtn ml-c__later" onClick={() => open('later')} aria-label="Send later" title="Send later">
            <MI n="clock" />
          </button>
          <button
            type="button"
            className="ml-iconbtn"
            onClick={() => {
              sent.current = true;
              onDiscard(draftId.current, collect().mb, saving.current);
            }}
            aria-label="Discard"
            title="Discard"
          >
            <MI n="trash" />
          </button>
          <button type="button" className="ml-btn ml-btn--primary ml-c__send" onClick={trySend} data-send>
            <MI n="send" />
            <span>Send</span>
          </button>
          <input ref={fileIn} type="file" multiple hidden onChange={(e) => (void addFiles(e.target.files), (e.target.value = ''))} />
        </div>
      </div>
      {sheet === 'later' && (
        <LaterMenu
          onClose={() => setSheet('')}
          say={onToast}
          onPick={(at, remindDays) => {
            if (files.length || forward.length) return onToast('A message with files cannot wait. Send it now.');
            setSheet('');
            sent.current = true;
            onLater(collect(), at, remindDays);
          }}
        />
      )}
      {sheet === 'templates' && <TemplatesMenu onClose={() => setSheet('')} to={to.map((x) => x.email)} bodyText={() => (ed.current?.innerText || '').trim()} insert={insertHtml} say={onToast} />}
      {sheet === 'drive' && <DrivePick title="Link a Drive file" onClose={() => setSheet('')} insert={insertHtml} />}
      {sheet === 'photos' && <DrivePick title="Photos from the Drive library" first={photoWords + ' photo'} onClose={() => setSheet('')} insert={insertHtml} />}
      {sheet === 'clips' && <ClipPick onClose={() => setSheet('')} insert={insertHtml} say={onToast} />}
    </div>,
    document.body
  );
}
