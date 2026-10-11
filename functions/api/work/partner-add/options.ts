import { work } from '../../../_lib/work/route';
import { CONTACT_ROLES, PERSON_RELATIONS, holdersForAdd, mayAddPartner } from '../../../_lib/work/addpartner';
import { MORNING_RUN_CODES, getTables } from '../../../_lib/work/records';

// What the Add a partner form picks from: titles, suffixes, phone types, the type codes an organization can carry, the two kinds of
// relationship it files, and who can hold a new partner. Blackbaud's tables are read once a week.
export const onRequestGet = work(async ({ ctx, env }) => {
  const t = await getTables(ctx);
  const staff = await holdersForAdd(env);
  return {
    can: mayAddPartner(ctx),
    titles: t.titles,
    suffixes: t.suffixes,
    phoneTypes: t.phoneTypes,
    typeCodes: t.constituentCodes.filter((c) => !MORNING_RUN_CODES.includes(c)),
    relations: Object.keys(PERSON_RELATIONS),
    contactRoles: Object.keys(CONTACT_ROLES),
    holders: staff.map((s) => ({ fid: String(s.bb_fundraiser_id), name: s.name, team: s.team })),
  } as any;
});
