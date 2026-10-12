// A stand-in for the Asana REST API, built from the documented response shapes (data envelope, next_page.offset, opt_fields,
// 429 with Retry-After). Every name, email and file in it is invented. It records each request so a test can prove the importer
// only ever sends GET requests.
export function makeAsana({ rateLimitOnce = [], expireOffsets = [] } = {}) {
  const users = {
    ada: { gid: '1', name: 'Ada Admin', email: 'ada@favorintl.org' },
    vic: { gid: '2', name: 'Vic Video', email: 'vic@favorintl.org' },
    dan: { gid: '3', name: 'Dan Design', email: 'dan@favorintl.org' },
    zed: { gid: '9', name: 'Zed Contractor', email: 'zed@outside.example' },
  };
  const sections = {
    P1: [{ gid: 'S1', name: 'Needs To Be Assigned' }, { gid: 'S2', name: 'Open Projects' }, { gid: 'S3', name: 'Closed Projects' }, { gid: 'S4', name: 'Vacation' }],
    P2: [{ gid: 'S5', name: 'Untitled section' }, { gid: 'S6', name: 'Drafts' }],
  };
  const cf = (name, type, display, extra = {}) => ({ gid: 'cf' + name, name, type, display_value: display, ...extra });
  const tasks = [];
  const add = (t) => {
    tasks.push(t);
    return t;
  };
  // 45 tasks in P1 so the list needs three pages of 20.
  for (let i = 1; i <= 45; i++) {
    const sec = sections.P1[i % 4];
    add({
      gid: 'T' + i,
      name: 'Task number ' + i,
      notes: i % 5 === 0 ? 'Notes for task ' + i : '',
      completed: i % 7 === 0,
      completed_at: i % 7 === 0 ? '2026-09-0' + (1 + (i % 8)) + 'T15:00:00.000Z' : null,
      completed_by: i % 7 === 0 ? { gid: '2', name: 'Vic Video', email: 'vic@favorintl.org' } : null,
      created_at: '2026-08-01T12:00:00.000Z',
      created_by: users.ada,
      modified_at: '2026-09-15T12:00:00.000Z',
      assignee: i % 3 === 0 ? users.vic : i % 3 === 1 ? users.dan : i === 44 ? users.zed : null,
      start_on: i % 10 === 0 ? '2026-09-01' : null,
      start_at: null,
      due_on: i % 4 === 0 ? null : '2026-10-' + String(1 + (i % 28)).padStart(2, '0'),
      due_at: i === 2 ? '2026-10-03T22:30:00.000Z' : null,
      parent: null,
      num_subtasks: i === 1 ? 2 : 0,
      followers: i === 1 ? [users.dan] : [],
      tags: i === 1 ? [{ name: 'Print' }, { name: 'Rush' }] : [],
      custom_fields: [
        cf('Priority', 'enum', i % 3 === 0 ? 'High' : i % 3 === 1 ? 'Low' : 'Medium'),
        cf('Requester', 'people', 'Dan Design', { people_value: [users.dan] }),
        cf('On Behalf Of', 'text', i === 3 ? 'Sue Nobody' : ''),
        cf('Status', 'enum', i === 4 ? 'In Progress' : i === 5 ? 'Waiting' : ''),
      ].filter((f) => f.display_value || (f.people_value && f.people_value.length)),
      memberships: [{ project: { gid: 'P1', name: 'Marketing Daily' }, section: sec }, ...(i === 6 ? [{ project: { gid: 'P2', name: 'Site Work' }, section: sections.P2[1] }] : [])],
      permalink_url: 'https://app.asana.example/0/P1/T' + i,
      resource_subtype: 'default_task',
    });
  }
  const sub = (g, parent, name) => ({
    gid: g, name, notes: '', completed: false, created_at: '2026-08-02T12:00:00.000Z', modified_at: '2026-08-02T12:00:00.000Z', parent: { gid: parent },
    num_subtasks: 0, assignee: users.vic, custom_fields: [], tags: [], followers: [], memberships: [],
  });
  const subtasks = { T1: [sub('ST1', 'T1', 'Collect photos'), sub('ST2', 'T1', 'Proof the layout')] };
  add({
    gid: 'T100', name: 'Site task one', notes: 'Fix the footer', completed: false, created_at: '2026-08-05T12:00:00.000Z', modified_at: '2026-09-05T12:00:00.000Z',
    assignee: users.ada, due_on: '2026-10-20', parent: null, num_subtasks: 0, custom_fields: [], tags: [], followers: [],
    memberships: [{ project: { gid: 'P2', name: 'Site Work' }, section: sections.P2[0] }],
  });
  add({
    gid: 'T101', name: 'Site task two', notes: '', completed: false, created_at: '2026-08-06T12:00:00.000Z', modified_at: '2026-09-06T12:00:00.000Z', assignee: null,
    parent: null, num_subtasks: 0, custom_fields: [], tags: [], followers: [], memberships: [{ project: { gid: 'P2', name: 'Site Work' }, section: sections.P2[1] }],
  });
  const stories = {
    T1: [
      { gid: 'C1', created_at: '2026-08-03T12:00:00.000Z', created_by: users.vic, text: 'First draft is in the folder.', type: 'comment', resource_subtype: 'comment_added' },
      { gid: 'C2', created_at: '2026-08-04T12:00:00.000Z', created_by: users.zed, text: 'Looks good from outside.', type: 'comment', resource_subtype: 'comment_added' },
      { gid: 'C3', created_at: '2026-08-04T13:00:00.000Z', created_by: users.ada, text: 'Ada assigned to Vic', type: 'system', resource_subtype: 'assigned' },
    ],
  };
  const attachments = {
    T1: [
      { gid: 'A1', name: 'flyer-proof.pdf', host: 'asana', size: 2048, download_url: 'https://files.invalid/A1', permanent_url: 'https://app.asana.example/att/A1', created_at: '2026-08-03T12:00:00.000Z', resource_subtype: 'asana' },
      { gid: 'A2', name: 'raw-footage.mov', host: 'asana', size: 900 * 1024 * 1024, download_url: 'https://files.invalid/A2', permanent_url: 'https://app.asana.example/att/A2', created_at: '2026-08-03T12:00:00.000Z', resource_subtype: 'asana' },
      { gid: 'A3', name: 'Brand folder', host: 'gdrive', size: null, download_url: '', permanent_url: 'https://drive.example/folder/abc', created_at: '2026-08-03T12:00:00.000Z', resource_subtype: 'external' },
    ],
  };
  const deps = { T2: ['T3'], T8: ['T3', 'T999'], T10: ['T11'], T11: ['T10'] };
  const files = { A1: 'pdf-bytes-0123456789' };
  const requests = [];
  const limited = new Set(rateLimitOnce);
  const expired = new Set(expireOffsets);
  const page = (list, params) => {
    const limit = Number(params.get('limit')) || 100;
    const off = Number(params.get('offset')) || 0;
    return { data: list.slice(off, off + limit), next_page: off + limit < list.length ? { offset: String(off + limit), path: '/x', uri: 'x' } : null };
  };
  const fetchFn = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || 'GET';
    requests.push({ method, path: url.pathname, auth: (init.headers && init.headers.Authorization) || '' });
    if (url.hostname === 'files.invalid') {
      const g = url.pathname.slice(1);
      if (!files[g]) return new Response('gone', { status: 403 });
      return new Response(files[g], { status: 200, headers: { 'content-type': 'application/pdf', 'content-length': String(files[g].length) } });
    }
    const p = url.pathname.replace('/api/1.0', '');
    const j = (b, status = 200, headers = {}) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', ...headers } });
    if (init.headers && init.headers.Authorization !== 'Bearer test-token') return j({ errors: [{ message: 'Not Authorized' }] }, 401);
    const key = method + ' ' + p;
    if (limited.has(key)) {
      limited.delete(key);
      return j({ errors: [{ message: 'rate' }] }, 429, { 'Retry-After': '2' });
    }
    let m;
    if (p === '/users/me') return j({ data: { ...users.ada, workspaces: [{ gid: 'W1', name: 'favorintl.org' }] } });
    if (p === '/projects') {
      const all = [
        { gid: 'P1', name: 'Marketing Daily', archived: false, color: 'green', team: { name: 'Marketing' }, owner: users.dan },
        { gid: 'P2', name: 'Site Work', archived: false, color: 'blue', team: { name: 'Tech' }, owner: users.ada },
        { gid: 'P3', name: 'Old Appeals 2022', archived: true, color: 'red', team: { name: 'Marketing' }, owner: users.dan },
      ];
      const want = url.searchParams.get('archived') === 'true';
      return j(page(all.filter((x) => x.archived === want), url.searchParams));
    }
    if ((m = p.match(/^\/projects\/(P\d)$/))) {
      const meta = {
        P1: { name: 'Marketing Daily', notes: 'Everything Marketing asks for.', color: 'green', owner: users.dan, members: [users.dan, users.vic, users.zed], start_on: null, due_on: null },
        P2: { name: 'Site Work', notes: '', color: 'blue', owner: users.ada, members: [users.ada], start_on: '2026-08-01', due_on: '2026-12-31' },
      }[m[1]];
      return j({ data: { gid: m[1], archived: false, created_at: '2026-01-01T00:00:00.000Z', permalink_url: 'https://app.asana.example/0/' + m[1], ...meta } });
    }
    if ((m = p.match(/^\/projects\/(P\d)\/sections$/))) return j(page(sections[m[1]], url.searchParams));
    if ((m = p.match(/^\/projects\/(P\d)\/task_counts$/))) return j({ data: { num_tasks: tasks.filter((t) => t.memberships.some((x) => x.project.gid === m[1])).length } });
    if (p === '/tasks') {
      const off = url.searchParams.get('offset');
      if (off && expired.has(off)) {
        expired.delete(off);
        return j({ errors: [{ message: 'offset: Invalid or expired offset token' }] }, 400);
      }
      const proj = url.searchParams.get('project');
      return j(page(tasks.filter((t) => t.memberships.some((x) => x.project.gid === proj)), url.searchParams));
    }
    if ((m = p.match(/^\/tasks\/(\w+)\/subtasks$/))) return j(page(subtasks[m[1]] || [], url.searchParams));
    if ((m = p.match(/^\/tasks\/(\w+)\/stories$/))) return j(page(stories[m[1]] || [], url.searchParams));
    if ((m = p.match(/^\/tasks\/(\w+)\/dependencies$/))) return j(page((deps[m[1]] || []).map((g) => ({ gid: g })), url.searchParams));
    if (p === '/attachments') return j(page(attachments[url.searchParams.get('parent')] || [], url.searchParams));
    return j({ errors: [{ message: 'not found' }] }, 404);
  };
  return { fetch: fetchFn, requests, tasks, users };
}
