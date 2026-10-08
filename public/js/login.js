/* Sign-in page: Google's button, then /api/auth/google, then back to the page the person asked for. */
(() => {
  const box = document.getElementById('si-google');
  const msg = document.getElementById('si-msg');
  const params = new URLSearchParams(location.search);
  const asked = params.get('next') || '/';
  // Only a path on this site, never another address.
  const next = /^\/(?![\\/])/.test(asked) ? asked : '/';
  const signedOut = params.has('signedout');

  function say(text, kind) {
    msg.textContent = text || '';
    msg.dataset.kind = kind || 'error';
    msg.hidden = !text;
  }

  async function call(url, opts) {
    const res = await fetch(url, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts || {}));
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const err = new Error(data.message || 'Sign-in failed. Try again.');
      err.code = data.error;
      throw err;
    }
    return data;
  }

  function loadGoogle() {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.accounts && window.google.accounts.id) return resolve();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Google sign-in did not load. Check the connection and reload the page.'));
      document.head.appendChild(s);
    });
  }

  async function onCredential(response) {
    say('Signing you in...', 'info');
    try {
      await call('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential: response.credential }) });
      location.replace(next);
    } catch (err) {
      say(err.message);
      // A stale nonce means this tab needs a fresh one before the next try.
      if (err.code === 'stale_signin' || err.code === 'expired') start(true);
    }
  }

  async function start(again) {
    try {
      if (!again) {
        const me = await call('/api/auth/me').catch(() => null);
        if (me && me.signedIn && me.user && me.user.via === 'google') {
          location.replace(next);
          return;
        }
      }
      const cfg = await call('/api/auth/nonce');
      await loadGoogle();
      const id = window.google.accounts.id;
      id.initialize({
        client_id: cfg.clientId,
        callback: onCredential,
        nonce: cfg.nonce,
        auto_select: !signedOut,
        cancel_on_tap_outside: false,
        context: 'signin',
        ux_mode: 'popup',
        itp_support: true,
        use_fedcm_for_prompt: true,
      });
      box.innerHTML = '';
      const width = Math.min(380, Math.max(240, box.clientWidth || 320));
      id.renderButton(box, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', logo_alignment: 'left', width });
      if (signedOut) id.disableAutoSelect();
      else id.prompt();
    } catch (err) {
      box.innerHTML = '';
      say(err.message);
    }
  }

  if (signedOut) say('You are signed out.', 'info');
  start(false);
})();
