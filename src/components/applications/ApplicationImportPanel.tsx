import { useRef, useState } from "react";
import { useApplicationStore } from "../../store/useApplicationStore";
import { useToastStore } from "../../store/useToastStore";
import { parseChatExportFile } from "../../utils/parseChatExportFile";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export function ApplicationImportPanel() {
  const rawText = useApplicationStore((s) => s.rawText);
  const setRawText = useApplicationStore((s) => s.setRawText);
  const parseAndAddFromRawText = useApplicationStore((s) => s.parseAndAddFromRawText);
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
        Discordの出演申し込みメッセージを貼り付け
      </h2>
      <textarea
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        placeholder={
          "バンド名：ヤバい夏合宿さん\n1.あつまれ！パーティピーポー / ヤバイTシャツ屋さん\n2年 Vo.深澤実夢\n同期演奏：なし\n演奏時間：10分\n（複数バンド分をまとめて貼り付けても自動で分割されます）"
        }
        rows={8}
        className="w-full resize-y rounded-lg border border-slate-700 bg-slate-800 p-2 font-mono text-xs text-slate-100 placeholder:text-slate-500"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={parseAndAddFromRawText}
          disabled={!rawText.trim()}
          className="min-h-11 rounded bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 md:min-h-0 md:px-3 md:py-1 md:text-xs md:font-normal"
        >
          解析して追加
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
          disabled={isProcessing}
          title="DiscordChatExporterのエクスポートファイル（.json / .txt）をドラッグ＆ドロップ、またはクリックして選択"
          className={`flex min-h-11 items-center gap-1.5 rounded border px-3 text-xs font-medium transition-colors md:min-h-0 md:py-1 ${
            isDragOver
              ? "border-indigo-400 bg-indigo-950/60 text-indigo-200"
              : "border-slate-600 text-slate-300 hover:bg-slate-800"
          } ${isProcessing ? "cursor-wait opacity-70" : ""}`}
        >
          {isProcessing ? (
            <>
              <span
                aria-hidden
                className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"
              />
              メッセージを解析中…
            </>
          ) : (
            "📁 チャットログファイルを取り込む"
          )}
        </button>
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
      </div>
      <p className="text-[11px] text-slate-500">
        Discordのチャット履歴エクスポート（JSON/TXT）を丸ごと取り込み、テンプレートやダミーデータ・雑談を自動除外して有効な申し込みだけを追加します。
      </p>
    </div>
  );
}
