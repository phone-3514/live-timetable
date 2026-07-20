import { useCallback, useEffect, useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useToastStore } from "../store/useToastStore";
import { ensureViewerCode } from "../utils/viewerCodes";
import { ModalPortal } from "./ModalPortal";
import { QrCode } from "./QrCode";

type ShareCardProps = {
  label: string;
  code?: string;
  url: string;
  explanation?: string;
  prominent?: boolean;
  onCopy: (value: string, label: string) => void;
};

function ShareCard({ label, code, url, explanation, prominent = false, onCopy }: ShareCardProps) {
  return (
    <section className={`flex min-w-0 flex-col items-center rounded-lg border p-3 ${prominent ? "border-blue-500 bg-blue-950/30" : "border-slate-700"}`}>
      <h3 className={`text-center font-semibold ${prominent ? "text-base text-blue-200" : "text-sm text-slate-200"}`}>{label}</h3>
      {explanation && <p className="mt-1 text-center text-xs leading-relaxed text-slate-400">{explanation}</p>}
      {code && (
        <div className="mt-3 flex w-full min-w-0 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 p-2">
          <code className="min-w-0 flex-1 truncate text-center font-mono text-sm font-bold uppercase tracking-[0.14em] text-slate-100">{code}</code>
          <button type="button" onClick={() => onCopy(code.toUpperCase(), `${label}コード`)} className="min-h-11 shrink-0 rounded-lg border border-slate-600 px-3 text-xs font-semibold text-slate-300 hover:bg-slate-700">コードをコピー</button>
        </div>
      )}
      <div className="mt-3"><QrCode value={url} label={label} size={prominent ? 184 : 150} /></div>
      <p className="mt-2 w-full truncate text-center text-[10px] text-slate-500" title={url}>{url}</p>
      <button type="button" onClick={() => onCopy(url, `${label}URL`)} className={`mt-2 min-h-11 shrink-0 rounded-lg px-3 text-xs font-semibold ${prominent ? "bg-blue-600 text-white hover:bg-blue-500" : "border border-slate-600 text-slate-300 hover:bg-slate-700"}`}>URLをコピー</button>
    </section>
  );
}

export function QrShareModal({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  useEscapeKey(onClose);
  const showToast = useToastStore((state) => state.show);
  const [viewerCode, setViewerCode] = useState<string | null>(null);
  const [viewerCodeError, setViewerCodeError] = useState(false);
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`;

  useEffect(() => {
    let active = true;
    void ensureViewerCode(roomId)
      .then((code) => { if (active) setViewerCode(code); })
      .catch(() => { if (active) setViewerCodeError(true); });
    return () => { active = false; };
  }, [roomId]);

  const copy = useCallback(async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showToast(`${label}をコピーしました`, "success");
    } catch {
      showToast("コピーできませんでした", "error");
    }
  }, [showToast]);

  const viewerUrl = viewerCode ? `${base}${viewerCode}/public` : null;
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[80] overflow-y-auto bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={onClose}>
        <div className="flex min-h-full items-center justify-center">
          <div className="w-full max-w-4xl rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div><p className="text-xs font-semibold text-blue-300">共有</p><h2 className="text-lg font-bold text-slate-100">コードとQRコード</h2></div>
              <button type="button" onClick={onClose} aria-label="閉じる" className="flex h-10 w-10 items-center justify-center rounded-full text-xl text-slate-400 hover:bg-slate-700">×</button>
            </div>

            <div className="mx-auto mt-4 max-w-md">
              {viewerUrl && viewerCode ? (
                <ShareCard label="一般閲覧用コード" code={viewerCode} url={viewerUrl} explanation="一般部員・出演者・来場者にはこちらを共有してください。編集はできません。" prominent onCopy={copy} />
              ) : (
                <div className="rounded-lg border border-blue-800 bg-blue-950/30 p-5 text-center text-sm text-blue-200">{viewerCodeError ? "閲覧コードを作成できませんでした" : "閲覧コードを準備中…"}</div>
              )}
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <ShareCard label="運営スタッフ用コード" code={roomId} url={`${base}?room=${roomId}`} explanation="運営スタッフ専用です。一般部員には共有しないでください。" onCopy={copy} />
              <ShareCard label="PA／ローディー用" url={`${base}pa-viewer?room=${roomId}`} onCopy={copy} />
              <ShareCard label="会場スクリーン" url={viewerCode ? `${base}${viewerCode}/public?mode=screen` : `${base}${roomId}/public?mode=screen`} onCopy={copy} />
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
