// Requests inside Projects. The home page uses ../home/intakeTabs (the button and the tabs) and calls useIntakeParams once; the drawer
// renders IntakeSlot for a request card. Everything else here is the screens those pieces open.
export { IntakeSlot } from './slot';
export { openComposer } from './Composer';
export { openEmailPrefs } from './EmailPrefs';
export { useIntakeParams } from './hooks';
export { MyRequests } from './MyRequests';
export { IntakeBoard } from './IntakeBoard';
export { prefetchIntake, intakeMineQuery, intakeTeamsQuery } from './queries';
export { intakeApi, intakeKeys } from './api';
export { INTAKE_ADDRESSES } from './README-model';
