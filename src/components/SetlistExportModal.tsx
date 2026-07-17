import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { toCanvas, toPng } from "html-to-image";
import { SetlistExportTemplate, PAGE_WIDTH } from "./SetlistExportTemplate";
import { computeSetlistEntries } from "../utils/setlistExport";
import { useAppStore } from "../store/useAppStore";
import { useApplicationStore } from "../store/useApplicationStore";
import { THEMES, getSetlistPalette } from "../utils/shareThemes";
import type { ThemeId } from "../utils/shareThemes";
import { useEscapeKey } from "../hooks/useEscapeKey";
import type { TimetableDay } from "../types";

type Props = { day: TimetableDay; onClose: () => void };

// A4 at 96dpi — must match SetlistExportTemplate's own PAGE_WIDTH so the
// mm-per-pixel conversion below (used to slice the rendered canvas into
// real A4-height pages for the PDF) is accurate.
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const PDF_PIXEL_RATIO = 2;

// The PNG export is meant to stay readable as one flat image (Discord,
// LINE, printed and pinned to a board) rather than a multi-page document,
// so a long day goes wider instead of scrolling forever — 2 columns once
// there's more than a handful of bands, 3 once there's enough to make a
// 2-column image awkwardly tall regardless.
function computeColumnCount(entryCount: number): number {
  if (entryCount <= 1) return 1;
  if (entryCount <= 8) return 2;
  return 3;
}

