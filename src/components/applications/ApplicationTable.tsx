import { useRef, useMemo, useState } from "react";
import type { Application } from "../../types";
import { normalizeMemberName } from "../../utils/normalizeMemberName";
import { minutesToTime } from "../../utils/time";
import {
  collectScheduleCandidates,
  isAvailableAtAnyDay,
  isScheduleTextUnrecognized,
  isAvailableOn,
  parseScheduleAvailability,
} from "../../utils/scheduleAvailability";
import {
  hasUnparsedDayHint,
  hasUnparsedTimeExpression,
  stripAffiliationNoteForDisplay,
} from "../../utils/parseBands";
import {
  computeHighParticipation,
  useApplicationStore,
  type HighParticipationInfo,
  type MemberFrameCount,
} from "../../store/useApplicationStore";
import { useAppStore } from "../../store/useAppStore";
import { Badge } from "./Badge";
import { ApplicationMobileCard } from "./ApplicationMobileCard";
import { LiveCompositionRatingStars } from "./LiveCompositionRatingStars";
import { PlacedBandDetailModal } from "../PlacedBandDetailModal";
import { MemberFrameDetailModal } from "./MemberFrameDetailModal";

type SortKey =
  | "applicantName"
  | "applicationDateTime"
  | "bandName"
  | "durationMinutes"
  | "desiredDateTime"
  | "hasSync"
  | "memberCount"
  | "highParticipationCount";
type SortDir = "asc" | "desc";

interface Props {
  applications: Application[];
  // Precomputed once by the parent (ApplicationManagerTab, shared with
  // MemberFrameCounts) — see computeHighParticipation below for why this
  // table doesn't rescan every application per band.
  frameCounts: Map<string, MemberFrameCount>;
  onApprove: (id: string) => void;
  onUnapprove: (id: string) => void;
  onRequestReject: (app: Application) => void;
  filterText: string;
  onFilterTextChange: (text: string) => void;
}

export function MemberBadgeList({ members }: { members: Application["members"] }) {
  return (
    <ul className="space-y-1">
      {members.map((m, i) => (
        <li key={i} className="flex flex-wrap items-center gap-1">
          {m.grade && <Badge tone="grade">{m.grade}</Badge>}
          {m.part && <Badge tone="part">{m.part}</Badge>}
          <span className="text-slate-200">{stripAffiliationNoteForDisplay(m.name)}</span>
        </li>
      ))}
    </ul>
  );
}

export function SetlistLines({ setlist }: { setlist: Application["setlist"] }) {
  return (
    <ul className="space-y-0.5">
      {setlist.map((s, i) => (
        <li key={i}>
          {s.title}
          {s.artist ? ` / ${s.artist}` : ""}
        </li>
      ))}
    </ul>
  );
}

// Compact badge for "how many of this band's members are already spread
// across 3+ bands elsewhere" — a lottery/scheduling signal, not shown at
// all when zero (keeps rows without any high-participation member free of
// clutter). Click toggles an inline breakdown ("3枠: 1人, 4枠: 1人"); the
// same text is also on the badge's title so a mouse hover shows it without
// a click, satisfying both interaction styles on desktop and touch.
export function HighParticipationBadge({ info }: { info: HighParticipationInfo }) {
  const [expanded, setExpanded] = useState(false);
  if (info.highCount === 0) return null;

  const breakdownText = info.breakdown.map((b) => `${b.slots}枠: ${b.people}人`).join(" / ");

  return (
    <div className="inline-block">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        title={breakdownText}
        aria-expanded={expanded}
        className="inline-flex min-h-9 items-center whitespace-nowrap rounded-md border border-amber-500 bg-amber-950 px-2 py-1 text-xs font-semibold leading-none text-amber-300 hover:border-amber-400 md:min-h-0"
      >
        ⚠ 3枠以上: {info.highCount}人
      </button>
      {expanded && (
        <p className="mt-1 max-w-[12rem] text-[11px] font-normal leading-snug text-amber-300">
          {breakdownText}
        </p>
      )}
    </div>
  );
}

