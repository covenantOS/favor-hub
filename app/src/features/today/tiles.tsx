import { BrainMark, PathIcon } from '@/shell/Icon';

// Today's tiles keep their own small icon set and one color per tool (the shared tool tokens in r2-today.css), as public/js/today.js did.
const ICON: Record<string, string> = {
  meetings: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
  requests: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
  tasks: '<path d="M4 12 20 4l-4 16-4-6z"/><path d="m12 14 8-10"/>',
  'tasks-waiting': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  'tasks-news': '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  expenses: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6"/><path d="M9 11h6"/><path d="M9 15h4"/>',
  receipts: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  feedback: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8"/><path d="M8 12h5"/>',
  learn: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21a2 2 0 0 1 2-2h13v2"/><path d="M8 7h7"/><path d="M8 11h5"/>',
  foundations: '<path d="M3 21h18"/><path d="M5 21V10"/><path d="M19 21V10"/><path d="M9 21V10"/><path d="M15 21V10"/><path d="m2 10 10-6 10 6z"/>',
  'projects-due': '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12.5 2.5 2.5 4.5-5.5"/>',
  'projects-assigned': '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  'projects-news': '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h8"/>',
  dot: '<circle cx="12" cy="12" r="3"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
};

const TOOL: Record<string, string> = {
  requests: 'sky',
  'projects-due': 'leaf',
  'projects-assigned': 'leaf',
  'projects-news': 'leaf',
  tasks: 'sky',
  'tasks-waiting': 'sun',
  'tasks-news': 'sky',
  expenses: 'sky',
  receipts: 'sky',
  brain: 'dusk',
  meetings: 'teal',
  feedback: 'sun',
  foundations: 'leaf',
  learn: 'sun',
};

export const tool = (id: string) => TOOL[String(id || '').toLowerCase()] || 'slate';

/** A tile icon by card id or app name. Favor Brain shows its ring of light. */
export function TileIcon({ name }: { name: string }) {
  const n = String(name || '').toLowerCase();
  if (n === 'brain') return <BrainMark state="still" />;
  return <PathIcon d={ICON[n] || ICON.dot} />;
}

export const Glyph = ({ name }: { name: 'arrow' | 'check' | 'clock' }) => <PathIcon d={ICON[name]} />;
