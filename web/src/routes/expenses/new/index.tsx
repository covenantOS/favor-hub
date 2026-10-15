// Staff > Expenses > New expense request. ?reason= carries the words typed in Make a request.
import { createFileRoute } from '@tanstack/react-router';
import { NewExpensePage } from '../../../features/expenses/NewExpensePage';

export const Route = createFileRoute('/expenses/new/')({
  staticData: { nav: 'expense', title: 'Expense request', layout: 'page' },
  validateSearch: (s: Record<string, unknown>) => s,
  component: NewExpensePage,
});
