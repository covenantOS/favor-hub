// The mention composer: one text box where a picked @mention becomes a solid token, the way Slack's does. Ported from
// public/js/chat/mention-input.js (the box and the rendering of a posted comment) and public/js/projects/ui-mentions.js (the comment form).
//
// A mention is an element in the box, not text. It carries the person's id (their email), deletes as one unit with Backspace or Delete,
// cannot be edited from the inside, and is never re-read from the words around it. value() gives the stored form: plain text with
// <@email> tokens.
//
// The box is a contentEditable element with DOM tokens, so MentionBox is a thin React component: it draws one empty host element and a
// ported DOM controller (attachMention) runs inside it from an effect. The suggestion pop-up and token chips take their styles from one
// <style id="mi-css"> that is added to the page the first time a box or a comment is drawn, exactly as the classic file did.
//
// Contract other lanes rely on (keep these exports and signatures):
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { useStaff } from '../lib/staff';
import { pickPerson } from './pickers';

export interface MentionPerson {
  id: string; // the email
  name: string;
  sub?: string;
  picture?: string;
}
export interface MentionHandle {
  value(): string; // text with <@email> tokens
  setValue(text: string, names?: Record<string, string> | ((id: string) => string)): void;
  isEmpty(): boolean;
  clear(): void;
  focus(): void;
  insertMention(p: { id: string; name: string }): void;
  mentions(): string[];
}
export interface MentionBoxProps {
  /** The people to suggest. A function of the typed words may return an already filtered list. */
  people: (query: string) => MentionPerson[];
  me: string;
  placeholder?: string;
  label?: string;
  onInput?: (h: MentionHandle) => void;
  onSubmit?: (h: MentionHandle) => void;
  handleRef?: Ref<MentionHandle>;
  /** Class of the host element. The comment form uses rq-comp__in. */
  className?: string;
}

/* ---------------------------------------------------------------- styles (added once, browser only) */
const CSS =
  '.mi{display:block;min-height:24px;max-height:180px;overflow-y:auto;outline:0;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;font:400 15px/1.5 Inter,system-ui,sans-serif;color:var(--r-ink,#1d211b);cursor:text;-webkit-user-select:text;user-select:text}' +
  '.mi:empty::before{content:attr(data-placeholder);color:var(--r-ink-3,#666b60);pointer-events:none}' +
  '.mi-chip{display:inline-block;padding:0 6px;margin:0 1px;border-radius:6px;background:var(--tc-sky-tint,#e1edf5);color:var(--tc-sky-ink,#1f5f8b);font-weight:600;line-height:1.45;white-space:nowrap;-webkit-user-select:all;user-select:all;cursor:default}' +
  '.mi .mi-chip.is-sel{box-shadow:0 0 0 2px var(--tc-sky-ink,#1f5f8b)}' +
  '.mi-chip--me{background:var(--tc-sun-tint,#f7ecd2);color:#7a5000;box-shadow:inset 0 0 0 1px #ecd493}' +
  '.mi-pop{position:absolute;z-index:60;left:0;bottom:calc(100% + 6px);min-width:260px;max-width:min(360px,100%);max-height:300px;overflow-y:auto;padding:6px;background:#fff;border:1px solid var(--r-line-2,#d3cdbd);border-radius:12px;box-shadow:0 14px 36px -10px rgba(29,33,27,.35);font:400 14px/1.3 Inter,system-ui,sans-serif;color:var(--r-ink,#1d211b)}' +
  '.mi-pop__h{padding:6px 10px 4px;font:700 13px/1 Inter,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--r-ink-3,#666b60)}' +
  '.mi-pop__i{width:100%;display:flex;align-items:center;gap:10px;min-height:44px;padding:4px 10px 4px 6px;border:0;border-radius:9px;background:none;text-align:left;font:inherit;color:inherit;cursor:pointer}' +
  '.mi-pop__i.is-on,.mi-pop__i:hover{background:var(--r-hover,#f7f5ef)}' +
  '.mi-pop__i b{display:block;font-weight:600;font-size:14px}.mi-pop__i small{display:block;font-size:13px;color:var(--r-ink-3,#666b60);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
  '.mi-pop__t{min-width:0;flex:1}' +
  '.mi-av{flex:none;width:28px;height:28px;border-radius:8px;display:grid;place-items:center;overflow:hidden;font:700 11px/1 Inter,system-ui,sans-serif;color:#3f4852}' +
  '.mi-av img{width:100%;height:100%;object-fit:cover;display:block}' +
  '@media (max-width:860px){.mi{font-size:16px}}';

