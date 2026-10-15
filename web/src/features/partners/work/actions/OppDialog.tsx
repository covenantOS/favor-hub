// Placeholder: the opportunity dialog is ported in this file by the Opportunities helper. The edit panel opens it from "New opportunity
// for this partner" with the partner and the action to link.
export interface OppPre {
  cid?: string;
  name?: string;
  link?: string;
  after?: () => void;
}
export function openOpp(_o?: unknown, _pre?: OppPre): void {}
