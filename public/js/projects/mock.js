/* Projects: the in-memory stand-in for the server, used when a page address has ?mock=1 (see api.js).
   3 projects, 60 tasks and 8 invented people, built fresh on every page load around today's date. Reads and writes behave
   like the real routes closely enough to build screens on: filters, sections, ordering, subtasks, done, comments,
   people, dependencies, notices. Nothing leaves the browser. Every name here is made up. */

const ME = 'ada@favorintl.org';
const PEOPLE = [
  { email: ME, name: 'Ada Admin', team: 'Marketing', title: 'Lead Developer', picture: '' },
  { email: 'vic@favorintl.org', name: 'Vic Video', team: 'Marketing', title: 'Videographer', picture: '' },
  { email: 'dan@favorintl.org', name: 'Dan Design', team: 'Marketing', title: 'Creative Director', picture: '' },
  { email: 'flo@favorintl.org', name: 'Flo Founder', team: 'Leadership', title: 'Director', picture: '' },
  { email: 'ozzy@favorintl.org', name: 'Ozzy Other', team: 'Support Team', title: 'Assistant', picture: '' },
  { email: 'gwen@favorintl.org', name: 'Gwen Grant', team: 'Grants', title: 'Grants Writer', picture: '' },
  { email: 'pat@favorintl.org', name: 'Pat Partner', team: 'Partner Care', title: 'Partner Care Lead', picture: '' },
  { email: 'cal@favorintl.org', name: 'Cal Church', team: 'Church Engagement', title: 'Coordinator', picture: '' },
];

const CODES = {
  appeal: [['L2610-FALL', 'Fall letter 2026'], ['L2611-NOV', 'November letter 2026'], ['L2612-YE', 'Year-end letter 2026'], ['L2609-JMPC', 'September event follow-up']],
  source: [['WEB-GIVE', 'Website giving form'], ['NEWS-OCT', 'October newsletter'], ['EVT-FALL', 'Fall event']],
  fund: [['GEN', 'General fund'], ['CHILD', 'Children and families'], ['WATER', 'Clean water']],
  campaign: [['C2610', 'Fall campaign'], ['C2612', 'Year-end campaign']],
};

const pad = (n, w = 2) => String(n).padStart(w, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return iso(d); };
const today = () => addDays(0);
const nowIso = () => new Date().toISOString();
const clone = (o) => JSON.parse(JSON.stringify(o));
let seq = 1000;
const nid = (p) => `${p}_${(++seq).toString(16)}${Math.random().toString(16).slice(2, 8)}`;
const fail = (status, code, message) => { const e = new Error(message); e.status = status; e.code = code; throw e; };
const delay = (v) => new Promise((r) => setTimeout(() => r(clone(v)), 25));

function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

