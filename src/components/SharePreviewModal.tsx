import { useLayoutEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { ShareTimetableTemplate } from "./ShareTimetableTemplate";
import { THEMES } from "../utils/shareThemes";
import type { ThemeId } from "../utils/shareThemes";
import { useAppStore } from "../store/useAppStore";
import { useEscapeKey } from "../hooks/useEscapeKey";
import type { TimetableDay } from "../types";

type Props = { day: TimetableDay; onClose: () => void };

export function SharePreviewModal({ day, onClose }: Props) {
  const bands = useAppStore((s) => s.bands);
  const eventInfo = useAppStore((s) => s.eventInfo);
  const isSingleDay = useAppStore((s) => s.days.length === 1);
  useEscapeKey(onClose);
  const previewAreaRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<HTMLDivElement>(null);
  const [themeId, setThemeId] = useState<ThemeId>("standard");
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [areaSize, setAreaSize] = useState<{ width: number; height: number } | null>(null);
  const [downloading, setDownloading] = useState(false);

  // The preview box needs its own explicit size (from the unscaled node's
  // real dimensions) because a CSS transform:scale doesn't shrink the
  // space an element reserves in normal layout flow — without this the
  // surrounding modal would size itself for the full-resolution original.
  useLayoutEffect(() => {
    if (previewRef.current) {
      setNaturalSize({
        width: previewRef.current.offsetWidth,
        height: previewRef.current.offsetHeight,
      });
    }
  }, [day, bands, themeId, eventInfo]);

  // The scrollable area's own size (not the modal's, which also holds a
  // header/theme-picker/footer) — scaling by width alone left a tall image
  // far too big to fit vertically, so both axes are measured and the
  // tighter constraint wins.
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
      const dataUrl = await toPng(el, { pixelRatio: 2 });
      const link = document.createElement("a");
      link.download = `share-timetable-${day.label}-${themeId}.png`;
      link.href = dataUrl;
      link.click();
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-100">
            共有用タイムテーブル・プレビュー
          </h2>
          <button
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full text-slate-400 hover:bg-slate-800 hover:text-slate-200 md:h-7 md:w-7"
            title="閉じる"
          >
            ×
          </button>
        </div>

        <div className="max-h-40 shrink-0 overflow-y-auto border-b border-slate-800 px-4 py-3">
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

        <div ref={previewAreaRef} className="flex min-h-0 flex-1 items-center justify-center bg-slate-950 p-4">
          <div
            style={{
              width: naturalSize ? naturalSize.width * previewScale : undefined,
              height: naturalSize ? naturalSize.height * previewScale : undefined,
            }}
            className="overflow-hidden rounded-xl shadow-lg"
          >
            {/* Scaled-down view for on-screen preview only — never
                captured. html-to-image sizes its output from the target
                node's rendered bounding box, which an ancestor's CSS
                transform affects, so this can't double as the capture
                source (a separate off-screen, always-natural-size copy
                below is what actually gets downloaded).
                width: fit-content is load-bearing: without it this block
                div defaults to filling its parent's width rather than its
                own content's true width. That's invisible on the very
                first measurement (the parent isn't constrained yet), but
                once the parent box below gets an explicit size from a
                prior measurement, a later re-measurement (e.g. StrictMode
                double-invoking effects, or switching themes) would read
                that already-shrunk parent width back as if it were the
                natural size — a self-reinforcing shrink with no way to
                recover the true size afterward. */}
            <div
              ref={previewRef}
              style={{
                width: "fit-content",
                transform: `scale(${previewScale})`,
                transformOrigin: "top left",
              }}
            >
              <ShareTimetableTemplate
                day={day}
                bands={bands}
                themeId={themeId}
                eventInfo={eventInfo}
                isSingleDay={isSingleDay}
              />
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-800 px-4 py-3">
          <button
            onClick={onClose}
            className="min-h-11 rounded border border-slate-600 px-3 text-sm text-slate-300 hover:bg-slate-800 md:min-h-0 md:py-1.5"
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
          transformed — the actual source for the downloaded PNG. */}
      <div
        style={{ position: "fixed", top: 0, left: -10000, pointerEvents: "none" }}
        aria-hidden="true"
      >
        <div ref={captureRef}>
          <ShareTimetableTemplate
            day={day}
            bands={bands}
            themeId={themeId}
            eventInfo={eventInfo}
            isSingleDay={isSingleDay}
          />
        </div>
      </div>
    </div>
  );
}
