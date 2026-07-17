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
// setlist document (SetlistExportTemplate). Member data preference order:
// 1) Band.memberDetails — the band's own editable per-member record (see
//    PlacedBandDetailModal), authoritative once anyone has touched it,
//    since it's what "editing a member" actually writes to; 2) a linked
//    Application's members — the pre-editing behavior, for bands nobody
//    has opened the editor on yet; 3) Band.members with part/grade left
//    blank, for a band with neither (manually added, or an old record from
//    before this app relied on Application Manager for band data).
// Setlist songs still only ever come from the Application/Band setlist
// fields — editing member details doesn't touch those.
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
    const members: SetlistMemberEntry[] =
      band.memberDetails && band.memberDetails.length > 0
        ? band.memberDetails.map((m) => ({ name: m.name, part: m.part, grade: m.grade }))
        : linkedApp
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