export function injectMentionStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('mi-css')) return;
  const st = document.createElement('style');
  st.id = 'mi-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

/* ---------------------------------------------------------------- small helpers */
const ZW = '​';
const COLORS = ['#f7ecd2', '#e1edf5', '#e1efdc', '#e9e5f4', '#f8e5dc', '#dcefee', '#e6e9ec'];
const esc = (s: unknown): string =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const hash = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};
const initials = (n: string): string =>
  String(n || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
type Names = Record<string, string> | ((id: string) => string) | undefined;
const nameFrom = (names: Names, id: string): string => {
  const n = typeof names === 'function' ? names(id) : names && names[id];
  return n || String(id || '').split('@')[0];
};
const newToken = () => /<@([^>\s]+)>/g;

function avatarHtml(p: MentionPerson): string {
  const inner = p.picture ? '<img src="' + esc(p.picture) + '" alt="" referrerpolicy="no-referrer" />' : esc(initials(p.name));
  return '<span class="mi-av" style="background:' + COLORS[hash(String(p.id)) % 7] + '">' + inner + '</span>';
}

function chipEl(id: string, name: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'mi-chip';
  s.contentEditable = 'false';
  s.setAttribute('data-mi-id', id);
  s.textContent = '@' + name;
  return s;
}
function fill(el: HTMLElement, text: string, names: Names): void {
  el.textContent = '';
  const t = String(text || '');
  let last = 0;
  const re = newToken();
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m.index > last) el.appendChild(document.createTextNode(t.slice(last, m.index)));
    const id = m[1].toLowerCase();
    el.appendChild(chipEl(id, nameFrom(names, id)));
    last = m.index + m[0].length;
  }
  if (last < t.length) el.appendChild(document.createTextNode(t.slice(last)));
}
function read(node: Node): string {
  let out = '';
  node.childNodes.forEach((n) => {
    if (n.nodeType === 3) out += (n.nodeValue || '').replace(/​/g, '').replace(/ /g, ' ');
    else if (n.nodeType !== 1) return;
    else {
      const e = n as HTMLElement;
      if (e.hasAttribute('data-mi-id')) out += '<@' + e.getAttribute('data-mi-id') + '>';
      else if (e.tagName === 'BR') out += '\n';
      else {
        // A block the browser added for a new line.
        const inner = read(e);
        out += (out && !/\n$/.test(out) ? '\n' : '') + inner;
      }
    }
  });
  return out;
}

/* ---------------------------------------------------------------- the stored text drawn as a posted comment */
interface EntityGlobal {
  chip?: (kind: string, id: string, name: string) => string;
}
/** Safe HTML for a posted comment: the same tokens, links and **bold** as the classic render(). Everything is escaped first. */
export function mentionHtml(text: string, names: Names, me: string, withEntities = false): string {
  let t = esc(text || '');
  t = t.replace(/&lt;@([^&\s]+?)&gt;/g, (_m, id0: string) => {
    const id = id0.toLowerCase();
    return '<span class="mi-chip' + (me && id === me ? ' mi-chip--me' : '') + '" data-mi-id="' + esc(id) + '">@' + esc(nameFrom(names, id)) + '</span>';
  });
  t = t.replace(/&lt;~([pf]):(\d{1,12})\|(.{1,160}?)&gt;/g, (_m, k: string, id: string, name: string) => {
    const un = (x: string) => x.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    const ent = withEntities && typeof window !== 'undefined' ? (window as unknown as { FavorEntity?: EntityGlobal }).FavorEntity : undefined;
    return ent && ent.chip ? ent.chip(k === 'f' ? 'fund' : 'partner', id, un(name)) : '<span class="ch-ent ch-ent--' + k + '">' + name + '</span>';
  });
  t = t.replace(/(https?:\/\/[^\s<]+[^\s<).,;:!?])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  return t;
}
/** The text with each token written as @Name (notices, previews). */
export function mentionPlain(text: string, names?: Names): string {
  return String(text || '')
    .replace(/<~[pf]:\d+\|([^>]+)>/g, '$1')
    .replace(newToken(), (_m, id: string) => '@' + nameFrom(names, id.toLowerCase()));
}

