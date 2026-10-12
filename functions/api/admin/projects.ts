// Admin > Projects. One route, admin only (adminRoute), every change on the same site and written to the audit log. The part of the
// address after /projects travels in ?p=:
//   GET  /api/admin/projects                       settings, the token's state, hub projects, recent runs
//   POST ?p=settings    {enabled?, marketing_project?}
//   POST ?p=token       {token} saves it sealed, {remove:true} deletes it
//   POST ?p=test        Connect and test: who the token belongs to
//   GET  ?p=asana       the Asana projects the token can see (&archived=1 for archived ones)
//   POST ?p=export      {name, text} an Asana CSV or JSON export file
//   POST ?p=runs        {source, mode: dry|import, projects, options, confirm?, from_dry_run?, upload?}
//   GET  ?p=runs/ID     progress, report and log lines after an id (&after=)
//   POST ?p=runs/ID/step    do the next slice of work (the page calls this until the run is done)
//   POST ?p=runs/ID/cancel
//   POST ?p=hub/ID      {action: archive|restore}
import { HttpError } from '../../_lib/http';
import { adminRoute, readBody } from '../../_lib/admin/route';
import {
  cancelRun, clearToken, hubProjects, listAsana, readSettings, recentRuns, runView, saveExport, saveSettings, saveToken, setProjectState, startRun, stepDeps, stepRun, testToken,
} from '../../_lib/projects/asana-admin';

// The part after /projects goes in ?p=, because each admin route is one file (tests/admin-home.test.mjs checks every file).
const rest = (url: URL) => (url.searchParams.get('p') || '').split('/').filter(Boolean);

export const onRequestGet = adminRoute(async ({ env, url }) => {
  const p = rest(url);
  if (!p.length) return { settings: await readSettings(env), projects: await hubProjects(env), runs: await recentRuns(env) };
  if (p[0] === 'asana') return { projects: await listAsana(env, url.searchParams.get('archived') === '1') };
  if (p[0] === 'runs' && p[1]) return runView(env, p[1], Number(url.searchParams.get('after')) || 0);
  throw new HttpError(404, 'not_found', 'There is no such page.');
});

export const onRequestPost = adminRoute(async ({ env, url, request, user, waitUntil }) => {
  const p = rest(url);
  const b = await readBody(request);
  if (p[0] === 'settings') return { settings: await saveSettings(env, user.email, b) };
  if (p[0] === 'token') {
    if (b.remove === true) await clearToken(env, user.email);
    else await saveToken(env, user.email, String(b.token || ''));
    return { settings: await readSettings(env) };
  }
  if (p[0] === 'test') {
    const who = await testToken(env);
    return { who, settings: await readSettings(env) };
  }
  if (p[0] === 'export') return saveExport(env, user.email, String(b.name || 'export'), String(b.text || ''));
  if (p[0] === 'runs' && !p[1]) {
    const run = await startRun(env, user.email, b);
    return runView(env, run.id);
  }
  if (p[0] === 'runs' && p[1] && p[2] === 'step') {
    await stepRun(env, p[1], stepDeps(env));
    return runView(env, p[1], Number(b.after) || 0);
  }
  if (p[0] === 'runs' && p[1] && p[2] === 'cancel') {
    await cancelRun(env, user.email, p[1]);
    return runView(env, p[1], Number(b.after) || 0);
  }
  if (p[0] === 'hub' && p[1]) return setProjectState(env, user.email, p[1], String(b.action || ''));
  throw new HttpError(404, 'not_found', 'There is no such page.');
});
