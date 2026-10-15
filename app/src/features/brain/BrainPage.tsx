// The Favor Brain page (/brain/): your chats on the left, the conversation in the middle, a side panel for a large table, what
// you can ask about and connecting Claude or ChatGPT. Answers come from the Brain (mcp.favorintl.org through /api/brain) as
// blocks; blocks/registry.tsx draws each one. The first frame (chats, the open chat, who is asking) comes from the server.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { BodyPortal } from '@/shell/BodyPortal';
import { hubOv } from '@/lib/hubOv';
import { loadScript } from '@/lib/legacy';
import { historyQuery, meQuery, threadQuery, type Get } from './api';
import { BrainEngine, useBrain, type State } from './engine';
import { ConvList } from './ConvList';
import { Ic, Sprite } from './icons';
import { pop, PopLayer } from './pop';
import { Thread, Thinking } from './Thread';
import { TablePanel } from './blocks/table';
import type { BlockCtx } from './blocks/ctx';
import { copyText } from './blocks/table';
import { dlong } from './fmt';
import { useAnswerResolver } from './useAnswerResolver';
import './styles';

const LATER = 'favor.brain.connect.later';
const hourET = () => Number(new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false })) % 24;

const STARTERS = (e: BrainEngine, role: string) => {
  const s: [string, string, string, boolean?][] = [];
  if (e.has('iwave')) s.push(['spark', 'Can you pull iWave data?', 'Ratings, coverage and credits', true], ['gauge', 'High capacity partners who are not yet major', 'Strong capacity band, never $1,000 at once', true]);
  s.push(['coin', 'How is Favor doing this year?', 'Raised, goal and the same date last year']);
  s.push(['chart', role.toLowerCase().includes('partner care') ? 'How is Partner Care doing against goal?' : 'How is the RDD team doing this year?', 'Quarters, months and goal']);
  if (e.has('partners')) s.push(['list', 'List lapsed major partners in Texas', 'Last gift 12 to 24 months ago']);
  s.push(['book', 'How do I enter a check gift?', 'Steps from the Operations Manual']);
  if (e.has('iwave')) s.push(['users', 'Screen active major partners who have no iWave rating', 'See the count and the credits first', true]);
  s.push(['info', 'What can you do?', 'Everything you can ask about']);
  return s.slice(0, 6);
};