/* ---------------------------------------------------------------- the box (ported DOM controller) */
interface AttachOpts {
  people: (q: string) => MentionPerson[];
  me: string;
  placeholder?: string;
  label?: string;
  onInput?: () => void;
  onSubmit?: () => void;
  defaultNames: (id: string) => string;
}
interface Controller {
  el: HTMLElement;
  value(): string;
  setValue(text: string, names?: Names): void;
  isEmpty(): boolean;
  clear(): void;
  focus(): void;
  insertMention(p: { id: string; name: string }): void;
  insertText(text: string): void;
  mentions(): string[];
  setLabels(placeholder: string, label: string): void;
  destroy(): void;
}
interface Suggest {
  node: Text;
  start: number;
  end: number;
  list: MentionPerson[];
  i: number;
}

function attachMention(host: HTMLElement, getOpts: () => AttachOpts): Controller {
  injectMentionStyles();
  const max = 4000;
  const phone = () => matchMedia('(max-width: 860px)').matches;
  const enterSends = () => !phone();
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const o0 = getOpts();
  const el = document.createElement('div');
  el.className = 'mi';
  el.contentEditable = 'true';
  el.setAttribute('role', 'textbox');
  el.setAttribute('aria-multiline', 'true');
  el.setAttribute('aria-label', o0.label || o0.placeholder || 'Message');
  el.setAttribute('data-placeholder', o0.placeholder || '');
  el.setAttribute('enterkeyhint', 'send');
  el.spellcheck = true;
  host.appendChild(el);

  let pop: HTMLDivElement | null = null;
  let st: Suggest | null = null;
  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  const changed = () => {
    // An emptied box must be truly empty, or the placeholder stays hidden behind a stray line break.
    if (!read(el).trim() && !el.querySelector('[data-mi-id]')) el.textContent = '';
    getOpts().onInput?.();
  };
  const closePop = () => {
    if (pop) {
      pop.remove();
      pop = null;
    }
    st = null;
    el.removeAttribute('aria-activedescendant');
  };

  function candidates(q: string): MentionPerson[] {
    const o = getOpts();
    const list = o.people(q) || [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const first = words[0] || '';
    const rank = (p: MentionPerson) => {
      const n = String(p.name).toLowerCase();
      return !first ? 0 : n.indexOf(first) === 0 ? 0 : n.split(/\s+/).some((w) => w.indexOf(first) === 0) ? 1 : 2;
    };
    const ok = (p: MentionPerson) => {
      const hay = (p.name + ' ' + (p.sub || '')).toLowerCase();
      return words.every((w) => hay.indexOf(w) >= 0);
    };
    return list
      .filter((p) => p.id !== o.me && ok(p))
      .map((p, i) => ({ p, i, r: rank(p) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.p)
      .slice(0, 7);
  }

  function caret(): Range | null {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
    const r = sel.getRangeAt(0);
    if (!el.contains(r.startContainer)) return null;
    return r;
  }

  function suggest() {
    const r = caret();
    if (!r || r.startContainer.nodeType !== 3) {
      closePop();
      return;
    }
    const node = r.startContainer as Text;
    const before = (node.nodeValue || '').slice(0, r.startOffset);
    const m = before.match(/(^|[\s​(])@([\w.'-]*(?: [\w.'-]*)?)$/);
    if (!m || m[2].length > 24) {
      closePop();
      return;
    }
    const list = candidates(m[2]);
    if (!list.length) {
      closePop();
      return;
    }
    st = { node, start: r.startOffset - m[2].length - 1, end: r.startOffset, list, i: 0 };
    if (!pop) {
      const p = document.createElement('div');
      p.className = 'mi-pop';
      p.setAttribute('role', 'listbox');
      p.setAttribute('aria-label', 'People');
      host.appendChild(p);
      // Pressing a row must not take the caret out of the box.
      p.addEventListener('mousedown', (e) => e.preventDefault());
      p.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('[data-i]');
        if (b && st) pick(st.list[+(b.getAttribute('data-i') || 0)]);
      });
      pop = p;
    }
    pop.innerHTML =
      '<div class="mi-pop__h">People</div>' +
      list
        .map(
          (p, i) =>
            '<button type="button" class="mi-pop__i' + (i === 0 ? ' is-on' : '') + '" role="option" id="mi-opt-' + i + '" data-i="' + i + '" aria-selected="' + (i === 0) + '">' +
            avatarHtml(p) + '<span class="mi-pop__t"><b>' + esc(p.name) + '</b>' + (p.sub ? '<small>' + esc(p.sub) + '</small>' : '') + '</span></button>'
        )
        .join('');
  }

  function placeAfter(node: Node) {
    const sel = window.getSelection();
    if (!sel) return;
    const r = document.createRange();
    r.setStartAfter(node);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  /** Puts a token where the typed @name was, or at the caret, followed by a space to keep typing in. */
  function pick(p: { id: string; name: string }) {
    let range: Range | null;
    if (st && st.node.parentNode) {
      range = document.createRange();
      range.setStart(st.node, st.start);
      range.setEnd(st.node, Math.min(st.end, (st.node.nodeValue || '').length));
    } else {
      el.focus();
      range = caret();
      if (!range) {
        range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
      }
    }
    range.deleteContents();
    const chip = chipEl(p.id, p.name);
    const space = document.createTextNode(' ');
    range.insertNode(space);
    range.insertNode(chip);
    // A token needs text on its left to put a caret there; a zero-width mark does it when the token starts the box or follows another.
    const prev = chip.previousSibling;
    if (!prev || (prev.nodeType === 1 && (prev as HTMLElement).hasAttribute('data-mi-id'))) chip.parentNode!.insertBefore(document.createTextNode(ZW), chip);
    placeAfter(space);
    closePop();
    changed();
  }

  /** The token next to a collapsed caret, on the side given (-1 before it, 1 after it). */
  function chipBeside(dir: number): HTMLElement | null {
    const r = caret();
    if (!r) return null;
    const c = r.startContainer;
    const o = r.startOffset;
    let node: Node | null;
    if (c.nodeType === 3) {
      const v = c.nodeValue || '';
      if (dir < 0 && v.slice(0, o).replace(/​/g, '') !== '') return null;
      if (dir > 0 && v.slice(o).replace(/​/g, '') !== '') return null;
      node = dir < 0 ? c.previousSibling : c.nextSibling;
    } else {
      node = dir < 0 ? c.childNodes[o - 1] : c.childNodes[o];
    }
    // Step over an empty or zero-width text node.
    while (node && node.nodeType === 3 && (node.nodeValue || '').replace(/​/g, '') === '') node = dir < 0 ? node.previousSibling : node.nextSibling;
    return node && node.nodeType === 1 && (node as HTMLElement).hasAttribute('data-mi-id') ? (node as HTMLElement) : null;
  }

  el.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (st && pop) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const s = st;
        s.i = (s.i + (e.key === 'ArrowDown' ? 1 : s.list.length - 1)) % s.list.length;
        pop.querySelectorAll<HTMLElement>('.mi-pop__i').forEach((b, i) => {
          b.classList.toggle('is-on', i === s.i);
          b.setAttribute('aria-selected', String(i === s.i));
          if (i === s.i) b.scrollIntoView({ block: 'nearest' });
        });
        el.setAttribute('aria-activedescendant', 'mi-opt-' + s.i);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(st.list[st.i]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closePop();
        return;
      }
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const chip = chipBeside(e.key === 'Backspace' ? -1 : 1);
      if (chip) {
        e.preventDefault();
        const mark = chip.previousSibling;
        if (mark && mark.nodeType === 3 && mark.nodeValue === ZW) mark.parentNode!.removeChild(mark);
        chip.remove();
        changed();
        return;
      }
    }
    if (e.key === 'Enter') {
      if (e.metaKey || e.ctrlKey || (!e.shiftKey && enterSends())) {
        e.preventDefault();
        if (getOpts().onSubmit && !api.isEmpty()) getOpts().onSubmit!();
        return;
      }
      // A new line is a line break, never a new block.
      e.preventDefault();
      document.execCommand('insertLineBreak');
      changed();
    }
  });
  el.addEventListener('input', () => {
    if (read(el).length > max) {
      fill(el, read(el).slice(0, max), (id) => {
        const c = el.querySelector('[data-mi-id="' + id + '"]');
        return c ? (c.textContent || '').slice(1) : id.split('@')[0];
      });
    }
    changed();
    suggest();
  });
  el.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') suggest();
  });
  el.addEventListener('click', suggest);
  el.addEventListener('blur', () => {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(closePop, 150);
  });
  // Pasted and dropped content comes in as plain text: no fonts, no pictures, no foreign tokens.
  el.addEventListener('paste', (e) => {
    e.preventDefault();
    const t = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    document.execCommand('insertText', false, t.replace(/\r\n?/g, '\n'));
  });
  el.addEventListener('drop', (e) => e.preventDefault());

  const api: Controller = {
    el,
    value: () => read(el).replace(/\n{3,}/g, '\n\n').trim(),
    setValue: (text, names) => {
      const dflt = getOpts().defaultNames;
      fill(el, text, (id) => (typeof names === 'function' ? names(id) : names && names[id]) || dflt(id));
      changed();
    },
    isEmpty: () => !read(el).trim(),
    clear: () => {
      el.textContent = '';
      closePop();
      changed();
    },
    focus: () => {
      el.focus();
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(r);
      }
    },
    insertMention: (p) => {
      if (document.activeElement !== el) api.focus();
      st = null;
      pick(p);
    },
    insertText: (text) => {
      if (document.activeElement !== el) api.focus();
      document.execCommand('insertText', false, String(text));
      changed();
    },
    mentions: () => Array.from(el.querySelectorAll('[data-mi-id]'), (c) => c.getAttribute('data-mi-id') as string),
    setLabels: (placeholder, label) => {
      el.setAttribute('data-placeholder', placeholder || '');
      el.setAttribute('aria-label', label || placeholder || 'Message');
    },
    destroy: () => {
      clearTimeout(blurTimer);
      closePop();
      el.remove();
    },
  };
  return api;
}

