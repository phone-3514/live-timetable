import { useState } from "react";
import { buildBackupFilename, downloadBackupFile } from "../utils/backup";
import { useEscapeKey } from "../hooks/useEscapeKey";

interface Props {
  liveName: string;
  onClose: () => void;
}

export function BackupExportDialog({ liveName, onClose }: Props) {
  const [filename, setFilename] = useState(() => buildBackupFilename(liveName));
  useEscapeKey(onClose);

  function handleSave() {
    const finalName = filename.trim() || buildBackupFilename(liveName);
    downloadBackupFile(finalName.endsWith(".json") ? finalName : `${finalName}.json`);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl">
        <h2 className="text-sm font-semibold text-slate-100">💾 データを保存</h2>
        <p className="mt-1 text-xs text-slate-400">
          タイムテーブル・出演申し込みデータをすべて含むバックアップファイルをダウンロードします。
        </p>

        <label className="mt-4 block text-xs font-medium text-slate-400" htmlFor="backup-filename">
          ファイル名
        </label>
        <input
          id="backup-filename"
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          className="mt-1 min-h-11 w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100 outline-none focus:border-indigo-500 md:min-h-0"
        />

        <div className="mt-5 flex flex-col-reverse justify-end gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded border border-slate-600 px-4 text-sm font-medium text-slate-300 hover:bg-slate-800 sm:min-h-0 sm:py-1.5 sm:text-xs"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="min-h-11 rounded bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 sm:min-h-0 sm:py-1.5 sm:text-xs"
          >
            ダウンロード
          </button>
        </div>
      </div>
    </div>
  );
}
