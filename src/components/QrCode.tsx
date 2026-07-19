import { useEffect, useState } from "react";

export function QrCode({ value, label, size = 176 }: { value: string; label: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void import("qrcode").then(({ toDataURL }) =>
      toDataURL(value, { width: size, margin: 2, errorCorrectionLevel: "M", color: { dark: "#0f172a", light: "#ffffff" } }),
    ).then((url) => active && setSrc(url));
    return () => { active = false; };
  }, [value, size]);
  return src ? <img src={src} width={size} height={size} alt={`${label}のQRコード`} className="rounded-lg bg-white p-2" /> : <div style={{ width: size, height: size }} className="animate-pulse rounded-lg bg-slate-800" aria-label={`${label}のQRコードを生成中`} />;
}