function Empty({ e, s, name }: { e: BrainEngine; s: State; name: string }) {
  const [greet, setGreet] = useState('Hello');
  // The greeting follows the Eastern clock; read after mount so the server and the browser draw the same first frame.
  useEffect(() => {
    const hr = hourET();
    setGreet(hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening');
  }, []);
  return (
    <div className="bc-empty">
      <div className="bc-mark bc-mark--bm">
        <span className="fbr" data-state="idle" aria-hidden="true">
          <i className="fbr__halo" />
          <i className="fbr__in">
            <i className="fbr__lit" />
            <i className="fbr__rg" />
            <i className="fbr__cm" />
          </i>
        </span>
      </div>
      <h1>
        {greet}
        {name ? ', ' + name : ''}
      </h1>
      <div className="bc-starters">
        {STARTERS(e, (s.me && s.me.role) || '').map(([i, q, sub, g], k) => (
          <button key={q} type="button" className="bc-starter" style={{ animationDelay: 80 + k * 50 + 'ms' }} onClick={() => void e.ask(q)}>
            <span className={'bc-starter__i' + (g ? ' g' : '')}>
              <Ic n={i} />
            </span>
            <b>{q}</b>
            <span>{sub}</span>
          </button>
        ))}
      </div>
      <div className="bc-cando">
        <button type="button" onClick={() => void e.ask('What can you do?')}>
          What you can ask
        </button>
      </div>
    </div>
  );
}

const PKG_ROWS: [string, string, string, string][] = [
  ['partners', 'user', 'Partners and giving', 'Records, lists, gifts and who holds them'],
  ['contacts', 'mail', 'Contact details', 'Emails, phones and addresses in lists'],
  ['iwave', 'gauge', 'iWave ratings', 'Capacity, propensity, coverage, screening'],
  ['all_teams', 'chart', "Every team's numbers", 'Every team tab, not only yours'],
  ['sheets', 'sheet', 'Google Sheets', 'Open any list as a sheet in your Drive'],
  ['basics', 'book', 'The manuals and your team', "Every procedure, definitions and your team's numbers"],
];
function AccessPanel({ e, s, onClose }: { e: BrainEngine; s: State; onClose: () => void }) {
  const pk = (s.me && s.me.packages) || [];
  const [form, setForm] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const why = useRef<HTMLInputElement>(null);
  const days = useRef<HTMLSelectElement>(null);
  const pkgSel = useRef<HTMLSelectElement>(null);
  return (
    <>
      <div className="bc-panel__h">
        <div style={{ flex: 1 }}>
          <div className="t">What you can ask about</div>
          <div className="s">{(s.me && s.me.role) || ''}</div>
        </div>
        <button type="button" className="ib" aria-label="Close the panel" onClick={onClose}>
          <Ic n="close" />
        </button>
      </div>
      <div className="bc-panel__body access">
        {PKG_ROWS.map(([k, i, l, sub]) => {
          const p = pk.find((x) => x.key === k);
          if (!p) return null;
          return (
            <div className="pk" key={k}>
              <div className={'pk__i' + (p.has ? '' : ' off')}>
                <Ic n={i} />
              </div>
              <b>{l}</b>
              <small>
                {sub}
                {p.until ? ' · until ' + dlong(String(p.until).slice(0, 10)) : ''}
              </small>
              {p.has ? (
                <span className="tag l">Yours</span>
              ) : e.pending(k) ? (
                <span className="state wait">
                  <i />
                  Waiting for Will
                </span>
              ) : p.requestable ? (
                <button type="button" className="h-btn h-btn--ghost h-btn--xs" onClick={() => setForm(k)}>
                  Ask Will
                </button>
              ) : (
                <span className="tag">Not part of your access</span>
              )}
            </div>
          );
        })}
        {form && (
          <form
            className="bc-pkgform"
            onSubmit={async (ev) => {
              ev.preventDefault();
              setBusy(true);
              setMsg('Sending...');
              try {
                await e.requestAccess(pkgSel.current!.value, why.current!.value, Number(days.current!.value));
                await e.loadMe();
                setForm(null);
                setMsg('');
              } catch (err) {
                setMsg((err as Error).message);
              }
              setBusy(false);
            }}
          >
            <label htmlFor="bc-pkg">Ask Will for</label>
            <select id="bc-pkg" ref={pkgSel} defaultValue={form}>
              {pk
                .filter((p) => !p.has && p.requestable && !e.pending(p.key))
                .map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
            </select>
            <label htmlFor="bc-why">Why your work needs it</label>
            <input id="bc-why" ref={why} maxLength={300} placeholder="For example: I call lapsed partners in my region" required autoFocus />
            <label htmlFor="bc-days">For how long</label>
            <select id="bc-days" ref={days} defaultValue="30">
              <option value="7">A week</option>
              <option value="30">A month</option>
              <option value="90">Three months</option>
              <option value="365">A year</option>
            </select>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="h-btn h-btn--primary h-btn--sm" disabled={busy}>
                Send the request
              </button>
              <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => setForm(null)}>
                Cancel
              </button>
            </div>
            <p className="bc-msg" role="status">
              {msg}
            </p>
          </form>
        )}
      </div>
    </>
  );
}

function ConnectPanel({ onClose, start }: { onClose: () => void; start: 'claude' | 'chatgpt' }) {
  const [app, setApp] = useState(start);
  const [copied, setCopied] = useState('');
  const url = 'https://mcp.favorintl.org/mcp';
  return (
    <>
      <div className="bc-panel__h">
        <div style={{ flex: 1 }}>
          <div className="t">Connect Claude or ChatGPT</div>
          <div className="s">The same answers, inside the app you already use</div>
        </div>
        <button type="button" className="ib" aria-label="Close the panel" onClick={onClose}>
          <Ic n="close" />
        </button>
      </div>
      <div className="bc-panel__body access">
        <div className="bc-apps" role="tablist">
          {(['claude', 'chatgpt'] as const).map((a) => (
            <button key={a} type="button" role="tab" className={app === a ? 'is-on' : ''} aria-selected={app === a} onClick={() => setApp(a)}>
              {a === 'claude' ? 'Claude' : 'ChatGPT'}
            </button>
          ))}
        </div>
        <div className="bc-addr">
          <code>{url}</code>
          <button
            type="button"
            className="h-btn h-btn--primary h-btn--sm"
            onClick={async () => {
              const ok = await copyText(url);
              setCopied(ok ? 'Copied' : 'Press Ctrl C');
              setTimeout(() => setCopied(''), 2000);
            }}
          >
            {copied || 'Copy'}
          </button>
        </div>
        {app === 'claude' ? (
          <div className="steps" style={{ padding: '12px 0 0' }}>
            <ol>
              <li>
                <div>Favor has a Claude organization. Ask the technology team for a Favor Claude seat first.</div>
              </li>
              <li>
                <div>
                  Open <b>claude.ai</b> or the Claude app, then <b>Customize</b> and <b>Connectors</b>.
                </div>
              </li>
              <li>
                <div>
                  In the Favor organization, <b>Favor</b> is already listed under <b>Yours</b>: press <b>Connect</b>. On your own account, press <b>+ Add</b>, then <b>Add custom connector</b>, name it <b>Favor</b>, paste the address and press <b>Continue</b>.
                </div>
              </li>
              <li>
                <div>
                  Press <b>Continue with Google</b> and sign in with your Favor Google account.
                </div>
              </li>
              <li>
                <div>
                  Press <b>Favor</b> in your list and change <b>Read-only tools</b> from <b>Needs approval</b> to <b>Always allow</b>. Then ask a question.
                </div>
              </li>
            </ol>
          </div>
        ) : (
          <div className="steps" style={{ padding: '12px 0 0' }}>
            <ol>
              <li>
                <div>This needs ChatGPT Business, Enterprise or Edu, or a Pro plan. On the free and Plus plans, use Claude.</div>
              </li>
              <li>
                <div>
                  Turn on <b>Developer mode</b> under <b>Settings</b>, <b>Apps</b>, <b>Advanced settings</b>.
                </div>
              </li>
              <li>
                <div>
                  Under <b>Apps</b>, press <b>Create</b>. Name it <b>Favor</b>, paste the address, choose <b>OAuth</b>, press <b>Scan Tools</b>, sign in with your Favor Google account, then <b>Create</b>.
                </div>
              </li>
              <li>
                <div>
                  In a chat, pick <b>Favor</b> from the tools menu.
                </div>
              </li>
            </ol>
          </div>
        )}
        <p style={{ margin: '14px 0 0', fontSize: 13, color: 'var(--h-ink-3)' }}>
          Claude's free plan allows one custom connector, which is all you need.{' '}
          <a href="/help/connect-your-ai/" style={{ color: 'var(--h-brand-ink)' }}>
            Step by step, with pictures
          </a>
        </p>
      </div>
    </>
  );
}

/** Where a selection came from, above the box (the same card ask-brain.js draws). */
export function AskCtxCard({ ctx }: { ctx: { text: string; source: string } }) {
  const FAB = typeof window !== 'undefined' ? (window as any).FavorAskBrain : null;
  const short = FAB && FAB.suggestion ? !!FAB.suggestion(ctx.text) : false;
  return (
    <div className="fx-askctx bc-askctx" data-askctx>
      <b>From {ctx.source || 'this page'}</b>
      {!short && (
        <p>
          {ctx.text.slice(0, 400)}
          {ctx.text.length > 400 ? '...' : ''}
        </p>
      )}
    </div>
  );
}

export function Toast({ s }: { s: State }) {
  const t = s.toast;
  return (
    <div className={'toast' + (t ? ' is-on' : '')} role="status" aria-live="polite" style={{ pointerEvents: t && t.link ? 'auto' : 'none' }}>
      {t && (
        <>
          <Ic n="check" />
          {t.text}
          {t.link && (
            <a href={t.link.href} target="_blank" rel="noopener" style={{ color: '#d7e8cc', fontWeight: 600, marginLeft: 6 }}>
              {t.link.label}
            </a>
          )}
        </>
      )}
    </div>
  );
}

/** The ask box: grows with the question, Enter sends, Shift Enter adds a line, the button stops an answer being made. */
export function Composer({ e, s, where, ctxCard }: { e: BrainEngine; s: State; where: 'page' | 'dock'; ctxCard?: { text: string; source: string; clear: () => void } | null }) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [v, setV] = useState('');
  const [ph, setPh] = useState('Ask about partners, giving, team numbers, iWave or the manuals');
  const grow = () => {
    const el = ta.current;
    if (!el) return;
    el.style.height = '40px';
    el.style.height = Math.min(el.scrollHeight, 192) + 'px';
  };
  useEffect(() => {
    e.rephrase = (q: string) => {
      setV(q);
      requestAnimationFrame(() => {
        grow();
        ta.current?.focus();
        ta.current?.setSelectionRange(q.length, q.length);
      });
    };
    const el = ta.current;
    if (!el || where === 'dock') return;
    const fit = () => {
      const w = el.clientWidth;
      setPh(w > 520 ? 'Ask about partners, giving, team numbers, iWave or the manuals' : w > 330 ? 'Ask about partners, giving or iWave' : 'Ask the Brain');
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [e, where]);
  const send = () => {
    let q = v.trim();
    const FAB = (window as any).FavorAskBrain;
    if ((q.length < 2 && !(ctxCard && q.length === 0 && ctxCard.text.length > 1)) || s.busy) return;
    if (ctxCard && FAB) {
      q = FAB.compose(q, { text: ctxCard.text, source: ctxCard.source });
      ctxCard.clear();
    }
    setV('');
    requestAnimationFrame(grow);
    ta.current?.focus({ preventScroll: true });
    void e.ask(q);
  };
  const busy = !!s.busy;
  const can = v.trim().length >= 2 || !!ctxCard;
  return (
    <form
      className={where === 'page' ? 'bc-compose' : 'fp-comp__in'}
      onSubmit={(ev) => {
        ev.preventDefault();
        if (busy) e.stop();
        else send();
      }}
    >
      {where === 'page' && (
        <label className="bc-sr" htmlFor="bc-input">
          Ask the Favor Brain
        </label>
      )}
      <textarea
        id={where === 'page' ? 'bc-input' : undefined}
        ref={ta}
        data-brain-input
        rows={1}
        maxLength={600}
        placeholder={where === 'dock' ? (ctxCard ? 'Ask about this' : 'Ask Favor Brain') : ctxCard ? 'Ask about this' : ph}
        aria-label="Ask Favor Brain"
        autoComplete="off"
        value={v}
        onChange={(ev) => {
          setV(ev.target.value);
          grow();
        }}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) {
            ev.preventDefault();
            send();
          }
        }}
      />
      <button type="submit" className={(where === 'page' ? 'bc-send' : 'fp-send') + (busy ? ' is-stop' : '')} aria-label={busy ? 'Stop' : 'Send'} disabled={!busy && !can} onMouseDown={(ev) => ev.preventDefault()}>
        <Ic n={busy ? 'stop' : 'send'} />
      </button>
    </form>
  );
}

