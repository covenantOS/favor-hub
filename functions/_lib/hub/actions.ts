// What counts as an open Blackbaud action in the RE NXT mirror, in one place.
//
// The mirror's `action_completed_date` column is empty on 1,408 actions that Blackbaud
// already shows as completed (Review New Constituent Record tasks closed in bulk by a
// Database View import, 2025-04 to 2026-01). Their stored record says "completed": true
// and "computed_status": "Completed" but carries no "completed_date". An action is open
// only when the completed flag is false, so every reader of open state uses this
// definition and never the date column alone.
//
// Shapes in raw_json, checked on 85,780 rows on 2026-10-09: "completed" is always a JSON
// boolean, "computed_status" is Completed, PastDue or Open. The older "status" field is
// not reliable (18 completed actions still say "Open"), so it is only read to catch Canceled.
//
// Keep it cheap: `action_completed_date IS NULL` is the first test on purpose. It uses
// idx_actions_action_completed_date and narrows 85,780 rows to about 1,600 before the JSON
// checks run on them.

/** The window the Your day card looks ahead, in days. */
export const DAY_WINDOW_DAYS = 7;

/** SQL condition: the action on alias `a` is still open. */
export function openActionSql(a = 'a'): string {
  return `${a}.action_completed_date IS NULL
            AND COALESCE(json_extract(${a}.raw_json, '$.completed'), 0) NOT IN (1, 'true')
            AND COALESCE(json_extract(${a}.raw_json, '$.computed_status'), '') NOT IN ('Completed', 'Canceled')
            AND COALESCE(json_extract(${a}.raw_json, '$.status'), '') <> 'Canceled'`;
}

/**
 * Open actions assigned to one fundraiser, due by the end of the look-ahead window, oldest
 * due date first, at most `limit` rows. Every row also carries `total` and `overdue_n`, the
 * counts over all matching actions before the limit, so the card never reads a capped count.
 *
 * Parameters in order: today (YYYY-MM-DD, Eastern), fundraiser id.
 */
export function yourDayActionsSql(limit = 60): string {
  return `SELECT a.id, substr(a.action_date_due, 1, 10) AS due, a.action_type AS type, a.action_category AS category, a.action_summary AS summary,
                a.constituent_record_id AS cid, COALESCE(json_extract(c.raw_json, '$.name'), trim(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,''))) AS partner,
                COUNT(*) OVER () AS total,
                COALESCE(SUM(substr(a.action_date_due, 1, 10) < ?) OVER (), 0) AS overdue_n
           FROM actions a LEFT JOIN constituents c ON c.id = a.constituent_record_id
          WHERE ${openActionSql('a')}
            AND a.action_date_due <= date('now', '+${DAY_WINDOW_DAYS} day')
            AND EXISTS (SELECT 1 FROM json_each(a.raw_json, '$.fundraisers') j WHERE j.value = ?)
          ORDER BY a.action_date_due LIMIT ${Math.floor(limit)}`;
}

export interface YourDayRow {
  id: string;
  due: string;
  type: string | null;
  category: string | null;
  summary: string | null;
  cid: string;
  partner: string;
  total: number;
  overdue_n: number;
}

/** Split the query result into the rows to show and the true counts. */
export function shapeYourDay(rows: YourDayRow[], show = 12): { actions: Omit<YourDayRow, 'total' | 'overdue_n'>[]; total: number; overdue: number } {
  const first = rows[0];
  return {
    actions: rows.slice(0, show).map(({ total: _t, overdue_n: _o, ...r }) => r),
    total: first ? Number(first.total) : 0,
    overdue: first ? Number(first.overdue_n) : 0,
  };
}
