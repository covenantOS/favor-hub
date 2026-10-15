// Admin > Meetings (/admin/meetings/): who can use Meetings, guests, meeting size, the recording folder and the reminder lead time.
// Port of src/pages/admin/meetings/index.astro; the settings rows are the shared Admin settings tab in features/admin-settings.
import { SettingsArea } from '../../admin-settings/SettingsArea';

export function MeetingsSettingsPage() {
  return <SettingsArea area="meetings" on="meetings" title="Meetings" />;
}
