// New partner record pieces (household giving, contact marks, communication preferences, documents) show to admins and the test
// accounts only until Will opens them to staff (2026-10-15).
import { isTester } from '../testuser';
import type { WorkUser } from './gate';

export const recordPreview = (wu: WorkUser): boolean => wu.user.role === 'admin' || isTester(wu.user.email);
