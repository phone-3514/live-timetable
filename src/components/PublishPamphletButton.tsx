import { useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useAppStore } from "../store/useAppStore";
import { useToastStore } from "../store/useToastStore";
import { buildPublicPamphletDoc } from "../pamphlet/buildPublicPamphletDoc";

interface Props {
  roomId: string;
}

// "Finalized" per spec — publishing is a deliberate, explicit action
// (not an automatic mirror of every edit) so a circle can keep drafting
// their timetable privately and only push a snapshot to the public
// pamphlet (publicPamphlets/{roomId} — circleId IS the roomId, see
// main.tsx) when it's actually ready for an audience to see. Anyone in
// the room can publish (same shared-trust model as every other edit here
// — there's no per-user permission system, see adminAuth.ts's caveat),
// not gated on admin mode, since publishing isn't a destructive/
// moderation action like force-kick.
export function PublishPamphletButton({ roomId }: Props) {
  const [publishing, setPublishing] = useState(false);
  const showToast = useToastStore((s) => s.show);

  async function handlePublish() {
    if (!db) {
      showToast("Firestoreが利用できません", "error");
      return;
    }
    setPublishing(true);
    try {
      const { eventInfo, bands, days } = useAppStore.getState();
      const publicDoc = buildPublicPamphletDoc(eventInfo, bands, days);
      await setDoc(doc(db, "publicPamphlets", roomId), publicDoc);
      const url = `${window.location.origin}${import.meta.env.BASE_URL}${roomId}/public`;
      showToast(`パンフレットを公開しました: ${url}`, "success");
    } catch (err) {
      console.error("[PublishPamphletButton] publish failed:", err);
      showToast("パンフレットの公開に失敗しました", "error");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handlePublish}
      disabled={publishing}
      title="現在のタイムテーブルを、編集権限のない誰でも閲覧できる公開パンフレットとして公開します"
      className="min-h-11 rounded border border-emerald-600 px-2.5 text-xs font-medium text-emerald-300 hover:bg-emerald-950/40 disabled:cursor-not-allowed disabled:opacity-50 md:min-h-0 md:py-1"
    >
      {publishing ? "公開中…" : "🌐 パンフレットを公開"}
    </button>
  );
}
