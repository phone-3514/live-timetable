import { useAppStore } from "../store/useAppStore";

export function TextImportPanel() {
  const rawText = useAppStore((s) => s.rawText);
  const setRawText = useAppStore((s) => s.setRawText);
  const parseFromRawText = useAppStore((s) => s.parseFromRawText);

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-slate-500">
        アンケート結果を貼り付け
      </h2>
      <textarea
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        placeholder={
          "例（タブ区切り／カンマ区切り／スペース区切りに対応）:\nバンド名\tメンバー\t希望時間帯\tNG時間帯\nThe Sample\t山田,鈴木,佐藤\t18:00-19:00\t13:00-14:00"
        }
        className="h-40 w-full rounded-lg border border-slate-300 p-3 font-mono text-sm"
      />
      <button
        onClick={parseFromRawText}
        className="self-start rounded bg-indigo-600 px-4 py-1.5 text-sm text-white hover:bg-indigo-700"
      >
        解析してリスト化
      </button>
    </div>
  );
}
