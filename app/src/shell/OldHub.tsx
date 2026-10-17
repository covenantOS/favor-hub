import { useRef } from 'react';
import { BodyPortal } from './BodyPortal';
import { Icon } from './Icon';

/** The hub's home page as it stood on 2026-10-01 (src/components/DashboardGrid.astro at ce16c7e2): the same tiles, same order, same
 * links. Danny and Rachel asked for it back as a quick box for staff who still reach for the old tools. FavorOS links go through the
 * middleware's redirects to the page each one became. */
const TILES: Array<{ title: string; desc: string; href: string; icon: string }> = [
  { title: 'Website & app requests', desc: 'Fixes, new pages, job posts.', href: '/requests/new', icon: 'board' },
  { title: 'Blackbaud', desc: 'Partner records.', href: 'https://app.blackbaud.com/signin/?redirectUrl=https://app.blackbaud.com/', icon: 'users' },
  { title: 'GoHighLevel', desc: 'Email and marketing.', href: 'https://my.favor.international', icon: 'mail' },
  { title: 'RDD Reports', desc: 'Reports for each RDD.', href: '/rdd', icon: 'chart' },
  { title: 'Media Folder', desc: 'Photos and videos from the field.', href: 'https://drive.google.com/drive/folders/1vJQn3vvoxKWKjW4ZmYDDfPZ0Li_w8-ZU', icon: 'camera' },
  { title: 'Marketing Materials', desc: 'Spreadsheet of current pieces.', href: 'https://docs.google.com/spreadsheets/d/1voiT9f4oixPz0cRAJrQTyik-PqCwP3hGGhC-br1PjOU/edit?usp=sharing', icon: 'file' },
  { title: 'Marketing Request', desc: 'Asana form for a new project.', href: 'https://form.asana.com/?k=ZLVP4wa-hVh36WUjOH4FyQ&d=1200803238481574', icon: 'out' },
  { title: 'Time Off', desc: 'Paycom PTO.', href: 'https://phx.us-west.paycomonline.net/v4/ee/web.php/accruals/time-off', icon: 'cal' },
  { title: 'Time Sheet', desc: 'Paycom punch in and out.', href: 'https://www.paycomonline.net/v4/ee/web.php/app/login', icon: 'work' },
  { title: 'Paycom Expenses', desc: 'Cards and expense reports in Paycom.', href: 'https://www.paycomonline.net/v4/ee/web.php/app/login', icon: 'receipt' },
  { title: 'Expense Request', desc: 'Expenses and purchases, signed online.', href: '/expenses/new', icon: 'receipt' },
];

/** The grid button in the top bar and the box it opens. */
export function OldHub() {
  const dlg = useRef<HTMLDialogElement>(null);
  let downOn: EventTarget | null = null;
  return (
    <>
      <button type="button" className="h-top__cam" id="oh-btn" aria-haspopup="dialog" aria-label="Old hub tools" title="Old hub tools" onClick={() => dlg.current?.showModal()}>
        <Icon name="tools" />
      </button>
      {BodyPortal(
      <dialog
        className="oh"
        ref={dlg}
        aria-labelledby="oh-title"
        onPointerDownCapture={(e) => { downOn = e.target; }}
        onClick={(e) => {
          if (e.target === dlg.current && (downOn === dlg.current || downOn === null)) dlg.current?.close();
          downOn = null;
        }}
      >
        <div className="oh__bar">
          <h2 id="oh-title">Old hub tools</h2>
          <button type="button" className="lp__x" aria-label="Close" onClick={() => dlg.current?.close()}>&times;</button>
        </div>
        <div className="oh__grid">
          {TILES.map((t) => {
            const ext = t.href.startsWith('http');
            return (
              <a key={t.title} className="oh__tile" href={t.href} target={ext ? '_blank' : undefined} rel={ext ? 'noopener' : undefined} onClick={() => { if (!ext) dlg.current?.close(); }}>
                <Icon name={t.icon} />
                <span className="oh__t">{t.title}{ext && <Icon name="ext" className="h-i oh__ext" />}</span>
                <span className="oh__d">{t.desc}</span>
              </a>
            );
          })}
        </div>
      </dialog>)}
    </>
  );
}
