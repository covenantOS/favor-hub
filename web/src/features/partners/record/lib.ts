// Helpers for the partner page, drawer and tools: dates, money, names, the read and write calls, and the shapes of the partner answer.
// The words and the numbers match public/js/partner.js, so the React page reads the same as the classic one.
import { useEffect, useState } from 'react';
import { hubGet } from '../../../lib/hub';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const todayEt = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
export const plusDays = (n: number) => new Date(Date.parse(todayEt() + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/** "Sep 5", with the year when it is not this year or when yr is set. 1900 dates are blank. */
export const fd = (iso: string | null | undefined, yr?: boolean): string => {
  if (!iso || String(iso).startsWith('1900')) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return MON[m - 1] + ' ' + d + (yr || y !== Number(todayEt().slice(0, 4)) ? ', ' + y : '');
};
/** Always with the year (the Gifts and Actions tabs, the Contact tab). */
export const fdY = (iso: string | null | undefined): string => {
  if (!iso || String(iso).startsWith('1900')) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return MON[m - 1] + ' ' + d + ', ' + y;
};
export const money = (a: number | null | undefined): string =>
  a == null ? '' : (Number(a) < 0 ? '-' : '') + '$' + Math.abs(Number(a)).toLocaleString('en-US', { minimumFractionDigits: Math.round(Number(a)) === Number(a) ? 0 : 2, maximumFractionDigits: 2 });
export const money0 = (v: number | null | undefined): string => {
  const n = Number(v) || 0;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: Math.round(n) === n ? 0 : 2, maximumFractionDigits: 2 });
};
export const whole = (n: number | null | undefined): string => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
export const short = (v: number | null | undefined): string => {
  const n = Number(v) || 0;
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  const f = (x: number) => String(+x.toFixed(1));
  return a >= 999950000 ? s + '$' + f(a / 1e9) + 'B' : a >= 999500 ? s + '$' + f(a / 1e6) + 'M' : a >= 1000 ? s + '$' + (a < 1e5 ? f(a / 1000) : Math.round(a / 1000)) + 'K' : money(Math.round(n));
};
export const N = (n: number | null | undefined): string => (Number(n) || 0).toLocaleString('en-US');
export const dayn = (iso: string): number => Math.round((Date.parse(String(iso).slice(0, 10) + 'T12:00:00Z') - Date.parse(todayEt() + 'T12:00:00Z')) / 86400000);
export const plain = (t: string | null | undefined): string => String(t || '').replace(/^RESERVED \((.*)\)$/, '$1');
export const ini = (n: string | null | undefined): string => {
  const w = String(n || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((x) => x && !/^(mr|mrs|ms|dr|rev|and)$/i.test(x));
  const p = w.length > 1 ? [w[0], w[w.length - 1]] : w;
  return (
    p
      .map((x) => Array.from(x)[0])
      .join('')
      .toUpperCase() || '?'
  );
};
export const lateText = (d: number): string => (d === 1 ? '1 day late' : d <= 60 ? d + ' days late' : Math.round(d / 30.4) + ' mo late');
export const href = (id: string): string => '/work/partner/' + encodeURIComponent(id);
export const digits = (s: string | null | undefined): string => String(s || '').replace(/[^\d+]/g, '');
export const newReq = (): string => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2));
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const CAT_IC: Record<string, string> = { 'Phone call': 'phone', Email: 'mail', Mailing: 'letter', Meeting: 'meet', 'Task/Other': 'task' };

/* ------------------------------------------------------------------ reads and writes */
/** The person this page is viewed as (?as=, an admin looking at a teammate's view). Browser only. */
export function asParam(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('as') || '';
}
export const withAs = (path: string, as?: string): string => (as ? path + (path.includes('?') ? '&' : '?') + 'as=' + encodeURIComponent(as) : path);
/** A read that works on the server and in the browser; the as part is added when the page has one. */
export const rGet = <T = any>(path: string, as?: string): Promise<T> => hubGet(withAs(path, as)) as Promise<T>;

export class ApiFail extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}
/** A call from the browser with the hub's request header. Throws ApiFail with the server's message. */
export async function rApi<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const url = withAs(path, asParam());
  const headers: Record<string, string> = { 'X-Hub-Request': '1' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), credentials: 'same-origin', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || data.ok === false) throw new ApiFail(data.message || 'Something went wrong. Try again.', res.status, data);
  return data as T;
}
export const rPost = <T = any>(path: string, body: unknown = {}): Promise<T> => rApi<T>(path, { method: 'POST', body });

