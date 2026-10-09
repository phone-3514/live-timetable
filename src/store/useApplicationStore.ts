import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Application, ApplicationMember, ApplicationSetlistItem, Band } from "../types";
import { detectHasKeyboard } from "../utils/parseBands";
import { normalizeMemberName } from "../utils/normalizeMemberName";
import { organizerStateStorage } from "../utils/appRoleStorage";
import { useAppStore } from "./useAppStore";

type ApplicationState = {
  applications: Application[];

  /** Appends already-parsed applications (used by the batch chat-export
   * file upload flow, which parses off the main paste-and-parse path so it
   * can run its own noise-filtering pass first — see parseChatExportFile).
   * Skips any application whose `raw` source text exactly matches one
   * already in the store (or an earlier one in this same batch) — dropping
   * the same export file on the dropzone twice, or re-exporting an
   * overlapping date range, would otherwise silently double every band it
   * contains, with no error and no visible cause beyond the list looking
   * "duplicated." Returns how many were actually added, for the caller's
   * own toast message. */
  addApplications: (applications: Application[]) => number;
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
  /** Cleans up applications left over from before addApplications' own
   * dedup existed (or from any other way an exact duplicate could have
   * gotten in) — groups by `raw`, and within any group of 2+, keeps
   * exactly one (the approved one if there's exactly one, otherwise the
   * earliest) and removes the rest. Every removed entry is guaranteed
   * unapproved, so nothing in the Timetable Editor is ever touched. A group
   * where two or more copies were each independently approved into their
   * own Band is left completely alone and counted in `needsManualReview`
   * instead — deciding which placement to discard needs a human. */
  removeExactDuplicateApplications: () => { removed: number; needsManualReview: number };
  /** Wipes every application and, for any that were approved, the Band it
   * was converted into — keeping the Timetable Editor's unplaced list in
   * sync rather than leaving orphaned bands behind. */
  clearAll: () => void;
  /** Name Resolution merge: rewrites every member matching fromName
   * (name-normalized, so it catches every raw spelling variant already
   * grouped under that identity) to toName's exact spelling, across every
   * application. Also propagates to the Timetable Editor's own Band records
   * via useAppStore.renameBandMember, so a band approved before the merge
   * doesn't keep showing the pre-merge spelling. */
  mergeMemberName: (fromName: string, toName: string) => void;
  /** Edits an application's 出演希望日 after import (the parser can misread
   * or miss it, and the organizer often needs to correct it by hand). If the
   * application has already been approved, the linked Band's desiredTime is
   * updated too — through useAppStore.updateBand, which also re-resolves the
   * band's allowed days and un-places it from any day it no longer fits —
   * so the timetable never keeps acting on the old text. */
  updateApplicationDesiredDateTime: (id: string, desiredDateTime: string) => void;
  /** Called whenever a linked Band is edited in the Timetable Editor
   * (PlacedBandDetailModal) — replaces the application's own bandName/
   * members/setlist/hasSync to match, so the Application Manager (list,
   * grade badges, frame counts, search/filter, sync badge, setlist column)
   * never shows stale data after an edit made on the Band side. One-
   * directional: the Application Manager has no editing UI of its own to
   * propagate back the other way. */
  syncApplicationFromBand: (
    applicationId: string,
    patch: {
      bandName: string;
      members: ApplicationMember[];
      setlist: ApplicationSetlistItem[];
      hasSync: boolean;
    },
  ) => void;
};

function applicationToBand(app: Application): Band {
  return {
    id: crypto.randomUUID(),
    name: app.bandName,
    members: app.members.map((m) => m.name),
    memberDetails: app.members.map((m) => ({ name: m.name, grade: m.grade, part: m.part })),
    setlist: app.setlist.map((s) => (s.artist ? `${s.title}/${s.artist}` : s.title)),
    desiredTime: app.desiredDateTime,
    ngTime: "",
    durationMinutes: app.durationMinutes ?? undefined,
    allowedDayIds: [],
    hasSync: app.hasSync,
    hasKeyboard: detectHasKeyboard(app.raw),
    gearTags: [],
    raw: app.raw,
  };
}

