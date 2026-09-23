// Shared by SharePreviewModal (Timetable image) and SetlistExportModal
// (Setlist PNG/PDF) — both generate a file client-side (html-to-image /
// jsPDF) and hand it off here to actually reach the user's device.
//
// This used to try the Web Share API's file-sharing mode first (handing
// the file to the native share sheet, since iOS Safari has historically
// not reliably honored the `download` attribute for a data:/blob URL —
// it would just navigate to/open the file instead of saving it). Per an
// explicit choice made after being shown that tradeoff, this now always
// goes straight to a programmatic `<a download>` click instead — a
// single, simpler code path, accepting the risk that a mobile browser
// which mishandles `download` may open/navigate to the file rather than
// saving it.
export async function downloadFile(file: File): Promise<void> {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.download = file.name;
  link.href = url;
  link.click();
  // Deferred so the click has time to actually kick off the download —
  // revoking immediately can race the browser's navigation on some
  // engines.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** dataURL (as produced by html-to-image's toPng) -> File, for handing to
 * downloadFile. */
export function dataUrlToFile(dataUrl: string, filename: string, mimeType: string): File {
  const [, base64] = dataUrl.split(",");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: mimeType });
}

// Browsers cap how big a single <canvas> can be — commonly ~16384px on a
// side (Chrome/Safari/Firefox all draw the line somewhere in that
// neighborhood) and a total area around 268 million pixels (Chrome).
// html-to-image draws onto a canvas sized `naturalSize * pixelRatio`, so a
// busy day (wide from many share-image columns, especially in 16:9/
// widescreen mode) multiplied by a high pixelRatio can quietly cross that
// limit — the browser then either clips the canvas or falls back to a
// blurry/blank render with no visible error, which reads as "sometimes the
// downloaded image is low-res/rough" with no obvious cause. Capping the
// *effective* pixelRatio to whatever actually fits keeps every export
// under those limits instead of silently degrading past them.
const MAX_CANVAS_DIMENSION = 14000;
const MAX_CANVAS_AREA = 220_000_000;

export function computeSafePixelRatio(
  naturalWidth: number,
  naturalHeight: number,
  desiredPixelRatio: number,
): number {
  if (naturalWidth <= 0 || naturalHeight <= 0) return desiredPixelRatio;
  const byDimension = Math.min(MAX_CANVAS_DIMENSION / naturalWidth, MAX_CANVAS_DIMENSION / naturalHeight);
  const byArea = Math.sqrt(MAX_CANVAS_AREA / (naturalWidth * naturalHeight));
  return Math.max(1, Math.min(desiredPixelRatio, byDimension, byArea));
}
