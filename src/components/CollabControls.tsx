import { useState } from "react";
import { useCollabStore, type CollabStatus } from "../store/useCollabStore";
import { useToastStore } from "../store/useToastStore";

const STATUS_LABEL: Record<string, string> = {
  connecting: "🟡 接続中…",
  synced: "🟢 同期中",
  error: "🔴 エラー",
};

interface Props {
  roomId: string | null;
  status: CollabStatus;
  startRoom: () => void;
  leaveRoom: () => void;
}

// Lives in the header next to BackupControls — collaboration is opt-in
// per browser session via ?room=<id> in the URL (see useCollabRoom), so
// this is the one control surface for starting a room, sharing its URL,
// seeing who else is online, and leaving. Takes room state as props
// (rather than calling useCollabRoom itself) because CollabRoot already
// owns that one instance — a second call here would open a second,
// redundant Firestore subscription for the same room.
export function CollabControls({ roomId, status, startRoom, leaveRoom }: Props) {
  const others = useCollabStore((s) => s.others);
  const myNickname = useCollabStore((s) => s.myNickname);
  const showToast = useToastStore((s) => s.show);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

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
    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
      <span className="text-xs text-slate-400" title={`ルームID: ${roomId}`}>
        {STATUS_LABEL[status] ?? status}
      </span>

      {/* Connected-collaborators list — always includes yourself first
          so the row never looks empty right after joining. */}
      <div className="flex items-center gap-1" title="現在参加中のメンバー">
        {myNickname && (
          <span className="rounded-full bg-indigo-950/60 px-2 py-0.5 text-[11px] font-medium text-indigo-300">
            {myNickname}（自分）
          </span>
        )}
        {others.map((o) => (
          <span
            key={o.clientId}
            className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-300"
          >
            {o.nickname}
          </span>
        ))}
      </div>

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
