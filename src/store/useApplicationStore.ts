import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Application, Band } from "../types";
import { parseApplications } from "../utils/parseApplications";
import { detectHasKeyboard } from "../utils/parseBands";
import { normalizeMemberName } from "../utils/normalizeMemberName";
import { useAppStore } from "./useAppStore";

type ApplicationState = {
  rawText: string;
  applications: Application[];

  setRawText: (text: string) => void;
  parseAndAddFromRawText: () => void;
  approveApplication: (id: string) => void;
  unapproveApplication: (id: string) => void;
  /** Approves every application not already approved, in one batched
   * timetable update (a single addBands call) rather than looping
   * approveApplication and triggering N separate store updates. */
  approveAllPending: () => void;
  /** Removes the application outright (used by the reject/delete flow,
   * after the UI has already surfaced the 0-slots safety warning). Also
   * removes the linked Band from the timetable if it had been approved. */
  removeApplication: (id: string) => void;
  /** Wipes every application and, for any that were approved, the Band it
   * was converted into — keeping the Timetable Editor's unplaced list in
   * sync rather than leaving orphaned bands behind. */
  clearAll: () => void;
};

function applicationToBand(app: Application): Band {
  return {
    id: crypto.randomUUID(),
    name: app.bandName,
    members: app.members.map((m) => m.name),
    setlist: app.setlist.map((s) => (s.artist ? `${s.title}/${s.artist}` : s.title)),
    desiredTime: app.desiredDateTime,
    ngTime: "",
    durationMinutes: app.durationMinutes ?? undefined,
    allowedDayIds: [],
    hasSync: app.hasSync,
    hasKeyboard: detectHasKeyboard(app.raw),
    raw: app.raw,
  };
}

export const useApplicationStore = create<ApplicationState>()(
  persist(
    (set, get) => ({
      rawText: "",
      applications: [],

      setRawText: (text) => set({ rawText: text }),

      parseAndAddFromRawText: () =>
        set((state) => {
          const parsed = parseApplications(state.rawText);
          if (parsed.length === 0) return state;
          return { applications: [...state.applications, ...parsed], rawText: "" };
        }),

      approveApplication: (id) => {
        const app = get().applications.find((a) => a.id === id);
        if (!app || app.approved) return;
        const band = applicationToBand(app);
        useAppStore.getState().addBands([band]);
        set((state) => ({
          applications: state.applications.map((a) =>
            a.id === id ? { ...a, approved: true, linkedBandId: band.id } : a,
          ),
        }));
      },

      approveAllPending: () => {
        const pending = get().applications.filter((a) => !a.approved);
        if (pending.length === 0) return;
        const converted = pending.map((app) => ({ appId: app.id, band: applicationToBand(app) }));
        useAppStore.getState().addBands(converted.map((c) => c.band));
        const linkedBandIdByAppId = new Map(converted.map((c) => [c.appId, c.band.id]));
        set((state) => ({
          applications: state.applications.map((a) => {
            const linkedBandId = linkedBandIdByAppId.get(a.id);
            return linkedBandId ? { ...a, approved: true, linkedBandId } : a;
          }),
        }));
      },

      unapproveApplication: (id) => {
        const app = get().applications.find((a) => a.id === id);
        if (!app || !app.approved) return;
        if (app.linkedBandId) {
          useAppStore.getState().deleteBand(app.linkedBandId);
        }
        set((state) => ({
          applications: state.applications.map((a) =>
            a.id === id ? { ...a, approved: false, linkedBandId: null } : a,
          ),
        }));
      },

      removeApplication: (id) => {
        const app = get().applications.find((a) => a.id === id);
        if (app?.linkedBandId) {
          useAppStore.getState().deleteBand(app.linkedBandId);
        }
        set((state) => ({
          applications: state.applications.filter((a) => a.id !== id),
        }));
      },

      clearAll: () => {
        for (const app of get().applications) {
          if (app.linkedBandId) {
            useAppStore.getState().deleteBand(app.linkedBandId);
          }
        }
        set({ applications: [], rawText: "" });
      },
    }),
    { name: "live-timetable-applications" },
  ),
);

/**
 * Number of bands each member (by name) currently applies with. A member
 * playing different parts in different bands is still one person with one
 * frame count, so the identity key is the name alone, not name+part.
 *
 * Names are compared via normalizeMemberName so "鈴木 啓大朗" and
 * "鈴木啓大朗" (or full-width vs half-width spacing/characters) count as
 * the same person instead of silently under-counting them — see
 * normalizeMemberName.ts. The map key (and what's shown to the user) is
 * the normalized form; the first-seen raw spelling isn't preserved since
 * with multiple spellings in play there's no single "correct" one to pick.
 */
export function computeMemberFrameCounts(applications: Application[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const app of applications) {
    const namesInApp = new Set(app.members.map((m) => normalizeMemberName(m.name)));
    for (const name of namesInApp) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * For each member of `app`, the number of *other* applications (excluding
 * `app` itself) they would still perform in if `app` were rejected/deleted.
 * Matching is name-normalized for the same reason as computeMemberFrameCounts
 * above; the returned `name` stays as originally written on `app` itself
 * (this band's own member list), only the cross-application match uses the
 * normalized comparison.
 */
export function remainingCountsIfRemoved(
  applications: Application[],
  app: Application,
): { name: string; part: string; remaining: number }[] {
  return app.members.map((member) => {
    const normalizedTarget = normalizeMemberName(member.name);
    const remaining = applications.filter(
      (a) =>
        a.id !== app.id &&
        a.members.some((m) => normalizeMemberName(m.name) === normalizedTarget),
    ).length;
    return { name: member.name, part: member.part, remaining };
  });
}
