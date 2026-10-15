/* The partner record's CRM tabs and header extras, beside public/js/partner.js:
     Gifts          every gift on the record and every gift soft credited to it, paged and sortable, with how each one counts
     Actions        every action on the record, open first, paged, with a filter for open ones and contacts
     Relationships  household, relationships, attributes, solicit codes and constituent codes with their dates, every address,
                    email, phone and web address
   and, under the partner's name, a star and the partner's FavorOS tags. Reads /api/partners/record/<id>/* (the D1 copy of Blackbaud)
   and /api/partners/tags and /stars (FavorOS's own). Nothing here writes to Blackbaud.
   Public: window.FavorPartnerCRM = { TABS, mount, decorate, opened }. */
(() => {
'use strict';
if (window.FavorPartnerCRM) return;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const fd = (iso) => { if (!iso || String(iso).startsWith('1900')) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return MON[m - 1] + ' ' + d + ', ' + y; };
const money = (v) => { const n = Number(v) || 0; return '$' + n.toLocaleString('en-US', { minimumFractionDigits: Math.round(n) === n ? 0 : 2, maximumFractionDigits: 2 }); };
const N = (n) => (Number(n) || 0).toLocaleString('en-US');
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>';
const AS = new URLSearchParams(location.search).get('as') || '';

async function api(path, opts = {}) {
  const url = AS ? path + (path.includes('?') ? '&' : '?') + 'as=' + encodeURIComponent(AS) : path;
  const headers = Object.assign({ 'X-Hub-Request': '1' }, opts.body ? { 'Content-Type': 'application/json' } : {});
  const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts, { headers }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.message || 'Something went wrong. Try again.');
  return data;
}
const post = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b || {}) });

const TABS = [['gifts', 'Gifts'], ['actions', 'Actions'], ['connections', 'Relationships']];
const X = new Map(); // id -> extras answer (relationships, codes, tags, star)
const xOf = (id) => { if (!X.has(id)) X.set(id, api('/api/partners/record/' + encodeURIComponent(id) + '/extras').catch((e) => ({ error: e.message }))); return X.get(id); };

/* ------------------------------------------------------------------ header: star and tags */
function headHTML(id, x) {
  const tags = (x && x.tags) || [];
  return `<button type="button" class="pc-star${x && x.star ? ' is-on' : ''}" data-pc-star="${esc(id)}" aria-pressed="${!!(x && x.star)}" title="${x && x.star ? 'Starred: it shows under Starred in All partners' : 'Star this partner'}">${STAR}<span>${x && x.star ? 'Starred' : 'Star'}</span></button>
    ${tags.map((t) => `<span class="pc-tag">${esc(t.tag)}<button type="button" data-pc-untag="${esc(t.tag)}" data-id="${esc(id)}" aria-label="Remove the tag ${esc(t.tag)}">×</button></span>`).join('')}
    <button type="button" class="pc-addtag" data-pc-tag="${esc(id)}">+ Tag</button>`;
}
/** Draw the star and tags into the partner header (partner.js calls this after each paint). */
function decorate(host, id) {
  const slot = host.querySelector('[data-pc-head]');
  if (!slot) return;
  xOf(id).then((x) => { if (slot.isConnected) slot.innerHTML = headHTML(id, x.error ? null : x); });
}
/** A partner record was opened: it goes to the top of Recently opened (every device). */
function opened(id) { post('/api/partners/recent/' + encodeURIComponent(id)).catch(() => {}); }

