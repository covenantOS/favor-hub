// Typed blocks for the asker's day and work: each part looks like what it is. A small header with its icon, a count and an
// Open link, then rows: meetings with a time column, provider badge, faces and Join; mail with the sender's face, subject,
// snippet and an unread dot; files with a type icon, who changed it and when (a thumbnail for pictures); tasks with a box,
// the project and the due date. Narrow answers (dock, phone) keep the same rows, tighter (brain.css .tb).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { dlong, hueOf, int, safeHref, whenShort } from '../fmt';
import { Ic } from '../icons';
import type { BlockProps } from './ctx';

const initials2 = (n: unknown) =>
  String(n || '?')
    .replace(/[^A-Za-z@ ]/g, ' ')
    .trim()
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';
const Face = ({ name, email, more }: { name?: string; email?: string; more?: number }) =>
  more ? (
    <span className="tb-av tb-av--more">+{more}</span>
  ) : (
    <span className="tb-av" style={{ ['--av-h' as string]: hueOf(email || name) }} title={name || email} aria-hidden="true">
      {initials2(name || email)}
    </span>
  );
function Head({ icon, title, note, link, linkLabel, n }: { icon: string; title: string; note?: string; link?: string; linkLabel?: string; n?: number }) {
  const ext = link && /^https?:/.test(link);
  return (
    <div className="tb-h">
      <span className="tb-h__ic" aria-hidden="true">
        <Ic n={icon} />
      </span>
      <b>{title}</b>
      {n != null && <span className="tb-h__n">{int(n)}</span>}
      {note && <span className="tb-h__s">{note}</span>}
      {link && (
        <a className="tb-h__go" href={safeHref(link)} {...(ext ? { target: '_blank', rel: 'noopener' } : {})}>
          {linkLabel}
          <Ic n="arrow" />
        </a>
      )}
    </div>
  );
}
const PROVIDER: Record<string, string> = { FavorOS: 'favoros', 'Google Meet': 'gmeet', Zoom: 'zoom' };

