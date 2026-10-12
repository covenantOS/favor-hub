/* Today for a new hire: the first week, on the first page they open. One card above the briefing with today's day of the plan
   (courses, the practice record, the tour, the check-in), how much is done, and a link to all five days on /welcome/.
   Reads GET /api/onboarding/welcome, the same answer the Welcome page draws; a person with no first week sees nothing. */
(() => {
'use strict';
const root = document.getElementById('fw-root');
if (!root) return;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const dayNo = (iso) => Math.round(Date.parse(iso + 'T12:00:00Z') / 864e5);
/** Weekdays from the start date through today, counting the start as day 1. */
function weekdayOf(start) {
  if (!start || start > today) return 1;
  let n = 0;
  for (let d = dayNo(start); d <= dayNo(today); d++) { const w = new Date(d * 864e5).getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return Math.max(1, n);
}
const KIND = { course: 'Course', practice: 'Practice', tour: 'Tour', meet: 'Check-in', read: 'Read' };
const CHECK = '<svg class="h-i" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

function draw(d) {
  const f = d.firstWeek;
  if (!d.run || !f || !f.days || !f.days.length || !f.total) return;
  // The card stays for three weeks from the start, or until every item is done.
  if (f.done >= f.total || dayNo(today) - dayNo(f.start || d.run.date) > 21) return;
  const n = Math.min(f.days.length, weekdayOf(f.start || d.run.date));
  // Today's day of the plan; when it is finished, the next day with something left.
  const day = f.days.slice(n - 1).find((x) => x.items.some((i) => !i.done)) || f.days.find((x) => x.items.some((i) => !i.done)) || f.days[n - 1];
  const pct = Math.round((f.done / f.total) * 100);
  const rows = day.items.map((i) => {
    const fact = [KIND[i.kind] || '', i.kind === 'course' && i.lessons ? `${i.lessonsDone} of ${i.lessons} lessons` : '', i.kind === 'course' && i.minutes ? `${i.minutes} min` : ''].filter(Boolean).join(' · ');
    return `<li class="fw-row${i.done ? ' is-done' : ''}"><div class="fw-main"><a class="fw-t" href="${esc(i.href)}">${esc(i.title)}</a><span class="fw-f">${esc(fact)}</span></div>${i.done ? `<span class="fw-done">${CHECK}Done</span>` : `<a class="h-btn h-btn--ghost h-btn--sm" href="${esc(i.href)}">${i.kind === 'course' && i.lessonsDone ? 'Continue' : 'Open'}</a>`}</li>`;
  }).join('');
  root.innerHTML = `<section class="h-card fw-card" aria-label="Your first week">
    <div class="fw-head"><h2>Your first week</h2><span class="fw-count">${f.done} of ${f.total} done</span><a class="dp-link" href="/welcome/">All ${f.days.length} days</a></div>
    <span class="fw-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="First week progress"><i style="width:${pct}%"></i></span>
    <div class="fw-day">Day ${day.day} · ${esc(day.title)}</div>
    <ul class="fw-list">${rows}</ul>
  </section>`;
}

fetch('/api/onboarding/welcome', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && d.ok !== false) draw(d); }).catch(() => {});
})();
