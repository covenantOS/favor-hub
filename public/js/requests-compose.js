(() => {
  const form = document.getElementById('req-form');
  const msg = document.getElementById('req-msg');
  const submitBtn = document.getElementById('req-submit');
  const drop = document.getElementById('req-drop');
  const fileInput = document.getElementById('req-files');
  const previews = document.getElementById('req-previews');
  const done = document.getElementById('req-done');
  const again = document.getElementById('req-again');
  if (!form) return;

  let files = [];

  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: 'same-origin', ...opts });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Request failed');
    return data;
  }

  function addFiles(list) {
    for (const file of list) {
      if (!file.type.startsWith('image/')) continue;
      if (files.length >= 6) break;
      files.push(file);
    }
    previews.innerHTML = '';
    files.forEach((file) => {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.alt = file.name;
      previews.appendChild(img);
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = '';
    msg.className = 'req-msg';
    submitBtn.disabled = true;
    try {
      const fd = new FormData(form);
      files.forEach((f) => fd.append('files', f));
      await api('/api/requests', { method: 'POST', body: fd });
      form.hidden = true;
      done.hidden = false;
      files = [];
      previews.innerHTML = '';
      form.reset();
      const website = form.querySelector('input[name="surface"][value="website"]');
      if (website) website.checked = true;
    } catch (err) {
      msg.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
    }
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
    if (!e.clipboardData) return;
    const pasted = [...e.clipboardData.items]
      .filter((i) => i.type.startsWith('image/'))
      .map((i) => i.getAsFile())
      .filter(Boolean);
    if (pasted.length) addFiles(pasted);
  });

  again.addEventListener('click', () => {
    done.hidden = true;
    form.hidden = false;
    msg.textContent = '';
  });
})();
