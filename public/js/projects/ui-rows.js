/* Markup shared by the list, the board, My tasks and the drawer: checkboxes, code chips, owner and due buttons. */
import { esc, icon, avatar, dueLabel, isOverdue, todayStr, PRIORITY, STATUS } from './ui-util.js';
import { CODE_KINDS } from './ui-data.js';

export const KIND_LABEL = Object.fromEntries(CODE_KINDS.map((k) => [k.kind, k.label]));

export function checkBtn(t) {
  const done = t.status === 'done';
  return `<button type="button" class="pj-check${done ? ' is-on' : ''}" data-act="done" data-ui-tooltip="pj-tip" role="checkbox" aria-checked="${done}" aria-label="${done ? 'Mark not done' : 'Mark done'}: ${esc(t.title)}">${icon('check')}</button>`;
}

/** The task's codes as small chips. max limits how many show; the rest collapse into +n. */
export function codeChips(t, max = 4) {
  const list = CODE_KINDS.filter((k) => t[k.field]).map((k) => ({ k, v: t[k.field] }));
  if (!list.length) return '';
  const shown = list.slice(0, max);
  return `<span class="pj-codes">${shown.map((c) => `<span class="pj-code" data-k="${c.k.kind}" title="${esc(c.k.label)} code ${esc(c.v)}">${esc(c.v)}</span>`).join('')}${list.length > max ? `<span class="pj-code pj-code--more" title="${esc(list.slice(max).map((c) => c.k.label + ' ' + c.v).join(', '))}">+${list.length - max}</span>` : ''}</span>`;
}

export function dueHtml(t) {
  if (!t.due_date) return '';
  const late = isOverdue(t);
  return `<span class="pj-due${late ? ' is-late' : ''}${t.due_date === todayStr() && t.status !== 'done' ? ' is-today' : ''}">${esc(dueLabel(t.due_date, t.due_time))}</span>`;
}

export function counts(t) {
  const out = [];
  if (t.subtasks && t.subtasks.total) out.push(`<span class="pj-cnt" title="${t.subtasks.done} of ${t.subtasks.total} subtasks done">${icon('sub')}${t.subtasks.done}/${t.subtasks.total}</span>`);
  if (t.comments) out.push(`<span class="pj-cnt" title="${t.comments} comments">${icon('comment')}${t.comments}</span>`);
  if (t.files) out.push(`<span class="pj-cnt" title="${t.files} files">${icon('file')}${t.files}</span>`);
  return out.join('');
}

export function projChip(t) {
  const p = t.project;
  if (!p) return '';
  return `<span class="pj-pchip" data-c="${esc(p.color || 'leaf')}" title="${esc(p.name)}"><i class="pj-dot" data-c="${esc(p.color || 'leaf')}"></i>${esc(p.key)}</span>`;
}

export const stateTag = (t) => {
  const tags = [];
  if (t.blocked) tags.push(`<span class="pj-tag pj-tag--blocked" title="Waiting on another task">${icon('block')}Blocked</span>`);
  if (t.status === 'waiting') tags.push(`<span class="pj-tag pj-tag--wait" title="Waiting">${icon('hourglass')}Waiting</span>`);
  if (t.status === 'doing') tags.push('<span class="pj-tag pj-tag--doing">In progress</span>');
  return tags.join('');
};

export const priorityIcon = (t) => (t.priority && t.priority !== 'normal' ? `<span class="pj-pri pj-pri--${t.priority}" title="${PRIORITY[t.priority]} priority">${icon('flag')}</span>` : '');
export { STATUS };
export const ownerBtn = (t, size) => `<button type="button" class="pj-owner" data-act="owner" data-ui-tooltip="pj-tip" aria-label="${t.owner ? 'Owner ' + esc(t.owner.name) : 'No owner. Assign'}">${avatar(t.owner, size)}</button>`;
