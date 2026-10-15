// The first-day page: a welcome, the new hire's own steps, the first week, the people to meet and the FavorOS tour. Served by the FavorOS web app.
import { createFileRoute } from '@tanstack/react-router';
import { Failed, WelcomePage } from '../../features/welcome/WelcomePage';

export const Route = createFileRoute('/welcome/')({
  staticData: { nav: 'welcome', title: 'Welcome', layout: 'page' },
  component: WelcomePage,
  errorComponent: ({ error }) => (
    <div className="ob wl" id="wl-root">
      <Failed message={(error as Error).message || 'Something went wrong. Try again.'} />
    </div>
  ),
});
