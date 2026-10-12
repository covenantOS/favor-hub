// Trip planner: "I'm in Dallas Thursday" lists the partners near that city, a route through the ones worth a visit and meeting slots.
// Partner locations come from the ZIP on their address (zippopotam.us) or their city (Open-Meteo geocoding); both are free and need no key,
// and every answer is kept in act_cache so each ZIP is looked up once.
import { mirror } from '../foundations/blackbaud';
import type { Env } from '../http';
import type { PortfolioRow } from '../work/portfolio';
import { readOnly } from '../work/repo';
import { cacheGet, cachePut, addDays, plural, writeText } from './text';

export const STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

const NEIGHBORS: Record<string, string[]> = {
  AL: ['FL', 'GA', 'MS', 'TN'], AK: [], AZ: ['CA', 'NV', 'UT', 'NM', 'CO'], AR: ['LA', 'MO', 'MS', 'OK', 'TN', 'TX'], CA: ['AZ', 'NV', 'OR'], CO: ['AZ', 'KS', 'NE', 'NM', 'OK', 'UT', 'WY'],
  CT: ['MA', 'NY', 'RI'], DE: ['MD', 'NJ', 'PA'], DC: ['MD', 'VA'], FL: ['AL', 'GA'], GA: ['AL', 'FL', 'NC', 'SC', 'TN'], HI: [], ID: ['MT', 'NV', 'OR', 'UT', 'WA', 'WY'], IL: ['IN', 'IA', 'KY', 'MO', 'WI'],
  IN: ['IL', 'KY', 'MI', 'OH'], IA: ['IL', 'MN', 'MO', 'NE', 'SD', 'WI'], KS: ['CO', 'MO', 'NE', 'OK'], KY: ['IL', 'IN', 'MO', 'OH', 'TN', 'VA', 'WV'], LA: ['AR', 'MS', 'TX'], ME: ['NH'],
  MD: ['DE', 'DC', 'PA', 'VA', 'WV'], MA: ['CT', 'NH', 'NY', 'RI', 'VT'], MI: ['IN', 'OH', 'WI'], MN: ['IA', 'ND', 'SD', 'WI'], MS: ['AL', 'AR', 'LA', 'TN'], MO: ['AR', 'IL', 'IA', 'KS', 'KY', 'NE', 'OK', 'TN'],
  MT: ['ID', 'ND', 'SD', 'WY'], NE: ['CO', 'IA', 'KS', 'MO', 'SD', 'WY'], NV: ['AZ', 'CA', 'ID', 'OR', 'UT'], NH: ['ME', 'MA', 'VT'], NJ: ['DE', 'NY', 'PA'], NM: ['AZ', 'CO', 'OK', 'TX', 'UT'],
  NY: ['CT', 'MA', 'NJ', 'PA', 'VT'], NC: ['GA', 'SC', 'TN', 'VA'], ND: ['MN', 'MT', 'SD'], OH: ['IN', 'KY', 'MI', 'PA', 'WV'], OK: ['AR', 'CO', 'KS', 'MO', 'NM', 'TX'], OR: ['CA', 'ID', 'NV', 'WA'],
  PA: ['DE', 'MD', 'NJ', 'NY', 'OH', 'WV'], RI: ['CT', 'MA'], SC: ['GA', 'NC'], SD: ['IA', 'MN', 'MT', 'NE', 'ND', 'WY'], TN: ['AL', 'AR', 'GA', 'KY', 'MS', 'MO', 'NC', 'VA'], TX: ['AR', 'LA', 'NM', 'OK'],
  UT: ['AZ', 'CO', 'ID', 'NV', 'NM', 'WY'], VT: ['MA', 'NH', 'NY'], VA: ['DC', 'KY', 'MD', 'NC', 'TN', 'WV'], WA: ['ID', 'OR'], WV: ['KY', 'MD', 'OH', 'PA', 'VA'], WI: ['IL', 'IA', 'MI', 'MN'], WY: ['CO', 'ID', 'MT', 'NE', 'SD', 'UT'],
};

