/* Favor brain page: connect steps, the person's access and recent questions, and Will's admin panel.
   Everything comes from /api/brain (the brain's own rules). */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const et = (iso, opts) => new Date(iso).toLocaleString('en-US', Object.assign({ timeZone: 'America/New_York' }, opts));
  const when = (iso) => (iso ? et(iso, { month: 'short', day: 'numeric' }) + ', ' + et(iso, { hour: 'numeric', minute: '2-digit' }) : '');
  const day = (iso) => (iso ? et(iso, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
  const api = async (path, body) => {
    const res = await fetch('/api/brain/' + path, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.ok === false) throw new Error(d.message || d.error || 'The brain did not answer (' + res.status + ').');
    return d;
  };
  const OUTCOME = (o) => {
    const k = String(o || '').split(':')[0];
    if (k === 'ok' || k === 'requested' || k === 'approved') return ['Answered', 'done'];
    if (k === 'clarify') return ['Asked back', 'wait'];
    if (k === 'denied') return ['Not in your access', 'declined'];
    if (k === 'refused') return ['Only reads', 'wait'];
    return ['Did not finish', 'declined'];
  };

  // Copy the address.
  $('b-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('b-url').textContent.trim());
      $('b-copy').textContent = 'Copied';
    } catch {
      const r = document.createRange();
      r.selectNodeContents($('b-url'));
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      $('b-copy').textContent = 'Press Ctrl C';
    }
    setTimeout(() => ($('b-copy').textContent = 'Copy'), 2000);
  });

  // Claude / ChatGPT steps.
  document.querySelectorAll('.b-tab').forEach((t) =>
    t.addEventListener('click', () => {
      document.querySelectorAll('.b-tab').forEach((x) => {
        const on = x === t;
        x.classList.toggle('is-on', on);
        x.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      document.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== t.dataset.tab));
    })
  );

  const EXAMPLES = {
    base: ['How is Favor doing this year against goal?', 'What counts as a LYBUNT partner?', 'How do I enter a check gift in a batch?', 'What meetings do I have today?'],
    partners: ['How many active partners do we have in North Carolina?', 'List lapsed major partners in Texas with their largest gift', 'How much did we raise in September, by appeal category?', 'Show gifts of $5,000 or more this year'],
    rdd: ['Who are my LYBUNT partners?', "What's my portfolio total this year?"],
    pc: ['Which partners gave their first gift this month?', 'Which partners are ready to move to an RDD?'],
    ce: ['Which churches gave in the last 12 months?'],
    grants: ['What grants did we submit in the last 90 days?'],
  };

  function renderMe(d) {
    $('b-role').textContent = d.role || '';
    const pk = d.packages || [];
    $('b-pkgs').removeAttribute('aria-busy');
    $('b-pkgs').innerHTML = pk
      .map(
        (p) => `<li class="${p.has ? 'is-on' : ''}">
          <span class="b-pkgs__mark" aria-hidden="true">${p.has ? '&#10003;' : ''}</span>
          <div><b>${esc(p.label)}</b><span>${esc(p.covers)}</span>${p.until ? `<em>Until ${esc(day(p.until))}</em>` : ''}</div>
          ${!p.has && p.requestable ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-ask="${esc(p.key)}">Ask for it</button>` : ''}
        </li>`
      )
      .join('');
    const pending = (d.requests || []).filter((r) => r.status === 'pending');
    if (pending.length)
      $('b-pkgs').insertAdjacentHTML('beforeend', pending.map((r) => `<li class="b-pkgs__wait"><span class="h-status h-status--wait">Waiting for Will</span><div><b>${esc((pk.find((p) => p.key === r.package) || {}).label || r.package)}</b><span>Asked ${esc(when(r.at))}</span></div></li>`).join(''));
    const sel = $('b-ask-pkg');
    sel.innerHTML = pk.filter((p) => !p.has && p.requestable).map((p) => `<option value="${esc(p.key)}">${esc(p.label)}</option>`).join('');
    document.querySelectorAll('[data-ask]').forEach((b) =>
      b.addEventListener('click', () => {
        sel.value = b.dataset.ask;
        $('b-ask').hidden = false;
        $('b-ask-msg').textContent = '';
        $('b-ask-why').focus();
      })
    );

    const has = (k) => pk.some((p) => p.key === k && p.has);
    const role = String(d.role || '').toLowerCase();
    let egs = [...EXAMPLES.base];
    if (has('partners')) egs = [...EXAMPLES.partners, ...egs];
    if (role.includes('rdd')) egs = [...EXAMPLES.rdd, ...egs];
    if (role.includes('partner care')) egs = [...EXAMPLES.pc, ...egs];
    if (role.includes('church')) egs = [...EXAMPLES.ce, ...egs];
    if (role.includes('grants')) egs = [...EXAMPLES.grants, ...egs];
    $('b-egs').innerHTML = egs.slice(0, 7).map((q) => `<li><span>"${esc(q)}"</span><button type="button" class="b-copy-q" data-q="${esc(q)}" aria-label="Copy this question">Copy</button></li>`).join('');
    document.querySelectorAll('.b-copy-q').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(b.dataset.q);
          b.textContent = 'Copied';
          setTimeout(() => (b.textContent = 'Copy'), 1500);
        } catch {}
      })
    );

    $('b-calls').textContent = d.calls ? `${d.calls.toLocaleString('en-US')} so far` : '';
    const rec = d.recent || [];
    $('b-recent').innerHTML = rec.length
      ? rec
          .slice(0, 10)
          .map((r) => {
            const [label, cls] = OUTCOME(r.outcome);
            return `<li><div><b>${esc(r.question || r.tool.replace(/_/g, ' '))}</b><span>${esc(when(r.at))}${r.tool !== 'ask' ? ' · ' + esc(r.tool.replace(/_/g, ' ')) : ''}</span></div><span class="h-status h-status--${cls}">${label}</span></li>`;
          })
          .join('')
      : '<li class="b-empty">Nothing yet. Connect Claude or ChatGPT and ask your first question.</li>';
    if (d.admin) loadAdmin();
  }

  $('b-ask-cancel').addEventListener('click', () => ($('b-ask').hidden = true));
  $('b-ask').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter || $('b-ask').querySelector('[type=submit]');
    btn.disabled = true;
    $('b-ask-msg').textContent = 'Sending...';
    try {
      await api('request', { package: $('b-ask-pkg').value, reason: $('b-ask-why').value, days: Number($('b-ask-days').value) });
      $('b-ask').hidden = true;
      $('b-ask-why').value = '';
      load();
    } catch (err) {
      $('b-ask-msg').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  // ---- Admin -------------------------------------------------------------------------------
  let labels = {};
  async function loadAdmin() {
    $('admin').hidden = false;
    let d;
    try {
      d = await api('admin/overview');
    } catch (err) {
      $('a-pending').innerHTML = `<li class="b-empty">${esc(err.message)}</li>`;
      return;
    }
    labels = d.packages || {};
    $('a-pkg').innerHTML = Object.entries(labels).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
    $('a-people').innerHTML = (d.people || []).map((p) => `<option value="${esc(p.email)}">`).join('');
    $('a-pending-n').textContent = d.pending.length ? `${d.pending.length} waiting` : '';
    $('a-pending').innerHTML = d.pending.length
      ? d.pending
          .map(
            (r) => `<li class="b-req"><div><b>${esc(r.name || r.email)}</b><span>${esc(labels[r.package] || r.package)} for ${esc(r.days)} days · ${esc(when(r.at))}</span><q>${esc(r.reason || '')}</q></div>
            <div class="b-req__go"><button type="button" class="h-btn h-btn--primary h-btn--sm" data-decide="${r.id}" data-ok="1">Approve</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-decide="${r.id}" data-ok="0">Decline</button></div></li>`
          )
          .join('')
      : '<li class="b-empty">No requests waiting.</li>';
    document.querySelectorAll('[data-decide]').forEach((b) =>
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await api('admin/decide', { id: Number(b.dataset.decide), approve: b.dataset.ok === '1' });
          loadAdmin();
        } catch (err) {
          alert(err.message);
          b.disabled = false;
        }
      })
    );
    $('a-people-t').innerHTML =
      '<thead><tr><th>Person</th><th>Role</th><th>Access</th><th>Questions, 30 days</th><th>Last</th></tr></thead><tbody>' +
      (d.people || [])
        .map(
          (p) => `<tr><td><b>${esc(p.email.split('@')[0])}</b></td><td>${esc(p.role)}</td><td>${p.packages
            .filter((k) => k !== 'basics')
            .map((k) => `<span class="h-chip${p.changed ? ' b-chip--changed' : ''}">${esc(labels[k] || k)}</span>`)
            .join(' ') || '<span class="b-muted">Basics</span>'}</td><td>${p.calls30 || ''}</td><td>${esc(when(p.last))}</td></tr>`
        )
        .join('') +
      '</tbody>';
    $('a-recent').innerHTML =
      '<thead><tr><th>When</th><th>Who</th><th>Question</th><th>Result</th><th>Rows</th></tr></thead><tbody>' +
      (d.recent || [])
        .map((r) => {
          const [label, cls] = OUTCOME(r.outcome);
          return `<tr><td>${esc(when(r.at))}</td><td>${esc(r.email.split('@')[0])}</td><td><b>${esc(r.question || r.tool.replace(/_/g, ' '))}</b>${r.reading ? `<span>${esc(r.reading)}</span>` : ''}</td><td><span class="h-status h-status--${cls}">${label}</span></td><td>${r.rows || ''}</td></tr>`;
        })
        .join('') +
      '</tbody>';
    if (location.hash === '#admin') $('admin').scrollIntoView({ block: 'start' });
  }

  $('a-grant').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('a-grant-msg').textContent = 'Saving...';
    try {
      await api('admin/grant', { email: $('a-email').value.trim(), package: $('a-pkg').value, effect: $('a-effect').value, days: Number($('a-days').value) });
      $('a-grant-msg').textContent = 'Saved. It applies to their next question.';
      loadAdmin();
    } catch (err) {
      $('a-grant-msg').textContent = err.message;
    }
  });

  function load() {
    api('me')
      .then(renderMe)
      .catch((err) => {
        $('b-pkgs').removeAttribute('aria-busy');
        $('b-pkgs').innerHTML = `<li class="b-empty">${esc(err.message)}</li>`;
        $('b-recent').innerHTML = '';
      });
  }
  load();
})();
