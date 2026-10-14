// The message box, shared by the Chat page (channel and thread) and the floating dock: formatting row and keys, @ mentions of
// people, @Favor Brain and partners and funds, slash commands, files (pick, paste), voice notes, drafts kept per conversation.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChatEngine } from './engine';
import { fmtSecs, type J } from './fmt';
import { Ic } from './icons';

type Scope = 'main' | 'thread';
const FMT: [string, string, string][] = [
  ['bold', 'Bold', 'Ctrl B'],
  ['italic', 'Italic', 'Ctrl I'],
  ['strike', 'Strikethrough', 'Ctrl Shift X'],
  ['link', 'Link', 'Ctrl Shift U'],
  ['ol', 'Numbered list', 'Ctrl Shift 7'],
  ['ul', 'Bulleted list', 'Ctrl Shift 8'],
  ['quote', 'Quote', 'Ctrl Shift 9'],
  ['code', 'Code', 'Ctrl Shift C'],
  ['block', 'Code block', 'Ctrl Alt Shift C'],
];
const FMT_KEYS: Record<string, string> = { KeyX: 'strike', KeyC: 'code', Digit7: 'ol', Digit8: 'ul', Digit9: 'quote', KeyU: 'link' };

export function grow(ta: HTMLTextAreaElement) {
  ta.style.height = '0px';
  ta.style.height = Math.min(180, ta.scrollHeight) + 'px';
}

function applyFmt(ta: HTMLTextAreaElement, f: string) {
  const a = ta.selectionStart;
  const b = ta.selectionEnd;
  const v = ta.value;
  const sel = v.slice(a, b);
  const wrap = (l: string, r: string, ph: string) => {
    if (v.slice(a - l.length, a) === l && v.slice(b, b + r.length) === r) {
      ta.value = v.slice(0, a - l.length) + sel + v.slice(b + r.length);
      ta.setSelectionRange(a - l.length, b - l.length);
      return;
    }
    const inner = sel || ph;
    ta.value = v.slice(0, a) + l + inner + r + v.slice(b);
    ta.setSelectionRange(a + l.length, a + l.length + inner.length);
  };
  const lines = (prefix: string | ((i: number) => string), test: RegExp) => {
    const s0 = v.lastIndexOf('\n', a - 1) + 1;
    let e0 = v.indexOf('\n', b);
    if (e0 < 0) e0 = v.length;
    const block = v.slice(s0, e0).split('\n');
    const on = block.every((l) => test.test(l));
    const out = block.map((l, i) => (on ? l.replace(test, '') : (typeof prefix === 'function' ? prefix(i) : prefix) + l.replace(/^(- |\d{1,3}[.)] |> )/, ''))).join('\n');
    ta.value = v.slice(0, s0) + out + v.slice(e0);
    ta.setSelectionRange(s0 + out.length, s0 + out.length);
  };
  if (f === 'bold') wrap('**', '**', 'bold');
  else if (f === 'italic') wrap('_', '_', 'italic');
  else if (f === 'strike') wrap('~~', '~~', 'text');
  else if (f === 'code') wrap('`', '`', 'code');
  else if (f === 'block') wrap('```\n', '\n```', 'code');
  else if (f === 'link') {
    if (/^https?:\/\/\S+$/.test(sel)) {
      ta.value = v.slice(0, a) + '[link](' + sel + ')' + v.slice(b);
      ta.setSelectionRange(a + 1, a + 5);
    } else {
      const words = sel || 'link';
      ta.value = v.slice(0, a) + '[' + words + '](https://)' + v.slice(b);
      const u = a + words.length + 3;
      ta.setSelectionRange(u, u + 8);
    }
  } else if (f === 'ul') lines('- ', /^- /);
  else if (f === 'ol') lines((i) => i + 1 + '. ', /^\d{1,3}[.)] /);
  else if (f === 'quote') lines('> ', /^> /);
  ta.focus();
}
function continueList(ta: HTMLTextAreaElement): boolean {
  const a = ta.selectionStart;
  const v = ta.value;
  if (a !== ta.selectionEnd) return false;
  const s0 = v.lastIndexOf('\n', a - 1) + 1;
  const line = v.slice(s0, a);
  const m = line.match(/^(- |> |(\d{1,3})([.)]) )(.*)$/);
  if (!m) return false;
  if (!m[4].trim()) {
    ta.value = v.slice(0, s0) + v.slice(a);
    ta.setSelectionRange(s0, s0);
    return true;
  }
  const next = m[2] ? Number(m[2]) + 1 + m[3] + ' ' : m[1];
  ta.value = v.slice(0, a) + '\n' + next + v.slice(a);
  ta.setSelectionRange(a + 1 + next.length, a + 1 + next.length);
  return true;
}