// Click-to-edit 出演希望日 — the parser can misread or miss this field, and
// the organizer often has to fix it by hand after import (or normalize a
// free-form answer into a phrasing the auto-scheduler understands). Saving
// goes through updateApplicationDesiredDateTime, which also updates the
// linked Band once approved. While editing, the draft is checked with the
// same "this looks like a day/time but wasn't recognized" detectors the
// Timetable Editor's band form uses, so a phrasing the scheduler would
// silently treat as "no restriction" is flagged right where it's typed.
//
// "cell" variant: the table column is far too narrow to type into, so the
// input floats over the cell (anchored right, growing left, since this
// column sits near the table's right edge) while the plain text keeps the
// cell's own height stable underneath. "inline" variant (mobile card): a
// normal full-width input in the flow.
export function EditableDesiredDateTime({
  app,
  variant,
}: {
  app: Application;
  variant: "cell" | "inline";
}) {
  const update = useApplicationStore((s) => s.updateApplicationDesiredDateTime);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Escape must cancel without the blur that follows the input unmounting
  // committing the draft anyway.
  const skipCommitRef = useRef(false);

  const shown = editing ? draft : app.desiredDateTime;
  const unparsed = hasUnparsedTimeExpression(shown) || hasUnparsedDayHint(shown);

  function startEditing() {
    skipCommitRef.current = false;
    setDraft(app.desiredDateTime);
    setEditing(true);
  }

  function commit() {
    if (skipCommitRef.current) return;
    update(app.id, draft.trim());
    setEditing(false);
  }

  const input = (
    <input
      autoFocus
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          skipCommitRef.current = true;
          setEditing(false);
        }
      }}
      aria-label={`${app.bandName}の出演希望日`}
      placeholder="例：17日 16:00以降 / 両日可能"
      className={`rounded border bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none placeholder:text-slate-500 ${
        unparsed ? "border-amber-500" : "border-indigo-500"
      } ${variant === "cell" ? "absolute right-0 top-0 z-20 w-60 shadow-lg shadow-black/40" : "min-h-11 w-full"}`}
    />
  );

  const display = (
    <button
      type="button"
      onClick={startEditing}
      title="クリックして出演希望日を編集"
      className="group inline-flex max-w-full items-start gap-1 rounded text-left text-slate-300 hover:text-slate-100"
    >
      <span className="break-words">{app.desiredDateTime || (variant === "cell" ? "-" : "希望日を入力")}</span>
      <span aria-hidden="true" className="text-[10px] text-slate-500 group-hover:text-indigo-300">
        ✎
      </span>
    </button>
  );

  const warning = unparsed && (
    <p className="mt-0.5 text-[10px] leading-snug text-amber-400">
      ⚠ 認識されない書き方です（「17日」「16:00以降」など）
    </p>
  );

  if (variant === "inline") {
    return (
      <div className="min-w-0 text-xs">
        {editing ? input : display}
        {warning}
      </div>
    );
  }
  return (
    <div className="relative">
      {display}
      {editing && input}
      {warning}
    </div>
  );
}

// Opens the exact same Band-editing modal the Timetable Editor's own
// per-slot "⋮" button opens (PlacedBandDetailModal — see that component's
// own doc for what it edits and how it saves) — not a second, parallel
// edit UI. `slot` is intentionally omitted (see PlacedBandDetailModal's
// now-optional `slot` prop): there's no timetable slot in this screen's
// context, only a Band. Only ever called with a `bandId` the caller has
// already confirmed came from a truthy `linkedBandId` (both call sites
// below gate on that), but still guards against a stale id (a linked
// Band that's since been deleted) the same way LiveCompositionRatingStars
// does, so a stale reference can't crash this screen.
export function EditBandButton({ bandId, className }: { bandId: string; className: string }) {
  const band = useAppStore((s) => s.bands.find((b) => b.id === bandId));
  const [showEdit, setShowEdit] = useState(false);
  if (!band) return null;
  return (
    <>
      <button type="button" onClick={() => setShowEdit(true)} className={className}>
        編集
      </button>
      {showEdit && <PlacedBandDetailModal band={band} onClose={() => setShowEdit(false)} />}
    </>
  );
}

