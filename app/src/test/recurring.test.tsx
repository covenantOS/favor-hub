import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { recurringResponse, type RecurringResponse, type RecurringRow } from '@shared/schemas';
vi.mock('@/lib/legacy', async (orig) => ({ ...(await orig<object>()), loadScript: async () => undefined }));
import { chipCounts, pageCount, pageList, parseAmount, shortDate, statusWord, visibleRows, monthsTitle } from '@/features/recurring/logic';

const TODAY = '2026-10-14';
const row = (o: Partial<RecurringRow> & { id: string; name: string }): RecurringRow =>
  ({
    cid: '1', place: '', status: 'Active', amount: 50, frequency: 'MONTHLY', frequencyLabel: 'monthly', method: 'Card', fund: 'Where Needed Most', start: '2025-01-05', end: '', next: '2026-11-05',
    statusDate: '', annual: 600, months: Array(12).fill(true), paid12: 12, paid: 20, lastPaid: '2026-10-05', holder: 'Pat Care', declinedOn: '', declineReason: '', declineRecovered: false, declines: 0, daysLate: 0,
    flags: { declined: false, pastDue: false, pastEnd: false, stopped90: false, twoYears: false, noPayment: false }, changes: [], ...o,
  }) as RecurringRow;

const rows: RecurringRow[] = [
  row({ id: '1', name: 'Ann Active', amount: 100 }),
  row({ id: '2', name: 'Dee Declined', amount: 40, flags: { declined: true, pastDue: false, pastEnd: false, stopped90: false, twoYears: false, noPayment: false }, declinedOn: '2026-10-04', declines: 1 }),
  row({ id: '3', name: 'Pete PastDue', method: 'Bank', daysLate: 12, flags: { declined: false, pastDue: true, pastEnd: false, stopped90: false, twoYears: false, noPayment: false } }),
  row({ id: '4', name: 'Ed Ended', status: 'Terminated', statusDate: '2026-09-24', flags: { declined: false, pastDue: false, pastEnd: false, stopped90: true, twoYears: false, noPayment: false } }),
  row({ id: '5', name: 'Hal Held', status: 'Held' }),
  row({ id: '6', name: 'Olly Old', flags: { declined: false, pastDue: false, pastEnd: false, stopped90: false, twoYears: true, noPayment: false } }),
  row({ id: '7', name: 'Pam PastEnd', end: '2026-09-14', flags: { declined: false, pastDue: false, pastEnd: true, stopped90: false, twoYears: false, noPayment: false } }),
  row({ id: '8', name: 'Zoe Later Stop', status: 'Terminated', statusDate: '2026-10-10', flags: { declined: false, pastDue: false, pastEnd: false, stopped90: true, twoYears: false, noPayment: false } }),
];

describe('recurring gifts: filters and counts', () => {
  it('counts each chip over every row', () => {
    const c = chipCounts(rows).counts;
    expect(c.active).toBe(5);
    expect(c.declined).toBe(1);
    expect(c.stopped).toBe(2);
    expect(c.held).toBe(1);
    expect(c.twoyears).toBe(1);
    expect(c.bank).toBe(1);
    expect(c.pastdue).toBe(1);
    expect(c.pastend).toBe(1);
  });
  it('past due, past end and stopped in 90 days draw only while something is in them', () => {
    expect(chipCounts(rows).map((c) => c.id)).toContain('pastdue');
    const calm = chipCounts([rows[0], rows[4]]);
    expect(calm.map((c) => c.id)).not.toContain('pastdue');
    expect(calm.map((c) => c.id)).not.toContain('pastend');
  });
  it('searches by name, schedule id and partner id; stopped rows read newest stop first', () => {
    expect(visibleRows(rows, 'active', 'dee').map((r) => r.id)).toEqual(['2']);
    expect(visibleRows(rows, 'active', '  PETE  ').map((r) => r.id)).toEqual(['3']);
    expect(visibleRows(rows, 'stopped', '').map((r) => r.id)).toEqual(['8', '4']);
    expect(visibleRows(rows, 'active', 'zzz')).toEqual([]);
  });
});

