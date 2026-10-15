// Admin > Fundraiser goals: every fundraiser's goals in FavorOS, edited here. Admins only (the API refuses everyone else).
import { createFileRoute } from '@tanstack/react-router';
import { GoalsPage } from '../../../features/goals/GoalsPage';

export const Route = createFileRoute('/admin/goals/')({
  staticData: { nav: 'admin-goals', title: 'Fundraiser goals', layout: 'wide' },
  component: GoalsPage,
});
