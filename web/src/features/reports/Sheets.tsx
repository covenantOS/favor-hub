// "Open in Google Sheets" on a report (React twin of the classic data-sheets="reports" button). public/js/sheets.js runs the export: this component
// loads it once the page is idle and registers what the button sends (the report's own rows as a spec, read with ?format=sheet).
import { useEffect, useRef } from 'react';
import { loadScript } from '@/lib/legacy';

type Build = () => Promise<unknown> | null;
interface Sheets {
  register: (name: string, build: Build) => void;
}

export function ReportSheetsButton({ build }: { build: Build }) {
  const latest = useRef(build);
  latest.current = build;
  useEffect(() => {
    let live = true;
    loadScript('/js/sheets.js?v=2')
      .then(() => {
        const fs = (window as unknown as { FavorSheets?: Sheets }).FavorSheets;
        if (live && fs) fs.register('reports', () => latest.current());
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return (
    <button type="button" className="h-btn h-btn--primary h-btn--sm" data-sheets="reports">
      Open in Google Sheets
    </button>
  );
}
