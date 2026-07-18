import { useState } from "react";
import { storeNickname } from "../utils/nickname";

interface Props {
  onSubmit: (nickname: string) => void;
}

// Shown once per browser tab (sessionStorage, not localStorage — a
// nickname is meaningless once the tab closes, which is also exactly
// when RTDB's onDisconnect cleans up this client's presence record) the
// first time this session joins or starts a collaboration room. Not
// shown for ordinary local-only use — see CollabRoot, which only renders
// this when a roomId is active and no nickname is stored yet.
export function NicknameEntryModal({ onSubmit }: Props) {
  const [nickname, setNickname] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = nickname.trim() || "ゲスト";
    storeNickname(trimmed);
    onSubmit(trimmed);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
      >
        <h2 className="text-sm font-semibold text-slate-100">👋 共同編集に参加</h2>
        <p className="mt-1 text-xs text-slate-400">
          他の編集メンバーに表示される名前を入力してください（カーソルやドラッグ中のバンドに表示されます）。
        </p>
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="例：幹部A"
          aria-label="表示名"
          autoFocus
          maxLength={20}
          className="mt-3 min-h-11 w-full rounded border border-indigo-500 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 md:min-h-0"
        />
        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            className="min-h-11 rounded bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 sm:min-h-0 sm:py-1.5 sm:text-xs"
          >
            参加する
          </button>
        </div>
      </form>
    </div>
  );
}
