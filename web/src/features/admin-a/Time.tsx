// Times that depend on "now" ("Today 6:20 AM ET") can differ by a minute or a day boundary between the server's draw and the browser's, so the text
// is allowed to differ at hydration.
import { when, day, ago, full } from './format';

export const When = ({ iso }: { iso?: string | null }) => <span suppressHydrationWarning>{when(iso)}</span>;
export const Day = ({ iso }: { iso?: string | null }) => <span suppressHydrationWarning>{day(iso)}</span>;
export const Ago = ({ iso }: { iso?: string | null }) => <span suppressHydrationWarning>{ago(iso)}</span>;
export const Full = ({ iso }: { iso?: string | null }) => <span suppressHydrationWarning>{full(iso)}</span>;
