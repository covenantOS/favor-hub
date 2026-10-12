/* eslint-disable @typescript-eslint/no-explicit-any */
// Mail's icons (the same paths the classic page draws) and its small formatting helpers.
import type { ReactElement } from 'react';

export const ICON: Record<string, string> = {
    back: '<path d="m15 5-7 7 7 7"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9"/><path d="M10 13h4"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
    unread: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    read: '<path d="M3 10l9-6 9 6v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="m3 10 9 6 9-6"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
    star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.9z"/>',
    more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    reply: '<path d="M10 8 5 12.5l5 4.5"/><path d="M5 12.5h9a5 5 0 0 1 5 5V19"/>',
    replyall: '<path d="M11 8 6 12.5l5 4.5"/><path d="M7 8 2 12.5 7 17"/><path d="M6 12.5h8a5 5 0 0 1 5 5V19"/>',
    fwd: '<path d="m14 8 5 4.5-5 4.5"/><path d="M19 12.5h-9a5 5 0 0 0-5 5V19"/>',
    clip: '<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>',
    drive: '<path d="M8 3h8l6 10-4 7H6l-4-7z"/><path d="M8 3l6 10M16 3 10 13M2 13h12"/>',
    rec: '<rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10.5 5-3v9l-5-3z"/>',
    task: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    log: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    ext: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>',
    dl: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
    inbox: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
    send: '<path d="M4 12 20 4l-6 16-3-7z"/><path d="m11 13 9-9"/>',
    draft: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 13h7M9 17h4"/>',
    all: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
    spam: '<path d="M12 3 3 19h18z"/><path d="M12 10v4M12 17h.01"/>',
    imp: '<path d="M4 6h11l5 6-5 6H4l4-6z"/>',
    bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
    ital: '<path d="M10 5h8M6 19h8M14 5l-4 14"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    chevd: '<path d="m6 9 6 6 6-6"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    key: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
    box: '<rect x="4" y="4" width="16" height="16" rx="3"/>',
    boxon: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2.5h7.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
    sort: '<path d="M7 5v14"/><path d="m3.5 15.5 3.5 3.5 3.5-3.5"/><path d="M17 19V5"/><path d="m13.5 8.5 3.5-3.5 3.5 3.5"/>',
    bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
    hourglass: '<path d="M7 3h10M7 21h10"/><path d="M8 3c0 5 8 5 8 9s-8 4-8 9"/><path d="M16 3c0 5-8 5-8 9s8 4 8 9"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3 3-2.5 4 3.5"/>',
    wand: '<path d="m5 19 10-10"/><path d="m14 5 1-2 1 2 2 1-2 1-1 2-1-2-2-1z"/><path d="M19 12l.7 1.3L21 14l-1.3.7L19 16l-.7-1.3L17 14l1.3-.7z"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    q: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/>',
    filter: '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
    broom: '<path d="M14 4l6 6"/><path d="m12.5 7.5 4 4L9 19H4v-5z"/><path d="M8 15l3 3"/>'
};

export function MI({ n, cls }: { n: string; cls?: string }): ReactElement {
  return <svg className={'ml-i' + (cls ? ' ' + cls : '')} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICON[n] || '' }} />;
}

export const initials = (s: string | undefined) =>
  String(s || '?').replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
export const hue = (s: string) => {
  let n = 0;
  for (let i = 0; i < String(s).length; i++) n = (n * 31 + String(s).charCodeAt(i)) % 8;
  return n;
};
export const who = (a: any) => (a ? a.name || a.email || '' : '');

export function when(iso: string, long?: boolean): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (long) return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric', hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (now.getTime() - d.getTime() < 6 * 864e5) return d.toLocaleDateString('en-US', { weekday: 'short' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}
export function size(n: number) {
  n = Number(n) || 0;
  return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';
}
export function kindOf(mime: string, name: string) {
  const t = (mime || '') + ' ' + (name || '');
  if (/^image\//.test(mime || '') || /\.(png|jpe?g|gif|webp)$/i.test(name || '')) return 'image';
  if (/pdf/i.test(t)) return 'pdf';
  if (/wordprocessingml|\.docx/i.test(t)) return 'docx';
  if (/spreadsheetml|\.xlsx|text\/csv|\.csv/i.test(t)) return 'xlsx';
  if (/^video\//.test(mime || '')) return 'video';
  if (/^audio\//.test(mime || '')) return 'audio';
  return 'file';
}
export const isPhone = () => matchMedia('(max-width: 860px)').matches;

export const SYS_ICON: Record<string, string> = { INBOX: 'inbox', STARRED: 'star', SNOOZED: 'clock', IMPORTANT: 'imp', SENT: 'send', DRAFT: 'draft', ALL: 'all', SPAM: 'spam', TRASH: 'trash' };

export const BASE_VIEWS: Array<[string, string]> = [['', 'Inbox'], ['needs', 'Needs you'], ['cat:partners', 'Partners'], ['cat:staff', 'Staff'], ['cat:people', 'People'], ['cat:receipts', 'Receipts and gifts'], ['cat:newsletters', 'Newsletters'], ['cat:notifications', 'Notifications'], ['cat:calendar', 'Calendar']];
export const CAT_NAMES: Record<string, string> = { partners: 'Partners', staff: 'Staff', people: 'People', receipts: 'Receipts and gifts', newsletters: 'Newsletters', notifications: 'Notifications', calendar: 'Calendar' };
export const FLAG_NAMES: Record<string, string> = { unread: 'Unread', starred: 'Starred', files: 'Has files', partner: 'Partners' };

export const isPrimary = (labelIds?: string[]) => {
  const l = labelIds || [];
  if (l.indexOf('INBOX') < 0) return false;
  return !l.some((x) => /^CATEGORY_(PROMOTIONS|SOCIAL|FORUMS|UPDATES)$/.test(x));
};
