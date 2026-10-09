/* Favor Brain page: ask the Brain right here, connect steps, the person's access and recent questions.
   Everything comes from /api/brain (the Brain's own rules). Admin lives on /brain/admin/. */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const et = (iso, opts) => new Date(iso).toLocaleString('en-US', Object.assign({ timeZone: 'America/New_York' }, opts));
  const when = (iso) => (iso ? et(iso, { month: 'short', day: 'numeric' }) + ', ' + et(iso, { hour: 'numeric', minute: '2-digit' }) : '');
  const day = (iso) => (iso ? et(iso, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
  const cue = (name) => document.dispatchEvent(new CustomEvent('favor:cue', { detail: name }));
  const svg = (d) => `<svg class="h-i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
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
      err.ref = d.ref;
      throw err;
    }
    return d;
  };
  // How each kind of call reads in a list: the question itself, or what the tool did.
  const TOOL = {
    ask: '', find_partner: 'Found a partner', partner_profile: 'Opened a partner', partner_list: 'Partner list', count_partners: 'Counted partners',
    giving_summary: 'Giving totals', gift_list: 'Gift list', team_numbers: 'Team numbers', actions: 'Actions', grant_opportunities: 'Grant opportunities',
    lookup: 'Looked up', search_knowledge: 'Searched the manuals', read_document: 'Read a manual section', my_day: 'My day', search_my_drive: 'Searched Drive',
    definitions: 'Definitions', request_access: 'Asked for access', whoami: 'Checked access', give_feedback: 'Sent feedback',
  };
  // Housekeeping calls stay out of the person's list of questions.
  const HIDE = /^(whoami|admin_|give_feedback$)/;
  const said = (r) => {
    if (r.tool === 'ask') return r.question || 'A question';
    const what = TOOL[r.tool] || r.tool.replace(/_/g, ' ');
    const detail = String(r.question || '').replace(/(limit|region|partner type|gift kind|compare last year|contacts): [^;]+;? ?/g, '').replace(/(query|question|team|id): /g, '').replace(/_/g, ' ').replace(/;\s*$/, '')
      .replace(/^(pc|rdd|ce|grants|marketing|executive)\b/, (t) => ({ pc: 'Partner Care', rdd: 'RDDs', ce: 'Church Engagement', grants: 'Grants', marketing: 'Marketing', executive: 'Executive' })[t]);
    return detail ? `${what}: ${detail}` : what;
  };
  const OUTCOME = (o) => {
    const k = String(o || '').split(':')[0];
    if (k === 'ok' || k === 'requested' || k === 'approved') return ['Answered', 'done'];
    if (k === 'clarify') return ['Asked back', 'wait'];
    if (k === 'denied') return ['Not in your access', 'declined'];
    if (k === 'refused') return ['Pointed elsewhere', 'wait'];
    if (k === 'feedback') return ['Feedback sent', 'done'];
    return ['Did not finish', 'declined'];
  };

  // ---- Answers, from the Brain's markdown ---------------------------------------------------
  const words = (s) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
      .replace(/(https?:\/\/[^\s<]+[^\s<).,;:])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  // [text](address) becomes a link: hub pages open here, anything else in a new tab.
  const inline = (s) =>
    String(s)
      .split(/(\[[^\]]+\]\((?:https?:\/\/|\/)[^)\s]*\))/)
      .map((part) => {
        const m = part.match(/^\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)\s]*)\)$/);
        if (!m) return words(part);
        const here = m[2].startsWith('/');
        return `<a href="${esc(m[2])}"${here ? '' : ' target="_blank" rel="noopener"'}>${esc(m[1])}</a>`;
      })
      .join('');
  const NUM = /^-?\$?[\d,]+(\.\d+)?%?$/;
  function tableHtml(rows) {
    const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const head = cells(rows[0]);
    const body = rows.slice(2).map(cells);
    const num = head.map((_, i) => body.length > 0 && body.every((r) => !r[i] || NUM.test(r[i])));
    const cap = (h) => h.charAt(0).toUpperCase() + h.slice(1);
    return `<div class="b-tablewrap"><table><thead><tr>${head.map((h, i) => `<th${num[i] ? ' class="is-num"' : ''}>${esc(cap(h))}</th>`).join('')}</tr></thead><tbody>${body
      .map((r) => `<tr>${head.map((_, i) => `<td${num[i] ? ' class="is-num"' : ''}>${/^https?:\/\/\S+$/.test(r[i] || '') ? `<a href="${esc(r[i])}" target="_blank" rel="noopener">Open</a>` : inline(r[i] || '')}</td>`).join('')}</tr>`)
      .join('')}</tbody></table></div>`;
  }
  function md(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const out = [];
    let para = [];
    const flush = () => {
      if (para.length) out.push(`<p>${para.map(inline).join(' ')}</p>`);
      para = [];
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*\|/.test(line)) {
        flush();
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
        i--;
        if (rows.length >= 2) out.push(tableHtml(rows));
      } else if (/^\s*[-*] /.test(line)) {
        flush();
        const items = [];
        while (i < lines.length && /^\s*[-*] /.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*] /, ''));
        i--;
        out.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`);
      } else if (/^#{1,4} /.test(line)) {
        flush();
        out.push(`<h3>${inline(line.replace(/^#+ /, ''))}</h3>`);
      } else if (!line.trim()) flush();
      else para.push(line.trim());
    }
    flush();
    // A lone number or amount at the very start reads big.
    return out.join('').replace(/^<p><strong>(-?\$?[\d,]+(?:\.\d+)?%?)<\/strong>(\s*)/, '<p><span class="b-big">$1</span>$2');
  }
  // Every download link in an answer becomes a button; the sentence that carried it goes.
  const DL_RE = /\s*(?:((?:The \d[\d,]* largest|All \d[\d,]*) gifts) behind it\. )?Download( the full list| the gifts| the numbers)?: (https:\/\/mcp\.favorintl\.org\/csv\/[a-z0-9]+\/[^\s)]+?\.csv)(?: \(works for 24 hours\))?\.?/g;
  function shape(d) {
    let text = String(d.text || '');
    const files = [];
    text = text.replace(DL_RE, (_, gifts, what, url) => {
      const label = gifts ? `Download ${gifts.replace(/^The /, 'the ').replace(/^All /, 'all ')}` : what === ' the gifts' ? 'Download the gifts' : what === ' the numbers' ? 'Download the numbers' : what === ' the full list' ? 'Download the list' : d.intent === 'list_gifts' ? 'Download the gifts' : 'Download the table';
      files.push({ url, label });
      return '';
    });
    text = text.replace(/\n*_How I read it: [\s\S]*?_\s*$/, '').trim();
    return { text, files };
  }
  // Next steps under the latest answer; each one is a follow-up on it.
  const NEXT = {
    count_partners: ['Only major partners', 'Only churches', 'Compared with last year'],
    list_partners: ['Only major partners', 'Sorted by largest gift', 'Only churches'],
    giving_total: ['Show me the gifts', 'By month', 'Compared with last year'],
    list_gifts: ['Only gifts of $1,000 or more', 'Only recurring gifts'],
  };

  // ---- The thread ---------------------------------------------------------------------------
  const KEY = 'favor.brain.thread';
  let thread = [];
  try {
    thread = JSON.parse(sessionStorage.getItem(KEY) || '[]');
  } catch {}
  const save = () => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(thread.slice(-30)));
    } catch {}
  };
  let me = null;
  let busy = false;
  const ICON_DL = '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>';
  const ICON_LINK = '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>';

  function answerHtml(e, latest) {
    const { text, files } = shape(e);
    const denied = e.outcome === 'denied' || e.outcome === 'error';
    const need = (String(e.reading || '').match(/needs the (\w+) package/) || [])[1];
    const canAsk = need && me && (me.packages || []).some((p) => p.key === need && !p.has && p.requestable);
    const rated = e.rated
      ? `<span class="b-told">${e.rated === 'right' ? 'Thanks. You said it was right' : 'Your note went to Will'}</span>`
      : e.ref && !denied
        ? `<span class="b-rate"><button type="button" class="b-rate__btn" data-right="${esc(e.ref)}">Right</button><button type="button" class="b-rate__btn" data-feedback="hub-brain" data-rating="wrong" data-ref="${esc(e.ref)}" data-question="${esc(e.q || '')}">Not right</button></span>`
        : '';
    // A next step already in the question ("only major partners" twice) is left off.
    const said = String(e.asked || e.q || '').toLowerCase();
    const next = (latest && !denied && e.outcome === 'ok' ? NEXT[e.intent] || [] : []).filter((n) => {
      const key = n.toLowerCase().replace(/^only /, '').replace(/s$/, '').split(' ')[0];
      return !(n.startsWith('Only') && said.includes(key)) && !(n.startsWith('Compared') && /compar/.test(said)) && !(n === 'By month' && /by month|monthly/.test(said));
    });
    return `<div class="b-msg-a${denied ? ' is-denied' : ''}" data-ref="${esc(e.ref || '')}">
      ${e.how && e.how !== 'new' && e.asked ? `<div class="b-asked">Read with your last question: <b>${esc(e.asked)}</b></div>` : ''}
      ${md(text)}
      ${files.length ? `<div class="b-dl">${files.map((f, i) => `<a class="h-btn ${i ? 'h-btn--ghost' : 'h-btn--primary'} h-btn--sm" href="${esc(f.url)}" download>${svg(ICON_DL)}${esc(f.label)}</a>`).join('')}<span>A CSV file that opens in Sheets or Excel. The link works for 24 hours.</span></div>` : ''}
      ${next.length ? `<div class="b-next"><span>Follow up</span>${next.map((n) => `<button type="button" class="b-q b-q--sm" data-q="${esc(n)}" data-follow="1">${esc(n)}</button>`).join('')}</div>` : ''}
      ${canAsk ? `<div class="b-dl"><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-askfor="${esc(need)}">Ask Will for access</button></div>` : ''}
      ${e.reading && !denied && e.outcome !== 'clarify' ? `<div class="b-read">How I read it: <b>${esc(e.reading)}</b></div>` : ''}
      ${e.ref || rated ? `<div class="b-afoot">${e.ref ? `<span>Answer ref ${esc(e.ref)}</span>` : ''}${rated}</div>` : ''}
    </div>`;
  }
  const NUDGE = `<div class="b-nudge" role="note">
      <span class="b-nudge__i">${svg(ICON_LINK)}</span>
      <b>We recommend your own Claude or ChatGPT app for this</b>
      <span>It can compare two lists, combine answers and follow up on anything you ask. You can keep asking here too. Connecting takes four steps.</span>
      <div class="b-nudge__go"><button type="button" class="h-btn h-btn--primary h-btn--sm" data-goconnect>Show me how to connect</button><a class="h-btn h-btn--ghost h-btn--sm" href="/help/connect-your-ai/">Step by step, with pictures</a></div>
    </div>`;

  function render() {
    const box = $('b-thread');
    const top = box.scrollTop;
    box.querySelectorAll('.b-msg-q, .b-msg-a, .b-nudge, .b-think').forEach((n) => n.remove());
    busy = false;
    $('b-start').hidden = thread.length > 0;
    $('b-clear').hidden = !thread.length;
    const lastA = thread.map((e) => e.kind).lastIndexOf('a');
    box.insertAdjacentHTML(
      'beforeend',
      thread.map((e, i) => (e.kind === 'q' ? `<div class="b-msg-q">${esc(e.q)}</div>` : e.kind === 'nudge' ? NUDGE : answerHtml(e, i === lastA))).join('')
    );
    $('b-input').placeholder = thread.length ? 'Ask a follow-up, or a new question' : 'Ask a question in plain words';
    box.scrollTop = top;
  }
  // The question a follow-up builds on: the last answer that went through.
  const previous = () => {
    for (let i = thread.length - 1; i >= 0; i--) {
      const e = thread[i];
      if (e.kind !== 'a') continue;
      return e.outcome === 'ok' ? e.asked || e.q : '';
    }
    return '';
  };

  async function ask(q) {
    q = String(q || '').trim();
    if (q.length < 2 || $('b-send').disabled) return;
    const box = $('b-thread');
    const prev = previous();
    thread.push({ kind: 'q', q });
    save();
    render();
    $('b-input').value = '';
    grow();
    $('b-send').disabled = true;
    busy = true;
    box.insertAdjacentHTML('beforeend', '<div class="b-think" role="status"><i></i><i></i><i></i>Reading your question</div>');
    box.scrollTop = box.scrollHeight;
    let entry;
    try {
      const d = await api('ask', prev ? { question: q, previous: prev } : { question: q });
      entry = { kind: 'a', q, text: d.text, reading: d.reading, outcome: d.outcome, ref: d.ref, intent: d.intent, asked: d.asked_as, how: d.follow_up };
      thread.push(entry);
      if (d.nudge) thread.push({ kind: 'nudge' });
      if (d.outcome === 'clarify') $('b-input').value = q;
      cue('droplet');
    } catch (err) {
      thread.push({ kind: 'a', q, text: err.message, outcome: 'error', ref: err.ref });
    }
    save();
    render();
    $('b-send').disabled = false;
    grow();
    const last = [...box.querySelectorAll('.b-msg-q')].pop();
    if (last) box.scrollTop = last.offsetTop - 12;
    $('b-input').focus({ preventScroll: true });
    load();
  }

  const grow = () => {
    const t = $('b-input');
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 168) + 'px';
  };
  $('b-input').addEventListener('input', grow);
  $('b-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      ask($('b-input').value);
    }
  });
  $('b-compose').addEventListener('submit', (e) => {
    e.preventDefault();
    ask($('b-input').value);
  });
  $('b-clear').addEventListener('click', () => {
    thread = [];
    save();
    render();
    $('b-input').focus();
  });

  // Clicks inside the thread: example questions, Right, connect, ask for access.
  document.addEventListener('click', async (e) => {
    const q = e.target.closest('.b-q');
    if (q) return ask(q.dataset.q);
    const go = e.target.closest('[data-goconnect]');
    if (go) {
      const c = $('connect');
      c.scrollIntoView({ behavior: 'smooth', block: 'center' });
      c.classList.remove('is-flash');
      void c.offsetWidth;
      c.classList.add('is-flash');
      return;
    }
    const af = e.target.closest('[data-askfor]');
    if (af) {
      $('b-ask-pkg').value = af.dataset.askfor;
      $('b-ask').hidden = false;
      $('b-ask-msg').textContent = '';
      $('b-ask').scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => $('b-ask-why').focus({ preventScroll: true }), 400);
      return;
    }
    const right = e.target.closest('[data-right]');
    if (!right) return;
    const ref = right.dataset.right;
    const holder = right.parentElement;
    holder.outerHTML = '<span class="b-told">Sending...</span>';
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'hub-brain', rating: 'right', ref, page: '/brain/' }),
      });
      if (!res.ok) throw new Error();
      thread.forEach((x) => x.ref === ref && (x.rated = 'right'));
      save();
      cue('droplet');
    } catch {}
    render();
    load();
  });
  // A note sent from the Not right form marks that answer and refreshes the list.
  document.addEventListener('favor:feedback-sent', (e) => {
    const ref = e.detail && e.detail.ref;
    if (!ref) return;
    thread.forEach((x) => x.ref === ref && (x.rated = e.detail.rating || 'wrong'));
    save();
    render();
    load();
  });

  // ---- Connect ------------------------------------------------------------------------------
  $('b-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('b-url').textContent.trim());
      $('b-copy').textContent = 'Copied';
      cue('droplet');
    } catch {
      const r = document.createRange();
      r.selectNodeContents($('b-url'));
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      $('b-copy').textContent = 'Press Ctrl C';
    }
    setTimeout(() => ($('b-copy').textContent = 'Copy'), 2000);
  });
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

  // ---- Access and recent questions ---------------------------------------------------------
  const EXAMPLES = {
    base: ['How is Favor doing this year against goal?', 'What counts as a LYBUNT partner?', 'How do I approve a gift batch?', 'What meetings do I have today?'],
    partners: ['How many active partners do we have in North Carolina?', 'List lapsed major partners in Texas with their largest gift', 'How much did we raise in September, by appeal category?', 'Show gifts of $5,000 or more this year'],
    rdd: ['Who are my LYBUNT partners?', "What's my portfolio total this year?"],
    pc: ['Which partners gave their first gift this month?', 'Which partners are ready to move to an RDD?'],
    ce: ['Which churches gave in the last 12 months?'],
    grants: ['What grants did we submit in the last 90 days?'],
  };

  function renderMe(d) {
    me = d;
    $('b-role').textContent = d.role || '';
    if (d.admin) $('b-adminlink').hidden = false;
    const pk = d.packages || [];
    $('b-pkgs').removeAttribute('aria-busy');
    $('b-pkgs').innerHTML = pk
      .filter((p) => p.key !== 'admin')
      .map(
        (p) => `<li class="${p.has ? 'is-on' : ''}">
          <span class="b-pkgs__mark" aria-hidden="true">${p.has ? '&#10003;' : ''}</span>
          <div><b>${esc(p.label)}</b><span>${esc(p.covers)}</span>${p.until ? `<em>Until ${esc(day(p.until))}</em>` : ''}</div>
          ${!p.has && p.requestable ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-askfor="${esc(p.key)}">Ask for it</button>` : ''}
        </li>`
      )
      .join('');
    const pending = (d.requests || []).filter((r) => r.status === 'pending');
    if (pending.length)
      $('b-pkgs').insertAdjacentHTML('beforeend', pending.map((r) => `<li class="b-pkgs__wait"><span class="h-status h-status--wait">Waiting for Will</span><div><b>${esc((pk.find((p) => p.key === r.package) || {}).label || r.package)}</b><span>Asked ${esc(when(r.at))}</span></div></li>`).join(''));
    $('b-ask-pkg').innerHTML = pk.filter((p) => !p.has && p.requestable).map((p) => `<option value="${esc(p.key)}">${esc(p.label)}</option>`).join('');

    if (!$('b-egs').dataset.done) {
      $('b-egs').dataset.done = '1';
      const has = (k) => pk.some((p) => p.key === k && p.has);
      const role = String(d.role || '').toLowerCase();
      let egs = [...EXAMPLES.base];
      if (has('partners')) egs = [...EXAMPLES.partners, ...egs];
      if (role.includes('rdd')) egs = [...EXAMPLES.rdd, ...egs];
      if (role.includes('partner care')) egs = [...EXAMPLES.pc, ...egs];
      if (role.includes('church')) egs = [...EXAMPLES.ce, ...egs];
      if (role.includes('grants')) egs = [...EXAMPLES.grants, ...egs];
      $('b-egs').innerHTML = egs.slice(0, 6).map((q) => `<li><button type="button" class="b-q" data-q="${esc(q)}">${esc(q)}</button></li>`).join('');
    }

    $('b-calls').textContent = d.calls ? `${d.calls.toLocaleString('en-US')} so far, here and from your AI` : '';
    const rec = (d.recent || []).filter((r) => !HIDE.test(r.tool));
    const told = {};
    (d.feedback || []).forEach((f) => {
      if (f.ref && !told[f.ref]) told[f.ref] = f;
    });
    const SAID = { right: 'You said it was right', wrong: 'You said it was wrong', missing: 'You said something was missing', confusing: 'You said it was confusing', idea: 'You sent an idea' };
    const rateOf = (r) => {
      if (!r.ref || !/^(ok|clarify)/.test(String(r.outcome || ''))) return '';
      const f = told[r.ref];
      if (f) return `<span class="b-told">${esc(SAID[f.rating] || 'You sent a note')}${f.reply ? ' · answered' : f.status === 'fixed' ? ' · fixed' : ''}</span>`;
      return `<span class="b-rate"><button type="button" class="b-rate__btn" data-right="${esc(r.ref)}" aria-label="This answer was right">Right</button><button type="button" class="b-rate__btn" data-feedback="hub-brain" data-rating="wrong" data-ref="${esc(r.ref)}" data-question="${esc(r.question || '')}" aria-label="This answer was not right">Not right</button></span>`;
    };
    const FIRST = 6;
    const shown = $('b-recent').dataset.all ? 15 : FIRST;
    $('b-more').hidden = rec.length <= FIRST || !!$('b-recent').dataset.all;
    $('b-more').textContent = `Show ${Math.min(15, rec.length) - FIRST} more`;
    $('b-more').onclick = () => {
      $('b-recent').dataset.all = '1';
      renderMe(d);
    };
    $('b-recent').innerHTML = rec.length
      ? rec
          .slice(0, shown)
          .map((r) => {
            const [label, cls] = OUTCOME(r.outcome);
            return `<li><div><b>${esc(said(r))}</b><span>${esc(when(r.at))}${r.ref && r.tool === 'ask' ? ` · ref ${esc(r.ref)}` : ''}</span></div><div class="b-recent__end"><span class="h-status h-status--${cls}">${label}</span>${rateOf(r)}</div></li>`;
          })
          .join('')
      : '<li class="b-empty">Nothing yet. Ask your first question above.</li>';
    if (!busy) render();
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
      cue('success');
      load();
    } catch (err) {
      $('b-ask-msg').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  // The admin link carries the count of requests waiting, from the sidebar's counts.
  const adminCount = (d) => {
    const n = Number(((d || {}).counts || {}).brainRequests) || 0;
    $('b-adminlink-n').hidden = !n;
    $('b-adminlink-n').textContent = String(n);
  };
  if (window.FAVOR_HUB) adminCount(window.FAVOR_HUB);
  document.addEventListener('favor-hub', (e) => adminCount(e.detail));

  function load() {
    api('me')
      .then(renderMe)
      .catch((err) => {
        $('b-pkgs').removeAttribute('aria-busy');
        $('b-pkgs').innerHTML = `<li class="b-empty">${esc(err.message)}</li>`;
        $('b-recent').innerHTML = '';
      });
  }
  render();
  load();
})();
