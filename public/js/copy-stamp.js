/* "As of" stamps for numbers that come from the Blackbaud copy. Any element with data-copy-stamp gets
   the copy's last complete sync time, in Eastern. A copy more than 26 hours old turns the stamp amber.
   An element may carry data-iso to use a time the page already has. Elements added later are stamped too. */
(() => {
  const ET = { timeZone: 'America/New_York' };
  const OLD_MS = 26 * 60 * 60 * 1000;
  let iso = null;
  let asking = null;

  function format(at) {
    const d = new Date(at);
    if (isNaN(d.getTime())) return null;
    const dayOf = (x) => x.toLocaleDateString('en-CA', ET);
    const time = d.toLocaleTimeString('en-US', Object.assign({ hour: 'numeric', minute: '2-digit' }, ET));
    const when = dayOf(d) === dayOf(new Date()) ? time : d.toLocaleDateString('en-US', Object.assign({ month: 'short', day: 'numeric' }, ET)) + ', ' + time;
    return { label: 'As of ' + when, old: Date.now() - d.getTime() > OLD_MS };
  }

  function ask() {
    if (!asking) {
      asking = fetch('/api/hub/copy-time', { credentials: 'same-origin' })
        .then((r) => r.json())
        .then((d) => (d && d.ok && d.synced ? d.synced : ''))
        .catch(() => '')
        .then((v) => {
          iso = v;
          paintAll(document);
        });
    }
  }

  function paintEl(el) {
    const at = el.dataset.iso || iso;
    if (at === null) return ask();
    const t = at ? format(at) : null;
    if (!t) {
      el.hidden = true;
      return;
    }
    el.textContent = t.label;
    el.classList.toggle('is-old', t.old);
    el.title = t.old
      ? 'The Blackbaud copy has not finished a full sync in over 26 hours, so these numbers may be behind.'
      : 'Numbers from the Blackbaud copy, as of its last complete sync.';
    el.hidden = false;
  }

  function paintAll(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('[data-copy-stamp]').forEach(paintEl);
  }

  if (document.body) {
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.matches && n.matches('[data-copy-stamp]')) paintEl(n);
          else paintAll(n);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
  paintAll(document);

  window.CopyStamp = { format, paintAll };
})();