// Opens MemberFrameDetailModal for one band — the concrete band-by-band
// breakdown behind this row's own HighParticipationBadge count. Needs the
// full applications list (not just this row's app) since a member's other
// bands live in other rows entirely.
export function MemberFrameDetailButton({
  app,
  applications,
  className,
}: {
  app: Application;
  applications: Application[];
  className: string;
}) {
  const [showDetail, setShowDetail] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setShowDetail(true)} className={className}>
        👥 枠数
      </button>
      {showDetail && (
        <MemberFrameDetailModal
          app={app}
          applications={applications}
          onClose={() => setShowDetail(false)}
        />
      )}
    </>
  );
}

function hasSingleSlotMember(a: Application, frameCounts: Map<string, MemberFrameCount>): boolean {
  return a.members.some((m) => frameCounts.get(normalizeMemberName(m.name))?.count === 1);
}

type TriState = "any" | "has" | "not";

// One yes/no condition with a third "don't care" state: 指定なし (ignored),
// 〇〇いる (must have it) or 〇〇いない (must NOT have it). Lets the same
// condition be used to include or exclude bands, and two of them combine
// into things like "has a 3枠以上 member AND has no 1枠のみ member". The
// counts shown are how many bands each side would match on their own.
function TriStateFilter({
  label,
  value,
  onChange,
  hasLabel,
  notLabel,
  hasCount,
  notCount,
  title,
}: {
  label: string;
  value: TriState;
  onChange: (next: TriState) => void;
  hasLabel: string;
  notLabel: string;
  hasCount: number;
  notCount: number;
  title?: string;
}) {
  const options: [TriState, string, string][] = [
    ["any", "指定なし", "bg-slate-600 text-white"],
    ["has", `${hasLabel}（${hasCount}）`, "bg-indigo-600 text-white"],
    ["not", `${notLabel}（${notCount}）`, "bg-rose-700 text-white"],
  ];
  return (
    <div className="inline-flex flex-wrap items-center gap-1.5" role="group" aria-label={label} title={title}>
      <span className="text-[11px] text-slate-400">{label}</span>
      <div className="inline-flex overflow-hidden rounded border border-slate-600">
        {options.map(([option, text, activeClass]) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={value === option}
            className={`min-h-11 px-2.5 text-[11px] font-medium md:min-h-0 md:py-1 ${
              value === option ? activeClass : "text-slate-300 hover:bg-slate-700"
            }`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function passesTriState(state: TriState, has: boolean): boolean {
  return state === "any" || (state === "has" ? has : !has);
}

export function ApplicationTable({
  applications,
  frameCounts,
  onApprove,
  onUnapprove,
  onRequestReject,
  filterText,
  onFilterTextChange,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("applicationDateTime");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const highParticipationByAppId = useMemo(() => {
    const map = new Map<string, HighParticipationInfo>();
    for (const app of applications) {
      map.set(app.id, computeHighParticipation(app, frameCounts));
    }
    return map;
  }, [applications, frameCounts]);

  // Structured filters, AND-combined with each other and with the text query
  // below. Each yes/no condition is tri-state (指定なし / いる / いない), so it
  // can include or exclude. "1枠のみ" means the band has at least one member
  // who is in exactly one band across ALL applications (frameCounts counts
  // every application, approved or not) — the people with only a single
  // frame, which is what an organizer scans for when deciding who still has
  // room; "3枠以上" is the band-level high-participation signal the table
  // already shows as a badge.
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved">("all");
  const [syncFilter, setSyncFilter] = useState<TriState>("any");
  const [singleSlotFilter, setSingleSlotFilter] = useState<TriState>("any");
  const [highSlotFilter, setHighSlotFilter] = useState<TriState>("any");

  // Date/time filter. The candidate dates and clock times are read out of the
  // applications' own 出演希望日 text (see scheduleAvailability.ts), so the
  // organizer only ever clicks what was actually written. A date is tri-state
  // like the other conditions (出られる / 出られない); picking a time narrows
  // "can play on that date" to "can play on that date at that time" and, with
  // no date chosen, means "can play at that time on at least one day".
  const [dateFilters, setDateFilters] = useState<Record<number, TriState>>({});
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  // 日時指定そのものの状態: "認識できない" = the text has something the
  // scheduler can't read (or leftover ~~取り消し線~~), "未記入" = blank.
  const [unrecognizedFilter, setUnrecognizedFilter] = useState<TriState>("any");
  const [blankScheduleFilter, setBlankScheduleFilter] = useState<TriState>("any");
  const availabilityByAppId = useMemo(
    () => new Map(applications.map((a) => [a.id, parseScheduleAvailability(a.desiredDateTime)])),
    [applications],
  );
  const scheduleCandidates = useMemo(
    () => collectScheduleCandidates([...availabilityByAppId.values()]),
    [availabilityByAppId],
  );
  const scheduleCounts = useMemo(
    () => ({
      unrecognized: applications.filter((a) => isScheduleTextUnrecognized(a.desiredDateTime)).length,
      blank: applications.filter((a) => !a.desiredDateTime.trim()).length,
    }),
    [applications],
  );
  const dateAvailableCounts = useMemo(
    () =>
      Object.fromEntries(
        scheduleCandidates.days.map((day) => [
          day,
          applications.filter((a) => isAvailableOn(availabilityByAppId.get(a.id)!, day, selectedTime)).length,
        ]),
      ) as Record<number, number>,
    [applications, availabilityByAppId, scheduleCandidates, selectedTime],
  );

  const hasHighSlotMember = (a: Application) =>
    (highParticipationByAppId.get(a.id)?.highCount ?? 0) > 0;

  // How many bands have each property — the "いる" count; "いない" is the rest.
  const triCounts = useMemo(
    () => ({
      sync: applications.filter((a) => a.hasSync).length,
      single: applications.filter((a) => hasSingleSlotMember(a, frameCounts)).length,
      high: applications.filter((a) => (highParticipationByAppId.get(a.id)?.highCount ?? 0) > 0).length,
    }),
    [applications, frameCounts, highParticipationByAppId],
  );

  const filtered = useMemo(() => {
    const query = filterText.trim().toLowerCase();
    // Whitespace (incl. full-width) separates conditions, ALL of which must
    // match: "1年 Vo" = a band with something matching 1年 AND something
    // matching Vo. Each term is matched against band name, applicant,
    // member name/grade/part and desired date. A term with a leading "-"
    // excludes instead: "1年 -Vo" = matches 1年 and nothing matches Vo. (A
    // lone "-" is just a literal character, not an empty exclusion.) A
    // multi-word query with no exclusions is also tried whole, so a spaced
    // name ("鈴木 啓大郎", e.g. from clicking a member chip) still finds its
    // exact member and not only bands that happen to match both halves
    // separately.
    const requiredDayChosen = scheduleCandidates.days.some((day) => dateFilters[day] === "has");
    const tokens = query.split(/[\s\u3000]+/).filter(Boolean);
    const isExclusion = (token: string) => token.length > 1 && /^[-−－]/.test(token);
    const excludeTerms = tokens.filter(isExclusion).map((token) => token.slice(1));
    const terms = tokens.filter((token) => !isExclusion(token));

    // Member names are matched name-normalized (see normalizeMemberName) so
    // clicking a member chip — or just typing their name with different
    // spacing than a particular application recorded — still finds every
    // band they're in, not only the ones spelled exactly like the query.
    const matchesTerm = (a: Application, term: string) => {
      const normalizedTerm = normalizeMemberName(term);
      return (
        a.bandName.toLowerCase().includes(term) ||
        a.applicantName.toLowerCase().includes(term) ||
        a.desiredDateTime.toLowerCase().includes(term) ||
        a.members.some(
          (m) =>
            m.name.toLowerCase().includes(term) ||
            normalizeMemberName(m.name).toLowerCase().includes(normalizedTerm) ||
            m.grade.toLowerCase().includes(term) ||
            m.part.toLowerCase().includes(term),
        )
      );
    };

    return applications.filter((a) => {
      if (statusFilter === "pending" && a.approved) return false;
      if (statusFilter === "approved" && !a.approved) return false;
      if (!passesTriState(syncFilter, a.hasSync)) return false;
      if (!passesTriState(singleSlotFilter, hasSingleSlotMember(a, frameCounts))) return false;
      if (!passesTriState(highSlotFilter, hasHighSlotMember(a))) return false;
      if (!passesTriState(unrecognizedFilter, isScheduleTextUnrecognized(a.desiredDateTime))) return false;
      if (!passesTriState(blankScheduleFilter, !a.desiredDateTime.trim())) return false;
      const availability = availabilityByAppId.get(a.id)!;
      for (const day of scheduleCandidates.days) {
        const state = dateFilters[day] ?? "any";
        if (state === "any") continue;
        if (!passesTriState(state, isAvailableOn(availability, day, selectedTime))) return false;
      }
      if (
        selectedTime !== null &&
        !requiredDayChosen &&
        !isAvailableAtAnyDay(availability, selectedTime)
      ) {
        return false;
      }
      if (excludeTerms.some((t) => matchesTerm(a, t))) return false;
      if (terms.length === 0) return true;
      return (
        terms.every((t) => matchesTerm(a, t)) ||
        (terms.length > 1 && excludeTerms.length === 0 && matchesTerm(a, query))
      );
    });
    // hasHighSlotMember only reads highParticipationByAppId, which is listed.
  }, [
    applications,
    filterText,
    statusFilter,
    syncFilter,
    singleSlotFilter,
    highSlotFilter,
    frameCounts,
    highParticipationByAppId,
    availabilityByAppId,
    scheduleCandidates,
    dateFilters,
    selectedTime,
    unrecognizedFilter,
    blankScheduleFilter,
  ]);

  const isFiltered =
    filterText.trim() !== "" ||
    statusFilter !== "all" ||
    syncFilter !== "any" ||
    singleSlotFilter !== "any" ||
    highSlotFilter !== "any" ||
    Object.values(dateFilters).some((state) => state !== "any") ||
    selectedTime !== null ||
    unrecognizedFilter !== "any" ||
    blankScheduleFilter !== "any";

  function clearAllFilters() {
    onFilterTextChange("");
    setStatusFilter("all");
    setSyncFilter("any");
    setSingleSlotFilter("any");
    setHighSlotFilter("any");
    setDateFilters({});
    setSelectedTime(null);
    setUnrecognizedFilter("any");
    setBlankScheduleFilter("any");
  }

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "applicantName":
          cmp = a.applicantName.localeCompare(b.applicantName, "ja");
          break;
        case "applicationDateTime":
          cmp = a.applicationDateTime.localeCompare(b.applicationDateTime, "ja");
          break;
        case "bandName":
          cmp = a.bandName.localeCompare(b.bandName, "ja");
          break;
        case "durationMinutes":
          cmp = (a.durationMinutes ?? -1) - (b.durationMinutes ?? -1);
          break;
        case "desiredDateTime":
          cmp = a.desiredDateTime.localeCompare(b.desiredDateTime, "ja");
          break;
        case "hasSync":
          cmp = Number(a.hasSync) - Number(b.hasSync);
          break;
        case "memberCount":
          cmp = a.members.length - b.members.length;
          break;
        case "highParticipationCount":
          cmp =
            (highParticipationByAppId.get(a.id)?.highCount ?? 0) -
            (highParticipationByAppId.get(b.id)?.highCount ?? 0);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir, highParticipationByAppId]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function sortIndicator(key: SortKey) {
    if (key !== sortKey) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  const headerClass =
    "cursor-pointer select-none whitespace-nowrap px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-200";
  const plainHeaderClass =
    "px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500";

  return (
    <div className="flex flex-1 flex-col gap-2 md:min-h-0">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <input
          type="text"
          value={filterText}
          onChange={(e) => onFilterTextChange(e.target.value)}
          placeholder="スペース区切りで複数条件（AND）／除外は -語（例: 1年 -Vo）"
          title="バンド名・申請者・メンバー・学年・パート・希望日を検索。スペース区切りの語がすべて一致するバンドを表示（語ごとの一致は別のメンバーでも可）。「-語」を付けるとその語に一致するバンドを除外します。例：「ヨルシカ 9/27」「1年 Vo」「1年 -Vo」"
          className="min-h-11 w-full max-w-md rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-500 md:min-h-0"
        />
        {isFiltered && (
          <button
            type="button"
            onClick={clearAllFilters}
            className="min-h-11 rounded border border-slate-600 px-3 text-[11px] text-slate-300 hover:bg-slate-700 md:min-h-0 md:py-1"
          >
            絞り込みを解除
          </button>
        )}
        <span className="text-xs text-slate-500">
          {sorted.length}件{isFiltered ? `（全${applications.length}件中）` : ""}
        </span>
        <button
          type="button"
          onClick={() => toggleSort("highParticipationCount")}
          className={`min-h-11 rounded border px-3 text-[11px] font-medium md:min-h-0 md:py-1 ${
            sortKey === "highParticipationCount"
              ? "border-amber-500 bg-amber-950/50 text-amber-300"
              : "border-slate-600 text-slate-300 hover:bg-slate-700"
          }`}
        >
          3枠以上の人数で並び替え{sortIndicator("highParticipationCount")}
        </button>
      </div>

      {/* Structured filters — AND-combined with each other and with the text
          query above; each yes/no one can include (いる/あり) or exclude
          (いない/なし). */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5" role="group" aria-label="絞り込み条件">
        <div className="inline-flex overflow-hidden rounded border border-slate-600" role="group" aria-label="承認状態">
          {(
            [
              ["all", "すべて"],
              ["pending", "未承認"],
              ["approved", "承認済み"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatusFilter(value)}
              aria-pressed={statusFilter === value}
              className={`min-h-11 px-3 text-[11px] font-medium md:min-h-0 md:py-1 ${
                statusFilter === value
                  ? "bg-indigo-600 text-white"
                  : "text-slate-300 hover:bg-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <TriStateFilter
          label="同期演奏"
          value={syncFilter}
          onChange={setSyncFilter}
          hasLabel="あり"
          notLabel="なし"
          hasCount={triCounts.sync}
          notCount={applications.length - triCounts.sync}
        />
        <TriStateFilter
          label="1枠のみの参加者"
          value={singleSlotFilter}
          onChange={setSingleSlotFilter}
          hasLabel="いる"
          notLabel="いない"
          hasCount={triCounts.single}
          notCount={applications.length - triCounts.single}
          title="全申し込みを通じて1バンドにしか参加していないメンバーがいるバンド（いない＝そういうメンバーが1人もいないバンド）"
        />
        <TriStateFilter
          label="3枠以上の参加者"
          value={highSlotFilter}
          onChange={setHighSlotFilter}
          hasLabel="いる"
          notLabel="いない"
          hasCount={triCounts.high}
          notCount={applications.length - triCounts.high}
          title="全申し込みを通じて3バンド以上に参加しているメンバーがいるバンド（いない＝そういうメンバーが1人もいないバンド）"
        />
      </div>

      <div className="flex shrink-0 flex-col gap-1.5" role="group" aria-label="日程の絞り込み">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-[11px] font-semibold text-slate-400">出演希望日（申請の記載から自動）</span>
            {scheduleCandidates.days.map((day) => (
              <TriStateFilter
                key={day}
                label={`${day}日`}
                value={dateFilters[day] ?? "any"}
                onChange={(next) => setDateFilters((prev) => ({ ...prev, [day]: next }))}
                hasLabel="出られる"
                notLabel="出られない"
                hasCount={dateAvailableCounts[day] ?? 0}
                notCount={applications.length - (dateAvailableCounts[day] ?? 0)}
                title={`希望日に${day}日が書かれている、または日付の指定がない（両日可能など）申請を「出られる」と数えます`}
              />
            ))}
            <TriStateFilter
              label="日時指定の認識"
              value={unrecognizedFilter}
              onChange={setUnrecognizedFilter}
              hasLabel="認識できない"
              notLabel="認識できている"
              hasCount={scheduleCounts.unrecognized}
              notCount={applications.length - scheduleCounts.unrecognized}
              title="日付や時間が読み取れない書き方、または ~~取り消し線~~ が残っている申請。日時指定の絞り込みやシミュレーターの収容チェックに正しく反映されないので、編集で直せます"
            />
            <TriStateFilter
              label="日時指定の記入"
              value={blankScheduleFilter}
              onChange={setBlankScheduleFilter}
              hasLabel="未記入"
              notLabel="記入あり"
              hasCount={scheduleCounts.blank}
              notCount={applications.length - scheduleCounts.blank}
              title="出演希望日が空の申請（日付の制限なし＝終日出られるものとして扱われます）"
            />
          </div>
          {scheduleCandidates.times.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-400">この時刻に出られる</span>
              {scheduleCandidates.times.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => setSelectedTime((current) => (current === minutes ? null : minutes))}
                  aria-pressed={selectedTime === minutes}
                  className={`min-h-11 rounded border px-2.5 text-[11px] font-medium md:min-h-0 md:py-1 ${
                    selectedTime === minutes
                      ? "border-indigo-400 bg-indigo-600 text-white"
                      : "border-slate-600 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {minutesToTime(minutes)}
                </button>
              ))}
              <span className="text-[11px] text-slate-500">
                選んだ日（未選択ならいずれかの日）にその時刻に出演できるバンドに絞ります。時間の書かれていない日は終日出られるものとして数えます。
              </span>
            </div>
          )}
        </div>

      {sorted.length === 0 && (
        <p className="rounded-lg border border-slate-700 px-3 py-6 text-center text-sm text-slate-500">
          該当する申し込みがありません
        </p>
      )}

      {/* Mobile (<768px): one collapsed-by-default accordion card per
          application instead of a table row — a 9-column table has no room
          to stay legible once each column drops to ~35px on a 320px
          screen, so this is a different layout, not just the same table
          squeezed down. See ApplicationMobileCard for why member/setlist
          details collapse behind local per-card state. */}
      {sorted.length > 0 && (
        <div className="flex flex-col gap-2 overflow-y-auto md:hidden">
          {sorted.map((app) => (
            <ApplicationMobileCard
              key={app.id}
              app={app}
              applications={applications}
              highParticipationInfo={highParticipationByAppId.get(app.id)!}
              onApprove={onApprove}
              onUnapprove={onUnapprove}
              onRequestReject={onRequestReject}
            />
          ))}
        </div>
      )}

      {/* Desktop/tablet (≥768px): dense sortable table. */}
      {sorted.length > 0 && (
        <div className="hidden min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-lg border border-slate-700 md:block">
          <table className="w-full table-fixed border-collapse text-xs">
            <colgroup>
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              <col className="w-[12%]" />
              <col className="w-[12%]" />
              <col className="w-[5%]" />
              <col className="w-[8%]" />
              <col className="w-[6%]" />
              <col className="w-[7%]" />
              <col className="w-[11%]" />
              <col className="w-[12%]" />
            </colgroup>
            <thead className="sticky top-0 border-b border-slate-700 bg-slate-900">
              <tr>
                <th className={headerClass} onClick={() => toggleSort("applicantName")}>
                  申請者氏名{sortIndicator("applicantName")}
                </th>
                <th className={headerClass} onClick={() => toggleSort("applicationDateTime")}>
                  申請日時{sortIndicator("applicationDateTime")}
                </th>
                <th className={headerClass} onClick={() => toggleSort("bandName")}>
                  バンド名{sortIndicator("bandName")}
                </th>
                <th className={plainHeaderClass}>セットリスト</th>
                <th className={plainHeaderClass}>メンバー</th>
                <th className={headerClass} onClick={() => toggleSort("hasSync")}>
                  同期{sortIndicator("hasSync")}
                </th>
                <th
                  className={headerClass}
                  onClick={() => toggleSort("highParticipationCount")}
                  title="このバンドのメンバーのうち、全申し込みを通じて3バンド以上に参加している人数"
                >
                  3枠以上{sortIndicator("highParticipationCount")}
                </th>
                <th className={headerClass} onClick={() => toggleSort("durationMinutes")}>
                  演奏時間{sortIndicator("durationMinutes")}
                </th>
                <th className={headerClass} onClick={() => toggleSort("desiredDateTime")}>
                  出演希望日{sortIndicator("desiredDateTime")}
                </th>
                <th className={plainHeaderClass}>状態</th>
                <th className={plainHeaderClass} title="管理者専用。一般公開データには含まれません">
                  ライブ構成評価
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((app) => (
                <tr
                  key={app.id}
                  className={`border-b border-slate-700 last:border-0 ${
                    app.approved ? "bg-emerald-950/20" : ""
                  }`}
                >
                  <td className="break-words px-2 py-1.5 text-slate-300">
                    {app.applicantName || "-"}
                  </td>
                  <td className="break-words px-2 py-1.5 text-slate-300">
                    {app.applicationDateTime || "-"}
                  </td>
                  <td className="break-words px-2 py-1.5 font-medium text-slate-100">
                    {app.bandName}
                    {app.parseWarning && (
                      <p className="mt-0.5 text-[10px] font-normal text-amber-400">
                        ⚠ {app.parseWarning}
                      </p>
                    )}
                  </td>
                  <td className="break-words px-2 py-1.5 text-slate-300">
                    <SetlistLines setlist={app.setlist} />
                  </td>
                  <td className="break-words px-2 py-1.5 text-slate-300">
                    <MemberBadgeList members={app.members} />
                  </td>
                  <td className="break-words px-2 py-1.5">
                    <Badge tone={app.hasSync ? "sync-on" : "sync-off"}>
                      {app.hasSync ? "あり" : "なし"}
                    </Badge>
                  </td>
                  <td className="break-words px-2 py-1.5">
                    <HighParticipationBadge info={highParticipationByAppId.get(app.id)!} />
                  </td>
                  <td className="break-words px-2 py-1.5 text-slate-300">
                    {app.durationMinutes != null ? `${app.durationMinutes}分` : "-"}
                  </td>
                  <td className="break-words px-2 py-1.5 text-slate-300">
                    <EditableDesiredDateTime app={app} variant="cell" />
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          app.approved ? onUnapprove(app.id) : onApprove(app.id)
                        }
                        className={
                          app.approved
                            ? "rounded border border-emerald-700 bg-emerald-900/40 px-2 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-900/70"
                            : "rounded border border-slate-600 px-2 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-700"
                        }
                      >
                        {app.approved ? "✓ キャンセル" : "承認"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRequestReject(app)}
                        className="rounded border border-rose-700 px-2 py-1 text-[11px] font-medium text-rose-400 hover:bg-rose-950/40"
                      >
                        却下
                      </button>
                      {app.linkedBandId && (
                        <EditBandButton
                          bandId={app.linkedBandId}
                          className="rounded border border-slate-600 px-2 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-700"
                        />
                      )}
                      <MemberFrameDetailButton
                        app={app}
                        applications={applications}
                        className="rounded border border-slate-600 px-2 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-700"
                      />
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    {app.linkedBandId ? (
                      <LiveCompositionRatingStars bandId={app.linkedBandId} />
                    ) : (
                      <span className="text-slate-600">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
