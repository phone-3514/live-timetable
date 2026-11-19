import type { ArtworkLayer } from "../utils/shareArtwork";

// 共有画像のキャンバス(position:relative / overflow-hidden)の中に、テーマの背景イラストを
// 重ねる。内容より前に置くこと(後ろに描かれる)。クリックは受け取らない。
export function ThemeArtwork({ layers, scale = 1 }: { layers?: ArtworkLayer[]; scale?: number }) {
  const px = (v: number | undefined) => (v === undefined ? undefined : v * scale);
  if (!layers || layers.length === 0) return null;
  return (
    <>
      {layers.map((layer, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={{
            top: px(layer.top),
            right: px(layer.right),
            bottom: px(layer.bottom),
            left: px(layer.left),
            width: layer.repeatX ? undefined : px(layer.width),
            height: px(layer.height),
            opacity: layer.opacity,
            transform: layer.rotate ? `rotate(${layer.rotate}deg)` : undefined,
            backgroundImage: layer.uri,
            backgroundRepeat: layer.repeatX ? "repeat-x" : "no-repeat",
            backgroundSize: layer.repeatX ? "auto 100%" : "contain",
            backgroundPosition: layer.repeatX ? "left bottom" : "center",
          }}
        />
      ))}
    </>
  );
}
