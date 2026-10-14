/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import { MI, hue, initials, kindOf, size, when, who } from './util';
import { getApi } from './mailApi';
import { KIND_NAME } from './Assist';

export interface ThreadTools {
  inInbox: boolean;
  unread: boolean;
  starred: boolean;
  inTrash: boolean;
  labels: Record<string, 1>;
}
export function toolsOf(t: any): ThreadTools {
  const msgs: any[] = (t && t.messages) || [];
  const labels: Record<string, 1> = {};
  msgs.forEach((m) => (m.labelIds || []).forEach((l: string) => (labels[l] = 1)));
  return { inInbox: !!labels.INBOX, unread: msgs.some((m) => m.unread), starred: msgs.some((m) => m.starred), inTrash: !!labels.TRASH, labels };
}


const ENT_RE = /\b[A-Z]\d{2}[0-9A-C]-[A-Z0-9]{1,14}\b|\b(?:Lookup ID|lookup id|Constituent ID|ID)\s*[:#]?\s*(\d{3,7})\b/g;
export interface EntityApi {
  names: string[];
  load: (kind: string, q: string) => Promise<any>;
  open: (card: any) => void;
}
function markEntities(d: Document, names: string[]) {
  if (!d || !d.body || d.body.dataset.fosEnt) return;
  d.body.dataset.fosEnt = '1';
  const esc = (n: string) => n.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c);
  const fundRe = names && names.length ? new RegExp('\\b(' + names.slice(0, 200).map(esc).join('|') + ')\\b', 'g') : null;
  const walker = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && !n.parentElement.closest('a,script,style,.fos-ent') && /\S/.test(n.nodeValue || '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nodes: Node[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.slice(0, 400).forEach((n) => {
    const text = n.nodeValue || '';
    const hits: Array<{ i: number; t: string; k: string; q: string }> = [];
    let m: RegExpExecArray | null;
    ENT_RE.lastIndex = 0;
    while ((m = ENT_RE.exec(text))) hits.push({ i: m.index, t: m[0], k: m[1] ? 'lookup' : 'appeal', q: m[1] || m[0] });
    if (fundRe) {
      fundRe.lastIndex = 0;
      while ((m = fundRe.exec(text))) hits.push({ i: m.index, t: m[0], k: 'fund', q: m[0] });
    }
    if (!hits.length) return;
    hits.sort((a, b) => a.i - b.i);
    const frag = d.createDocumentFragment();
    let at = 0;
    hits.forEach((h) => {
      if (h.i < at) return;
      frag.appendChild(d.createTextNode(text.slice(at, h.i)));
      const sp = d.createElement('span');
      sp.className = 'fos-ent';
      sp.dataset.k = h.k;
      sp.dataset.q = h.q;
      sp.textContent = h.t;
      frag.appendChild(sp);
      at = h.i + h.t.length;
    });
    frag.appendChild(d.createTextNode(text.slice(at)));
    n.parentNode?.replaceChild(frag, n);
  });
  const st = d.createElement('style');
  st.textContent = '.fos-ent{border-bottom:1px dotted #235578;cursor:help}';
  d.head.appendChild(st);
}

const frameDoc = (html: string) => {
  const o = location.origin;
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data: ${o}; style-src 'unsafe-inline' https:; font-src https: data:; media-src https: ${o}">` +
    '<base target="_blank"><style>html,body{margin:0;padding:0;background:transparent}body{font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;color:#1d211b;overflow-wrap:anywhere;word-break:break-word;display:flow-root}' +
    'img{max-width:100%;height:auto}pre{white-space:pre-wrap}a{color:#235578}blockquote{margin:6px 0 6px 2px;padding-left:12px;border-left:3px solid #e4e0d4;color:#464c42}' +
    'html.fos-fold .fos-q{display:none!important}table{max-width:100%}</style></head><body>' +
    html +
    '</body></html>'
  );
};

