// The Intake view for people who triage: the team's pipeline as five columns (Intake, Triage, In progress, Review, Done) with a card per
// request. Cards drag between stages through the page's TaskCtx, so the server's own rules run (a card leaving Intake tells the person
// who asked, landing in Done ticks the card and sends the done email). A card opens in the drawer, where IntakeSlot shows the triage
// panel (Accept, Ask a question, Decline). A person who triages more than one team gets a switcher.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import type { IntakeItem, IntakeTeam } from '@shared/intake-model';
import { kindLabel } from '@shared/request-parse';
import { Avatar, firstName } from '../kit/Avatar';
import { dnd } from '../kit/dnd';
import { toast } from '../kit/toast';
import { openDrawer } from '../drawer';
import { useStaff } from '../lib/staff';
import { TaskCtx, isTmp, useCtx } from '../lib/store';
import { useSearchParams, useSetSearch } from '../lib/url';
import type { Task } from '../types';
import { intakeKeys } from './api';
import { columnsFor, fullDate, waitingOn, when, type PipeCard } from './logic';
import { intakeQueueQuery, intakeTeamsQuery } from './queries';
import './intake.css';

const STAGE_LINE = 'Intake, Triage, In progress, Review, Done';
const DONE_PAGE = 20;

export function IntakeBoard() {
  const { data } = useSuspenseQuery(intakeTeamsQuery);
  const search = useSearchParams();
  const setSearch = useSetSearch();
  const teams = data.teams;
  if (!teams.length) return <div className="ik-fallback">Intake is for the people who triage requests. Yours are under My requests.</div>;
  const team = teams.find((t) => t.team === search.get('team')) || teams[0];
  return (
    <>
      <div className="ik-crumbs">
        {teams.length > 1 ? (
          <div className="pj-chips" role="group" aria-label="Team">
            {teams.map((t) => (
              <button key={t.team} type="button" className={'pj-fchipbtn' + (t.team === team.team ? ' is-on' : '')} aria-pressed={t.team === team.team} onClick={() => setSearch((p) => p.set('team', t.team), 'replace')}>
                {t.name}
                {t.counts.intake ? ' ' + t.counts.intake : ''}
              </button>
            ))}
          </div>
        ) : null}
        <b>{team.project.name}</b>
        <span>{STAGE_LINE}</span>
      </div>
      <Pipeline key={team.team} team={team} />
    </>
  );
}

