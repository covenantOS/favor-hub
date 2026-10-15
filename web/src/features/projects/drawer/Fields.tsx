// The fields block of the drawer: assignee, due date and time, project, section, priority, status, the Asana row and, under More fields,
// start date, waiting on, followers and the four Blackbaud codes. Same markup and class names as paintFields() in drawer.js.
import { useEffect, useRef } from 'react';
import { Avatar } from '../kit/Avatar';
import { Icon } from '../kit/Icon';
import { CODE_KINDS } from '../kit/pickers';
import { dueLabel, PRIORITY, STATUS } from '../lib/dates';
import type { Task } from '../types';
import { pickField, S, upd } from './state';

const nameOf = (email: string | null | undefined): string => (email ? S.staff.nameOf(email) : '');

function DateField({ field, label, v, extra }: { field: 'due' | 'start'; label: string; v: string | null; extra?: React.ReactNode }) {
  return (
    <>
      <button
        type="button"
        className={'rt-pchip pj-fbtn' + (v ? '' : ' is-empty')}
        data-f={field}
        aria-label={`${label}: ${v ? dueLabel(v) : 'No date'}`}
        onClick={(e) => void pickField(field, e.currentTarget)}
      >
        <Icon name="cal" />
        <span>{v ? dueLabel(v) : 'No date'}</span>
      </button>
      {v ? (
        <button type="button" className="pj-fclear" data-f={field + '-clear'} aria-label={`Clear ${label.toLowerCase()}`} onClick={(e) => void pickField(field + '-clear', e.currentTarget)}>
          <Icon name="x" />
        </button>
      ) : null}
      {extra}
    </>
  );
}

/** A time input that saves on the browser's own change event (when a whole time is set), not on each key. */
function TimeInput({ value }: { value: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = () => void upd({ due_time: el.value || null });
    el.addEventListener('change', on);
    return () => el.removeEventListener('change', on);
  }, []);
  return <input ref={ref} type="time" className="rt-date pj-time" data-f="time" defaultValue={value} key={value} aria-label="Due time (Eastern)" />;
}