/** A message body in a sandboxed frame (no scripts) sized to its content, with quoted text folded away as in Gmail. */
function MessageFrame({ html, title, fold, ent }: { html: string; title: string; fold: boolean; ent?: EntityApi & { tip: (c: any, rect: DOMRect | null) => void } }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [hasQuote, setHasQuote] = useState(false);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const full = useRef(false);
  const fitRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const f = frame.current;
    const b = box.current;
    if (!f || !b) return;
    let ro: ResizeObserver | null = null;
    const onload = () => {
      let d: Document | null = null;
      try {
        d = f.contentDocument;
      } catch {
        return;
      }
      if (!d || !d.body) return;
      const doc = d;
      // The frame never scrolls on its own, so its height always covers the message: measured again when the pane changes
      // width, when images and fonts arrive and when quoted text opens. A very long message stops at 2,400 px with a button.
      let lastW = -1;
      const fit = () => {
        const w = b.clientWidth;
        if (!w) return;
        if (w !== lastW) {
          lastW = w;
          doc.body.style.zoom = '';
          const sw = doc.documentElement.scrollWidth;
          if (sw > w + 4) doc.body.style.zoom = String(Math.max(0.4, w / sw));
        }
        const cur = f.clientHeight;
        const over = doc.documentElement.scrollHeight;
        const h = Math.ceil(over > cur + 1 ? over : doc.body.getBoundingClientRect().height);
        if (Math.abs(h - cur) > 1) f.style.height = h + 'px';
        if (h > 3200 && !full.current) setLong(true);
      };
      fitRef.current = fit;
      if (fold) {
        const q = doc.querySelector('.gmail_quote, blockquote[type="cite"], #appendonsend, .yahoo_quoted, #divRplyFwdMsg');
        if (q) {
          let top: Element = q;
          while (top.parentElement && top.parentElement !== doc.body && top.parentElement.children.length === 1) top = top.parentElement;
          top.classList.add('fos-q');
          if (top.id === 'divRplyFwdMsg' || top.id === 'appendonsend') {
            let n = top.nextElementSibling;
            while (n) {
              n.classList.add('fos-q');
              n = n.nextElementSibling;
            }
          }
          doc.documentElement.classList.add('fos-fold');
          setHasQuote(true);
        }
      }
      fit();
      if (ent) {
        markEntities(doc, ent.names);
        let tt = 0;
        doc.addEventListener('mouseover', (e) => {
          const el = (e.target as Element).closest?.('.fos-ent') as HTMLElement | null;
          if (!el) return;
          clearTimeout(tt);
          tt = window.setTimeout(() => {
            void ent.load(el.dataset.k || '', el.dataset.q || '').then((c) => {
              if (!c) return;
              const fr = f.getBoundingClientRect();
              const r = el.getBoundingClientRect();
              ent.tip(c, new DOMRect(fr.left + r.left, fr.top + r.bottom, r.width, r.height));
            });
          }, 250);
        });
        doc.addEventListener('mouseout', (e) => {
          if ((e.target as Element).closest?.('.fos-ent')) {
            clearTimeout(tt);
            ent.tip(null, null);
          }
        });
        doc.addEventListener('click', (e) => {
          const el = (e.target as Element).closest?.('.fos-ent') as HTMLElement | null;
          if (!el) return;
          e.preventDefault();
          void ent.load(el.dataset.k || '', el.dataset.q || '').then((c) => {
            if (!c) return;
            ent.tip(null, null);
            ent.open(c);
          });
        });
      }
      doc.querySelectorAll('img').forEach((im) => {
        if (!im.complete) {
          im.addEventListener('load', fit);
          im.addEventListener('error', fit);
        }
      });
      if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(fit).catch(() => undefined);
      window.setTimeout(fit, 400);
      window.setTimeout(fit, 1500);
      if (window.ResizeObserver) {
        ro = new ResizeObserver(() => requestAnimationFrame(fit));
        ro.observe(doc.body);
        ro.observe(b);
      }
      // A selection inside the message reaches the page (Ask Favor Brain about the selected words).
      let selT = 0;
      doc.addEventListener('selectionchange', () => {
        clearTimeout(selT);
        selT = window.setTimeout(() => {
          const sel = doc.getSelection();
          const text = sel && sel.rangeCount ? String(sel).trim() : '';
          let rect: Record<string, number> | null = null;
          if (sel && text) {
            const fr = f.getBoundingClientRect();
            const r = sel.getRangeAt(0).getBoundingClientRect();
            const z = parseFloat(doc.body.style.zoom) || 1;
            rect = { left: fr.left + r.left * z, top: fr.top + r.top * z, right: fr.left + r.right * z, bottom: fr.top + r.bottom * z, width: r.width * z, height: r.height * z };
          }
          window.dispatchEvent(new CustomEvent('favor-mail-selection', { detail: { text: text.slice(0, 4000), rect } }));
        }, 120);
      });
      // Keys pressed inside the message reach the page's shortcuts.
      doc.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || (!e.metaKey && !e.ctrlKey && /^[jkeuarf#/c]$/.test(e.key))) document.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, shiftKey: e.shiftKey }));
      });
    };
    f.addEventListener('load', onload);
    return () => {
      f.removeEventListener('load', onload);
      ro?.disconnect();
    };
  }, [html, fold]);
  const unfold = () => {
    const d = frame.current?.contentDocument;
    if (!d) return;
    d.documentElement.classList.toggle('fos-fold');
    setOpen((v) => !v);
    requestAnimationFrame(() => fitRef.current());
  };
  return (
    <>
      <div className={'ml-frame' + (long ? ' is-long' : '')} ref={box}>
        <iframe ref={frame} className="ml-iframe" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" title={title} scrolling="no" srcDoc={frameDoc(html || '<p style="color:#666b60">(no text)</p>')} />
        {long && (
          <button
            type="button"
            className="ml-longbtn"
            onClick={() => {
              full.current = true;
              setLong(false);
              requestAnimationFrame(() => fitRef.current());
            }}
          >
            Show the whole message
          </button>
        )}
      </div>
      {hasQuote && (
        <button type="button" className="ml-fold" onClick={unfold} aria-label={open ? 'Hide quoted text' : 'Show quoted text'} title="Show quoted text">
          <MI n="more" />
        </button>
      )}
    </>
  );
}

