(() => {
  const form = document.getElementById('req-form');
  const msg = document.getElementById('req-msg');
  const submitBtn = document.getElementById('req-submit');
  const nextBtn = document.getElementById('req-next');
  const backBtn = document.getElementById('req-back');
  const drop = document.getElementById('req-drop');
  const fileInput = document.getElementById('req-files');
  const previews = document.getElementById('req-previews');
  const done = document.getElementById('req-done');
  const again = document.getElementById('req-again');
  const stepLabel = document.getElementById('make-step-label');
  const review = document.getElementById('make-review');
  const locLabel = document.getElementById('loc-label');
  const locInput = document.getElementById('loc-input');
  const dateWrap = document.getElementById('needed-date-wrap');
  const changeFields = document.getElementById('change-fields');
  const addFields = document.getElementById('add-fields');
  if (!form) return;

  const STEPS = 4;
  let step = 1;
  let files = [];

  const KIND = {
    change: 'Change something',
    add: 'Add something new',
    other: 'Other',
  };

  const LOC = {
    change: {
      website: { label: 'Page or URL (optional)', placeholder: 'Give page, or skip if you do not know' },
      portal: { label: 'Portal page (optional)', placeholder: 'Giving, or skip' },
      dashboard: { label: 'Hub screen (optional)', placeholder: 'Tools grid, or skip' },
      app: { label: 'Which screen (optional)', placeholder: 'Name the screen, or skip' },
    },
    add: {
      website: { label: 'Where should it live (optional)', placeholder: 'Careers page, or skip' },
      portal: { label: 'Where should it live (optional)', placeholder: 'A portal page, or skip' },
      dashboard: { label: 'Where should it live (optional)', placeholder: 'A hub screen, or skip' },
      app: { label: 'Where should it live (optional)', placeholder: 'Name the screen, or skip' },
    },
    other: {
      website: { label: 'Where, if you know (optional)', placeholder: 'A page, or skip' },
      portal: { label: 'Where, if you know (optional)', placeholder: 'A portal screen, or skip' },
      dashboard: { label: 'Where, if you know (optional)', placeholder: 'A hub screen, or skip' },
      app: { label: 'Where, if you know (optional)', placeholder: 'Name the screen, or skip' },
    },
  };

  const FILE_OK = /\.(jpe?g|png|webp|gif|pdf|docx?|txt)$/i;
  const FILE_MIME = /^(image\/(jpeg|png|webp|gif)|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|text\/plain)$/;

  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: 'same-origin', ...opts });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Request failed');
    return data;
  }

  function val(name) {
    const el = form.elements.namedItem(name);
    if (!el) return '';
    return String(el.value || '').trim();
  }

  function fieldNode(name) {
    const el = form.elements.namedItem(name);
    if (!el) return null;
    return el.length && el[0] ? el[0] : el;
  }

  function markBad(name) {
    form.querySelectorAll('.is-bad').forEach((el) => el.classList.remove('is-bad'));
    if (!name) return;
    const node = fieldNode(name);
    const wrap = node && node.closest('.req-field, .make-where, .make-pills, .req-check, .req-drop');
    if (wrap) wrap.classList.add('is-bad');
    if (node && typeof node.focus === 'function') {
      try { node.focus({ preventScroll: false }); } catch (_) { node.focus(); }
    }
  }

  function fail(message, name) {
    const err = new Error(message);
    err.field = name;
    throw err;
  }

  function setMsg(text) {
    msg.textContent = text || '';
    msg.className = 'req-msg';
  }

  function surface() {
    return val('surface') || 'website';
  }

  function kind() {
    return val('kind') || 'change';
  }

  function paintLocation() {
    const pack = LOC[kind()] || LOC.change;
    const spec = pack[surface()] || pack.website;
    locLabel.textContent = spec.label;
    locInput.placeholder = spec.placeholder;
  }

  function paintKind() {
    const adding = kind() !== 'change';
    changeFields.hidden = adding;
    addFields.hidden = !adding;
    paintLocation();
  }

  function paintNeededDate() {
    const byDate = val('needed') === 'By a date';
    dateWrap.hidden = !byDate;
    const dateEl = form.elements.namedItem('needed_date');
    if (dateEl) dateEl.required = false;
  }

  function allowedFile(file) {
    if (FILE_MIME.test(file.type)) return true;
    if (FILE_OK.test(file.name || '')) return true;
    return false;
  }

  function addFiles(list) {
    for (const file of list) {
      if (!allowedFile(file)) continue;
      if (files.length >= 6) break;
      files.push(file);
    }
    previews.innerHTML = '';
    files.forEach((file) => {
      if ((file.type || '').startsWith('image/')) {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.alt = file.name;
        previews.appendChild(img);
      } else {
        const chip = document.createElement('span');
        chip.className = 'req-file';
        chip.textContent = file.name;
        previews.appendChild(chip);
      }
    });
    setMsg('');
  }

  function showStep(n, opts = {}) {
    step = n;
    form.querySelectorAll('.make-step').forEach((el) => {
      const on = Number(el.dataset.step) === n;
      el.hidden = !on;
      el.classList.toggle('is-on', on);
    });
    document.querySelectorAll('#make-toc li').forEach((el) => {
      el.classList.toggle('is-on', Number(el.dataset.step) === n);
      el.classList.toggle('is-done', Number(el.dataset.step) < n);
    });
    form.querySelectorAll('[data-bar]').forEach((el) => {
      el.classList.toggle('is-on', Number(el.dataset.bar) <= n);
    });
    stepLabel.textContent = `Step ${n} of ${STEPS}`;
    backBtn.hidden = n === 1;
    nextBtn.hidden = n === STEPS;
    submitBtn.hidden = n !== STEPS;
    if (n === STEPS) paintReview();
    setMsg('');
    markBad(null);
    if (opts.quiet) return;
    const first = form.querySelector(`.make-step[data-step="${n}"] input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]):not([hidden]), .make-step[data-step="${n}"] textarea`);
    if (first && !first.closest('[hidden]')) first.focus();
  }

  function neededLine() {
    const needed = val('needed');
    if (needed === 'By a date') {
      const d = val('needed_date');
      return d ? `By ${d}` : 'By a date (missing)';
    }
    return needed;
  }

  function composeBody() {
    const k = kind();
    const extra = val('extra');
    const fileLine = files.length
      ? files.map((f) => f.name).join(', ')
      : 'None';
    const meat =
      k === 'change'
        ? ['Now:', val('now') || '(not given)', '', 'Should be:', val('should') || '(not given)']
        : ['Add this:', val('details') || '(not given)'];
    const timing = val('if_ignored');
    return [
      val('title'),
      '',
      `Kind: ${KIND[k] || k}`,
      `Where: ${surface()}`,
      `Location: ${val('page_url') || '(not given)'}`,
      '',
      ...meat,
      '',
      `Who asked: ${val('who_asked') || '(not given)'}`,
      `Who sees this: ${val('audience')}`,
      `Needed: ${neededLine()}`,
      timing ? `Timing: ${timing}` : '',
      '',
      `Files: ${fileLine}`,
      extra ? `\nAnything else:\n${extra}` : '',
    ]
      .filter((line, i, arr) => line !== '' || arr[i - 1] !== '')
      .join('\n')
      .trim();
  }

  function paintReview() {
    const rows = [
      ['Name', val('name')],
      ['Email', val('email')],
      ['Kind', KIND[kind()] || kind()],
      ['Surface', surface()],
      ['Location', val('page_url') || 'Not given'],
      ['Summary', val('title')],
      ['Who asked', val('who_asked')],
      ['Needed', neededLine()],
      ['Files', files.length ? files.map((f) => f.name).join(', ') : 'None'],
    ];
    review.innerHTML =
      '<h3>Check this before you send</h3>' +
      rows
        .map(([k, v]) => `<div><dt>${k}</dt><dd>${String(v || '-').replace(/</g, '&lt;')}</dd></div>`)
        .join('');
  }

  function fail(message, name) {
    const err = new Error(message);
    err.field = name;
    throw err;
  }

  function validate(n) {
    if (n === 1) {
      if (!val('name')) fail('Name is required.', 'name');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val('email'))) fail('A real email is required.', 'email');
      if (!kind()) fail('Pick what kind of request this is.', 'kind');
      if (!surface()) fail('Pick where this lives.', 'surface');
    }
    if (n === 2) {
      if (!val('title')) fail('Give a one-line summary. One word is enough.', 'title');
    }
  }

  function goNext() {
    try {
      validate(step);
      markBad(null);
      showStep(Math.min(STEPS, step + 1));
    } catch (err) {
      markBad(err.field);
      setMsg(err.message);
    }
  }

  nextBtn.addEventListener('click', goNext);
  backBtn.addEventListener('click', () => showStep(Math.max(1, step - 1)));

  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.target && e.target.tagName === 'TEXTAREA') return;
    if (step === STEPS) return;
    e.preventDefault();
    goNext();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setMsg('');
    submitBtn.disabled = true;
    try {
      validate(1);
      validate(2);
      validate(3);
      document.getElementById('req-body').value = composeBody();
      const fd = new FormData(form);
      files.forEach((f) => fd.append('files', f));
      await api('/api/requests', { method: 'POST', body: fd });
      form.hidden = true;
      done.hidden = false;
      files = [];
      previews.innerHTML = '';
      form.reset();
      paintKind();
      paintNeededDate();
      showStep(1, { quiet: true });
    } catch (err) {
      setMsg(err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });

  form.addEventListener('change', (e) => {
    const t = e.target;
    if (t && (t.name === 'surface' || t.name === 'kind')) paintKind();
    if (t && t.name === 'needed') paintNeededDate();
  });

  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', () => addFiles(fileInput.files));
  ;['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add('is-hot');
    })
  );
  ;['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove('is-hot');
    })
  );
  drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
  document.addEventListener('paste', (e) => {
    if (!e.clipboardData || form.hidden) return;
    const pasted = [...e.clipboardData.items]
      .map((i) => i.getAsFile())
      .filter(Boolean)
      .filter(allowedFile);
    if (pasted.length) addFiles(pasted);
  });

  again.addEventListener('click', () => {
    done.hidden = true;
    form.hidden = false;
    setMsg('');
    showStep(1);
  });

  paintKind();
  paintNeededDate();
  showStep(1, { quiet: true });
})();