/* ------------------------------------------------------------------ the tabs */
function mount(el, c) {
  const id = c.id;
  const S = { page: 1, size: window.PT ? window.PT.size('pc-' + c.tab, 25) : 25, sort: 'date', dir: 'desc', filter: '', data: null, err: '' };
  const key = 'pc-' + c.tab + '-' + id;
  async function load() {
    try {
      if (c.tab === 'connections') S.data = await xOf(id);
      else {
        const q = new URLSearchParams({ page: S.page, size: S.size });
        if (c.tab === 'gifts') { q.set('sort', S.sort); q.set('dir', S.dir); }
        if (c.tab === 'actions' && S.filter) q.set('filter', S.filter);
        S.data = await api(`/api/partners/record/${encodeURIComponent(id)}/${c.tab}?${q}`);
      }
      S.err = S.data && S.data.error ? S.data.error : '';
    } catch (e) { S.err = e.message; }
    draw();
  }
  function draw() {
    if (S.err) { el.innerHTML = `<div class="pt-empty"><b>This did not load</b>${esc(S.err)}</div>`; return; }
    if (!S.data) { el.innerHTML = '<div class="pc-skel"><i></i><i></i><i></i><i></i><i></i></div>'; return; }
    el.innerHTML = c.tab === 'gifts' ? gifts() : c.tab === 'actions' ? actions() : connections();
  }
  const pager = () => (window.PT ? window.PT.pager(key, { total: S.data.total, page: S.page, size: S.size }) : '');
  function gifts() {
    const d = S.data;
    const sort = { col: S.sort, dir: S.dir };
    const th = (k, l, cls) => (window.PT ? window.PT.th(key, k, l, sort, cls) : esc(l));
    const how = (g) => g.credit === 'soft' ? `<span class="pt-badge" title="The gift sits on ${esc(g.through.name)}; Favor's rule credits it here">Soft credit</span> <span class="pt-sub">through <a href="/work/partner/${esc(g.through.id)}" data-partner-id="${esc(g.through.id)}">${esc(g.through.name)}</a></span>`
      : g.credit === 'passed' ? `<span class="pt-badge pt-badge--gold" title="On this record, credited to the partners named">Passed on</span> <span class="pt-sub">for ${g.to.slice(0, 2).map((t) => `<a href="/work/partner/${esc(t.id)}" data-partner-id="${esc(t.id)}">${esc(t.name)}</a>`).join(', ')}${g.to.length > 2 ? ' and ' + (g.to.length - 2) + ' more' : ''}</span>`
        : '<span class="pt-badge pt-badge--good">Own</span>';
    return `<div class="pc-bar"><b>${N(d.total)} ${d.total === 1 ? 'gift' : 'gifts'}</b><span class="pt-sub">On this record and soft credited to it. Own and soft credit gifts count toward the partner's giving; passed-on gifts count for the partners named.</span></div>
      <div class="pt-wrap"><table class="pt-table"><thead><tr><th>${th('date', 'Date')}</th><th class="is-num">${th('amount', 'Amount', 'is-num')}</th><th>${th('type', 'Type')}</th><th>Fund</th><th>Appeal</th><th>Counts as</th><th>Method</th><th>Thanked</th></tr></thead>
      <tbody data-pt-list="${esc(key)}">${d.rows.length ? d.rows.map((g) => `<tr data-pt-row tabindex="-1" title="${esc(g.comment || '')}"><td>${esc(fd(g.date))}</td><td class="is-num">${esc(money(g.amount))}${g.amount !== g.giftAmount ? `<div class="pt-sub">of ${esc(money(g.giftAmount))}</div>` : ''}</td><td>${esc(g.type === 'RecurringGiftPayment' ? 'Recurring payment' : g.type)}</td><td class="is-clip">${esc(g.fund)}</td><td>${esc(g.appeal)}</td><td class="is-wrap">${how(g)}</td><td>${esc(g.method)}</td><td>${esc(g.ack || '')}</td></tr>`).join('') : '<tr><td colspan="8"><div class="pt-empty"><b>No gifts yet</b></div></td></tr>'}</tbody></table></div>${pager()}`;
  }
  function actions() {
    const d = S.data;
    const seg = [['', 'All'], ['open', 'Open'], ['contacts', 'Contacts']].map(([k, l]) => `<button type="button" data-pc-filter="${k}" aria-pressed="${S.filter === k}">${l}</button>`).join('');
    return `<div class="pc-bar"><b>${N(d.total)} ${d.total === 1 ? 'action' : 'actions'}</b><div class="pt-seg" role="group" aria-label="Show">${seg}</div></div>
      <div class="pt-wrap"><table class="pt-table"><thead><tr><th>Date</th><th>Status</th><th>Category</th><th>Type</th><th>Summary</th><th>Fundraiser</th></tr></thead>
      <tbody data-pt-list="${esc(key)}">${d.rows.length ? d.rows.map((a) => `<tr data-pt-row tabindex="-1"><td>${esc(fd(a.open ? a.due : a.done || a.due))}</td><td>${a.open ? '<span class="pt-badge pt-badge--gold">Open</span>' : '<span class="pt-badge">Done</span>'}</td><td>${esc(a.category)}</td><td>${esc(a.type)}</td><td class="is-wrap"><b class="pc-sum">${esc(a.summary || 'No summary')}</b>${a.description ? `<div class="pt-sub pc-desc">${esc(a.description)}</div>` : ''}${a.outcome ? `<div class="pt-sub">Outcome: ${esc(a.outcome)}</div>` : ''}</td><td>${esc(a.by.join(', '))}</td></tr>`).join('') : '<tr><td colspan="6"><div class="pt-empty"><b>No actions</b></div></td></tr>'}</tbody></table></div>${pager()}`;
  }
  function connections() {
    const d = S.data;
    const p = c.partner() || {};
    const dl = (rows) => `<dl class="pc-dl">${rows.join('')}</dl>`;
    const rel = d.relationships || [];
    const sec = (title, body) => `<section class="pc-sec"><h3>${esc(title)}</h3>${body}</section>`;
    const relBody = rel.length ? `<table class="pt-table"><thead><tr><th>Name</th><th>Relationship</th><th>Their side</th><th>Position</th><th>Since</th><th>Note</th></tr></thead><tbody>${rel.map((r) => `<tr><td>${r.id ? `<a class="pt-name" href="/work/partner/${esc(r.id)}" data-partner-id="${esc(r.id)}">${esc(r.name || 'Record ' + r.id)}</a>` : esc(r.name)}${r.spouse ? ' <span class="pt-badge">Spouse</span>' : ''}${r.contact ? ' <span class="pt-badge">Contact</span>' : ''}${r.business ? ' <span class="pt-badge">Employer</span>' : ''}</td><td>${esc(r.type)}</td><td>${esc(r.reciprocal)}</td><td>${esc(r.position || r.contactType)}</td><td>${esc(fd(r.start))}${r.end ? ' to ' + esc(fd(r.end)) : ''}</td><td class="is-wrap">${esc(r.comment)}</td></tr>`).join('')}</tbody></table>`
      : `<p class="pt-mute pc-p">${(p.household || []).length ? 'Household: ' + p.household.map((h) => `<a href="/work/partner/${esc(h.id)}" data-partner-id="${esc(h.id)}">${esc(h.name)}</a>`).join(', ') + '. ' : ''}No relationships on the record.</p>`;
    const codes = (d.codes || []).map((x) => `<dt>${esc(x.value)}</dt><dd>${x.start ? 'From ' + esc(fd(x.start)) : ''}${x.end ? ' to ' + esc(fd(x.end)) : ''}${x.inactive ? ' <span class="pt-badge">Inactive</span>' : ''}</dd>`);
    const sol = (d.solicit || []).map((x) => `<dt>${esc(x.value)}</dt><dd>${x.start ? 'From ' + esc(fd(x.start)) : 'Always'}${x.end ? ' to ' + esc(fd(x.end)) : ''}</dd>`);
    const attrs = (d.attributes || []).map((x) => `<dt>${esc(x.category)}</dt><dd>${esc(x.value)}${x.date ? ' <span class="pt-sub">' + esc(fd(x.date)) + '</span>' : ''}${x.comment ? '<div class="pt-sub">' + esc(x.comment) + '</div>' : ''}</dd>`);
    const contact = [
      ...(d.addresses || []).map((a) => `<dt>${esc(a.type || 'Address')}${a.primary ? ' <span class="pt-badge pt-badge--good">Preferred</span>' : ''}</dt><dd>${esc([a.lines, a.city, [a.state, a.zip].filter(Boolean).join(' '), a.country && a.country !== 'United States' ? a.country : ''].filter(Boolean).join(', '))}${a.doNotMail ? ' <span class="pt-badge pt-badge--warn">Do not mail</span>' : ''}${a.seasonal ? '<div class="pt-sub">Seasonal ' + esc(a.seasonal) + '</div>' : ''}</dd>`),
      ...(d.emails || []).map((e) => `<dt>${esc(e.type || 'Email')}${e.primary ? ' <span class="pt-badge pt-badge--good">Primary</span>' : ''}</dt><dd><a href="mailto:${esc(e.value)}">${esc(e.value)}</a>${e.doNotEmail ? ' <span class="pt-badge pt-badge--warn">Do not email</span>' : ''}</dd>`),
      ...(d.phones || []).map((e) => `<dt>${esc(e.type || 'Phone')}${e.primary ? ' <span class="pt-badge pt-badge--good">Primary</span>' : ''}</dt><dd><a href="tel:${esc(String(e.value).replace(/[^\d+]/g, ''))}">${esc(e.value)}</a>${e.doNotCall ? ' <span class="pt-badge pt-badge--warn">Do not call</span>' : ''}</dd>`),
      ...(d.web || []).map((w) => `<dt>${esc(w.type || 'Web')}</dt><dd><a href="${/^https?:\/\//i.test(w.value) ? esc(w.value) : 'https://' + esc(w.value)}" target="_blank" rel="noopener">${esc(w.value)}</a></dd>`),
    ];
    return `<div class="pc-grid">
      ${sec('Relationships', relBody)}
      ${sec('Contact on file', contact.length ? dl(contact) : '<p class="pt-mute pc-p">None on file.</p>')}
      ${sec('Communication preferences (solicit codes)', sol.length ? dl(sol) : '<p class="pt-mute pc-p">None. Favor may write, call and email.</p>')}
      ${sec('Constituent codes', codes.length ? dl(codes) : '<p class="pt-mute pc-p">None.</p>')}
      ${sec('Attributes', attrs.length ? dl(attrs) : '<p class="pt-mute pc-p">None.</p>')}
      ${sec('Tags in FavorOS', `<div class="pc-tags">${headHTML(id, d).replace(/^[\s\S]*?<\/button>/, '')}</div><p class="pt-sub pc-p">Tags are FavorOS labels everyone can see and filter by in All partners. They do not go to Blackbaud.</p>`)}
    </div>`;
  }
  if (window.PT) window.PT.on(key, {
    page: (p, size) => { S.page = p; S.size = size; load(); },
    sort: (col, dir) => { if (col !== S.sort) { S.sort = col; S.dir = col === 'type' ? 'asc' : 'desc'; } else S.dir = dir; S.page = 1; load(); },
  });
  el.addEventListener('click', (e) => {
    const f = e.target.closest && e.target.closest('[data-pc-filter]');
    if (f) { S.filter = f.dataset.pcFilter; S.page = 1; load(); }
  });
  el.addEventListener('rc:reload', () => { if (c.tab === 'connections') X.delete(id); load(); });
  draw();
  load();
}

