// The phone app's start page (/m/): the address the installed app opens (manifest id /m/). Chat, Meetings and Favor Brain open from
// here; the page holds the settings that belong to the phone itself, notifications and Data saver.
import { createFileRoute } from '@tanstack/react-router';
import { PhoneStart } from '../../features/phone-start/PhoneStart';

export const Route = createFileRoute('/m/')({
  staticData: { title: 'FavorOS', layout: 'page' },
  component: PhoneStart,
});
