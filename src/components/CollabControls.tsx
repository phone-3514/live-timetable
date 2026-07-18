import { useState } from "react";
import { useCollabRoom } from "../hooks/useCollabRoom";
import { useToastStore } from "../store/useToastStore";
import { isFirebaseConfigured } from "../firebase";

const STATUS_LABEL: Record<string, string> = {
  connecting: "🟡 接続中…",
  synced: "🟢 同期中",
  error: "🔴 エラー",
};

// Lives in the header next to BackupControls — collaboration is opt-in
// per browser session via ?room=<id> in the URL (see useCollabRoom), so
// this is the one control surface for starting a room, sharing its URL,
// and leaving it. Renders nothing at all when no Firebase project is
// configured (see isFirebaseConfigured) — every visitor to the deployed
// app without a Firebase setup should see the exact same UI as before
// this feature existed.
export function CollabControls() {
  const { roomId, status, startRoom, leaveRoom } = useCollabRoom();
  const showToast = useToastStore((s) => s.show);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  if (!isFirebaseConfigured) return null;

  async function handleCopyUrl() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("共有URLをコピーしました。参加してほしい人に送ってください", "success");
    } catch {
      showToast("コピーできませんでした。アドレスバーのURLを手動で共有してください", "error");
    }
  }

  if (!roomId) {
    return (
      <button
        type="button"
        onClick={startRoom}
        title="現在の内容を元に共同編集ルームを作成し、URLに反映します"
        className="min-h-11 rounded border border-emerald-600 px-2.5 text-xs font-medium text-emerald-300 hover:bg-emerald-950/40 md:min-h-0 md:py-1"
      >
        🔗 共同編集を開始
      </button>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span className="text-xs text-slate-400" title={`ルームID: ${roomId}`}>
        {STATUS_LABEL[status] ?? status}
      </span>
      <button
        type="button"
        onClick={handleCopyUrl}
        title="このルームの共有URLをコピー"
        className="min-h-11 rounded border border-slate-600 px-2.5 text-xs font-medium text-slate-300 hover:bg-slate-800 md:min-h-0 md:py-1"
      >
        🔗 URLをコピー
      </button>
      {confirmingLeave ? (
        <span className="flex items-center gap-1 text-xs text-slate-400">
          このブラウザだけ抜けますか？
          <button
            type="button"
            onClick={() => setConfirmingLeave(false)}
            className="min-h-11 rounded border border-slate-600 px-2 text-slate-300 hover:bg-slate-800 md:min-h-0 md:py-1"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => {
              leaveRoom();
              setConfirmingLeave(false);
            }}
            className="min-h-11 rounded border border-rose-700 px-2 text-rose-300 hover:bg-rose-950/40 md:min-h-0 md:py-1"
          >
            退出する
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmingLeave(true)}
          title="このブラウザだけ共同編集ルームから抜けて、ローカル編集に戻ります（ルーム自体は残ります）"
          className="min-h-11 rounded border border-slate-600 px-2.5 text-xs font-medium text-slate-400 hover:bg-slate-800 md:min-h-0 md:py-1"
        >
          退出
        </button>
      )}
    </div>
  );
}
