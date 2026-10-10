// Meetings: which video provider a Google Calendar event uses, and the short form the Meetings pages show.
// Pure functions, no network, so the unit tests can run them on made-up events.

export type Provider = 'favor' | 'meet' | 'zoom' | 'teams' | 'webex';

export interface CalEvent {
  id: string;
  recurringEventId?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  organizer?: { email?: string; self?: boolean };
  attendees?: Array<{ email?: string; displayName?: string; self?: boolean; resource?: boolean; responseStatus?: string }>;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }>; conferenceSolution?: { name?: string } };
}

export interface CalMeeting {
  eventId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  provider: Provider;
  joinUrl: string;
  people: Array<{ email: string; name: string }>;
  organizer: boolean;
  internal: boolean;
  canSwitch: boolean;
  needsConsent: boolean;
}

export const PROVIDER_LABEL: Record<Provider, string> = { favor: 'Favor Meetings', meet: 'Google Meet', zoom: 'Zoom', teams: 'Microsoft Teams', webex: 'Webex' };

const PATTERNS: Array<[Provider, RegExp]> = [
  ['favor', /https?:\/\/dash\.favorintl\.org\/meet\/(?:room|g)\/\?[^\s"'<>)]*/i],
  ['zoom', /https?:\/\/[\w.-]*\.?zoom\.(?:us|com)\/(?:j|my|wc|s)\/[^\s"'<>)]*/i],
  ['teams', /https:\/\/teams\.(?:microsoft|live)\.com\/[^\s"'<>)]*/i],
  ['meet', /https:\/\/meet\.google\.com\/[a-z0-9-]+(?:\?[^\s"'<>)]*)?/i],
  ['webex', /https:\/\/[\w.-]*\.webex\.com\/[^\s"'<>)]*/i],
];

const unescapeUrl = (u: string) => u.replace(/&amp;/g, '&');

/** The provider and every link of that provider found in an event's conference data, location and notes. */
export function providerOf(ev: Pick<CalEvent, 'hangoutLink' | 'location' | 'description' | 'conferenceData'>): { provider: Provider | null; url: string; urls: string[] } {
  const places = [
    ...(ev.conferenceData?.entryPoints || []).filter((e) => e.entryPointType === 'video').map((e) => e.uri || ''),
    ev.hangoutLink || '',
    ev.location || '',
    ev.description || '',
  ].filter(Boolean);
  for (const [name, re] of PATTERNS) {
    const urls: string[] = [];
    for (const p of places) {
      const g = new RegExp(re.source, 'gi');
      for (const m of p.matchAll(g)) urls.push(m[0]);
    }
    if (urls.length) return { provider: name, url: unescapeUrl(urls[0]), urls: [...new Set(urls)] };
  }
  return { provider: null, url: '', urls: [] };
}

const nameOf = (a: { email?: string; displayName?: string }) => (a.displayName || String(a.email || '').split('@')[0].replace(/[._]+/g, ' ')).trim();

/** The event as the pages show it, or null when it is not a timed meeting with a video link. */
export function summarize(ev: CalEvent, self: string, canWrite: boolean): CalMeeting | null {
  if (!ev.start?.dateTime || !ev.end?.dateTime) return null;
  const me = self.toLowerCase();
  const mine = (ev.attendees || []).find((a) => a.self || String(a.email || '').toLowerCase() === me);
  if (mine?.responseStatus === 'declined') return null;
  const p = providerOf(ev);
  if (!p.provider) return null;
  const others = (ev.attendees || []).filter((a) => !a.self && !a.resource && a.email && String(a.email).toLowerCase() !== me);
  const organizer = !!ev.organizer?.self || String(ev.organizer?.email || '').toLowerCase() === me;
  const internal = others.length > 0 && others.every((a) => String(a.email).toLowerCase().endsWith('@favorintl.org'));
  const switchable = organizer && internal && (p.provider === 'zoom' || p.provider === 'meet');
  return {
    eventId: ev.id,
    title: ev.summary || '(No title)',
    startsAt: ev.start.dateTime,
    endsAt: ev.end.dateTime,
    provider: p.provider,
    joinUrl: p.url,
    people: others.slice(0, 30).map((a) => ({ email: String(a.email).toLowerCase(), name: nameOf(a) })),
    organizer,
    internal,
    canSwitch: switchable && canWrite,
    needsConsent: switchable && !canWrite,
  };
}

/** True when the event is one the organizer may move: same test the page uses, checked again on the server. */
export function mayMove(ev: CalEvent, self: string): boolean {
  const m = summarize(ev, self, true);
  return !!m && m.canSwitch && Date.parse(ev.end?.dateTime || '') > Date.now();
}
