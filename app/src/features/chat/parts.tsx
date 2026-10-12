// The pieces of a conversation, shared by the Chat page and the floating dock: avatar, message row, message list, typing line.
// Cards (files, clips, Drive, meetings, links, requests, project tasks) are drawn as the classic markup so the stylesheets, the
// viewer (chat-view.js) and the card scripts (task-card.js, project-card.js) work on them unchanged.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { memo, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { entityStore } from '@/features/entity/store';
import { hubOv } from '@/lib/hubOv';
import type { ChatEngine } from './engine';
import { initValue, ago, COLORS, dayKey, dayLabel, driveId, esc, fileKind, fmtBody, hash, initials, LAB, mentionsMe, plural, sizeOf, threadIdOf, threadRef, timeOf, type J } from './fmt';
import { Ic, icHtml, Ring } from './icons';

const W = window as any;
const broken: Record<string, 1> = {};

/* ------------------------------------------------------------------ avatar */
export function avatarHtml(u: J, size?: string, dot?: boolean): string {
  if (u.sys) return '<span class="ch-av" data-c="teal"' + (size ? ' data-s="' + size + '"' : '') + '>' + icHtml(u.sys) + '</span>';
  if (u.brain) return '<span class="ch-av ch-av--brain' + (size ? ' ch-av--' + size : '') + '"><span class="fbr" data-state="still" aria-hidden="true"><i class="fbr__halo"></i><i class="fbr__in"><i class="fbr__lit"></i><i class="fbr__rg"></i><i class="fbr__cm"></i></i></span></span>';
  const c = u.color || COLORS[hash(u.id || u.name || '') % 7];
  const inner = u.picture && !broken[u.picture] ? '<img src="' + esc(u.picture) + '" alt="" referrerpolicy="no-referrer" data-ini="' + esc(initials(u.name)) + '" />' : esc(initials(u.name));
  return '<span class="ch-av' + (size ? ' ch-av--' + size : '') + '"' + (String(u.id || '').indexOf('@') > 0 ? ' data-entity="person:' + esc(u.id) + '" data-label="' + esc(u.name) + '"' : '') + ' data-c="' + c + '">' + inner + (dot ? '<i class="ch-dot" data-p="' + esc(u.presence || 'off') + '"></i>' : '') + '</span>';
}
export function Avatar({ u, size, dot }: { u: J; size?: string; dot?: boolean }) {
  if (u.brain)
    return (
      <span className={'ch-av ch-av--brain' + (size ? ' ch-av--' + size : '')}>
        <Ring state="still" />
      </span>
    );
  if (u.sys)
    return (
      <span className="ch-av" data-c="teal">
        <Ic n={u.sys} />
      </span>
    );
  const c = u.color || COLORS[hash(u.id || u.name || '') % 7];
  const person = String(u.id || '').indexOf('@') > 0;
  return (
    <span className={'ch-av' + (size ? ' ch-av--' + size : '')} data-c={c} data-entity={person ? 'person:' + u.id : undefined} data-label={person ? u.name : undefined}>
      {u.picture && !broken[u.picture] ? <img src={u.picture} alt="" referrerPolicy="no-referrer" data-ini={initials(u.name)} /> : initials(u.name)}
      {dot && <i className="ch-dot" data-p={u.presence || 'off'} />}
    </span>
  );
}