export const useApplicationStore = create<ApplicationState>()(
  persist(
    (set, get) => ({
      applications: [],

      addApplications: (newApplications) => {
        const seenRaw = new Set(get().applications.map((a) => a.raw));
        const toAdd = newApplications.filter((app) => {
          if (seenRaw.has(app.raw)) return false;
          seenRaw.add(app.raw);
          return true;
        });
        if (toAdd.length > 0) {
          set((state) => ({ applications: [...state.applications, ...toAdd] }));
        }
        return toAdd.length;
      },

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

      removeExactDuplicateApplications: () => {
        const apps = get().applications;
        const groups = new Map<string, Application[]>();
        for (const app of apps) {
          const group = groups.get(app.raw) ?? [];
          group.push(app);
          groups.set(app.raw, group);
        }
        const idsToRemove = new Set<string>();
        let needsManualReview = 0;
        for (const group of groups.values()) {
          if (group.length <= 1) continue;
          const approved = group.filter((a) => a.approved);
          if (approved.length >= 2) {
            needsManualReview++;
            continue;
          }
          const keepId =
            approved[0]?.id ??
            group.reduce((earliest, a) => (a.createdAt < earliest.createdAt ? a : earliest)).id;
          for (const app of group) {
            if (app.id !== keepId) idsToRemove.add(app.id);
          }
        }
        if (idsToRemove.size > 0) {
          // Every id here came from a group with at most one approved
          // entry, and that one is always `keepId` — so everything being
          // removed is unapproved and has no linked Band to clean up.
          set((state) => ({
            applications: state.applications.filter((a) => !idsToRemove.has(a.id)),
          }));
        }
        return { removed: idsToRemove.size, needsManualReview };
      },

      clearAll: () => {
        for (const app of get().applications) {
          if (app.linkedBandId) {
            useAppStore.getState().deleteBand(app.linkedBandId);
          }
        }
        set({ applications: [] });
      },

      mergeMemberName: (fromName, toName) => {
        const fromKey = normalizeMemberName(fromName);
        set((state) => ({
          applications: state.applications.map((app) => ({
            ...app,
            members: app.members.map((m) =>
              normalizeMemberName(m.name) === fromKey ? { ...m, name: toName } : m,
            ),
          })),
        }));
        useAppStore.getState().renameBandMember(fromName, toName);
      },

      updateApplicationDesiredDateTime: (id, desiredDateTime) => {
        const app = get().applications.find((a) => a.id === id);
        if (!app || app.desiredDateTime === desiredDateTime) return;
        set((state) => ({
          applications: state.applications.map((a) =>
            a.id === id ? { ...a, desiredDateTime } : a,
          ),
        }));
        if (app.linkedBandId) {
          useAppStore.getState().updateBand(app.linkedBandId, { desiredTime: desiredDateTime });
        }
      },

      syncApplicationFromBand: (applicationId, patch) =>
        set((state) => ({
          applications: state.applications.map((app) =>
            app.id === applicationId
              ? {
                  ...app,
                  bandName: patch.bandName,
                  members: patch.members,
                  setlist: patch.setlist,
                  hasSync: patch.hasSync,
                }
              : app,
          ),
        })),
    }),
    { name: "live-timetable-applications", storage: createJSONStorage(() => organizerStateStorage) },
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

export const HIGH_PARTICIPATION_THRESHOLD = 3;

/**
 * Which of their slots this listing is for a member, as the submitter wrote
 * it ("Dr. 鈴木 3枠目" → 3). A member with no "N枠目" on this band's
 * application counts as 1 (their first or second slot — nothing to flag),
 * however many other bands they are in: the number that matters for 枠数 is
 * the one on this application, not the member's total across applications.
 */
export function memberFrameNumber(member: { frameOrdinal?: number | null }): number {
  const n = member.frameOrdinal;
  return n !== null && n !== undefined && Number.isFinite(n) && n >= 1 ? n : 1;
}

/** A member whose only band is this one, and who didn't write a later "N枠目". */
export function isSingleSlotMember(
  member: { name: string; frameOrdinal?: number | null },
  frameCounts: Map<string, MemberFrameCount>,
): boolean {
  return (
    frameCounts.get(normalizeMemberName(member.name))?.count === 1 && memberFrameNumber(member) <= 1
  );
}

export type HighParticipationInfo = {
  /** Number of this band's members whose "N枠目" on this application is
   * >= HIGH_PARTICIPATION_THRESHOLD. */
  highCount: number;
  /** highCount broken down by that N, ascending (e.g. "3 slots: 1 person,
   * 4 slots: 1 person") — for the badge's expanded detail. */
  breakdown: { slots: number; people: number }[];
};

/**
 * For one application/band, how many of its members are "high
 * participation": the "N枠目" written for them on THIS application is 3 or
 * more (see memberFrameNumber) — a lottery/scheduling signal for "this band
 * is stacked with people who are already spread thin elsewhere". It depends
 * only on what this application says, not on how many other bands the member
 * appears in: someone in five bands whose line here says nothing counts as
 * 1 and isn't flagged.
 */
export function computeHighParticipation(app: Application): HighParticipationInfo {
  // One entry per person (the highest N written for them on this band).
  const frameByName = new Map<string, number>();
  for (const m of app.members) {
    const name = normalizeMemberName(m.name);
    frameByName.set(name, Math.max(frameByName.get(name) ?? 1, memberFrameNumber(m)));
  }
  const bySlots = new Map<number, number>();
  for (const count of frameByName.values()) {
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

export type MemberFrameDetail = {
  name: string;
  part: string;
  grade: string;
  /** This member's own "N枠目" ordinal as the submitter wrote it on this
   * band's line (see ApplicationMember.frameOrdinal) — null when absent. */
  frameOrdinal: number | null;
  /** Every band (this one included) this member's name matches across all
   * applications, in first-seen order and deduped by band name. */
  bandNames: string[];
};

/**
 * For each member listed on `app`, the concrete list of bands (across ALL
 * applications, this one included) their name also appears on — the
 * band-by-band detail behind computeMemberFrameCounts' bare number. Powers
 * the Application Manager's per-band "メンバー枠数" popup, where an
 * organizer wants to see exactly which bands a member is spread across,
 * not just how many.
 */
export function listMemberFrameDetails(
  applications: Application[],
  app: Application,
): MemberFrameDetail[] {
  return app.members.map((member) => {
    const normalizedTarget = normalizeMemberName(member.name);
    const bandNames: string[] = [];
    const seen = new Set<string>();
    for (const a of applications) {
      if (seen.has(a.bandName)) continue;
      if (!a.members.some((m) => normalizeMemberName(m.name) === normalizedTarget)) continue;
      seen.add(a.bandName);
      bandNames.push(a.bandName);
    }
    return {
      name: member.name,
      part: member.part,
      grade: member.grade,
      frameOrdinal: member.frameOrdinal ?? null,
      bandNames,
    };
  });
}
