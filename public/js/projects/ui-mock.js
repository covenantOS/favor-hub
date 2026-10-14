/* Mock server for the projects UI. With ?mock=2 on the page URL it answers the /api/projects, /api/tasks and /api/requests/people
   routes in memory, so the pages work without a server. Options: ?n=2000 (task count in the first project), ?lag=600 (extra ms),
   ?fail=PATCH (every PATCH fails; POST, PUT and DELETE work the same way). The names are invented. */
const qs = new URLSearchParams(location.search);
const LAG = Number(qs.get('lag') || 0);
const FAIL = (qs.get('fail') || '').toUpperCase();
const ME = 'maya.ortega@favorintl.org';
const NAMES = ['Maya Ortega', 'Theo Lindqvist', 'Priya Raman', 'Jonas Whitfield', 'Imani Okafor', 'Lucas Brandt', 'Noor Haddad', 'Eli Castellano', 'Grace Tanaka', 'Owen Dalrymple', 'Sofia Marquez', 'Felix Adeyemi', 'Hannah Voss', 'Rafael Quill'];
const TEAMS = ['Marketing', 'Grants', 'Operations', 'Partner Care', 'Technology'];
const PEOPLE = NAMES.map((name, i) => ({ email: name.toLowerCase().replace(/\s+/g, '.') + '@favorintl.org', name, team: TEAMS[i % 5], title: ['Coordinator', 'Manager', 'Director', 'Specialist'][i % 4], picture: '' }));
const pOf = (e) => PEOPLE.find((p) => p.email === e);
const ref = (e) => { const p = pOf(e); return p ? { email: p.email, name: p.name, picture: '' } : null; };
const iso = (d) => d.toISOString().slice(0, 10);
const ET = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const today = new Date(ET(new Date()) + 'T12:00:00Z');
const plus = (n) => iso(new Date(today.getTime() + n * 86400000));
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
let uid = 100;
const id = (p) => p + (++uid).toString(36) + Math.floor(rnd() * 1e5).toString(36);

const CODES = {
  appeal: [['L2610', 'October newsletter appeal'], ['L2611', 'November newsletter appeal'], ['L2609', 'September newsletter appeal'], ['L2612', 'Year-end letter'], ['GT26', 'Giving Tuesday 2026'], ['EV26', 'Fall dinner']],
  source: [['WEB', 'Website'], ['MAIL', 'Direct mail'], ['EML', 'Email'], ['EVT', 'Event'], ['SMS', 'Text message'], ['REF', 'Referral']],
  fund: [['GEN', 'General fund'], ['CHW', 'Church planting'], ['MED', 'Medical outreach'], ['ORP', 'Orphan care'], ['WTR', 'Clean water']],
  campaign: [['FALL26', 'Fall campaign'], ['YE26', 'Year-end'], ['SPR26', 'Spring appeal'], ['GM26', 'Gift match']],
};

const db = { projects: [], sections: [], members: [], tasks: [], comments: [], files: [], events: [], deps: [], people: [], notices: [] };