/* ------------------------------------------------------------------ cards */
function vidHtml(src: string, poster: string, label: string, dur: string, ratio: string) {
  const box = ratio ? ' style="aspect-ratio:' + ratio + '"' : '';
  return (
    '<span class="ch-vid"' + box + ' data-vsrc="' + esc(src) + '">' + (poster && !broken[poster] ? '<img class="ch-vid__poster" src="' + esc(poster) + '" alt="" loading="lazy" decoding="async" />' : '<span class="ch-clip__scr"><i></i><i></i><i></i><i></i></span>') +
    '<button type="button" class="ch-vid__play" data-act="play" aria-label="Play ' + esc(label) + '">' + icHtml('play') + '</button>' + (dur ? '<span class="ch-vid__dur">' + esc(dur) + '</span>' : '') + '</span>'
  );
}
function midName(n: string) {
  const c = Array.from(String(n));
  if (c.length < 30) return esc(n);
  return '<span class="ch-mid"><span class="ch-mid__a">' + esc(c.slice(0, c.length - 12).join('')) + '</span><span class="ch-mid__b">' + esc(c.slice(-12).join('')) + '</span></span>';
}
function thumbBox(key: string, src: string, k: string, lab: string) {
  const V = W.FavorChatView;
  const have = V && V.thumb(key);
  return '<span class="ch-prev__pic' + (have ? ' is-drawn' : '') + '" data-thumb="' + esc(key) + '"' + (have || !src ? '' : ' data-src="' + esc(src) + '" data-k="' + esc(k) + '"') + '>' + (have || '<span class="ch-file__ic" data-k="' + esc(k) + '">' + lab + '</span>') + '</span>';
}
export function voiceHtml(e: ChatEngine, a: J, m: J | null) {
  const S = e.S;
  const t = S.lang && m && S.tr[m.id] && S.tr[m.id].voice && S.tr[m.id].voice[a.id];
  const words = a.transcript_status === 'ready' ? (a.transcript ? '<div class="ch-voice__w">' + esc(a.transcript) + '</div>' : '<div class="ch-voice__s">No speech heard</div>') : a.transcript_status === 'failed' ? '<div class="ch-voice__s">Transcript not available</div>' : '<div class="ch-voice__s">Writing the transcript</div>';
  const tr = t && m && !S.trOrig[m.id] && a.transcript ? '<div class="ch-voice__w ch-voice__w--tr">' + esc(t.text) + '</div><div class="ch-tr"><span>Translated from ' + esc(e.langName(S.tr[m.id].src)) + '</span><button type="button" data-act="sm-orig" data-id="' + m.id + '">Show original</button></div>' : '';
  return '<div class="ch-card ch-voice" data-cm="' + (m ? m.id : '') + '"><div class="ch-voice__row"><span class="ch-file__ic" data-k="audio">' + icHtml('mic') + '</span><audio controls preload="none" src="' + esc(a.url) + '"></audio></div>' + (tr || words) + '</div>';
}
export function cardHtml(e: ChatEngine, a: J, m: J | null, i: number): string {
  const at = m ? ' data-cm="' + m.id + '" data-ai="' + i + '"' : '';
  if (a.type === 'clip') {
    return (
      '<div class="ch-card ch-clip"' + at + '>' + vidHtml('/api/clips/' + esc(a.id) + '/media', a.thumb, a.title, a.duration, '16 / 9') +
      '<span class="ch-clip__info"><span class="ch-kicker">' + icHtml('rec') + 'Clip</span><span class="ch-card__t">' + esc(a.title) + '</span><span class="ch-card__m">' + esc(a.by || '') + (a.when ? ' · ' + esc(a.when) : '') + '</span>' + (a.summary ? '<span class="ch-card__s">' + esc(a.summary) + '</span>' : '') +
      '<a class="ch-clip__open" href="' + esc(a.url) + '" target="_blank" rel="noopener">Open in Clips' + icHtml('ext') + '</a></span></div>'
    );
  }
  if (a.type === 'drive') {
    const k = a.kind || 'file';
    const lab = LAB[k] || 'FILE';
    const pic = m && !broken['/api/chat/drive-file/' + m.id + '/' + i + '/thumb'] ? '<span class="ch-prev__pic" data-thumb="d' + m.id + '-' + i + '"><img src="/api/chat/drive-file/' + m.id + '/' + i + '/thumb" alt="" loading="lazy" decoding="async" data-fallback="' + lab + '" data-k="' + esc(k) + '" /></span>' : '<span class="ch-prev__pic"><span class="ch-file__ic" data-k="' + esc(k) + '">' + lab + '</span></span>';
    return (
      '<div class="ch-card ch-prev ch-prev--drive"' + at + '><button type="button" class="ch-prev__open" data-act="view"' + at + ' aria-label="Preview ' + esc(a.name) + '">' + pic +
      '<span class="ch-prev__t"><span class="ch-kicker" style="color:var(--tc-sky-ink)">' + icHtml('drive') + 'Drive</span><span class="ch-card__t">' + esc(a.name) + '</span><span class="ch-card__m">' + esc(a.path || '') + (a.indexed ? ' · Indexed ' + esc(a.indexed) : '') + '</span></span></button>' +
      '<a class="ch-prev__ext" href="' + esc(a.url) + '" target="_blank" rel="noopener" aria-label="Open in Google Drive" title="Open in Google Drive">' + icHtml('ext') + '</a></div>'
    );
  }
  if (a.type === 'meeting') {
    const S = e.S;
    const hs = S.active && Object.prototype.hasOwnProperty.call(S.huddle, S.active) ? (S.huddle[S.active] && S.huddle[S.active].id === a.id ? S.huddle[S.active] : null) : undefined;
    if (hs !== undefined) a = Object.assign({}, a, hs ? { status: 'live', count: hs.people.length } : a.status === 'ended' ? {} : { status: 'ended', count: 0 });
    const live = a.status !== 'ended';
    const inner =
      '<span class="ch-meet__ic">' + icHtml('video') + '</span><span class="ch-meet__t"><span class="ch-kicker">' + icHtml('video') + 'Meeting</span><span class="ch-card__t">' + esc(a.title) + '</span>' +
      (live ? '<span class="ch-meet__live"><i></i>Live now' + (a.count ? ' · ' + plural(a.count, 'person', 'people') + ' in the room' : '') + '</span>' : '<span class="ch-card__m">Ended' + (a.duration ? ' · ' + esc(a.duration) : '') + (a.notes ? ' · Notes ready' : '') + '</span>') + '</span>';
    const btn = live ? '<span class="ch-btn">Join</span>' : a.notes ? '<span class="ch-btn">Open notes</span>' : '';
    return '<a class="ch-card ch-meet' + (live ? '' : ' ch-meet--ended') + '" href="' + esc(live ? a.url : a.notes_url || a.url) + '"' + (live ? ' data-act="huddle" data-mid="' + esc(a.id) + '"' : ' target="_blank" rel="noopener"') + '>' + inner + btn + '</a>';
  }
  if (a.type === 'file') {
    const fk = fileKind(a);
    if (fk === 'image') {
      const w = Number(a.w) || 0;
      const h = Number(a.h) || 0;
      const ratio = w && h ? Math.max(1 / 3, Math.min(3, w / h)) : 0;
      const shape = ratio ? ' style="aspect-ratio:' + ratio.toFixed(4) + ';width:min(100%,' + Math.round(Math.min(360, 280 * ratio)) + 'px)"' : '';
      return '<button type="button" class="ch-media ch-photo" data-act="view"' + at + shape + ' aria-label="View ' + esc(a.name || 'picture') + '"><img class="ch-img" src="' + esc(a.url) + '" alt="' + esc(a.name || 'Picture') + '"' + (w && h ? ' width="' + w + '" height="' + h + '"' : '') + ' loading="lazy" decoding="async" /></button>';
    }
    if (fk === 'video') return '<div class="ch-card ch-clip ch-clip--file"' + at + '>' + vidHtml(a.url + '#t=0.1', '', a.name, '', '16 / 9') + '<span class="ch-clip__info"><span class="ch-card__t">' + esc(a.name) + '</span><span class="ch-card__m">' + esc(sizeOf(a.size)) + '</span><a class="ch-clip__open" href="' + esc(a.url) + '" download>Download' + icHtml('dl') + '</a></span></div>';
    if (fk === 'audio' && a.voice) return voiceHtml(e, a, m);
    if (fk === 'audio') return '<div class="ch-card ch-audio"' + at + '><span class="ch-file__ic" data-k="audio">' + icHtml('wave') + '</span><span class="ch-audio__t"><span class="ch-card__t">' + esc(a.name) + '</span><audio controls preload="none" src="' + esc(a.url) + '"></audio></span><a class="ch-prev__ext" href="' + esc(a.url) + '" download aria-label="Download ' + esc(a.name) + '" title="Download">' + icHtml('dl') + '</a></div>';
    const canView = fk === 'pdf' || fk === 'docx' || fk === 'xlsx';
    const lab2 = LAB[fk] || 'FILE';
    const picf = canView && a.id ? thumbBox('f' + a.id, a.url, fk, lab2) : '<span class="ch-prev__pic"><span class="ch-file__ic" data-k="' + fk + '">' + lab2 + '</span></span>';
    const inner = picf + '<span class="ch-prev__t"><span class="ch-card__t" title="' + esc(a.name || '') + '">' + midName(a.name || 'Untitled file') + '</span><span class="ch-card__m">' + esc(sizeOf(a.size)) + '</span></span>';
    return (
      '<div class="ch-card ch-prev' + (canView ? '' : ' ch-prev--plain') + '"' + at + '>' + (canView ? '<button type="button" class="ch-prev__open" data-act="view"' + at + ' aria-label="Preview ' + esc(a.name) + '">' + inner + '</button>' : '<a class="ch-prev__open" href="' + esc(a.url) + '" download>' + inner + '</a>') +
      '<a class="ch-prev__ext" href="' + esc(a.url) + '" download aria-label="Download ' + esc(a.name) + '" title="Download">' + icHtml('dl') + '</a></div>'
    );
  }
  if (a.type === 'task') return W.FavorTaskCard ? W.FavorTaskCard.html(a, { esc, ic: icHtml }) : '';
  if (a.type === 'entity') return W.FavorEntity && W.FavorEntity.cardHtml ? W.FavorEntity.cardHtml(a, { esc }) : '<a class="ch-card ch-link" href="' + esc(a.url || '#') + '"><span class="ch-link__t"><span class="ch-card__m">' + esc(a.kind || '') + '</span><span class="ch-card__t">' + esc(a.title || a.name || '') + '</span></span></a>';
  if (a.type === 'ptask') return W.FavorProjectCard ? W.FavorProjectCard.html(a, { esc, ic: icHtml }) : '';
  if (a.type === 'link') {
    const pic = a.image && !broken[a.image] ? '<span class="ch-link__pic"><img src="' + esc(a.image) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></span>' : '';
    return '<a class="ch-card ch-link' + (pic ? ' ch-link--pic' : '') + '" href="' + esc(a.url) + '" target="_blank" rel="noopener"><span class="ch-link__t"><span class="ch-card__m">' + esc(a.site || a.host || '') + '</span><span class="ch-card__t">' + esc(a.title || a.url) + '</span>' + (a.desc ? '<span class="ch-card__s">' + esc(a.desc) + '</span>' : '') + '</span>' + pic + '</a>';
  }
  return '';
}

