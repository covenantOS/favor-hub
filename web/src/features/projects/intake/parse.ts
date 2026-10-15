// The composer's parser, the same code the server runs (shared/request-parse.ts). Pure, so it can answer on every keystroke with no
// network: kind, place, audience, due date, the team it goes to and the person named, each as a chip with the reason for hover.
// For the suggested owner from the board's history and the staff list, call intakeApi.parse once the person pauses typing.
export {
  parseRequest,
  routeByWords,
  personFromText,
  dateFromText,
  suggestFill,
  easternDay,
  TEAM_OPTIONS,
  KIND_OPTIONS,
  PLACE_OPTIONS,
  AUDIENCE_OPTIONS,
  placeLabel,
  kindLabel,
  teamLabel,
} from '@shared/request-parse';
export type { Chip, Parsed, ParseOptions, PersonLite, Option, Team, Kind, Place } from '@shared/request-parse';
