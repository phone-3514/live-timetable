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
  kickUser: (targetClientId: string) => void;
}

// Lives in the header next to BackupControls — collaboration is opt-in
// per browser session via ?room=<id> in the URL (see useCollabRoom), so
// this is the one control surface for starting a room, sharing its URL,
// seeing who else is online, and leaving. Takes room state as props
// (rather than calling useCollabRoom itself) because CollabRoot already
// owns that one instance — a second call here would open a second,
// redundant Firestore subscription for the same room.
export function CollabControls({ roomId, status, startRoom, leaveRoom, kickUser }: Props) {
  const others = useCollabStore((s) => s.others);
  const myNickname = useCollabStore((s) => s.myNickname);
  const isAdmin = useCollabStore((s) => s.isAdmin);
  const showToast = useToastStore((s) => s.show);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [confirmingKick, setConfirmingKick] = useState<string | null>(null);

  function handleKick(clientId: string, nickname: string) {
    kickUser(clientId);
    setConfirmingKick(null);
    showToast(`${nickname}をルームから退出させました`, "success");
  }

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
            className="flex items-center gap-1 rounded-full bg-slate-800 py-0.5 pl-2 pr-0.5 text-[11px] font-medium text-slate-300"
          >
            {o.nickname}
            {/* Admin-only, and purely a UI courtesy — see adminAuth.ts /
                useLivePresence.ts's kickUser for why this can't actually
                be enforced at the database level in a no-auth app. */}
            {isAdmin && (
              <button
                type="button"
                onClick={() => setConfirmingKick(o.clientId)}
                title={`${o.nickname}をルームから退出させる`}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-rose-400 hover:bg-rose-950/60 md:h-4 md:w-4 md:text-[10px]"
              >
                ✕
              </button>
            )}
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

      {confirmingKick && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setConfirmingKick(null)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-slate-100">
              {others.find((o) => o.clientId === confirmingKick)?.nickname ?? "このユーザー"}
              を退出させますか？
            </h2>
            <p className="mt-2 text-xs text-slate-400">
              対象の編集画面はすぐに空の状態に戻り、ルームから切断されます（作業内容はそのユーザーの端末にバックアップファイルとして保存されます）。
            </p>
            <div className="mt-4 flex flex-col-reverse justify-end gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => setConfirmingKick(null)}
                className="min-h-11 rounded border border-slate-600 px-4 text-sm font-medium text-slate-300 hover:bg-slate-800 sm:min-h-0 sm:py-1.5 sm:text-xs"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = others.find((o) => o.clientId === confirmingKick);
                  if (target) handleKick(target.clientId, target.nickname);
                }}
                className="min-h-11 rounded bg-rose-600 px-4 text-sm font-medium text-white hover:bg-rose-500 sm:min-h-0 sm:py-1.5 sm:text-xs"
              >
                退出させる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
