import { LAYOUTS, THEMES } from "../utils/shareThemes";
import type { LayoutId, LayoutStyle, ShareTheme, ThemeId } from "../utils/shareThemes";
import type { PublicPamphletDesign } from "./types";

export const SIMPLE_THEME_ID = "simple";

export const SIMPLE_DESIGN: PublicPamphletDesign = { themeId: SIMPLE_THEME_ID, layoutId: "classic" };

export type ResolvedDesign = { theme: ShareTheme; layout: LayoutStyle; themeId: ThemeId; layoutId: LayoutId };

// 公開データの design を、描画に使う theme/layout に解決する。無い・"simple"・
// 未知のID(新しい版で追加されたテーマを古い版が読んだ場合など)は null =
// 従来のシンプルな表示。
export function resolvePamphletDesign(design: PublicPamphletDesign | undefined | null): ResolvedDesign | null {
  if (!design || design.themeId === SIMPLE_THEME_ID) return null;
  const theme = (THEMES as Record<string, ShareTheme | undefined>)[design.themeId];
  if (!theme) return null;
  const layout = (LAYOUTS as Record<string, LayoutStyle | undefined>)[design.layoutId] ?? LAYOUTS.classic;
  return { theme, layout, themeId: theme.id, layoutId: layout.id };
}

// 運営側のブラウザに、最後に選んだデザインを覚えておく(自動の再公開でも
// 同じデザインを送り続け、再公開ダイアログの初期値にもする)。
function storageKey(roomId: string): string {
  return `live-timetable-pamphlet-design-${roomId}`;
}

export function readStoredPamphletDesign(roomId: string): PublicPamphletDesign | null {
  try {
    const raw = localStorage.getItem(storageKey(roomId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PublicPamphletDesign>;
    if (typeof parsed.themeId !== "string" || typeof parsed.layoutId !== "string") return null;
    return { themeId: parsed.themeId, layoutId: parsed.layoutId };
  } catch {
    return null;
  }
}

export function storePamphletDesign(roomId: string, design: PublicPamphletDesign) {
  try {
    localStorage.setItem(storageKey(roomId), JSON.stringify(design));
  } catch {
    // 保存できなくても、この回の公開には使われる。
  }
}
