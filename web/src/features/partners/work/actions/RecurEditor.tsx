// "Repeat this follow-up": the switch and the rule (every N days, weeks or months, until stopped or a number of times).
// Port of recurHTML / readRecur in public/js/work-edit.js.

export interface RecurRule {
  every: number;
  unit: string;
  left: number | null;
  until?: string | null;
}
export interface RecurDraft {
  on: boolean;
  every: string;
  unit: string;
  end: string;
}
const TIMES = [2, 3, 4, 6, 12];

/** The editor's fields from a rule Blackbaud holds (or none: off, every 1 month, until stopped). */
export function recurDraft(r?: RecurRule | null): RecurDraft {
  const v = r || { every: 1, unit: 'month', left: null, until: null };
  return { on: !!r, every: String(v.every), unit: v.unit, end: v.left && TIMES.includes(v.left) ? 'n' + v.left : '' };
}
/** The rule to send, or null when repeating is off. */
export function recurOut(d: RecurDraft): { every: number; unit: string; left: number | null } | null {
  if (!d.on) return null;
  return { every: Number(d.every) || 1, unit: d.unit, left: d.end ? Number(d.end.slice(1)) : null };
}

export function RecurEditor({ value, onChange }: { value: RecurDraft; onChange: (v: RecurDraft) => void }) {
  const set = (p: Partial<RecurDraft>) => onChange({ ...value, ...p });
  return (
    <div className={'ep-recur' + (value.on ? ' is-on' : '')}>
      <label className="wc-toggle">
        <input type="checkbox" checked={value.on} onChange={(e) => set({ on: e.target.checked })} />
        Repeat this follow-up
      </label>
      <span className="ep-recur__rule">
        Every <input type="number" min={1} max={52} value={value.every} aria-label="How often" onChange={(e) => set({ every: e.target.value })} />
        <select aria-label="Unit" value={value.unit} onChange={(e) => set({ unit: e.target.value })}>
          <option value="day">days</option>
          <option value="week">weeks</option>
          <option value="month">months</option>
        </select>
        <select aria-label="Ends" value={value.end} onChange={(e) => set({ end: e.target.value })}>
          <option value="">until I stop it</option>
          {TIMES.map((n) => (
            <option key={n} value={'n' + n}>
              {n} more times
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}
