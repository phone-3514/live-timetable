export type BandMemberDetail = {
  name: string;
  /** e.g. "3年" — empty when not set. */
  grade: string;
  part: string;
};

export type BandPaSheetLink = {
  label: string;
  url: string;
};

export type Band = {
  id: string;
  name: string;
  members: string[];
  // Optional richer per-member data (grade/part), directly editable via
  // PlacedBandDetailModal. `members` above stays the source of truth for
  // plain names — kept in sync on every edit — since that's what the
  // Timetable display and conflict detection (getMemberConflictDetails)
  // actually read; memberDetails only ever adds grade/part on top for the
  // Setlist export. Undefined (or empty) for bands nobody has edited yet,
  // in which case the Setlist falls back to a linked Application's member
  // data, then to plain names with blank grade/part — see
  // computeSetlistEntries.
  memberDetails?: BandMemberDetail[];
  // Setlist entries as free text ("曲名/アーティスト名"), extracted from
  // numbered or bare "title/artist" lines so they don't get misread as
  // member names.
  setlist: string[];
  desiredTime: string;
  ngTime: string;
  durationMinutes?: number;
  // Resolved set of day ids this band may be placed on. Empty = no
  // restriction (any day). Derived from desiredTime/ngTime day-of-month
  // hints (e.g. "13日") cross-referenced against each TimetableDay's actual
  // calendar date via resolveAllowedDayIds — but always manually editable
  // afterward via the per-band day toggles.
  allowedDayIds: string[];
  // Equipment flags auto-detected from the application text (同期演奏 /
  // Key./キーボード/鍵盤 mentions), manually correctable. Not yet used to
  // change scheduling behavior, but kept as plain booleans so a future rule
  // (e.g. "add extra transition time around sync/keyboard bands") can read
  // them directly off the Band without another parsing pass.
  hasSync: boolean;
  hasKeyboard: boolean;
  // Per-band override for the transition time that follows this band's
  // slot (e.g. keyboard/sync bands often need longer changeover). Manually
  // set only — undefined falls back to the day's default transitionMinutes.
  customTransitionMinutes?: number;
  // Free-text labels for physical gear this band needs that another band
  // might also need ("共有キーボード", "ギターアンプ" — whatever the circle
  // actually owns and has to physically move between bands). Two bands
  // sharing a tag back-to-back is what getGearConflictSlotIds flags — see
  // useAppStore.ts — since that's the classic "the set started late because
  // the keyboard was still being carried across stage" problem. Manually
  // set only; nothing auto-detects these the way hasSync/hasKeyboard do.
  gearTags: string[];
  /** Band-specific PA, lighting, and stage-reference links. Optional so
   * rooms saved before this field was introduced remain readable. */
  paSheetLinks?: BandPaSheetLink[];
  raw: string;
  parseWarning?: string;
};

// ---------- Application Manager ----------
//
// A richer, separate model from Band — the Application Manager tab logs raw
// Discord submissions (including sender/timestamp metadata that Band has no
// place for) before a lottery decision is made. An "approved" application
// is converted into a plain Band (see applicationToBand) and pushed into
// the Timetable Editor's unplaced pool; the Application record itself keeps
// existing (linkedBandId tracks the conversion) so approve/reject stays a
// reversible toggle instead of a one-way action.

export type ApplicationSetlistItem = {
  title: string;
  artist: string;
};

export type ApplicationMember = {
  name: string;
  part: string;
  /** e.g. "3年" — empty when the source line had no grade prefix. */
  grade: string;
};

export type Application = {
  id: string;
  /** 申請者氏名 — the Discord message sender, from the copy-pasted header. */
  applicantName: string;
  /** 申請日時 — the Discord message timestamp, from the copy-pasted header. */
  applicationDateTime: string;
  bandName: string;
  setlist: ApplicationSetlistItem[];
  members: ApplicationMember[];
  hasSync: boolean;
  durationMinutes: number | null;
  /** 出演希望日 — free text, may list multiple preferred slots/dates. */
  desiredDateTime: string;
  raw: string;
  createdAt: number;
  approved: boolean;
  /** Set once approved — the Band this application was converted into, so
   * un-approving or clearing can remove exactly that Band and nothing else. */
  linkedBandId: string | null;
  parseWarning?: string;
};

export type TimetableSlot = {
  id: string;
  bandId: string | null;
  // Non-band rows (休憩・集合・リハーサルなど). null when this slot is a
  // band-performance slot (whether filled or still empty).
  customLabel: string | null;
  customDurationMinutes: number | null;
  /** Explicit row-level start-time override. null/undefined follows the
   * previous row; setting it becomes a new anchor and ripples to all rows
   * below it. Optional keeps older persisted/Firestore documents valid. */
  startTimeOverride?: string | null;
  /** Difference from the no-override baseline schedule, recomputed with
   * start/end times. Positive values are shown as the admin delay badge. */
  delayMinutes?: number;
  startTime: string;
  endTime: string;
};

export type TimetableSettings = {
  startTime: string;
  performanceMinutes: number;
  transitionMinutes: number;
};

export type TimetableDay = {
  id: string;
  label: string;
  // ISO yyyy-mm-dd, e.g. "2026-07-13". Optional — only needed to resolve
  // bands' desiredDates/ngDates hints into day restrictions.
  date: string | null;
  settings: TimetableSettings;
  slots: TimetableSlot[];
};
