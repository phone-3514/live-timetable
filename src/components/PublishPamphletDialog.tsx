import { useMemo, useState } from "react";
import { LAYOUTS, THEMES } from "../utils/shareThemes";
import type { LayoutId, ThemeId } from "../utils/shareThemes";
import { useAppStore } from "../store/useAppStore";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { buildPublicPamphletDoc } from "../pamphlet/buildPublicPamphletDoc";
import { PamphletDesignPreview } from "../pamphlet/ThemedPamphlet";
import { SIMPLE_THEME_ID, resolvePamphletDesign } from "../pamphlet/pamphletDesign";
import type { PublicPamphletDesign } from "../pamphlet/types";
import { ModalPortal } from "./ModalPortal";

type Props = {
  initial: PublicPamphletDesign;
  publishing: boolean;
  isRepublish: boolean;
  onClose: () => void;
  onConfirm: (design: PublicPamphletDesign) => void;
};

// 公開ボタンを押したときに開く、公開パンフレットの表示デザインの選択。
// 選択肢は共有用画像と同じ(色テーマ + レイアウト構造)に、従来のシンプル表示を
// 加えたもの。プレビューは実際の公開ページと同じ描画部品を使う。
export function PublishPamphletDialog({ initial, publishing, isRepublish, onClose, onConfirm }: Props) {
  useEscapeKey(onClose);
  const eventInfo = useAppStore((s) => s.eventInfo);
  const bands = useAppStore((s) => s.bands);
  const days = useAppStore((s) => s.days);
  const [themeId, setThemeId] = useState<string>(initial.themeId);
  const [layoutId, setLayoutId] = useState<string>(initial.layoutId);

  const previewDoc = useMemo(() => buildPublicPamphletDoc(eventInfo, bands, days), [eventInfo, bands, days]);
  const resolved = resolvePamphletDesign({ themeId, layoutId });
  const isSimple = themeId === SIMPLE_THEME_ID;

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          className="flex h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-slate-700 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                公開パンフレットのデザインを選ぶ
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                選んだデザインで、公開ページ（閲覧用のタイムテーブル）が表示されます。あとから再公開で変更できます
              </p>
            </div>
            <button
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-700 hover:text-slate-200 md:h-7 md:w-7"
              title="閉じる"
            >
              ×
            </button>
          </div>

          <div className="max-h-44 shrink-0 overflow-y-auto border-b border-slate-700 px-4 py-3">
            <div className="grid grid-cols-3 gap-2 min-[420px]:grid-cols-4 sm:grid-cols-5 md:grid-cols-6">
              <button
                onClick={() => setThemeId(SIMPLE_THEME_ID)}
                title="従来のシンプルな表示（ダーク/ライト切り替え可）"
                className={`min-h-11 rounded-lg border px-2 py-1.5 text-left transition-colors md:min-h-0 ${
                  isSimple
                    ? "border-emerald-400 bg-emerald-950/40"
                    : "border-slate-700 bg-slate-800 hover:border-slate-500"
                }`}
              >
                <span className="mb-1 block h-3 w-full rounded-full bg-gradient-to-r from-slate-950 to-indigo-950" />
                <span
                  className={`block text-[11px] font-semibold leading-tight ${
                    isSimple ? "text-emerald-200" : "text-slate-300"
                  }`}
                >
                  シンプル（従来）
                </span>
              </button>
              {Object.values(THEMES).map((theme) => (
                <button
                  key={theme.id}
                  onClick={() => setThemeId(theme.id as ThemeId)}
                  title={theme.subtitle}
                  className={`min-h-11 rounded-lg border px-2 py-1.5 text-left transition-colors md:min-h-0 ${
                    themeId === theme.id
                      ? "border-emerald-400 bg-emerald-950/40"
                      : "border-slate-700 bg-slate-800 hover:border-slate-500"
                  }`}
                >
                  <span
                    className="mb-1 block h-3 w-full rounded-full"
                    style={{ background: theme.pageBackground }}
                  />
                  <span
                    className={`block text-[11px] font-semibold leading-tight ${
                      themeId === theme.id ? "text-emerald-200" : "text-slate-300"
                    }`}
                  >
                    {theme.name}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className={`shrink-0 border-b border-slate-700 px-4 py-2.5 ${isSimple ? "opacity-40" : ""}`}>
            <p className="mb-1.5 text-[11px] font-semibold text-slate-500">
              レイアウト構造{isSimple && "（シンプル表示では使いません）"}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {Object.values(LAYOUTS).map((layout) => (
                <button
                  key={layout.id}
                  disabled={isSimple}
                  onClick={() => setLayoutId(layout.id as LayoutId)}
                  title={layout.description}
                  className={`min-h-11 rounded-lg border px-3 text-xs font-semibold transition-colors md:min-h-0 md:py-1.5 ${
                    layoutId === layout.id && !isSimple
                      ? "border-emerald-400 bg-emerald-950/40 text-emerald-200"
                      : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  {layout.name}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-950 p-4">
            {resolved ? (
              <div className="mx-auto w-full max-w-md overflow-hidden rounded-xl border border-slate-700 shadow-lg">
                <PamphletDesignPreview data={previewDoc} theme={resolved.theme} layout={resolved.layout} />
              </div>
            ) : (
              <p className="mx-auto mt-10 max-w-sm text-center text-xs text-slate-500">
                従来のシンプルな表示です（暗い背景のカード型。閲覧する人が、ライト/ダークを切り替えられます）。
                デザインを選ぶと、ここにプレビューが表示されます。
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-700 px-4 py-3">
            <button
              onClick={onClose}
              className="min-h-11 rounded border border-slate-600 px-3 text-sm text-slate-300 hover:bg-slate-700 md:min-h-0 md:py-1.5"
            >
              キャンセル
            </button>
            <button
              onClick={() => onConfirm({ themeId, layoutId })}
              disabled={publishing}
              className="min-h-11 rounded bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 md:min-h-0 md:py-1.5"
            >
              {publishing ? "公開中…" : isRepublish ? "この内容で再公開する" : "この内容で公開する"}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
