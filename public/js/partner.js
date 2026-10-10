/* The partner page and the partner panel. One script draws a partner from GET /api/work/partners/:id (a read of the copy of
   Blackbaud that refreshes at 5 AM and 5 PM). The page at /work/partner/<id> mounts it full width; the Work Center's side panel
   mounts the same view with { compact: true } through window.FavorPartner.mount(el, id, opts). Read only. */
(() => {
'use strict';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fd = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return MON[m - 1] + ' ' + d + ', ' + y; };
const money = (a) => (a == null ? '' : '$' + Number(a).toLocaleString('en-US', { minimumFractionDigits: Math.round(a) === a ? 0 : 2, maximumFractionDigits: 2 }));
const dayn = (iso) => Math.round((Date.parse(iso.slice(0, 10) + 'T12:00:00Z') - Date.parse(TODAY + 'T12:00:00Z')) / 86400000);
const ago = (iso) => {
  if (!iso) return '';
  const n = -dayn(iso);
  if (n === 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 0) return 'in ' + (-n) + ' days';
  if (n < 60) return n + ' days ago';
  if (n < 700) return Math.round(n / 30.4) + ' months ago';
  return (n / 365).toFixed(1).replace(/\.0$/, '') + ' years ago';
};
const whole = (a) => (a == null ? '' : a >= 10000 ? '$' + Math.round(a).toLocaleString('en-US') : money(a));
/** A list that shows its first n items and a button for the rest. */
const capped = (items, n, noun) => {
  if (items.length <= n) return `<ul>${items.join('')}</ul>`;
  return `<ul>${items.slice(0, n).join('')}</ul><ul class="pv-rest" hidden>${items.slice(n).join('')}</ul><button type="button" class="pv-showmore" data-more>Show ${items.length - n} more ${noun}</button>`;
};
const plural = (n, one, many) => n.toLocaleString('en-US') + ' ' + (n === 1 ? one : (many || one + 's'));
const QS = new URLSearchParams(location.search);
const AS = QS.get('as') || '';
const BB = 'https://host.nxt.blackbaud.com/constituent/records/';
const ENV = '?envid=p-5_k5FlbubEyEQnUJw7C9Rw';

async function api(path) {
  const url = AS ? path + (path.includes('?') ? '&' : '?') + 'as=' + encodeURIComponent(AS) : path;
  const res = await fetch(url, { credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.error === 'signin') { location.href = '/login/?next=' + encodeURIComponent(location.pathname + location.search); throw new Error('Sign in again.'); }
  if (!res.ok || data.ok === false) { const e = new Error(data.message || 'Something went wrong. Try again.'); e.status = res.status; throw e; }
  return data;
}

const I = {
  ext: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
};
const ic = (n) => `<svg class="h-i" viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`;
const href = (cid) => '/work/partner/' + encodeURIComponent(cid) + (AS ? '?as=' + encodeURIComponent(AS) : '');

const row = (label, html) => (html ? `<div class="pv-kv"><dt>${label}</dt><dd>${html}</dd></div>` : '');
const card = (title, sub, body, cls) => `<section class="h-card pv-card ${cls || ''}"><header><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</header>${body}</section>`;
const empty = (t) => `<p class="pv-empty">${t}</p>`;

function stat(label, value, sub) {
  return `<div class="pv-stat"><b>${value}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
}

function giftRow(g) {
  const kind = g.soft ? 'Soft credit' : g.type === 'RecurringGiftPayment' ? 'Recurring' : g.type === 'GiftInKind' ? 'In kind' : g.type === 'Stock/Property' ? 'Stock' : '';
  return `<li class="pv-gift"><b>${money(g.amount)}</b><span class="pv-when">${fd(g.date)}</span><span class="pv-what">${esc(g.fund || 'No fund on file')}${kind ? ` <i class="pv-tag">${kind}</i>` : ''}${g.comment ? `<em>${esc(g.comment)}</em>` : ''}</span></li>`;
}

function actionRow(a) {
  const when = a.open ? (a.due ? 'Due ' + fd(a.due) : 'No due date') : fd(a.done || a.due || a.added);
  let late = '';
  if (a.open && a.due) { const n = dayn(a.due); if (n < 0) late = `<i class="pv-tag pv-tag--late">${plural(-n, 'day')} late</i>`; else if (n === 0) late = '<i class="pv-tag pv-tag--soon">Due today</i>'; }
  const who = a.fundraisers.map((f) => esc(f.name)).join(', ');
  return `<li class="pv-act"><div class="pv-act__top"><b>${esc(a.summary || 'No summary')}</b>${late}</div>
    <span class="pv-sub">${esc(a.type)}${a.category ? ' · ' + esc(a.category) : ''} · ${when}${who ? ' · ' + who : ''}${a.outcome ? ' · ' + esc(a.outcome) : ''}</span></li>`;
}

function years(p) {
  const ys = p.giving.years;
  if (!ys.length) return empty('No gifts on this record.');
  const max = Math.max(...ys.map((y) => y.total + y.soft), 1);
  return `<ul class="pv-years">${ys.map((y) => `<li><span class="pv-y">${esc(y.year)}</span><span class="pv-bar"><i style="width:${Math.max(2, Math.round(((y.total + y.soft) / max) * 100))}%"></i></span>
    <b>${money(y.total)}</b><span class="pv-n">${plural(y.count, 'gift')}${y.soft ? ` · ${money(y.soft)} soft credit` : ''}</span></li>`).join('')}</ul>`;
}

function view(p, o = {}) {
  const g = p.giving;
  const lc = p.lastContact;
  const fl = [];
  if (p.deceased) fl.push('<span class="pv-flag pv-flag--bad">Deceased</span>');
  if (p.inactive) fl.push('<span class="pv-flag pv-flag--bad">Inactive</span>');
  if (p.flags.doNotCall) fl.push('<span class="pv-flag pv-flag--warn">Do not call</span>');
  if (p.flags.doNotEmail) fl.push('<span class="pv-flag pv-flag--warn">Do not email</span>');
  if (p.flags.doNotMail) fl.push('<span class="pv-flag pv-flag--warn">Do not mail</span>');
  p.codes.forEach((c) => fl.push(`<span class="pv-flag">${esc(c)}</span>`));
  const open = !o.compact ? '' : `<a class="h-btn h-btn--ghost h-btn--sm" href="${href(p.id)}">Open the full page</a>`;
  const head = `<header class="pv-head"><div><span class="h-label">${p.kind === 'Organization' ? 'Organization' : 'Partner'}${p.lookup ? ' · Constituent ' + esc(p.lookup) : ''}</span>
      <h1>${esc(p.name)}</h1><p>${esc(p.place || 'No city on file')}${g.firstDate ? ' · Gave first on ' + fd(g.firstDate) : ''}</p>
      <div class="pv-flags">${fl.join('')}</div></div>
    <div class="pv-links">${open}<a class="h-btn h-btn--ghost h-btn--sm" href="${BB}${esc(p.id)}${ENV}" target="_blank" rel="noopener">${ic('ext')}Open in Blackbaud</a></div></header>`;

  const stats = `<div class="h-card pv-band">${stat('Given in all', whole(g.total), plural(g.count, 'gift'))}${stat('This year', whole(g.ytd), 'since Jan 1')}${stat('Last 12 months', whole(g.last12))}
    ${stat('Largest gift', g.largest ? money(g.largest.amount) : 'None', g.largest ? fd(g.largest.date) : '')}${stat('Last gift', g.last ? money(g.last.amount) : 'None', g.last ? fd(g.last.date) + ' · ' + ago(g.last.date) : '')}
    ${stat('Last contact', lc ? ago(lc.date) : 'None logged', lc ? esc(lc.category) + ' · ' + fd(lc.date) : 'No call, email, meeting or mailing')}</div>`;

  // Contact
  const c = p.contact;
  const a = c.address;
  const contact = card('Contact', '', `<dl class="pv-dl">
      ${row('Address', a ? esc([a.lines, [a.city, a.state].filter(Boolean).join(', ') + (a.zip ? ' ' + a.zip : '')].filter((x) => x && x.trim()).join(', ')) + (a.doNotMail ? ' <i class="pv-tag pv-tag--soon">Do not mail</i>' : '') + (c.otherAddresses ? ` <small>and ${plural(c.otherAddresses, 'other address', 'other addresses')}</small>` : '') : '<span class="pv-none">No address on file</span>')}
      ${c.phones.length ? c.phones.map((x) => row(esc(x.type || 'Phone'), (x.doNotCall ? esc(x.number) + ' <i class="pv-tag pv-tag--soon">Do not call</i>' : `<a href="tel:${esc(String(x.number).replace(/[^\d+]/g, ''))}">${esc(x.number)}</a>`) + (x.primary ? ' <small>main</small>' : ''))).join('') : row('Phone', '<span class="pv-none">No phone on file</span>')}
      ${c.emails.length ? c.emails.map((x) => row('Email', (x.doNotEmail ? esc(x.address) + ' <i class="pv-tag pv-tag--soon">Do not email</i>' : `<a href="mailto:${esc(x.address)}">${esc(x.address)}</a>`) + (x.primary ? ' <small>main</small>' : ''))).join('') : row('Email', '<span class="pv-none">No email on file</span>')}
      ${row('Added', p.addedOn ? fd(p.addedOn) : '')}
    </dl>`);

  const household = p.household.length ? card('Household', '', `<ul class="pv-people">${p.household.map((h) => `<li><a href="${href(h.id)}">${esc(h.name)}</a><span>${esc(h.relation)}${h.lookup ? ' · ' + esc(h.lookup) : ''}</span></li>`).join('')}</ul>`) : '';

  const assigned = card('Assigned to', 'Who holds this partner', p.assignments.length
    ? `<ul class="pv-people">${p.assignments.map((x) => `<li class="${x.current ? '' : 'is-past'}"><b>${esc(x.name)}</b><span>${esc(x.type || 'Assignment')}${x.from ? ' · from ' + fd(x.from) : ''}${x.to ? ' · to ' + fd(x.to) : ''}${x.current ? '' : ' · ended'}</span></li>`).join('')}</ul>`
    : empty('No one holds this partner.'));

  const iw = p.iwave;
  const iwave = card('iWave rating', iw && iw.ratedOn ? 'Rated ' + fd(iw.ratedOn) : '', iw
    ? `<dl class="pv-dl">${row('Overall score', iw.overall == null ? '' : esc(iw.overall))}${row('Affinity', iw.affinity == null ? '' : esc(iw.affinity))}${row('Propensity', iw.propensity == null ? '' : esc(iw.propensity))}${row('RFM', iw.rfm == null ? '' : esc(iw.rfm))}${row('Estimated capacity', iw.capacity == null ? '' : money(iw.capacity) + (iw.capacityBand ? ' <small>' + esc(iw.capacityBand) + '</small>' : ''))}${row('Source', esc(iw.source))}</dl>`
    : empty('Not rated. iWave scores only new partners with a recent gift and a US address, so most records have no rating.'));

  const opps = card('Opportunities', '', p.opportunities.length
    ? `<ul class="pv-opps">${p.opportunities.map((x) => `<li><b>${esc(x.name || 'Opportunity')}</b><span class="pv-sub">${esc(x.status)}${x.purpose ? ' · ' + esc(x.purpose) : ''}</span>
        <span class="pv-sub">${x.ask ? 'Ask ' + money(x.ask) + (x.askDate ? ' on ' + fd(x.askDate) : '') : ''}${x.expected ? ' · Expected ' + money(x.expected) + (x.expectedDate ? ' on ' + fd(x.expectedDate) : '') : ''}${x.funded ? ' · Funded ' + money(x.funded) + (x.fundedDate ? ' on ' + fd(x.fundedDate) : '') : ''}${x.deadline ? ' · Deadline ' + fd(x.deadline) : ''}${x.by.length ? ' · ' + x.by.map(esc).join(', ') : ''}</span></li>`).join('')}</ul>`
    : empty('No opportunities.'));

  // Giving
  const giving = card('Giving history', plural(g.count, 'gift') + ' in all' + (g.soft.count ? ', and ' + plural(g.soft.count, 'soft credit') : ''), years(p)
    + (g.recent.length ? `<h3>Recent gifts</h3><div class="pv-gifts">${capped(g.recent.map(giftRow), 8, 'gifts')}</div>${g.count > g.recent.length ? `<p class="pv-more">The ${g.recent.length} most recent of ${g.count} gifts. Totals by year above cover all of them.</p>` : ''}` : '')
    + (g.soft.recent.length ? `<h3>Soft credits to this partner</h3><ul class="pv-gifts">${g.soft.recent.map(giftRow).join('')}</ul>` : ''), 'pv-card--wide');

  const recur = card('Recurring gifts', '', p.recurring.length
    ? `<ul class="pv-opps">${p.recurring.map((r) => `<li><b>${money(r.amount)}</b> <i class="pv-tag ${r.status === 'Active' ? '' : 'pv-tag--soon'}">${esc(r.status)}</i><span class="pv-sub">${esc(r.fund || 'No fund on file')} · Started ${fd(r.since)}${r.lastPayment ? ' · Last payment ' + money(r.lastAmount) + ' on ' + fd(r.lastPayment) : ' · No payment yet'}${r.payments ? ' · ' + plural(r.payments, 'payment') : ''}</span></li>`).join('')}</ul>`
    : empty('No recurring gifts.'));

  const acts = card('Actions', p.actions.openCount ? plural(p.actions.openCount, 'open action') : 'Nothing open',
    (p.actions.open.length ? `<h3>Open</h3><div class="pv-acts">${capped(p.actions.open.map(actionRow), 6, 'open actions')}</div>${p.actions.openCount > p.actions.open.length ? `<p class="pv-more">The ${p.actions.open.length} due soonest of ${p.actions.openCount}.</p>` : ''}` : empty('No open actions.'))
    + (p.actions.recent.length ? `<h3>Recent</h3><div class="pv-acts">${capped(p.actions.recent.map(actionRow), 5, 'recent actions')}</div>` : ''), 'pv-card--wide');

  const notes = card('Notes', 'Written on the partner\'s actions, newest first', p.notes.length
    ? `<div class="pv-notes">${capped(p.notes.map((n) => `<li><span class="pv-sub">${fd(n.date)} · ${esc(n.type)}${n.by ? ' · ' + esc(n.by) : ''}</span>${n.summary ? `<b>${esc(n.summary)}</b>` : ''}<p>${esc(n.text)}</p></li>`), 4, 'notes')}</div>`
    : empty('No notes on this partner\'s actions.'), 'pv-card--wide');

  const foot = `<p class="pv-foot">${p.synced ? 'Read from the copy of Blackbaud taken ' + new Date(p.synced).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET. Blackbaud has anything newer.' : 'Read from the copy of Blackbaud, which refreshes at 5 AM and 5 PM.'}</p>`;

  return `<div class="pv ${o.compact ? 'pv--compact' : ''}">${head}${stats}
    <div class="pv-grid"><div class="pv-main">${giving}${recur}${acts}${notes}</div><aside class="pv-side">${contact}${household}${assigned}${iwave}${opps}</aside></div>${foot}</div>`;
}

const skeleton = '<div class="pv"><div class="h-skel" style="height:120px;border-radius:18px;margin-bottom:14px"></div><div class="h-skel" style="height:96px;border-radius:18px;margin-bottom:14px"></div><div class="h-skel" style="height:360px;border-radius:18px"></div></div>';

async function mount(el, id, o = {}) {
  el.setAttribute('aria-busy', 'true');
  el.innerHTML = skeleton;
  try {
    const d = await api('/api/work/partners/' + encodeURIComponent(id));
    el.innerHTML = view(d.partner, o);
    el.querySelectorAll('[data-more]').forEach((btn) => btn.addEventListener('click', () => { const rest = btn.previousElementSibling; if (rest) rest.hidden = false; btn.remove(); }));
    if (o.onLoad) o.onLoad(d.partner);
    return d.partner;
  } catch (e) {
    el.innerHTML = `<div class="h-card pv-card"><h2>${e.status === 404 ? 'No partner found' : 'The partner did not load'}</h2><p>${esc(e.message)}</p><p><a class="h-btn h-btn--ghost h-btn--sm" href="/work/partner/">Search for a partner</a></p></div>`;
    return null;
  } finally {
    el.removeAttribute('aria-busy');
  }
}

/** A search box over every partner: name, email, phone, street address or lookup id. Picking a hit calls onPick(hit), or goes to the partner page. */
function search(host, o = {}) {
  host.innerHTML = `<div class="pv-find"><label class="pv-find__box">${ic('search')}<input type="search" placeholder="${esc(o.placeholder || 'Name, email, phone, address or lookup id')}" autocomplete="off" aria-label="Find a partner" /></label><ul class="pv-find__list" role="listbox" hidden></ul></div>`;
  const input = host.querySelector('input');
  const list = host.querySelector('.pv-find__list');
  let timer = 0; let seq = 0; let hits = []; let hi = -1;
  const draw = () => {
    list.hidden = false;
    list.innerHTML = hits.length
      ? hits.map((h, i) => `<li role="option" class="${i === hi ? 'is-hi' : ''}"><a href="${href(h.cid)}" data-i="${i}"><b>${esc(h.name)}</b><span>${esc(h.place || 'No city on file')} · ${esc(h.lookup)}${h.deceased ? ' · deceased' : ''}</span></a></li>`).join('')
      : '<li class="is-none">No partner found. Try a last name, an email, or the last seven digits of a phone number.</li>';
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const t = input.value.trim();
    if (t.length < 2) { list.hidden = true; return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try { const d = await api('/api/work/partners?wide=1&q=' + encodeURIComponent(t)); if (mine !== seq) return; hits = d.rows || []; hi = hits.length ? 0 : -1; draw(); } catch (e) { list.hidden = false; list.innerHTML = `<li class="is-none">${esc(e.message)}</li>`; }
    }, 220);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && hits.length) { e.preventDefault(); hi = (hi + 1) % hits.length; draw(); }
    else if (e.key === 'ArrowUp' && hits.length) { e.preventDefault(); hi = (hi - 1 + hits.length) % hits.length; draw(); }
    else if (e.key === 'Enter' && hits[hi]) { e.preventDefault(); if (o.onPick) o.onPick(hits[hi]); else location.href = href(hits[hi].cid); }
    else if (e.key === 'Escape') { list.hidden = true; }
  });
  list.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-i]');
    if (a && o.onPick) { e.preventDefault(); o.onPick(hits[Number(a.dataset.i)]); }
  });
  document.addEventListener('click', (e) => { if (!host.contains(e.target)) list.hidden = true; });
  return input;
}

window.FavorPartner = { mount, view, search, href };

// The page: /work/partner/<id> shows that partner, /work/partner/ shows the search.
const root = document.getElementById('pv-root');
if (root) {
  const m = location.pathname.match(/\/work\/partner\/(\d+)/);
  const box = document.getElementById('pv-search');
  const input = search(box, {});
  if (m) mount(root, m[1], { onLoad: (p) => { document.title = p.name + ' - Favor Hub'; } });
  else { root.innerHTML = '<div class="h-card pv-card"><h2>Find a partner</h2><p>Type a name, an email, a phone number, a street address or a lookup id. Pick a partner to see their contact details, giving, actions, notes and who holds them.</p></div>'; input.focus(); }
}
})();
