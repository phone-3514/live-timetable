import { useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useToastStore } from "../store/useToastStore";
import { hasUnsavedProgress, parseBackupFile, restoreBackup, type BackupData } from "../utils/backup";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { BackupExportDialog } from "./BackupExportDialog";

// Compact pair of buttons living in the header nav row (not a large
// permanently-expanded card) — this app is tuned to fit one screen without
// scrolling (see the md:h-screen/overflow-hidden layout in App.tsx), so a
// big dropzone card would fight that. The restore button doubles as a drop
// target instead: same footprint, still supports drag & drop.
export function BackupControls() {
  const liveName = useAppStore((s) => s.eventInfo.liveName);
  const showToast = useToastStore((s) => s.show);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<BackupData | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Escape always cancels this confirm dialog, never confirms it — a
  // dismiss key must never be able to trigger the destructive overwrite.
  // The listener stays attached for BackupControls' whole lifetime (it's
  // never unmounted itself), so it just no-ops whenever pendingRestore is
  // null instead of being conditionally attached/detached.
  useEscapeKey(() => {
    if (pendingRestore) setPendingRestore(null);
  });

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".json")) {
      showToast("JSON形式のバックアップファイルを選択してください", "error");
      return;
    }
    setIsProcessing(true);
    try {
      const text = await file.text();
      const data = parseBackupFile(text);
      if (hasUnsavedProgress()) {
        setPendingRestore(data);
      } else {
        applyRestore(data);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "ファイルの読み込みに失敗しました", "error");
    } finally {
      setIsProcessing(false);
    }
  }

  function applyRestore(data: BackupData) {
    restoreBackup(data);
    const name = data.app?.eventInfo?.liveName || "無題のライブ";
    showToast(`『${name}』のデータを正常に復元しました！`, "success");
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = "";
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={() => setShowExportDialog(true)}
        className="min-h-11 rounded border border-slate-600 px-2.5 text-xs font-medium text-slate-300 hover:bg-slate-800 md:min-h-0 md:py-1"
      >
        💾 データを保存
      </button>

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
        title="ここにバックアップファイル（.json）をドラッグ＆ドロップ、またはクリックして選択"
        disabled={isProcessing}
        className={`min-h-11 rounded border px-2.5 text-xs font-medium transition-colors md:min-h-0 md:py-1 ${
          isDragOver
            ? "border-indigo-400 bg-indigo-950/60 text-indigo-200"
            : "border-slate-600 text-slate-300 hover:bg-slate-800"
        } ${isProcessing ? "cursor-wait opacity-60" : ""}`}
      >
        {isProcessing ? "読み込み中…" : "📂 データを復元"}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleInputChange}
        className="hidden"
      />

      {showExportDialog && (
        <BackupExportDialog liveName={liveName} onClose={() => setShowExportDialog(false)} />
      )}

      {pendingRestore && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl">
            <h2 className="text-sm font-semibold text-slate-100">データを復元しますか？</h2>
            <p className="mt-2 text-xs text-slate-400">
              現在の編集内容が上書きされます。よろしいですか？
            </p>
            <div className="mt-5 flex flex-col-reverse justify-end gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => setPendingRestore(null)}
                className="min-h-11 rounded border border-slate-600 px-4 text-sm font-medium text-slate-300 hover:bg-slate-800 sm:min-h-0 sm:py-1.5 sm:text-xs"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => {
                  applyRestore(pendingRestore);
                  setPendingRestore(null);
                }}
                className="min-h-11 rounded bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-500 sm:min-h-0 sm:py-1.5 sm:text-xs"
              >
                上書きして復元する
              </button>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