/* ------------------------------------------------------------------ playing and previewing in place */
function playIn(box: HTMLElement | null, root: HTMLElement) {
  if (!box || box.querySelector('video')) return;
  root.querySelectorAll<HTMLVideoElement>('.ch-vid video').forEach((v) => {
    try {
      v.pause();
    } catch {
      // none
    }
  });
  const v = document.createElement('video');
  v.className = 'ch-vid__v';
  v.controls = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.preload = 'auto';
  const p = box.querySelector<HTMLImageElement>('.ch-vid__poster');
  if (p && p.complete && p.naturalWidth) v.poster = p.src;
  v.src = box.getAttribute('data-vsrc') || '';
  box.classList.add('is-loading');
  const ready = () => box.classList.remove('is-loading');
  v.addEventListener('playing', ready);
  v.addEventListener('pause', ready);
  v.addEventListener('error', ready);
  box.appendChild(v);
  box.classList.add('is-playing');
  const pr = v.play();
  if (pr && pr.catch) pr.catch(() => undefined);
}
let viewTok: ReturnType<typeof hubOv.on> | null = null;
function viewerOpened() {
  const V = W.FavorChatView;
  if (!V) return;
  viewTok = hubOv.on(() => {
    viewTok = null;
    if (V.isOpen()) V.close();
  });
  V.onClose = () => {
    const t = viewTok;
    viewTok = null;
    if (t) hubOv.off(t);
  };
}
export function openViewer(e: ChatEngine, mid: number, i: number) {
  const m = e.findMsg(mid);
  const V = W.FavorChatView;
  const a = m && m.attachments && m.attachments[i];
  if (!a || !m) return;
  if (!V) {
    open(a.url, '_blank', 'noopener');
    return;
  }
  if (a.type === 'file' && fileKind(a) === 'image') {
    const list: J[] = [];
    let at = 0;
    const S = e.S;
    (S.msgs[m.channel_id] || []).concat(m.thread_id && S.threads[m.thread_id] ? S.threads[m.thread_id].replies : []).forEach((x: J) => {
      (x.attachments || []).forEach((y: J) => {
        if (y.type === 'file' && fileKind(y) === 'image') {
          if (y.url === a.url && x.id === m.id) at = list.length;
          list.push({ kind: 'image', url: y.url, name: y.name, download: y.url, sub: e.user(x.user_id).name });
        }
      });
    });
    if (!list.length) list.push({ kind: 'image', url: a.url, name: a.name, download: a.url });
    V.open(list[at], list);
  } else if (a.type === 'drive') {
    const id = driveId(a.url);
    V.open({ kind: 'drive', url: '/api/chat/drive-file/' + m.id + '/' + i + '/content', name: a.name, sub: a.path || 'Google Drive', external: a.url, externalShort: 'Drive', externalLabel: 'Open in Google Drive', page: '/api/chat/drive-file/' + m.id + '/' + i + '/thumb?s=1600', embed: id ? 'https://drive.google.com/file/d/' + id + '/preview' : '' });
  } else {
    const k = fileKind(a);
    V.open({ kind: k, url: a.url, name: a.name, sub: sizeOf(a.size), download: a.url, external: k === 'pdf' ? a.url : '', externalShort: 'Open', externalLabel: 'Open in a new tab' });
  }
  viewerOpened();
}
/** A large view over the chat (a Brain table): the same sheet as files, closed the same ways. */
export function openSheet(item: J, html: string, cls: string) {
  const V = W.FavorChatView;
  if (!V || !V.sheet) return null;
  const had = V.isOpen() && viewTok;
  const el = V.sheet(item, html, cls);
  if (!had) viewerOpened();
  return el;
}

