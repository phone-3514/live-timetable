import type { VenueHours } from "./parseBands";
import type { Band, TimetableDay } from "../types";
import { useAppStore, type EventInfo } from "../store/useAppStore";
import { useApplicationStore } from "../store/useApplicationStore";
import { useUiStore, type AppTab } from "../store/useUiStore";
import type { Application } from "../types";

const BACKUP_FORMAT_ID = "live-timetable-backup";
const BACKUP_VERSION = 1;

export type BackupData = {
  formatId: typeof BACKUP_FORMAT_ID;
  version: number;
  exportedAt: string;
  app: {
    bands: Band[];
    days: TimetableDay[];
    venueHours: VenueHours;
    eventInfo: EventInfo;
  };
  applications: Application[];
  ui: { activeTab: AppTab };
};

// Windows/macOS both forbid these in filenames; the full-width forms
// (／：＊？＂＜＞｜＼) aren't actually forbidden by any OS, but Japanese
// event names commonly use full-width punctuation and leaving it in an
// otherwise-sanitized filename would be an inconsistent, surprising half
// measure — so they're normalized alongside their ASCII counterparts. Also
// folds whitespace runs down to one underscore so "軽音祭  vol.5" doesn't
// leave doubled/trailing underscores behind.
const INVALID_FILENAME_CHARS_RE = /[\\/:*?"<>|＼／：＊？＂＜＞｜]/g;

export function sanitizeFilename(name: string): string {
  return name
    .trim()
    .replace(INVALID_FILENAME_CHARS_RE, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function formatDateForFilename(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function buildBackupFilename(liveName: string, date: Date = new Date()): string {
  const sanitized = sanitizeFilename(liveName);
  const base = sanitized || "live-timetable";
  return `${base}_backup_${formatDateForFilename(date)}.json`;
}

export function createBackupPayload(): BackupData {
  const appState = useAppStore.getState();
  const applicationState = useApplicationStore.getState();
  const uiState = useUiStore.getState();
  return {
    formatId: BACKUP_FORMAT_ID,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    app: {
      bands: appState.bands,
      days: appState.days,
      venueHours: appState.venueHours,
      eventInfo: appState.eventInfo,
    },
    applications: applicationState.applications,
    ui: { activeTab: uiState.activeTab },
  };
}

export function downloadBackupFile(filename: string): void {
  const payload = createBackupPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Deliberately permissive about *shape* beyond the format marker — an older
// export missing a field the app has since added (e.g. a new EventInfo key)
// should still restore what it does have rather than being rejected
// outright, so restoreBackup below fills in sane fallbacks per-field.
export function parseBackupFile(text: string): BackupData {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("JSONとして読み込めませんでした。ファイルが破損している可能性があります");
  }
  if (
    typeof data !== "object" ||
    data === null ||
    (data as Record<string, unknown>).formatId !== BACKUP_FORMAT_ID
  ) {
    throw new Error("このファイルはlive-timetableのバックアップ形式ではありません");
  }
  return data as BackupData;
}

export function hasUnsavedProgress(): boolean {
  return (
    useAppStore.getState().bands.length > 0 ||
    useApplicationStore.getState().applications.length > 0
  );
}

export function restoreBackup(data: BackupData): void {
  const app = data.app ?? {};
  useAppStore.setState({
    bands: app.bands ?? [],
    days: app.days ?? [],
    venueHours: app.venueHours ?? useAppStore.getState().venueHours,
    eventInfo: app.eventInfo ?? { liveName: "", venue: "", organizationName: "" },
    lastDeleted: null,
  });
  useApplicationStore.setState({
    applications: data.applications ?? [],
    rawText: "",
  });
  useUiStore.setState({ activeTab: data.ui?.activeTab ?? "timetable" });
}
