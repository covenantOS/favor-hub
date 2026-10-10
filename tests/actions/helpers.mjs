// Made-up rows for the engine tests. No real partner, address or id appears here: the repository is public.
export const TODAY = '2026-10-09';

export const act = (o) => ({
  id: '1', constituentId: '100', category: 'Task/Other', type: 'RDD Action', completed: false, completedDate: null, rawStatus: 'Open', computedStatus: 'Open',
  dueDate: '2026-10-01', dateAdded: '2026-09-28', dateModified: '2026-09-28', summary: '', description: '', fundraisers: ['9001'], ...o,
});

export const gift = (o) => ({
  id: '500', giverId: '100', softCreditIds: [], fundraiserIds: ['9001'], amount: 42.49, giftDate: '2026-09-27', enteredDate: '2026-09-28', type: 'Donation', status: 'Active', ...o,
});

// A slim open row as the repo's SQL returns it
export const openRow = (o) => ({
  id: '1', cid: '100', due: '2026-10-01T00:00:00', added: '2026-09-28T10:00:00', modified: '2026-09-28T10:00:00', type: 'RDD Action', category: 'Task/Other',
  summary: '', description: '', completed: 0, completed_date: null, status: 'Open', computed: 'PastDue', frs: '["9001"]', lookup: '10001', partner: 'Ada Example',
  city: 'Tampa', st: 'FL', deceased: 0, priority: 'Normal', ...o,
});

export const slimGift = (o) => ({ id: '500', cid: '100', amount: 42.49, gift_date: '2026-09-27T00:00:00', added: '2026-09-28T09:00:00', gift_type: 'Donation', gift_status: 'Active', soft: '[]', credits: '[]', splits: '[{"fund_id":"7"}]', ...o });

export const people = {
  9001: { n: 'Fay Alpha', team: 'RDD', active: 1, left: null, listed: 1 },
  9002: { n: 'Gus Bravo', team: 'Partner Care', active: 1, left: null, listed: 1 },
  9003: { n: 'Hal Gone', team: 'RDD', active: 0, left: '2026-09-01', listed: 1 },
  9004: { n: 'Ivy Never', team: '', active: 0, left: null, listed: 0 },
  9005: { n: 'Support Person', team: 'Support', active: 1, left: null, listed: 1 },
};
