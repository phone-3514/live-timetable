import { useRef, useState } from "react";
import { useFuriganaStore } from "../store/useFuriganaStore";
import { useToastStore } from "../store/useToastStore";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { parseFuriganaMasterData } from "../utils/furiganaImport";

interface Props {
  onClose: () => void;
}

// Lets staff paste or upload a name master sheet (氏名・ふりがな, typically
// exported from a stricter membership system) so the Excel roster export
// can carry proper ふりがな instead of leaving it blank. The master sheet
// commonly also has addresses/phone numbers/etc. next to those two columns
// — parseFuriganaMasterData only ever reads the 氏名/ふりがな columns by
// header name, and this component never stores the raw pasted text or file
// contents anywhere itself (local state only, cleared on import/close), so
// nothing beyond name+furigana pairs ever reaches useFuriganaStore or its
// localStorage persistence.
export function FuriganaImportModal({ onClose }: Props) {
  const importFurigana = useFuriganaStore((s) => s.importFurigana);
  const clearFurigana = useFuriganaStore((s) => s.clearFurigana);
  const furiganaCount = useFuriganaStore((s) => Object.keys(s.furiganaByKey).length);
  const showToast = useToastStore((s) => s.show);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  useEscapeKey(onClose);

  const handleFile = async (file: File) => {
    setText(await file.text());
    setError(null);
  };

  const handleImport = () => {
    setError(null);
    let result;
    try {
      result = parseFuriganaMasterData(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "取り込みに失敗しました");
      return;
    }
    if (result.entries.length === 0) {
      setError(
        "取り込めるデータが見つかりませんでした。氏名とふりがなが両方入力されている行があるか確認してください。",
      );
      return;
    }
    const imported = importFurigana(result.entries);
    showToast(
      `${imported}名分のふりがなを取り込みました${
        result.skippedCount > 0 ? `（${result.skippedCount}行はスキップ）` : ""
      }`,
      "success",
    );
    setText("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">📥 ふりがなを取り込む</h2>
            <p className="mt-1 text-xs text-slate-400">
              名簿マスタ（氏名・ふりがな列を含むCSV／表）を貼り付けるか、ファイルをアップロードしてください。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none text-slate-500 hover:bg-slate-800 hover:text-slate-300"
            title="閉じる"
          >
            ×
          </button>
        </div>

        <div className="mt-3 rounded-md border border-amber-700 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-300">
          🔒 プライバシー保護：取り込み時に「氏名」列と「ふりがな」列だけを抽出します。住所・電話番号など他の列は読み込んだ時点で破棄され、保存されることはありません。
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv,text/plain,text/tab-separated-values"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
            aria-label="名簿マスタファイルを選択"
            className="text-xs text-slate-300 file:mr-2 file:min-h-11 file:rounded file:border file:border-slate-600 file:bg-slate-800 file:px-2 file:text-slate-200 file:hover:bg-slate-700 md:file:min-h-0 md:file:py-1"
          />
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            placeholder={"氏名,ふりがな\n山田太郎,ヤマダタロウ\n鈴木花子,スズキハナコ"}
            rows={8}
            aria-label="名簿マスタの貼り付け欄"
            className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none focus:border-indigo-500"
          />
        </div>

        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

        <p className="mt-3 text-[11px] text-slate-500">
          現在 {furiganaCount}名分のふりがなを保持しています。
          {furiganaCount > 0 && (
            <button
              type="button"
              onClick={clearFurigana}
              className="ml-2 text-rose-400 underline hover:text-rose-300"
            >
              すべて削除
            </button>
          )}
        </p>

        <div className="mt-4 flex shrink-0 flex-col-reverse justify-end gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded border border-slate-600 px-4 text-sm font-medium text-slate-300 hover:bg-slate-800 sm:min-h-0 sm:py-1.5 sm:text-xs"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!text.trim()}
            className="min-h-11 rounded bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0 sm:py-1.5 sm:text-xs"
          >
            取り込む
          </button>
        </div>
      </div>
    </div>
  );
}
