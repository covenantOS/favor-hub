// A time written relative to now ("Today 9:05 AM ET"): the server and the browser can disagree by a minute or a day boundary, so the text may differ at hydration.
import { when, ago, full } from './format';

export function When({ iso }: { iso?: string | null }) {
  return <span suppressHydrationWarning>{when(iso)}</span>;
}
export function Ago({ iso }: { iso?: string | null }) {
  return <span suppressHydrationWarning>{ago(iso)}</span>;
}
export function Full({ iso }: { iso?: string | null }) {
  return <>{full(iso)}</>;
}
