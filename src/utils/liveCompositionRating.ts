import type { Band } from "../types";

// 管理者専用「ライブ構成評価」の唯一の正規化ロジック — UIの初期表示
// (LiveCompositionRatingStars)と自動振り分けStep2のスコアリング
// (autoScheduleSolver.ts)の両方がここを経由することで、「未設定・既存データ
// は3として扱う」「保存時に1〜5へ整数で制限する」を一箇所でしか定義しない。

export const DEFAULT_LIVE_COMPOSITION_RATING = 3;
export const MIN_LIVE_COMPOSITION_RATING = 1;
export const MAX_LIVE_COMPOSITION_RATING = 5;

export function clampLiveCompositionRating(value: number): number {
  const rounded = Math.round(value);
  return Math.min(MAX_LIVE_COMPOSITION_RATING, Math.max(MIN_LIVE_COMPOSITION_RATING, rounded));
}

export function getLiveCompositionRating(band: Pick<Band, "liveCompositionRating">): number {
  const value = band.liveCompositionRating;
  if (value === undefined || value === null || Number.isNaN(value)) {
    return DEFAULT_LIVE_COMPOSITION_RATING;
  }
  return clampLiveCompositionRating(value);
}
