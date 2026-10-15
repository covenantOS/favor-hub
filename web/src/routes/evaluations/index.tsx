// Work > Evaluations: my evaluation, the feedback I owe, my team's reviews and one evaluation (?c=ID&v=tab). Served by the FavorOS web app.
import { createFileRoute } from '@tanstack/react-router';
import { EvaluationsPage } from '../../features/evaluations/EvaluationsPage';
import { validateEvalSearch, type EvalSearch } from '../../features/evaluations/logic';

export const Route = createFileRoute('/evaluations/')({
  validateSearch: (raw: Record<string, unknown>): EvalSearch => validateEvalSearch(raw),
  staticData: { nav: 'evals', title: 'Evaluations', layout: 'page', navOf: (s) => (s.c ? { nav: 'evals', title: 'Evaluation' } : null) },
  component: EvaluationsRoute,
});

function EvaluationsRoute() {
  return <EvaluationsPage search={Route.useSearch()} />;
}
