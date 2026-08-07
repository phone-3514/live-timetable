import type { Band } from "../types";

// Plain-text export of every Band's own member data — "全バンドのメンバー
// 情報をコピー". Band is the single source of truth here: this never reads
// Application records or TimetableSlot placement, and every band is
// included regardless of whether it's currently placed on any day (unlike
// computeSetlistEntries in setlistExport.ts, which is day/slot-scoped and
// falls back to a linked Application's members — a different, unrelated
// export flow this one doesn't touch or reuse).
function formatMemberLine(name: string, part: string): string {
  const trimmedName = name.trim();
  const trimmedPart = part.trim();
  return trimmedPart ? `・${trimmedName} / ${trimmedPart}` : `・${trimmedName}`;
}

// Same Band-side preference PlacedBandDetailModal edits: memberDetails
// (has part/grade) once anyone has touched it, else the plain members
// list — no Application fallback tier (see this module's own doc above).
function formatBandMemberLines(band: Band): string[] {
  if (band.memberDetails && band.memberDetails.length > 0) {
    return band.memberDetails.map((m) => formatMemberLine(m.name, m.part));
  }
  return band.members.map((name) => formatMemberLine(name, ""));
}

// Bands are listed in the given array order (the caller's own canonical
// order — e.g. useAppStore's bands array — is preserved, never re-sorted
// here). No band id or other internal/implementation-only field is ever
// read.
export function formatAllBandMemberDataText(bands: Band[]): string {
  return bands
    .map((band) => {
      const memberLines = formatBandMemberLines(band);
      const body = memberLines.length > 0 ? memberLines.join("\n") : "（メンバー情報なし）";
      return `${band.name}\n${body}`;
    })
    .join("\n\n");
}
