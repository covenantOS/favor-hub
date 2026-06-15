import type { Campaign } from './types';

/**
 * Church Newsletter — GoHighLevel campaign stats.
 *
 * TO ADD A QUARTER: append one object to `quarters`. The KPI strip, quarter
 * switcher, charts, funnel, link tables, and the compare view all read from
 * this array, so a new quarter appears everywhere with no other code changes.
 *
 * Known data gaps (kept honest, do not invent values):
 *   - Q1 link table is partial: the source report listed 5 links, only 3 are
 *     confirmed by count. Render what exists.
 *   - Q2 `status_breakdown` is derived from totals, not a raw CSV
 *     (see `status_breakdown_note`).
 *   - Conversion is 0 in both quarters because tracking was never configured;
 *     it is surfaced as "Not tracked", not as a real zero.
 */
export const campaign: Campaign = {
  campaign: 'Church Newsletter',
  brand: 'Favor International',
  quarters: [
    {
      id: 'Q1',
      label: 'Q1 2026',
      sent_date: '2026-02-25',
      audience_total: 267,
      engagement: {
        sent_attempted: 267,
        delivered: 266,
        delivered_pct: 99.63,
        opened: 142,
        opened_pct: 53.56,
        clicked: 34,
        clicked_pct: 13.11,
        conversion: 0,
        conversion_pct: 0,
        conversion_note: 'No conversion tracking configured for this send.',
        soft_bounced: 0,
        soft_bounced_pct: 0,
        hard_bounced: 1,
        hard_bounced_pct: 0.37,
        unsubscribed: 5,
        unsubscribed_pct: 1.87,
        skipped_pct: 12.66,
        spam: 0,
        spam_pct: 0,
      },
      status_breakdown: [
        { status: 'Delivered, no open', count: 124, pct: 46.6 },
        { status: 'Opened, no click', count: 103, pct: 38.7 },
        { status: 'Clicked', count: 34, pct: 12.8 },
        { status: 'Unsubscribed', count: 5, pct: 1.9 },
        { status: 'Replied', count: 1, pct: 0.4 },
      ],
      click_performance: {
        links_in_email: 5,
        total_clicks: 20,
        unique_clicks: 15,
        unique_engagements: 6,
        clicks_per_unique_open_pct: 4,
        links: [
          { label: 'YouTube video link (text)', source: 'Text', total_clicks: 7, unique_clicks: 6 },
          { label: 'YouTube video link (image)', source: 'Image', total_clicks: 0, unique_clicks: 0 },
          { label: 'Give / Donate page', source: 'Text', total_clicks: 4, unique_clicks: 3 },
        ],
        note:
          'Q1 link table is partial from the source report. The headline finding: the text version of the YouTube link beat the image version, which got zero clicks. This drove the Q2 decision to go all-text.',
      },
      resend: null,
      notes: [
        'Strong delivery and open rate for a church partner list.',
        'Skip rate of 12.66% was flagged for review.',
        'Zero spam complaints.',
        'Text links outperformed image links.',
      ],
    },
    {
      id: 'Q2',
      label: 'Q2 2026',
      sent_date: '2026-06-10',
      audience_total: 308,
      engagement: {
        sent_attempted: 258,
        delivered: 254,
        delivered_pct: 98.45,
        opened: 135,
        opened_pct: 53.15,
        clicked: 41,
        clicked_pct: 16.14,
        conversion: 0,
        conversion_pct: 0,
        conversion_note: 'No conversion tracking configured for this send.',
        soft_bounced: 0,
        soft_bounced_pct: 0,
        hard_bounced: 4,
        hard_bounced_pct: 1.55,
        unsubscribed: 3,
        unsubscribed_pct: 1.18,
        skipped: 50,
        skipped_pct: 16.23,
        spam: 0,
        spam_pct: 0,
      },
      status_breakdown: [
        { status: 'Delivered, no open', count: 119, pct: 46.9 },
        { status: 'Opened, no click', count: 94, pct: 37.0 },
        { status: 'Clicked', count: 41, pct: 16.1 },
        { status: 'Unsubscribed', count: 3, pct: 1.2 },
        { status: 'Replied', count: 1, pct: 0.4 },
      ],
      status_breakdown_note:
        'Q2 status counts are derived: delivered 254, opened 135 (94 opened-no-click + 41 clicked), 1 reply (The Crossing Church). Adjust if the GHL CSV export gives exact rows.',
      click_performance: {
        links_in_email: 3,
        total_clicks: 96,
        unique_clicks: 92,
        unique_engagements: 39,
        clicks_per_unique_open_pct: 29,
        links: [
          {
            label: 'Donate Now',
            url: 'https://www.favorintl.org/connect-support/donate-now',
            source: 'Text',
            total_clicks: 34,
            unique_clicks: 32,
          },
          { label: 'Homepage', url: 'https://www.favorintl.org/', source: 'Text', total_clicks: 32, unique_clicks: 31 },
          {
            label: 'YouTube channel',
            url: 'https://www.youtube.com/@FavorInternational',
            source: 'Text',
            total_clicks: 30,
            unique_clicks: 29,
          },
        ],
      },
      resend: {
        target: 'Unopened from initial send',
        sent: 120,
        delivered: 120,
        delivered_pct: 100,
        opened: 33,
        opened_pct: 27.5,
        clicked: 1,
        clicked_pct: 0.83,
        unsubscribed_from_resend: 1,
        takeaway:
          'The resend produced almost no incremental clicks. Near all click intent fires on the initial send. Resend value is low.',
      },
      notes: [
        'The Crossing Church replied to this send. Route that reply to Josh.',
        '3 unsubscribes. Suppress them on the next send.',
        '~50 skipped, mostly prior unsubscribes plus a couple of invalid addresses. No failures.',
        'All three links were text only. Click engagement deepened sharply versus Q1.',
      ],
    },
  ],
};