/* ------------------------------------------------------------------ star and tag presses (anywhere a header or the tab shows them) */
document.addEventListener('click', (e) => {
  const t = e.target; if (!t.closest) return;
  let b = t.closest('[data-pc-star]');
  if (b) {
    const id = b.dataset.pcStar, on = !b.classList.contains('is-on');
    b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); const s = b.querySelector('span'); if (s) s.textContent = on ? 'Starred' : 'Star';
    post('/api/partners/stars/' + encodeURIComponent(id), { on }).then(() => { X.delete(id); }).catch(() => { b.classList.toggle('is-on', !on); });
    return;
  }
  b = t.closest('[data-pc-tag]');
  if (b) {
    const id = b.dataset.pcTag;
    const tag = prompt('Add a tag to this partner. Tags are FavorOS labels everyone can see and filter by; they do not go to Blackbaud.', '');
    if (!tag || !tag.trim()) return;
    post('/api/partners/tags', { cids: [id], tag }).then(() => { X.delete(id); document.querySelectorAll('[data-pc-head]').forEach((el) => { const host = el.closest('.pp') || document; decorate(host, id); }); }).catch((er) => alert(er.message));
    return;
  }
  b = t.closest('[data-pc-untag]');
  if (b) {
    const id = b.dataset.id;
    post('/api/partners/tags', { cids: [id], tag: b.dataset.pcUntag, remove: true }).then(() => { X.delete(id); const chip = b.closest('.pc-tag'); if (chip) chip.remove(); }).catch((er) => alert(er.message));
  }
});

window.FavorPartnerCRM = { TABS, mount, decorate, opened };
})();
