// The four Admin settings tabs that are one settings list: Work Center, Receipts, Giving statements, Expenses. Each is the classic page's head, lede and area.
import { NavLink } from '@/shell/NavLink';
import { AdminSettingsPage } from './AdminSettings';

export const WorkCenterSettingsPage = () => <AdminSettingsPage area="work" on="work" title="Work Center" />;
export const ReceiptsSettingsPage = () => <AdminSettingsPage area="receipts" on="receipts" title="Receipts" />;
export const ExpensesSettingsPage = () => <AdminSettingsPage area="expenses" on="expenses" title="Expenses" />;

export const StatementsSettingsPage = () => (
  <AdminSettingsPage area="statements" on="statements" title="Giving statements" fact="Every line that prints on a statement.">
    <p className="ad-card__meta">
      <NavLink href="/statements/?tab=wording">Open the Statements page</NavLink> to read the wording as it prints, or{' '}
      <a href="/api/statements/sample" target="_blank" rel="noopener">
        open a sample statement
      </a>
      .
    </p>
  </AdminSettingsPage>
);
