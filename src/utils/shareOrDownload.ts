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