function mentionCandidates(e: ChatEngine, q: string, c: J): J[] {
  q = q.toLowerCase();
  const S = e.S;
  const ids = (c.kind === 'public' ? Object.keys(S.users) : c.members || []).filter((id: string) => id !== S.me.id);
  const out: J[] = [{ id: 'brain', name: 'Favor Brain', sub: 'Ask a question about Favor records', brain: true }];
  if (c.kind === 'public' || c.kind === 'private' || c.kind === 'group') out.push({ id: 'channel', name: 'channel', sub: 'Notify everyone here', special: true });
  ids.forEach((id: string) => {
    const u = e.user(id);
    out.push({ id, name: u.name, sub: u.title || '', u });
  });
  return out.filter((o) => !q || o.name.toLowerCase().indexOf(q) >= 0).slice(0, 7).concat(e.entHits(q));
}

interface Props {
  e: ChatEngine;
  scope: Scope;
  placeholder: string;
  /** The dock's narrow panel: no formatting row. */
  slim?: boolean;
  latest?: { show: boolean; n: number; go: () => void };
  alsoLabel?: string;
}

export function Composer({ e, scope, placeholder, slim, latest, alsoLabel }: Props) {
  useSyncExternalStore(e.subscribe, e.snap);
  const ta = useRef<HTMLTextAreaElement>(null);
  const also = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [has, setHas] = useState(false);
  const [rec, setRec] = useState<null | { t0: number; stop: () => void; cancel: () => void }>(null);
  const [, tick] = useState(0);
  const key = e.draftKey(scope);
  const keyRef = useRef<string | null>(null);
  const draftT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending: J[] = e.S.pending[scope];

  const sync = () => {
    const t = ta.current;
    setHas(!!(t && t.value.trim()));
  };
  // A different conversation or thread: keep what was typed in the last one, bring back what was typed in this one.
  useEffect(() => {
    const t = ta.current;
    if (!t) return;
    if (keyRef.current !== key) {
      clearTimeout(draftT.current);
      const first = !keyRef.current;
      if (keyRef.current) e.saveDraft(scope, t.value, keyRef.current);
      keyRef.current = key;
      // The first conversation to open after Chat loads keeps whatever was typed while it was loading (it used to be wiped).
      const saved = e.draftOf(scope);
      if (!(first && t.value.trim())) t.value = saved;
      grow(t);
      sync();
    }
  });
  useEffect(
    () => () => {
      clearTimeout(draftT.current);
      const t = ta.current;
      if (t && keyRef.current) e.saveDraft(scope, t.value, keyRef.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  // Focus asked for by the engine (opening a conversation on a computer, Ask Favor Brain, a failed send).
  const fr = e.composerFocus;
  useLayoutEffect(() => {
    const t = ta.current;
    if (!fr || fr.scope !== scope || !t) return;
    e.composerFocus = null;
    if (e.S.restore && e.S.restore.scope === scope) {
      if (!t.value) t.value = e.S.restore.text;
      e.S.restore = null;
    }
    if (fr.prefix && t.value.indexOf(fr.prefix) !== 0) {
      t.value = fr.prefix + t.value;
      if (/Favor Brain/.test(fr.prefix)) e.S.mentionMap[scope]['@Favor Brain'] = '<@brain>';
    }
    if (fr.prefix != null || !matchMedia('(pointer: coarse)').matches) {
      t.focus({ preventScroll: true });
      t.setSelectionRange(t.value.length, t.value.length);
    }
    grow(t);
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fr && fr.n]);

  // The engine and the popovers reach this box through e.boxes (insert an emoji, pick a mention, pick a command).
  useEffect(() => {
    const api = {
      el: () => ta.current,
      insert: (text: string) => {
        const t = ta.current;
        if (!t) return;
        const s = t.selectionStart ?? t.value.length;
        t.value = t.value.slice(0, s) + text + t.value.slice(t.selectionEnd ?? s);
        t.focus();
        t.setSelectionRange(s + text.length, s + text.length);
        grow(t);
        sync();
        saveSoon();
      },
      pickMention: (i: number) => pickMention(i),
      pickSlash: (i: number) => pickSlash(i),
      askBrain: () => askBrainHere(),
      file: () => file.current?.click(),
      mic: () => micToggle(),
    };
    e.boxes[scope] = api;
    return () => {
      if (e.boxes[scope] === api) delete e.boxes[scope];
    };
  });

  const saveSoon = () => {
    clearTimeout(draftT.current);
    draftT.current = setTimeout(() => {
      const t = ta.current;
      if (t) e.saveDraft(scope, t.value);
    }, 350);
  };
  const closePop = () => {
    const p = e.ui.pop;
    if (p && (p.kind === 'mention' || p.kind === 'slash') && p.scope === scope) e.setPop(null);
  };
  const box = () => ta.current?.closest('.ch-comp__box') as HTMLElement | null;

  const updateSlash = (t: HTMLTextAreaElement): boolean => {
    const m = t.value.match(/^\/([a-z]*)$/i);
    if (!m) return false;
    const q = m[1].toLowerCase();
    const list = ChatEngine.SLASH.filter((c) => c.cmd.indexOf(q) === 0);
    if (!list.length) return false;
    const b = box();
    if (b) e.setPop({ kind: 'slash', scope, list, i: 0, anchor: b.getBoundingClientRect() });
    return true;
  };
  const updateMention = (t: HTMLTextAreaElement) => {
    const pos = t.selectionStart;
    const before = t.value.slice(0, pos);
    const m0 = before.match(/(^|\s)([@~])([\w .'-]{0,24})$/);
    if (!m0) return closePop();
    const onlyEnt = m0[2] === '~';
    const q = m0[3];
    const c = e.chan(e.S.active);
    if (!c) return closePop();
    const cands = onlyEnt ? e.entHits(q) : mentionCandidates(e, q, c);
    if (q.length >= 3)
      e.findEnt(q, () => {
        if (document.activeElement === t && /(^|\s)[@~][\w .'-]{0,24}$/.test(t.value.slice(0, t.selectionStart))) updateMention(t);
      });
    if (!cands.length) return closePop();
    const b = box();
    if (b) e.setPop({ kind: 'mention', scope, items: cands, i: 0, start: pos - q.length - 1, end: pos, anchor: b.getBoundingClientRect() });
  };
  const pickMention = (i: number) => {
    const st = e.ui.pop;
    const t = ta.current;
    if (!st || st.kind !== 'mention' || !t) return;
    const o = st.items[i];
    const label = (o.ent ? '' : '@') + o.name;
    e.S.mentionMap[scope][label] = o.ent ? '<~' + o.kind + ':' + o.id + '|' + String(o.name).replace(/[<>|\n]+/g, ' ').trim() + '>' : '<@' + o.id + '>';
    t.value = t.value.slice(0, st.start) + label + ' ' + t.value.slice(st.end);
    const p = st.start + label.length + 1;
    t.setSelectionRange(p, p);
    t.focus();
    e.setPop(null);
    grow(t);
    sync();
    saveSoon();
  };
  const pickSlash = (i: number) => {
    const st = e.ui.pop;
    const t = ta.current;
    if (!st || st.kind !== 'slash' || !t) return;
    const c = st.list[i];
    e.setPop(null);
    if (!c.args) {
      t.value = '/' + c.cmd;
      doSend();
      return;
    }
    t.value = '/' + c.cmd + ' ';
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
    grow(t);
    sync();
  };
  const askBrainHere = () => {
    const t = ta.current;
    if (!t) return;
    e.S.mentionMap[scope]['@Favor Brain'] = '<@brain>';
    if (t.value.indexOf('@Favor Brain') < 0) t.value = '@Favor Brain ' + t.value;
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
    grow(t);
    sync();
  };
  const doSend = () => {
    const t = ta.current;
    if (!t) return;
    const ok = e.send(scope, t.value, !!(also.current && also.current.checked));
    if (ok) {
      t.value = '';
      clearTimeout(draftT.current);
      if (also.current) also.current.checked = false;
      grow(t);
      sync();
    }
  };

  /* ------------------------------------------------------------ voice notes */
  const micToggle = () => {
    if (rec) {
      rec.stop();
      return;
    }
    const MR = (window as any).MediaRecorder;
    if (!navigator.mediaDevices || !MR) {
      e.toast('This browser cannot record a voice note');
      return;
    }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].filter((x) => MR.isTypeSupported(x))[0] || '';
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((stream) => {
        const mr = new MR(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
        const chunks: Blob[] = [];
        const t0 = Date.now();
        let cancelled = false;
        const iv = setInterval(() => {
          if ((Date.now() - t0) / 1000 >= 300) mr.stop();
          tick((n) => n + 1);
        }, 250);
        mr.ondataavailable = (ev: any) => {
          if (ev.data && ev.data.size) chunks.push(ev.data);
        };
        mr.onstop = () => {
          clearInterval(iv);
          stream.getTracks().forEach((x) => x.stop());
          setRec(null);
          const secs = Math.round((Date.now() - t0) / 1000);
          if (cancelled || secs < 1 || !chunks.length) return;
          const mime = (mr.mimeType || type || 'audio/webm').split(';')[0];
          const f = new File(chunks, 'voice-note.' + (mime.indexOf('mp4') >= 0 ? 'm4a' : 'webm'), { type: mime });
          if (f.size > 5.5 * 1024 * 1024) {
            e.toast('That voice note is too long. Keep it under five minutes.');
            return;
          }
          const item: J = { type: 'file', name: 'Voice note ' + fmtSecs(secs), size: f.size, mime, uploading: true, voice: true, secs };
          e.pend(scope, item);
          e.guard(
            fetch('/api/chat/upload', { method: 'POST', credentials: 'same-origin', headers: { 'X-Hub-Request': '1', 'Content-Type': f.type, 'X-File-Name': encodeURIComponent(f.name) }, body: f }).then((r) =>
              r.json().then((d) => {
                if (!r.ok || d.ok === false) throw new Error(d.message || 'The upload did not work.');
                return d;
              })
            )
          )
            .then((r) => {
              item.id = r.id;
              item.url = r.url;
              item.uploading = false;
              e.S.pending[scope] = e.S.pending[scope].slice();
              e.notify();
            })
            .catch(() => e.dropPend(scope, item));
        };
        setRec({
          t0,
          stop: () => {
            if (mr.state !== 'inactive') mr.stop();
          },
          cancel: () => {
            cancelled = true;
            if (mr.state !== 'inactive') mr.stop();
          },
        });
        mr.start(1000);
      })
      .catch(() => e.toast('Allow the microphone to record a voice note'));
  };

  const sendable = has || pending.length > 0;
  return (
    <form
      className="ch-comp"
      data-scope={scope}
      autoComplete="off"
      onSubmit={(ev) => {
        ev.preventDefault();
        doSend();
      }}
    >
      {latest && (
        <button type="button" className={'ch-latest' + (latest.n ? ' has-new' : '')} data-act="latest" hidden={!latest.show} onClick={latest.go}>
          <Ic n="down" />
          <span>{latest.n ? latest.n.toLocaleString('en-US') + (latest.n === 1 ? ' new message' : ' new messages') : 'Latest'}</span>
        </button>
      )}
      <div className="ch-comp__box">
        {rec && (
          <div className="sm-rec">
            <i className="sm-rec__dot" />
            <b data-t="">{fmtSecs((Date.now() - rec.t0) / 1000)}</b>
            <span>Recording a voice note</span>
            <button type="button" className="ch-btn ch-btn--sm" data-act="sm-rec-x" onClick={() => rec.cancel()}>
              Cancel
            </button>
            <button type="button" className="ch-btn ch-btn--sm ch-btn--primary" data-act="sm-rec-go" onClick={() => rec.stop()}>
              Stop and attach
            </button>
          </div>
        )}
        {!slim && (
          <div className="ch-fmt" role="toolbar" aria-label="Formatting">
            {FMT.map((f, i) => (
              <span key={f[0]} style={{ display: 'contents' }}>
                {(i === 3 || i === 4 || i === 6 || i === 7) && <i className="ch-fmt__sep" aria-hidden="true" />}
                <button
                  type="button"
                  className="ch-tipped"
                  data-act="fmt"
                  data-f={f[0]}
                  aria-label={f[1]}
                  aria-describedby={'ch-tip-' + scope + '-' + f[0]}
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => {
                    const t = ta.current;
                    if (!t) return;
                    applyFmt(t, f[0]);
                    grow(t);
                    sync();
                    saveSoon();
                  }}
                >
                  <Ic n={f[0]} />
                  <span className="ch-tip" role="tooltip" id={'ch-tip-' + scope + '-' + f[0]}>
                    {f[1]} <kbd>{f[2]}</kbd>
                  </span>
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="ch-pend" data-pend={scope} hidden={!pending.length}>
          {pending.map((a, i) => {
            const label = a.type === 'drive' ? a.name : a.type === 'clip' ? a.title : a.type === 'file' ? a.name : a.title || a.type;
            return (
              <span key={i} className={'ch-pend__i' + (a.preview ? ' ch-pend__i--pic' : '')}>
                {a.preview ? <img src={a.preview} alt="" /> : <Ic n={a.type === 'drive' ? 'drive' : a.type === 'clip' ? 'rec' : a.voice ? 'mic' : 'file'} />}
                <span>
                  {label}
                  {a.uploading ? ' (uploading)' : ''}
                </span>
                <button type="button" data-act="unpend" aria-label="Remove" onClick={() => e.dropPend(scope, a)}>
                  <Ic n="x" />
                </button>
              </span>
            );
          })}
        </div>
        <textarea
          ref={ta}
          rows={1}
          data-ta={scope}
          placeholder={placeholder}
          aria-label={placeholder}
          enterKeyHint="send"
          onInput={(ev) => {
            const t = ev.currentTarget;
            grow(t);
            sync();
            if (!updateSlash(t)) updateMention(t);
            saveSoon();
            e.typing(scope, t.value);
          }}
          onPaste={(ev) => {
            const files = ev.clipboardData && ev.clipboardData.files;
            if (files && files.length) {
              ev.preventDefault();
              e.addFiles(scope, files);
            }
          }}
          onBlur={() => setTimeout(closePop, 150)}
          onKeyDown={(ev) => {
            const t = ev.currentTarget;
            const pp = e.ui.pop;
            if (pp && (pp.kind === 'mention' || pp.kind === 'slash') && pp.scope === scope) {
              const n = pp.kind === 'mention' ? pp.items.length : pp.list.length;
              if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                ev.preventDefault();
                e.setPop({ ...pp, i: (pp.i + (ev.key === 'ArrowDown' ? 1 : n - 1)) % n });
                return;
              }
              if (ev.key === 'Enter' || ev.key === 'Tab') {
                ev.preventDefault();
                if (pp.kind === 'mention') pickMention(pp.i);
                else pickSlash(pp.i);
                return;
              }
              if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                e.setPop(null);
                return;
              }
            }
            if (ev.key === 'Escape') {
              if (scope === 'thread' && !e.dock) {
                ev.preventDefault();
                e.closeRight();
              }
              return;
            }
            const mod = ev.ctrlKey || ev.metaKey;
            const fmt = (f: string) => {
              ev.preventDefault();
              applyFmt(t, f);
              grow(t);
              sync();
              saveSoon();
            };
            if (mod && !ev.altKey && !ev.shiftKey && (ev.key === 'b' || ev.key === 'B')) return fmt('bold');
            if (mod && !ev.altKey && !ev.shiftKey && (ev.key === 'i' || ev.key === 'I')) return fmt('italic');
            if (mod && ev.shiftKey && ev.altKey && ev.code === 'KeyC') return fmt('block');
            if (mod && ev.shiftKey && !ev.altKey && FMT_KEYS[ev.code]) return fmt(FMT_KEYS[ev.code]);
            const phone = matchMedia('(max-width: 860px)').matches;
            if (ev.key === 'Enter' && !ev.nativeEvent.isComposing && (ev.shiftKey || phone)) {
              if (continueList(t)) {
                ev.preventDefault();
                grow(t);
                sync();
                saveSoon();
              }
              return;
            }
            if (ev.key === 'Enter' && !ev.nativeEvent.isComposing) {
              ev.preventDefault();
              doSend();
              return;
            }
            if (ev.key === 'ArrowUp' && !t.value) {
              const pool: J[] = scope === 'thread' ? (e.S.threads[e.S.threadRoot] || {}).replies || [] : e.S.msgs[e.S.active] || [];
              const mine = pool.filter((m) => m.user_id === e.S.me.id && !m.deleted && !m.visible_to && (m.body || '').trim()).pop();
              if (mine) {
                ev.preventDefault();
                e.startEdit(mine.id);
              }
            }
          }}
        />
        <div className="ch-comp__bar">
          <button type="button" className="ch-iconbtn" data-act="plus" aria-label="Add to the message" title="Add a file, Drive file, clip or meeting" onClick={(ev) => e.setPop({ kind: 'plus', scope, anchor: ev.currentTarget.getBoundingClientRect() })}>
            <Ic n="plus" />
          </button>
          <button
            type="button"
            className="ch-iconbtn"
            data-act="at"
            aria-label="Mention someone"
            title="Mention someone"
            onClick={() => {
              const t = ta.current;
              if (!t) return;
              e.boxes[scope]?.insert('@');
              updateMention(t);
            }}
          >
            <Ic n="at" />
          </button>
          <button type="button" className="ch-iconbtn" data-act="emoji" aria-label="Emoji" title="Emoji" onClick={(ev) => e.setPop({ kind: 'emoji', scope, anchor: ev.currentTarget.getBoundingClientRect() })}>
            <Ic n="smile" />
          </button>
          <button type="button" className="ch-iconbtn" data-act="ask-brain" aria-label="Ask Favor Brain" title="Ask Favor Brain" onClick={askBrainHere}>
            <Ic n="spark" />
          </button>
          <button type="button" className={'ch-iconbtn' + (rec ? ' is-on' : '')} data-act="sm-mic" aria-label={rec ? 'Stop recording' : 'Record a voice note'} title="Record a voice note" onClick={micToggle}>
            <Ic n={rec ? 'stop' : 'mic'} />
          </button>
          <span className="ch-comp__sp" />
          <button type="submit" className="ch-send" data-send={scope} disabled={!sendable} aria-label="Send">
            <Ic n="send" />
            <span>Send</span>
          </button>
        </div>
      </div>
      {scope === 'thread' && alsoLabel && (
        <label className="ch-also">
          <input type="checkbox" data-also="" ref={also} />
          <span data-also-label="">{alsoLabel}</span>
        </label>
      )}
      <input
        type="file"
        ref={file}
        multiple
        hidden
        onChange={(ev) => {
          if (ev.currentTarget.files) e.addFiles(scope, ev.currentTarget.files);
          ev.currentTarget.value = '';
        }}
      />
    </form>
  );
}
