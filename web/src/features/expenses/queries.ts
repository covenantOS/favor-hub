// The reads behind the expense screens. Light on purpose: route files import this module (never a component) so the first-screen
// script stays under the budget. Each read answers with a state instead of throwing for the answers a page expects (signed out, not on
// the approver list, a link that is not valid), so a Suspense boundary only ever sees real failures.
import { queryOptions } from '@tanstack/react-query';
import { ExpenseError, readJson, sendJson } from './api';
import { DEFAULT_MILEAGE, type ExpenseRequest, type Mileage } from './logic';

export const expKeys = {
  mine: ['expenses', 'mine'] as const,
  log: ['expenses', 'log'] as const,
  review: (token: string, id: string) => ['expenses', 'review', token || id] as const,
  mileage: ['expenses', 'mileage'] as const,
  me: ['expenses', 'me'] as const,
};

export type MineState = { state: 'ok'; requests: ExpenseRequest[] } | { state: 'signin' } | { state: 'error'; message: string };

export const mineQuery = queryOptions({
  queryKey: expKeys.mine,
  queryFn: async (): Promise<MineState> => {
    try {
      const d = await readJson('/api/expenses?mine=1');
      return { state: 'ok', requests: (d.requests as ExpenseRequest[]) || [] };
    } catch (e) {
      if (e instanceof ExpenseError && (e.status === 401 || e.code === 'signin')) return { state: 'signin' };
      return { state: 'error', message: (e as Error).message };
    }
  },
  staleTime: 20_000,
});

export interface LogSettings {
  approver_name: string;
  approver_email: string;
  distribution: string[];
  viewers?: string[];
}
export interface Override {
  id: string;
  name: string;
  email: string;
  start_date: string;
  end_date: string;
}
export type LogState =
  | { state: 'ok'; requests: ExpenseRequest[]; settings: LogSettings; mileage: Mileage; overrides: Override[]; viaGoogle: boolean; signinOn: boolean }
  | { state: 'none' }
  | { state: 'locked' }
  | { state: 'signin' };

/** The expense log and the approver settings. Browser only: the log carries every signature, so it is not drawn on the server. */
export const logQuery = queryOptions({
  queryKey: expKeys.log,
  queryFn: async (): Promise<LogState> => {
    const me = await readJson('/api/auth/me').catch(() => ({}) as Record<string, unknown>);
    const user = (me as { user?: { via?: string } }).user;
    const viaGoogle = Boolean((me as { signedIn?: boolean }).signedIn && user && user.via === 'google');
    const signinOn = Boolean((me as { enforce?: boolean }).enforce);
    try {
      const [list, set] = await Promise.all([readJson('/api/expenses?sigs=0'), readJson('/api/expenses/settings')]);
      return {
        state: 'ok',
        requests: (list.requests as ExpenseRequest[]) || [],
        settings: set.settings as LogSettings,
        mileage: set.mileage as Mileage,
        overrides: (set.overrides as Override[]) || [],
        viaGoogle,
        signinOn,
      };
    } catch (e) {
      const code = e instanceof ExpenseError ? e.code : '';
      if (code === 'signin') return { state: 'signin' };
      // A plain requester sees My requests only; the full log is for approvers.
      if (code === 'not_on_list') return { state: 'none' };
      return { state: 'locked' };
    }
  },
  staleTime: 20_000,
});

export const mileageQuery = queryOptions({
  queryKey: expKeys.mileage,
  queryFn: async (): Promise<Mileage> => {
    try {
      const d = await readJson('/api/expenses/mileage-rate');
      return d && d.ok ? { rate_cents: Number(d.rate_cents), deduction_miles: Number(d.deduction_miles) } : DEFAULT_MILEAGE;
    } catch {
      return DEFAULT_MILEAGE;
    }
  },
  staleTime: 5 * 60_000,
});

export type ReviewState =
  | { state: 'none' }
  | { state: 'signin' }
  | { state: 'ok'; request: ExpenseRequest; signer: string }
  | { state: 'error'; message: string; code: string };

export const reviewQuery = (token: string, id: string) =>
  queryOptions({
    queryKey: expKeys.review(token, id),
    queryFn: async (): Promise<ReviewState> => {
      if (!token && !id) return { state: 'none' };
      try {
        const d = await readJson('/api/expenses/review?' + (token ? 'token=' + encodeURIComponent(token) : 'id=' + encodeURIComponent(id)));
        return { state: 'ok', request: d.request as ExpenseRequest, signer: String(d.signer || '') };
      } catch (e) {
        if (e instanceof ExpenseError && e.status === 401 && e.code === 'signin') return { state: 'signin' };
        const err = e instanceof ExpenseError ? e : new ExpenseError((e as Error).message || 'This link is not valid.');
        return { state: 'error', message: err.message || 'This link is not valid.', code: err.code };
      }
    },
    // The page holds this answer while someone signs; a decision removes it (ReviewPage), so the next visit reads the new status.
    staleTime: Infinity,
  });

export { sendJson };
