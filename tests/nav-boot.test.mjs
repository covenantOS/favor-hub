// The menu's first paint: the page head carries this person's access flags, so a browser with no saved menu, or an old one, draws the final menu.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const { bootCookie, readBoot } = await import('../functions/_lib/hub/navboot.ts');
const user = { email: 'Tester@Favorintl.org', name: 'Tester', picture: '', role: 'staff', via: 'google', kpi: false };
const boot = { user, access: { early: true, projectsNav: true, clips: true }, kpiTeams: ['rdd'], jobs: ['rdd'] };

test('the boot cookie reads back for the same person and for nobody else', () => {
  const val = bootCookie(boot).split(';')[0];
  const req = (email) => new Request('https://x/', { headers: { Cookie: 'a=1; ' + val } });
  assert.deepEqual(readBoot(req(), user).access, boot.access);
  assert.equal(readBoot(req(), { ...user, email: 'other@favorintl.org' }), null);
  assert.equal(readBoot(new Request('https://x/', { headers: { Cookie: 'hub_navboot=garbage' } }), user), null);
});

test('the injected head script stores the flags as the saved menu, keeps the same person\'s counts, drops another person\'s', () => {
  const src = (globalThis.__src = null);
  return import('../functions/_lib/hub/navboot.ts').then(async ({ injectBoot }) => {
    class Rewriter { on(_s, h) { this.h = h; return this; } transform(res) { const h = this.h; return { async text() { let out = ''; h.element({ prepend: (t) => { out = t; } }); return out; } }; } }
    globalThis.HTMLRewriter = Rewriter;
    const tag = await injectBoot(new Response('<html></html>'), boot).text();
    const js = tag.replace(/^<script>/, '').replace(/<\/script>$/, '');
    const run = (stored) => {
      const store = { 'favor.hub.nav.v1': stored };
      const win = {};
      vm.runInNewContext(js, { window: win, localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } }, JSON });
      return JSON.parse(store['favor.hub.nav.v1']);
    };
    const same = run(JSON.stringify({ user: { email: user.email }, access: { early: false }, counts: { mailUnread: 3 } }));
    assert.equal(same.access.early, true);
    assert.equal(same.counts.mailUnread, 3);
    const other = run(JSON.stringify({ user: { email: 'x@y.org' }, counts: { mailUnread: 3 } }));
    assert.deepEqual(other.counts, {});
    assert.deepEqual(run(null).jobs, ['rdd']);
  });
});