/* ---------------------------------------------------------------- React */
export function MentionBox(props: MentionBoxProps) {
  const staff = useStaff();
  const hostRef = useRef<HTMLDivElement>(null);
  const ctl = useRef<Controller | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const staffRef = useRef(staff);
  staffRef.current = staff;

  // A handle that stays the same object for the life of the box and reaches whatever controller is attached.
  const handle = useMemo<MentionHandle>(
    () => ({
      value: () => (ctl.current ? ctl.current.value() : ''),
      setValue: (text, names) => ctl.current?.setValue(text, names),
      isEmpty: () => (ctl.current ? ctl.current.isEmpty() : true),
      clear: () => ctl.current?.clear(),
      focus: () => ctl.current?.focus(),
      insertMention: (p) => ctl.current?.insertMention(p),
      mentions: () => (ctl.current ? ctl.current.mentions() : []),
    }),
    []
  );
  useImperativeHandle(props.handleRef, () => handle, [handle]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const c = attachMention(host, () => ({
      people: (q) => latest.current.people(q),
      me: latest.current.me,
      placeholder: latest.current.placeholder,
      label: latest.current.label,
      onInput: () => latest.current.onInput?.(handle),
      onSubmit: latest.current.onSubmit ? () => latest.current.onSubmit?.(handle) : undefined,
      defaultNames: (id) => staffRef.current.nameOf(id),
    }));
    ctl.current = c;
    return () => {
      c.destroy();
      ctl.current = null;
    };
  }, [handle]);

  useEffect(() => {
    ctl.current?.setLabels(props.placeholder || '', props.label || '');
  }, [props.placeholder, props.label]);

  return <div ref={hostRef} className={props.className ?? 'rq-comp__in'} data-mi="" />;
}

