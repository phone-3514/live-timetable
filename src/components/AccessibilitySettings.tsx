import { useState } from "react";
import { useAccessibilityStore } from "../store/useAccessibilityStore";
import { ModalPortal } from "./ModalPortal";
import { useEscapeKey } from "../hooks/useEscapeKey";

export function AccessibilitySettings() {
  const [open, setOpen] = useState(false);
  const store = useAccessibilityStore();
  useEscapeKey(() => setOpen(false));
  const options = [
    ["largeText", "文字を大きく", "画面全体の文字サイズを拡大"],
    ["highContrast", "高コントラスト", "境界線と文字の差を強調"],
    ["reduceMotion", "動きを減らす", "アニメーションと自動スクロールを抑制"],
    ["largeTargets", "タップ領域を拡大", "ボタンを最低48pxに拡大"],
  ] as const;
  return <><button type="button" onClick={() => setOpen(true)} aria-label="アクセシビリティ設定" title="アクセシビリティ設定" className="flex min-h-11 items-center rounded border border-slate-600 px-2 text-xs font-bold text-slate-300 hover:bg-slate-700 md:min-h-0 md:py-1">Aa</button>{open && <ModalPortal><div className="fixed inset-0 z-[90] overflow-y-auto bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="accessibility-title" onClick={() => setOpen(false)}><div className="flex min-h-full items-center justify-center"><div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><h2 id="accessibility-title" className="text-lg font-bold text-slate-100">アクセシビリティ</h2><button type="button" onClick={() => setOpen(false)} aria-label="閉じる" className="flex h-10 w-10 items-center justify-center rounded-full text-xl text-slate-400 hover:bg-slate-700">×</button></div><div className="mt-4 space-y-2">{options.map(([key, label, description]) => <label key={key} className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-slate-700 p-3 hover:bg-slate-800"><input type="checkbox" checked={store[key]} onChange={() => store.toggle(key)} className="h-5 w-5 accent-blue-600" /><span><strong className="block text-sm text-slate-100">{label}</strong><span className="block text-xs text-slate-400">{description}</span></span></label>)}</div><p className="mt-4 text-xs leading-relaxed text-slate-400">警告は色だけでなく、アイコンと文章でも読み上げられます。主要操作にはVoiceOver向けの名前を設定しています。</p></div></div></div></ModalPortal>}</>;
}
