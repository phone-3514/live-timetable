// Color/style tokens for the shareable timetable image (ShareTimetableTemplate).
// Kept as plain data (not Tailwind classes) because the values are picked
// per-theme at runtime and applied via inline style — Tailwind's color
// utilities are static class names, which doesn't fit a data-driven палette
// switch like this one.
export type ThemeId = "hype" | "chic" | "clean";

type BadgeStyle = { bg: string; border: string; text: string };
type GlowSpot = { background: string; top?: string; bottom?: string; left?: string; right?: string; size: number };

export type ShareTheme = {
  id: ThemeId;
  name: string;
  subtitle: string;
  pageBackground: string;
  glowSpots: GlowSpot[];
  kickerColor: string;
  dayTitleGradient: string | null; // CSS gradient for bg-clip text, or null for a solid color
  dayTitleColor: string; // solid color, used directly when dayTitleGradient is null
  dateColor: string;
  dividerBackground: string;
  cardBg: string;
  cardBorder: string;
  cardShadow: string;
  numberBadgeBackground: string;
  numberBadgeText: string;
  timeColor: string;
  bandNameColor: string;
  setlistColor: string;
  setlistItalic: boolean;
  syncBadge: BadgeStyle;
  keyBadge: BadgeStyle;
  breakBorder: string;
  breakBg: string;
  breakText: string;
  footerColor: string;
};

export const THEMES: Record<ThemeId, ShareTheme> = {
  hype: {
    id: "hype",
    name: "Hype",
    subtitle: "ネオン感のあるダーク＆エネルギッシュ",
    pageBackground: "linear-gradient(to bottom, #0b0a1f, #161334, #0a0912)",
    glowSpots: [
      { background: "rgba(79,70,229,0.25)", top: "-8rem", left: "-8rem", size: 384 },
      { background: "rgba(192,38,211,0.20)", top: "16rem", right: "-6rem", size: 320 },
    ],
    kickerColor: "rgba(165,180,252,0.8)",
    dayTitleGradient: "linear-gradient(to right, #a5b4fc, #ffffff, #f0abfc)",
    dayTitleColor: "#ffffff",
    dateColor: "#cbd5e1",
    dividerBackground: "linear-gradient(to right, transparent, rgba(129,140,248,0.7), transparent)",
    cardBg: "rgba(255,255,255,0.04)",
    cardBorder: "rgba(255,255,255,0.1)",
    cardShadow: "none",
    numberBadgeBackground: "linear-gradient(to bottom right, #818cf8, #d946ef)",
    numberBadgeText: "#ffffff",
    timeColor: "#a5b4fc",
    bandNameColor: "#ffffff",
    setlistColor: "#94a3b8",
    setlistItalic: true,
    syncBadge: { bg: "rgba(139,92,246,0.15)", border: "rgba(167,139,250,0.4)", text: "#ddd6fe" },
    keyBadge: { bg: "rgba(14,165,233,0.15)", border: "rgba(56,189,248,0.4)", text: "#bae6fd" },
    breakBorder: "rgba(255,255,255,0.1)",
    breakBg: "rgba(255,255,255,0.015)",
    breakText: "#94a3b8",
    footerColor: "#64748b",
  },
  chic: {
    id: "chic",
    name: "Chic & Chill",
    subtitle: "アイボリー×ベージュの温かみあるカフェ風",
    pageBackground: "linear-gradient(to bottom, #f7efe6, #efe1d1, #e6d3bd)",
    glowSpots: [
      { background: "rgba(212,165,116,0.25)", top: "-6rem", right: "-6rem", size: 340 },
      { background: "rgba(168,192,144,0.18)", bottom: "-6rem", left: "-6rem", size: 300 },
    ],
    kickerColor: "rgba(164,113,72,0.85)",
    dayTitleGradient: "linear-gradient(to right, #6b4423, #a47148, #6b4423)",
    dayTitleColor: "#4a3728",
    dateColor: "#8b7355",
    dividerBackground: "linear-gradient(to right, transparent, rgba(164,113,72,0.6), transparent)",
    cardBg: "rgba(255,255,255,0.55)",
    cardBorder: "rgba(212,196,176,0.8)",
    cardShadow: "0 4px 14px rgba(139,115,85,0.12)",
    numberBadgeBackground: "linear-gradient(to bottom right, #d4a876, #a47148)",
    numberBadgeText: "#fffaf3",
    timeColor: "#a47148",
    bandNameColor: "#3e2723",
    setlistColor: "#8b7355",
    setlistItalic: true,
    syncBadge: { bg: "#e8ede3", border: "#a8c090", text: "#4d5f3f" },
    keyBadge: { bg: "#f3e5e0", border: "#d4a5a5", text: "#7a4a4a" },
    breakBorder: "rgba(180,160,135,0.5)",
    breakBg: "rgba(255,255,255,0.2)",
    breakText: "#a8977e",
    footerColor: "#a8977e",
  },
  clean: {
    id: "clean",
    name: "Clean",
    subtitle: "白背景×ダークグレーの視認性最優先ミニマル",
    pageBackground: "#ffffff",
    glowSpots: [],
    kickerColor: "#6b7280",
    dayTitleGradient: null,
    dayTitleColor: "#111827",
    dateColor: "#4b5563",
    dividerBackground: "#e5e7eb",
    cardBg: "#ffffff",
    cardBorder: "#e5e7eb",
    cardShadow: "0 1px 3px rgba(0,0,0,0.06)",
    numberBadgeBackground: "#111827",
    numberBadgeText: "#ffffff",
    timeColor: "#2563eb",
    bandNameColor: "#0f172a",
    setlistColor: "#6b7280",
    setlistItalic: false,
    syncBadge: { bg: "#eff6ff", border: "#bfdbfe", text: "#1d4ed8" },
    keyBadge: { bg: "#fffbeb", border: "#fde68a", text: "#b45309" },
    breakBorder: "#d1d5db",
    breakBg: "#f9fafb",
    breakText: "#6b7280",
    footerColor: "#9ca3af",
  },
};