/* ------------------------------------------------------------------ shapes */
export interface Phone { id?: string; number: string; type?: string; primary?: boolean; doNotCall?: boolean }
export interface Email { id?: string; address: string; primary?: boolean; doNotEmail?: boolean }
export interface Address { id?: string; lines?: string; city?: string; state?: string; zip?: string; country?: string; doNotMail?: boolean }
export interface Assignment { fid: string; name: string; type?: string; from?: string; to?: string; current: boolean }
export interface GiftLine { id: string; amount: number; date: string; type?: string; fund?: string; status?: string; soft?: boolean; comment?: string; credited?: number; through?: string; by?: string; gift?: number }
export interface ActionLine { id: string; due: string; done?: string; type?: string; category?: string; summary?: string; description?: string; outcome?: string; open?: boolean; fundraisers?: { id: string; name: string }[] }
export interface ToThank { key: string; giftId: string; cid: string; amount: number; date: string; fund?: string; soft?: boolean; ageDays?: number; clock?: { state: string; due: string }; left?: any; taskIds?: string[] }
export interface Opp { id: string; name: string; status?: string; ask?: number; expected?: number; funded?: number; purpose?: string; deadline?: string; expectedDate?: string }
export interface Partner {
  id: string;
  lookup: string;
  name: string;
  kind: string;
  place: string;
  deceased: boolean;
  inactive: boolean;
  addedOn?: string;
  contact: { address?: Address | null; otherAddresses?: number; emails: Email[]; phones: Phone[] };
  household: { id: string; name: string; relation?: string }[];
  giving: any;
  recurring: any[];
  actions: { openCount: number; open: ActionLine[]; recent: ActionLine[] };
  assignments: Assignment[];
  iwave: any;
  lastContact?: any;
  opportunities: Opp[];
  codes: string[];
  flags: { doNotCall: boolean; doNotEmail: boolean; doNotMail: boolean };
  canEdit?: boolean;
  /** Whether this person may change solicit codes and record flags. */
  canCodes?: boolean;
  comm?: any;
  /** Admins and the test accounts see the record pieces not yet open to staff. */
  preview?: boolean;
  toThank?: ToThank[];
  dataCare?: any;
}
export interface Note { id: string; type?: string; summary?: string; text?: string; date?: string; author?: string; local?: boolean; undo?: string }

/* ------------------------------------------------------------------ notes */
const NOTE_LEAD = /^(instruction|prayer|giving|family)\s*:\s*/i;
export const TOPICS = ['General', 'Prayer', 'Giving', 'Family'];
/** A note's topic and title. Blackbaud has one note type for these; the topic leads the summary ("Prayer: ..."). */
export function noteParts(n: Note) {
  const sum = String(n.summary || '');
  const m = sum.match(NOTE_LEAD);
  const topic = m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : 'General';
  const title = (m ? sum.slice(m[0].length) : sum).trim() || String(n.text || '').trim().slice(0, 80);
  const type = String(n.type || '');
  const label = topic !== 'General' ? topic : !type || /^note \(general\)$/i.test(type) ? 'General' : type.replace(/^Reserved Note \((.*)\)$/i, '$1');
  const text = String(n.text || '').trim();
  return { topic, title, label, text: text === title ? '' : text, instr: topic === 'Instruction' };
}
/** The newest instruction note, shown in red under the partner's name. */
export function instructionOf(notes: Note[] | null | undefined) {
  const list = (notes || []).filter((n) => /^instruction\s*:/i.test(String(n.summary || '')));
  list.sort((a, b) => (String(a.date) < String(b.date) ? 1 : -1));
  return list[0] ? Object.assign(noteParts(list[0]), { date: list[0].date, author: list[0].author }) : null;
}

/** How a gift reached the partner, in plain words: through a DAF or foundation (soft credit), from the spouse, a monthly payment. */
export function giftHow(g: GiftLine): string {
  const parts: string[] = [];
  if (g.through) parts.push('Through ' + g.through + ' (soft credit)');
  else if (g.soft) parts.push('Soft credit');
  if (g.by) parts.push('Given by ' + g.by);
  parts.push(g.type === 'RecurringGiftPayment' ? 'Monthly gift' : g.type === 'Donation' ? '' : g.type || '');
  if (g.gift != null && Math.abs(g.gift - g.amount) > 0.005) parts.push('Part of a ' + money(g.gift) + ' gift');
  if (g.comment) parts.push(String(g.comment).replace(/\bDonor note\b/gi, 'Partner note'));
  return parts.filter(Boolean).join(' · ');
}
export const holderOf = (p: Partner): Assignment[] => (p.assignments || []).filter((a) => a.current);

/** False on the server and in the first browser frame, true after. Reads that are not prefetched for the server's HTML wait for it, so the
 *  first browser render matches the HTML the server sent. */
export function useMounted(): boolean {
  const [m, set] = useState(false);
  useEffect(() => set(true), []);
  return m;
}
