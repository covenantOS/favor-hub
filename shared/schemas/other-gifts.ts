// Answers of /api/other-gifts/*: DAF, foundation, wire, stock and phone gifts entered in a batch with the soft credit, approved by a second person.
import { z } from 'zod';

const n = (d = 0) => z.number().default(d);
const s = (d = '') => z.string().default(d);

export const ogKindId = z.enum(['daf', 'foundation', 'wire', 'stock', 'phone']);
export type OgKindId = z.infer<typeof ogKindId>;

export const ogSummary = z
  .object({
    month: z.object({ label: s(), cents: n(), gifts: n(), softGifts: n() }).passthrough(),
    lastMonth: z.object({ label: s(), cents: n(), gifts: n() }).passthrough(),
    year: z.object({ cents: n(), gifts: n(), lastYearCents: n() }).passthrough(),
    waiting: z.object({ gifts: n(), cents: n() }).passthrough(),
    lettersToAttach: n(),
    windowDays: n(30),
  })
  .passthrough();
export type OgSummary = z.infer<typeof ogSummary>;

export const ogBatchRow = z
  .object({ id: z.string(), name: s(), status: s('open'), createdBy: s(), createdAt: s(), approvedBy: s(), gifts: n(), cents: n(), mine: z.boolean().default(false) })
  .passthrough();
export type OgBatchRow = z.infer<typeof ogBatchRow>;

export const ogIndex = z
  .object({
    ok: z.literal(true),
    me: z.object({ name: s(), email: s(), admin: z.boolean().default(false), canApprove: z.boolean().default(false) }).passthrough(),
    mode: s('off'),
    today: s(),
    summary: ogSummary,
    batches: z.array(ogBatchRow).default([]),
    funds: z.array(z.object({ id: z.string(), code: s(), name: s() })).default([]),
    appeals: z.array(z.object({ id: z.string(), code: s(), name: s(), category: s() })).default([]),
    kinds: z.array(z.object({ id: ogKindId, label: s(), needsLetter: z.boolean().default(false), needsSoft: z.boolean().default(false) })).default([]),
    defaultFund: s('79'),
  })
  .passthrough();
export type OgIndex = z.infer<typeof ogIndex>;

export const ogListRow = z
  .object({
    id: z.string(),
    source: z.enum(['hub', 'blackbaud']),
    date: s(),
    fromId: s(),
    fromName: s(),
    recommendedId: s(),
    recommendedName: s(),
    kind: s(),
    kindLabel: s(),
    fund: s(),
    amountCents: n(),
    letter: s('unknown'),
    check: s('approved'),
    checkBy: s(),
    batchId: s(),
    batchName: s(),
    giftId: s(),
  })
  .passthrough();
export type OgListRow = z.infer<typeof ogListRow>;

export const ogList = z
  .object({
    ok: z.literal(true),
    rows: z.array(ogListRow).default([]),
    total: n(),
    tabs: z.array(z.object({ id: z.string(), label: s(), count: n() })).default([]),
    page: n(1),
    size: n(15),
  })
  .passthrough();
export type OgList = z.infer<typeof ogList>;

export const ogGift = z
  .object({
    id: z.string(),
    seq: n(),
    status: s('draft'),
    kind: ogKindId,
    partnerId: s(),
    partnerLookup: s(),
    partnerName: s(),
    partnerPlace: s(),
    fundNamed: s(),
    softPartnerId: s(),
    softPartnerName: s(),
    noSoft: z.boolean().default(false),
    amountCents: n(),
    giftDate: s(),
    fundId: s(),
    fundName: s(),
    appealId: s(),
    appealName: s(),
    refText: s(),
    memo: s(),
    tributeKind: s(),
    tributeName: s(),
    tributeNotify: s(),
    dup: z.object({ message: s(), decision: z.string().nullable().default(null) }).nullable().default(null),
    letter: s('none'),
    letterName: s(),
    letterError: s(),
    blockers: z.array(z.string()).default([]),
    error: s(),
    retryAt: s(),
    bbGiftId: s(),
    enteredBy: s(),
    mine: z.boolean().default(false),
  })
  .passthrough();
export type OgGift = z.infer<typeof ogGift>;

export const ogBatchDetail = z
  .object({
    ok: z.literal(true),
    batch: z
      .object({
        id: z.string(),
        name: s(),
        status: s('open'),
        createdBy: s(),
        createdAt: s(),
        submittedAt: s(),
        submittedBy: s(),
        approvedBy: s(),
        approvedAt: s(),
        postedAt: s(),
        gifts: n(),
        cents: n(),
        posted: n(),
        mine: z.boolean().default(false),
        iEntered: z.boolean().default(false),
      })
      .passthrough(),
    gifts: z.array(ogGift).default([]),
    approve: z.object({ allowed: z.boolean().default(false), why: s() }).passthrough(),
    events: z.array(z.object({ at: s(), kind: s(), actor: s(), giftId: z.string().nullable().default(null) }).passthrough()).default([]),
    gift: ogGift.optional(),
  })
  .passthrough();
export type OgBatchDetail = z.infer<typeof ogBatchDetail>;

export const ogRecommenders = z
  .object({
    ok: z.literal(true),
    rows: z.array(z.object({ id: z.string(), lookup: s(), name: s(), place: s(), usedBefore: n(), lastDate: s() }).passthrough()).default([]),
  })
  .passthrough();
export type OgRecommender = z.infer<typeof ogRecommenders>['rows'][number];

export const ogPartnerHits = z
  .object({ ok: z.literal(true), hits: z.array(z.object({ cid: z.string(), lookup: s(), name: s(), place: s() }).passthrough()).default([]) })
  .passthrough();
export const ogLastCoding = z
  .object({ ok: z.literal(true), last: z.object({ fundId: s(), appealId: s(), date: s() }).passthrough().nullable().default(null) })
  .passthrough();
