// Figures from running the saved Blackbaud queries a list replaces, through the Query API, for the same inputs as the hub list.
// Only counts and dollars are kept here (the repository is public). A run is repeated whenever a list's rule changes and
// whenever staff want a fresh comparison: Q:\Temp\Will\hub-agents-2026-10-11\bb-held\refruns.py.
export interface SavedRun {
  report: string;
  query: number;
  name: string;
  /** Date the saved query was run, YYYY-MM-DD. */
  ran: string;
  /** The hub filter values the run matches. A filter not named here must be at its default. */
  inputs: Record<string, string>;
  /** The tax list this run belongs to (mail, email or other). */
  list?: string;
  /** A difference found in the records, named, shown when the counts differ. */
  named?: string;
  rows: number;
  partners: number;
  total: number | null;
  totalLabel: string;
}

export const SAVED_RUNS: SavedRun[] = [
  // Annual Tax Receipts - MAIL, gifts of last year (2025) summed per partner, total of the distinct partners' giving.
  { report: 'tax', list: 'mail', query: 1066, name: 'Annual Tax Receipts - MAIL', ran: '2026-10-11', inputs: { year: '2025', through: '' }, rows: 650, partners: 649, total: 2135763.12, totalLabel: "Last Year's Giving" },
  // The EMAIL and OTHERS queries turn the no valid addresses box on and need the preferred country to be United States.
  { report: 'tax', list: 'email', query: 1069, name: 'Annual Tax Receipts - EMAIL', ran: '2026-10-11', inputs: { year: '2025', through: '' }, rows: 32, partners: 15, total: 36624, totalLabel: 'Total gifts', named: 'The saved MAIL and EMAIL lists both carry one partner whose record has two preferred addresses, one of them blank. The hub puts that partner on Mail only.' },
  { report: 'tax', list: 'other', query: 1070, name: 'Annual Tax Receipts - OTHERS', ran: '2026-10-11', inputs: { year: '2025', through: '' }, rows: 5, partners: 5, total: 26628.14, totalLabel: 'Total gifts' },
  // Appeal List Format asked for last gift on or after 2025-01-01 of at least $0.01.
  { report: 'mailing', query: 795, name: 'Appeal List Format', ran: '2026-10-11', inputs: { from: '2025-01-01', to: '', min: '0.01', state: '', held: '', appeal: '', kind: 'partners' }, rows: 2364, partners: 2352, total: 814260.27, totalLabel: 'Last gift amount' },
];
