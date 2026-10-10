// Loaded on every hub page by the App layout: sound and motion, the guided tour, the Feedback form, and the meeting nudge.
import { initFeel } from './feel';
import { initTour } from './tour';
import { initFeedback } from './feedback';
import { initNudge } from './nudge';

initFeel();
initFeedback();
initTour();
initNudge();
