/* Saved copies of the Work lists, so a page opens on the last list this person saw and the fresh list replaces it a moment later.
   A copy is used only for the person it was saved for, for at most 12 hours. Rows this person completed, moved or deleted since the
   copy was saved stay off it (the "gone" ledger), and a change that is undone leaves the ledger, so the row comes back at once.
   The ledger applies only to a copy. A fresh answer from the server already has every pending change laid over it. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.WCSnap = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const MAX_AGE = 12 * 3600 * 1000;
  const GONE_AGE = 15 * 60 * 1000;
  const store = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; } };
  const read = (k) => { const s = store(); if (!s) return null; try { return JSON.parse(s.getItem(k) || 'null'); } catch (_) { return null; } };
  const write = (k, v) => { const s = store(); if (!s) return; try { s.setItem(k, JSON.stringify(v)); } catch (_) { try { s.removeItem(k); } catch (__) { /* storage refused */ } } };

  function save(key, who, data, now) { write('wcsnap:' + key, { who: String(who || ''), at: now || Date.now(), data }); }
  function load(key, who, now) {
    const c = read('wcsnap:' + key);
    if (!c || !c.who || c.who !== String(who || '') || !c.data) return null;
    if ((now || Date.now()) - c.at > MAX_AGE) return null;
    return c.data;
  }
  function clear(key) { const s = store(); if (s) try { s.removeItem('wcsnap:' + key); } catch (_) { /* none */ } }

  /* The ledger: action id -> { b: batch id, at }. */
  const ledger = (now) => { const l = read('wcsnap:gone') || {}; const t = now || Date.now(); for (const id of Object.keys(l)) if (t - l[id].at > GONE_AGE) delete l[id]; return l; };
  function rememberGone(ids, batch, now) { const l = ledger(now); for (const id of ids) l[String(id)] = { b: batch || '', at: now || Date.now() }; write('wcsnap:gone', l); }
  function forgetBatch(batch, now) { const l = ledger(now); for (const id of Object.keys(l)) if (l[id].b === batch) delete l[id]; write('wcsnap:gone', l); }
  const goneIds = (now) => new Set(Object.keys(ledger(now)));
  /** The rows of a copy without the ones this person has since finished. idOf names the id of a row. */
  function withoutGone(rows, idOf, now) { const g = goneIds(now); return g.size ? rows.filter((r) => !g.has(String(idOf(r)))) : rows; }

  return { save, load, clear, rememberGone, forgetBatch, goneIds, withoutGone, MAX_AGE };
});