describe('recurring gifts: paging, dates and words', () => {
  it('pages', () => {
    expect(pageCount(391, 15)).toBe(27);
    expect(pageCount(0, 15)).toBe(1);
    expect(pageList(1, 27)).toEqual([1, 2, 0, 27]);
    expect(pageList(14, 27)).toEqual([1, 0, 13, 14, 15, 0, 27]);
    expect(pageList(2, 3)).toEqual([1, 2, 3]);
  });
  it('dates leave the year off this year', () => {
    expect(shortDate('2026-08-27', TODAY)).toBe('Aug 27');
    expect(shortDate('2025-01-05T00:00:00', TODAY)).toBe('Jan 5, 2025');
    expect(shortDate('1900-01-01', TODAY)).toBe('');
    expect(shortDate('', TODAY)).toBe('');
  });
  it('status words', () => {
    expect(statusWord(rows[0], TODAY)).toEqual({ text: 'Active', tone: 'ok' });
    expect(statusWord(rows[1], TODAY)).toEqual({ text: 'Declined Oct 4', tone: 'bad' });
    expect(statusWord(rows[2], TODAY)).toEqual({ text: 'Past due 12 days', tone: 'bad' });
    expect(statusWord(rows[3], TODAY)).toEqual({ text: 'Stopped Sep 24', tone: 'quiet' });
    expect(statusWord(rows[4], TODAY)).toEqual({ text: 'Held', tone: 'warn' });
    expect(statusWord(rows[6], TODAY)).toEqual({ text: 'Past end date', tone: 'warn' });
    expect(statusWord({ ...rows[1], declineRecovered: true }, TODAY).text).toBe('Active');
  });
  it('the dots name the months paid', () => {
    expect(monthsTitle([false, false, false, false, false, false, false, false, false, false, true, true], TODAY)).toBe('Paid in Sep 2026, Oct 2026');
    expect(monthsTitle(Array(12).fill(false), TODAY)).toBe('No payment in the last 12 months');
  });
  it('an amount field takes dollars and commas and refuses the rest', () => {
    expect(parseAmount('$1,500')).toBe(1500);
    expect(parseAmount('1500.505')).toBe(1500.51);
    expect(parseAmount('0.99')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('250001')).toBeNull();
  });
});

const data: RecurringResponse = recurringResponse.parse({
  ok: true, today: TODAY, synced: '2026-10-14T20:00:00Z',
  stats: { active: 5, card: 4, bank: 1, scheduledEach: 340, payments12: 60, paid30Schedules: 4, paid30Amount: 280, declined: 1, stopped90: 2, pastDue: 1, pastEnd: 1, held: 1, stopped: 2, twoYears: 1 },
  rows, frequencies: [{ value: 'MONTHLY', label: 'monthly' }, { value: 'QUARTERLY', label: 'quarterly' }], askedBy: ['Phone call', 'Email'], canEdit: true,
});

