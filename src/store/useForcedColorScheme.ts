import { create } from "zustand";

// 公開パンフレットで運営が選んだデザイン(明るい/暗い背景のテーマ)に、ライト/ダークの
// 配色変数を合わせるための一時的な上書き。ユーザーの外観設定(useThemeStore)は
// 変えず、パンフレットを表示している間だけ data-theme を上書きする。
export const useForcedColorScheme = create<{
  forced: "light" | "dark" | null;
  setForced: (forced: "light" | "dark" | null) => void;
}>((set) => ({
  forced: null,
  setForced: (forced) => set({ forced }),
}));
