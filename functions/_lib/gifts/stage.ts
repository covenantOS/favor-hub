// Gift entry ships in three stages, each live for admins. The stage is a constant in the deployed code, so what runs is what was reviewed.
//   1  deposit setup, photos, the two readers, partner matching, the review grid against the tape, the duplicate guard
//   2  create the unapproved batch in Blackbaud (outbox, retries, own lane), the status view, commit detection
//   3  copy the photos of the rule gifts to Blackbaud after commit
export const STAGE = 2;

export const stageNeeds = (n: number) => STAGE >= n;