async function mount(canEdit: boolean) {
  const { RecurringPage } = await import('@/features/recurring/RecurringPage');
  const calls: { url: string; body: any }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init && init.method === 'POST') {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ ok: true, id: 'c1', state: 'done', summary: 'Amount $40 to $75', batch: null }), { status: 200 });
    }
    return new Response(JSON.stringify({ ...data, canEdit }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute({ component: () => <RecurringPage /> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/'] }) });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return { calls };
}

describe('the Recurring gifts page', () => {
  it('draws the five numbers and the rows, then opens a schedule and saves a new amount', async () => {
    const { calls } = await mount(true);
    expect(await screen.findByText('Active schedules')).toBeTruthy();
    expect(screen.getByText('4 by card, 1 by bank draft')).toBeTruthy();
    expect(screen.getByText('Declined since July')).toBeTruthy();
    expect(screen.getByText(/1 active schedule has a next charge date in the past/)).toBeTruthy();
    const table = screen.getByRole('table');
    fireEvent.click(within(table).getByText('Dee Declined').closest('[role="row"]') as HTMLElement);
    const field = (await screen.findByLabelText('Change the amount', { selector: 'input' })) as HTMLInputElement;
    const save = screen.getByRole('button', { name: 'Save the new amount' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(field, { target: { value: '$75' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(await screen.findByText(/Amount \$40 to \$75. Blackbaud read it back./)).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/work/recurring/edit');
    expect(calls[0].body).toMatchObject({ giftId: '2', op: 'amount', amount: 75, askedBy: 'Phone call' });
    expect(typeof calls[0].body.req).toBe('string');
  });

  it('stopping asks first and says it is final', async () => {
    const { calls } = await mount(true);
    await screen.findByText('Active schedules');
    fireEvent.click(within(screen.getByRole('table')).getByText('Ann Active').closest('[role="row"]') as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop the schedule' }));
    expect(screen.getByText(/Stopping is final/)).toBeTruthy();
    expect(calls).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByText(/Stopping is final/)).toBeNull();
  });

  it('a test account sees the schedule and no way to change it', async () => {
    await mount(false);
    await screen.findByText('Active schedules');
    fireEvent.click(within(screen.getByRole('table')).getByText('Ann Active').closest('[role="row"]') as HTMLElement);
    expect(await screen.findByText(/cannot change them/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save the new amount' })).toBeNull();
  });

  it('a chip changes the rows and the search narrows them', async () => {
    await mount(true);
    await screen.findByText('Active schedules');
    fireEvent.click(screen.getByRole('button', { name: /^Stopped [0-9]/ }));
    const table = screen.getByRole('table');
    expect(within(table).getByText('Ed Ended')).toBeTruthy();
    expect(within(table).queryByText('Ann Active')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Active [0-9]/ }));
    fireEvent.change(screen.getByLabelText('Find a partner'), { target: { value: 'hal' } });
    expect(within(screen.getByRole('table')).queryByText('Ann Active')).toBeNull();
  });
});

describe('skip one charge, hovers and Google Sheets', () => {
  it('Skip one charge asks first, names the new date, then sends the skip', async () => {
    const { calls } = await mount(true);
    await screen.findByText('Active schedules');
    fireEvent.click(within(screen.getByRole('table')).getByText('Ann Active').closest('[role="row"]') as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: 'Skip one charge' }));
    expect(screen.getByText(/Skip the Nov 5 charge. The next charge becomes Dec 5./)).toBeTruthy();
    expect(calls).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Skip it' }));
    await screen.findByText(/Blackbaud read it back/);
    expect(calls[0].body).toMatchObject({ giftId: '1', op: 'skip' });
  });
  it('the chip and the number say what they count on hover', async () => {
    await mount(true);
    const chip = (await screen.findByRole('button', { name: /^Giving 2\+ years/ })) as HTMLButtonElement;
    expect(chip.title).toMatch(/first paid installment/);
    expect((screen.getByText('Paid in the last 30 days').closest('.rg-stat') as HTMLElement).title).toMatch(/Eastern dates/);
  });
  it('Open in Google Sheets sends the rows on screen to the sheet builder', async () => {
    const run = vi.fn(async () => ({ ok: true, url: 'https://docs.google.com/spreadsheets/d/x' }));
    (window as unknown as { FavorSheets: unknown }).FavorSheets = { run, consent: vi.fn() };
    await mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Open in Google Sheets' }));
    expect(await screen.findByText('Your sheet is ready. Open it')).toBeTruthy();
    const spec = (run.mock.calls[0] as unknown[])[0] as { tabs: { rows: unknown[] }[]; provenance: { filters: string } };
    expect(spec.tabs[0].rows).toHaveLength(5);
    expect(spec.provenance.filters).toBe('Active');
  });
});
