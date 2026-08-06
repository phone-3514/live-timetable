import { useAppStore } from "../../store/useAppStore";
import { getLiveCompositionRating } from "../../utils/liveCompositionRating";

// 管理者専用: 出演申し込み管理画面の承認済み(登録済み)バンド行にのみ表示する
// ライブ構成評価の★入力。既存のBand更新処理(updateBand)を通して保存する —
// 専用の保存処理やFirestoreの別経路は使わない。一般閲覧・出演者ページ・
// パンフレット・会場画面・PA画面はこのコンポーネントを一切importしない。
export function LiveCompositionRatingStars({ bandId }: { bandId: string }) {
  const band = useAppStore((s) => s.bands.find((b) => b.id === bandId));
  const updateBand = useAppStore((s) => s.updateBand);
  if (!band) return null;
  const rating = getLiveCompositionRating(band);

  return (
    <div className="flex flex-wrap items-center gap-0.5" role="radiogroup" aria-label="ライブ構成評価">
      {[1, 2, 3, 4, 5].map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={rating === value}
          aria-label={`評価 ${value}`}
          onClick={() => updateBand(bandId, { liveCompositionRating: value })}
          className={`flex min-h-11 min-w-11 items-center justify-center rounded text-lg leading-none hover:bg-slate-700 ${
            value <= rating ? "text-amber-400" : "text-slate-600"
          }`}
        >
          ★
        </button>
      ))}
    </div>
  );
}
