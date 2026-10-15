// Today. Reached when an admin lists "/" in the hub setting web.routes (scripts/web-routes.mjs set / admin).
import { createFileRoute } from '@tanstack/react-router';
import { TODAY_FRAME } from '@hub/data/today-skeleton';
import '@hub/styles/today2.css';
import '@hub/styles/work-home.css';
import '@hub/styles/qa2-workhome.css';
import '@hub/styles/today3.css';
import { TodayPage } from '../features/today/TodayPage';

// Today's reads together take longer than the Worker's server read allows (React error 419, then the cards remounted and the page jumped),
// so the data is drawn in the browser. The server sends the classic frame, whose placeholders are the size of the finished cards.
const Frame = () => <div className="td" id="td-root" dangerouslySetInnerHTML={{ __html: TODAY_FRAME }} />;

export const Route = createFileRoute('/')({
  staticData: { nav: 'home', title: 'Today', layout: 'page' },
  ssr: false,
  pendingComponent: Frame,
  component: TodayPage,
});
