import { useLayoutEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { ShareAllDaysTemplate } from "./ShareAllDaysTemplate";
import { LAYOUTS, THEMES } from "../utils/shareThemes";
import type { LayoutId, ThemeId } from "../utils/shareThemes";
import { useAppStore } from "../store/useAppStore";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { dataUrlToFile, downloadFile } from "../utils/shareOrDownload";
import { ModalPortal } from "./ModalPortal";

type Props = { onClose: () => void };

// Same capture/scaling approach as SharePreviewModal (see its comments for
// why the measurement/off-screen-capture dance is shaped the way it is) —
// duplicated rather than shared because the two differ in what they render
// into that shape: SharePreviewModal captures one ShareTimetableTemplate,
// this captures one ShareAllDaysTemplate (see that file for the combined
// layout itself — one shared header/background across every day instead of
// each day carrying its own).
export function ShareAllDaysPreviewModal({ onClose }: Props) {
  const days = useAppStore((s) => s.days);
  const bands = useAppStore((s) => s.bands);
  const eventInfo = useAppStore((s) => s.eventInfo);
  useEscapeKey(onClose);
  const previewAreaRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<HTMLDivElement>(null);
  const [themeId, setThemeId] = useState<ThemeId>("standard");
  const [layoutId, setLayoutId] = useState<LayoutId>("classic");
  // See SharePreviewModal's own widescreen state for the full reasoning —
  // same toggle, applied to ShareAllDaysTemplate's joint per-day column
  // count (chooseWidescreenRowTarget) instead of the single-day one.
  const [widescreen, setWidescreen] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [areaSize, setAreaSize] = useState<{ width: number; height: number } | null>(null);
  const [downloading, setDownloading] = useState(false);

  useLayoutEffect(() => {
    if (previewRef.current) {
      setNaturalSize({
        width: previewRef.current.offsetWidth,
        height: previewRef.current.offsetHeight,
      });
    }
  }, [days, bands, themeId, layoutId, widescreen, eventInfo]);

  useLayoutEffect(() => {
    const el = previewAreaRef.current;
    if (!el) return;
    const update = () => setAreaSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const previewScale =
    naturalSize && areaSize
      ? Math.min(1, areaSize.width / naturalSize.width, areaSize.height / naturalSize.height)
      : 1;

  const handleDownload = async () => {
    const el = captureRef.current;
    if (!el) return;
    setDownloading(true);
    try {
      const dataUrl = await toPng(el, { pixelRatio: widescreen ? 3 : 2 });
      const filename = `share-timetable-all-days-${themeId}${widescreen ? "-16x9" : ""}.png`;
      const file = dataUrlToFile(dataUrl, filename, "image/png");
      await downloadFile(file);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-700 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-100">
            共有用タイムテーブル・プレビュー（全日程まとめて）
          </h2>
          <button
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full text-slate-400 hover:bg-slate-700 hover:text-slate-200 md:h-7 md:w-7"
            title="閉じる"
          >
            ×
          </button>
        </div>

        <div className="max-h-40 shrink-0 overflow-y-auto border-b border-slate-700 px-4 py-3">
          <div className="grid grid-cols-3 gap-2 min-[420px]:grid-cols-4 sm:grid-cols-5 md:grid-cols-7">
            {(Object.values(THEMES)).map((theme) => (
              <button
                key={theme.id}
                onClick={() => setThemeId(theme.id)}
                title={theme.subtitle}
                className={`min-h-11 rounded-lg border px-2 py-1.5 text-left transition-colors md:min-h-0 ${
                  themeId === theme.id
                    ? "border-indigo-400 bg-indigo-950/40"
                    : "border-slate-700 bg-slate-800 hover:border-slate-500"
                }`}
              >
                <span
                  className="mb-1 block h-3 w-full rounded-full"
                  style={{ background: theme.pageBackground }}
                />
                <span
                  className={`block text-[11px] font-semibold leading-tight ${
                    themeId === theme.id ? "text-indigo-200" : "text-slate-300"
                  }`}
                >
                  {theme.name}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="shrink-0 border-b border-slate-700 px-4 py-2.5">
          <p className="mb-1.5 text-[11px] font-semibold text-slate-500">レイアウト構造</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.values(LAYOUTS).map((layout) => (
              <button
                key={layout.id}
                onClick={() => setLayoutId(layout.id)}
                title={layout.description}
                className={`min-h-11 rounded-lg border px-3 text-xs font-semibold transition-colors md:min-h-0 md:py-1.5 ${
                  layoutId === layout.id
                    ? "border-indigo-400 bg-indigo-950/40 text-indigo-200"
                    : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500"
                }`}
              >
                {layout.name}
              </button>
            ))}
          </div>
        </div>

        {/* Output size — see SharePreviewModal's own equivalent block. */}
        <div className="shrink-0 border-b border-slate-700 px-4 py-2.5">
          <p className="mb-1.5 text-[11px] font-semibold text-slate-500">出力サイズ</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setWidescreen(false)}
              className={`min-h-11 rounded-lg border px-3 text-xs font-semibold transition-colors md:min-h-0 md:py-1.5 ${
                !widescreen
                  ? "border-indigo-400 bg-indigo-950/40 text-indigo-200"
                  : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500"
              }`}
            >
              通常
            </button>
            <button
              onClick={() => setWidescreen(true)}
              title="大画面・プロジェクターでの表示向けに、横長（16:9相当）・高解像度で出力します"
              className={`min-h-11 rounded-lg border px-3 text-xs font-semibold transition-colors md:min-h-0 md:py-1.5 ${
                widescreen
                  ? "border-indigo-400 bg-indigo-950/40 text-indigo-200"
                  : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500"
              }`}
            >
              🖥 16:9 高解像度
            </button>
          </div>
        </div>

        <div ref={previewAreaRef} className="flex min-h-0 flex-1 items-center justify-center bg-slate-950 p-4">
          <div
            style={{
              width: naturalSize ? naturalSize.width * previewScale : undefined,
              height: naturalSize ? naturalSize.height * previewScale : undefined,
            }}
            className="overflow-hidden rounded-xl shadow-lg"
          >
            <div
              ref={previewRef}
              style={{
                width: "fit-content",
                transform: `scale(${previewScale})`,
                transformOrigin: "top left",
              }}
            >
              <ShareAllDaysTemplate
                days={days}
                bands={bands}
                themeId={themeId}
                layoutId={layoutId}
                eventInfo={eventInfo}
                widescreen={widescreen}
              />
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-700 px-4 py-3">
          <button
            onClick={onClose}
            className="min-h-11 rounded border border-slate-600 px-3 text-sm text-slate-300 hover:bg-slate-700 md:min-h-0 md:py-1.5"
          >
            閉じる
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="min-h-11 rounded bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 md:min-h-0 md:py-1.5"
          >
            {downloading ? "画像を生成中…" : "画像をダウンロード"}
          </button>
        </div>
      </div>

      {/* Off-screen, always at natural full-resolution size and never
          transformed — the actual source for the downloaded PNG. Same
          reasoning as SharePreviewModal's own hidden capture copy. */}
      <div
        style={{ position: "fixed", top: 0, left: -10000, pointerEvents: "none" }}
        aria-hidden="true"
      >
        <div ref={captureRef}>
          <ShareAllDaysTemplate
            days={days}
            bands={bands}
            themeId={themeId}
            layoutId={layoutId}
            eventInfo={eventInfo}
            widescreen={widescreen}
          />
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
