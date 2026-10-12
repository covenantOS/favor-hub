// An invented partner with one gift of each kind, so the wording can be read on a real page. Nothing here is a person.
import { composeStatement, type Names, type PartnerInfo, type RawGift, type Statement } from './rules';

export const SAMPLE_PARTNER: PartnerInfo = {
  id: '900000001',
  lookup: '900001',
  name: 'Sample Partner',
  addressee: 'Sam and Pat Sample',
  sortName: 'sample sam',
  organization: false,
  addressLines: ['100 Example Street'],
  city: 'Anytown',
  state: 'FL',
  zip: '33000',
  country: 'United States',
  email: '',
  constituency: ['Partner'],
};

const NAMES: Names = {
  fund: (id) => ({ f1: 'Where Needed Most', f2: 'Portable Bible Schools', f3: 'Non Tax Deductible: Misc Reimbursements' })[id] || '',
  appealCategory: () => '',
};

const gift = (id: string, date: string, cents: number, over: Partial<RawGift> = {}): RawGift => ({
  id,
  lookup: id,
  giverId: SAMPLE_PARTNER.id,
  giverName: 'Sam and Pat Sample',
  date,
  cents,
  type: 'Donation',
  status: 'Active',
  method: 'PersonalCheck',
  reference: '',
  anonymous: false,
  splits: [{ cents, fundId: 'f1', appealId: '' }],
  soft: [],
  ...over,
});

export function sampleStatement(year: number): Statement {
  const y = String(year);
  const gifts: RawGift[] = [
    gift('s1', `${y}-01-15`, 5000),
    gift('s2', `${y}-02-15`, 5000, { type: 'RecurringGiftPayment', method: 'CreditCard' }),
    gift('s3', `${y}-03-15`, 5000, { type: 'RecurringGiftPayment', method: 'CreditCard' }),
    gift('s4', `${y}-04-02`, 25000, { splits: [{ cents: 25000, fundId: 'f2', appealId: '' }] }),
    gift('s5', `${y}-06-20`, 150000, { reference: 'Stock gift, sample shares' }),
    gift('s6', `${y}-08-09`, 2500, { splits: [{ cents: 2500, fundId: 'f3', appealId: '' }] }),
    gift('s7', `${y}-09-12`, -1000),
    gift('s8', `${y}-10-30`, 100000, { giverId: '900000002', giverName: 'Sample Giving Fund', soft: [{ id: SAMPLE_PARTNER.id, cents: 100000 }] }),
  ];
  return composeStatement(SAMPLE_PARTNER, gifts, `${y}-01-01`, `${y}-12-31`, NAMES, { includeSoft: true });
}
