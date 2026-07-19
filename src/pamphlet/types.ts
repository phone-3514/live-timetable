import type { BandMemberDetail } from "../types";

// A deliberately narrow subset of Band/TimetableDay/TimetableSlot — the
// public pamphlet document only ever holds what an audience member is
// meant to see. Compare against ../types.ts's Band: `desiredTime`,
// `ngTime`, `allowedDayIds`, `hasSync`, `hasKeyboard`,
// `customTransitionMinutes`, `gearTags`, `raw` (the raw pasted
// application text — may contain contact info), and `parseWarning` are
// ALL scheduling/administrative fields excluded here on purpose (this
// app's closest equivalent to the spec's "private notes"). Application
// Manager data (applicantName, raw Discord text, unapproved submissions)
// is never included at all — see buildPublicPamphletDoc.
export type PublicBand = {
  id: string;
  name: string;
  members: string[];
  memberDetails?: BandMemberDetail[];
  setlist: string[];
};

export type PublicSlot = {
  id: string;
  bandId: string | null;
  customLabel: string | null;
  customDurationMinutes: number | null;
  startTime: string;
  endTime: string;
};

export type PublicDay = {
  id: string;
  label: string;
  date: string | null;
  slots: PublicSlot[];
};

// One document per circle (circleId === the editor's roomId — see
// main.tsx), written only by the "🌐 パンフレットを公開" publish action
// (see PublishPamphletButton.tsx) and read only via a one-time get() (see
// usePamphletCache.ts) — never a live onSnapshot listener, to keep public
// viewers to exactly one Firestore read per page load regardless of how
// long they leave the tab open (see firestore.rules for the matching
// read-only/write-shape rule).
export type PublicPamphletDoc = {
  liveName: string;
  venue: string;
  organizationName: string;
  bands: PublicBand[];
  days: PublicDay[];
  publishedAt: number;
};