function mkProject(key, name, team, color, lead, n, secs) {
  const p = { id: 'p_' + key.toLowerCase(), key, name, description: name + ' work, in one place.', team, lead_email: lead, visibility: 'staff', status: 'active', color, start_date: plus(-30), due_date: plus(60), chat_channel_id: null, drive_folder_id: null, next_num: 1, created_by: lead, created_at: plus(-30), updated_at: plus(-1) };
  db.projects.push(p);
  const sids = secs.map((s, i) => { const sec = { id: p.id + '_s' + i, project_id: p.id, name: s, sort: (i + 1) * 1000 }; db.sections.push(sec); return sec.id; });
  for (const e of PEOPLE.slice(0, 8)) db.members.push({ project_id: p.id, email: e.email, role: e.email === lead ? 'lead' : 'member', added_at: plus(-30) });
  const verbs = ['Draft', 'Review', 'Send', 'Schedule', 'Update', 'Confirm', 'Collect', 'Publish', 'Reconcile', 'Prepare', 'Call', 'Design'];
  const objs = ['the October newsletter', 'the board packet', 'partner thank-you notes', 'the event run of show', 'the grant narrative', 'budget numbers', 'the landing page copy', 'photo permissions', 'the vendor contract', 'the video script', 'the mailing list', 'the year-end letter'];
  for (let i = 0; i < n; i++) {
    const sec = sids[Math.floor((i / n) * sids.length)] || sids[0];
    const done = rnd() < 0.3;
    const dd = rnd() < 0.78 ? plus(Math.floor(rnd() * 40) - 8) : null;
    const t = mkTask(p, { title: pick(verbs) + ' ' + pick(objs) + (rnd() < 0.04 ? ' with a much longer title that goes on and on so the row has to cope with a name that is far too wide for the space it has been given today' : ''), section_id: sec, status: done ? 'done' : pick(['open', 'open', 'open', 'doing', 'waiting']), owner_email: rnd() < 0.85 ? pick(PEOPLE).email : null, due_date: dd, start_date: dd && rnd() < 0.5 ? plus(Math.floor(rnd() * 5) - 20) : null, priority: pick(['normal', 'normal', 'normal', 'high', 'low']) });
    if (rnd() < 0.3) t.appeal_code = pick(CODES.appeal)[0];
    if (rnd() < 0.15) t.source_code = pick(CODES.source)[0];
    if (rnd() < 0.1) t.fund_code = pick(CODES.fund)[0];
    if (rnd() < 0.1) t.campaign_code = pick(CODES.campaign)[0];
  }
  return p;
}
function mkTask(p, f) {
  const now = new Date().toISOString();
  const t = { id: id('t_'), project_id: p ? p.id : null, section_id: null, code: null, title: '', description: '', status: 'open', priority: 'normal', owner_email: null, start_date: null, due_date: null, due_time: null, done_at: null, done_by: null, parent_id: null, sort: 0, waiting_on_email: null, waiting_on_task: null, appeal_code: null, source_code: null, fund_code: null, campaign_code: null, created_by: ME, created_at: now, updated_at: now, ...f };
  if (p) { t.code = p.key + '-' + String(p.next_num++).padStart(4, '0'); }
  const sib = db.tasks.filter((x) => x.project_id === t.project_id && x.section_id === t.section_id && !x.parent_id);
  t.sort = f.sort != null ? f.sort : (sib.reduce((m, x) => Math.max(m, x.sort), 0) + 1000);
  if (t.status === 'done') { t.done_at = now; t.done_by = t.owner_email || ME; }
  db.tasks.push(t);
  return t;
}

function init() {
  db.people = PEOPLE;
  const n = Math.max(10, Number(qs.get('n') || 60));
  mkProject('MKT', 'Marketing calendar', 'Marketing', 'leaf', PEOPLE[1].email, Math.round(n * 0.5), ['To do', 'In progress', 'In review', 'Scheduled']);
  mkProject('GRT', 'Grants pipeline', 'Grants', 'sky', ME, Math.round(n * 0.3), ['Researching', 'Writing', 'Submitted']);
  mkProject('OPS', 'Office operations', 'Operations', 'terra', PEOPLE[4].email, Math.round(n * 0.2), ['Backlog', 'This week']);
  if (qs.get('empty')) { db.projects.push({ ...db.projects[0], id: 'p_empty', key: 'EMP', name: 'Empty project', next_num: 1 }); db.sections.push({ id: 'p_empty_s0', project_id: 'p_empty', name: 'To do', sort: 1000 }); db.members.push({ project_id: 'p_empty', email: ME, role: 'lead', added_at: plus(0) }); }
  mkTask(null, { title: 'Renew the parking permit', owner_email: ME, due_date: plus(0) });
  mkTask(null, { title: 'Book the training room for Friday', owner_email: ME, due_date: plus(1) });
  const mkt = db.projects[0];
  const parent = db.tasks.find((t) => t.project_id === mkt.id && !t.parent_id);
  if (parent) { parent.owner_email = ME; for (const s of ['Pull the list', 'Check the seeds', 'Proof the copy']) mkTask(mkt, { title: s, parent_id: parent.id, section_id: parent.section_id, owner_email: ME }); }
  db.tasks.filter((t) => t.project_id === mkt.id && !t.parent_id).slice(0, 12).forEach((t, i) => { if (i % 3 === 0) t.owner_email = ME; });
  const t0 = parent || db.tasks[0];
  db.comments.push({ id: id('c_'), task_id: t0.id, author_email: PEOPLE[1].email, body: 'Added the seed list. <@' + ME + '> can you check the dates?', mentions: [ME], source: 'hub', created_at: new Date(Date.now() - 3600e3 * 5).toISOString(), edited_at: null, deleted_at: null });
  db.events.push({ id: id('e_'), task_id: t0.id, project_id: mkt.id, actor_email: PEOPLE[1].email, kind: 'created', detail: '{}', created_at: new Date(Date.now() - 3600e3 * 30).toISOString() });
}

