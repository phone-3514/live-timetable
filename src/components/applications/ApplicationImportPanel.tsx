import { useApplicationStore } from "../../store/useApplicationStore";

export function ApplicationImportPanel() {
  const rawText = useApplicationStore((s) => s.rawText);
  const setRawText = useApplicationStore((s) => s.setRawText);
  const parseAndAddFromRawText = useApplicationStore((s) => s.parseAndAddFromRawText);

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
      <button
        onClick={parseAndAddFromRawText}
        disabled={!rawText.trim()}
        className="self-start rounded bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        解析して追加
      </button>
    </div>
  );
}
