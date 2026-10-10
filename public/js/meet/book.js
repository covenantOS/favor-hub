// Booking comes in the next phase. Until then the page says so and offers the instant room.
import { $, api, toast } from './ui.js';
$('#mt-book').innerHTML = `<div class="h-card mt-card" style="max-width:640px;display:grid;gap:12px"><h2 class="mt-h2">Booking opens soon</h2><p class="mt-sub" style="font-size:14px;margin:0">Booking from everyone's Google Calendar is the next part of Meetings. For now, start a room and send the link.</p><div><button class="h-btn h-btn--primary" id="now">Start a meeting now</button></div></div>`;
$('#now').addEventListener('click', async () => {
  try { const r = await api('meetings', { method: 'POST', body: { title: 'Meeting', rec: 'notes', access: 'staff' } }); location.href = '/meet/room/?m=' + r.meeting.id; } catch (e) { toast(e.message); }
});
