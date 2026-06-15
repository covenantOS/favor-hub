/**
 * Newsletter Analytics — data shape.
 *
 * Source: GoHighLevel campaign stats for the Church Newsletter sends.
 *
 * Counting note (carried from the build sheet, important for anyone editing):
 * GoHighLevel reports clicks two different ways.
 *   - `engagement.clicked` is the Engagement Summary headline number. Use it for
 *     KPIs and quarter-over-quarter comparison.
 *   - `click_performance.total_clicks` / `unique_clicks` are link-interaction
 *     counts. They will NOT equal `engagement.clicked`. Use them only for the
 *     link-level section. Do not reconcile the two into one number.
 */

export interface Engagement {
  sent_attempted: number;
  delivered: number;
  delivered_pct: number;
  opened: number;
  opened_pct: number;
  /** Engagement Summary headline click count. Use for KPI + QoQ. */
  clicked: number;
  clicked_pct: number;
  conversion: number;
  conversion_pct: number;
  /** Present when conversion tracking was not configured. Render as "Not tracked". */
  conversion_note?: string;
  soft_bounced: number;
  soft_bounced_pct: number;
  hard_bounced: number;
  hard_bounced_pct: number;
  unsubscribed: number;
  unsubscribed_pct: number;
  /** Raw skipped count. Not always present in the source export. */
  skipped?: number;
  skipped_pct: number;
  spam: number;
  spam_pct: number;
}

export interface StatusRow {
  status: string;
  count: number;
  pct: number;
}

export interface LinkRow {
  label: string;
  /** "Text" or "Image" — the placement of the link in the email. */
  source: string;
  total_clicks: number;
  unique_clicks: number;
  /** Destination URL, when known. */
  url?: string;
}

export interface ClickPerformance {
  links_in_email: number;
  total_clicks: number;
  unique_clicks: number;
  unique_engagements: number;
  /** Clicks per unique open, as a percentage. Depth-of-engagement signal. */
  clicks_per_unique_open_pct: number;
  links: LinkRow[];
  /** Caveat about partial / source-report data. */
  note?: string;
}

export interface Resend {
  target: string;
  sent: number;
  delivered: number;
  delivered_pct: number;
  opened: number;
  opened_pct: number;
  clicked: number;
  clicked_pct: number;
  unsubscribed_from_resend: number;
  takeaway: string;
}

export interface Quarter {
  /** Stable key, e.g. "Q1". Drives the switcher and compare logic. */
  id: string;
  /** Human label, e.g. "Q1 2026". */
  label: string;
  sent_date: string;
  audience_total: number;
  engagement: Engagement;
  status_breakdown: StatusRow[];
  /** Present when status rows are derived rather than from a raw CSV. */
  status_breakdown_note?: string;
  click_performance: ClickPerformance;
  /** A follow-up resend to non-openers, or null when there was none. */
  resend: Resend | null;
  notes: string[];
}

export interface Campaign {
  campaign: string;
  brand: string;
  /** Append future quarters here. Everything downstream is data-driven. */
  quarters: Quarter[];
}
