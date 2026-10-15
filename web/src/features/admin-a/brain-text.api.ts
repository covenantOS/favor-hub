// Text Favor Brain: the one read behind the page. Light on purpose: the route file imports this module (never a component).
import { queryOptions } from '@tanstack/react-query';
import { hubGet } from '../../lib/hub';

export interface TextStatus {
  live?: boolean;
  registered?: boolean;
  phone?: string;
  since?: string;
}
export type Answer = { status: TextStatus } | { error: string };

/** The status read, or the words the page shows when it did not load. */
export const textStatusQuery = queryOptions({
  queryKey: ['brain', 'text', 'status'] as const,
  queryFn: async (): Promise<Answer> => {
    try {
      return { status: (await hubGet('/api/brain/text/status')) as TextStatus };
    } catch (e) {
      return { error: (e as Error).message || 'This could not load. Reload the page.' };
    }
  },
  staleTime: 5_000,
  retry: false,
});