export const recipLine = (m: any, me: string) => {
  const to: any[] = (m.to || []).concat(m.cc || []);
  const first = (a: any) => (a && a.email === me ? 'me' : a && a.name ? String(a.name).split(/\s+/)[0] : who(a));
  return 'to ' + (to.length ? to.slice(0, 3).map(first).join(', ') + (to.length > 3 ? ' and ' + (to.length - 3) + ' more' : '') : 'undisclosed recipients');
};

export function replyAllList(m: any, me: string): any[] {
  if (!m) return [];
  const out: any[] = [];
  const seen: Record<string, 1> = {};
  const add = (a: any) => {
    if (a && a.email && !seen[a.email] && a.email !== me) {
      seen[a.email] = 1;
      out.push(a);
    }
  };
  (m.replyTo && m.replyTo.length ? m.replyTo : [m.from]).forEach(add);
  (m.to || []).forEach(add);
  (m.cc || []).forEach(add);
  if (!out.length && m.from && m.from.email === me)
    (m.to || []).forEach((a: any) => {
      if (!seen[a.email]) {
        seen[a.email] = 1;
        out.push(a);
      }
    });
  return out;
}

/** The same actions on every open message, aligned on the right of its header: star, reply, and more (reply all, forward, a new window). */
function MsgTools({ m, c }: { m: any; c: ReaderProps }) {
  const [menu, setMenu] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const starred = toolsOf(c.thread).starred;
  useEffect(() => {
    if (!menu) return;
    const off = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('pointerdown', off);
    document.addEventListener('keydown', off);
    return () => {
      document.removeEventListener('pointerdown', off);
      document.removeEventListener('keydown', off);
    };
  }, [menu]);
  const many = replyAllList(m, c.me).length > 1;
  const pick = (k: 'reply' | 'replyall' | 'forward', pop?: boolean) => {
    setMenu(false);
    c.onReply(k, m, pop);
  };
  return (
    <span className="ml-msg__tools" ref={box}>
      <button type="button" className={'ml-iconbtn ml-star' + (starred ? ' is-on' : '')} onClick={(e) => c.onAct('star', e.currentTarget)} aria-pressed={starred} aria-label={starred ? 'Remove star' : 'Star'} title="Star (s)">
        <MI n="star" />
      </button>
      <button type="button" className="ml-iconbtn" onClick={(e) => c.onReply('reply', m, e.shiftKey)} aria-label="Reply" title="Reply (r)">
        <MI n="reply" />
      </button>
      <button type="button" className="ml-iconbtn" data-act="msg-more" onClick={() => setMenu((v) => !v)} aria-label="More for this message" title="Reply all, forward" aria-haspopup="menu" aria-expanded={menu}>
        <MI n="more" />
      </button>
      {menu && (
        <span className="ml-msgmenu" role="menu">
          <button type="button" role="menuitem" onClick={() => pick('reply')}>
            <MI n="reply" />
            Reply
          </button>
          {many && (
            <button type="button" role="menuitem" onClick={() => pick('replyall')}>
              <MI n="replyall" />
              Reply all
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => pick('forward')}>
            <MI n="fwd" />
            Forward
          </button>
          <button type="button" role="menuitem" onClick={() => pick('reply', true)}>
            <MI n="ext" />
            Reply in a new window
          </button>
        </span>
      )}
    </span>
  );
}

function Msg({ m, i, all, c }: { m: any; i: number; all: any[]; c: ReaderProps }) {
  const lastReal = all.filter((x) => !x.draft).slice(-1)[0];
  const dflt = !!m.unread || m === lastReal || !!m.draft || all.length === 1;
  const open = c.exp[m.id] != null ? c.exp[m.id] : dflt;
  const p = c.partners[(m.from || {}).email];
  const files = (m.attachments || []).filter((f: any) => !f.inline || !/^image\//.test(f.mime));
  const api = getApi();
  return (
    <article className={'ml-msg' + (open ? ' is-open' : '') + (m.draft ? ' is-draft' : '')} data-mid={m.id}>
      <div className="ml-msg__head">
      <button type="button" className="ml-msg__tog" aria-expanded={open} onClick={() => c.onToggle(m.id, !open)}>
        <span className="ml-av" data-h={hue((m.from || {}).email || '')}>
          {initials(m.from && m.from.email === c.me ? c.name : who(m.from))}
        </span>
        <span className="ml-msg__who">
          <span className="ml-msg__l1">
            <b>{m.draft ? 'Draft' : who(m.from) || '(no sender)'}</b>
            {open && m.from && m.from.name ? <small>{m.from.email}</small> : null}
          </span>
          <span className="ml-msg__l2">{open ? recipLine(m, c.me) : m.snippet || ''}</span>
        </span>
        <time dateTime={m.date} title={when(m.date, true)}>
          {when(m.date)}
        </time>
      </button>
      {open && !m.draft && <MsgTools m={m} c={c} />}
      </div>
      {open && (
        <div className="ml-msg__body">
          {p && (
            <a className="ml-partner" href={'/work/partner/' + encodeURIComponent(p.id)}>
              <MI n="person" />
              <span>{p.name || 'Partner'}</span>
              <em>Partner in Blackbaud</em>
            </a>
          )}
          {c.headersOnly ? <div className="ml-hdronly">{m.snippet || ''}</div> : <MessageFrame html={m.html} title={'Message from ' + who(m.from)} fold={i > 0} ent={c.headersOnly ? undefined : c.ent} />}
          {files.length > 0 && (
            <div className="ml-files">
              {files.map((f: any, k: number) => {
                const kind = kindOf(f.mime, f.name);
                const url = api.fileUrl(m.id, f, false, c.box);
                return (
                  <div className="ml-file" key={f.id || k}>
                    <button type="button" className="ml-file__open" onClick={() => (c.onViewFile ? c.onViewFile(m, f, files) : window.open(url, '_blank'))}>
                      {kind === 'image' ? <img src={url} alt="" loading="lazy" decoding="async" /> : <span className="ml-fic" data-k={kind}>{(String(f.name).split('.').pop() || 'file').slice(0, 4).toUpperCase()}</span>}
                      <span className="ml-file__t">
                        <b>{f.name}</b>
                        <small>{size(f.size)}</small>
                      </span>
                    </button>
                    <a className="ml-iconbtn" href={api.fileUrl(m.id, f, true, c.box)} download={f.name} aria-label={'Download ' + f.name} title="Download">
                      <MI n="dl" />
                    </a>
                    {(() => {
                      const r = c.fileKinds && c.fileKinds[m.id + '|' + f.id];
                      return r && KIND_NAME[r.kind] ? (
                        <span className="ml-fk">
                          <em className="ml-chip">{KIND_NAME[r.kind]}</em>
                          {r.next ? r.next.href ? <a className="ml-linkbtn" href={r.next.href}>{r.next.text}</a> : <span>{r.next.text}</span> : null}
                        </span>
                      ) : null;
                    })()}
                  </div>
                );
              })}
            </div>
          )}
          {m.draft && (
            <div className="ml-msg__acts">
              <button type="button" className="ml-btn ml-btn--primary" onClick={() => c.onEditDraft(m.id)}>
                <MI n="pen" />
                Edit draft
              </button>
              <button type="button" className="ml-btn" onClick={() => c.onDropDraft(m.id)}>
                <MI n="trash" />
                Discard
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export interface ReaderProps {
  thread: any;
  loading: boolean;
  listTitle: string;
  me: string;
  name: string;
  box: string;
  partners: Record<string, any>;
  headersOnly: boolean;
  labels: any[];
  exp: Record<string, boolean>;
  snoozedNote?: string;
  onToggle: (mid: string, open: boolean) => void;
  onAct: (kind: string, anchor?: HTMLElement) => void;
  onReply: (kind: 'reply' | 'replyall' | 'forward', m?: any, pop?: boolean) => void;
  onEditDraft: (mid: string) => void;
  /** Gmail draft ids by message id, so a draft being written in the composer is not shown twice. */
  drafts?: Record<string, string>;
  onDropDraft: (mid: string) => void;
  extra?: React.ReactNode;
  suggested?: React.ReactNode;
  fileKinds?: Record<string, any>;
  ent?: EntityApi & { tip: (c: any, rect: DOMRect | null) => void };
  onViewFile?: (m: any, f: any, files: any[]) => void;
}

export function Reader(c: ReaderProps) {
  const t = c.thread || { id: '', subject: '', messages: [] };
  const msgs: any[] = t.messages || [];
  const st = toolsOf(t);
  const own = Object.keys(st.labels).filter((l) => c.labels.some((x) => x.id === l && x.type === 'user'));
  const labelName = (id: string) => (c.labels.find((x) => x.id === id) || {}).name || id;
  const partner = (() => {
    for (const m of msgs) {
      const p = c.partners[(m.from || {}).email];
      if (p) return p;
    }
    const k = Object.keys(c.partners)[0];
    return k ? c.partners[k] : null;
  })();
  const last = msgs.filter((m) => !m.draft).slice(-1)[0];
  const act = (k: string) => (e: React.MouseEvent) => c.onAct(k, e.currentTarget as HTMLElement);
  const hostRef = useRef<HTMLDivElement>(null);
  const extRef = useRef<HTMLSpanElement>(null);
  // Once per drawn conversation: the composer learns where its inline reply goes, and other parts of FavorOS get the toolbar slot.
  const ready = !c.loading && !!last;
  useEffect(() => {
    if (!ready || !t.id) return;
    if (hostRef.current && window.FavorCompose) window.FavorCompose.host(t.id, hostRef.current);
    const people: Record<string, string> = {};
    msgs.forEach((m) => [m.from, ...(m.to || []), ...(m.cc || [])].forEach((a: any) => a && a.email && (people[a.email] = a.name || people[a.email] || '')));
    window.dispatchEvent(new CustomEvent('favor-mail:thread', { detail: { threadId: t.id, subject: t.subject || '', mb: c.box || '', participants: Object.keys(people).map((e) => ({ email: e, name: people[e] })), el: extRef.current } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.id, ready]);
  const editing: Record<string, 1> = {};
  (window.FavorCompose ? window.FavorCompose.list() : []).forEach((x) => x.draftId && (editing[x.draftId] = 1));
  return (
    <div className="ml-thread" data-thread={t.id}>
      <div className="ml-thread__bar">
        <button type="button" className="ml-iconbtn ml-back" onClick={act('back')} aria-label={'Back to ' + c.listTitle}>
          <MI n="back" />
          <span>{c.listTitle}</span>
        </button>
        <span className="ml-tools">
          {st.inTrash ? (
            <button type="button" className="ml-iconbtn" onClick={act('untrash')} aria-label="Move to Inbox" title="Move to Inbox">
              <MI n="inbox" />
            </button>
          ) : st.inInbox ? (
            <button type="button" className="ml-iconbtn" onClick={act('archive')} aria-label="Archive" title="Archive (e)">
              <MI n="archive" />
            </button>
          ) : (
            <button type="button" className="ml-iconbtn" onClick={act('to-inbox')} aria-label="Move to Inbox" title="Move to Inbox">
              <MI n="inbox" />
            </button>
          )}
          <button type="button" className="ml-iconbtn" onClick={act('delete')} aria-label="Delete" title="Delete (#)">
            <MI n="trash" />
          </button>
          <button type="button" className="ml-iconbtn ml-dt" onClick={act('toggle-read')} aria-label="Mark as unread" title="Mark as unread (Shift U)">
            <MI n="unread" />
          </button>
          <button type="button" className="ml-iconbtn ml-dt" onClick={act('snooze')} aria-label="Snooze" title="Snooze">
            <MI n="clock" />
          </button>
          <button type="button" className="ml-iconbtn ml-dt" onClick={act('labels')} aria-label="Labels" title="Labels">
            <MI n="tag" />
          </button>
          {window.FavorHandoff && (
            <button type="button" className="ml-iconbtn ml-dt" onClick={() => window.FavorHandoff?.open({ kind: 'mail', id: t.id, title: t.subject || '' })} aria-label="Hand off" title="Hand this to someone">
              <MI n="person" />
            </button>
          )}
          <span className="ml-ext" data-mail-ext ref={extRef} />
          <button type="button" className="ml-iconbtn" onClick={act('thread-more')} aria-label="More" title="More" aria-haspopup="dialog">
            <MI n="more" />
          </button>
        </span>
        <span className="ml-nav">
          <button type="button" className="ml-iconbtn ml-dt" onClick={act('prev')} aria-label="Newer conversation" title="Newer (k)">
            <MI n="up" />
          </button>
          <button type="button" className="ml-iconbtn ml-dt" onClick={act('next')} aria-label="Older conversation" title="Older (j)">
            <MI n="down" />
          </button>
        </span>
      </div>
      <div className="ml-thread__scroll">
        <div className="ml-thread__top">
          <h2 className="ml-thread__h" tabIndex={-1}>
            {t.subject || (c.loading ? '' : '(no subject)')}
          </h2>
          <div className="ml-thread__chips">
            {own.map((l) => (
              <span className="ml-chip" key={l}>
                {labelName(l)}
              </span>
            ))}
            {t.snoozed ? (
              <span className="ml-chip ml-chip--sun">
                <MI n="clock" />
                Snoozed until {when(t.snoozed, true)}
              </span>
            ) : null}
            {partner && (
              <a className="ml-chip ml-chip--leaf" href={'/work/partner/' + encodeURIComponent(partner.id)}>
                <MI n="person" />
                {partner.name || 'Partner'}
              </a>
            )}
          </div>
        </div>
        {c.extra}
        <div className="ml-thread__msgs" data-brain-context="mail">
          {c.loading ? (
            <div className="ml-msg ml-msg--skel">
              <span className="ml-av" />
              <span className="ml-row__t">
                <i style={{ width: '40%' }} />
                <i style={{ width: '85%' }} />
                <i style={{ width: '70%' }} />
              </span>
            </div>
          ) : (
            msgs.map((m, i) => (m.draft && c.drafts && editing[c.drafts[m.id]] ? null : <Msg key={m.id} m={m} i={i} all={msgs} c={c} />))
          )}
        </div>
        {!c.loading && last && c.suggested}
        {!c.loading && last && <div className="ml-inline" data-inline-host key={'h' + t.id} ref={hostRef} />}
        {!c.loading && last && (
          <div className="ml-thread__foot">
            <button type="button" className="ml-btn" onClick={() => c.onReply('reply')}>
              <MI n="reply" />
              Reply
            </button>
            {replyAllList(last, c.me).length > 1 && (
              <button type="button" className="ml-btn" onClick={() => c.onReply('replyall')}>
                <MI n="replyall" />
                Reply all
              </button>
            )}
            <button type="button" className="ml-btn" onClick={() => c.onReply('forward')}>
              <MI n="fwd" />
              Forward
            </button>
          </div>
        )}
      </div>
      <div className="ml-pbar">
        {st.inInbox ? (
          <button type="button" onClick={act('archive')} aria-label="Archive">
            <MI n="archive" />
          </button>
        ) : (
          <button type="button" onClick={act('to-inbox')} aria-label="Move to Inbox">
            <MI n="inbox" />
          </button>
        )}
        <button type="button" onClick={act('delete')} aria-label="Delete">
          <MI n="trash" />
        </button>
        <button type="button" onClick={act('labels')} aria-label="Labels">
          <MI n="tag" />
        </button>
        <button type="button" onClick={() => c.onReply('reply')} aria-label="Reply">
          <MI n="reply" />
        </button>
        <button type="button" onClick={act('compose')} aria-label="New message">
          <MI n="pen" />
        </button>
      </div>
    </div>
  );
}