/* ---------------------------------------------------------------- shaping */
const daysAgo = (d) => d && d < ET(new Date());
function shapeTask(t) {
  const proj = t.project_id ? db.projects.find((p) => p.id === t.project_id) : null;
  const sec = t.section_id ? db.sections.find((s) => s.id === t.section_id) : null;
  const subs = db.tasks.filter((x) => x.parent_id === t.id);
  const blocked = db.deps.some((d) => d.task_id === t.id && (db.tasks.find((x) => x.id === d.depends_on) || {}).status !== 'done');
  return { ...t, owner: t.owner_email ? ref(t.owner_email) : null, project: proj ? { id: proj.id, key: proj.key, name: proj.name, color: proj.color } : null, section: sec ? sec.name : null, subtasks: { done: subs.filter((x) => x.status === 'done').length, total: subs.length }, comments: db.comments.filter((c) => c.task_id === t.id && !c.deleted_at).length, files: db.files.filter((f) => f.task_id === t.id).length, overdue: !!(t.due_date && t.status !== 'done' && t.status !== 'dropped' && daysAgo(t.due_date)), blocked };
}
function shapeProject(p) {
  const ts = db.tasks.filter((t) => t.project_id === p.id && !t.parent_id);
  const open = ts.filter((t) => t.status !== 'done' && t.status !== 'dropped');
  return { ...p, open: open.length, done: ts.filter((t) => t.status === 'done').length, overdue: open.filter((t) => daysAgo(t.due_date)).length, lead: ref(p.lead_email) };
}
const findProject = (k) => db.projects.find((p) => p.id === k || p.key === k);
const findTask = (k) => db.tasks.find((t) => t.id === k || t.code === k);
const log = (t, kind, detail) => db.events.push({ id: id('e_'), task_id: t.id, project_id: t.project_id, actor_email: ME, kind, detail: JSON.stringify(detail || {}), created_at: new Date().toISOString() });
const err = (status, message) => Object.assign(new Error(message), { status });

function applyPatch(t, b) {
  const simple = ['title', 'description', 'status', 'priority', 'owner_email', 'start_date', 'due_date', 'due_time', 'section_id', 'project_id', 'parent_id', 'appeal_code', 'source_code', 'fund_code', 'campaign_code', 'waiting_on_email', 'waiting_on_task'];
  for (const k of simple) {
    if (!(k in b)) continue;
    if (k === 'title' && !String(b[k]).trim()) throw err(400, 'A task needs a title.');
    if (t[k] !== b[k]) log(t, k === 'status' ? 'status' : k === 'owner_email' ? 'owner' : k.endsWith('_date') ? 'due' : 'edit', { field: k, from: t[k], to: b[k] });
    t[k] = b[k];
  }
  if ('waiting_on_email' in b || 'waiting_on_task' in b) { if (t.waiting_on_email || t.waiting_on_task) t.status = 'waiting'; else if (t.status === 'waiting') t.status = 'open'; }
  if (b.done === true) { t.status = 'done'; t.done_at = new Date().toISOString(); t.done_by = ME; log(t, 'done'); }
  if (b.done === false) { t.status = 'open'; t.done_at = null; t.done_by = null; log(t, 'reopened'); }
  if (b.move) {
    const m = b.move;
    t.section_id = m.section_id === undefined ? t.section_id : m.section_id;
    const sib = db.tasks.filter((x) => x.project_id === t.project_id && x.section_id === t.section_id && !x.parent_id && x.id !== t.id).sort((a, c) => a.sort - c.sort);
    let i = sib.length;
    if (m.before) { const k = sib.findIndex((x) => x.id === m.before); if (k >= 0) i = k; } else if (m.after) { const k = sib.findIndex((x) => x.id === m.after); if (k >= 0) i = k + 1; }
    const prev = sib[i - 1], next = sib[i];
    t.sort = prev && next ? (prev.sort + next.sort) / 2 : prev ? prev.sort + 1000 : next ? next.sort - 1000 : 1000;
    log(t, 'move', { section_id: t.section_id });
  }
  t.updated_at = new Date().toISOString();
}

