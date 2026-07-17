import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { toCanvas, toPng } from "html-to-image";
import { SetlistExportTemplate } from "./SetlistExportTemplate";
import { computeSetlistEntries } from "../utils/setlistExport";
import { useAppStore } from "../store/useAppStore";
import { useApplicationStore } from "../store/useApplicationStore";
import type { TimetableDay } from "../types";

type Props = { day: TimetableDay; onClose: () => void };

// A4 at 96dpi — must match SetlistExportTemplate's own PAGE_WIDTH so the
// mm-per-pixel conversion below (used to slice the rendered canvas into
// real A4-height pages for the PDF) is accurate.
const PAGE_WIDTH_PX = 794;
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;

// This is an entirely separate export flow from SharePreviewModal/
// ShareTimetableTemplate (the existing timetable image export) — different
// template, different component, no shared state. Nothing about the
// existing share-image feature is touched by this file.
export function SetlistExportModal({ day, onClose }: Props) {
  const bands = useAppStore((s) => s.bands);
  const eventInfo = useAppStore((s) => s.eventInfo);
  const applications = useApplicationStore((s) => s.applications);
  const entries = useMemo(
    () => computeSetlistEntries(day, bands, applications),
    [day, bands, applications],
  );

  const previewAreaRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<HTMLDivElement>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [areaSize, setAreaSize] = useState<{ width: number; height: number } | null>(null);
  const [busy, setBusy] = useState<"png" | "pdf" | null>(null);

  // Same reasoning as SharePreviewModal: a CSS transform:scale doesn't
  // shrink the space an element reserves in normal layout flow, so the
  // preview box needs its own explicit size measured from the unscaled node.
  useLayoutEffect(() => {
    if (previewRef.current) {
      setNaturalSize({
        width: previewRef.current.offsetWidth,
        height: previewRef.current.offsetHeight,
      });
    }
  }, [day, bands, applications, entries.length]);

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

  async function handleDownloadPng() {
    const el = captureRef.current;
    if (!el) return;
    setBusy("png");
    try {
      const dataUrl = await toPng(el, { pixelRatio: 2, backgroundColor: "#ffffff" });
      const link = document.createElement("a");
      link.download = `setlist-${day.label}.png`;
      link.href = dataUrl;
      link.click();
    } finally {
      setBusy(null);
    }
  }

  async function handleDownloadPdf() {
    const el = captureRef.current;
    if (!el) return;
    setBusy("pdf");
    try {
      // jsPDF pulls in html2canvas + dompurify transitively (~380KB) —
      // dynamically imported so that weight only ever loads for someone who
      // actually clicks this button, not into the main app bundle every
      // visitor downloads just to use the timetable editor.
      const { jsPDF } = await import("jspdf");
      // pixelRatio 2 keeps text crisp on both screen and paper without
      // ballooning file size the way a much higher ratio would on a
      // document that's mostly flat color and text.
      const canvas = await toCanvas(el, { pixelRatio: 2, backgroundColor: "#ffffff" });
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const pxPerMm = canvas.width / A4_WIDTH_MM;
      const pageHeightPx = Math.floor(A4_HEIGHT_MM * pxPerMm);
      const totalPages = Math.max(1, Math.ceil(canvas.height / pageHeightPx));

      for (let page = 0; page < totalPages; page++) {
        const sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = Math.min(pageHeightPx, canvas.height - page * pageHeightPx);
        const ctx = sliceCanvas.getContext("2d");
        if (!ctx) continue;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        ctx.drawImage(canvas, 0, -page * pageHeightPx);

        if (page > 0) pdf.addPage();
        const sliceHeightMm = sliceCanvas.height / pxPerMm;
        // jsPDF's PNG path re-encodes through its own embedder rather than
        // reusing the browser's already-compressed PNG bytes, which for a
        // page like this (small, but every pixel individually specified)
        // came out close to raw-bitmap size — a ~100KB page ballooned past
        // 3MB. High-quality JPEG (0.95) is what jsPDF actually embeds
        // efficiently, and at this quality text stays sharp; the earlier
        // "avoid JPEG, it blurs text" concern only bites at the compression
        // levels JPEG is usually reached for, not near-lossless ones.
        pdf.addImage(
          sliceCanvas.toDataURL("image/jpeg", 0.95),
          "JPEG",
          0,
          0,
          A4_WIDTH_MM,
          sliceHeightMm,
        );
      }

      pdf.save(`setlist-${day.label}.pdf`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">セットリスト出力プレビュー</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              A4サイズ・印刷/PDF向けレイアウト（{entries.length}バンド）
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full text-slate-400 hover:bg-slate-800 hover:text-slate-200 md:h-7 md:w-7"
            title="閉じる"
          >
            ×
          </button>
        </div>

        <div
          ref={previewAreaRef}
          className="flex min-h-0 flex-1 items-center justify-center bg-slate-950 p-4"
        >
          <div
            style={{
              width: naturalSize ? naturalSize.width * previewScale : undefined,
              height: naturalSize ? naturalSize.height * previewScale : undefined,
            }}
            className="overflow-hidden rounded-lg shadow-lg"
          >
            {/* Scaled-down view for on-screen preview only — the off-screen
                always-natural-size copy below is what actually gets
                captured, same reasoning as SharePreviewModal. */}
            <div
              ref={previewRef}
              style={{
                width: "fit-content",
                transform: `scale(${previewScale})`,
                transformOrigin: "top left",
              }}
            >
              <SetlistExportTemplate day={day} eventInfo={eventInfo} entries={entries} />
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-800 px-4 py-3">
          <button
            onClick={onClose}
            className="min-h-11 rounded border border-slate-600 px-3 text-sm text-slate-300 hover:bg-slate-800 md:min-h-0 md:py-1.5"
          >
            閉じる
          </button>
          <button
            onClick={handleDownloadPng}
            disabled={busy !== null}
            className="min-h-11 rounded border border-indigo-500 px-3 text-sm font-medium text-indigo-300 hover:bg-indigo-950/50 disabled:opacity-50 md:min-h-0 md:py-1.5"
          >
            {busy === "png" ? "画像を生成中…" : "画像として保存 (PNG)"}
          </button>
          <button
            onClick={handleDownloadPdf}
            disabled={busy !== null}
            className="min-h-11 rounded bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 md:min-h-0 md:py-1.5"
          >
            {busy === "pdf" ? "PDFを生成中…" : "PDFとして保存"}
          </button>
        </div>
      </div>

      {/* Off-screen, always at natural full-resolution size and never
          transformed — the actual capture source for both PNG and PDF. */}
      <div
        style={{ position: "fixed", top: 0, left: -10000, pointerEvents: "none", width: PAGE_WIDTH_PX }}
        aria-hidden="true"
      >
        <div ref={captureRef}>
          <SetlistExportTemplate day={day} eventInfo={eventInfo} entries={entries} />
        </div>
      </div>
    </div>
  );
}
