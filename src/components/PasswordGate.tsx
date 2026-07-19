import { useState } from "react";
import { storeNickname } from "../utils/nickname";
import { storeRoomAuthFlag } from "../utils/roomAuth";
import { storeAdminAuthFlag } from "../utils/adminAuth";
import { ModalPortal } from "./ModalPortal";

interface Props {
  onSuccess: (nickname: string, isAdmin: boolean) => void;
  /** "Never mind" — clears the pending room (see CollabRoot, which wires
   * this to leaveRoom()) and returns to the plain "共同編集を開始" button
   * instead of leaving the user stuck on a gate they can't/won't pass. */
  onCancel: () => void;
}

// Shown instead of any collaboration UI whenever a room is being joined
// or started (?room=<id> in the URL, or the "共同編集を開始" button was
// just clicked) and this browser tab hasn't already passed the gate this
// session. Combines password + nickname into one form per spec, and is
// the ONLY thing CollabRoot renders in this state — useCollabRoom's
// Firestore path and useLivePresence's RTDB connection are both gated on
// the same isAuthenticated flag this component sets, so no network
// request to either Firebase product happens before a correct password
// is entered. See CollabRoot.tsx for that wiring.
export function PasswordGate({ onSuccess, onCancel }: Props) {
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const correctPassword = import.meta.env.VITE_ROOM_PASSWORD;
    if (password !== correctPassword) {
      setError("パスワードが正しくありません");
      return;
    }
    // Admin password is entirely optional — an empty VITE_ADMIN_PASSWORD
    // (the default, unset) means admin mode is simply never reachable,
    // same "missing env var doesn't break/change existing behavior"
    // pattern as VITE_ROOM_PASSWORD itself. A non-empty field that
    // doesn't match is NOT treated as an error here (unlike the room
    // password) — someone who mistypes it should just join as a normal
    // participant, not get stuck unable to enter the room at all.
    const configuredAdminPassword = import.meta.env.VITE_ADMIN_PASSWORD;
    const isAdmin = Boolean(configuredAdminPassword) && adminPassword === configuredAdminPassword;
    const trimmedNickname = nickname.trim() || "ゲスト";
    storeRoomAuthFlag();
    storeNickname(trimmedNickname);
    if (isAdmin) storeAdminAuthFlag();
    onSuccess(trimmedNickname, isAdmin);
  }

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[70] overflow-y-auto bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex min-h-full items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
      >
        <h2 className="text-sm font-semibold text-slate-100">🔒 共同編集ルームへの入室</h2>
        <p className="mt-1 text-xs text-slate-400">
          合言葉と表示名を入力してください。
        </p>

        {/* Deliberately visible, not just documented in code — a shared
            password baked into a public static site's JS bundle is not
            real access control (anyone can read it via devtools/view
            source), and everyone using this gate should know that,
            not just whoever set it up. */}
        <p className="mt-2 rounded border border-amber-700 bg-amber-950/30 px-2.5 py-1.5 text-[11px] text-amber-300">
          ⚠️
          この合言葉は簡易的な入室制限です。技術的に閲覧しようとする第三者への防御にはなりません（誤操作や偶然のアクセスを防ぐ目的です）。
        </p>

        <label className="mt-3 block text-xs font-medium text-slate-400" htmlFor="password-gate-nickname">
          表示名
        </label>
        <input
          id="password-gate-nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="例：幹部A"
          aria-label="表示名"
          autoFocus
          maxLength={20}
          className="mt-1 min-h-11 w-full rounded border border-indigo-500 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 md:min-h-0"
        />

        <label className="mt-3 block text-xs font-medium text-slate-400" htmlFor="password-gate-password">
          合言葉
        </label>
        <input
          id="password-gate-password"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
          aria-label="合言葉"
          className="mt-1 min-h-11 w-full rounded border border-indigo-500 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 outline-none md:min-h-0"
        />
        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

        <label className="mt-3 block text-xs font-medium text-slate-400" htmlFor="password-gate-admin-password">
          管理者パスワード（任意）
        </label>
        <input
          id="password-gate-admin-password"
          type="password"
          value={adminPassword}
          onChange={(e) => setAdminPassword(e.target.value)}
          placeholder="管理者のみ入力してください"
          aria-label="管理者パスワード"
          className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 md:min-h-0"
        />
        <p className="mt-1.5 rounded border border-amber-700 bg-amber-950/30 px-2.5 py-1.5 text-[11px] text-amber-300">
          ⚠️ 合言葉と同様、これも技術的なアクセス制御ではありません。管理者モードは他の参加者を退出させる操作ができるようになりますが、devtoolsを使えば誰でもこの制限を回避できます。
        </p>

        <div className="mt-4 flex flex-col-reverse justify-end gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded border border-slate-600 px-4 text-sm font-medium text-slate-300 hover:bg-slate-800 sm:min-h-0 sm:py-1.5 sm:text-xs"
          >
            キャンセル
          </button>
          <button
            type="submit"
            className="min-h-11 rounded bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 sm:min-h-0 sm:py-1.5 sm:text-xs"
          >
            入室する
          </button>
        </div>
      </form>
      </div>
    </div>
    </ModalPortal>
  );
}
