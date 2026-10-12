import { createFileRoute } from '@tanstack/react-router';
import { TodayPage } from '@/features/today/TodayPage';

export const Route = createFileRoute('/')({
  component: TodayPage,
  staticData: { nav: 'home', title: 'Today', description: 'What is waiting on you across FavorOS.' },
});