/** Clicks inside drawn HTML (cards, chips, mentions): one handler for the list. Returns true when it took the click. */
export function listClick(e: ChatEngine, ev: React.MouseEvent<HTMLElement>, root: HTMLElement): boolean {
  const t = ev.target as HTMLElement;
  const el = t.closest<HTMLElement>('[data-act]');
  const chip = t.closest<HTMLElement>('[data-chip], .ch-at[data-entity], .ch-av[data-entity]');
  if (chip && (!el || !root.contains(el) || chip.contains(el))) {
    const ref = chip.getAttribute('data-chip') || chip.getAttribute('data-entity') || '';
    const [kind, ...rest] = ref.split(':');
    const id = rest.join(':');
    const isLink = chip.tagName === 'A';
    const phone = !matchMedia('(hover: hover)').matches || matchMedia('(max-width: 860px)').matches;
    if (!isLink || phone) {
      ev.preventDefault();
      entityStore.openCard(kind as any, id, chip.getAttribute('data-label') || '', chip);
    }
    return true;
  }
  if (!el) return false;
  const act = el.dataset.act;
  if (act === 'play') {
    playIn(el.closest('.ch-vid'), root);
    return true;
  }
  if (act === 'view') {
    openViewer(e, Number(el.dataset.cm), Number(el.dataset.ai) || 0);
    return true;
  }
  if (act === 'huddle' && el.tagName === 'A') {
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return true;
    ev.preventDefault();
    e.openHuddle(e.S.active);
    return true;
  }
  if (act === 'sm-orig') {
    e.toggleOrig(Number(el.dataset.id));
    return true;
  }
  return false;
}
/** Chips and mentions open their card on hover with a mouse, as everywhere else in FavorOS. */
export function listHover(ev: React.PointerEvent<HTMLElement>) {
  if (ev.pointerType !== 'mouse') return;
  const chip = (ev.target as HTMLElement).closest<HTMLElement>('[data-chip], .ch-at[data-entity]');
  if (!chip || (chip as any)._feT) return;
  (chip as any)._feT = setTimeout(() => {
    (chip as any)._feT = 0;
    if (!chip.matches(':hover')) return;
    const ref = chip.getAttribute('data-chip') || chip.getAttribute('data-entity') || '';
    const [kind, ...rest] = ref.split(':');
    entityStore.openCard(kind as any, rest.join(':'), chip.getAttribute('data-label') || '', chip);
  }, 420);
}
/** A picture that will not load becomes a plain file row; an avatar falls back to initials. */
export function listImgError(ev: React.SyntheticEvent<HTMLElement>) {
  const im = ev.target as HTMLImageElement;
  if (!im || im.tagName !== 'IMG') return;
  const src = im.getAttribute('src') || '';
  const avBox = im.closest('.ch-av');
  if (avBox) {
    broken[src] = 1;
    im.replaceWith(document.createTextNode(im.dataset.ini || '?'));
    return;
  }
  const photo = im.closest('.ch-photo');
  if (photo) {
    photo.classList.add('is-broken');
    photo.removeAttribute('style');
    photo.innerHTML = '<span class="ch-file__ic" data-k="image">IMG</span><span class="ch-photo__n">' + esc(im.getAttribute('alt') || 'Picture') + '</span>';
    return;
  }
  if (!im.closest('.ch-vid') && !im.closest('.ch-prev__pic') && !im.closest('.ch-link__pic')) return;
  broken[src] = 1;
  im.hidden = true;
  const pic = im.closest('.ch-prev__pic');
  if (pic && im.dataset.fallback) pic.innerHTML = '<span class="ch-file__ic" data-k="' + esc(im.dataset.k || 'file') + '">' + esc(im.dataset.fallback) + '</span>';
}