export function BrainPage({ get, c }: { get: Get; c: string }) {
  const { data: me } = useSuspenseQuery(meQuery(get));
  const { data: convs } = useSuspenseQuery(historyQuery(get));
  const { data: thread } = useSuspenseQuery(threadQuery(get, c || '-'));
  const e = useMemo(() => new BrainEngine('page', { me, convs, thread: c ? thread : null }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const s = useBrain(e);
  useAnswerResolver(e);
  const app = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [rail, setRail] = useState<'open' | 'closed' | 'over'>('open');
  const [wide, setWide] = useState(true);
  const [panel, setPanel] = useState<null | { kind: 'table'; key: string } | { kind: 'access' } | { kind: 'connect'; app: 'claude' | 'chatgpt' }>(null);
  const [find, setFind] = useState('');
  const [jump, setJump] = useState(false);
  const [focus, setFocus] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [banner, setBanner] = useState(false);
  const [askCtx, setAskCtx] = useState<{ text: string; source: string } | null>(null);
  const name = useMemo(() => String((me && me.name) || '').split(/\s+/)[0] || '', [me]);

  // The address keeps the open chat (?c=), so a reload or a shared link opens it.
  useEffect(() => {
    e.onConv = (id) => {
      try {
        history.replaceState(history.state, '', id ? '?c=' + encodeURIComponent(id) : location.pathname);
      } catch {
        /* the address stays */
      }
    };
  }, [e]);
  // After the first frame: the connector, your sheets, and whatever the address asks for.
  useEffect(() => {
    void loadScript('/js/sheets.js?v=2').catch(() => undefined);
    void e.loadConnector();
    void e.loadSheets();
    void (async () => {
      try {
        const pr = await fetch('/api/brain/prefs', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null));
        if (pr && pr.prompt === false) return;
      } catch {
        /* prompts stay on */
      }
      let later = 0;
      try {
        later = Number(localStorage.getItem(LATER) || 0);
      } catch {
        later = 0;
      }
      setBanner(!(later && Date.now() - later < 864e5));
    })();
    const p = new URLSearchParams(location.search);
    if (p.get('connect') === '1') setPanel({ kind: 'connect', app: 'claude' });
    const ctxText = (p.get('ctx') || '').slice(0, 2000).trim();
    const asked = (p.get('ask') || '').slice(0, 600).trim();
    if (ctxText.length > 1) {
      setAskCtx({ text: ctxText, source: (p.get('from') || 'another page').slice(0, 60) });
      history.replaceState(null, '', '/brain/');
      e.startNew();
      const FAB = (window as any).FavorAskBrain;
      if (FAB) setTimeout(() => e.rephrase?.(FAB.suggestion(ctxText)), 0);
    } else if (asked.length > 1 && !p.get('c')) {
      history.replaceState(null, '', '/brain/');
      void e.ask(asked);
    } else if (c && e.s.cur) {
      if (e.s.cur.turns.some((t) => t.pending)) e.pollPending(e.s.cur);
      e.remember(e.s.cur.id);
    } else if (c && !thread) e.toast('That chat is gone.');
    else if (!c) {
      const r = e.recent();
      if (r) void e.openConv(r);
    }
    if (p.get('t') && /^c_[a-z0-9]{4,16}$/.test(p.get('t')!)) void e.openConv(p.get('t')!);
  }, [e]); // eslint-disable-line react-hooks/exhaustive-deps

  // The rail: beside the chat on a wide screen, over it on a narrower one.
  useLayoutEffect(() => {
    const sync = () => {
      const w = innerWidth >= 1360;
      setWide(w);
      setRail((r) => (w ? (r === 'over' ? 'open' : r) : r === 'over' ? 'over' : 'closed'));
    };
    sync();
    addEventListener('resize', sync);
    return () => removeEventListener('resize', sync);
  }, []);
  const closeOver = useCallback(() => setRail((r) => (r === 'over' ? 'closed' : r)), []);
  // A new answer or a chat opened: the newest question moves to the top of the view.
  const nTurns = s.cur ? s.cur.turns.length : 0;
  useEffect(() => {
    const sc = scroll.current;
    if (!sc) return;
    const qs = sc.querySelectorAll('.m-q');
    const last = qs[qs.length - 1] as HTMLElement | undefined;
    if (last) sc.scrollTop += last.getBoundingClientRect().top - sc.getBoundingClientRect().top - 16;
    else sc.scrollTop = 0;
  }, [nTurns, s.cur && s.cur.id]);
  // Focus: the FavorOS menu hides while chatting.
  useEffect(() => {
    document.querySelector('.h-app')?.classList.toggle('is-focus', focus);
    return () => document.querySelector('.h-app')?.classList.remove('is-focus');
  }, [focus]);
  // Keys: Esc stops or closes, Ctrl Shift O starts a new chat, / jumps to the box.
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented) return;
      const t = ev.target as HTMLElement;
      if (ev.key === 'Escape') {
        if (pop.isOpen()) return;
        if (keysOpen) setKeysOpen(false);
        else if (panel) setPanel(null);
        else if (rail === 'over') closeOver();
        else if (e.s.busy) e.stop();
      } else if (ev.ctrlKey && ev.shiftKey && (ev.key === 'O' || ev.key === 'o')) {
        ev.preventDefault();
        e.startNew();
      } else if (ev.key === '/' && !ev.ctrlKey && !ev.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') && !t.isContentEditable) {
        ev.preventDefault();
        document.getElementById('bc-input')?.focus();
      }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [e, panel, rail, keysOpen, closeOver]);
  // A note sent from the Not right form marks that answer.
  useEffect(() => {
    const fb = (ev: Event) => {
      const d = (ev as CustomEvent).detail || {};
      if (!d.ref || !e.s.cur) return;
      e.s.cur.turns.forEach((t) => {
        if (t.ref === d.ref) t.rated = d.rating === 'right' ? 'right' : 'wrong';
      });
      e.touch();
    };
    const ready = (ev: Event) => {
      const r = (ev as CustomEvent).detail || {};
      ev.preventDefault();
      if (r.url) {
        e.sheetMade(r);
        e.toast('Your sheet is ready in Google Drive', { href: r.url, label: 'Open it' });
      }
    };
    const failed = (ev: Event) => {
      ev.preventDefault();
      e.toast(((ev as CustomEvent).detail && (ev as CustomEvent).detail.message) || 'The sheet did not build.');
    };
    document.addEventListener('favor:feedback-sent', fb);
    document.addEventListener('favor:sheet-ready', ready);
    document.addEventListener('favor:sheet-failed', failed);
    return () => {
      document.removeEventListener('favor:feedback-sent', fb);
      document.removeEventListener('favor:sheet-ready', ready);
      document.removeEventListener('favor:sheet-failed', failed);
    };
  }, [e]);
  // The side panel and the shortcut dialog close with the back gesture too.
  useEffect(() => {
    if (!panel) return;
    const tok = hubOv.on(() => setPanel(null));
    return () => hubOv.off(tok);
  }, [panel]);

  const openTable = useCallback((key: string) => {
    setPanel({ kind: 'table', key });
  }, []);
  const tableOf = (key: string) => {
    const [ti, bi] = key.split(':').map(Number);
    const t = s.cur && s.cur.turns[ti];
    const b = t && t.blocks && t.blocks[bi];
    if (!t || !b) return null;
    const ctx: BlockCtx = { engine: e, turn: t, ti, bi, expired: !!t.stored && !!t.at && Date.now() - new Date(t.at).getTime() >= 864e5, where: 'page', ask: (q, intent) => void e.ask(q, { intent }), openTable };
    return { b, ctx };
  };
  const tbl = panel && panel.kind === 'table' ? tableOf(panel.key) : null;
  const railOpen = wide ? rail === 'open' : rail === 'over';
  const prompts = banner && s.connected === false;
  const connect = (a: 'claude' | 'chatgpt' = 'claude') => {
    setPanel({ kind: 'connect', app: a });
    closeOver();
  };
  const cls = ['bc-app'];
  if (wide && rail === 'closed') cls.push('no-rail');
  if (rail === 'over') cls.push('rail-over');
  if (panel) cls.push('has-panel');
  if (panel && panel.kind === 'table') cls.push('panel-full');
  const soundOn = () => {
    try {
      return localStorage.getItem('favor.hub.sound') !== 'off';
    } catch {
      return true;
    }
  };
  const brainRequests = typeof window !== 'undefined' ? Number(((window as any).FAVOR_HUB && (window as any).FAVOR_HUB.counts && (window as any).FAVOR_HUB.counts.brainRequests) || 0) : 0;

  return (
    <div className="bc-root">
      <Sprite />
      <div className={cls.join(' ')} ref={app} data-ready="1">
        <aside className="bc-rail" aria-label="Your chats">
          <div className="bc-rail__in">
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                className="bc-new"
                onClick={() => {
                  e.startNew();
                  closeOver();
                  document.getElementById('bc-input')?.focus();
                }}
              >
                <Ic n="edit" />
                New chat<kbd>Ctrl Shift O</kbd>
              </button>
              {!wide && (
                <button type="button" className="ib ib--bare" aria-label="Close your chats" onClick={closeOver}>
                  <Ic n="close" />
                </button>
              )}
            </div>
            <div className="bc-find">
              <Ic n="search" />
              <input
                type="search"
                placeholder="Search your chats"
                aria-label="Search your chats"
                autoComplete="off"
                value={find}
                onChange={(ev) => {
                  setFind(ev.target.value);
                  const q = ev.target.value.trim();
                  clearTimeout((window as any).__bcFindT);
                  (window as any).__bcFindT = setTimeout(() => void e.search(q), 280);
                }}
              />
            </div>
            <div className="bc-convs" role="list">
              <ConvList
                e={e}
                list={s.convs}
                cur={s.cur && s.cur.id}
                working={s.busy && s.busy.conv ? s.busy.conv.id : null}
                q={find}
                found={s.found}
                renaming={s.renaming}
                onOpen={(id) => {
                  void e.openConv(id);
                  closeOver();
                  setPanel(null);
                }}
              />
            </div>
            <div className="bc-rail__foot">
              <div className="bc-grp" style={{ paddingTop: 2 }}>
                Your sheets
              </div>
              <div className="bc-sheets-mini">
                {s.sheets.length ? (
                  s.sheets.slice(0, 3).map((x, i) => (
                    <a key={i} href={x.url} target="_blank" rel="noopener">
                      <Ic n="sheet" />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.title}</span>
                    </a>
                  ))
                ) : (
                  <div className="bc-sheets-empty">Sheets you make show here.</div>
                )}
              </div>
              <button type="button" className="bc-hint" onClick={() => connect()}>
                <Ic n="link" />
                Connect Claude or ChatGPT
              </button>
              <a className="bc-hint" href="/brain/text/" style={{ textDecoration: 'none' }}>
                <Ic n="chat" />
                Text Favor Brain
              </a>
            </div>
          </div>
        </aside>
        <section className="bc-pane" aria-label="Chat">
          <div className="bc-connect-slot" style={{ flex: 'none' }}>
            <div className="bc-connect" hidden={!prompts}>
              <div className="bc-connect__t">
                <b>Favor Brain works inside Claude.</b> <span>Ask the technology team for a seat.</span>
              </div>
              <div className="bc-connect__a">
                <button type="button" className="h-btn h-btn--primary h-btn--sm" onClick={() => connect()}>
                  Connect
                </button>
                <button
                  type="button"
                  className="h-btn h-btn--ghost h-btn--sm"
                  onClick={() => {
                    try {
                      localStorage.setItem(LATER, String(Date.now()));
                    } catch {
                      /* not kept */
                    }
                    setBanner(false);
                  }}
                >
                  Not now
                </button>
                <button type="button" className="bc-connect__gpt" onClick={() => connect('chatgpt')}>
                  ChatGPT instead
                </button>
              </div>
            </div>
          </div>
          <div className="bc-bar">
            <button
              type="button"
              className="bc-pn"
              aria-label="FavorOS menu"
              aria-controls="h-side"
              onClick={(ev) => {
                ev.stopPropagation();
                const shell = document.querySelector('.h-app');
                if (!shell) return;
                shell.classList.toggle('is-nav');
              }}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M5 8h10" />
                <path d="M5 16h14" />
              </svg>
            </button>
            <div className="bc-seg">
              <button type="button" aria-pressed={rail !== 'over'} onClick={closeOver}>
                Ask
              </button>
              <button type="button" aria-pressed={rail === 'over'} onClick={() => setRail('over')}>
                History
              </button>
            </div>
            <button type="button" className="ib ib--bare" aria-label="Show your chats" aria-expanded={railOpen} data-tip="Your chats" onClick={() => setRail((r) => (wide ? (r === 'open' ? 'closed' : 'open') : r === 'over' ? 'closed' : 'over'))}>
              <Ic n="rail" />
            </button>
            <button type="button" className="ib ib--bare" aria-label="New chat" data-tip="New chat" onClick={() => e.startNew()}>
              <Ic n="edit" />
            </button>
            <button
              type="button"
              className="bc-bar__title"
              aria-label="Rename this chat"
              onClick={() => {
                if (!s.cur) return;
                e.startRename(s.cur.id);
                if (!railOpen) setRail(wide ? 'open' : 'over');
              }}
            >
              {s.cur ? s.cur.title : 'New chat'}
            </button>
            <div className="bc-bar__right">
              <button type="button" className="ib ib--bare" aria-label="Hide the FavorOS menu while chatting" aria-pressed={focus} data-tip="Focus" onClick={() => setFocus(!focus)}>
                <Ic n="focus" />
              </button>
              <button
                type="button"
                className="ib ib--bare"
                aria-label="More"
                aria-haspopup="menu"
                data-tip="More"
                onClick={(ev) =>
                  pop.open(
                    ev.currentTarget,
                    [
                      ...(s.me && s.me.admin ? [{ v: 'admin', icon: <Ic n="gear" />, label: 'Brain admin', aside: brainRequests || undefined }] : []),
                      { v: 'access', icon: <Ic n="shield" />, label: 'What you can ask about' },
                      { v: 'connect', icon: <Ic n="link" />, label: 'Connect Claude or ChatGPT' },
                      { v: 'intro', icon: <Ic n="play" />, label: 'Watch the one-minute intro' },
                      { v: 'help', icon: <Ic n="book" />, label: 'Help: asking well' },
                      { v: 'keys', icon: <Ic n="list" />, label: 'Keyboard shortcuts' },
                      { v: '-', label: '', sep: true },
                      { v: 'sound', icon: <Ic n={soundOn() ? 'volume' : 'mute'} />, label: 'Sounds ' + (soundOn() ? 'on' : 'off') },
                    ],
                    (v) => {
                      if (v === 'access') setPanel({ kind: 'access' });
                      else if (v === 'connect') connect();
                      else if (v === 'sound') {
                        document.querySelector<HTMLElement>('[data-sound-switch]')?.click();
                        e.toast(soundOn() ? 'Sounds on' : 'Sounds off');
                      } else if (v === 'admin') location.href = '/brain/admin/';
                      else if (v === 'intro') location.href = '/help/videos/meet-the-brain/';
                      else if (v === 'help') location.href = '/help/asking-well/';
                      else if (v === 'keys') setKeysOpen(true);
                    },
                  )
                }
              >
                <Ic n="more" />
              </button>
            </div>
          </div>
          <div
            className="bc-scroll"
            ref={scroll}
            onScroll={(ev) => {
              const sc = ev.currentTarget;
              const qs = sc.querySelectorAll('.m-q');
              const lastQ = qs[qs.length - 1];
              const far = sc.scrollHeight - sc.scrollTop - sc.clientHeight > 250;
              const above = !lastQ || lastQ.getBoundingClientRect().top > sc.getBoundingClientRect().top + 8;
              setJump(far && above);
            }}
          >
            <div className="bc-col" id="bc-thread" aria-live="polite">
              {s.cur && s.cur.turns.length ? (
                <Thread e={e} s={s} host={{ where: 'page', openTable, connect: () => connect(), prompts }} />
              ) : s.busy ? (
                <Thinking s={s} where="page" />
              ) : (
                <Empty e={e} s={s} name={name} />
              )}
            </div>
          </div>
          <div className="bc-dock">
            <button
              type="button"
              className={'h-btn h-btn--ghost h-btn--sm bc-jump' + (jump ? ' is-on' : '')}
              onClick={() => {
                const sc = scroll.current;
                if (sc) sc.scrollTop = sc.scrollHeight;
              }}
            >
              <Ic n="caret" />
              Latest answer
            </button>
            <div className="bc-dock__in">
              {askCtx && <AskCtxCard ctx={askCtx} />}
              <Composer e={e} s={s} where="page" ctxCard={askCtx ? { ...askCtx, clear: () => setAskCtx(null) } : null} />
              <div className="bc-fine">
                <span className="bc-fine__l">
                  Answers can be off. <b>Not right</b> under an answer reports it.
                </span>
                <span className="bc-fine__s">
                  Answers can be off. <b>Not right</b> reports it.
                </span>
              </div>
            </div>
          </div>
        </section>
        <aside className="bc-panel" aria-label="Side panel">
          <div className="bc-panel__in">
            {panel && panel.kind === 'table' && tbl && <TablePanel b={tbl.b} ctx={tbl.ctx} onClose={() => setPanel(null)} />}
            {panel && panel.kind === 'access' && <AccessPanel e={e} s={s} onClose={() => setPanel(null)} />}
            {panel && panel.kind === 'connect' && <ConnectPanel key={panel.app} start={panel.app} onClose={() => setPanel(null)} />}
          </div>
        </aside>
      </div>
      {BodyPortal(
        <div className="bc-root" id="bc-portal">
          <div className={'scrim' + (keysOpen ? ' is-on' : '')} onClick={() => setKeysOpen(false)} />
          <div className={'dlg' + (keysOpen ? ' is-on' : '')} role="dialog" aria-modal="true" aria-labelledby="bc-dlg-h" hidden={!keysOpen}>
            {keysOpen && (
              <>
                <h2 id="bc-dlg-h">Keyboard shortcuts</h2>
                <p>
                  <span className="kbd">Enter</span> sends. <span className="kbd">Shift Enter</span> adds a line. <span className="kbd">Esc</span> stops an answer or closes what is open. <span className="kbd">Ctrl Shift O</span> starts a new chat. <span className="kbd">/</span> jumps to the question box.
                </p>
                <div className="acts">
                  <button type="button" className="h-btn h-btn--primary" onClick={() => setKeysOpen(false)}>
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
          <Toast s={s} />
        </div>,
      )}
      <PopLayer />
    </div>
  );
}
