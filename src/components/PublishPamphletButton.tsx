import { useState } from "react";
import { db } from "../firebase";
import { useAppStore } from "../store/useAppStore";
import { useToastStore } from "../store/useToastStore";
import { buildPublicPamphletDoc } from "../pamphlet/buildPublicPamphletDoc";
import { ensureViewerCode } from "../utils/viewerCodes";
import { PublishPamphletDialog } from "./PublishPamphletDialog";
import { SIMPLE_DESIGN, readStoredPamphletDesign, storePamphletDesign } from "../pamphlet/pamphletDesign";
import type { PublicPamphletDesign } from "../pamphlet/types";
import {
  cancelScheduledPublicPamphletPublish,
  publishPublicPamphletNow,
} from "../pamphlet/publicPamphletPublisher";

interface Props {
  roomId: string;
}

function pamphletUrlKey(roomId: string): string {
  return `live-timetable-pamphlet-published-${roomId}`;
}

// circleId IS the roomId (see main.tsx) — the public URL is therefore
// fully deterministic from roomId alone, so "has this room ever been
// published" is the only state that actually needs remembering.
// Persisted in localStorage (not just component state) specifically
// because the previous version only showed the URL in a toast that
// auto-dismissed in a few seconds — an admin who published, got
// distracted, and came back to copy the link a minute later (or after a
// reload) had already lost it. A readonly field the admin can return to
// at any time is the whole fix.
function readPublishedUrl(roomId: string): string | null {
  try {
    return localStorage.getItem(pamphletUrlKey(roomId));
  } catch {
    return null;
  }
}

function storePublishedUrl(roomId: string, url: string) {
  try {
    localStorage.setItem(pamphletUrlKey(roomId), url);
  } catch {
    // Storage unavailable (private browsing) — the URL still displays
    // for the rest of this session via component state, it just won't
    // survive a reload.
  }
}

// "Finalized" per spec — publishing is a deliberate, explicit action
// (not an automatic mirror of every edit) so a circle can keep drafting
// their timetable privately and only push a snapshot to the public
// pamphlet (publicPamphlets/{roomId}) when it's actually ready for an
// audience to see. Anyone in the room can publish (same shared-trust
// model as every other edit here — there's no per-user permission
// system, see adminAuth.ts's caveat), not gated on admin mode, since
// publishing isn't a destructive/moderation action like force-kick.
export function PublishPamphletButton({ roomId }: Props) {
  const [publishing, setPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(() => readPublishedUrl(roomId));
  const [copied, setCopied] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const showToast = useToastStore((s) => s.show);

  async function handlePublish(design: PublicPamphletDesign) {
    if (!db) {
      showToast("Firestoreが利用できません", "error");
      return;
    }
    setPublishing(true);
    cancelScheduledPublicPamphletPublish(roomId);
    try {
      const viewerCode = await ensureViewerCode(roomId);
      // design はFirestoreルールの許可項目。ルール未更新の環境では permission-denied に
      // なるので、その場合はデザイン抜きで公開し直して、反映されない旨を伝える。
      let designApplied = true;
      try {
        await publishPublicPamphletNow(roomId, () => {
          const { eventInfo, bands, days } = useAppStore.getState();
          return buildPublicPamphletDoc(eventInfo, bands, days, design);
        });
      } catch (err) {
        if ((err as { code?: string })?.code !== "permission-denied") throw err;
        designApplied = false;
        await publishPublicPamphletNow(roomId, () => {
          const { eventInfo, bands, days } = useAppStore.getState();
          return buildPublicPamphletDoc(eventInfo, bands, days);
        });
      }
      storePamphletDesign(roomId, design);
      const url = `${window.location.origin}${import.meta.env.BASE_URL}${viewerCode}/public`;
      storePublishedUrl(roomId, url);
      setPublishedUrl(url);
      setDialogOpen(false);
      if (designApplied) {
        showToast("パンフレットを公開しました", "success");
      } else {
        showToast(
          "公開しましたが、デザインは反映されていません。Firestoreのルール(firestore.rules)を更新してから、もう一度公開してください",
          "error",
        );
      }
    } catch (err) {
      console.error("[PublishPamphletButton] publish failed:", err);
      showToast("パンフレットの公開に失敗しました", "error");
    } finally {
      setPublishing(false);
    }
  }

  async function handleCopy() {
    if (!publishedUrl) return;
    try {
      await navigator.clipboard.writeText(publishedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("コピーできませんでした。URLを手動で選択してコピーしてください", "error");
    }
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        disabled={publishing}
        title="表示デザインを選んで、現在のタイムテーブルを、編集権限のない誰でも閲覧できる公開パンフレットとして公開します"
        className="min-h-11 shrink-0 rounded border border-emerald-600 px-2.5 text-xs font-medium text-emerald-300 hover:bg-emerald-950/40 disabled:cursor-not-allowed disabled:opacity-50 md:min-h-0 md:py-1"
      >
        {publishing ? "公開中…" : publishedUrl ? "🌐 再公開" : "🌐 パンフレットを公開"}
      </button>

      {publishedUrl && (
        <div className="flex min-h-11 shrink-0 items-center rounded border border-slate-700 bg-slate-800 md:min-h-0 md:min-w-0 md:flex-1 md:gap-1.5 md:pl-2">
          <input
            type="text"
            readOnly
            value={publishedUrl}
            title="公開パンフレットのURL"
            onFocus={(e) => e.currentTarget.select()}
            className="hidden min-w-0 flex-1 bg-transparent text-xs text-slate-300 outline-none md:block"
          />
          <button
            type="button"
            onClick={handleCopy}
            title="URLをコピー"
            className="min-h-11 shrink-0 rounded px-2.5 text-xs font-medium text-slate-300 hover:bg-slate-700 md:min-h-0 md:rounded-r md:border-l md:border-slate-700 md:py-1"
          >
            {copied ? "✓ コピー済み" : "📋 コピー"}
          </button>
        </div>
      )}

      {dialogOpen && (
        <PublishPamphletDialog
          initial={readStoredPamphletDesign(roomId) ?? SIMPLE_DESIGN}
          publishing={publishing}
          isRepublish={publishedUrl !== null}
          onClose={() => setDialogOpen(false)}
          onConfirm={(design) => void handlePublish(design)}
        />
      )}
    </div>
  );
}
