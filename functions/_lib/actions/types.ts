// Plain shapes shared by the pure functions. Dates are 'YYYY-MM-DD' strings (America/New_York calendar day).
// Nothing here touches a database or the network.

export interface ActionRecord {
  id: string;
  constituentId: string;
  category: string | null; // Meeting, Phone call, Email, Mailing, Task/Other (spec 2.1)
  type: string | null; // null for the 341 untyped rows
  completed: boolean; // the Blackbaud completed flag, the only trusted completion signal (spec 0.1, 5.1 principle 3)
  completedDate: string | null; // absent on the 1,408 phantom completes
  rawStatus: string | null; // Open, Past due, Completed, Canceled as stored
  computedStatus: string | null; // Open, PastDue, Completed
  dueDate: string; // also the contact date for logged contacts (spec 4.13)
  dateAdded: string;
  dateModified: string;
  summary: string;
  description: string;
  fundraisers: string[];
  thanked?: boolean; // the Thanked custom field, when a tag row exists
}

export interface Gift {
  id: string;
  giverId: string;
  softCreditIds: string[]; // the people soft-credited, in stored order
  fundraiserIds: string[]; // fundraisers credited on the gift, largest credit first
  amount: number;
  giftDate: string;
  enteredDate: string;
  type: string; // Donation, RecurringGiftPayment, RecurringGift
  status: string; // Active, Terminated
}

export interface Fundraiser {
  id: string;
  name: string;
  type: string;
  active: boolean;
  endDate: string | null;
}

export interface Assignment {
  id: string;
  partnerId: string;
  fundraiserId: string;
  type: string;
  fromDate: string | null;
  toDate: string | null;
}

export type ObligationKind = 'personal_thanks' | 'hq_letter' | 'first_gift_followup' | 'review_record' | 'ctg_terminate' | 'cadence';
