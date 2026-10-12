import { createContext, useContext, type AnchorHTMLAttributes, type MouseEvent } from 'react';
import { useRouter } from '@tanstack/react-router';
import { routeServed } from '@shared/app2';
import { hubOv } from '@/lib/hubOv';

/** The routes the app serves for this person right now. A link to one of them moves inside the app; any other link loads the classic page. */
export const ServedRoutes = createContext<string[]>(['/']);
export const useServedRoutes = () => useContext(ServedRoutes);

export const isInApp = (href: string, served: string[]): boolean => {
  if (!href.startsWith('/') || href.startsWith('//')) return false;
  if (/^\/(api|_app)\//.test(href)) return false;
  return routeServed(href.split('#')[0].split('?')[0], served);
};

type Props = AnchorHTMLAttributes<HTMLAnchorElement>;

/** An anchor that keeps the shell mounted when its target is a route of the app, and is a plain link otherwise. */
export function NavLink({ href = '/', onClick, target, ...rest }: Props) {
  const served = useServedRoutes();
  const router = useRouter();
  const inApp = !target && isInApp(href, served);
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || !inApp) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    hubOv.unwind(() => {
      router.history.push(href);
    });
  };
  return <a href={href} target={target} onClick={click} {...rest} />;
}