export function Fields({ t }: { t: Task }) {
  const late = t.overdue;
  const follow = S.people.filter((p) => p.email !== t.owner_email);
  const sec = S.sections ? (S.sections.find((s) => s.id === t.section_id) || { name: undefined }).name : t.section;
  const asanaUrl = typeof t.asana_url === 'string' && /^https?:[/][/]/i.test(t.asana_url) ? t.asana_url : '';
  const waitName = t.waiting_on_email ? nameOf(t.waiting_on_email) : '';

  const timeBits = t.due_date ? (
    t.due_time ? (
      <>
        <TimeInput value={t.due_time} />
        <button type="button" className="pj-fclear" data-f="time-clear" aria-label="Clear the time" onClick={(e) => void pickField('time-clear', e.currentTarget)}>
          <Icon name="x" />
        </button>
      </>
    ) : (
      <button type="button" className="rt-pchip pj-fbtn is-empty" data-f="time-add" onClick={(e) => void pickField('time-add', e.currentTarget)}>
        <Icon name="clock" />
        <span>Add time</span>
      </button>
    )
  ) : null;

  return (
    <>
      <dl className="rt-fields pj-fields">
        <div className="rt-field">
          <dt>Assignee</dt>
          <dd>
            {t.owner_email ? (
              <button type="button" className="rt-pchip" data-f="owner" onClick={(e) => void pickField('owner', e.currentTarget)}>
                <Avatar p={t.owner} />
                <span className="rt-pchip__t">
                  <b>{t.owner ? t.owner.name : nameOf(t.owner_email)}</b>
                </span>
              </button>
            ) : (
              <button type="button" className="rt-pchip pj-fbtn is-empty" data-f="owner" onClick={(e) => void pickField('owner', e.currentTarget)}>
                <Avatar p={null} />
                <span>Unassigned</span>
              </button>
            )}
          </dd>
        </div>
        <div className="rt-field">
          <dt>Due</dt>
          <dd>
            <DateField field="due" label="Due date" v={t.due_date} extra={timeBits} />
            {late ? <span className="pj-late">Overdue</span> : null}
          </dd>
        </div>
        <div className="rt-field">
          <dt>Project</dt>
          <dd>
            {t.project ? (
              <span className="rt-pstatic">
                <i className="pj-dot" data-c={t.project.color} />
                <span>{t.project.name}</span>
              </span>
            ) : (
              <span className="rt-pstatic">
                <span>Personal task</span>
              </span>
            )}
          </dd>
        </div>
        {t.project_id ? (
          <div className="rt-field">
            <dt>Section</dt>
            <dd>
              <button type="button" className={'rt-pchip pj-fbtn' + (sec ? '' : ' is-empty')} data-f="section" onClick={(e) => void pickField('section', e.currentTarget)}>
                <Icon name="list" />
                <span>{sec || 'No section'}</span>
              </button>
            </dd>
          </div>
        ) : null}
        <div className="rt-field">
          <dt>Priority</dt>
          <dd>
            <button type="button" className="rt-pchip pj-fbtn" data-f="priority" onClick={(e) => void pickField('priority', e.currentTarget)}>
              {t.priority === 'normal' ? (
                <Icon name="flag" />
              ) : (
                <span className={'pj-pri pj-pri--' + t.priority}>
                  <Icon name="flag" />
                </span>
              )}
              <span>{PRIORITY[t.priority] || 'Normal'}</span>
            </button>
          </dd>
        </div>
        <div className="rt-field">
          <dt>Status</dt>
          <dd>
            <button type="button" className="rt-pchip pj-fbtn" data-f="status" onClick={(e) => void pickField('status', e.currentTarget)}>
              <i className="pj-sdot" data-s={t.status} />
              <span>{STATUS[t.status] || t.status}</span>
            </button>
          </dd>
        </div>
        {asanaUrl ? (
          <div className="rt-field">
            <dt>Asana</dt>
            <dd>
              <span className="pj-asana">
                Synced with Asana
                <a href={asanaUrl} target="_blank" rel="noopener noreferrer">
                  Open in Asana
                </a>
              </span>
            </dd>
          </div>
        ) : null}
      </dl>
      <details className="pj-more">
        <summary>More fields</summary>
        <dl className="rt-fields pj-fields">
          <div className="rt-field">
            <dt>Start</dt>
            <dd>
              <DateField field="start" label="Start date" v={t.start_date} />
            </dd>
          </div>
          <div className="rt-field">
            <dt>Waiting on</dt>
            <dd>
              {t.waiting_on_email ? (
                <>
                  <button type="button" className="rt-pchip" data-f="waiting" onClick={(e) => void pickField('waiting', e.currentTarget)}>
                    <Avatar p={S.staff.personOf(t.waiting_on_email)} />
                    <span className="rt-pchip__t">
                      <b>{waitName}</b>
                    </span>
                  </button>
                  <button type="button" className="pj-fclear" data-f="waiting-clear" aria-label="Clear waiting on" onClick={(e) => void pickField('waiting-clear', e.currentTarget)}>
                    <Icon name="x" />
                  </button>
                </>
              ) : (
                <button type="button" className="rt-pchip pj-fbtn is-empty" data-f="waiting" onClick={(e) => void pickField('waiting', e.currentTarget)}>
                  <Icon name="hourglass" />
                  <span>Nobody</span>
                </button>
              )}
            </dd>
          </div>
          <div className="rt-field">
            <dt>Following</dt>
            <dd className="pj-follow">
              {follow.map((p) => (
                <span key={p.email} className="pj-fchip" title={p.name}>
                  <Avatar p={p} />
                  <span>{p.name.split(' ')[0]}</span>
                  <button type="button" data-f="unfollow" data-email={p.email} aria-label={'Stop ' + p.name + ' following'} onClick={(e) => void pickField('unfollow', e.currentTarget, { email: p.email })}>
                    <Icon name="x" />
                  </button>
                </span>
              ))}
              <button type="button" className="rt-pchip pj-fbtn is-empty" data-f="follow" onClick={(e) => void pickField('follow', e.currentTarget)}>
                <Icon name="plus" />
                <span>Add</span>
              </button>
            </dd>
          </div>
          <div className="rt-field rt-field--codes">
            <dt>Codes</dt>
            <dd className="pj-codegrid">
              {CODE_KINDS.map((k) => (
                <button
                  key={k.kind}
                  type="button"
                  className={'pj-codebtn' + (t[k.field] ? ' is-set' : '')}
                  data-f="code"
                  data-kind={k.kind}
                  data-field={k.field}
                  onClick={(e) => void pickField('code', e.currentTarget, { kind: k.kind, field: k.field })}
                >
                  <small>{k.label}</small>
                  <b>{t[k.field] ? (t[k.field] as string) : 'Add'}</b>
                </button>
              ))}
            </dd>
          </div>
        </dl>
      </details>
    </>
  );
}
