// Whether the person signed in is an admin. The contact marks, communication preferences and household giving blocks on the partner
// record are admin-only while the web page is held to the same content as the classic one.
import { useSuspenseQuery } from '@tanstack/react-query';
import { navQuery } from '../../../lib/queries';

export function useIsAdmin(): boolean {
  const { data } = useSuspenseQuery(navQuery);
  return (data.user as { role?: string } | undefined)?.role === 'admin';
}
