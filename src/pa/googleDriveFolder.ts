import type { Band } from "../types";
import { normalizeBandName, type PaSheetLink } from "./types";

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
};

const FOLDER_MIME = "application/vnd.google-apps.folder";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";

export function extractDriveFolderId(value: string): string | null {
  try {
    const url = new URL(value);
    const pathMatch = /\/folders\/([a-zA-Z0-9_-]+)/.exec(url.pathname);
    return pathMatch?.[1] ?? url.searchParams.get("id");
  } catch {
    return null;
  }
}

function fileOpenUrl(file: DriveFile): string {
  if (file.webViewLink) return file.webViewLink;
  if (file.mimeType === SHEET_MIME) return `https://docs.google.com/spreadsheets/d/${file.id}/edit`;
  return `https://drive.google.com/file/d/${file.id}/view`;
}

async function listOneFolder(folderId: string, apiKey: string): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    pageSize: "1000",
    orderBy: "name_natural",
    fields: "files(id,name,mimeType,webViewLink)",
  });
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { "x-goog-api-key": apiKey },
  });
  if (!response.ok) {
    if (response.status === 403) throw new Error("フォルダを読み取れません。共有設定とDrive APIキーを確認してください");
    throw new Error("Google Driveのファイル一覧を取得できませんでした");
  }
  const data = await response.json() as { files?: DriveFile[] };
  return data.files ?? [];
}

export async function listPublicDriveFolder(folderUrl: string): Promise<DriveFile[]> {
  const folderId = extractDriveFolderId(folderUrl);
  if (!folderId) throw new Error("Google DriveフォルダのURLを確認してください");
  const apiKey = import.meta.env.VITE_GOOGLE_DRIVE_API_KEY;
  if (!apiKey) throw new Error("Drive APIキーが未設定です。VITE_GOOGLE_DRIVE_API_KEYを設定してください");

  const rootFiles = await listOneFolder(folderId, apiKey);
  const nestedFolders = rootFiles.filter((file) => file.mimeType === FOLDER_MIME).slice(0, 20);
  const nestedFiles = await Promise.all(nestedFolders.map((folder) => listOneFolder(folder.id, apiKey)));
  return [...rootFiles, ...nestedFiles.flat()].filter((file) => file.mimeType !== FOLDER_MIME);
}

function matchScore(fileName: string, bandName: string): number {
  const file = normalizeBandName(fileName);
  const band = normalizeBandName(bandName);
  if (!band || !file.includes(band)) return -1;
  if (file === band) return 10_000;
  const extraLength = file.length - band.length;
  const edgeBonus = file.startsWith(band) || file.endsWith(band) ? 1_000 : 0;
  return 5_000 + edgeBonus - extraLength;
}

export function autoMatchDriveFiles(bands: Band[], files: DriveFile[]): {
  links: PaSheetLink[];
  unmatchedBandIds: string[];
} {
  const links: PaSheetLink[] = [];
  const unmatchedBandIds: string[] = [];
  const usedFileIds = new Set<string>();
  // Match longer band names first so a short name contained in another
  // band's name cannot steal that band's only exact file.
  const matchingOrder = [...bands].sort(
    (a, b) => normalizeBandName(b.name).length - normalizeBandName(a.name).length,
  );
  for (const band of matchingOrder) {
    const candidates = files
      .map((file) => ({ file, score: matchScore(file.name, band.name) }))
      .filter((candidate) => candidate.score >= 0 && !usedFileIds.has(candidate.file.id))
      .sort((a, b) => b.score - a.score || a.file.name.localeCompare(b.file.name, "ja"));
    const selected = candidates[0]?.file;
    if (!selected) {
      unmatchedBandIds.push(band.id);
      continue;
    }
    usedFileIds.add(selected.id);
    links.push({ bandId: band.id, bandName: band.name, fileName: selected.name, url: fileOpenUrl(selected) });
  }
  return { links, unmatchedBandIds };
}
