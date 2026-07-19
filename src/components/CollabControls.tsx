import { useState } from "react";
import { useCollabStore, type CollabStatus } from "../store/useCollabStore";
import { useToastStore } from "../store/useToastStore";
import { PublishPamphletButton } from "./PublishPamphletButton";
import { ModalPortal } from "./ModalPortal";
import { useDismissibleDetails } from "../hooks/useDismissibleDetails";
import { useEscapeKey } from "../hooks/useEscapeKey";

const STATUS_LABEL: Record<string, string> = {
  connecting: "🟡 接続中…",
  synced: "🟢 同期中",
  error: "🔴 エラー",
};

interface Props {
  roomId: string | null;
  status: CollabStatus;
  startRoom: () => void;
  joinRoom: (code: string) => boolean;
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
export function CollabControls({ roomId, status, startRoom, joinRoom, leaveRoom, kickUser }: Props) {
  const others = useCollabStore((s) => s.others);
  const myNickname = useCollabStore((s) => s.myNickname);
  const isAdmin = useCollabStore((s) => s.isAdmin);
  const showToast = useToastStore((s) => s.show);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [confirmingKick, setConfirmingKick] = useState<string | null>(null);
  const [showEntry, setShowEntry] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [roomCodeError, setRoomCodeError] = useState<string | null>(null);
  const collabDetailsRef = useDismissibleDetails();
  useEscapeKey(() => setShowEntry(false));

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

  async function handleCopyCode() {
    try {
      await navigator.clipboard.writeText(roomId?.toUpperCase() ?? "");
      showToast("共有コードをコピーしました", "success");
    } catch {
      showToast("コードをコピーできませんでした", "error");
    }
  }

  if (!roomId) {
    return (
      <>
      <button
        type="button"
        onClick={() => setShowEntry(true)}
        title="新しい共同編集を開始、または共有コードで参加"
        className="min-h-11 shrink-0 rounded border border-emerald-600 bg-emerald-950/30 px-2.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-950/60 md:min-h-0 md:py-1"
      >
        👥 共同編集
      </button>
      {showEntry && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-[70] overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="collab-entry-title"
            onClick={() => setShowEntry(false)}
          >
            <div className="flex min-h-full items-center justify-center">
              <div
                className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 id="collab-entry-title" className="text-base font-semibold text-slate-100">共同編集</h2>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">
                      アプリの追加は一度だけ。次回から共有コードでイベントを切り替えられます。
                    </p>
                  </div>
                  <button type="button" onClick={() => setShowEntry(false)} aria-label="閉じる" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg text-slate-400 hover:bg-slate-700">×</button>
                </div>

                <section className="mt-5 rounded-lg border border-blue-800/70 bg-blue-950/25 p-3">
                  <h3 className="text-sm font-semibold text-slate-100">新しいイベントを共有</h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">現在開いているタイムテーブルから共有コードを発行します。</p>
                  <button
                    type="button"
                    onClick={() => {
                      setShowEntry(false);
                      startRoom();
                    }}
                    className="mt-3 min-h-11 w-full rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-600"
                  >
                    共有を開始してコードを作成
                  </button>
                </section>

                <div className="my-4 flex items-center gap-3 text-[11px] text-slate-500"><span className="h-px flex-1 bg-slate-700" /><span>または</span><span className="h-px flex-1 bg-slate-700" /></div>

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!joinRoom(roomCode)) {
                      setRoomCodeError("8文字の共有コードを確認してください");
                      return;
                    }
                    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
                    setRoomCodeError(null);
                    setShowEntry(false);
                  }}
                >
                  <label htmlFor="collab-room-code" className="text-sm font-semibold text-slate-100">共有コードで参加</label>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input
                      id="collab-room-code"
                      value={roomCode}
                      onChange={(event) => {
                        setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9\s-]/g, ""));
                        setRoomCodeError(null);
                      }}
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint="go"
                      maxLength={11}
                      placeholder="例：ABCD2345"
                      aria-describedby={roomCodeError ? "collab-room-code-error" : undefined}
                      className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-800 px-3 font-mono text-base font-semibold uppercase tracking-[0.16em] text-slate-100 outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-slate-500 focus:border-blue-500"
                    />
                    <button type="submit" className="min-h-11 rounded-lg border border-blue-500 bg-blue-950/40 px-4 text-sm font-semibold text-blue-200 hover:bg-blue-900/60">参加する</button>
                  </div>
                  {roomCodeError && <p id="collab-room-code-error" className="mt-2 text-xs text-rose-400">{roomCodeError}</p>}
                </form>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
      </>
    );
  }

  return (
    <details ref={collabDetailsRef} className="group relative shrink-0">
      <summary
        className="flex min-h-11 cursor-pointer list-none items-center rounded border border-emerald-600 bg-emerald-950/30 px-2.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-950/60 md:min-h-0 md:py-1"
        title={`共同編集メニュー（ルームID: ${roomId}）`}
      >
        {STATUS_LABEL[status] ?? status}
        <span className="ml-1 hidden lg:inline">共同編集</span>
        <span className="ml-1 text-[9px] transition-transform group-open:rotate-180">▼</span>
      </summary>

      <div className="mt-2 flex max-h-[calc(100vh-4rem)] w-[calc(100vw-1.5rem)] max-w-md flex-col gap-2 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl md:absolute md:left-1/2 md:top-full md:mt-1 md:-translate-x-1/2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-200">共同編集ルーム</span>
          <span className="rounded bg-slate-800 px-2 py-1 font-mono text-xs font-bold tracking-[0.12em] text-blue-300">{roomId.toUpperCase()}</span>
        </div>

      {/* Connected-collaborators list — always includes yourself first
          so the row never looks empty right after joining. */}
      <div className="flex flex-wrap items-center gap-1" title="現在参加中のメンバー">
        {myNickname && (
          <span className="flex items-center gap-1 rounded-full bg-indigo-950/60 px-2 py-0.5 text-[11px] font-medium text-indigo-300">
            {myNickname}（自分）
            {isAdmin && (
              <span
                className="rounded-full bg-amber-950/70 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300"
                title="このタブは管理者モードで入室しています（他の参加者を退出させられます）"
              >
                👑 管理者
              </span>
            )}
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

      <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-700 pt-2">
        <button
          type="button"
          onClick={handleCopyCode}
          title="アプリ内で入力する共有コードをコピー"
          className="min-h-11 rounded border border-blue-700 px-2.5 text-xs font-semibold text-blue-300 hover:bg-blue-950/50 md:min-h-0 md:py-1.5"
        >
          ⧉ コードをコピー
        </button>
        <button
          type="button"
          onClick={handleCopyUrl}
          title="このルームの共有URLをコピー"
          className="min-h-11 rounded border border-slate-600 px-2.5 text-xs font-medium text-slate-300 hover:bg-slate-700 md:min-h-0 md:py-1.5"
        >
          🔗 URLをコピー
        </button>
        <PublishPamphletButton roomId={roomId} />
      {confirmingLeave ? (
        <span className="flex items-center gap-1 text-xs text-slate-400">
          このブラウザだけ抜けますか？
          <button
            type="button"
            onClick={() => setConfirmingLeave(false)}
            className="min-h-11 rounded border border-slate-600 px-2 text-slate-300 hover:bg-slate-700 md:min-h-0 md:py-1"
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
          className="min-h-11 rounded border border-slate-600 px-2.5 text-xs font-medium text-slate-400 hover:bg-slate-700 md:min-h-0 md:py-1"
        >
          退出
        </button>
      )}

      </div>
      </div>

      {confirmingKick && (
        <ModalPortal>
        <div
          className="fixed inset-0 z-[70] overflow-y-auto bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => setConfirmingKick(null)}
        >
          <div className="flex min-h-full items-center justify-center p-4">
          <div
            className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-slate-100">
              {others.find((o) => o.clientId === confirmingKick)?.nickname ?? "このユーザー"}
              を退出させますか？
            </h2>
            <p className="mt-2 text-xs text-slate-400">
              対象の編集画面はすぐに空の状態に戻り、ルームから切断されます。そのユーザーの端末に保存されていたデータ(ローカルバックアップを含む)はすべて完全に削除されます。
            </p>
            <div className="mt-4 flex flex-col-reverse justify-end gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => setConfirmingKick(null)}
                className="min-h-11 rounded border border-slate-600 px-4 text-sm font-medium text-slate-300 hover:bg-slate-700 sm:min-h-0 sm:py-1.5 sm:text-xs"
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
        </div>
        </ModalPortal>
      )}
    </details>
  );
}
