import type { Band, TimetableDay } from "../types";
import type { EventInfo } from "../store/useAppStore";
import type { PublicPamphletDoc } from "./types";

// The one function responsible for deciding what leaves the private room
// document and becomes public — see types.ts's PublicBand/PublicDay for
// the exact field list and why each excluded field is excluded. Called
// only from the admin-side publish button (PublishPamphletButton.tsx);
// the pamphlet itself never sees a full Band/TimetableDay, only what this
// returns.
export function buildPublicPamphletDoc(
  eventInfo: EventInfo,
  bands: Band[],
  days: TimetableDay[],
): PublicPamphletDoc {
  return {
    liveName: eventInfo.liveName,
    venue: eventInfo.venue,
    organizationName: eventInfo.organizationName,
    bands: bands.map((b) => ({
      id: b.id,
      name: b.name,
      members: b.members,
      memberDetails: b.memberDetails,
      setlist: b.setlist,
    })),
    days: days.map((d) => ({
      id: d.id,
      label: d.label,
      date: d.date,
      slots: d.slots.map((s) => ({
        id: s.id,
        bandId: s.bandId,
        customLabel: s.customLabel,
        customDurationMinutes: s.customDurationMinutes,
        startTime: s.startTime,
        endTime: s.endTime,
      })),
    })),
    publishedAt: Date.now(),
  };
}
