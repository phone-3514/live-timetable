export type PaSheetLink = {
  bandId: string;
  bandName: string;
  label?: string;
  fileName?: string;
  url: string;
};

export type PaDriveFolder = {
  label: string;
  url: string;
};

export type PaLinkConfig = {
  folders: PaDriveFolder[];
  /** Legacy single-folder field retained while old rooms migrate. */
  folderUrl?: string;
  links: PaSheetLink[];
  updatedAt: number;
};

export function isGoogleWorkspaceUrl(value: string): boolean {
  if (!value.trim()) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "drive.google.com" || url.hostname === "docs.google.com");
  } catch {
    return false;
  }
}

export function normalizeBandName(value: string): string {
  return value
    .replace(/\.[^.]+$/, "")
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/[\s._\-‐‑–—・･()[\]（）【】『』「」]+/g, "");
}
