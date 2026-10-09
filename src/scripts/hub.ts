// Loaded on every hub page by the App layout: sound and motion, the guided tour, and the Feedback form.
import { initFeel } from './feel';
import { initTour } from './tour';
import { initFeedback } from './feedback';

initFeel();
initFeedback();
initTour();
