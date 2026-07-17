import type { Application, Band, TimetableDay } from "../types";

export type SetlistSongEntry = { title: string; artist: string };
export type SetlistMemberEntry = { name: string; part: string; grade: string };

export type SetlistBandEntry = {
  order: number;
  startTime: string;
  endTime: string;
  bandName: string;
  songs: SetlistSongEntry[];
  members: SetlistMemberEntry[];
};

function splitSongText(raw: string): SetlistSongEntry {
  const slash = raw.match(/^(.+?)\s*\/\s*(.+)$/);
  if (slash) return { title: slash[1].trim(), artist: slash[2].trim() };
  return { title: raw.trim(), artist: "" };
}

// One row per performing band, in performance order, for the printable
// setlist document (SetlistExportTemplate). Prefers the richer data an
// approved Application carries (per-member part/grade, setlist artists
// split out) over the flatter Band record it was converted into — same
// cross-reference PlacedBandDetailModal already uses, for the same reason:
// applicationToBand collapses members down to bare name strings, so a band
// with no linked application (manually added, or an old record from before
// this app relied exclusively on Application Manager for band data) falls
// back to what Band itself has, with part/grade left blank rather than
// guessed at.
export function computeSetlistEntries(
  day: TimetableDay,
  bands: Band[],
  applications: Application[],
): SetlistBandEntry[] {
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const entries: SetlistBandEntry[] = [];
  let order = 0;

  for (const slot of day.slots) {
    if (!slot.bandId) continue;
    const band = bandMap.get(slot.bandId);
    if (!band) continue;
    order++;

    const linkedApp = applications.find((a) => a.linkedBandId === band.id);
    const songs: SetlistSongEntry[] = linkedApp
      ? linkedApp.setlist.map((s) => ({ title: s.title, artist: s.artist }))
      : band.setlist.map(splitSongText);
    const members: SetlistMemberEntry[] = linkedApp
      ? linkedApp.members.map((m) => ({ name: m.name, part: m.part, grade: m.grade }))
      : band.members.map((name) => ({ name, part: "", grade: "" }));

    entries.push({
      order,
      startTime: slot.startTime,
      endTime: slot.endTime,
      bandName: band.name,
      songs,
      members,
    });
  }

  return entries;
}