export function CalendarBlock({ b }: BlockProps) {
  const items = (b.items || []) as any[];
  return (
    <div className="card tb tb--cal">
      <Head icon="cal" title={b.title || "Today's meetings"} note={b.note} link="https://calendar.google.com/calendar/u/0/r/day" linkLabel="Open in Calendar" n={items.length} />
      {items.length ? (
        <ul className="tb-list">
          {items.map((e, i) => {
            const ppl = (e.people || []) as { name?: string; email?: string }[];
            const names = ppl.slice(0, 3).map((p) => p.name || String(p.email || '').split('@')[0]).join(', ') + (ppl.length > 3 ? ` and ${ppl.length - 3} more` : '');
            return (
              <li className="tb-row tb-cal" key={i}>
                <span className="tb-cal__t">{e.time || ''}</span>
                <span className="tb-cal__ic" aria-hidden="true" />
                <span className="tb-main">
                  <span className="tb-title">{e.title || 'Meeting'}</span>
                  <span className="tb-sub">
                    {e.provider && <span className={'tb-badge tb-badge--' + (PROVIDER[e.provider] || 'other')}>{e.provider}</span>}
                    {names && <span className="tb-who">{names}</span>}
                  </span>
                </span>
                <span className="tb-side">
                  {ppl.length > 0 && (
                    <span className="tb-faces">
                      {ppl.slice(0, 4).map((p, k) => (
                        <Face key={k} name={p.name} email={p.email} />
                      ))}
                      {ppl.length > 4 && <Face more={ppl.length - 4} />}
                    </span>
                  )}
                  {e.join && (
                    <a className="h-btn h-btn--primary h-btn--xs" href={safeHref(e.join)} target="_blank" rel="noopener" aria-label={'Join ' + (e.title || 'the meeting')}>
                      Join
                    </a>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="tb-none">No meetings today.</p>
      )}
    </div>
  );
}

export function MailBlock({ b }: BlockProps) {
  const items = (b.items || []) as any[];
  return (
    <div className="card tb tb--mail">
      <Head icon="mail" title={b.title || 'Unread mail'} note={b.note} link="/mail/" linkLabel="Open in Mail" n={items.length} />
      {items.length ? (
        <ul className="tb-list">
          {items.map((m, i) => (
            <li className={'tb-row tb-mail' + (m.unread ? ' is-unread' : '')} key={i}>
              <a className="tb-rowlink" href={safeHref(m.thread ? `/mail/#/INBOX/${encodeURIComponent(m.thread)}` : m.link)}>
                <Face name={m.from} email={m.email} />
                <span className="tb-main">
                  <span className="tb-top">
                    <span className="tb-from">{m.from || m.email || 'Unknown sender'}</span>
                    <span className="tb-when">{whenShort(m.at) || m.received || ''}</span>
                  </span>
                  <span className="tb-title">
                    {m.unread && <i className="tb-dot" aria-label="Unread" />}
                    {m.subject || '(No subject)'}
                  </span>
                  {m.snippet && <span className="tb-snip">{m.snippet}</span>}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tb-none">No unread mail.</p>
      )}
    </div>
  );
}

const FKIND = (f: any) => {
  const k = String(f.kind || '').toLowerCase();
  const m = String(f.mime || '');
  return /image/.test(m) || k === 'image' ? 'image' : k === 'sheet' || /spreadsheet/.test(m) ? 'sheet' : k === 'slides' || /presentation/.test(m) ? 'slides' : /pdf/.test(m) || k === 'pdf' ? 'pdf' : /video/.test(m) ? 'video' : 'doc';
};
const FK_ICON: Record<string, string> = { doc: 'fdoc', pdf: 'fdoc', sheet: 'fgrid', slides: 'fslides', image: 'fimage', video: 'play' };
const FK_LABEL: Record<string, string> = { doc: 'Doc', pdf: 'PDF', sheet: 'Sheet', slides: 'Slides', image: 'Picture', video: 'Video' };
export function FileListBlock({ b }: BlockProps) {
  const items = (b.items || []) as any[];
  return (
    <div className="card tb tb--files">
      <Head icon="fdoc" title={b.title || 'Files'} note={b.note} link="https://drive.google.com/drive/shared-with-me" linkLabel="Open in Drive" n={items.length} />
      {items.length ? (
        <ul className="tb-list">
          {items.map((f, i) => {
            const k = FKIND(f);
            const meta = [FK_LABEL[k], f.by ? 'changed by ' + f.by : '', whenShort(f.at) || (f.modified ? dlong(f.modified) : '')].filter(Boolean).join(' · ');
            return (
              <li className="tb-row tb-file" key={i}>
                <a className="tb-rowlink" href={safeHref(f.link)} target="_blank" rel="noopener">
                  {k === 'image' && f.id ? (
                    <span className="tb-ftile tb-ftile--pic">
                      <img src={`/api/brain/drive/thumb?id=${encodeURIComponent(f.id)}&s=400`} alt="" loading="lazy" onError={(e) => e.currentTarget.remove()} />
                    </span>
                  ) : (
                    <span className={'tb-ftile tb-ftile--' + k} aria-hidden="true">
                      <Ic n={FK_ICON[k]} />
                    </span>
                  )}
                  <span className="tb-main">
                    <span className="tb-title">{f.name || 'File'}</span>
                    <span className="tb-sub">{meta}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="tb-none">No files changed this week.</p>
      )}
    </div>
  );
}

export function TasksBlock({ b }: BlockProps) {
  const items = (b.items || []) as any[];
  const today = new Date(new Date().toDateString());
  return (
    <div className="card tb tb--tasks">
      <Head icon="check" title={b.title || 'Your tasks'} note={b.note} link="/projects/" linkLabel="Open in Projects" n={items.length} />
      {items.length ? (
        <ul className="tb-list">
          {items.map((t, i) => {
            const due = t.due ? new Date(String(t.due).length === 10 ? t.due + 'T12:00:00' : t.due) : null;
            const late = !!due && !t.done && due < today;
            return (
              <li className={'tb-row tb-task' + (t.done ? ' is-done' : '')} key={i}>
                <span className="tb-check" role="img" aria-label={t.done ? 'Done' : 'Open'}>
                  {t.done && <Ic n="check" />}
                </span>
                <a className="tb-main" href={safeHref(t.link || '/projects/')}>
                  <span className="tb-title">{t.title || 'Task'}</span>
                  <span className="tb-sub">
                    {t.project && <span className="tb-chip">{t.project}</span>}
                    {due && (
                      <span className={'tb-due' + (late ? ' is-late' : '')}>
                        {late ? 'Overdue, ' : 'Due '}
                        {due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="tb-none">No open tasks.</p>
      )}
    </div>
  );
}
