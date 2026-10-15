// The hub's shared helper scripts that are not rewritten yet: Open in Google Sheets (sheets.js), the call-prep brief (prep.js), call mode,
// the letter composer and the communication panel (comm-picture.js). They stand alone and key on their own markup, so a React tab
// loads one when it is first needed and calls it. A route that replaces one retires it from here (docs/porting-to-react.md).
import { useEffect, useRef } from 'react';
import { layoutAssets, loadScript } from '@/lib/legacy';
import { SHEET_MARK_HTML } from './sheetmark';

type Win = Window & Record<string, any>;
const w = () => window as unknown as Win;

/** The versioned address the layout carries for a script, or a plain address when the layout does not list it. */
async function srcOf(name: string, fallback: string): Promise<string> {
  const { js } = await layoutAssets();
  return js.find((s) => s.includes('/' + name + '.js')) || fallback;
}

const NEEDS: Record<string, string[]> = {
  sheets: ['favor-ui', 'sheets'],
  thank: ['favor-ui', 'thank'],
  prep: ['favor-ui', 'thank', 'prep'],
  call: ['favor-ui', 'thank', 'call-mode'],
  comm: ['favor-ui', 'comm-picture'],
  letter: ['favor-ui', 'thank', 'work-letter'],
};
const FALLBACK: Record<string, string> = {
  'favor-ui': '/js/favor-ui.js?v=1',
  sheets: '/js/sheets.js?v=2',
  thank: '/js/thank.js?v=5',
  prep: '/js/prep.js?v=2',
  'call-mode': '/js/call-mode.js?v=1',
  'comm-picture': '/js/comm-picture.js?v=3',
  'work-letter': '/js/work-letter.js?v=2',
};

/** Load the scripts a helper needs, in order, once. */
export async function ensureLegacy(kind: keyof typeof NEEDS): Promise<void> {
  for (const name of NEEDS[kind]) await loadScript(await srcOf(name, FALLBACK[name]));
}

/* ------------------------------------------------------------------ Open in Google Sheets */

/** Tell sheets.js what the button named `name` sends. build runs when the button is pressed, so it reads the list as it is then. */
export function useSheetSource(name: string, build: () => unknown) {
  const ref = useRef(build);
  ref.current = build;
  useEffect(() => {
    let off = false;
    void ensureLegacy('sheets').then(() => {
      if (!off && w().FavorSheets) w().FavorSheets.register(name, () => ref.current());
    });
    return () => {
      off = true;
    };
  }, [name]);
}

/** The shared Open in Google Sheets button. sheets.js owns its text while it works, so React leaves the inside alone. */
export function SheetsButton({ name, label = 'Open in Google Sheets', className = 'h-btn h-btn--ghost h-btn--sm', title }: { name: string; label?: string; className?: string; title?: string }) {
  return <button type="button" className={className} data-sheets={name} title={title} aria-label={title} dangerouslySetInnerHTML={{ __html: SHEET_MARK_HTML + label }} />;
}

/** FavorSheets.screen(...) when the helper has loaded; the page builds its request through this. */
export function sheetScreen(title: string, tabs: { name: string; columns: { key: string; label: string; type: string }[]; rows: Record<string, unknown>[] }[], opts: { filters?: string; classes?: string[] } = {}) {
  return w().FavorSheets.screen(title, tabs, opts);
}

/* ------------------------------------------------------------------ the call-prep brief, call mode, letters */

export async function openPrep(cid: string, o: { gift?: string } = {}) {
  await ensureLegacy('prep');
  if (w().FavorPrep) w().FavorPrep.open(cid, o);
}
export async function openCallMode(cid: string, done?: () => void) {
  await ensureLegacy('call');
  if (w().FavorCall) w().FavorCall.open(cid, { done });
}
export async function openLetter(gifts: unknown[], o: { from?: string } = {}) {
  await ensureLegacy('letter');
  if (w().WCLetter) w().WCLetter.open(gifts, o);
}

/* ------------------------------------------------------------------ the communication panel */

/** The partner's communication history and preferences (comm-picture.js), drawn into this box. */
export function CommPanel({ cid, onFlag }: { cid: string; onFlag?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const flag = useRef(onFlag);
  flag.current = onFlag;
  useEffect(() => {
    let off = false;
    void ensureLegacy('comm').then(() => {
      if (!off && box.current && w().FavorComm) w().FavorComm.mount(box.current, cid, { canFlag: true, onFlag: () => flag.current && flag.current() });
    });
    return () => {
      off = true;
    };
  }, [cid]);
  // comm-picture.js owns the inside of this box.
  return <div className="cm-expand" ref={box} data-wcd-cm={cid} />;
}
