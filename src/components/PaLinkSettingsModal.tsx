import { useEffect, useMemo, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useAppStore } from "../store/useAppStore";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useToastStore } from "../store/useToastStore";
import { ModalPortal } from "./ModalPortal";
import { isGoogleWorkspaceUrl, type PaDriveFolder, type PaLinkConfig, type PaSheetLink } from "../pa/types";
import { autoMatchDriveFiles, listPublicDriveFolder } from "../pa/googleDriveFolder";

export function PaLinkSettingsModal({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  useEscapeKey(onClose);
  const bands = useAppStore((state) => state.bands);
  const showToast = useToastStore((state) => state.show);
  const [folders, setFolders] = useState<(PaDriveFolder & { id: string })[]>([]);
  const [autoLinks, setAutoLinks] = useState<PaSheetLink[]>([]);
  const [scannedFingerprint, setScannedFingerprint] = useState("");
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paUrl = `${window.location.origin}${import.meta.env.BASE_URL}pa-viewer?room=${roomId}`;

  const sortedBands = useMemo(
    () => [...bands].sort((a, b) => a.name.localeCompare(b.name, "ja")),
    [bands],
  );

  useEffect(() => {
    if (!db) {
      setError("Firebaseに接続されていません");
      setLoading(false);
      return;
    }
    let active = true;
    getDoc(doc(db, "rooms", roomId)).then((snapshot) => {
      if (!active) return;
      const config = snapshot.data()?.paConfig as PaLinkConfig | undefined;
      const loadedFolders = config?.folders?.length
        ? config.folders
        : config?.folderUrl
          ? [{ label: "PAシート", url: config.folderUrl }]
          : [];
      setFolders(loadedFolders.map((folder) => ({ ...folder, id: crypto.randomUUID() })));
      setAutoLinks(config?.links ?? []);
      setScannedFingerprint(JSON.stringify(loadedFolders));
    }).catch(() => {
      if (active) setError("PAリンク設定を読み込めませんでした");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [roomId]);

  async function copyPaUrl() {
    try {
      await navigator.clipboard.writeText(paUrl);
      showToast("PA用URLをコピーしました", "success");
    } catch {
      showToast("URLをコピーできませんでした", "error");
    }
  }

  const cleanedFolders = folders
    .map((folder, index) => ({
      label: folder.label.trim() || `PAフォルダ${index + 1}`,
      url: folder.url.trim(),
    }))
    .filter((folder) => folder.url.length > 0);
  const foldersFingerprint = JSON.stringify(cleanedFolders);
  const hasInvalidFolder = folders.some(
    (folder) => Boolean(folder.url.trim()) && !isGoogleWorkspaceUrl(folder.url),
  );

  function addFolder() {
    setFolders((current) => [
      ...current,
      { id: crypto.randomUUID(), label: `PAフォルダ${current.length + 1}`, url: "" },
    ]);
    setError(null);
  }

  async function scanFolders(): Promise<PaSheetLink[] | null> {
    if (hasInvalidFolder) {
      setError("すべての項目にGoogle DriveフォルダのHTTPS URLを入力してください");
      return null;
    }
    if (cleanedFolders.length === 0) {
      setError("Google Driveフォルダを1つ以上追加してください");
      return null;
    }
    setScanning(true);
    setError(null);
    try {
      const folderResults = await Promise.all(cleanedFolders.map(async (folder) => {
        try {
          const files = await listPublicDriveFolder(folder.url);
          const result = autoMatchDriveFiles(sortedBands, files);
          return result.links.map((link) => ({ ...link, label: folder.label }));
        } catch (folderError) {
          const detail = folderError instanceof Error ? folderError.message : "読み取れませんでした";
          throw new Error(`「${folder.label}」: ${detail}`);
        }
      }));
      const uniqueLinks = folderResults.flat().filter((link, index, all) =>
        all.findIndex((candidate) => candidate.bandId === link.bandId && candidate.url === link.url) === index,
      );
      setAutoLinks(uniqueLinks);
      setScannedFingerprint(foldersFingerprint);
      if (uniqueLinks.length === 0) setError("バンド名を含むファイルが見つかりませんでした。ファイル名と共有設定を確認してください");
      return uniqueLinks;
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "フォルダを読み取れませんでした");
      return null;
    } finally {
      setScanning(false);
    }
  }

  async function save() {
    if (!db) return;
    setSaving(true);
    setError(null);
    let linksToSave = autoLinks;
    if (cleanedFolders.length === 0) {
      linksToSave = [];
    } else if (foldersFingerprint !== scannedFingerprint) {
      const scanned = await scanFolders();
      if (!scanned) {
        setSaving(false);
        return;
      }
      linksToSave = scanned;
    }
    const config: PaLinkConfig = {
      folders: cleanedFolders,
      // Keep the first URL mirrored for rooms still using the previous
      // single-folder rules/schema. New clients read `folders` first.
      folderUrl: cleanedFolders[0]?.url ?? "",
      links: linksToSave,
      updatedAt: Date.now(),
    };
    try {
      await setDoc(doc(db, "rooms", roomId), { paConfig: config }, { merge: true });
      showToast("PAリンク設定を保存しました", "success");
      onClose();
    } catch {
      setError("保存できませんでした。通信状態と権限を確認してください");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[85] overflow-y-auto bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="pa-link-settings-title" onClick={onClose}>
        <div className="flex min-h-full items-center justify-center">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-bold tracking-wider text-blue-300">PA / ROADIE</p><h2 id="pa-link-settings-title" className="mt-1 text-xl font-black text-slate-100">PAシートのリンク設定</h2><p className="mt-1 text-xs leading-5 text-slate-400">ファイルはアップロードせず、Google Drive上のリンクだけを共有します。</p></div>
              <button type="button" onClick={onClose} aria-label="閉じる" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl text-slate-400 hover:bg-slate-700">×</button>
            </header>

            <section className="mt-5 rounded-xl border border-blue-800/70 bg-blue-950/25 p-3">
              <label className="text-xs font-bold text-blue-200" htmlFor="pa-share-url">PA担当者へ送るURL</label>
              <div className="mt-2 flex gap-2"><input id="pa-share-url" readOnly value={paUrl} className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 text-base text-slate-300 outline-none" /><button type="button" onClick={() => void copyPaUrl()} className="min-h-11 shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-500">コピー</button></div>
              <p className="mt-2 text-[11px] text-slate-400">この画面はホーム画面へ追加でき、次回からPA専用アプリとして起動できます。</p>
            </section>

            {loading ? <p className="py-12 text-center text-sm text-slate-400">設定を読み込み中…</p> : <>
              <section className="mt-5">
                <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-bold text-slate-200">Google Driveフォルダ</h3><p className="mt-1 text-xs text-slate-500">Main PA、Sub PA、照明など複数のフォルダを登録できます。各フォルダは「リンクを知っている全員が閲覧可」にしてください。</p></div><span className="shrink-0 rounded-full bg-slate-800 px-2.5 py-1 text-xs font-bold text-slate-300">{cleanedFolders.length}件</span></div>
                <div className="mt-3 space-y-3">
                  {folders.map((folder, index) => { const invalid = Boolean(folder.url.trim()) && !isGoogleWorkspaceUrl(folder.url); return <div key={folder.id} className="rounded-xl border border-slate-700 bg-slate-950/50 p-3"><div className="flex items-start gap-2"><div className="min-w-0 flex-1 space-y-2"><input value={folder.label} onChange={(event) => { const label = event.target.value; setFolders((current) => current.map((item) => item.id === folder.id ? { ...item, label } : item)); setError(null); }} aria-label={`PAフォルダ${index + 1}の名称`} placeholder={`PAフォルダ${index + 1}`} className="min-h-11 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 text-base font-bold text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-500" /><input type="url" inputMode="url" value={folder.url} onChange={(event) => { const url = event.target.value; setFolders((current) => current.map((item) => item.id === folder.id ? { ...item, url } : item)); setError(null); }} aria-label={`${folder.label || `PAフォルダ${index + 1}`}のGoogle Drive URL`} aria-invalid={invalid} placeholder="https://drive.google.com/drive/folders/..." className={`min-h-12 w-full rounded-lg border bg-slate-900 px-3 text-base text-slate-100 outline-none placeholder:text-slate-600 ${invalid ? "border-rose-500 focus:border-rose-400" : "border-slate-600 focus:border-blue-500"}`} /></div><button type="button" onClick={() => { setFolders((current) => current.filter((item) => item.id !== folder.id)); setError(null); }} aria-label={`${folder.label || `PAフォルダ${index + 1}`}を削除`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-700 text-xl text-slate-400 hover:border-rose-700 hover:bg-rose-950/50 hover:text-rose-300">×</button></div>{invalid && <p className="mt-2 text-xs font-semibold text-rose-300">Google DriveフォルダのURLを入力してください</p>}</div>; })}
                  <button type="button" onClick={addFolder} disabled={folders.length >= 20} className="min-h-12 w-full rounded-xl border border-dashed border-blue-600 bg-blue-950/20 px-4 text-sm font-black text-blue-200 hover:bg-blue-900/40 disabled:opacity-40">＋ フォルダを追加</button>
                  <button type="button" disabled={scanning || cleanedFolders.length === 0 || hasInvalidFolder} onClick={() => void scanFolders()} className="min-h-12 w-full rounded-xl border border-blue-600 bg-blue-950/40 px-4 text-sm font-black text-blue-200 hover:bg-blue-900/60 disabled:opacity-50">{scanning ? `${cleanedFolders.length}フォルダを読取中…` : "全フォルダから自動割り当て"}</button>
                </div>
              </section>

              <section className="mt-6">
                <h3 className="text-sm font-bold text-slate-200">自動割り当て結果</h3>
                <p className="mt-1 text-xs text-slate-500">全角半角・空白・記号を無視し、ファイル名にバンド名が含まれるシートを割り当てます。</p>
                <div className="mt-3 grid gap-3">
                  {sortedBands.length === 0 ? <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">バンドを登録すると割り当て結果が表示されます。</p> : sortedBands.map((band) => { const matches = autoLinks.filter((link) => link.bandId === band.id); return <div key={band.id} className={`rounded-xl border p-3 ${matches.length ? "border-emerald-800 bg-emerald-950/20" : "border-slate-700 bg-slate-950/50"}`}><p className="truncate text-sm font-bold text-slate-200">{band.name}</p>{matches.length ? <div className="mt-2 grid gap-2 sm:grid-cols-2">{matches.map((matched, index) => <a key={`${matched.url}-${index}`} href={matched.url} target="_blank" rel="noreferrer" className="flex min-h-10 items-center justify-between gap-2 rounded-lg border border-emerald-800/70 bg-emerald-950/30 px-3 text-xs font-bold text-emerald-200 hover:bg-emerald-900/40"><span className="min-w-0 truncate">✓ {matched.label || `PAシート${index + 1}`} · {matched.fileName ?? "割り当て済み"}</span><span>↗</span></a>)}</div> : <p className="mt-1 text-xs text-slate-500">— 一致するファイルなし（登録フォルダを表示）</p>}</div>; })}
                </div>
              </section>
            </>}

            {error && <p className="mt-4 rounded-lg border border-rose-800 bg-rose-950/40 px-3 py-2 text-sm font-semibold text-rose-300" role="alert">{error}</p>}
            <footer className="mt-5 flex flex-col-reverse gap-2 border-t border-slate-700 pt-4 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-slate-600 px-4 text-sm font-bold text-slate-300 hover:bg-slate-700">キャンセル</button><button type="button" disabled={loading || saving || scanning} onClick={() => void save()} className="min-h-11 rounded-lg bg-blue-600 px-5 text-sm font-black text-white hover:bg-blue-500 disabled:opacity-50">{saving ? "保存中…" : "設定を保存"}</button></footer>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
