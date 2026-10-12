// Which entity card is open. One card at a time, anywhere in the app; chips and the Ctrl K results open it, <EntityHost> in the shell draws it.
import type { EntityKind } from '@shared/schemas';

export interface CardRef {
  kind: EntityKind;
  id: string;
  label: string;
  /** The element the card hangs from. Absent for a card opened from search, which shows as a sheet. */
  anchor?: HTMLElement | null;
  sheet?: boolean;
}

type Fn = () => void;

class EntityStore {
  private cur: CardRef | null = null;
  private subs = new Set<Fn>();
  subscribe = (f: Fn) => {
    this.subs.add(f);
    return () => this.subs.delete(f);
  };
  getSnapshot = () => this.cur;
  openCard(kind: string, id: string, label: string, anchor?: HTMLElement | null, sheet = false) {
    if (this.cur && this.cur.kind === kind && this.cur.id === id) return;
    this.cur = { kind: kind as EntityKind, id, label, anchor, sheet: sheet || !anchor };
    this.subs.forEach((f) => f());
  }
  close() {
    if (!this.cur) return;
    this.cur = null;
    this.subs.forEach((f) => f());
  }
}

export const entityStore = new EntityStore();

/** Ids are matched the way the server matches them: people by lower-case email, task and appeal codes in capitals. */
export const normId = (kind: string, id: string) => {
  const v = String(id || '').trim();
  return kind === 'person' ? v.toLowerCase() : kind === 'task' || kind === 'appeal' ? v.toUpperCase() : v;
};

export const KIND_LABEL: Record<string, string> = {
  person: 'Colleague',
  partner: 'Partner',
  fund: 'Fund',
  appeal: 'Appeal code',
  task: 'Task',
  request: 'Request',
  meeting: 'Meeting',
  clip: 'Clip',
  course: 'Course',
  file: 'File',
};

/** The question each card's Ask Brain button sends (/brain/?ask=). */
export function askText(kind: string, title: string, id: string, lookup?: string): string {
  switch (kind) {
    case 'person':
      return 'What is on ' + title + "'s plate?";
    case 'partner':
      return 'Tell me about ' + (lookup ? 'lookup ' + lookup : title);
    case 'fund':
      return 'How is the ' + title + ' fund doing this year?';
    case 'appeal':
      return 'How did appeal ' + id + ' do?';
    case 'task':
      return 'What is the status of task ' + id + ' (' + title + ')?';
    case 'request':
      return 'What is the status of the request "' + title + '"?';
    case 'meeting':
      return 'Summarize the meeting "' + title + '"';
    case 'clip':
      return 'What is in the clip "' + title + '"?';
    case 'course':
      return 'What does the course "' + title + '" cover?';
    default:
      return 'Tell me about ' + title;
  }
}
