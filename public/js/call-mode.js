/* Call mode: one screen for a phone call. The script (Thank, Pray, Report, Ask), the partner's giving, the last notes and contacts on the
   left; on the right a big Log it. The person says or types what happened, /api/brief/call-summary turns it into the action's summary
   and notes, and Log it saves a completed phone call on the partner through the same batch the partner page uses (saved, sent to
   Blackbaud, checked, undone from the toast for 24 hours). Opens from the partner page, a moment, My partners and the briefing.
   Public: window.FavorCall = { open, close }. Needs thank.js (loaded first). */
(() => {
'use strict';
if (window.FavorCall) return;
const F = () => window.FavorWG;
const $ = (s, el = document) => el.querySelector(s);
let layer = null;
let rec = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tel = (n) => 'tel:' + String(n).replace(/[^\d+]/g, '');

function close() {
  if (rec) { try { rec.stop(); } catch (_) { /* already stopped */ } rec = null; }
  if (!layer) return;
  layer.remove(); layer = null;
  document.documentElement.classList.remove('wg-locked');
  document.removeEventListener('keydown', onKey, true);
}
function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }

const OUTCOMES = [['talked', 'Talked'], ['left', 'Left a message'], ['none', 'No answer']];

function leftHTML(b, d, st) {
  const f = F(); const e = f.esc;
  const steps = b.steps.map((s) => `<li><div><b>${e(s.title)}</b><p>${s.pre ? e(s.pre) : ''}${s.strong ? `<em>${e(s.strong)}</em>` : ''}${s.post ? e(s.post) : ''}</p></div></li>`).join('');
  const g = b.giving;
  const m = (b.monthly || []).find((x) => /active/i.test(x.status));
  const notes = (b.contacts || []).slice(0, 3).map((c) => `<li><b>${e(f.fd(c.date, true))}, ${e(c.category)}</b> ${e(c.text || c.summary || '')}${c.by ? `<small>${e(c.by)}</small>` : ''}</li>`).join('') || '<li>No contact on file.</li>';
  const owed = (d.owedRows || []).slice(0, 3).map((o, i) => `<div class="cm-owe"><span><b>${f.money(o.amount)}</b> to ${e(o.fund || 'no fund on file')}, ${e(f.fd(o.date))}</span><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-cm-thank="${i}">Thanked</button></div>`).join('');
  return `<div class="cm-left">
    ${d.instruction ? `<div class="wg-instr" role="note"><b>Instruction</b><span>${e(d.instruction.text)}</span></div>` : ''}
    ${owed ? `<div class="cm-sec"><h3>Gifts to thank</h3>${owed}</div>` : ''}
    <div class="cm-sec"><h3>The call</h3><ol class="wg-steps">${steps}</ol></div>
    <div class="cm-sec"><h3>Giving</h3><div class="wg-facts"><div><b>${f.short(g.lifetime)}</b><span>Lifetime, ${g.count.toLocaleString('en-US')} ${g.count === 1 ? 'gift' : 'gifts'}</span></div><div><b>${f.short(g.last12)}</b><span>12 months${g.prior12 ? ', ' + f.short(g.prior12) + ' before' : ''}</span></div><div><b>${g.last ? f.money(g.last.amount) : 'None'}</b><span>${g.last ? 'Last gift ' + e(f.fd(g.last.date, true)) : 'No gifts'}</span></div><div><b>${m ? f.money(m.amount) : 'None'}</b><span>Monthly</span></div></div></div>
    <div class="cm-sec"><h3>Last contacts</h3><ul class="wg-said">${notes}</ul></div>
  </div>`;
}

function rightHTML(st) {
  const f = F(); const e = f.esc;
  return `<div class="cm-right">
    <div class="cm-sec"><h3>How did it go</h3><div class="pp-seg" role="group" aria-label="Result">${OUTCOMES.map(([k, l]) => `<button type="button" class="${st.outcome === k ? 'is-on' : ''}" data-cm-out="${k}" aria-pressed="${st.outcome === k}">${l}</button>`).join('')}</div></div>
    <div class="cm-sec"><h3>What happened</h3>
      <textarea id="cm-say" rows="5" placeholder="Say it or type it. A prayer request, family news, what they plan to give.">${e(st.say)}</textarea>
      <div class="cm-tools">${st.canSpeak ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm${st.listening ? ' is-on' : ''}" data-cm-mic><svg class="h-i" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>${st.listening ? 'Stop listening' : 'Speak it'}</button>` : ''}<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-cm-write${st.say.trim().length < 3 || st.busy ? ' disabled' : ''}>${st.busy ? 'Writing it up' : 'Write it up'}</button></div>
    </div>
    ${st.summary !== null ? `<div class="cm-sec"><h3>What gets logged</h3><label class="cm-lab">Summary<input type="text" id="cm-sum" maxlength="140" value="${e(st.summary)}" /></label><label class="cm-lab">Notes<textarea id="cm-notes" rows="4">${e(st.notes)}</textarea></label>
      ${st.follow ? `<label class="wg-check"><input type="checkbox" id="cm-fu" ${st.followOn ? 'checked' : ''} /> ${e('Add a task: ' + st.follow.what + ' (in ' + st.follow.days + (st.follow.days === 1 ? ' day' : ' days') + ')')}</label>` : ''}</div>` : ''}
    <div class="cm-sec"><label class="wg-check"><input type="checkbox" id="cm-th" ${st.thanked ? 'checked' : ''} /> Tag it Thanked</label></div>
    ${st.error ? `<p class="cm-err">${e(st.error)}</p>` : ''}
    <button type="button" class="h-btn h-btn--primary cm-log" data-cm-log${st.saving ? ' disabled' : ''}>${st.saving ? 'Saving' : 'Log it'}</button>
  </div>`;
}

function draw(box, b, d, st) {
  const f = F(); const e = f.esc;
  const keepScroll = $('.cm-left', box) ? $('.cm-left', box).scrollTop : 0;
  const call = b.call && !b.flags.includes('Do not call') ? `<a class="cm-dial" href="${tel(b.call.number)}">${f.ic('phone')}Call <b>${e(b.call.number)}</b></a>` : `<span class="cm-dial is-off">${f.ic('phone')}${b.flags.includes('Do not call') ? 'Do not call' : 'No phone to call'}</span>`;
  box.innerHTML = `<div class="wg-dlg__head"><div><span class="wg-kick">Call mode · ${e(b.kind)}${b.since ? ' · Partner since ' + e(b.since) : ''}</span><h2>${e(b.name)}</h2><p>${e(b.place || 'No city on file')}</p></div><button type="button" class="pp-iconbtn" data-cm-x aria-label="Close">${f.ic('x')}</button></div>
    <div class="cm-bar">${call}${b.flags.length ? b.flags.map((x) => `<span class="wc-tag wc-tag--warn">${e(x)}</span>`).join('') : ''}</div>
    <div class="wg-dlg__body cm-grid">${leftHTML(b, d, st)}${rightHTML(st)}</div>`;
  const l = $('.cm-left', box); if (l) l.scrollTop = keepScroll;
}

async function logIt(cid, b, st) {
  const f = F();
  const C = await f.api('/api/work/codes').catch(() => ({ me: {}, types: {} }));
  let holder = '';
  try { const p = (await f.api('/api/work/partners/' + encodeURIComponent(cid))).partner; const h = (p.assignments || []).find((a) => a.current); holder = h ? String(h.fid) : ''; } catch (_) { /* the signed-in person's own id is used */ }
  const fid = holder || (C.me && C.me.fid) || '';
  const type = (fid && C.types && C.types[fid]) || (C.me && C.me.type) || 'RDD Action';
  const stamp = f.TODAY;
  const lead = st.outcome === 'left' ? 'Left a message. ' : st.outcome === 'none' ? 'Called, no answer. ' : '';
  const summary = (lead + (st.summary || '')).trim().slice(0, 255) || (st.outcome === 'none' ? 'Called, no answer' : 'Phone call');
  const set = { category: 'Phone call', type, date: stamp, summary, description: st.notes || '', fundraisers: fid ? [fid] : [], completed: true, status: 'Completed', direction: 'Outbound' };
  const tags = st.thanked ? { add: [{ category: 'Thanked' }] } : undefined;
  const out = await f.post('/api/work/batches', { req: f.reqId(), op: 'new', cids: [cid], set, tags });
  const ids = [];
  const run = async (batch) => {
    ids.push(batch.id);
    if (batch.run_when === 'tonight') return 'tonight';
    for (let i = 0; i < 40; i++) {
      const r = await f.post(`/api/work/batches/${batch.id}/run`);
      if (r.held === 'busy') { await sleep(1500); continue; }
      if (r.held) return r.held;
      if (!r.left) return '';
      await sleep(900);
    }
    return 'wait';
  };
  let held = await run(out.batch || {});
  if (st.follow && st.followOn) {
    const due = new Date(Date.parse(stamp + 'T12:00:00Z') + st.follow.days * 86400000).toISOString().slice(0, 10);
    const t = await f.post('/api/work/batches', { req: f.reqId(), op: 'new', cids: [cid], set: { category: 'Task/Other', type, date: due, summary: st.follow.what.slice(0, 255), fundraisers: fid ? [fid] : [], completed: false, status: 'Open' } });
    held = (await run(t.batch || {})) || held;
  }
  try {
    const recent = (await f.api('/api/work/recent')).batches || [];
    for (const r of recent) if (ids.includes(r.id)) { const bad = (r.items || []).find((x) => x.state === 'failed'); if (bad) throw new Error(bad.error || 'Blackbaud turned it down.'); }
  } catch (e) { if (e && e.message && !/recent/i.test(e.message)) throw e; }
  f.toast(held === 'tonight' ? 'Call logged. It goes to Blackbaud tonight.' : 'Call logged for ' + b.name + '.', ids);
  document.dispatchEvent(new CustomEvent('favor:call-logged', { detail: { cid, batches: ids } }));
}

async function open(cid, o = {}) {
  const f = F();
  if (!f || !cid) return;
  close(); f.closePop();
  layer = document.createElement('div');
  layer.className = 'wg-layer wg-prt cm-layer';
  layer.innerHTML = '<div class="wg-scrim" data-cm-x></div><div class="wg-dlg wg-dlg--wide wg-brief cm" role="dialog" aria-modal="true" aria-label="Call mode"><div class="wg-skel"><i style="width:30%"></i><i style="height:34px;width:60%"></i><i style="height:240px"></i></div></div>';
  document.body.appendChild(layer);
  document.documentElement.classList.add('wg-locked');
  document.addEventListener('keydown', onKey, true);
  const box = $('.wg-dlg', layer);
  let d;
  try { d = await f.api('/api/work/prep/' + encodeURIComponent(cid)); } catch (e) {
    box.innerHTML = `<div class="wg-dlg__head"><div><h2>${e.status === 404 ? 'No partner found' : 'Call mode did not load'}</h2><p>${f.esc(e.message)}</p></div><button type="button" class="pp-iconbtn" data-cm-x aria-label="Close">${f.ic('x')}</button></div>`;
    layer.addEventListener('click', (ev) => { if (ev.target.closest('[data-cm-x]')) close(); });
    return;
  }
  if (!layer) return;
  const b = d.brief;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const st = { outcome: 'talked', say: o.say || '', summary: null, notes: '', follow: null, followOn: true, thanked: !!(d.owedRows && d.owedRows.length), canSpeak: !!SR, listening: false, busy: false, saving: false, error: '' };
  const sync = () => { const s = $('#cm-say', box); if (s) st.say = s.value; const m = $('#cm-sum', box); if (m) st.summary = m.value; const n = $('#cm-notes', box); if (n) st.notes = n.value; const t = $('#cm-th', box); if (t) st.thanked = t.checked; const u = $('#cm-fu', box); if (u) st.followOn = u.checked; };
  const paint = () => draw(box, b, d, st);
  paint();
  layer.addEventListener('input', (ev) => { if (ev.target.id === 'cm-say') { st.say = ev.target.value; const w = $('[data-cm-write]', box); if (w) w.disabled = st.say.trim().length < 3 || st.busy; } });
  layer.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button'); if (!t) return;
    if (t.hasAttribute('data-cm-x')) { close(); return; }
    sync();
    if (t.dataset.cmOut) { st.outcome = t.dataset.cmOut; paint(); return; }
    if (t.dataset.cmThank != null) {
      const g = (d.owedRows || [])[Number(t.dataset.cmThank)];
      if (g) f.pop(t, { giftId: g.giftId, cid: g.cid, name: b.name, amount: g.amount, date: g.date, fund: g.fund, phone: b.call ? b.call.number : null, left: null, tasks: 0 }, { done: () => { d.owedRows = d.owedRows.filter((x) => x !== g); st.thanked = false; paint(); } });
      return;
    }
    if (t.hasAttribute('data-cm-mic')) {
      if (rec) { rec.stop(); return; }
      rec = new SR(); rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true;
      const base = st.say ? st.say.trim() + ' ' : '';
      rec.onresult = (r) => { let text = ''; for (let i = 0; i < r.results.length; i++) text += r.results[i][0].transcript; st.say = base + text; const s = $('#cm-say', box); if (s) s.value = st.say; const w = $('[data-cm-write]', box); if (w) w.disabled = st.say.trim().length < 3; };
      rec.onend = () => { rec = null; st.listening = false; if (layer) paint(); };
      rec.onerror = () => { rec = null; st.listening = false; st.error = 'The microphone is not available. Type it instead.'; if (layer) paint(); };
      st.listening = true; st.error = ''; rec.start(); paint();
      return;
    }
    if (t.hasAttribute('data-cm-write')) {
      st.busy = true; st.error = ''; paint();
      try {
        const r = await f.post('/api/brief/call-summary', { cid, transcript: st.say });
        st.summary = r.summary; st.notes = r.notes; st.follow = r.followUp; st.followOn = true;
      } catch (e) { st.error = e.message; }
      st.busy = false; if (layer) paint();
      return;
    }
    if (t.hasAttribute('data-cm-log')) {
      if (st.summary === null) st.summary = st.say.trim().slice(0, 140);
      if (!st.notes) st.notes = st.say.trim();
      st.saving = true; st.error = ''; paint();
      try { await logIt(cid, b, st); close(); if (o.done) o.done(); } catch (e) { st.saving = false; st.error = e.message || 'It was not saved. Try again.'; if (layer) paint(); }
    }
  });
}

window.FavorCall = { open, close };
})();
