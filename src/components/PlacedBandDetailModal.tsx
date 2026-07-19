import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useApplicationStore } from "../store/useApplicationStore";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { splitSetlistEntry } from "../utils/parseApplications";
import { Badge } from "./applications/Badge";
import { ModalPortal } from "./ModalPortal";
import type { Band, BandMemberDetail, BandPaSheetLink, TimetableSlot } from "../types";
import { isGoogleWorkspaceUrl } from "../pa/types";

interface Props {
  band: Band;
  slot: TimetableSlot;
  onClose: () => void;
}

// Approved applications carry richer data (per-member part/grade, setlist
// artists, free-text preferred date) than the Band they get converted into
// (see applicationToBand in useApplicationStore.ts, which flattens members
// down to plain name strings) — so this looks up the application that
// produced this band via linkedBandId and prefers its fields, falling back
// to the Band's own flatter fields for a band with no such link (manually
// added, or the link was lost some other way). Editing a member's name/
// grade/part here writes to both the Band (via updateBand) AND, when a
// linked Application exists, that Application's own member list (via
// updateApplicationMembers) — so a correction made here (fixing a
// misspelled name, say) is immediately visible in the Application
// Manager's list, grade badges, frame counts, and search/filter too,
// instead of only ever showing up on the Timetable side. One-directional:
// the Application Manager has no member-editing UI of its own to
// propagate back the other way (see useApplicationStore.ts).
export function PlacedBandDetailModal({ band, slot, onClose }: Props) {
  useBodyScrollLock();
  const applications = useApplicationStore((s) => s.applications);
  const updateBand = useAppStore((s) => s.updateBand);
  const syncApplicationFromBand = useApplicationStore((s) => s.syncApplicationFromBand);
  const linkedApp = applications.find((a) => a.linkedBandId === band.id);

  // Priority for what's actually shown/edited: the band's own
  // memberDetails once anyone has edited it (see handleSave), then a
  // linked Application's members (pre-editing behavior), then plain names
  // with blank grade/part for a band with neither. Same order
  // computeSetlistEntries uses, so this modal and the Setlist export never
  // disagree about which member data is current.
  const displayMembers: BandMemberDetail[] =
    band.memberDetails && band.memberDetails.length > 0
      ? band.memberDetails
      : linkedApp
        ? linkedApp.members.map((m) => ({ name: m.name, grade: m.grade, part: m.part }))
        : band.members.map((name) => ({ name, grade: "", part: "" }));

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(band.name);
  const [editDuration, setEditDuration] = useState(
    band.durationMinutes != null ? String(band.durationMinutes) : "",
  );
  const [editGearTags, setEditGearTags] = useState(band.gearTags.join(", "));
  const [editMembers, setEditMembers] = useState<BandMemberDetail[]>([]);
  const [editSetlist, setEditSetlist] = useState("");
  const [editHasSync, setEditHasSync] = useState(band.hasSync);
  const [editPaSheetLinks, setEditPaSheetLinks] = useState<BandPaSheetLink[]>([]);
  const hasInvalidPaSheetLink = editPaSheetLinks.some(
    (link) => Boolean(link.url.trim()) && !isGoogleWorkspaceUrl(link.url),
  );

  // Escape cancels an in-progress edit first (same as clicking
  // "キャンセル"), rather than immediately closing the whole modal out from
  // under unsaved changes — only closes the modal outright once there's no
  // edit in progress to lose.
  useEscapeKey(() => {
    if (isEditing) {
      setIsEditing(false);
    } else {
      onClose();
    }
  });

  const desiredDateTime = linkedApp?.desiredDateTime || band.desiredTime || "未設定";
  const setlist = linkedApp
    ? linkedApp.setlist.map((s) => (s.artist ? `${s.title} / ${s.artist}` : s.title))
    : band.setlist;

  function startEditing() {
    setEditName(band.name);
    setEditDuration(band.durationMinutes != null ? String(band.durationMinutes) : "");
    setEditGearTags(band.gearTags.join(", "));
    setEditMembers(displayMembers.map((m) => ({ ...m })));
    // Seeds from the same priority-resolved `setlist` display variable used
    // below (linkedApp's setlist when one exists, else the band's own) —
    // not band.setlist directly — so editing starts from whatever's
    // actually shown, the same way editMembers seeds from displayMembers
    // rather than band.memberDetails.
    setEditSetlist(setlist.join("\n"));
    setEditHasSync(band.hasSync);
    setEditPaSheetLinks((band.paSheetLinks ?? []).map((link) => ({ ...link })));
    setIsEditing(true);
  }

  function updatePaSheetLink(index: number, patch: Partial<BandPaSheetLink>) {
    setEditPaSheetLinks((prev) =>
      prev.map((link, i) => (i === index ? { ...link, ...patch } : link)),
    );
  }

  function addPaSheetLink() {
    setEditPaSheetLinks((prev) => [
      ...prev,
      { label: `PAシート${prev.length + 1}`, url: "" },
    ]);
  }

  function updateEditMember(index: number, patch: Partial<BandMemberDetail>) {
    setEditMembers((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }

  function removeEditMember(index: number) {
    setEditMembers((prev) => prev.filter((_, i) => i !== index));
  }

  function addEditMember() {
    setEditMembers((prev) => [...prev, { name: "", grade: "", part: "" }]);
  }

  // Returns whether the save actually went through — callers that also
  // want to close the modal (see the Enter-key handler below) need to
  // know the difference between "saved" and "rejected by validation," so
  // they don't close out from under a blank name/invalid duration the
  // user hasn't fixed yet.
  function handleSave(): boolean {
    const trimmedName = editName.trim();
    if (!trimmedName) return false;
    const parsedDuration = editDuration.trim() ? Number(editDuration) : null;
    if (parsedDuration != null && (!Number.isFinite(parsedDuration) || parsedDuration <= 0)) {
      return false;
    }
    // Blank-name rows (an added-then-abandoned row, or a name someone
    // cleared) are dropped rather than saved as an empty member — same
    // "don't persist obviously-incomplete input" rule the gear-tag field
    // below already follows (empty tags filtered out after the comma
    // split).
    const cleanedMembers = editMembers
      .map((m) => ({ name: m.name.trim(), grade: m.grade.trim(), part: m.part.trim() }))
      .filter((m) => m.name.length > 0);
    const cleanedSetlist = editSetlist
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const cleanedPaSheetLinks = editPaSheetLinks
      .map((link, index) => ({
        label: link.label.trim() || `PAシート${index + 1}`,
        url: link.url.trim(),
      }))
      .filter((link) => link.url.length > 0);
    if (cleanedPaSheetLinks.some((link) => !isGoogleWorkspaceUrl(link.url))) return false;
    // Slot start/end times aren't stored on the Band itself — they're
    // recomputed from cumulative durations down the day whenever any band's
    // durationMinutes changes (see recomputeTimes in useAppStore), so
    // changing the number here is what "moves" this band's time on the
    // grid, including every band after it that day.
    updateBand(band.id, {
      name: trimmedName,
      durationMinutes: parsedDuration ?? undefined,
      gearTags: editGearTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      memberDetails: cleanedMembers,
      // members stays a plain name list in sync with memberDetails — it's
      // what the Timetable display and conflict detection
      // (getMemberConflictDetails) actually read, so a rename here needs
      // to show up there too, not just in the Setlist export.
      members: cleanedMembers.map((m) => m.name),
      setlist: cleanedSetlist,
      hasSync: editHasSync,
      paSheetLinks: cleanedPaSheetLinks,
    });
    // Propagate to the Application Manager's own copy too, so it never
    // shows stale name/setlist/sync status/members after an edit made here
    // — see this component's top-of-file comment. splitSetlistEntry is the
    // exact same title/artist split parseApplications uses when first
    // reading a submission, so a setlist edited here round-trips through
    // the Application's structured {title, artist} shape without drifting
    // from how every other setlist in the app got parsed.
    if (linkedApp) {
      syncApplicationFromBand(linkedApp.id, {
        bandName: trimmedName,
        members: cleanedMembers,
        setlist: cleanedSetlist.map(splitSetlistEntry),
        hasSync: editHasSync,
      });
    }
    setIsEditing(false);
    return true;
  }

  // Enter-to-advance: view → edit → save-and-close, entirely keyboard
  // driven. A window-level listener (rather than a React onKeyDown on the
  // modal div) so it fires even when nothing inside the modal happens to
  // have focus yet (activeElement then falls back to <body>, which isn't
  // TEXTAREA or BUTTON and so still hits the normal-input/background
  // branch below) — the same reasoning as useEscapeKey's own
  // window-level listener. Checked via document.activeElement rather than
  // e.target because a window listener's target is always `window`
  // itself, never the focused element.
  //
  // TEXTAREA is excluded so Enter inserts a newline in the setlist field
  // instead of submitting — a multi-line field where Enter is expected to
  // do the obvious text-editing thing. BUTTON is excluded because a
  // focused <button> already activates its own onClick on Enter
  // natively; re-handling it here would double-fire save/edit.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Enter") return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "TEXTAREA" || tag === "BUTTON") return;
      e.preventDefault();
      if (isEditing) {
        if (handleSave()) onClose();
      } else {
        startEditing();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        // max-h-[85vh] + the inner flex-1/overflow-y-auto wrapper below
        // (same pattern ScheduleReviewModal already uses) is what stops
        // a band with many members/a long setlist from pushing this
        // modal's Save/Cancel buttons off the bottom of a short mobile
        // viewport — the header and footer stay pinned, only the
        // <dl> content in between scrolls internally.
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-2">
          {isEditing ? (
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="min-h-11 flex-1 rounded border border-indigo-500 bg-slate-800 px-2 py-1 text-sm font-semibold text-slate-100 outline-none md:min-h-0"
              placeholder="バンド名"
              autoFocus
            />
          ) : (
            <h2 className="text-sm font-semibold text-slate-100">{band.name}</h2>
          )}
          {!isEditing && (
            <button
              type="button"
              onClick={startEditing}
              className="flex h-9 shrink-0 items-center gap-1 rounded border border-slate-600 px-2 text-xs font-medium text-slate-300 hover:bg-slate-700"
              title="バンド名・演奏時間・メンバー・セットリスト・同期演奏を編集"
            >
              ✎ 編集
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none text-slate-500 hover:bg-slate-700 hover:text-slate-300"
            title="閉じる"
          >
            ×
          </button>
        </div>

        <dl className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto text-xs">
          <div>
            <dt className="font-semibold text-slate-500">演奏時間</dt>
            <dd className="mt-0.5 text-slate-200">
              {isEditing ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    value={editDuration}
                    onChange={(e) => setEditDuration(e.target.value)}
                    className="min-h-11 w-20 rounded border border-indigo-500 bg-slate-800 px-2 py-1 text-sm text-slate-100 outline-none [appearance:textfield] md:min-h-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <span>分</span>
                </div>
              ) : (
                <>
                  {slot.startTime && slot.endTime
                    ? `${slot.startTime} - ${slot.endTime}`
                    : "未配置"}
                  {band.durationMinutes != null && (
                    <span className="ml-1.5 text-slate-400">
                      （{band.durationMinutes}分）
                    </span>
                  )}
                </>
              )}
            </dd>
            {isEditing && (
              <p className="mt-1 text-[11px] text-slate-500">
                演奏時間を変更すると、この枠以降の開始・終了時刻が自動的に再計算されます
              </p>
            )}
          </div>

          <div>
            <dt className="font-semibold text-slate-500">出演希望日</dt>
            <dd className="mt-0.5 text-slate-200">{desiredDateTime}</dd>
          </div>

          <div>
            <dt className="font-semibold text-slate-500">同期・機材</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-1.5">
              {isEditing ? (
                <label className="flex min-h-11 items-center gap-1.5 text-slate-200 md:min-h-0">
                  <input
                    type="checkbox"
                    checked={editHasSync}
                    onChange={(e) => setEditHasSync(e.target.checked)}
                    className="h-4 w-4 accent-indigo-500"
                  />
                  同期演奏あり
                </label>
              ) : (
                <Badge tone={band.hasSync ? "sync-on" : "sync-off"}>
                  同期演奏{band.hasSync ? "あり" : "なし"}
                </Badge>
              )}
              {band.hasKeyboard && <Badge tone="part">🎹 キーボードあり</Badge>}
            </dd>
          </div>

          <div>
            <dt className="font-semibold text-slate-500">共有機材タグ</dt>
            <dd className="mt-1">
              {isEditing ? (
                <input
                  value={editGearTags}
                  onChange={(e) => setEditGearTags(e.target.value)}
                  placeholder="カンマ区切り（例：共有キーボード）"
                  className="min-h-11 w-full rounded border border-indigo-500 bg-slate-800 px-2 py-1 text-sm text-slate-100 outline-none placeholder:text-slate-500 md:min-h-0"
                />
              ) : band.gearTags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {band.gearTags.map((tag) => (
                    <Badge key={tag} tone="warning">
                      ⚙ {tag}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-slate-500">未設定</p>
              )}
            </dd>
          </div>

          <div>
            <dt className="font-semibold text-slate-500">メンバー</dt>
            <dd className="mt-1">
              {isEditing ? (
                <div className="space-y-1.5">
                  {editMembers.map((m, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-1.5">
                      <input
                        value={m.grade}
                        onChange={(e) => updateEditMember(i, { grade: e.target.value })}
                        placeholder="学年"
                        aria-label={`メンバー${i + 1}の学年`}
                        className="min-h-11 w-14 rounded border border-indigo-500 bg-slate-800 px-1.5 py-1 text-xs text-slate-100 outline-none placeholder:text-slate-500 md:min-h-0"
                      />
                      <input
                        value={m.part}
                        onChange={(e) => updateEditMember(i, { part: e.target.value })}
                        placeholder="パート"
                        aria-label={`メンバー${i + 1}のパート`}
                        className="min-h-11 w-16 rounded border border-indigo-500 bg-slate-800 px-1.5 py-1 text-xs text-slate-100 outline-none placeholder:text-slate-500 md:min-h-0"
                      />
                      <input
                        value={m.name}
                        onChange={(e) => updateEditMember(i, { name: e.target.value })}
                        placeholder="氏名"
                        aria-label={`メンバー${i + 1}の氏名`}
                        className="min-h-11 min-w-24 flex-1 rounded border border-indigo-500 bg-slate-800 px-1.5 py-1 text-xs text-slate-100 outline-none placeholder:text-slate-500 md:min-h-0"
                      />
                      <button
                        type="button"
                        onClick={() => removeEditMember(i)}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-rose-950/60 hover:text-rose-400 md:h-6 md:w-6"
                        title="このメンバーを削除"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addEditMember}
                    className="min-h-9 rounded border border-slate-600 px-2 text-xs text-slate-300 hover:bg-slate-700 md:min-h-0 md:py-1"
                  >
                    + メンバーを追加
                  </button>
                </div>
              ) : displayMembers.length > 0 ? (
                <ul className="space-y-1">
                  {displayMembers.map((m, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-1">
                      {m.grade && <Badge tone="grade">{m.grade}</Badge>}
                      {m.part && <Badge tone="part">{m.part}</Badge>}
                      <span className="text-slate-200">{m.name}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-slate-500">未設定</p>
              )}
            </dd>
          </div>

          <div>
            <dt className="font-semibold text-slate-500">セットリスト</dt>
            <dd className="mt-1">
              {isEditing ? (
                <textarea
                  value={editSetlist}
                  onChange={(e) => setEditSetlist(e.target.value)}
                  placeholder={"1行に1曲（例：桜の時/aiko）"}
                  rows={4}
                  className="w-full rounded border border-indigo-500 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                />
              ) : setlist.length > 0 ? (
                <ul className="space-y-0.5 text-slate-200">
                  {setlist.map((song, i) => (
                    <li key={i}>{song}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-slate-500">未設定</p>
              )}
            </dd>
          </div>

          <div>
            <dt className="font-semibold text-slate-500">PA／ステージ資料</dt>
            <dd className="mt-1">
              {isEditing ? (
                <div className="space-y-2">
                  {editPaSheetLinks.map((link, index) => {
                    const invalid = Boolean(link.url.trim()) && !isGoogleWorkspaceUrl(link.url);
                    return (
                      <div key={index} className="rounded-lg border border-slate-700 bg-slate-950/45 p-2">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <input
                              value={link.label}
                              onChange={(e) => updatePaSheetLink(index, { label: e.target.value })}
                              placeholder={`PAシート${index + 1}`}
                              aria-label={`PA資料${index + 1}のラベル`}
                              className="min-h-11 w-full rounded border border-slate-600 bg-slate-800 px-3 text-sm font-semibold text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-500 md:min-h-9"
                            />
                            <input
                              type="url"
                              inputMode="url"
                              value={link.url}
                              onChange={(e) => updatePaSheetLink(index, { url: e.target.value })}
                              placeholder="https://drive.google.com/..."
                              aria-label={`PA資料${index + 1}のGoogle Drive URL`}
                              aria-invalid={invalid}
                              className={`min-h-11 w-full rounded border bg-slate-800 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 md:min-h-9 ${invalid ? "border-rose-500 focus:border-rose-400" : "border-slate-600 focus:border-blue-500"}`}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => setEditPaSheetLinks((prev) => prev.filter((_, i) => i !== index))}
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-700 text-lg text-slate-400 hover:border-rose-700 hover:bg-rose-950/60 hover:text-rose-300 md:h-9 md:w-9"
                            title="このリンクを削除"
                            aria-label={`${link.label || `PA資料${index + 1}`}を削除`}
                          >
                            ×
                          </button>
                        </div>
                        {invalid && <p className="mt-1.5 text-[11px] font-semibold text-rose-300" role="alert">Google DriveまたはGoogle Docsの共有URLを入力してください</p>}
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={addPaSheetLink}
                    className="min-h-11 w-full rounded-lg border border-dashed border-blue-500/70 bg-blue-950/30 px-3 text-sm font-bold text-blue-200 hover:bg-blue-900/50 md:min-h-9 md:text-xs"
                  >
                    ＋ リンクを追加
                  </button>
                  <p className="text-[11px] leading-5 text-slate-500">Main PA、Sub PA、照明、ステージ図など、用途が分かる名前を付けられます。</p>
                </div>
              ) : (band.paSheetLinks ?? []).length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {(band.paSheetLinks ?? []).map((link, index) => (
                    <a
                      key={`${link.url}-${index}`}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-9 items-center rounded-lg border border-blue-700/70 bg-blue-950/40 px-3 font-semibold text-blue-200 hover:bg-blue-900/60"
                    >
                      {link.label || `PAシート${index + 1}`} ↗
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-slate-500">個別リンク未設定</p>
              )}
            </dd>
          </div>
        </dl>

        <div className="mt-5 flex shrink-0 justify-end gap-2">
          {isEditing ? (
            <>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="min-h-11 rounded border border-slate-600 px-4 text-sm font-medium text-slate-300 hover:bg-slate-700 sm:min-h-0 sm:py-1.5 sm:text-xs"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!editName.trim() || hasInvalidPaSheetLink}
                className="min-h-11 rounded bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 sm:py-1.5 sm:text-xs"
              >
                保存
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded border border-slate-600 px-4 text-sm font-medium text-slate-300 hover:bg-slate-700 sm:min-h-0 sm:py-1.5 sm:text-xs"
            >
              閉じる
            </button>
          )}
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
