import { useLayoutEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { ShareTimetableTemplate } from "./ShareTimetableTemplate";
import { THEMES } from "../utils/shareThemes";
import type { ThemeId } from "../utils/shareThemes";
import { useAppStore } from "../store/useAppStore";
import type { TimetableDay } from "../types";

// The canvas is no longer a fixed size — it's however wide the day's
// column count makes it (see ShareTimetableTemplate) — so the preview
// scale is derived from the node's actual measured size rather than a
// constant ratio, and only shrinks it down (never enlarges a narrow day
// past 1:1).
const PREVIEW_MAX_WIDTH = 860;

type Props = { day: TimetableDay; onClose: () => void };

export function SharePreviewModal({ day, onClose }: Props) {
  const bands = useAppStore((s) => s.bands);
  const previewRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<HTMLDivElement>(null);
  const [themeId, setThemeId] = useState<ThemeId>("hype");
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
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
  }, [day, bands, themeId]);

  const previewScale = naturalSize ? Math.min(1, PREVIEW_MAX_WIDTH / naturalSize.width) : 1;

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
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-100">
            共有用タイムテーブル・プレビュー
          </h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            title="閉じる"
          >
            ×
          </button>
        </div>

        <div className="flex shrink-0 gap-2 border-b border-slate-800 px-4 py-3">
          {(Object.values(THEMES)).map((theme) => (
            <button
              key={theme.id}
              onClick={() => setThemeId(theme.id)}
              title={theme.subtitle}
              className={`flex-1 rounded-lg border px-2 py-1.5 text-left transition-colors ${
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
                className={`block text-xs font-semibold ${
                  themeId === theme.id ? "text-indigo-200" : "text-slate-300"
                }`}
              >
                {theme.name}
              </span>
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto bg-slate-950 p-4">
          <div
            style={{
              width: naturalSize ? naturalSize.width * previewScale : undefined,
              height: naturalSize ? naturalSize.height * previewScale : undefined,
            }}
            className="mx-auto overflow-hidden rounded-xl shadow-lg"
          >
            {/* Scaled-down view for on-screen preview only — never
                captured. html-to-image sizes its output from the target
                node's rendered bounding box, which an ancestor's CSS
                transform affects, so this can't double as the capture
                source (a separate off-screen, always-natural-size copy
                below is what actually gets downloaded). */}
            <div
              ref={previewRef}
              style={{ transform: `scale(${previewScale})`, transformOrigin: "top left" }}
            >
              <ShareTimetableTemplate day={day} bands={bands} themeId={themeId} />
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-800 px-4 py-3">
          <button
            onClick={onClose}
            className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            閉じる
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
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
          <ShareTimetableTemplate day={day} bands={bands} themeId={themeId} />
        </div>
      </div>
    </div>
  );
}