// This is an entirely separate export flow from SharePreviewModal/
// ShareTimetableTemplate (the existing timetable image export) — different
// template, different component, no shared state. Nothing about the
// existing share-image feature is touched by this file.
export function SetlistExportModal({ day, onClose }: Props) {
  const bands = useAppStore((s) => s.bands);
  const eventInfo = useAppStore((s) => s.eventInfo);
  const isSingleDay = useAppStore((s) => s.days.length === 1);
  const applications = useApplicationStore((s) => s.applications);
  useEscapeKey(onClose);
  const entries = useMemo(
    () => computeSetlistEntries(day, bands, applications),
    [day, bands, applications],
  );
  const pngColumns = computeColumnCount(entries.length);
  // Same theme system as the Timetable share-image export (shareThemes.ts)
  // — this modal has its own independent selection rather than mirroring
  // SharePreviewModal's, since an organizer may want the setlist handed to
  // the sound crew looking different from the audience-facing timetable
  // image, but both draw from the identical theme list.
  const [themeId, setThemeId] = useState<ThemeId>("standard");

  const previewAreaRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  // Two separate off-screen capture sources: PDF stays single-column
  // portrait (real A4 proportions, sliced into pages), PNG is the
  // landscape multi-column layout — different DOM shapes, so each needs
  // its own render rather than sharing one node.
  const capturePortraitRef = useRef<HTMLDivElement>(null);
  const captureLandscapeRef = useRef<HTMLDivElement>(null);
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
  }, [day, bands, applications, entries.length, themeId]);

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
    const el = captureLandscapeRef.current;
    if (!el) return;
    setBusy("png");
    try {
      const dataUrl = await toPng(el, { pixelRatio: 2 });
      const link = document.createElement("a");
      link.download = `setlist-${day.label}-${themeId}.png`;
      link.href = dataUrl;
      link.click();
    } finally {
      setBusy(null);
    }
  }

  async function handleDownloadPdf() {
    const el = capturePortraitRef.current;
    if (!el) return;
    setBusy("pdf");
    try {
      // jsPDF pulls in html2canvas + dompurify transitively (~380KB) —
      // dynamically imported so that weight only ever loads for someone who
      // actually clicks this button, not into the main app bundle every
      // visitor downloads just to use the timetable editor.
      const { jsPDF } = await import("jspdf");
      const pageFill = getSetlistPalette(THEMES[themeId]).pageFillSolid;
      // pixelRatio 2 keeps text crisp on both screen and paper without
      // ballooning file size the way a much higher ratio would on a
      // document that's mostly flat color and text.
      const canvas = await toCanvas(el, { pixelRatio: PDF_PIXEL_RATIO, backgroundColor: pageFill });
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const pxPerMm = canvas.width / A4_WIDTH_MM;
      const pageHeightPx = Math.floor(A4_HEIGHT_MM * pxPerMm);

      // Measure every row's vertical bounds in the SAME pixel space as the
      // canvas (CSS px * pixelRatio), so a page break can be pulled back to
      // a row's top edge instead of landing inside it — a band's time,
      // name, setlist, and members always stay together on one page.
      const containerTop = el.getBoundingClientRect().top;
      const rowBounds = Array.from(el.querySelectorAll<HTMLElement>("[data-setlist-row]")).map(
        (row) => {
          const r = row.getBoundingClientRect();
          return {
            top: (r.top - containerTop) * PDF_PIXEL_RATIO,
            bottom: (r.bottom - containerTop) * PDF_PIXEL_RATIO,
          };
        },
      );

      const pageBreaks: number[] = [0];
      let cursor = 0;
      while (cursor < canvas.height) {
        let next = cursor + pageHeightPx;
        if (next >= canvas.height) break;
        // A row currently straddling this cut gets pulled back to the
        // page before it in full, rather than being split across pages —
        // unless doing so would produce an empty page (a single row taller
        // than one whole page), which the `> cursor` guard falls back
        // from to avoid looping forever on a page that can never close.
        const straddling = rowBounds.find((r) => r.top < next && r.bottom > next);
        if (straddling && straddling.top > cursor) {
          next = straddling.top;
        }
        pageBreaks.push(next);
        cursor = next;
      }

      for (let page = 0; page < pageBreaks.length; page++) {
        const start = pageBreaks[page];
        const end = page + 1 < pageBreaks.length ? pageBreaks[page + 1] : canvas.height;
        const sliceHeight = end - start;
        if (sliceHeight <= 0) continue;

        const sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = sliceHeight;
        const ctx = sliceCanvas.getContext("2d");
        if (!ctx) continue;
        ctx.fillStyle = pageFill;
        ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        ctx.drawImage(canvas, 0, -start);

        if (page > 0) pdf.addPage();
        // A page's captured content is usually shorter than the full A4
        // height (rows get pulled back to avoid splitting one across
        // pages), leaving real page area below the image — jsPDF's own
        // page background is always white, which would show as a stray
        // white band under a dark theme. Filling the whole page with the
        // theme's solid color first means that gap reads as intentional
        // margin instead.
        pdf.setFillColor(pageFill);
        pdf.rect(0, 0, A4_WIDTH_MM, A4_HEIGHT_MM, "F");
        const sliceHeightMm = sliceHeight / pxPerMm;
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

      pdf.save(`setlist-${day.label}-${themeId}.pdf`);
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
              {entries.length}バンド・PDFはA4縦（ページ内でバンド情報は分割されません）／PNGは横向き{pngColumns}
              段組で出力されます
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

        <div className="max-h-40 shrink-0 overflow-y-auto border-b border-slate-800 px-4 py-3">
          <div className="grid grid-cols-3 gap-2 min-[420px]:grid-cols-4 sm:grid-cols-5 md:grid-cols-7">
            {Object.values(THEMES).map((theme) => (
              <button
                key={theme.id}
                onClick={() => setThemeId(theme.id)}
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
                always-natural-size copies below are what actually get
                captured, same reasoning as SharePreviewModal. This shows
                the PDF's portrait layout, since that's the print
                reference; the PNG button produces the wider multi-column
                layout described above instead. */}
            <div
              ref={previewRef}
              style={{
                width: "fit-content",
                transform: `scale(${previewScale})`,
                transformOrigin: "top left",
              }}
            >
              <SetlistExportTemplate
                day={day}
                eventInfo={eventInfo}
                entries={entries}
                themeId={themeId}
                isSingleDay={isSingleDay}
              />
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
            {busy === "png" ? "画像を生成中…" : "画像として保存 (PNG・横向き)"}
          </button>
          <button
            onClick={handleDownloadPdf}
            disabled={busy !== null}
            className="min-h-11 rounded bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 md:min-h-0 md:py-1.5"
          >
            {busy === "pdf" ? "PDFを生成中…" : "PDFとして保存 (A4縦)"}
          </button>
        </div>
      </div>

      {/* Off-screen, always at natural full-resolution size and never
          transformed — the actual capture sources. Two separate layouts:
          portrait single-column for the PDF, landscape multi-column for
          the PNG. */}
      <div
        style={{ position: "fixed", top: 0, left: -20000, pointerEvents: "none", width: PAGE_WIDTH }}
        aria-hidden="true"
      >
        <div ref={capturePortraitRef}>
          <SetlistExportTemplate
            day={day}
            eventInfo={eventInfo}
            entries={entries}
            columns={1}
            themeId={themeId}
            isSingleDay={isSingleDay}
          />
        </div>
      </div>
      <div
        style={{ position: "fixed", top: 0, left: -40000, pointerEvents: "none" }}
        aria-hidden="true"
      >
        <div ref={captureLandscapeRef}>
          <SetlistExportTemplate
            day={day}
            eventInfo={eventInfo}
            entries={entries}
            columns={pngColumns}
            themeId={themeId}
            isSingleDay={isSingleDay}
          />
        </div>
      </div>
    </div>
  );
}
