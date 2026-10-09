/* Brain admin: access requests, who sees what, and every question asked. Data from /api/brain/admin/*;
   the Brain checks the admin's email on every call. */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const et = (iso, opts) => new Date(iso).toLocaleString('en-US', Object.assign({ timeZone: 'America/New_York' }, opts));
  const when = (iso) => (iso ? et(iso, { month: 'short', day: 'numeric' }) + ', ' + et(iso, { hour: 'numeric', minute: '2-digit' }) : '');
  const api = async (path, body) => {
    const res = await fetch('/api/brain/' + path, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.ok === false) {
      const err = new Error(d.message || d.error || 'The Brain did not answer (' + res.status + ').');
      err.code = d.error;
      throw err;
    }
    return d;
  };
  const TOOL = {
    ask: '', find_partner: 'Found a partner', partner_profile: 'Opened a partner', partner_list: 'Partner list', count_partners: 'Counted partners',
    giving_summary: 'Giving totals', gift_list: 'Gift list', team_numbers: 'Team numbers', actions: 'Actions', grant_opportunities: 'Grant opportunities',
    lookup: 'Looked up', search_knowledge: 'Searched the manuals', read_document: 'Read a manual section', my_day: 'My day', search_my_drive: 'Searched Drive',
    definitions: 'Definitions', request_access: 'Asked for access', whoami: 'Checked access', give_feedback: 'Sent feedback',
  };
  const said = (r) => {
    let what = r.tool === 'ask' ? r.question || 'A question' : TOOL[r.tool] || r.tool.replace(/_/g, ' ');
    if (r.tool !== 'ask' && r.question) what += ': ' + String(r.question).replace(/_/g, ' ');
    return what;
  };
  const OUTCOME = (o) => {
    const k = String(o || '').split(':')[0];
    if (k === 'ok' || k === 'requested' || k === 'approved') return ['Answered', 'done'];
    if (k === 'clarify') return ['Asked back', 'wait'];
    if (k === 'denied') return ['Not in their access', 'declined'];
    if (k === 'refused') return ['Pointed elsewhere', 'wait'];
    if (k === 'feedback') return ['Feedback sent', 'done'];
    return ['Did not finish', 'declined'];
  };
  const via = (r) => {
    try {
      return JSON.parse(r.args || '{}').via === 'hub' ? 'On the hub' : 'From their AI';
    } catch {
      return '';
    }
  };

  document.querySelectorAll('[data-atab]').forEach((t) =>
    t.addEventListener('click', () => {
      document.querySelectorAll('[data-atab]').forEach((x) => {
        const on = x === t;
        x.classList.toggle('is-on', on);
        x.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      document.querySelectorAll('[data-apanel]').forEach((p) => (p.hidden = p.dataset.apanel !== t.dataset.atab));
      history.replaceState(null, '', '#' + t.dataset.atab);
    })
  );
  const start = location.hash.replace('#', '');
  if (start) {
    const t = document.querySelector(`[data-atab="${start}"]`);
    if (t) t.click();
  }
  $('a-find').addEventListener('input', () => {
    const q = $('a-find').value.trim().toLowerCase();
    document.querySelectorAll('#a-people-t tbody tr').forEach((tr) => (tr.hidden = !!q && !tr.textContent.toLowerCase().includes(q)));
  });

  let labels = {};
  let activityShown = 20;
  async function load() {
    let d;
    try {
      d = await api('admin/overview');
    } catch (err) {
      if (err.code === 'admin_only') {
        document.querySelectorAll('.ba-stats, [data-apanel], .b-atabs').forEach((n) => (n.hidden = true));
        $('a-denied').hidden = false;
        return;
      }
      $('a-pending').innerHTML = `<li class="b-empty">${esc(err.message)}</li>`;
      return;
    }
    labels = d.packages || {};
    const people = d.people || [];
    const activity = (d.recent || []).filter((r) => !/^admin_/.test(r.tool));
    $('a-stats').removeAttribute('aria-busy');
    $('s-pending').textContent = String(d.pending.length);
    $('s-calls').textContent = people.reduce((n, p) => n + (Number(p.calls30) || 0), 0).toLocaleString('en-US');
    $('s-people').textContent = String(people.filter((p) => p.calls30 > 0).length);
    const miss = activity.filter((r) => /^(error|denied)/.test(String(r.outcome || ''))).length;
    $('s-miss').textContent = activity.length ? Math.round((miss / activity.length) * 100) + '%' : '0%';

    $('a-pkg').innerHTML = Object.entries(labels).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
    $('a-people').innerHTML = people.map((p) => `<option value="${esc(p.email)}">`).join('');
    $('a-pending-n').textContent = d.pending.length ? String(d.pending.length) : '';
    $('a-people-n').textContent = people.length ? String(people.length) : '';
    $('a-pending').innerHTML = d.pending.length
      ? d.pending
          .map(
            (r) => `<li class="b-req"><div><b>${esc(r.name || r.email)}</b><span>${esc(labels[r.package] || r.package)} for ${esc(r.days)} days · ${esc(when(r.at))}</span><q>${esc(r.reason || '')}</q></div>
            <div class="b-req__go"><button type="button" class="h-btn h-btn--primary h-btn--sm" data-decide="${r.id}" data-ok="1">Approve</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-decide="${r.id}" data-ok="0">Decline</button></div></li>`
          )
          .join('')
      : '<li class="b-empty">No requests waiting.</li>';
    $('a-decided').innerHTML = (d.decided || []).length
      ? d.decided
          .slice(0, 8)
          .map(
            (r) => `<li><div><b>${esc(r.email.split('@')[0])}</b><span>${esc(labels[r.package] || r.package)} · ${esc(when(r.decided_at))}</span></div><span class="h-status h-status--${r.status === 'approved' ? 'done' : 'declined'}">${r.status === 'approved' ? 'Approved' : 'Declined'}</span></li>`
          )
          .join('')
      : '<li class="b-empty">Nothing decided yet.</li>';
    document.querySelectorAll('[data-decide]').forEach((b) =>
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await api('admin/decide', { id: Number(b.dataset.decide), approve: b.dataset.ok === '1' });
          document.dispatchEvent(new CustomEvent('favor:cue', { detail: 'success' }));
          load();
        } catch (err) {
          alert(err.message);
          b.disabled = false;
        }
      })
    );
    $('a-people-t').innerHTML =
      '<thead><tr><th>Person</th><th>Role</th><th>Access</th><th>Calls, 30 days</th><th>Last</th></tr></thead><tbody>' +
      people
        .map(
          (p) => `<tr><td><b>${esc(p.email.split('@')[0])}</b></td><td>${esc(p.role)}</td><td>${p.packages
            .filter((k) => k !== 'basics')
            .map((k) => `<span class="h-chip${p.changed ? ' b-chip--changed' : ''}">${esc(labels[k] || k)}</span>`)
            .join(' ') || '<span class="b-muted">Basics</span>'}</td><td>${p.calls30 || ''}</td><td>${esc(when(p.last))}</td></tr>`
        )
        .join('') +
      '</tbody>';
    $('a-more').hidden = activity.length <= activityShown;
    $('a-more').textContent = `Show ${Math.min(20, activity.length - activityShown)} more`;
    $('a-more').onclick = () => {
      activityShown += 20;
      load();
    };
    $('a-recent').innerHTML =
      '<thead><tr><th>When</th><th>Who</th><th>Question</th><th>Result</th><th>Rows</th></tr></thead><tbody>' +
      activity
        .slice(0, activityShown)
        .map((r) => {
          const [label, cls] = OUTCOME(r.outcome);
          const where = r.tool === 'ask' ? via(r) : '';
          return `<tr><td>${esc(when(r.at))}${where ? `<span>${esc(where)}</span>` : ''}</td><td>${esc(r.email.split('@')[0])}</td><td><b>${esc(said(r))}</b>${r.reading ? `<span>${esc(r.reading)}</span>` : ''}</td><td><span class="h-status h-status--${cls}">${label}</span></td><td>${r.rows || ''}</td></tr>`;
        })
        .join('') +
      '</tbody>';
  }

  $('a-grant').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('a-grant-msg').textContent = 'Saving...';
    try {
      await api('admin/grant', { email: $('a-email').value.trim(), package: $('a-pkg').value, effect: $('a-effect').value, days: Number($('a-days').value) });
      $('a-grant-msg').textContent = 'Saved. It applies to their next question.';
      load();
    } catch (err) {
      $('a-grant-msg').textContent = err.message;
    }
  });
  load();
})();
