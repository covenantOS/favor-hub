// "Open in Google Sheets" (React twin of src/components/SheetsButton.astro). public/js/sheets.js runs the export: this component loads it once the
// page is idle and registers what the button sends. The button carries data-sheets="<name>" like the classic one.
import { useEffect, useRef } from 'react';
import { loadScript } from '@/lib/legacy';

type Spec = () => unknown;
interface Sheets {
  register: (name: string, build: Spec) => void;
  screen: (title: string, tabs: unknown[], opts?: unknown) => unknown;
}
export const sheets = (): Sheets => (window as unknown as { FavorSheets: Sheets }).FavorSheets;

/** build gets FavorSheets so it can call screen(); it may throw a short message the export shows. */
export function SheetsButton({ name, build }: { name: string; build: (fs: Sheets) => unknown }) {
  const latest = useRef(build);
  latest.current = build;
  useEffect(() => {
    let live = true;
    loadScript('/js/sheets.js?v=2')
      .then(() => {
        const fs = (window as unknown as { FavorSheets?: Sheets }).FavorSheets;
        if (!live || !fs) return;
        fs.register(name, () => latest.current(fs));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [name]);
  return (
    <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-sheets={name}>
      <svg className="h-i" viewBox="0 0 24 24" aria-hidden="true" style={{ width: 16, height: 16 }}>
        <path d="M6 2.5h8.5L19 7v13.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1z" fill="#0f9d58" stroke="none" />
        <path d="M14.5 2.5V7H19" fill="#87ceac" stroke="none" />
        <rect x="8" y="10.5" width="8" height="7" rx=".5" fill="#fff" stroke="none" />
        <path d="M8 13h8M8 15.3h8M11 10.5v7" stroke="#0f9d58" strokeWidth=".9" fill="none" />
      </svg>
      Open in Google Sheets
    </button>
  );
}
