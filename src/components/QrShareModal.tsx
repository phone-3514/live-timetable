import { useEscapeKey } from "../hooks/useEscapeKey";
import { ModalPortal } from "./ModalPortal";
import { QrCode } from "./QrCode";

export function QrShareModal({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  useEscapeKey(onClose);
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`;
  const general = { label: "一般閲覧用", value: `${base}${roomId}/public` };
  const secondaryLinks = [
    { label: "運営スタッフ用", value: `${base}?room=${roomId}` },
    { label: "PA／ローディー用", value: `${base}pa-viewer?room=${roomId}` },
    { label: "会場スクリーン", value: `${base}${roomId}/public?mode=screen` },
  ];
  const shareCard = (link: { label: string; value: string }, prominent = false) => <section key={link.label} className={`flex flex-col items-center rounded-lg border p-3 ${prominent ? "border-blue-500 bg-blue-950/30" : "border-slate-700"}`}><h3 className={`mb-2 text-center font-semibold ${prominent ? "text-base text-blue-200" : "text-sm text-slate-200"}`}>{link.label}</h3><QrCode value={link.value} label={link.label} size={prominent ? 184 : 150} /><button type="button" onClick={() => void navigator.clipboard.writeText(link.value)} className={`mt-2 min-h-11 rounded-lg px-3 text-xs font-semibold ${prominent ? "bg-blue-600 text-white hover:bg-blue-500" : "border border-slate-600 text-slate-300 hover:bg-slate-700"}`}>URLをコピー</button></section>;
  return <ModalPortal><div className="fixed inset-0 z-[80] overflow-y-auto bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={onClose}><div className="flex min-h-full items-center justify-center"><div className="w-full max-w-4xl rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><div><p className="text-xs font-semibold text-blue-300">共有</p><h2 className="text-lg font-bold text-slate-100">QRコード</h2></div><button type="button" onClick={onClose} aria-label="閉じる" className="flex h-10 w-10 items-center justify-center rounded-full text-xl text-slate-400 hover:bg-slate-700">×</button></div><div className="mx-auto mt-4 max-w-sm">{shareCard(general, true)}</div><div className="mt-4 grid gap-4 sm:grid-cols-3">{secondaryLinks.map((link) => shareCard(link))}</div></div></div></div></ModalPortal>;
}
