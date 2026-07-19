import { useThemeStore } from "../store/useThemeStore";

const LABEL: Record<string, string> = {
  system: "システム設定に従う",
  light: "ライトモード",
  dark: "ダークモード",
};

// Single button cycling system -> light -> dark -> system, rather than a
// 3-way segmented picker — this app's header is already dense (tabs,
// backup controls, collab controls, event-info fields all compete for
// the same row), and "the OS default" is a real option worth keeping
// one click away, not just a value to click past once. Minimal
// hand-drawn line icons (not emoji) specifically here — this is a
// single, high-visibility, low-density header control, the lowest-risk
// place in the app to invest in real SF-Symbols-style icon work without
// touching the dozens of tightly-packed emoji-based icons used
// throughout the rest of the (especially mobile) UI.
export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const cycleTheme = useThemeStore((s) => s.cycleTheme);

  return (
    <button
      type="button"
      onClick={cycleTheme}
      title={`外観: ${LABEL[theme]}（クリックで切り替え）`}
      aria-label={`外観を切り替え（現在: ${LABEL[theme]}）`}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-300 hover:bg-slate-700 md:h-8 md:w-8"
    >
      {theme === "light" && (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12H5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8" />
        </svg>
      )}
      {theme === "dark" && (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z" />
        </svg>
      )}
      {theme === "system" && (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4.5" width="18" height="12" rx="2" />
          <path d="M8.5 20h7M12 16.5V20" />
        </svg>
      )}
    </button>
  );
}