/* ---------------------------------------------------------------- the router */
function handle(method, url, body) {
  const u = new URL(url, location.origin);
  const parts = u.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  const q = u.searchParams;
  if (parts[0] === 'requests' && parts[1] === 'people') return { ok: true, people: PEOPLE, me: ME };
  if (parts[0] === 'projects') {
    if (parts.length === 1) {
      if (method === 'GET') {
        const mine = db.tasks.filter((t) => t.owner_email === ME && t.status !== 'done' && t.status !== 'dropped');
        return { ok: true, projects: db.projects.filter((p) => p.status !== 'archived').map(shapeProject), mine: { open: mine.length, overdue: mine.filter((t) => daysAgo(t.due_date)).length, dueToday: mine.filter((t) => t.due_date === ET(new Date())).length } };
      }
      if (method === 'POST') {
        const name = String(body.name || '').trim();
        if (!name) throw err(400, 'A project needs a name.');
        let key = (body.key || name.replace(/[^A-Za-z]/g, '').slice(0, 3)).toUpperCase();
        if (db.projects.some((p) => p.key === key)) key = key.slice(0, 2) + 'X';
        const p = { id: 'p_' + key.toLowerCase(), key, name, description: body.description || '', team: body.team || '', lead_email: body.lead_email || ME, visibility: body.visibility || 'staff', status: 'active', color: body.color || 'leaf', start_date: body.start_date || null, due_date: body.due_date || null, chat_channel_id: null, drive_folder_id: null, next_num: 1, created_by: ME, created_at: plus(0), updated_at: plus(0) };
        db.projects.push(p);
        ['To do', 'In progress', 'Done'].forEach((s, i) => db.sections.push({ id: p.id + '_s' + i, project_id: p.id, name: s, sort: (i + 1) * 1000 }));
        for (const e of [p.lead_email, ...(body.members || [])]) if (!db.members.some((m) => m.project_id === p.id && m.email === e)) db.members.push({ project_id: p.id, email: e, role: e === p.lead_email ? 'lead' : 'member', added_at: plus(0) });
        return { ok: true, project: shapeProject(p) };
      }
    }
    const p = findProject(parts[1]);
    if (!p) throw err(404, 'That project is not here.');
    if (parts.length === 2) {
      if (method === 'GET') {
        const ts = db.tasks.filter((t) => t.project_id === p.id && !t.parent_id);
        const open = ts.filter((t) => t.status !== 'done' && t.status !== 'dropped');
        return { ok: true, project: shapeProject(p), sections: db.sections.filter((s) => s.project_id === p.id).sort((a, b) => a.sort - b.sort), members: db.members.filter((m) => m.project_id === p.id).map((m) => pOf(m.email)).filter(Boolean), counts: { open: open.length, done: ts.length - open.length, overdue: open.filter((t) => daysAgo(t.due_date)).length } };
      }
      if (method === 'PATCH') { if (body.archive) p.status = 'archived'; for (const k of ['name', 'description', 'team', 'lead_email', 'visibility', 'status', 'color', 'start_date', 'due_date']) if (k in body) p[k] = body[k]; return { ok: true, project: shapeProject(p) }; }
    }
    if (parts[2] === 'sections') {
      if (method === 'POST') { const last = db.sections.filter((s) => s.project_id === p.id).reduce((m, s) => Math.max(m, s.sort), 0); const s = { id: id('s_'), project_id: p.id, name: String(body.name || 'Section').trim() || 'Section', sort: last + 1000 }; db.sections.push(s); return { ok: true, section: s }; }
      const s = db.sections.find((x) => x.id === parts[3]);
      if (!s) throw err(404, 'That section is not here.');
      if (method === 'PATCH') { if (body.name != null) s.name = body.name; if (body.sort != null) s.sort = body.sort; return { ok: true, section: s }; }
      if (method === 'DELETE') { db.tasks.forEach((t) => { if (t.section_id === s.id) t.section_id = null; }); db.sections.splice(db.sections.indexOf(s), 1); return { ok: true }; }
    }
    if (parts[2] === 'members' && method === 'PUT') {
      for (const e of body.add || []) if (!db.members.some((m) => m.project_id === p.id && m.email === e)) db.members.push({ project_id: p.id, email: e, role: body.role || 'member', added_at: plus(0) });
      db.members = db.members.filter((m) => !(m.project_id === p.id && (body.remove || []).includes(m.email)));
      return { ok: true };
    }
  }
  if (parts[0] === 'tasks') {
    if (parts[1] === 'codes') {
      const k = q.get('kind') || 'appeal', s = (q.get('q') || '').toLowerCase();
      return { ok: true, codes: (CODES[k] || []).filter(([c, d]) => !s || (c + ' ' + d).toLowerCase().includes(s)).map(([code, description]) => ({ code, description })) };
    }
    if (parts[1] === 'views') {
      db.views = db.views || [];
      if (method === 'GET') return { ok: true, views: db.views.filter((v) => (v.project_id || '') === (q.get('project') ? (findProject(q.get('project')) || {}).id || '' : '')) };
      if (method === 'POST') {
        const p = body.project_id ? findProject(body.project_id) : null;
        const same = db.views.find((v) => v.name === body.name && (v.project_id || null) === (p ? p.id : null));
        const v = same || { id: id('vw_'), project_id: p ? p.id : null, name: String(body.name || '').slice(0, 60), created_at: new Date().toISOString() };
        v.query = body.query || {};
        if (!same) db.views.push(v);
        return { ok: true, view: v };
      }
      if (method === 'DELETE') { db.views = db.views.filter((v) => v.id !== parts[2]); return { ok: true }; }
    }
    if (parts[1] === 'notices') return { ok: true, notices: [], unread: 0 };
    if (parts.length === 1) {
      if (method === 'GET') {
        let ts = db.tasks.slice();
        const pj = q.get('project'); if (pj) { const p = findProject(pj); ts = ts.filter((t) => p && t.project_id === p.id); }
        const ow = q.get('owner'); if (ow) { const e = ow === 'me' ? ME : ow; ts = ts.filter((t) => t.owner_email === e); }
        const st = q.get('status') || 'all';
        if (st === 'open') ts = ts.filter((t) => t.status !== 'done' && t.status !== 'dropped'); else if (st === 'done') ts = ts.filter((t) => t.status === 'done');
        if (q.get('parent')) ts = ts.filter((t) => t.parent_id === q.get('parent')); else ts = ts.filter((t) => !t.parent_id);
        const s = (q.get('q') || '').toLowerCase(); if (s) ts = ts.filter((t) => (t.title + ' ' + (t.code || '')).toLowerCase().includes(s));
        ts = ts.filter((t) => t.status !== 'dropped');
        ts.sort((a, b) => (a.section_id || '').localeCompare(b.section_id || '') || a.sort - b.sort);
        const off = Number(q.get('offset') || 0), lim = Number(q.get('limit') || 500);
        const out = { ok: true, tasks: ts.slice(off, off + lim).map(shapeTask), total: ts.length, limit: lim, offset: off, has_more: off + lim < ts.length, next_offset: off + lim < ts.length ? off + lim : null };
        if (pj && off === 0 && !q.get('parent')) {
          const p = findProject(pj);
          const all = db.tasks.filter((t) => p && t.project_id === p.id && !t.parent_id && t.status !== 'dropped');
          const by = {};
          for (const t of all) { const k = t.section_id || ''; by[k] = by[k] || { open: 0, done: 0 }; by[k][t.status === 'done' ? 'done' : 'open']++; }
          out.counts = { open: all.filter((t) => t.status !== 'done').length, done: all.filter((t) => t.status === 'done').length, by_section: by };
        }
        return out;
      }
      if (method === 'POST') {
        const title = String(body.title || '').trim();
        if (!title) throw err(400, 'A task needs a title.');
        const p = body.project_id ? db.projects.find((x) => x.id === body.project_id) : null;
        const f = {};
        for (const k of ['section_id', 'owner_email', 'due_date', 'start_date', 'description', 'priority', 'parent_id', 'appeal_code', 'source_code', 'fund_code', 'campaign_code']) if (body[k] != null) f[k] = body[k];
        if (p && !f.section_id) f.section_id = (db.sections.find((s) => s.project_id === p.id) || {}).id || null;
        const t = mkTask(p, { ...f, title }); log(t, 'created');
        return { ok: true, task: shapeTask(t) };
      }
    }
    const t = findTask(parts[1]);
    if (!t) throw err(404, 'That task is not here.');
    const sub = parts[2];
    if (!sub) {
      if (method === 'GET') {
        const people = new Set([t.owner_email, t.created_by].filter(Boolean));
        const dep = (x) => ({ id: x.id, code: x.code, title: x.title, status: x.status });
        return { ok: true, task: shapeTask(t), subtasks: db.tasks.filter((x) => x.parent_id === t.id).map(shapeTask), comments: db.comments.filter((c) => c.task_id === t.id && !c.deleted_at), files: db.files.filter((f) => f.task_id === t.id), events: db.events.filter((e) => e.task_id === t.id), deps: { blockedBy: db.deps.filter((d) => d.task_id === t.id).map((d) => dep(db.tasks.find((x) => x.id === d.depends_on))), blocks: db.deps.filter((d) => d.depends_on === t.id).map((d) => dep(db.tasks.find((x) => x.id === d.task_id))) }, people: [...people].map(pOf).filter(Boolean), told: {} };
      }
      if (method === 'PATCH') { applyPatch(t, body); return { ok: true, task: shapeTask(t) }; }
      if (method === 'DELETE') { t.status = 'dropped'; return { ok: true }; }
    }
    if (sub === 'comments') {
      if (method === 'POST') { if (!String(body.body || '').trim()) throw err(400, 'Write something first.'); const c = { id: id('c_'), task_id: t.id, author_email: ME, body: body.body, mentions: body.mentions || [], source: 'hub', created_at: new Date().toISOString(), edited_at: null, deleted_at: null }; db.comments.push(c); return { ok: true, comment: c }; }
      const c = db.comments.find((x) => x.id === parts[3]);
      if (c && method === 'DELETE') { c.deleted_at = new Date().toISOString(); return { ok: true }; }
      if (c && method === 'PATCH') { c.body = body.body; c.edited_at = new Date().toISOString(); return { ok: true, comment: c }; }
    }
    if (sub === 'files') {
      if (method === 'POST') { const f = { id: id('f_'), task_id: t.id, kind: body.kind || 'link', name: body.name, url: body.url || '', ref_id: null, mime: null, size: null, added_by: ME, added_at: new Date().toISOString() }; db.files.push(f); return { ok: true, file: f }; }
      if (method === 'DELETE') { db.files = db.files.filter((f) => f.id !== parts[3]); return { ok: true }; }
    }
    if (sub === 'people' && method === 'PUT') return { ok: true };
    if (sub === 'deps' && method === 'PUT') {
      for (const d of body.add || []) { const o = findTask(d); if (o && !db.deps.some((x) => x.task_id === t.id && x.depends_on === o.id)) db.deps.push({ task_id: t.id, depends_on: o.id }); }
      db.deps = db.deps.filter((d) => !(d.task_id === t.id && (body.remove || []).includes(d.depends_on)));
      return { ok: true };
    }
  }
  throw err(404, 'No such route in the mock: ' + method + ' ' + u.pathname);
}

export function installMock() {
  init();
  const real = window.fetch.bind(window);
  window.fetch = (input, opts = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!/\/api\/(projects|tasks|requests\/people)/.test(url)) return real(input, opts);
    const method = (opts.method || 'GET').toUpperCase();
    return new Promise((resolve) => {
      setTimeout(() => {
        const send = (status, data) => resolve(new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } }));
        try {
          if (FAIL && FAIL === method) throw err(500, 'The mock failed this ' + method + ' on purpose.');
          const body = opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : {};
          send(200, handle(method, url, body));
        } catch (e) { send(e.status || 500, { ok: false, error: 'mock', message: e.message }); }
      }, 60 + Math.floor(rnd() * 90) + LAG);
    });
  };
  window.PJMock = { db, ME, PEOPLE };
}
