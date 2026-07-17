import { useRef, useState } from "react";
import { useApplicationStore } from "../../store/useApplicationStore";
import { useToastStore } from "../../store/useToastStore";
import { parseChatExportFile } from "../../utils/parseChatExportFile";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// Sole entry point for getting applications into the Application Manager —
// the old manual paste-and-parse textarea is gone (superseded by this once
// noise-filtered batch file upload could handle everything the textarea
// could, plus multi-message exports it never could), so this is now a
// single prominent dropzone rather than one small button next to a bigger
// primary action.
export function ApplicationImportPanel() {
  const addApplications = useApplicationStore((s) => s.addApplications);
  const showToast = useToastStore((s) => s.show);

  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleFile(file: File) {
    setIsProcessing(true);
    // Let the "解析中…" state actually paint before the (potentially heavy,
    // synchronous) regex parse of a large export runs — file.text() alone
    // yields once, but a second frame after that guarantees the spinner is
    // on screen first for very large files.
    await nextFrame();
    try {
      const text = await file.text();
      await nextFrame();
      const result = parseChatExportFile(text, file.name);
      if (result.applications.length > 0) {
        addApplications(result.applications);
      }
      const noiseNote = result.noiseFilteredCount > 0 ? `（ノイズ${result.noiseFilteredCount}件を除外）` : "";
      showToast(
        `${result.messageCount}件のメッセージを処理し、${result.applications.length}件の有効な申し込みを検出しました${noiseNote}`,
        result.applications.length > 0 ? "success" : "info",
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "ファイルの解析に失敗しました", "error");
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      <h2 className="text-xs font-semibold text-slate-400">
        Discordチャットログを取り込み
      </h2>
      <div
        onClick={() => !isProcessing && fileInputRef.current?.click()}
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
        title="DiscordChatExporterのエクスポートファイル（.json / .txt）をドラッグ＆ドロップ、またはクリックして選択"
        className={`flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
          isDragOver
            ? "border-indigo-400 bg-indigo-950/40"
            : "border-slate-700 hover:border-slate-500 hover:bg-slate-800/50"
        } ${isProcessing ? "cursor-wait opacity-70" : ""}`}
      >
        {isProcessing ? (
          <>
            <span
              aria-hidden
              className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"
            />
            <span className="text-xs font-medium text-slate-300">メッセージを解析中…</span>
          </>
        ) : (
          <>
            <span className="text-2xl" aria-hidden>
              📁
            </span>
            <span className="text-xs font-medium text-slate-300">
              ここにチャットログファイル（.json / .txt）を
              <br />
              ドラッグ＆ドロップ
            </span>
            <span className="text-[11px] text-slate-500">またはクリックして選択</span>
          </>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.txt,application/json,text/plain"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
        className="hidden"
      />
      <p className="text-[11px] text-slate-500">
        Discordのチャット履歴エクスポート（JSON/TXT）を丸ごと取り込み、テンプレートやダミーデータ・雑談を自動除外して有効な申し込みだけを追加します。
      </p>
    </div>
  );
}
