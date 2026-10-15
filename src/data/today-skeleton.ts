// Today's frame (redesign 2026-10-14), drawn by the Astro page and by the React app's Today alike. public/js/today3.js fills it;
// work-home.js fills the role modules (#wh-week, #wh-changes, #wh-team) and today-giftday.js the Gift day card.
// One grid: Needs you and the schedule side by side, How Favor is doing under them,
// then the role modules and the secondary row. Every card sits on the same edges and gutters (src/styles/today3.css).

const svg = (d: string) => `<svg class="h-i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const SPARK = svg('<path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="m5.6 5.6 2.1 2.1"/><path d="m16.3 16.3 2.1 2.1"/><path d="m5.6 18.4 2.1-2.1"/><path d="m16.3 7.7 2.1-2.1"/>');
const rows = (n: number, cls: string) => `<li class="${cls}" aria-hidden="true"><i></i><i></i></li>`.repeat(n);

export const TODAY_FRAME = `
<header class="td-head">
  <section class="td-hello h-hello">
    <h1 id="t-hello">Good day</h1>
    <p class="td-status" id="td-status"><span id="t-date"></span></p>
  </section>
  <div class="td-head__r">
    <div id="t-now"></div>
    <div class="h-welcome td-tour" id="t-welcome" hidden>
      <span class="h-welcome__mark">${SPARK}</span><b>Tour of FavorOS, 2 minutes</b>
      <div class="h-welcome__acts"><button type="button" class="h-btn h-btn--primary h-btn--sm" data-tour-start>Show me</button></div>
    </div>
    <p class="td-mission"><b>615,780</b> people have come to Christ since Favor began</p>
  </div>
  <p class="td-away" id="td-away" hidden></p>
</header>
<div id="fw-root"></div>
<div class="td-main">
  <section class="h-card td-card td-needs" id="td-needs" aria-labelledby="td-needs-h" data-keep-h="td-needs">
    <header class="td-ch"><h2 id="td-needs-h">Needs you</h2><span class="td-n" id="td-needs-n" data-flow="today-needs" hidden></span><div class="td-tabs" id="td-tabs" role="tablist" aria-label="Show"></div></header>
    <ol class="td-list" id="t-cards" aria-busy="true">${rows(6, 'td-skel')}</ol>
    <footer class="td-foot">
      <button type="button" class="td-more" id="td-all" hidden>Show all</button>
      <div class="td-quick tw-quick" data-need="workCenter" hidden>
        <button type="button" class="td-btn td-btn--quiet" data-q="contact">Log a contact</button>
        <button type="button" class="td-btn td-btn--quiet" data-q="task">New task</button>
      </div>
      <span class="td-scopebox" id="td-scope"></span>
      <span class="td-stamp"><span class="wh-meta" id="wh-meta"></span></span>
    </footer>
    <div class="wh-pick td-pick" id="wh-pick" hidden></div>
  </section>
  <section class="h-card td-card td-sched" id="td-sched" data-td="meetings" aria-labelledby="td-sched-h" data-keep-h="td-sched">
    <header class="td-ch"><h2 id="td-sched-h">Schedule</h2><a class="h-link td-ch__r" href="/meet/">Day view</a></header>
    <ol class="td-evs" id="td-sched-list" aria-busy="true">${rows(4, 'td-skel')}</ol>
    <p class="td-note" id="td-sched-f" hidden></p>
    <p class="td-note" id="d-sub" hidden></p>
  </section>
  <section class="h-card td-card td-doing" id="t-year-wrap" aria-labelledby="td-doing-h" data-keep-h="td-doing">
    <header class="td-ch"><h2 id="td-doing-h">How Favor is doing</h2><span class="td-ch__meta" id="t-fresh"></span><a class="h-link td-ch__r" id="td-kpi-link" href="/dashboard/" hidden>KPI dashboard</a></header>
    <div class="td-doing__b" id="t-year" aria-busy="true"><div class="td-dc td-skelblock"></div><div class="td-dc td-skelblock"></div><div class="td-dc td-skelblock"></div></div>
  </section>
</div>
<section class="td-mods wh tw" id="wh" aria-label="Your work" hidden>
  <section class="h-card td-card td-mod wh-card" id="wh-week" aria-labelledby="wh-week-h" hidden>
    <header class="td-ch"><h2 id="wh-week-h">Your week</h2><span class="td-ch__r" id="wh-week-sub"></span></header>
    <div class="wh-body td-mod__b" id="wh-week-body"></div>
  </section>
  <section class="h-card td-card td-mod wh-card" id="tw-giftday" aria-labelledby="tw-giftday-h" hidden>
    <header class="td-ch"><h2 id="tw-giftday-h">Gift day</h2><span class="td-ch__meta" id="tw-giftday-sub"></span><a class="h-link td-ch__r" href="/gifts/">Gifts overview</a></header>
    <div class="tw-gd td-gd" id="tw-giftday-body"></div>
  </section>
  <section class="h-card td-card td-mod td-team wh-card" id="wh-team" aria-labelledby="wh-team-h" hidden>
    <header class="td-ch"><h2 id="wh-team-h">Team</h2><span class="wh-chips td-ch__meta" id="wh-team-chips"></span><a class="h-link td-ch__r" href="/work/?view=open">Open all</a></header>
    <div class="wh-tw td-tw"><table class="wh-table sc-table" id="wh-team-table"></table></div>
    <button type="button" class="td-more" id="td-team-all" hidden>Show everyone</button>
  </section>
</section>
<section class="h-card td-card td-recent" id="td-more" aria-label="Recent">
  <div class="td-recent__c td-feed">
    <header class="td-ch"><h2 id="td-feed-h">What changed</h2><span class="td-ch__r td-ch__meta">Last two weeks</span></header>
    <ul class="td-flist" id="t-feed" aria-labelledby="td-feed-h"></ul>
    <button type="button" class="td-more" id="t-feed-more" hidden>Show more</button>
  </div>
  <div class="td-recent__c td-changes wh-card" id="wh-changes" hidden>
    <header class="td-ch"><h2 id="wh-changes-h">Your recent changes</h2><span class="td-ch__r td-ch__meta">Undo for 24 hours</span></header>
    <ul class="wh-list wh-list--changes td-flist" id="wh-changes-list" aria-labelledby="wh-changes-h"></ul>
  </div>
  <div class="td-recent__c td-files" id="td-files" hidden>
    <header class="td-ch"><h2 id="td-files-h">Shared with you</h2><span class="td-ch__r td-ch__meta">This week</span></header>
    <ul class="td-flist" id="td-files-list" aria-labelledby="td-files-h"></ul>
  </div>
</section>`;
