// Writes the plan, workload and Friday-update API answers from an in-memory world, for the screenshot script. Invented people only.
import { writeFileSync } from 'node:fs';
import { ADA, DAN, FLO, OZZY, VIC, call, read, world } from './projects-support.mjs';
const w = world({ mode: 'staff' });
for (const f of ['favor-chat', 'favor-chat-private', 'google', 'projects-links', 'projects-plan']) w.d1.exec(read(`db/${f}.sql`));
const t = (u, a, b) => w.d1.db.prepare('UPDATE meet_directory SET title = ?, team = ? WHERE email = ?').run(a, b, u.email);
t(ADA, 'Lead Developer', 'Marketing'); t(VIC, 'Director of Media', 'Marketing'); t(DAN, 'Graphic Designer', 'Marketing'); t(FLO, 'Creative Director', 'Marketing'); t(OZZY, 'Uganda/SS Director', 'Leadership');
const out = {};
out.draft = (await call(w, ADA, 'POST', 'projects/plan/draft', { prompt: 'Banquet in Houston on December 6 for about 80 partners' })).data;
const { createTask } = await import('../functions/_lib/projects/tasks.ts');
const mk = async (u, n, due, extra = {}) => { for (let i = 0; i < n; i++) await createTask(w.env, { email: ADA.email, name: ADA.name, admin: true }, { title: `Task ${u.name} ${i}`, owner_email: u.email, due_date: due, ...extra }, { quiet: true }); };
const ins = w.d1.db.prepare(`INSERT INTO hub_tasks (id, title, status, owner_email, due_date, created_by, created_at, updated_at) VALUES (?, 'old', 'done', ?, ?, 'x', 'x', 'x')`);
let k = 0; const mondays = []; let d = new Date(); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 42);
for (let i = 0; i < 6; i++) { mondays.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 7); }
for (const m of mondays) for (let i = 0; i < 3; i++) ins.run('o' + k++, DAN.email, m);
const day = (n) => { const x = new Date(); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
await mk(DAN, 12, day(9)); await mk(DAN, 4, day(2)); await mk(VIC, 5, day(4)); await mk(VIC, 3, day(16)); await mk(FLO, 8, day(3), { priority: 'high' }); await mk(OZZY, 6, day(-6)); await mk(ADA, 2, day(5));
out.workload = (await call(w, ADA, 'GET', 'projects/workload?weeks=8')).data;
out.workload4 = out.workload;
await call(w, ADA, 'POST', 'projects', { name: 'Fall newsletter', key: 'FNL', members: [VIC.email, DAN.email] });
const a = (await call(w, ADA, 'POST', 'tasks', { title: 'Write the issue', project_id: 'FNL', owner_email: DAN.email, due_date: day(1) })).data.task;
const b = (await call(w, ADA, 'POST', 'tasks', { title: 'Pick the photos', project_id: 'FNL', owner_email: VIC.email, due_date: day(2) })).data.task;
await call(w, DAN, 'PATCH', `tasks/${a.code}`, { done: true }); await call(w, VIC, 'PATCH', `tasks/${b.code}`, { status: 'doing' });
out.statusDraft = (await call(w, ADA, 'GET', 'projects/FNL/status/draft')).data;
out.statusOff = (await call(w, ADA, 'GET', 'projects/FNL/status')).data;
writeFileSync('Q:/Temp/Will/projects-ai/canned.json', JSON.stringify(out, null, 1));
console.log('ok', out.draft.plan.sections.length, out.workload.people.length);
