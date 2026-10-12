import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import type { RouterContext } from '@/router';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { Shell } from '@/shell/Shell';

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Root,
  notFoundComponent: () => (
    <div className="h-card r2t-clear">
      That page is not part of the new FavorOS yet. <Link to="/">Back to Today</Link>
    </div>
  ),
});

function Root() {
  return (
    <Shell>
      <ErrorBoundary label="This page could not load.">
        <Outlet />
      </ErrorBoundary>
    </Shell>
  );
}