function Pipeline({ team }: { team: IntakeTeam }) {
  const staff = useStaff();
  const qc = useQueryClient();
  const ctx = useMemo(() => {
    const c = new TaskCtx('project', staff, { showDone: true });
    c.loading = true;
    return c;
    // one store per team
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team.project.key]);
  useCtx(ctx);
  useEffect(() => {
    void ctx.load(team.project.key);
  }, [ctx, team.project.key]);

  const open = useQuery(intakeQueueQuery(team.team, 'open'));
  const all = useQuery(intakeQueueQuery(team.team, 'all'));
  const items = useMemo(() => {
    const m = new Map<string, IntakeItem>();
    for (const i of all.data || []) m.set(i.id, i);
    for (const i of open.data || []) m.set(i.id, i);
    return [...m.values()];
  }, [open.data, all.data]);

  const [doneShown, setDoneShown] = useState(DONE_PAGE);
  const rootRef = useRef<HTMLDivElement>(null);
  const sections = ctx.sections.length ? ctx.sections : team.sections.map((s, i) => ({ id: s.id, project_id: team.project.id, name: s.name, sort: i }));
  const cols = columnsFor(sections, ctx.tasks, items, { doneLimit: doneShown, counts: ctx.projectCounts?.by_section || null });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: intakeKeys.all });
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return dnd(root, {
      item: '.ik-card',
      zone: '.pj-col',
      body: '[data-cards]',
      scrollX: '.ik-board',
      canStart: (item) => !isTmp(item.dataset.id),
      onDrop: async (d) => {
        const t = ctx.by.get(d.id);
        if (!t || !d.zone) return;
        const same = d.zone === t.section_id;
        const ok = await ctx.move(d.id, { section_id: d.zone, before: d.beforeId || undefined, after: d.afterId || undefined });
        if (!ok) return;
        refresh();
        if (!same) toast('Moved to ' + (ctx.sectionName(d.zone) || 'the new stage'));
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  const openCard = (t: Task) => {
    if (isTmp(t.id)) return;
    void openDrawer(ctx, t.code || t.id);
  };

  if (ctx.error) {
    return (
      <div className="pj-empty pj-empty--err">
        <p>{ctx.error}</p>
        <button type="button" className="pj-btn" onClick={() => void ctx.load(team.project.key)}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="pj-board ik-board" role="group" aria-label={`${team.name} requests`} ref={rootRef} aria-busy={ctx.loading || undefined}>
      {cols.map((c) => {
        const more = c.stage === 'Done' ? Math.max(0, c.total - c.cards.length) : 0;
        return (
          <section key={c.id} className={'pj-col ik-col' + (c.stage === 'Intake' ? ' ik-col--intake' : '')} data-zone={c.id} role="group" aria-label={c.name}>
            <header className="ik-col__h">
              <h3>{c.name}</h3>
              <span className="pj-sec__n">{ctx.loading ? '' : c.total}</span>
              <small>{c.word}</small>
            </header>
            <div className={'pj-col__cards' + (ctx.loading ? ' ik-col__wait' : '')} data-cards data-empty={ctx.loading ? '' : c.stage === 'Intake' ? 'Nothing waiting' : 'Nothing here'}>
              {c.cards.map((card) => (
                <IntakeCard key={card.task.id} card={card} onOpen={openCard} />
              ))}
            </div>
            {more ? (
              <button type="button" className="pj-showmore" onClick={() => setDoneShown((n) => n + 40)}>
                Show {Math.min(more, 40)} more of {more}
              </button>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/** One request on the board: its code, title, how it was sorted, when it is needed, who asked and whether it waits on them. */
function IntakeCard({ card, onOpen }: { card: PipeCard; onOpen: (t: Task) => void }) {
  const { task: t, item } = card;
  const waiting = item ? waitingOn(item) : '';
  const asker = item?.submitter || null;
  const who = asker || t.owner;
  const stamp = item ? when(item.created_at) : t.done_at ? 'done ' + when(t.done_at) : '';
  const key = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen(t);
    }
  };
  return (
    <article
      className={'pj-card ik-card' + (t.overdue ? ' is-late' : '') + (t.pending ? ' is-pending' : '')}
      data-id={t.id}
      role="button"
      tabIndex={0}
      aria-label={(t.code ? t.code + ', ' : '') + t.title}
      onClick={() => onOpen(t)}
      onKeyDown={key}
    >
      {t.code ? <span className="ik-card__code">{t.code}</span> : null}
      <span className="ik-card__t">{t.title}</span>
      <span className="ik-row">
        {item ? (
          <>
            <span className="ik-tag">{item.place_label}</span>
            <span className="ik-tag">{kindLabel(item.kind)}</span>
          </>
        ) : null}
        {t.due_date ? <span className={'ik-tag' + (t.overdue ? ' ik-tag--late' : '')}>Due {fullDate(t.due_date)}</span> : null}
        {waiting ? <span className="ik-tag ik-tag--wait">{waiting}</span> : null}
      </span>
      {who ? (
        <span className="ik-foot">
          <Avatar p={who} size="sm" />
          <span className="ik-foot__nm">{firstName(who)}</span>
          {stamp ? (
            <span className="ik-muted">
              <time suppressHydrationWarning>{stamp}</time>
            </span>
          ) : null}
        </span>
      ) : null}
    </article>
  );
}
