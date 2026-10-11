/* Snooze on Today. Each Needs you card and each Blackbaud action has a clock button that opens a small menu:
   Tomorrow, Next week, or Pick a date. A Blackbaud action moves its due date in Blackbaud through the Work Center's
   own write path (one batch, sent and checked, Undo open for 24 hours). A Needs you card is hidden on the hub until its
   day (hub_snoozes). The page listens for hub:snoozed to refresh the cards. */
(() => {
  const TZ = 'America/New_York';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const addDays = (day, n) => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  };
  const dayLabel = (day) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  const shortLabel = (day) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reqId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2));

  async function post(path, body) {
    const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    if (res.status === 401) {
      location.href = '/login/?next=' + encodeURIComponent(location.pathname + location.search);
      throw new Error('Sign in again.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const err = new Error(data.message || 'Something went wrong. Try again.');
      err.code = data.error;
      throw err;
    }
    return data;
  }

  // Send a batch the way the Work Center does: run chunks until nothing is left. Returns why it stopped early, if it did.
  async function drive(bid) {
    for (let i = 0; i < 60; i++) {
      const r = await post(`/api/work/batches/${bid}/run`);
      if (r.held === 'busy') {
        await sleep(1500);
        continue;
      }
      if (r.held) return r.held;
      if (!r.left) return '';
      const sent = (r.items || []).some((it) => it.state === 'posted' || it.state === 'failed');
      await sleep(sent ? 0 : 2000);
    }
    return 'wait';
  }

  // Toast with an optional Undo. Undo runs once; the toast then says so.
  let tt = null;
  function toast(msg, undo) {
    let el = document.getElementById('snz-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'snz-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button" class="snz-undo">Undo</button>' : ''}`;
    el.hidden = false;
    clearTimeout(tt);
    tt = setTimeout(() => (el.hidden = true), undo ? 12000 : 6000);
    const btn = el.querySelector('.snz-undo');
    if (btn) {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Undoing';
        try {
          await undo();
        } catch (e) {
          toast(e.message || 'Could not undo. Try again.');
        }
      });
    }
  }

  // The chip on a Blackbaud row shows the new due date, with a Moved state, until the next full load of Today.
  const rowOf = (id) => document.querySelector(`[data-row="${CSS.escape(String(id))}"]`);
  function setChip(id, text, moved) {
    const row = rowOf(id);
    if (!row) return;
    const chip = row.querySelector('[data-chip]');
    if (chip && text) chip.textContent = text;
    row.classList.toggle('is-moved', !!moved);
  }

  async function snoozeAction(item, pick, due) {
    const saved = await post('/api/work/batches', Object.assign({ op: 'reschedule', ids: [item.id], req: reqId() }, pick));
    const bid = saved.batch && saved.batch.id;
    if (!bid) throw new Error('That action was already moved. Reload Today to see it.');
    if (saved.changed) throw new Error('Blackbaud changed that action since Today loaded. Reload to see it.');
    const prev = (rowOf(item.id)?.querySelector('[data-chip]') || {}).textContent || '';
    const held = await drive(bid);
    setChip(item.id, shortLabel(due), true);
    const when = `Moved to ${dayLabel(due)}.`;
    if (held === 'wait') toast('Blackbaud is not taking changes right now. The move is saved and will go through.');
    else if (held) toast(`${when} It goes to Blackbaud when the send window opens.`);
    else
      toast(when, async () => {
        const out = await post(`/api/work/batches/${bid}/undo`);
        if (out.batch && out.batch.id) await drive(out.batch.id);
        setChip(item.id, prev, false);
        toast('Undone.');
      });
  }

  async function snoozeCard(item, until) {
    await post('/api/hub/snooze', { key: item.id, until });
    document.dispatchEvent(new CustomEvent('hub:snoozed', { detail: { kind: 'hub', id: item.id } }));
    toast(`Hidden until ${dayLabel(until)}.`, async () => {
      await post('/api/hub/snooze', { key: item.id, until: null });
      document.dispatchEvent(new CustomEvent('hub:snoozed', { detail: { kind: 'hub', id: item.id } }));
      toast('Back on Today.');
    });
  }

  let menu = null;
  let trigger = null;
  function closeMenu(returnFocus) {
    if (menu) menu.remove();
    menu = null;
    if (returnFocus && trigger) trigger.focus();
    trigger = null;
  }

  async function choose(item, days, due) {
    closeMenu(false);
    try {
      if (item.kind === 'bb') await snoozeAction(item, days != null ? { by: days } : { due }, due);
      else await snoozeCard(item, due);
    } catch (e) {
      toast(e.message || 'Could not snooze. Nothing was changed.');
    }
  }

  function openMenu(btn) {
    closeMenu(false);
    trigger = btn;
    const item = { kind: btn.dataset.snooze, id: btn.dataset.snoozeId, label: btn.dataset.snoozeLabel || 'this item' };
    const t = today();
    const tomorrow = addDays(t, 1);
    const nextWeek = addDays(t, 7);
    menu = document.createElement('div');
    menu.className = 'snz-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', `Snooze ${item.label}`);
    menu.innerHTML = `
      <button type="button" data-days="1">Tomorrow <small>${esc(dayLabel(tomorrow))}</small></button>
      <button type="button" data-days="7">Next week <small>${esc(dayLabel(nextWeek))}</small></button>
      <button type="button" data-pick="1" aria-expanded="false">Pick a date</button>
      <form class="snz-pick" hidden>
        <input type="date" name="due" min="${tomorrow}" max="${addDays(t, 730)}" value="${nextWeek}" aria-label="Snooze until this day" required>
        <button type="submit" class="h-btn h-btn--primary h-btn--sm">Snooze</button>
      </form>`;
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    const h = menu.offsetHeight;
    const width = 232;
    menu.style.left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)) + 'px';
    menu.style.top = (r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
    menu.querySelector('[data-days]').focus();

    menu.addEventListener('click', (e) => {
      const go = e.target.closest('[data-days]');
      if (go) return choose(item, Number(go.dataset.days), addDays(t, Number(go.dataset.days)));
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        const form = menu.querySelector('.snz-pick');
        form.hidden = false;
        pick.setAttribute('aria-expanded', 'true');
        form.querySelector('input').focus();
      }
    });
    menu.querySelector('.snz-pick').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = e.target.querySelector('input').value;
      if (!v || v < tomorrow || v > addDays(t, 730)) return toast('Pick a day after today.');
      choose(item, null, v);
    });
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('[data-snooze]');
    if (btn) {
      e.preventDefault();
      if (menu && trigger === btn) closeMenu(true);
      else openMenu(btn);
      return;
    }
    if (menu && !e.target.closest('.snz-menu')) closeMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu) closeMenu(true);
  });
  // The clock button used in both lists.
  window.hubSnoozeButton = (kind, id, label, extra) =>
    `<button type="button" class="r2t-snz${extra ? ' ' + extra : ''}" data-snooze="${esc(kind)}" data-snooze-id="${esc(id)}" data-snooze-label="${esc(label)}" aria-label="Snooze ${esc(label)}" title="Snooze" aria-haspopup="dialog"><svg class="h-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg></button>`;
})();
