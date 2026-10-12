import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { NeedsCards } from '@/features/today/sections';
import type { TodayCard } from '@shared/schemas';
import { today } from '../../e2e/fixtures';

// Today's cards are links, and a link needs a router around it.
function inRouter(node: React.ReactNode) {
  const root = createRootRoute({ component: () => <>{node}</> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/'] }) });
  return render(<RouterProvider router={router} />);
}

function Boom(): never {
  throw new Error('boom');
}

describe('error boundary', () => {
  it('shows its message with a retry and leaves the rest alone', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <div>
        <p>outside</p>
        <ErrorBoundary label="The card could not load.">
          <Boom />
        </ErrorBoundary>
      </div>
    );
    expect(screen.getByText('outside')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('The card could not load.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('Needs you', () => {
  it('draws a tile per card with its number and a snooze button', async () => {
    const { container } = inRouter(<NeedsCards cards={today.cards as TodayCard[]} />);
    await screen.findByText('Requests');
    expect(container.querySelectorAll('.r2t-tile')).toHaveLength(3);
    expect(container.querySelectorAll('[data-snooze="hub"]')).toHaveLength(3);
    expect(container.querySelector('.r2t-tile--urgent')?.textContent).toContain('Receipts');
    expect(container.textContent).toContain('$1,250.50');
  });
  it('says so when nothing is waiting', async () => {
    inRouter(<NeedsCards cards={[]} />);
    expect(await screen.findByText(/Nothing is waiting on you/)).toBeTruthy();
  });
});
