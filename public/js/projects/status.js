/* The Friday update for one project: the switch, the next post as it would read, and a Post now button. Only the project lead or an
   admin changes the switch. The update posts to the project's Chat channel on Fridays from 3 PM Eastern once it is on. */
import { esc, openSheet, toast, ago } from './ui-util.js';
import { api } from './ui-data.js';

export async function openStatus(project) {
  const s = openSheet({ title: 'Friday update', cls: 'pj-sheet--status', html: '<div class="pj-skel" aria-busy="true"><i></i><i></i></div>' });
  const body = s.body;
  let st = null;
  let draft = null;
  const paint = () => {
    const on = st.status.enabled;
    const can = st.can.manage;
    body.innerHTML = `<div class="pj-st">
      <label class="pj-st__sw${can ? '' : ' is-locked'}"><input type="checkbox" data-sw ${on ? 'checked' : ''} ${can ? '' : 'disabled'} /><span class="pj-st__box" aria-hidden="true"></span><span class="pj-st__lab"><b>Post every Friday at 3 PM</b><small>${st.channel ? `In the project channel, #${esc(st.channel.name)}.` : 'In a project channel that is made when this is turned on.'}${can ? '' : ' The project lead or an admin turns this on.'}</small></span></label>
      ${on && st.status.last_posted_at ? `<p class="pj-st__meta">Last posted ${esc(ago(st.status.last_posted_at))}.</p>` : ''}
      ${st.status.last_error ? `<p class="pj-err">${esc(st.status.last_error)}</p>` : ''}
      <span class="pj-label">This week so far</span>
      <pre class="pj-st__pre" data-pre>${draft ? esc(draft.text) : 'Loading'}</pre>
      <p class="pj-err" data-err hidden></p>
      <div class="pj-sheet__foot"><button type="button" class="pj-btn" data-sheet-x>Close</button>${can ? `<button type="button" class="pj-btn pj-btn--primary" data-post ${on ? '' : 'disabled'} title="${on ? '' : 'Turn the update on first'}">Post now</button>` : ''}</div>
    </div>`;
  };
  const err = (m) => { const e = body.querySelector('[data-err]'); if (e) { e.textContent = m; e.hidden = !m; } };
  const fill = (text) => { const pre = body.querySelector('[data-pre]'); if (pre) pre.textContent = text; };
  try {
    st = await api.statusGet(project.id);
    paint();
    api.statusDraft(project.id).then((d) => { draft = d; fill(d.text); }).catch(() => { draft = { text: 'The update could not be read right now.' }; fill(draft.text); });
  } catch (ex) {
    body.innerHTML = `<p class="pj-err">${esc(ex.message || 'The update settings did not load.')}</p>`;
    return;
  }
  body.addEventListener('change', async (e) => {
    const sw = e.target.closest('[data-sw]');
    if (!sw) return;
    sw.disabled = true;
    try {
      const r = await api.statusSet(project.id, sw.checked);
      st = { ...st, status: r.status, channel: r.channel || st.channel };
      toast(sw.checked ? 'Friday update is on' : 'Friday update is off');
      paint();
    } catch (ex) { sw.checked = !sw.checked; sw.disabled = false; err(ex.message || 'That did not save.'); }
  });
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-post]');
    if (!b) return;
    b.disabled = true;
    b.textContent = 'Posting';
    try {
      const r = await api.statusPost(project.id);
      toast('Posted to #' + r.channel);
      s.close();
    } catch (ex) { err(ex.message || 'That did not post.'); b.disabled = false; b.textContent = 'Post now'; }
  });
}
