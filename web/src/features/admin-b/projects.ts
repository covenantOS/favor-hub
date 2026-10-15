// Admin > Projects: the pure parts of the Asana import page (what a run sends, which buttons are live, what the report totals), kept here so a test can run them.

export interface ImportOptions {
  team: string;
  visibility: string;
  copyFiles: boolean;
  overwrite: boolean;
  map: string;
}
export const DEFAULT_OPTIONS: ImportOptions = { team: '', visibility: 'staff', copyFiles: true, overwrite: false, map: '' };

/** "name@gmail.com = name@favorintl.org" lines (a comma or a tab works as the divider too) as the object the route takes. */
export function emailMap(text: string): Record<string, string> {
  const map: Record<string, string> = {};
  String(text || '')
    .split(/\n/)
    .forEach((line) => {
      const m = line.split(/=|,|\t/).map((x) => x.trim());
      if (m.length === 2 && m[0] && m[1]) map[m[0].toLowerCase()] = m[1].toLowerCase();
    });
  return map;
}

export function importOptions(o: ImportOptions) {
  return { team: o.team, visibility: o.visibility, copyFiles: o.copyFiles, overwrite: o.overwrite, emailMap: emailMap(o.map) };
}

/** What one selection of projects, from one source and one export file, is called; a dry run only unlocks the import for the same key. */
export function pickedKey(picked: Record<string, string>, source: string, upload: string): string {
  return (
    Object.keys(picked)
      .sort()
      .join('|') +
    '|' +
    source +
    '|' +
    upload
  );
}

export const pickedList = (picked: Record<string, string>) => Object.keys(picked).map((k) => ({ ref: k, name: picked[k] }));

/** The body of POST ?p=runs. */
export function runBody(source: string, mode: 'dry' | 'import', picked: Record<string, string>, o: ImportOptions, upload: string) {
  const b: Record<string, unknown> = { source, mode, projects: pickedList(picked), options: importOptions(o) };
  if (source === 'export') b.upload = upload;
  return b;
}

/** Whether the Import button is live: a finished dry run on exactly this selection, and no run in progress. */
export const importReady = (lastDry: { id: string; key: string } | null, key: string, live: boolean) => !!lastDry && lastDry.key === key && !live;

export const isLive = (status?: string) => status === 'running' || status === 'waiting';

export interface ReportProject {
  name: string;
  key?: string;
  tasks: { create: number; update: number; same: number; kept: number; subtasks: number; alsoIn: number; errors: number };
  sections: { create: number; update: number; same: number };
  comments: { create: number; update: number; same: number };
  files: { copy: number; link: number; same: number };
  expected?: number | null;
  hubCount?: number | null;
  tags: number;
  fields: number;
  deps: number;
}

/** The totals under the report table. */
export function reportTotals(ps: ReportProject[]) {
  return ps.reduce((o, p) => ({ kept: o.kept + p.tasks.kept, also: o.also + p.tasks.alsoIn, err: o.err + p.tasks.errors, tags: o.tags + p.tags, fields: o.fields + p.fields, deps: o.deps + p.deps }), {
    kept: 0,
    also: 0,
    err: 0,
    tags: 0,
    fields: 0,
    deps: 0,
  });
}

/** The tasks the dry run found to make or update, named in the import confirm box. */
export function dryTasks(projects: Record<string, ReportProject> | undefined): number {
  if (!projects) return 0;
  return Object.keys(projects).reduce((n, k) => n + projects[k].tasks.create + projects[k].tasks.update, 0);
}

/** The address of a projects admin call: the part after /projects travels in ?p=, anything after a ? joins as more query. */
export function projectsUrl(path: string): string {
  const m = String(path).match(/^\/?([^?]*)\??(.*)$/) as RegExpMatchArray;
  return '/api/admin/projects' + (m[1] ? '?p=' + m[1] + (m[2] ? '&' + m[2] : '') : m[2] ? '?' + m[2] : '');
}