export function createMock() {
  const r = rng(7);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const person = (email) => {
    const p = PEOPLE.find((x) => x.email === email);
    return p ? { email: p.email, name: p.name, picture: p.picture } : null;
  };

  const projects = [
    { id: 'prj_mkt', key: 'MKT', name: 'Fall campaign', description: 'Letter, newsletter, event and the giving page for fall.', team: 'Marketing', lead_email: ME, visibility: 'staff', status: 'active', color: 'leaf', start_date: addDays(-20), due_date: addDays(40) },
    { id: 'prj_grt', key: 'GRT', name: 'Grant calendar 2027', description: 'Funder deadlines and submissions.', team: 'Grants', lead_email: 'gwen@favorintl.org', visibility: 'members', status: 'active', color: 'sky', start_date: addDays(-5), due_date: addDays(120) },
    { id: 'prj_ops', key: 'OPS', name: 'Office and travel', description: '', team: 'Operations', lead_email: 'flo@favorintl.org', visibility: 'staff', status: 'active', color: 'sun', start_date: null, due_date: null },
  ].map((p) => ({ ...p, chat_channel_id: null, drive_folder_id: null, next_num: 1, created_by: p.lead_email, created_at: nowIso(), updated_at: nowIso() }));

  const members = new Map([
    ['prj_mkt', [ME, 'vic@favorintl.org', 'dan@favorintl.org', 'flo@favorintl.org']],
    ['prj_grt', ['gwen@favorintl.org', ME, 'pat@favorintl.org']],
    ['prj_ops', ['flo@favorintl.org', 'ozzy@favorintl.org', ME]],
  ]);
  const sections = [
    ['prj_mkt', ['Planning', 'Writing', 'Design', 'Launch']],
    ['prj_grt', ['To research', 'Drafting', 'Submitted']],
    ['prj_ops', ['Travel', 'Office']],
  ].flatMap(([pid, names]) => names.map((name, i) => ({ id: `sec_${pid.slice(4)}_${i}`, project_id: pid, name, sort: (i + 1) * 1000 })));

  const titles = [
    'Draft the fall letter', 'Pick the hero photo', 'Book the printer', 'Write the newsletter intro', 'Proof the giving page', 'Set up the appeal code',
    'Send the proof to Flo', 'Record the thank-you video', 'Update the donor-free FAQ page', 'Schedule the social posts', 'Collect church addresses', 'Build the mailing list',
    'Research the Tampa foundation', 'Fill in the budget table', 'Ask for a letter of support', 'Submit the online form', 'Review last year report', 'Call the program officer',
    'Book flights for the site visit', 'Order printer toner', 'Renew the domain', 'Plan the staff lunch', 'Reconcile card receipts', 'Clean out the supply room',
  ];
  const tasks = [];
  const deps = [];
  const projectTasks = { prj_mkt: 28, prj_grt: 20, prj_ops: 12 };
  for (const p of projects) {
    const secs = sections.filter((s) => s.project_id === p.id);
    const emails = members.get(p.id);
    for (let i = 0; i < projectTasks[p.id]; i++) {
      const start = Math.floor(r() * 50) - 15;
      const dur = 1 + Math.floor(r() * 10);
      const st = r();
      const sec = secs[Math.floor(r() * secs.length)];
      const done = st > 0.78;
      const unscheduled = r() > 0.88;
      tasks.push(blank({
        id: `tsk_${p.key.toLowerCase()}${pad(i + 1, 3)}`,
        project_id: p.id,
        section_id: sec.id,
        code: `${p.key}-${pad(p.next_num++, 4)}`,
        title: i === 3 ? 'Write the newsletter intro and the closing paragraph about what changed for partners this fall season, with the full list of events' : titles[(i * 5 + p.key.length) % titles.length],
        status: done ? 'done' : st > 0.62 ? 'doing' : st > 0.55 ? 'waiting' : 'open',
        priority: r() > 0.85 ? 'high' : r() > 0.8 ? 'low' : 'normal',
        owner_email: r() > 0.12 ? pick(emails) : null,
        start_date: unscheduled ? null : addDays(start),
        due_date: unscheduled ? null : addDays(start + dur),
        done_at: done ? nowIso() : null,
        done_by: done ? ME : null,
        sort: (i + 1) * 1000,
        appeal_code: p.key === 'MKT' && i % 3 === 0 ? 'L2610-FALL' : null,
        created_by: p.lead_email,
      }));
    }
  }
  // Personal tasks with no project.
  for (let i = 0; i < 6; i++) tasks.push(blank({ id: `tsk_me${i}`, project_id: null, title: ['Renew parking pass', 'Read the grant report', 'Reply to Pat', 'Order business cards', 'Book dentist', 'Sign the policy form'][i], owner_email: ME, due_date: addDays(i - 2), start_date: null, sort: (i + 1) * 1000, created_by: ME }));
  // A subtask set and two dependencies.
  const parent = tasks.find((t) => t.project_id === 'prj_mkt');
  for (let i = 0; i < 4; i++) tasks.push(blank({ id: `tsk_sub${i}`, project_id: 'prj_mkt', section_id: parent.section_id, parent_id: parent.id, title: ['Outline', 'First draft', 'Edit', 'Final proof'][i], status: i < 2 ? 'done' : 'open', owner_email: ME, due_date: addDays(i + 1), sort: (i + 1) * 1000, created_by: ME }));
  deps.push({ task_id: tasks[2].id, depends_on: tasks[1].id }, { task_id: tasks[5].id, depends_on: tasks[4].id });

  function blank(o) {
    return {
      id: '', project_id: null, section_id: null, code: null, title: '', description: '', status: 'open', priority: 'normal', owner_email: null,
      start_date: null, due_date: null, due_time: null, done_at: null, done_by: null, parent_id: null, sort: 0, waiting_on_email: null, waiting_on_task: null,
      appeal_code: null, source_code: null, fund_code: null, campaign_code: null, request_id: null, meeting_id: null, meeting_action_idx: null,
      chat_message_id: null, expense_id: null, created_by: ME, created_at: nowIso(), updated_at: nowIso(), ...o,
    };
  }

  const comments = [
    { id: 'cm_1', task_id: tasks[0].id, author_email: 'vic@favorintl.org', body: 'First cut is in the folder. @Ada Admin can you look at the opening?', mentions: JSON.stringify([ME]), source: 'hub', chat_message_id: null, created_at: nowIso(), edited_at: null, deleted_at: null },
  ];
  const files = [{ id: 'fl_1', task_id: tasks[0].id, kind: 'link', name: 'Letter draft', url: 'https://example.org/draft', ref_id: null, mime: null, size: null, added_by: ME, added_at: nowIso() }];
  const events = [{ id: 'ev_1', task_id: tasks[0].id, project_id: 'prj_mkt', actor_email: ME, kind: 'created', detail: '{}', created_at: nowIso() }];
  const peopleRows = [{ task_id: tasks[0].id, email: 'dan@favorintl.org', role: 'follower' }];
  const notices = [{ id: 'nt_1', email: ME, task_id: tasks[0].id, kind: 'mentioned', actor_email: 'vic@favorintl.org', body: 'First cut is in the folder.', created_at: nowIso(), read_at: null, emailed_at: null }];

  const proj = (id) => projects.find((p) => p.id === id || p.key === String(id).toUpperCase());
  const canSee = (p) => p.visibility === 'staff' || (members.get(p.id) || []).includes(ME) || p.lead_email === ME;
  const isOverdue = (t) => !!t.due_date && t.due_date < today() && t.status !== 'done' && t.status !== 'dropped';
  const blockedBy = (t) => deps.filter((d) => d.task_id === t.id).map((d) => tasks.find((x) => x.id === d.depends_on)).filter(Boolean);
  const ref = (t) => ({ id: t.id, code: t.code, title: t.title, status: t.status, due_date: t.due_date });

  function shapeTask(t) {
    const p = t.project_id ? proj(t.project_id) : null;
    const sec = t.section_id ? sections.find((s) => s.id === t.section_id) : null;
    const kids = tasks.filter((x) => x.parent_id === t.id);
    return {
      ...t,
      owner: t.owner_email ? person(t.owner_email) : null,
      project: p ? { id: p.id, key: p.key, name: p.name, color: p.color } : null,
      section: sec ? sec.name : null,
      subtasks: { done: kids.filter((k) => k.status === 'done').length, total: kids.length },
      comments: comments.filter((c) => c.task_id === t.id && !c.deleted_at).length,
      files: files.filter((f) => f.task_id === t.id).length,
      overdue: isOverdue(t),
      blocked: blockedBy(t).some((b) => b.status !== 'done' && b.status !== 'dropped'),
    };
  }
  function shapeProject(p) {
    const mine = tasks.filter((t) => t.project_id === p.id && !t.parent_id && t.status !== 'dropped');
    return { ...p, open: mine.filter((t) => t.status !== 'done').length, done: mine.filter((t) => t.status === 'done').length, overdue: mine.filter(isOverdue).length, lead: person(p.lead_email) };
  }
  const log = (t, kind, detail) => events.push({ id: nid('ev'), task_id: t.id, project_id: t.project_id, actor_email: ME, kind, detail: JSON.stringify(detail || {}), created_at: nowIso() });
  const findTask = (id) => tasks.find((t) => t.id === id || (t.code && t.code === String(id).toUpperCase())) || fail(404, 'not_found', 'Task not found');
  const findProject = (id) => proj(id) || fail(404, 'not_found', 'Project not found');
  const touch = (o) => { o.updated_at = nowIso(); return o; };

  const FIELDS = ['title', 'description', 'priority', 'owner_email', 'start_date', 'due_date', 'due_time', 'section_id', 'project_id', 'parent_id', 'waiting_on_email', 'waiting_on_task', 'appeal_code', 'source_code', 'fund_code', 'campaign_code', 'expense_id', 'status'];

  function applyPatch(t, b) {
    for (const k of FIELDS) if (k in b) t[k] = b[k] === '' ? null : b[k];
    if ('done' in b) {
      t.status = b.done ? 'done' : 'open';
      t.done_at = b.done ? nowIso() : null;
      t.done_by = b.done ? ME : null;
      log(t, b.done ? 'done' : 'reopened');
    }
    if ('waiting_on_email' in b || 'waiting_on_task' in b) {
      if (t.waiting_on_email || t.waiting_on_task) t.status = 'waiting';
      else if (t.status === 'waiting') t.status = 'open';
    }
    if (b.move) {
      const m = b.move;
      if ('section_id' in m) t.section_id = m.section_id || null;
      const sibs = tasks.filter((x) => x.id !== t.id && x.project_id === t.project_id && x.section_id === t.section_id && !x.parent_id).sort((a, c) => a.sort - c.sort);
      let at = sibs.length;
      if (m.before) at = Math.max(0, sibs.findIndex((x) => x.id === m.before));
      else if (m.after) at = sibs.findIndex((x) => x.id === m.after) + 1;
      sibs.splice(at, 0, t);
      sibs.forEach((x, i) => { x.sort = (i + 1) * 1000; });
      log(t, 'moved', m);
    }
    touch(t);
  }

  const api = {
    async projects() {
      const list = projects.filter(canSee).map(shapeProject);
      const mine = tasks.filter((t) => t.owner_email === ME && t.status !== 'done' && t.status !== 'dropped');
      return delay({ ok: true, projects: list, mine: { open: mine.length, overdue: mine.filter(isOverdue).length, dueToday: mine.filter((t) => t.due_date === today()).length } });
    },
    async project(id) {
      const p = findProject(id);
      if (!canSee(p)) fail(403, 'forbidden', 'You do not have access to this project.');
      const s = shapeProject(p);
      return delay({ ok: true, project: s, sections: sections.filter((x) => x.project_id === p.id).sort((a, b) => a.sort - b.sort), members: (members.get(p.id) || []).map((e) => PEOPLE.find((x) => x.email === e)).filter(Boolean), counts: { open: s.open, done: s.done, overdue: s.overdue } });
    },
    async createProject(b) {
      if (!b || !String(b.name || '').trim()) fail(400, 'missing_field', 'name is required');
      const key = (b.key || b.name.replace(/[^A-Za-z]/g, '').slice(0, 3)).toUpperCase().padEnd(2, 'X');
      if (projects.some((p) => p.key === key)) fail(409, 'key_taken', `The key ${key} is already used.`);
      const p = { id: nid('prj'), key, name: b.name.trim(), description: b.description || '', team: b.team || '', lead_email: b.lead_email || ME, visibility: b.visibility || 'staff', status: 'active', color: b.color || 'leaf', start_date: b.start_date || null, due_date: b.due_date || null, chat_channel_id: null, drive_folder_id: null, next_num: 1, created_by: ME, created_at: nowIso(), updated_at: nowIso() };
      projects.push(p);
      members.set(p.id, [...new Set([p.lead_email, ME, ...(b.members || [])])]);
      return delay({ ok: true, project: shapeProject(p) });
    },
    async patchProject(id, b) {
      const p = findProject(id);
      for (const k of ['name', 'description', 'team', 'lead_email', 'visibility', 'status', 'color', 'start_date', 'due_date']) if (k in b) p[k] = b[k];
      if (b.archive) p.status = 'archived';
      touch(p);
      return delay({ ok: true, project: shapeProject(p) });
    },
    async createSection(id, b) {
      const p = findProject(id);
      const name = typeof b === 'string' ? b : b && b.name;
      if (!String(name || '').trim()) fail(400, 'missing_field', 'name is required');
      const mx = Math.max(0, ...sections.filter((s) => s.project_id === p.id).map((s) => s.sort));
      const s = { id: nid('sec'), project_id: p.id, name: String(name).trim(), sort: mx + 1000 };
      sections.push(s);
      return delay({ ok: true, section: s });
    },
    async patchSection(id, sid, b) {
      const s = sections.find((x) => x.id === sid) || fail(404, 'not_found', 'Section not found');
      if ('name' in b) s.name = b.name;
      if ('sort' in b) s.sort = Number(b.sort);
      return delay({ ok: true, section: s });
    },
    async deleteSection(id, sid) {
      const i = sections.findIndex((x) => x.id === sid);
      if (i < 0) fail(404, 'not_found', 'Section not found');
      sections.splice(i, 1);
      tasks.forEach((t) => { if (t.section_id === sid) t.section_id = null; });
      return delay({ ok: true });
    },
    async members(id, b) {
      const p = findProject(id);
      const cur = new Set(members.get(p.id) || []);
      (b.add || []).forEach((e) => cur.add(e));
      (b.remove || []).forEach((e) => cur.delete(e));
      members.set(p.id, [...cur]);
      return delay({ ok: true, members: [...cur].map((e) => PEOPLE.find((x) => x.email === e)).filter(Boolean) });
    },

    async tasks(q = {}) {
      let list = tasks.filter((t) => !t.project_id || canSee(proj(t.project_id)) || t.owner_email === ME);
      if (q.project) { const p = findProject(q.project); list = list.filter((t) => t.project_id === p.id); }
      if (q.owner) { const e = q.owner === 'me' ? ME : q.owner; list = list.filter((t) => t.owner_email === e); }
      const st = q.status || 'open';
      if (st === 'open') list = list.filter((t) => t.status !== 'done' && t.status !== 'dropped');
      else if (st === 'done') list = list.filter((t) => t.status === 'done');
      else list = list.filter((t) => t.status !== 'dropped');
      if (q.parent) list = list.filter((t) => t.parent_id === findTask(q.parent).id);
      else if (!('parent' in q)) list = list.filter((t) => !t.parent_id);
      if (q.q) { const n = String(q.q).toLowerCase(); list = list.filter((t) => `${t.title} ${t.code || ''} ${t.description}`.toLowerCase().includes(n)); }
      if (q.from || q.to) {
        const from = q.from || '0000-00-00';
        const to = q.to || '9999-99-99';
        list = list.filter((t) => { const a = t.start_date || t.due_date; const z = t.due_date || t.start_date; return a && z && a <= to && z >= from; });
      }
      list.sort((a, b) => (a.sort - b.sort) || a.id.localeCompare(b.id));
      const total = list.length;
      const off = Number(q.offset) || 0;
      const lim = Number(q.limit) || 500;
      return delay({ ok: true, tasks: list.slice(off, off + lim).map(shapeTask), total });
    },
    async task(id) {
      const t = findTask(id);
      const pe = peopleRows.filter((x) => x.task_id === t.id);
      const emails = [...new Set([t.owner_email, t.created_by, ...pe.map((x) => x.email), ...comments.filter((c) => c.task_id === t.id).map((c) => c.author_email)].filter(Boolean))];
      const told = {};
      emails.forEach((e) => { told[e] = true; });
      return delay({
        ok: true,
        task: shapeTask(t),
        subtasks: tasks.filter((x) => x.parent_id === t.id).sort((a, b) => a.sort - b.sort).map(shapeTask),
        comments: comments.filter((c) => c.task_id === t.id && !c.deleted_at).map((c) => ({ ...c, mentions: JSON.parse(c.mentions), author: person(c.author_email) })),
        files: files.filter((f) => f.task_id === t.id),
        events: events.filter((e) => e.task_id === t.id).map((e) => ({ ...e, detail: JSON.parse(e.detail) })),
        deps: { blockedBy: blockedBy(t).map(ref), blocks: deps.filter((d) => d.depends_on === t.id).map((d) => tasks.find((x) => x.id === d.task_id)).filter(Boolean).map(ref) },
        people: [...pe.map((x) => ({ ...(PEOPLE.find((p) => p.email === x.email) || { email: x.email, name: x.email }), role: x.role })), ...(t.owner_email ? [{ ...PEOPLE.find((p) => p.email === t.owner_email), role: 'owner' }] : [])],
        told,
      });
    },
    async createTask(b) {
      if (!b || !String(b.title || '').trim()) fail(400, 'missing_field', 'title is required');
      const p = b.project_id ? findProject(b.project_id) : null;
      const sibs = tasks.filter((t) => t.project_id === (p ? p.id : null) && t.section_id === (b.section_id || null));
      const t = blank({
        id: nid('tsk'), project_id: p ? p.id : null, section_id: b.section_id || null, code: p ? `${p.key}-${pad(p.next_num++, 4)}` : null,
        title: String(b.title).trim().slice(0, 300), sort: Math.max(0, ...sibs.map((x) => x.sort)) + 1000, owner_email: b.owner_email === undefined ? (p ? null : ME) : b.owner_email || null,
        created_by: ME,
      });
      for (const k of ['description', 'priority', 'start_date', 'due_date', 'parent_id', 'appeal_code', 'source_code', 'fund_code', 'campaign_code', 'request_id', 'meeting_id', 'meeting_action_idx', 'chat_message_id']) if (b[k] !== undefined && b[k] !== '') t[k] = b[k];
      tasks.push(t);
      (b.followers || []).forEach((e) => peopleRows.push({ task_id: t.id, email: e, role: 'follower' }));
      log(t, 'created');
      return delay({ ok: true, task: shapeTask(t) });
    },
    async patchTask(id, b) {
      const t = findTask(id);
      applyPatch(t, b || {});
      return delay({ ok: true, task: shapeTask(t) });
    },
    async deleteTask(id) {
      const t = findTask(id);
      t.status = 'dropped';
      log(t, 'dropped');
      return delay({ ok: true });
    },
    async comment(id, b) {
      const t = findTask(id);
      if (!String((b && b.body) || '').trim()) fail(400, 'missing_field', 'body is required');
      const c = { id: nid('cm'), task_id: t.id, author_email: ME, body: b.body, mentions: JSON.stringify(b.mentions || []), source: 'hub', chat_message_id: null, created_at: nowIso(), edited_at: null, deleted_at: null };
      comments.push(c);
      return delay({ ok: true, comment: { ...c, mentions: b.mentions || [], author: person(ME) } });
    },
    async patchComment(id, cid, b) {
      const c = comments.find((x) => x.id === cid) || fail(404, 'not_found', 'Comment not found');
      c.body = b.body;
      c.edited_at = nowIso();
      return delay({ ok: true, comment: { ...c, mentions: JSON.parse(c.mentions), author: person(c.author_email) } });
    },
    async deleteComment(id, cid) {
      const c = comments.find((x) => x.id === cid) || fail(404, 'not_found', 'Comment not found');
      c.deleted_at = nowIso();
      return delay({ ok: true });
    },
    async addFile(id, b) {
      const t = findTask(id);
      const f = { id: nid('fl'), task_id: t.id, kind: b.kind || 'link', name: b.name || 'File', url: b.url || '', ref_id: b.ref_id || null, mime: b.mime || null, size: b.size || null, added_by: ME, added_at: nowIso() };
      files.push(f);
      return delay({ ok: true, file: f });
    },
    async deleteFile(id, fid) {
      const i = files.findIndex((x) => x.id === fid);
      if (i >= 0) files.splice(i, 1);
      return delay({ ok: true });
    },
    async upload(id, file) {
      return api.addFile(id, { kind: 'upload', name: file.name, mime: file.type, size: file.size, url: '' });
    },
    async people(id, b) {
      const t = findTask(id);
      (b.add || []).forEach((x) => { if (!peopleRows.some((r2) => r2.task_id === t.id && r2.email === x.email && r2.role === x.role)) peopleRows.push({ task_id: t.id, ...x }); });
      (b.remove || []).forEach((x) => { const i = peopleRows.findIndex((r2) => r2.task_id === t.id && r2.email === x.email && r2.role === x.role); if (i >= 0) peopleRows.splice(i, 1); });
      return delay({ ok: true, people: peopleRows.filter((x) => x.task_id === t.id) });
    },
    async deps(id, b) {
      const t = findTask(id);
      for (const d of b.add || []) {
        const other = findTask(d);
        const reach = (from, to, seen = new Set()) => from === to || (!seen.has(from) && seen.add(from) && deps.filter((x) => x.task_id === from).some((x) => reach(x.depends_on, to, seen)));
        if (other.id === t.id || reach(other.id, t.id)) fail(400, 'cycle', 'That would make a task wait on itself.');
        if (!deps.some((x) => x.task_id === t.id && x.depends_on === other.id)) deps.push({ task_id: t.id, depends_on: other.id });
      }
      for (const d of b.remove || []) { const i = deps.findIndex((x) => x.task_id === t.id && x.depends_on === d); if (i >= 0) deps.splice(i, 1); }
      return delay({ ok: true, deps: { blockedBy: blockedBy(t).map(ref), blocks: deps.filter((x) => x.depends_on === t.id).map((x) => tasks.find((y) => y.id === x.task_id)).filter(Boolean).map(ref) } });
    },
    async codes(kind, q) {
      const n = String(q || '').toLowerCase();
      return delay({ ok: true, codes: (CODES[kind] || []).filter(([c, d]) => !n || `${c} ${d}`.toLowerCase().includes(n)).map(([code, description]) => ({ code, description })) });
    },
    async notices() {
      const mine = notices.filter((n) => n.email === ME).map((n) => ({ ...n, actor: person(n.actor_email), task: shapeTask(findTask(n.task_id)) }));
      return delay({ ok: true, notices: mine, unread: mine.filter((n) => !n.read_at).length });
    },
    async readNotices(b) {
      notices.forEach((n) => { if (!b || b.all || (b.ids || []).includes(n.id)) n.read_at = n.read_at || nowIso(); });
      return api.notices();
    },
    async directory() {
      return delay({ ok: true, me: ME, people: PEOPLE });
    },
  };
  return api;
}