const STATE_BY_NAME = Object.fromEntries(Object.entries(STATES).map(([k, v]) => [v.toLowerCase(), k]));

export function stateCode(s: string): string {
  const t = String(s || '').trim();
  if (/^[A-Za-z]{2}$/.test(t) && STATES[t.toUpperCase()]) return t.toUpperCase();
  return STATE_BY_NAME[t.toLowerCase()] || '';
}

/* ------------------------------------------------------------------ what the person typed */

export interface TripAsk {
  city: string;
  state: string;
  date: string;
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function dateOf(text: string, today: string): string {
  const t = text.toLowerCase();
  const iso = t.match(/\b(20\d\d)-(\d\d)-(\d\d)\b/);
  if (iso) return iso[0];
  const us = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (us) {
    const y = us[3] ? (us[3].length === 2 ? '20' + us[3] : us[3]) : today.slice(0, 4);
    let d = `${y}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
    if (!us[3] && d < today) d = `${Number(y) + 1}${d.slice(4)}`;
    return d;
  }
  const mons = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const md = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (md) {
    let d = `${today.slice(0, 4)}-${String(mons.indexOf(md[1]) + 1).padStart(2, '0')}-${md[2].padStart(2, '0')}`;
    if (d < today) d = `${Number(today.slice(0, 4)) + 1}${d.slice(4)}`;
    return d;
  }
  if (/\btomorrow\b/.test(t)) return addDays(today, 1);
  if (/\btoday\b|\btonight\b/.test(t)) return today;
  const wd = DAYS.findIndex((d) => new RegExp(`\\b${d}\\b|\\b${d.slice(0, 3)}\\b`).test(t));
  if (wd >= 0) {
    const now = new Date(today + 'T12:00:00Z').getUTCDay();
    let add = (wd - now + 7) % 7;
    if (/\bnext\b/.test(t) && add < 7) add += add === 0 ? 7 : 0;
    return addDays(today, add);
  }
  return addDays(today, 1);
}

/** Pulls the city, state and day out of a sentence. The model reads it first; the word rules catch what it misses. */
export async function parseTrip(env: Pick<Env, 'AI'>, text: string, today: string): Promise<TripAsk | null> {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!clean) return null;
  let city = '';
  let state = '';
  const ai = await writeText(env, {
    system: 'Read a travel note and answer with one line of JSON only: {"city":"","state":""}. city is the US city the person will be in. state is its two letter code, or empty when the note does not say and you are not sure. No other text.',
    raw: true,
    user: clean,
    max: 40,
    temperature: 0,
    timeoutMs: 6000,
  });
  const m = ai && ai.match(/\{[^}]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      city = String(j.city || '').trim();
      state = stateCode(String(j.state || ''));
    } catch {
      // the word rules below take over
    }
  }
  if (!city) {
    const stripped = clean.replace(/\b(next|this)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday|tomorrow|today|tonight)\b/gi, ' ').replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ');
    const w = stripped.match(/\b(?:in|to|near|around|visiting|at)\s+([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3})(?:,\s*([A-Za-z]{2}|[A-Za-z ]{4,}))?/);
    if (w) {
      city = w[1].trim();
      if (w[2]) state = stateCode(w[2]) || state;
    }
  }
  if (!city) return null;
  return { city, state, date: dateOf(clean, today) };
}

/* ------------------------------------------------------------------ places */

export interface Pt {
  lat: number;
  lon: number;
}

export function miles(a: Pt, b: Pt): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function fetchJson(url: string, ms = 5000): Promise<any | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const FOREVER = 400 * 86400000;

export async function geocodeCity(env: Pick<Env, 'DB'>, city: string, state: string): Promise<(Pt & { name: string; state: string }) | null> {
  const key = `geo:city:${city.toLowerCase()},${state}`;
  const hit = await cacheGet<(Pt & { name: string; state: string }) | { none: true }>(env, key, FOREVER);
  if (hit) return 'none' in hit ? null : hit;
  const data = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=10&language=en&countryCode=US`);
  const list: any[] = (data && data.results) || [];
  const pick = (state ? list.find((r) => stateCode(r.admin1) === state) : null) || (state ? null : list[0]);
  if (!pick) {
    if (data) await cachePut(env, key, { none: true });
    return null;
  }
  const out = { lat: Number(pick.latitude), lon: Number(pick.longitude), name: String(pick.name), state: stateCode(pick.admin1) };
  await cachePut(env, key, out);
  return out;
}

export async function geocodeZip(env: Pick<Env, 'DB'>, zip: string): Promise<Pt | null> {
  const key = `geo:zip:${zip}`;
  const hit = await cacheGet<Pt | { none: true }>(env, key, FOREVER);
  if (hit) return 'none' in hit ? null : hit;
  const data = await fetchJson(`https://api.zippopotam.us/us/${zip}`);
  const p = data && data.places && data.places[0];
  if (!p) {
    if (data !== null) await cachePut(env, key, { none: true });
    else return null;
    return null;
  }
  const out = { lat: Number(p.latitude), lon: Number(p.longitude) };
  await cachePut(env, key, out);
  return out;
}

/* ------------------------------------------------------------------ partners near a place */

const ADDR_SQL = readOnly(`SELECT constituent_record_id AS cid, address_lines AS lines, address_city AS city, address_state AS st, address_postal_code AS zip, COALESCE(is_primary, 0) AS prim
  FROM addresses WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND COALESCE(is_inactive, 0) = 0 ORDER BY prim DESC`);

export interface Stop {
  cid: string;
  name: string;
  place: string;
  address: string;
  miles: number;
  lat: number;
  lon: number;
  phone: string | null;
  l12: number;
  life: number;
  quiet: number | null;
  score: number;
  /** In the suggested route. */
  pick: boolean;
  slot?: { start: string; end: string; driveMin: number };
}

export interface TripPlan {
  ok: true;
  ask: TripAsk;
  dest: { name: string; state: string; lat: number; lon: number };
  radius: number;
  scanned: number;
  located: number;
  /** Partners whose ZIP could not be placed on this pass; asking again places more. */
  pending: number;
  stops: Stop[];
  route: { order: string[]; miles: number; driveMin: number; mapsUrl: string } | null;
  note: string;
}

const chunks = <T,>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

function priority(r: PortfolioRow): number {
  const q = r.quiet === null ? 240 : r.quiet;
  return Math.log10(1 + r.l12 + r.life / 10) * 2 + Math.min(q, 365) / 60 + (r.ytd > 0 && q >= 30 ? 1.5 : 0) + (r.lastYear > 0 && r.ytd <= 0 ? 1.5 : 0);
}

const clock = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export interface PlanOpts {
  radius: number;
  /** How many visits the day holds. */
  max: number;
  /** Meeting length in minutes. */
  meet: number;
  /** Minutes after midnight the day starts and ends. */
  from: number;
  to: number;
}

export const DEFAULT_OPTS: PlanOpts = { radius: 40, max: 5, meet: 60, from: 9 * 60, to: 17 * 60 };

export async function planTrip(env: Env, ask: TripAsk, rows: PortfolioRow[], opts: Partial<PlanOpts> = {}): Promise<TripPlan | { ok: false; message: string }> {
  const o = { ...DEFAULT_OPTS, ...opts };
  const dest = await geocodeCity(env, ask.city, ask.state);
  if (!dest) return { ok: false, message: `FavorOS could not place ${ask.city}${ask.state ? ', ' + ask.state : ''}. Check the spelling or add the state.` };
  const home = dest.state || ask.state;
  const states = new Set([home, ...(NEIGHBORS[home] || [])].filter(Boolean));
  const ids = rows.map((r) => r.cid);
  const addr = new Map<string, { lines: string; city: string; st: string; zip: string }>();
  for (const part of chunks(ids, 400)) {
    for (const a of await mirror<any>(env, ADDR_SQL, [JSON.stringify(part)]).catch(() => [] as any[])) {
      const k = String(a.cid);
      if (!addr.has(k)) addr.set(k, { lines: String(a.lines || '').replace(/\r?\n/g, ', '), city: String(a.city || ''), st: stateCode(String(a.st || '')), zip: String(a.zip || '').slice(0, 5) });
    }
  }
  const cand = rows.filter((r) => {
    const a = addr.get(r.cid);
    return a && a.st && states.has(a.st);
  });
  const zips = [...new Set(cand.map((r) => addr.get(r.cid)!.zip).filter((z) => /^\d{5}$/.test(z)))];
  const at = new Map<string, Pt>();
  let looked = 0;
  const todo: string[] = [];
  for (const z of zips) {
    const hit = await cacheGet<Pt | { none: true }>(env, `geo:zip:${z}`, FOREVER);
    if (hit) {
      if (!('none' in hit)) at.set(z, hit);
    } else todo.push(z);
  }
  for (const part of chunks(todo.slice(0, 36), 6)) {
    const got = await Promise.all(part.map((z) => geocodeZip(env, z)));
    part.forEach((z, i) => {
      looked++;
      const p = got[i];
      if (p) at.set(z, p);
    });
  }
  const pending = Math.max(0, todo.length - looked);
  const stops: Stop[] = [];
  for (const r of cand) {
    const a = addr.get(r.cid)!;
    const p = at.get(a.zip);
    if (!p) continue;
    const d = miles(dest, p);
    if (d > o.radius) continue;
    stops.push({
      cid: r.cid,
      name: r.name,
      place: [a.city, a.st].filter(Boolean).join(', '),
      address: [a.lines, a.city, a.st, a.zip].filter(Boolean).join(', '),
      miles: Math.round(d * 10) / 10,
      lat: p.lat,
      lon: p.lon,
      phone: r.phone,
      l12: r.l12,
      life: r.life,
      quiet: r.quiet,
      score: Math.round(priority(r) * 10) / 10,
      pick: false,
    });
  }
  stops.sort((a, b) => b.score - a.score || a.miles - b.miles);
  const picks = stops.slice(0, o.max);
  // Nearest neighbor from the middle of town, then meeting slots with the drive between stops.
  const order: Stop[] = [];
  let cur: Pt = dest;
  const left = [...picks];
  while (left.length) {
    left.sort((a, b) => miles(cur, a) - miles(cur, b));
    const n = left.shift()!;
    order.push(n);
    cur = n;
  }
  let t = o.from;
  let prev: Pt = dest;
  let total = 0;
  let drive = 0;
  const kept: Stop[] = [];
  for (const s of order) {
    const leg = miles(prev, s) * 1.3;
    const mins = Math.round((leg / 35) * 60) + 8;
    const start = Math.round((t + mins) / 15) * 15;
    const lunch = start >= 12 * 60 && start < 13 * 60 ? 13 * 60 : start;
    if (lunch + o.meet > o.to) break;
    s.pick = true;
    s.slot = { start: clock(lunch), end: clock(lunch + o.meet), driveMin: mins };
    t = lunch + o.meet;
    total += leg;
    drive += mins;
    prev = s;
    kept.push(s);
  }
  const way = kept.slice(0, -1).map((s) => s.address);
  const last = kept[kept.length - 1];
  const mapsUrl = kept.length
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(dest.name + ', ' + dest.state)}&destination=${encodeURIComponent(last.address)}${way.length ? '&waypoints=' + encodeURIComponent(way.join('|')) : ''}&travelmode=driving`
    : '';
  const note = stops.length
    ? `${plural(stops.length, 'partner')} within ${o.radius} miles of ${dest.name}. ${plural(kept.length, 'visit')} fit the day.`
    : `No partner on this list is within ${o.radius} miles of ${dest.name}.`;
  return {
    ok: true,
    ask,
    dest: { name: dest.name, state: dest.state, lat: dest.lat, lon: dest.lon },
    radius: o.radius,
    scanned: cand.length,
    located: stops.length,
    pending,
    stops: stops.slice(0, 40),
    route: kept.length ? { order: kept.map((s) => s.cid), miles: Math.round(total), driveMin: drive, mapsUrl } : null,
    note: pending ? note + ` ${plural(pending, 'ZIP code')} not placed yet. Ask again to place more.` : note,
  };
}
