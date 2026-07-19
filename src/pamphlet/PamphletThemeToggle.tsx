import { useThemeStore } from "../store/useThemeStore";

const LABEL: Record<string, string> = {
  system: "システム設定に従う",
  light: "ライトモード",
  dark: "ダークモード",
};

// A pamphlet-local copy of the header's ThemeToggle rather than a shared
// import — that component intentionally shrinks to 32px on desktop
// (`md:h-8 md:w-8`) to fit the admin editor's dense, control-packed
// header (see ThemeToggle.tsx's own comment). This route has its own,
// stricter "every tap target is at least 44x44px" requirement (an
// audience member on any device, not a circle member at a cluttered
// desk), so it needs a toggle that never shrinks below that regardless
// of viewport — duplicating ~20 lines here is simpler and safer than
// adding a size prop that would need threading through the shared
// component's every existing call site.
export function PamphletThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const cycleTheme = useThemeStore((s) => s.cycleTheme);

  return (
    <button
      type="button"
      onClick={cycleTheme}
      title={`外観: ${LABEL[theme]}（クリックで切り替え）`}
      aria-label={`外観を切り替え（現在: ${LABEL[theme]}）`}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-300 hover:bg-slate-800"
    >
      {theme === "light" && (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12H5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8" />
        </svg>
      )}
      {theme === "dark" && (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z" />
        </svg>
      )}
      {theme === "system" && (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4.5" width="18" height="12" rx="2" />
          <path d="M8.5 20h7M12 16.5V20" />
        </svg>
      )}
    </button>
  );
}
