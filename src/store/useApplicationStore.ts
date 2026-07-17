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
  /** Appends already-parsed applications (used by the batch chat-export
   * file upload flow, which parses off the main paste-and-parse path so it
   * can run its own noise-filtering pass first — see parseChatExportFile). */
  addApplications: (applications: Application[]) => void;
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

      addApplications: (newApplications) =>
        set((state) => ({
          applications: [...state.applications, ...newApplications],
        })),

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

export type MemberFrameCount = {
  count: number;
  /** Most common non-empty grade ("3年" etc.) seen across this member's
   * applications; "" if none of their entries had a grade prefix. A person
   * should have one consistent grade, but a stray typo/omission in one
   * submission shouldn't flip the badge — the majority vote wins, ties
   * broken by whichever grade was seen first. */
  grade: string;
};

/**
 * Number of bands each member (by name) currently applies with, plus their
 * (majority-vote) grade for display. A member playing different parts in
 * different bands is still one person with one frame count, so the
 * identity key is the name alone, not name+part.
 *
 * Names are compared via normalizeMemberName so "鈴木 啓大朗" and
 * "鈴木啓大朗" (or full-width vs half-width spacing/characters) count as
 * the same person instead of silently under-counting them — see
 * normalizeMemberName.ts. The map key (and what's shown to the user) is
 * the normalized form; the first-seen raw spelling isn't preserved since
 * with multiple spellings in play there's no single "correct" one to pick.
 */
export function computeMemberFrameCounts(
  applications: Application[],
): Map<string, MemberFrameCount> {
  const counts = new Map<string, number>();
  const gradeVotes = new Map<string, Map<string, number>>();

  for (const app of applications) {
    // Dedup within this application first (same as before), keeping
    // whichever grade was recorded for that name in this band.
    const membersInApp = new Map<string, string>();
    for (const m of app.members) {
      const name = normalizeMemberName(m.name);
      membersInApp.set(name, m.grade || membersInApp.get(name) || "");
    }
    for (const [name, grade] of membersInApp) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
      if (grade) {
        const votes = gradeVotes.get(name) ?? new Map<string, number>();
        votes.set(grade, (votes.get(grade) ?? 0) + 1);
        gradeVotes.set(name, votes);
      }
    }
  }

  const result = new Map<string, MemberFrameCount>();
  for (const [name, count] of counts) {
    const votes = gradeVotes.get(name);
    let grade = "";
    let bestVotes = -1;
    if (votes) {
      for (const [g, v] of votes) {
        if (v > bestVotes) {
          bestVotes = v;
          grade = g;
        }
      }
    }
    result.set(name, { count, grade });
  }
  return result;
}

const HIGH_PARTICIPATION_THRESHOLD = 3;

export type HighParticipationInfo = {
  /** Number of this band's members whose total frame count across all
   * applications is >= HIGH_PARTICIPATION_THRESHOLD. */
  highCount: number;
  /** highCount broken down by exact slot count, ascending (e.g. "3 slots:
   * 1 person, 4 slots: 1 person") — for the badge's expanded detail. */
  breakdown: { slots: number; people: number }[];
};

/**
 * For one application/band, how many of its members are "high
 * participation" (3+ total bands across every application, not just this
 * one) — a lottery/scheduling signal for "this band is stacked with
 * people who are already spread thin elsewhere". Takes the already-computed
 * frameCounts map (see computeMemberFrameCounts) rather than recomputing it
 * per band, so scanning every application only costs one pass over its own
 * (small) member list, not a full cross-application scan each time.
 */
export function computeHighParticipation(
  app: Application,
  frameCounts: Map<string, MemberFrameCount>,
): HighParticipationInfo {
  const uniqueNames = new Set(app.members.map((m) => normalizeMemberName(m.name)));
  const bySlots = new Map<number, number>();
  for (const name of uniqueNames) {
    const count = frameCounts.get(name)?.count ?? 0;
    if (count >= HIGH_PARTICIPATION_THRESHOLD) {
      bySlots.set(count, (bySlots.get(count) ?? 0) + 1);
    }
  }
  const breakdown = [...bySlots.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([slots, people]) => ({ slots, people }));
  const highCount = breakdown.reduce((sum, b) => sum + b.people, 0);
  return { highCount, breakdown };
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