const AT = '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>';
const SEND = '<path d="M4 12 20 4l-4 16-4-6z"/><path d="m12 14 8-10"/>';
const Svg = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />;

/** The comment form: the box, an @ button and a Send button. onSend may throw; the text is put back then. */
export function CommentComposer({ onSend, placeholder }: { onSend: (text: string) => Promise<void>; placeholder?: string }) {
  const staff = useStaff();
  const box = useRef<MentionHandle>(null);
  const busy = useRef(false);
  const [empty, setEmpty] = useState(true);
  const me = staff.me;
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;

  const people = useMemo(
    () => (): MentionPerson[] =>
      staff.list.map((p) => ({ id: p.email, name: p.name, sub: [p.team, p.title].filter(Boolean).join(' · '), picture: p.picture })),
    [staff]
  );

  const submit = async () => {
    const b = box.current;
    if (!b || busy.current || b.isEmpty()) return;
    busy.current = true;
    const text = b.value();
    const names: Record<string, string> = {};
    b.mentions().forEach((id) => {
      names[id] = staff.nameOf(id);
    });
    b.clear();
    setEmpty(true);
    try {
      await onSendRef.current(text);
    } catch {
      b.setValue(text, names);
      setEmpty(b.isEmpty());
    }
    busy.current = false;
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;

  const at = async () => {
    const r = await pickPerson({ title: 'Mention someone', exclude: [me] });
    if (r && r.email) {
      const p = staff.personOf(r.email)!;
      box.current?.focus();
      box.current?.insertMention({ id: p.email, name: p.name });
    }
  };

  return (
    <form
      className="rq-comp"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        void submitRef.current();
      }}
    >
      <div className="rq-comp__box">
        <MentionBox
          handleRef={box}
          people={people}
          me={me}
          placeholder={placeholder || 'Write a comment, or @ to bring someone in'}
          label="Comment"
          onInput={(b) => setEmpty(b.isEmpty())}
          onSubmit={() => void submitRef.current()}
        />
        <div className="rq-comp__bar">
          <button type="button" className="rq-comp__at" data-at="" aria-label="Mention someone" onClick={() => void at()}>
            <Svg d={AT} />
          </button>
          <span className="rq-comp__sp" />
          <button type="submit" className="rq-comp__send" disabled={empty} aria-label="Send">
            <Svg d={SEND} />
            <span>Send</span>
          </button>
        </div>
      </div>
    </form>
  );
}

/** A stored comment drawn as text with each token as an @Name chip, links and **bold**. */
export function CommentText({ body, me }: { body: string; me: string }) {
  const staff = useStaff();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    injectMentionStyles();
    setReady(true);
  }, []);
  const html = useMemo(() => mentionHtml(body, (id) => staff.nameOf(id), me, ready), [body, me, staff, ready]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

export const mentionsIn = (text: string): string[] => [...new Set<string>([...String(text).matchAll(/<@([^>\s]+)>/g)].map((m): string => m[1]))];
