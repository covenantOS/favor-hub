/* Where the Work Center opens for each person (Group 0, round 3): a tab and what Open actions shows. The pill in the intro row opens
   the panel. Reads and writes /api/work/views/default. Registry in work-tabs.js. */
(function () {
  'use strict';
  const W = () => window.WC;
  const ST = { pref: null, defaultTab: 'open', role: '', loaded: false };
  const SCOPES = [['mine', 'Mine'], ['partners', 'On my partners'], ['all', 'Everyone']];

  const tabLabel = (id) => { const t = window.WCTabs && window.WCTabs.get(id); return t ? t.label : 'Open actions'; };
  function startTab() {
    const me = W().DATA.me, T = window.WCTabs;
    if (ST.pref && T.has(ST.pref.tab, me)) return ST.pref.tab;
    if (T.has(ST.defaultTab, me)) return ST.defaultTab;
    return 'open';
  }
  // The scope Open actions starts on: the saved one, else Mine for someone with a fundraiser id, else Everyone.
  const startScope = () => (ST.pref && ST.pref.scope) || (W().DATA.me.fid ? 'mine' : 'all');

  function applyScope(scope) {
    const wc = W(), f = wc.S.f, fid = wc.DATA.me.fid;
    f.scope = '';
    if (scope === 'mine' && fid) { f.fr = fid; f.theirs = false; }
    else if (scope === 'partners' && fid) { f.fr = ''; f.theirs = false; f.scope = 'partners'; }
    else if (scope === 'all') { f.fr = ''; f.theirs = false; }
  }

  async function load() {
    try { const r = await W().api('/api/work/views/default'); ST.pref = r.start.pref; ST.defaultTab = r.start.defaultTab; ST.role = r.start.role; }
    catch (_) { ST.pref = null; }
    ST.loaded = true;
  }
  // Called by work.js once the lists are in: pick the opening tab and scope, unless the address names a tab or a saved view opens first.
  async function apply() {
    const wc = W();
    if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
    await load();
    if (new URLSearchParams(location.search).get('view')) return;
    const savedFirst = !!(window.WCEdit && window.WCEdit._E && (window.WCEdit._E.views || []).some((v) => v.default));
    if (ST.pref || !savedFirst) {
      wc.S.view = startTab();
      if (ST.pref && ST.pref.scope) applyScope(ST.pref.scope);
    }
  }

  async function save(tab, scope) {
    const r = await W().api('/api/work/views/default', { method: 'PUT', body: JSON.stringify({ tab, scope }) });
    ST.pref = r.start.pref; ST.defaultTab = r.start.defaultTab;
  }

  function pill() {
    return `<button type="button" class="wc-pill wc-pill--btn wc-start" data-startpill aria-haspopup="dialog">${W().ic('task')}Opens on <b>${W().esc(tabLabel(startTab()))}</b></button>`;
  }
  function panel() {
    const wc = W(), me = wc.DATA.me, tabs = window.WCTabs.list(me);
    const cur = startTab(), sc = startScope();
    const opts = (name, rows, on) => rows.map(([v, l]) => `<label class="wc-startopt"><input type="radio" name="${name}" value="${wc.esc(v)}"${v === on ? ' checked' : ''} /><span>${wc.esc(l)}</span></label>`).join('');
    wc.dialog(`<div class="wc-dlg__head"><div><span class="h-label">Start view</span><h2>Where the Work Center opens</h2></div><button class="wc-dlg__x" data-closelayer aria-label="Close">${wc.ic('x')}</button></div>
      <div class="wc-dlg__body wc-startpanel">
        <fieldset><legend>Open on</legend><div class="wc-startpanel__opts">${opts('tab', tabs.map((t) => [t.id, t.label]), cur)}</div></fieldset>
        ${me.fid ? `<fieldset><legend>Open actions shows</legend><div class="wc-startpanel__opts">${opts('scope', SCOPES, sc)}</div></fieldset>` : ''}
      </div>
      <div class="wc-dlg__foot"><button type="button" class="h-btn h-btn--ghost" data-startreset>Use the default</button><button type="button" class="h-btn h-btn--primary" data-startsave>Save</button></div>`);
  }

  document.addEventListener('click', async (e) => {
    const t = e.target.closest && e.target.closest('[data-startpill],[data-startsave],[data-startreset],[data-scopestart]');
    if (!t || !W()) return;
    const wc = W();
    if (t.hasAttribute('data-startpill')) { if (!ST.loaded) await load(); panel(); return; }
    try {
      if (t.hasAttribute('data-startsave')) {
        const dlg = t.closest('.wc-dlg');
        const tab = (dlg.querySelector('input[name=tab]:checked') || {}).value || 'open';
        const sc = dlg.querySelector('input[name=scope]:checked');
        await save(tab, sc ? sc.value : '');
        wc.closeLayer(); wc.toast('The Work Center opens on ' + tabLabel(tab) + '.'); wc.render();
      } else if (t.hasAttribute('data-startreset')) {
        await wc.api('/api/work/views/default', { method: 'PUT', body: JSON.stringify({ reset: true }) });
        ST.pref = null; wc.closeLayer(); wc.toast('The Work Center opens on ' + tabLabel(startTab()) + '.'); wc.render();
      } else if (t.hasAttribute('data-scopestart')) {
        e.stopPropagation();
        await save(ST.pref ? ST.pref.tab : startTab(), t.dataset.scopestart);
        wc.toast('Open actions starts on ' + SCOPES.find((s) => s[0] === t.dataset.scopestart)[1] + '.'); wc.render();
      }
    } catch (er) { wc.toast(er.message); }
  });

  window.WCStart = { apply, pill, startTab, startScope, applyScope, scopes: SCOPES };
})();