/* ------------------------------------------------------------------ one message */
interface MsgProps {
  e: ChatEngine;
  m: J;
  cont?: boolean;
  inThread?: boolean;
  bare?: boolean;
  /** Anything outside the message that changes how it draws (editing, translation, a huddle on its card). */
  sig: string;
}
function BrainAnswer({ e, m }: { e: ChatEngine; m: J }) {
  const ref = useRef<HTMLDivElement>(null);
  const b = m.brain || {};
  const B = W.FavorChatBrain;
  const html = b.status === 'thinking' || !(b.blocks && b.blocks.length) ? '' : B ? B.html(b.blocks, m) : '';
  useEffect(() => {
    if (html && ref.current && B) B.draw(ref.current);
  }, [html, B]);
  if (b.status === 'thinking')
    return (
      <div className="ch-ans">
        <span className="ch-ans__live">
          <Ring state="thinking" />
          Reading the records
        </span>
      </div>
    );
  if (!(b.blocks && b.blocks.length)) return null;
  if (html) return <div className="ch-ans" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
  // The renderer is still loading: the plain blocks.
  return (
    <div className="ch-ans">
      {b.blocks.map((x: J, i: number) =>
        x.type === 'text' || x.md ? <div key={i} className="ch-msg__text" dangerouslySetInnerHTML={{ __html: fmtBody(x.text || x.md || '', e.names) }} /> : null
      )}
    </div>
  );
}
function PrivateBar({ e, m }: { e: ChatEngine; m: J }) {
  const b = m.brain || {};
  const ready = b.status === 'done' || (b.blocks && b.blocks.length && b.status !== 'thinking');
  if (m.user_id !== 'brain')
    return (
      <div className="ch-private">
        <span className="ch-private__tag">
          <Ic n="lock" />
          Only visible to you
        </span>
      </div>
    );
  return (
    <div className="ch-private" data-private={m.id}>
      <span className="ch-private__tag">
        <Ic n="lock" />
        Only visible to you
      </span>
      {b.status !== 'thinking' && (
        <span className="ch-private__acts">
          {ready && (
            <button type="button" className="ch-btn ch-btn--sm ch-btn--primary" data-act="share-answer" onClick={(ev) => { (ev.currentTarget as HTMLButtonElement).disabled = true; e.shareAnswer(m.id).catch(() => ((ev.target as HTMLButtonElement).disabled = false)); }}>
              Share to channel
            </button>
          )}
          <button type="button" className="ch-btn ch-btn--sm" data-act="dismiss-answer" onClick={() => void e.dismissAnswer(m.id).catch(() => undefined)}>
            Dismiss
          </button>
        </span>
      )}
    </div>
  );
}
function EditBox({ e, m }: { e: ChatEngine; m: J }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Focus as soon as the box is in the page: the menu item that opened it is gone by then, and a deferred effect lets keys land nowhere.
  useLayoutEffect(() => {
    const t = ref.current;
    if (t) {
      t.focus();
      t.setSelectionRange(t.value.length, t.value.length);
    }
  }, []);
  const save = () => e.saveEdit(m.id, ref.current?.value || '');
  const cancel = () => {
    e.S.editing = null;
    e.composerFocus = { scope: m.thread_id ? 'thread' : 'main', n: Date.now() };
    e.notify();
  };
  return (
    <div className="ch-edit">
      <textarea
        ref={initValue(e.S.editDraft != null && e.S.editDraftId === m.id ? e.S.editDraft : m.body, ref)}
        className="ch-input"
        data-edit={m.id}
        rows={2}
        style={{ height: 'auto', padding: '8px 12px' }}
        onInput={(ev) => {
          e.S.editDraft = (ev.target as HTMLTextAreaElement).value;
          e.S.editDraftId = m.id;
        }}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape') {
            ev.preventDefault();
            ev.stopPropagation();
            cancel();
          } else if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) {
            ev.preventDefault();
            save();
          }
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button type="button" className="ch-btn ch-btn--sm ch-btn--primary" data-act="edit-save" onClick={save}>
          Save
        </button>
        <button type="button" className="ch-btn ch-btn--sm" data-act="edit-cancel" onClick={cancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
function Reactions({ e, m, bare }: { e: ChatEngine; m: J; bare?: boolean }) {
  const rs = (m.reactions || []).filter((r: J) => r.users && r.users.length);
  if (!rs.length) return null;
  const me = e.S.me.id;
  return (
    <div className="ch-react">
      {rs.map((r: J) => {
        const mine = r.users.indexOf(me) >= 0;
        const who = r.users.slice(0, 20).map((u: string) => e.user(u).name).join(', ') + (r.users.length > 20 ? ' and ' + (r.users.length - 20).toLocaleString('en-US') + ' more' : '');
        return (
          <button key={r.emoji} type="button" className={'ch-rx' + (mine ? ' is-mine' : '')} data-act="react" data-e={r.emoji} title={who} aria-pressed={mine} onClick={() => void e.react(m.id, r.emoji).catch(() => undefined)}>
            <span>{r.emoji}</span>
            {r.users.length.toLocaleString('en-US')}
          </button>
        );
      })}
      {!bare && (
        <button type="button" className="ch-rx ch-rx--add" data-act="react-pick" aria-label="Add a reaction" onClick={(ev) => e.setPop({ kind: 'emoji', id: m.id, anchor: ev.currentTarget.getBoundingClientRect() })}>
          <Ic n="smile" />
        </button>
      )}
    </div>
  );
}
export const Message = memo(
  function Message({ e, m, cont, inThread, bare }: MsgProps) {
    const S = e.S;
    const u = e.user(m.user_id);
    const mine = m.user_id === S.me.id;
    const brain = m.user_id === 'brain';
    const cls = 'ch-msg' + (cont ? ' ch-msg--cont' : '') + (brain ? ' ch-msg--brain' : '') + (mentionsMe(m, S.me.id) && !mine ? ' is-mention' : '') + (m.pinned && !m.deleted ? ' is-pinned' : '');
    const tx = e.trFor(m);
    const t = S.lang && S.tr[m.id];
    const trNote = t && t.text && t.body === m.body && !mine;
    const ref = m.deleted ? null : threadRef(m);
    const cards = !m.deleted && m.attachments && m.attachments.length ? m.attachments.map((a: J, i: number) => cardHtml(e, a, m, i)).join('') : '';
    const showBar = !m.deleted && !bare && (!m.visible_to || mine);
    return (
      <article className={cls} data-mid={m.id}>
        <div className="ch-msg__gut">{cont ? <span className="ch-msg__time">{timeOf(m.created_at).replace(/ (AM|PM)/, '')}</span> : <Avatar u={u} />}</div>
        <div className="ch-msg__body">
          {m.pinned && !m.deleted && (
            <div className="ch-pinline">
              <Ic n="pin" />
              Pinned
            </div>
          )}
          {!cont && (
            <div className="ch-msg__meta">
              <span className="ch-msg__name">{u.name}</span>
              {brain ? (
                <>
                  <span className="ch-tag">Brain</span>
                  {m.brain && m.brain.shared_by && <span className="ch-shared">Shared by {e.user(m.brain.shared_by).name}</span>}
                </>
              ) : m.user_id === 'meetings' ? (
                <span className="ch-tag" style={{ background: 'var(--tc-teal-tint)', color: 'var(--tc-teal-ink)' }}>
                  Meeting
                </span>
              ) : null}
              <span className="ch-msg__time">{timeOf(m.created_at)}</span>
            </div>
          )}
          {ref && (
            <button type="button" className="ch-tref" data-act="thread" onClick={() => e.openThread(ref.root)}>
              <Ic n="reply" />
              <span>
                Replied to a thread{ref.text ? ': ' : ''}
                {ref.text && <b>{ref.text}</b>}
              </span>
            </button>
          )}
          {m.deleted ? (
            <div className="ch-msg__text ch-msg__deleted">This message was deleted.</div>
          ) : S.editing === m.id ? (
            <EditBox e={e} m={m} />
          ) : m.body ? (
            <>
              <div className="ch-msg__text" dangerouslySetInnerHTML={{ __html: fmtBody(tx ? tx.text : m.body, e.names) + (m.edited_at ? '<span class="ch-msg__edited">(edited)</span>' : '') }} />
              {trNote && (
                <div className="ch-tr">
                  <span>{tx ? 'Translated from ' + e.langName(t.src) : 'Original, ' + e.langName(t.src)}</span>
                  <button type="button" data-act="sm-orig" onClick={() => e.toggleOrig(m.id)}>
                    {tx ? 'Show original' : 'Show translation'}
                  </button>
                </div>
              )}
            </>
          ) : null}
          {cards && <div className="ch-cards" dangerouslySetInnerHTML={{ __html: cards }} />}
          {!m.deleted && brain && <BrainAnswer e={e} m={m} />}
          {!m.deleted && m.visible_to && <PrivateBar e={e} m={m} />}
          {!m.deleted && <Reactions e={e} m={m} bare={bare} />}
          {!inThread && !bare && m.reply_count > 0 && (
            <button type="button" className={'ch-replies' + (m.thread_unread ? ' has-new' : '')} data-act="thread" onClick={() => e.openThread(m.id)}>
              <span className="ch-stack">
                {(m.reply_users || []).slice(0, 3).map((id: string) => (
                  <Avatar key={id} u={e.user(id)} size="xs" />
                ))}
              </span>
              {plural(m.reply_count, 'reply', 'replies')}
              {m.thread_unread ? <span className="ch-replies__new">{m.thread_unread} new</span> : null}
              <small>Last reply {ago(m.last_reply_at || m.created_at)}</small>
            </button>
          )}
        </div>
        {showBar && (
          <div className="ch-bar" role="toolbar" aria-label="Message actions">
            {!m.visible_to && (
              <button type="button" data-act="react-pick" aria-label="React" title="React" onClick={(ev) => e.setPop({ kind: 'emoji', id: m.id, anchor: ev.currentTarget.getBoundingClientRect() })}>
                <Ic n="smile" />
              </button>
            )}
            {!m.visible_to && !inThread && (
              <button type="button" data-act="thread" aria-label="Reply in thread" title="Reply in thread" onClick={() => e.openThread(threadIdOf(m))}>
                <Ic n="reply" />
              </button>
            )}
            <button type="button" data-act="more" aria-label="More actions" title="More actions" aria-haspopup="menu" onClick={(ev) => e.setPop({ kind: 'more', id: m.id, anchor: ev.currentTarget.getBoundingClientRect(), below: true })}>
              <Ic n="more" />
            </button>
          </div>
        )}
      </article>
    );
  },
  (a, b) => a.m === b.m && a.cont === b.cont && a.inThread === b.inThread && a.bare === b.bare && a.sig === b.sig && a.e === b.e
);

/** What outside a message changes its drawing. */
export function sigOf(e: ChatEngine, m: J): string {
  const S = e.S;
  let s = S.editing === m.id ? 'e' : '';
  if (S.lang && S.tr[m.id]) s += 't' + (S.trOrig[m.id] ? 'o' : '');
  if ((m.attachments || []).some((a: J) => a.type === 'meeting')) s += 'h' + JSON.stringify(S.huddle[S.active] || null).length + (S.huddle[S.active] ? S.huddle[S.active].people.length : '');
  if (m.user_id === 'brain') s += 'b' + (W.FavorChatBrain ? 1 : 0) + ((W.FavorChatBrain && W.FavorChatBrain.turns[m.id] && W.FavorChatBrain.turns[m.id].rev) || 0);
  return s;
}

/* ------------------------------------------------------------------ a list of messages */
export function msgParts(e: ChatEngine, list: J[], o: { lastRead?: number; inThread?: boolean; bare?: boolean } = {}): ReactNode[] {
  const out: ReactNode[] = [];
  let prev: J | null = null;
  let newShown = false;
  const me = e.S.me.id;
  for (const m of list) {
    const dk = dayKey(m.created_at);
    if (!prev || dayKey(prev.created_at) !== dk)
      out.push(
        <div key={'d' + dk} className="ch-day">
          <span>{dayLabel(m.created_at)}</span>
        </div>
      );
    if (!newShown && o.lastRead != null && Number(o.lastRead) > 0 && Number(m.id) > Number(o.lastRead) && m.user_id !== me) {
      out.push(
        <div key="new" className="ch-new" id={o.inThread ? undefined : 'ch-new'} data-new="">
          New
        </div>
      );
      newShown = true;
    }
    const cont =
      !!prev &&
      prev.user_id === m.user_id &&
      dayKey(prev.created_at) === dk &&
      new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60000 &&
      !m.deleted &&
      !prev.deleted &&
      !(prev.reply_count && !o.inThread) &&
      !m.pinned &&
      !threadRef(m) &&
      !m.visible_to &&
      !prev.visible_to;
    out.push(<Message key={'m' + m.id} e={e} m={m} cont={cont} inThread={o.inThread} bare={o.bare} sig={sigOf(e, m)} />);
    prev = m;
  }
  return out;
}

export function Intro({ e, c }: { e: ChatEngine; c: J }) {
  const n = e.chName(c);
  if (c.kind === 'dm')
    return (
      <div className="ch-intro">
        <h2>{n}</h2>
        <p>The start of your conversation with {n}.</p>
      </div>
    );
  if (c.kind === 'group')
    return (
      <div className="ch-intro">
        <h2>{n}</h2>
        <p>The start of the group conversation.</p>
      </div>
    );
  return (
    <div className="ch-intro">
      <h2>
        {c.kind === 'private' ? (
          <span className="ch-intro__lock">
            <Ic n="lock" />
          </span>
        ) : (
          '# '
        )}
        {n}
      </h2>
      <p>{c.topic || 'The start of the channel.'}</p>
    </div>
  );
}

export const Skel = () => (
  <div className="ch-skel">
    <i style={{ width: '30%' }} />
    <i style={{ width: '80%' }} />
    <i style={{ width: '55%' }} />
    <i style={{ width: '70%' }} />
  </div>
);

export function TypingLine({ text }: { text: string }) {
  return (
    <div className="ch-typing" aria-live="polite" data-typing={text ? '1' : undefined}>
      {text && (
        <>
          <i />
          <i />
          <i />
          <span>{text}</span>
        </>
      )}
    </div>
  );
}

/** The Catch me up strip above a channel's messages: an offer at five unread, the summary, or that there is nothing new. */
export function CatchStrip({ e }: { e: ChatEngine }) {
  const S = e.S;
  const c = e.chan(S.active);
  const st = c && S.catchup[c.id];
  if (!c || !st || st.st === 'idle' || st.st === 'off' || S.page !== 'channel') return null;
  const x = (
    <button type="button" className="ch-iconbtn" data-act="sm-catch-x" aria-label="Dismiss" onClick={() => e.catchOff()}>
      <Ic n="x" />
    </button>
  );
  const ic = (
    <span className="sm-catch__ic">
      <Ic n="spark" />
    </span>
  );
  if (st.st === 'none')
    return (
      <div id="sm-catch" className="sm-catch">
        <div className="sm-catch__r">
          {ic}
          <span>Nothing new since you last read</span>
          {x}
        </div>
      </div>
    );
  if (st.st === 'offer')
    return (
      <div id="sm-catch" className="sm-catch">
        <div className="sm-catch__r">
          {ic}
          <span>
            <b>{st.n} new messages</b> from {plural(st.people, 'person', 'people')}
          </span>
          <button type="button" className="ch-btn ch-btn--sm ch-btn--primary" data-act="sm-catch-go" onClick={() => e.catchGo(false)}>
            Catch me up
          </button>
          {x}
        </div>
      </div>
    );
  if (st.st === 'work')
    return (
      <div id="sm-catch" className="sm-catch">
        <div className="sm-catch__r">
          {ic}
          <span>Reading the new messages</span>
        </div>
      </div>
    );
  const d = st.data || { points: [], for_you: [] };
  const pts = (l: J[]) =>
    l.map((p, i) => (
      <li key={i}>
        {p.text}{' '}
        {p.ids && p.ids.length ? (
          <button type="button" className="sm-catch__j" data-act="sm-jump" onClick={() => e.focusMessage(p.ids[0])}>
            See it
          </button>
        ) : null}
      </li>
    ));
  return (
    <div id="sm-catch" className="sm-catch">
      <div className="sm-catch__c">
        <div className="sm-catch__h">
          {ic}
          <b>{d.headline || 'Caught up'}</b>
          {x}
        </div>
        <ul>{pts(d.points || [])}</ul>
        {(d.for_you || []).length ? (
          <div className="sm-catch__f">
            <b>For you</b>
            <ul>{pts(d.for_you)}</ul>
          </div>
        ) : null}
        <small>
          {plural(d.count || 0, 'message')} from {plural(d.people || 0, 'person', 'people')}
        </small>
      </div>
    </div>
  );
}

/**
 * The scroll box for a list of messages. It keeps the newest message in view while the list is at the bottom (pictures and cards
 * arriving above, the keyboard opening), opens at the New line, holds its place when older messages load above, and shows Latest.
 */
export function useStick(box: React.RefObject<HTMLElement | null>, opts: { key: string; bottom: number; keep?: number; onFar: (far: boolean) => void; atNew?: boolean }) {
  const st = useRef({ pinned: true, lastTop: 0, key: '', h: 0, far: false, bottom: 0, keep: 0, hidden: false });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const s = st.current;
    if (s.key !== opts.key) {
      s.key = opts.key;
      s.bottom = opts.bottom;
      const nw = opts.atNew ? el.querySelector<HTMLElement>('[data-new]') : null;
      if (nw) el.scrollTop = Math.max(0, nw.offsetTop - el.offsetTop - 60);
      else el.scrollTop = el.scrollHeight;
      s.pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    } else if (opts.keep && opts.keep !== s.keep) {
      el.scrollTop = el.scrollHeight - s.h + el.scrollTop;
    } else if (opts.bottom !== s.bottom || s.pinned) {
      el.scrollTop = el.scrollHeight;
      s.pinned = true;
    }
    s.bottom = opts.bottom;
    s.keep = opts.keep || 0;
    s.h = el.scrollHeight;
  });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const s = st.current;
    const on = () => {
      // A hidden list (a phone shows the thread in its place) has no scroll position worth keeping.
      if (!el.clientHeight) return;
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      s.pinned = gap < 60 || (s.pinned && el.scrollTop >= s.lastTop - 2);
      s.lastTop = el.scrollTop;
      s.h = el.scrollHeight;
      const far = gap > 260;
      if (far !== s.far) {
        s.far = far;
        opts.onFar(far);
      }
    };
    el.addEventListener('scroll', on, { passive: true });
    let ro: ResizeObserver | null = null;
    if ('ResizeObserver' in window) {
      ro = new ResizeObserver(() => {
        // Hidden and shown again (a phone going to a thread and back): the browser drops the scroll position, so put it back.
        if (!el.clientHeight) {
          s.hidden = true;
          return;
        }
        if (s.hidden) {
          s.hidden = false;
          if (!s.pinned) {
            el.scrollTop = s.lastTop;
            s.h = el.scrollHeight;
            return;
          }
        }
        if (s.pinned) el.scrollTop = el.scrollHeight;
        s.h = el.scrollHeight;
      });
      ro.observe(el);
      const inner = el.querySelector(':scope > [data-stick]') || el.firstElementChild;
      if (inner) ro.observe(inner);
    }
    return () => {
      el.removeEventListener('scroll', on);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box.current]);
  return st;
}
