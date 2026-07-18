// Rough feature check for whether shareOrDownloadFile will actually reach
// the native share sheet rather than falling back to a plain download —
// used only to label the button ("共有" vs "ダウンロード"); the real,
// file-specific check happens inside shareOrDownloadFile itself via
// canShare({ files }), since support can depend on the file's mime type.
export const supportsFileShare = typeof navigator !== "undefined" && "share" in navigator;

// Shared by SharePreviewModal (Timetable image) and SetlistExportModal
// (Setlist PNG/PDF) — both generate a file client-side (html-to-image /
// jsPDF) and then need to get it into the user's hands. `<a download>` is
// the right mechanism on desktop, but iOS Safari doesn't reliably honor
// the `download` attribute for a data: URL — it typically just navigates
// to/opens the image instead of saving it, leaving a mobile user with no
// obvious way to get the file into LINE, X, or their camera roll. The Web
// Share API's file-sharing mode (`navigator.share({ files })`) is what
// mobile browsers actually support for this: it hands the generated file
// straight to the native share sheet, which includes "save to Photos"
// alongside every app the user could send it to directly.
export async function shareOrDownloadFile(
  file: File,
  options: { title?: string; text?: string } = {},
): Promise<void> {
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files: File[]; title?: string; text?: string }) => Promise<void>;
  };

  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: options.title, text: options.text });
      return;
    } catch (err) {
      // AbortError just means the user closed the share sheet without
      // picking anything — not a failure, nothing to fall back to (they
      // saw the file, they chose not to act on it). Any other error
      // (share genuinely unsupported for this file despite canShare
      // saying otherwise, a permissions quirk, etc.) falls through to
      // the plain download below instead of leaving the user with
      // nothing.
      if (err instanceof Error && err.name === "AbortError") return;
    }
  }

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
 * shareOrDownloadFile. */
export function dataUrlToFile(dataUrl: string, filename: string, mimeType: string): File {
  const [, base64] = dataUrl.split(",");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: mimeType });
}
