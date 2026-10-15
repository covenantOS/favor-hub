// Admin > Gifts: the one conversion the page does before it sends, kept here so a test can run it.

/** What staff type in "Second approval from" (dollars, with or without $ and commas) as the number the route takes; 0 turns it off. */
export function secondDollars(typed: string): number {
  return Number(String(typed || '0').replace(/[$,\s]/g, ''));
}
