// Moves inside the web app when the target is one of its routes, as a NavLink does, and loads the page whole otherwise.
import { useCallback } from 'react';
import { useRouter } from '@tanstack/react-router';
import { isInApp, useServedRoutes } from '@/shell/NavLink';
import { hubOv } from '@/lib/hubOv';

export function useGo(): (href: string) => void {
  const router = useRouter();
  const served = useServedRoutes();
  return useCallback(
    (href: string) => {
      if (isInApp(href, served)) hubOv.unwind(() => router.history.push(href));
      else location.href = href;
    },
    [router, served],
  );
}
