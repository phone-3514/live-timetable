// Color/style tokens for the shareable timetable image (ShareTimetableTemplate).
// Kept as plain data (not Tailwind classes) because the values are picked
// per-theme at runtime and applied via inline style — Tailwind's color
// utilities are static class names, which doesn't fit a data-driven палette
// switch like this one.
export type ThemeId =
  | "standard"
  | "rock"
  | "chic"
  | "spring"
  | "rainy"
  | "summer"
  | "autumn"
  | "halloween"
  | "schoolfest"
  | "christmas"
  | "winter"
  | "graduation"
  | "minimal"
  | "metal"
  | "pop"
  | "jazz"
  | "instruments";

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
  /** CSS `background-image` value (a tiled data-URI SVG), rendered as a
   * low-opacity full-bleed layer behind the content on both the Timetable
   * and Setlist exports. Undefined for every theme except "instruments" —
   * every other theme renders exactly as before. */
  watermarkPattern?: string;
};

// Faint line-art guitar/mic/drum-kit/keyboard silhouettes, tiled — the
// opacity is baked into the SVG's own stroke-opacity (not a CSS opacity on
// the wrapping element) so it never has to fight with, or accidentally
// affect, anything stacked above it.
const INSTRUMENTS_WATERMARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><g fill="none" stroke="#ffffff" stroke-width="2" stroke-opacity="0.07" stroke-linecap="round" stroke-linejoin="round"><g transform="translate(20,20)"><circle cx="20" cy="55" r="18"/><circle cx="20" cy="30" r="11"/><line x1="20" y1="12" x2="20" y2="-6"/><line x1="14" y1="-6" x2="26" y2="-6"/></g><g transform="translate(140,14)"><rect x="6" y="0" width="16" height="26" rx="8"/><path d="M0 20a14 14 0 0 0 28 0"/><line x1="14" y1="34" x2="14" y2="50"/></g><g transform="translate(30,140)"><ellipse cx="30" cy="16" rx="30" ry="10"/><line x1="0" y1="16" x2="0" y2="46"/><line x1="60" y1="16" x2="60" y2="46"/><ellipse cx="30" cy="46" rx="30" ry="10"/></g><g transform="translate(140,150)"><rect x="0" y="0" width="70" height="24"/><line x1="10" y1="0" x2="10" y2="24"/><line x1="20" y1="0" x2="20" y2="16"/><line x1="30" y1="0" x2="30" y2="24"/><line x1="40" y1="0" x2="40" y2="16"/><line x1="50" y1="0" x2="50" y2="24"/><line x1="60" y1="0" x2="60" y2="16"/></g></g></svg>`;
const INSTRUMENTS_WATERMARK = `url("data:image/svg+xml,${encodeURIComponent(INSTRUMENTS_WATERMARK_SVG)}")`;

// Non-band rows (休憩・集合・リハーサルなど) deliberately use the OPPOSITE
// color polarity from band cards on every theme below — light solid bg +
// dark text on dark/vibrant themes, a clearly darker/more saturated solid
// bg + dark text on light themes — so they always read as a distinct kind
// of row at a glance, never just a dimmer/paler band card. See each
// theme's breakBg/breakText/breakBorder.

export const THEMES: Record<ThemeId, ShareTheme> = {
  standard: {
    id: "standard",
    name: "Standard",
    subtitle: "白背景×ブルーアクセントの視認性最優先スタンダード",
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
    breakBorder: "#9ca3af",
    breakBg: "#e5e7eb",
    breakText: "#1f2937",
    footerColor: "#9ca3af",
  },
  rock: {
    id: "rock",
    name: "Dark / Rock",
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
    breakBorder: "#64748b",
    breakBg: "#cbd5e1",
    breakText: "#1e293b",
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
    breakBorder: "#a4886a",
    breakBg: "#e6d7c3",
    breakText: "#3e2723",
    footerColor: "#a8977e",
  },
  spring: {
    id: "spring",
    name: "Spring / Welcome",
    subtitle: "新歓シーズンの桜ピンク×フレッシュグリーン",
    pageBackground: "linear-gradient(to bottom, #fff5f7, #ffe4ec, #fdf2e9)",
    glowSpots: [
      { background: "rgba(244,114,182,0.25)", top: "-6rem", left: "-6rem", size: 340 },
      { background: "rgba(134,239,172,0.22)", bottom: "-6rem", right: "-6rem", size: 300 },
    ],
    kickerColor: "rgba(219,39,119,0.75)",
    dayTitleGradient: "linear-gradient(to right, #db2777, #f472b6, #db2777)",
    dayTitleColor: "#831843",
    dateColor: "#a8637f",
    dividerBackground: "linear-gradient(to right, transparent, rgba(244,114,182,0.6), transparent)",
    cardBg: "rgba(255,255,255,0.75)",
    cardBorder: "rgba(251,207,232,0.9)",
    cardShadow: "0 4px 14px rgba(219,39,119,0.10)",
    numberBadgeBackground: "linear-gradient(to bottom right, #f472b6, #4ade80)",
    numberBadgeText: "#ffffff",
    timeColor: "#db2777",
    bandNameColor: "#831843",
    setlistColor: "#a3697f",
    setlistItalic: true,
    syncBadge: { bg: "#ecfdf5", border: "#86efac", text: "#166534" },
    keyBadge: { bg: "#fdf2f8", border: "#fbcfe8", text: "#9d174d" },
    breakBorder: "#f472b6",
    breakBg: "#f9a8d4",
    breakText: "#831843",
    footerColor: "#c893ab",
  },
  rainy: {
    id: "rainy",
    name: "Rainy Season",
    subtitle: "梅雨の紫陽花ブルー×パープルで少し切ないムード",
    pageBackground: "linear-gradient(to bottom, #eef2f9, #dde6f2, #cdd9ea)",
    glowSpots: [
      { background: "rgba(129,140,248,0.20)", top: "-6rem", right: "-6rem", size: 340 },
      { background: "rgba(167,139,250,0.18)", bottom: "-6rem", left: "-6rem", size: 300 },
    ],
    kickerColor: "rgba(79,70,229,0.7)",
    dayTitleGradient: "linear-gradient(to right, #4c1d95, #6d28d9, #1e3a8a)",
    dayTitleColor: "#312e6b",
    dateColor: "#5b5f8a",
    dividerBackground: "linear-gradient(to right, transparent, rgba(124,58,237,0.5), transparent)",
    cardBg: "rgba(255,255,255,0.6)",
    cardBorder: "rgba(165,180,252,0.5)",
    cardShadow: "0 4px 14px rgba(67,56,202,0.10)",
    numberBadgeBackground: "linear-gradient(to bottom right, #818cf8, #7c3aed)",
    numberBadgeText: "#ffffff",
    timeColor: "#5b21b6",
    bandNameColor: "#1e1b4b",
    setlistColor: "#64699e",
    setlistItalic: true,
    syncBadge: { bg: "#eef2ff", border: "#c7d2fe", text: "#3730a3" },
    keyBadge: { bg: "#f3e8ff", border: "#e9d5ff", text: "#6b21a8" },
    breakBorder: "#7c3aed",
    breakBg: "#ddd6fe",
    breakText: "#3730a3",
    footerColor: "#9498c2",
  },
  summer: {
    id: "summer",
    name: "Summer Fest",
    subtitle: "夏合宿の海ブルー×向日葵イエローで元気いっぱい",
    pageBackground: "linear-gradient(to bottom, #0ea5e9, #0284c7, #0369a1)",
    glowSpots: [
      { background: "rgba(250,204,21,0.35)", top: "-6rem", right: "-4rem", size: 360 },
      { background: "rgba(255,255,255,0.15)", bottom: "-8rem", left: "-6rem", size: 320 },
    ],
    kickerColor: "rgba(254,240,138,0.9)",
    dayTitleGradient: "linear-gradient(to right, #fde047, #ffffff, #facc15)",
    dayTitleColor: "#fef9c3",
    dateColor: "#e0f2fe",
    dividerBackground: "linear-gradient(to right, transparent, rgba(250,204,21,0.7), transparent)",
    cardBg: "rgba(255,255,255,0.12)",
    cardBorder: "rgba(255,255,255,0.25)",
    cardShadow: "none",
    numberBadgeBackground: "linear-gradient(to bottom right, #facc15, #fb923c)",
    numberBadgeText: "#7c2d12",
    timeColor: "#fde047",
    bandNameColor: "#ffffff",
    setlistColor: "#bae6fd",
    setlistItalic: true,
    syncBadge: { bg: "rgba(250,204,21,0.18)", border: "rgba(250,204,21,0.5)", text: "#fef08a" },
    keyBadge: { bg: "rgba(255,255,255,0.15)", border: "rgba(255,255,255,0.4)", text: "#ffffff" },
    breakBorder: "#facc15",
    breakBg: "#fef9c3",
    breakText: "#78350f",
    footerColor: "rgba(224,242,254,0.7)",
  },
  autumn: {
    id: "autumn",
    name: "Autumn / Acoustic",
    subtitle: "秋の夜長、暖色系のアコースティックな雰囲気",
    pageBackground: "linear-gradient(to bottom, #2b1608, #4a2410, #2b1608)",
    glowSpots: [
      { background: "rgba(251,146,60,0.22)", top: "-6rem", left: "-6rem", size: 340 },
      { background: "rgba(180,83,9,0.25)", bottom: "-6rem", right: "-6rem", size: 300 },
    ],
    kickerColor: "rgba(253,186,116,0.8)",
    dayTitleGradient: "linear-gradient(to right, #fb923c, #fef3c7, #f97316)",
    dayTitleColor: "#fed7aa",
    dateColor: "#e7c9a9",
    dividerBackground: "linear-gradient(to right, transparent, rgba(251,146,60,0.6), transparent)",
    cardBg: "rgba(255,237,213,0.06)",
    cardBorder: "rgba(253,186,116,0.25)",
    cardShadow: "none",
    numberBadgeBackground: "linear-gradient(to bottom right, #f97316, #b45309)",
    numberBadgeText: "#fff7ed",
    timeColor: "#fdba74",
    bandNameColor: "#fff7ed",
    setlistColor: "#d6b394",
    setlistItalic: true,
    syncBadge: { bg: "rgba(251,146,60,0.15)", border: "rgba(253,186,116,0.4)", text: "#fed7aa" },
    keyBadge: { bg: "rgba(217,119,6,0.15)", border: "rgba(217,119,6,0.4)", text: "#fdba74" },
    breakBorder: "#78350f",
    breakBg: "#fed7aa",
    breakText: "#7c2d12",
    footerColor: "#a8846a",
  },
  halloween: {
    id: "halloween",
    name: "Halloween",
    subtitle: "オレンジ×ダークパープルのハロウィン、視認性も◎",
    pageBackground: "linear-gradient(to bottom, #1a0b2e, #2d1b4e, #1a0b2e)",
    glowSpots: [
      { background: "rgba(249,115,22,0.28)", top: "-6rem", right: "-6rem", size: 340 },
      { background: "rgba(147,51,234,0.25)", bottom: "-8rem", left: "-6rem", size: 320 },
    ],
    kickerColor: "rgba(251,146,60,0.85)",
    dayTitleGradient: "linear-gradient(to right, #f97316, #eab308, #f97316)",
    dayTitleColor: "#fed7aa",
    dateColor: "#c4b5fd",
    dividerBackground: "linear-gradient(to right, transparent, rgba(249,115,22,0.6), transparent)",
    cardBg: "rgba(147,51,234,0.08)",
    cardBorder: "rgba(249,115,22,0.3)",
    cardShadow: "none",
    numberBadgeBackground: "linear-gradient(to bottom right, #f97316, #7e22ce)",
    numberBadgeText: "#fff7ed",
    timeColor: "#fb923c",
    bandNameColor: "#fff7ed",
    setlistColor: "#c4b0e0",
    setlistItalic: true,
    syncBadge: { bg: "rgba(249,115,22,0.15)", border: "rgba(249,115,22,0.4)", text: "#fed7aa" },
    keyBadge: { bg: "rgba(168,85,247,0.15)", border: "rgba(168,85,247,0.4)", text: "#e9d5ff" },
    breakBorder: "#eab308",
    breakBg: "#fb923c",
    breakText: "#2d0f4e",
    footerColor: "#a78bda",
  },
  schoolfest: {
    id: "schoolfest",
    name: "School Fest",
    subtitle: "学祭本番！カラフルで賑やかなお祭りムード",
    pageBackground: "linear-gradient(135deg, #ef4444, #f97316, #eab308)",
    glowSpots: [
      { background: "rgba(255,255,255,0.25)", top: "-6rem", left: "-4rem", size: 320 },
      { background: "rgba(255,255,255,0.18)", bottom: "-6rem", right: "-6rem", size: 300 },
    ],
    kickerColor: "rgba(255,255,255,0.9)",
    dayTitleGradient: null,
    dayTitleColor: "#ffffff",
    dateColor: "#fff7ed",
    dividerBackground: "linear-gradient(to right, transparent, rgba(255,255,255,0.8), transparent)",
    cardBg: "rgba(255,255,255,0.92)",
    cardBorder: "rgba(255,255,255,0.6)",
    cardShadow: "0 6px 18px rgba(127,29,29,0.25)",
    numberBadgeBackground: "linear-gradient(to bottom right, #ef4444, #eab308)",
    numberBadgeText: "#ffffff",
    timeColor: "#dc2626",
    bandNameColor: "#7c2d12",
    setlistColor: "#92400e",
    setlistItalic: false,
    syncBadge: { bg: "#fef3c7", border: "#fcd34d", text: "#92400e" },
    keyBadge: { bg: "#dbeafe", border: "#93c5fd", text: "#1e40af" },
    breakBorder: "#dc2626",
    breakBg: "#fef08a",
    breakText: "#7c2d12",
    footerColor: "#78350f",
  },
  christmas: {
    id: "christmas",
    name: "Christmas",
    subtitle: "赤×緑×スノーホワイトの温かいクリスマス",
    pageBackground: "linear-gradient(to bottom, #0b3d24, #0f4a2c, #0b3d24)",
    glowSpots: [
      { background: "rgba(250,204,21,0.22)", top: "-6rem", left: "-6rem", size: 340 },
      { background: "rgba(220,38,38,0.20)", bottom: "-6rem", right: "-6rem", size: 300 },
    ],
    kickerColor: "rgba(254,226,226,0.85)",
    dayTitleGradient: "linear-gradient(to right, #fca5a5, #ffffff, #fca5a5)",
    dayTitleColor: "#fee2e2",
    dateColor: "#d1fae5",
    dividerBackground: "linear-gradient(to right, transparent, rgba(250,204,21,0.7), transparent)",
    cardBg: "rgba(255,255,255,0.07)",
    cardBorder: "rgba(250,204,21,0.25)",
    cardShadow: "none",
    numberBadgeBackground: "linear-gradient(to bottom right, #dc2626, #16a34a)",
    numberBadgeText: "#ffffff",
    timeColor: "#fbbf24",
    bandNameColor: "#ffffff",
    setlistColor: "#a7d8b8",
    setlistItalic: true,
    syncBadge: { bg: "rgba(220,38,38,0.18)", border: "rgba(248,113,113,0.4)", text: "#fecaca" },
    keyBadge: { bg: "rgba(250,204,21,0.18)", border: "rgba(250,204,21,0.4)", text: "#fef08a" },
    breakBorder: "#dc2626",
    breakBg: "#fef2f2",
    breakText: "#7f1d1d",
    footerColor: "#a7d8b8",
  },
  winter: {
    id: "winter",
    name: "Winter",
    subtitle: "冬らしい澄んだアイスブルーでクリスプに",
    pageBackground: "linear-gradient(to bottom, #f0f9ff, #e0f2fe, #cffafe)",
    glowSpots: [
      { background: "rgba(56,189,248,0.20)", top: "-6rem", right: "-6rem", size: 340 },
      { background: "rgba(255,255,255,0.5)", bottom: "-6rem", left: "-6rem", size: 300 },
    ],
    kickerColor: "rgba(2,132,199,0.75)",
    dayTitleGradient: "linear-gradient(to right, #0284c7, #38bdf8, #0284c7)",
    dayTitleColor: "#0c4a6e",
    dateColor: "#3b6f8f",
    dividerBackground: "linear-gradient(to right, transparent, rgba(56,189,248,0.6), transparent)",
    cardBg: "rgba(255,255,255,0.75)",
    cardBorder: "rgba(186,230,253,0.9)",
    cardShadow: "0 4px 14px rgba(2,132,199,0.10)",
    numberBadgeBackground: "linear-gradient(to bottom right, #38bdf8, #0284c7)",
    numberBadgeText: "#ffffff",
    timeColor: "#0284c7",
    bandNameColor: "#0c4a6e",
    setlistColor: "#5b8aa6",
    setlistItalic: false,
    syncBadge: { bg: "#f0f9ff", border: "#bae6fd", text: "#075985" },
    keyBadge: { bg: "#f8fafc", border: "#cbd5e1", text: "#475569" },
    breakBorder: "#0284c7",
    breakBg: "#bae6fd",
    breakText: "#0c4a6e",
    footerColor: "#94b8cc",
  },
  graduation: {
    id: "graduation",
    name: "Retirement / Graduation",
    subtitle: "引退ライブに贈る、星空とサンセットの映画風エレガンス",
    pageBackground: "linear-gradient(to bottom, #0f1729, #1a2744, #0f1729)",
    glowSpots: [
      { background: "rgba(251,191,36,0.18)", top: "-6rem", right: "-4rem", size: 300 },
      { background: "rgba(244,114,182,0.14)", bottom: "-8rem", left: "-6rem", size: 340 },
    ],
    kickerColor: "rgba(253,224,71,0.75)",
    dayTitleGradient: "linear-gradient(to right, #fb923c, #fde68a, #f472b6)",
    dayTitleColor: "#fef3c7",
    dateColor: "#cbd5e1",
    dividerBackground: "linear-gradient(to right, transparent, rgba(251,191,36,0.6), transparent)",
    cardBg: "rgba(255,255,255,0.05)",
    cardBorder: "rgba(251,191,36,0.2)",
    cardShadow: "none",
    numberBadgeBackground: "linear-gradient(to bottom right, #fb923c, #f472b6)",
    numberBadgeText: "#1e1b4b",
    timeColor: "#fde68a",
    bandNameColor: "#ffffff",
    setlistColor: "#a8b3cc",
    setlistItalic: true,
    syncBadge: { bg: "rgba(251,191,36,0.12)", border: "rgba(251,191,36,0.35)", text: "#fde68a" },
    keyBadge: { bg: "rgba(244,114,182,0.12)", border: "rgba(244,114,182,0.35)", text: "#fbcfe8" },
    breakBorder: "#fbbf24",
    breakBg: "#fef3c7",
    breakText: "#78350f",
    footerColor: "#7c88a8",
  },
  minimal: {
    id: "minimal",
    name: "Minimal",
    subtitle: "色を極力使わないモノクロ・ミニマルデザイン",
    pageBackground: "#f4f4f5",
    glowSpots: [],
    kickerColor: "#71717a",
    dayTitleGradient: null,
    dayTitleColor: "#18181b",
    dateColor: "#52525b",
    dividerBackground: "#d4d4d8",
    cardBg: "#ffffff",
    cardBorder: "#e4e4e7",
    cardShadow: "none",
    numberBadgeBackground: "#18181b",
    numberBadgeText: "#ffffff",
    timeColor: "#3f3f46",
    bandNameColor: "#18181b",
    setlistColor: "#71717a",
    setlistItalic: false,
    syncBadge: { bg: "#f4f4f5", border: "#a1a1aa", text: "#27272a" },
    keyBadge: { bg: "#e4e4e7", border: "#a1a1aa", text: "#27272a" },
    breakBorder: "#18181b",
    breakBg: "#e4e4e7",
    breakText: "#18181b",
    footerColor: "#a1a1aa",
  },
  metal: {
    id: "metal",
    name: "Metal / Gothic",
    subtitle: "漆黒×深紅×シルバーのハイコントラストなハードコア",
    pageBackground: "linear-gradient(to bottom, #09090b, #171717, #09090b)",
    glowSpots: [
      { background: "rgba(220,38,38,0.22)", top: "-6rem", right: "-6rem", size: 340 },
      { background: "rgba(115,115,115,0.12)", bottom: "-8rem", left: "-6rem", size: 300 },
    ],
    kickerColor: "rgba(248,113,113,0.85)",
    dayTitleGradient: "linear-gradient(to right, #dc2626, #f4f4f5, #dc2626)",
    dayTitleColor: "#f4f4f5",
    dateColor: "#a3a3a3",
    dividerBackground: "linear-gradient(to right, transparent, rgba(220,38,38,0.7), transparent)",
    cardBg: "rgba(220,38,38,0.05)",
    cardBorder: "rgba(220,38,38,0.3)",
    cardShadow: "none",
    numberBadgeBackground: "linear-gradient(to bottom right, #7f1d1d, #dc2626)",
    numberBadgeText: "#f4f4f5",
    timeColor: "#f87171",
    bandNameColor: "#f4f4f5",
    setlistColor: "#a3a3a3",
    setlistItalic: false,
    syncBadge: { bg: "rgba(220,38,38,0.15)", border: "rgba(220,38,38,0.4)", text: "#fca5a5" },
    keyBadge: { bg: "rgba(115,115,115,0.15)", border: "rgba(163,163,163,0.4)", text: "#d4d4d4" },
    breakBorder: "#dc2626",
    breakBg: "#d4d4d4",
    breakText: "#0a0a0a",
    footerColor: "#525252",
  },
  pop: {
    id: "pop",
    name: "Pop",
    subtitle: "パステルグラデーション×丸ゴシックで元気にポップ",
    pageBackground: "linear-gradient(135deg, #fbcfe8, #bfdbfe, #fef08a)",
    glowSpots: [
      { background: "rgba(244,114,182,0.30)", top: "-6rem", left: "-6rem", size: 340 },
      { background: "rgba(96,165,250,0.25)", bottom: "-6rem", right: "-6rem", size: 320 },
    ],
    kickerColor: "rgba(219,39,119,0.85)",
    dayTitleGradient: "linear-gradient(to right, #ec4899, #8b5cf6, #3b82f6)",
    dayTitleColor: "#831843",
    dateColor: "#7c3aed",
    dividerBackground: "linear-gradient(to right, transparent, rgba(236,72,153,0.6), transparent)",
    cardBg: "rgba(255,255,255,0.85)",
    cardBorder: "rgba(251,207,232,0.9)",
    cardShadow: "0 4px 14px rgba(219,39,119,0.12)",
    numberBadgeBackground: "linear-gradient(to bottom right, #f472b6, #a78bfa)",
    numberBadgeText: "#ffffff",
    timeColor: "#db2777",
    bandNameColor: "#581c87",
    setlistColor: "#7c3aed",
    setlistItalic: false,
    syncBadge: { bg: "#fce7f3", border: "#f9a8d4", text: "#9d174d" },
    keyBadge: { bg: "#ede9fe", border: "#c4b5fd", text: "#5b21b6" },
    breakBorder: "#f472b6",
    breakBg: "#fef08a",
    breakText: "#831843",
    footerColor: "#a78bda",
  },
  jazz: {
    id: "jazz",
    name: "Jazz",
    subtitle: "ネイビー×ワインレッドの上品でミニマルな大人ムード",
    pageBackground: "linear-gradient(to bottom, #0f1115, #1a1420, #0f1115)",
    glowSpots: [
      { background: "rgba(124,45,58,0.28)", top: "-6rem", right: "-4rem", size: 320 },
      { background: "rgba(184,147,95,0.14)", bottom: "-8rem", left: "-6rem", size: 300 },
    ],
    kickerColor: "rgba(184,147,95,0.8)",
    dayTitleGradient: "linear-gradient(to right, #7c2d3a, #b8935f, #7c2d3a)",
    dayTitleColor: "#e8dcc8",
    dateColor: "#9c8f7e",
    dividerBackground: "linear-gradient(to right, transparent, rgba(184,147,95,0.5), transparent)",
    cardBg: "rgba(184,147,95,0.06)",
    cardBorder: "rgba(184,147,95,0.2)",
    cardShadow: "none",
    numberBadgeBackground: "linear-gradient(to bottom right, #7c2d3a, #4a3728)",
    numberBadgeText: "#e8dcc8",
    timeColor: "#c9a876",
    bandNameColor: "#e8dcc8",
    setlistColor: "#9c8f7e",
    setlistItalic: true,
    syncBadge: { bg: "rgba(124,45,58,0.18)", border: "rgba(184,110,120,0.4)", text: "#dba8ae" },
    keyBadge: { bg: "rgba(184,147,95,0.15)", border: "rgba(184,147,95,0.4)", text: "#d4bd94" },
    breakBorder: "#b8935f",
    breakBg: "#d4bd94",
    breakText: "#2a1810",
    footerColor: "#6b6255",
  },
  instruments: {
    id: "instruments",
    name: "Band Instruments",
    subtitle: "楽器のラインアート透かし入り、チャコール×ステージ照明",
    pageBackground: "linear-gradient(to bottom, #18181b, #27272a, #18181b)",
    glowSpots: [
      { background: "rgba(251,191,36,0.20)", top: "-6rem", left: "-6rem", size: 340 },
      { background: "rgba(251,191,36,0.10)", bottom: "-6rem", right: "-6rem", size: 300 },
    ],
    kickerColor: "rgba(251,191,36,0.8)",
    dayTitleGradient: "linear-gradient(to right, #fbbf24, #f4f4f5, #fbbf24)",
    dayTitleColor: "#f4f4f5",
    dateColor: "#a1a1aa",
    dividerBackground: "linear-gradient(to right, transparent, rgba(251,191,36,0.6), transparent)",
    cardBg: "rgba(255,255,255,0.05)",
    cardBorder: "rgba(251,191,36,0.2)",
    cardShadow: "none",
    numberBadgeBackground: "linear-gradient(to bottom right, #fbbf24, #78350f)",
    numberBadgeText: "#18181b",
    timeColor: "#fbbf24",
    bandNameColor: "#f4f4f5",
    setlistColor: "#a1a1aa",
    setlistItalic: false,
    syncBadge: { bg: "rgba(251,191,36,0.15)", border: "rgba(251,191,36,0.4)", text: "#fde68a" },
    keyBadge: { bg: "rgba(161,161,170,0.15)", border: "rgba(161,161,170,0.4)", text: "#d4d4d8" },
    breakBorder: "#fbbf24",
    breakBg: "#fde68a",
    breakText: "#3f2d0a",
    footerColor: "#71717a",
    watermarkPattern: INSTRUMENTS_WATERMARK,
  },
};

export type SetlistPalette = {
  pageBackground: string;
  kicker: string;
  title: string;
  subtitle: string;
  headerBg: string;
  headerText: string;
  rowBorder: string;
  zebra: string;
  bandName: string;
  song: string;
  memberName: string;
  chipBg: string;
  chipText: string;
  orderBadgeBg: string;
  orderBadgeText: string;
  watermarkPattern?: string;
  /** Solid (non-gradient) approximation of pageBackground, safe to use
   * anywhere a real CSS gradient can't be — e.g. filling a jsPDF page rect
   * behind a captured page image that's shorter than the full A4 height. */
  pageFillSolid: string;
};

function isLightHex(hex: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

// Derives the Setlist export's color roles from a ShareTheme instead of
// maintaining a second, parallel palette per theme — a new theme only ever
// gets defined once (above) and both exports pick it up automatically,
// which is also what keeps them looking like the same visual identity
// rather than two independently-themed documents. zebra striping has no
// dedicated field: whether bandNameColor reads light-on-dark tells us which
// direction a subtle row overlay needs to go to stay visible against that
// theme's own page background, computed rather than hand-tuned per theme.
export function getSetlistPalette(theme: ShareTheme): SetlistPalette {
  const dark = isLightHex(theme.bandNameColor);
  return {
    pageBackground: theme.pageBackground,
    kicker: theme.kickerColor,
    title: theme.dayTitleColor,
    subtitle: theme.dateColor,
    headerBg: theme.numberBadgeBackground,
    headerText: theme.numberBadgeText,
    rowBorder: theme.cardBorder,
    zebra: dark ? "rgba(255,255,255,0.045)" : "rgba(15,23,42,0.035)",
    bandName: theme.bandNameColor,
    song: theme.setlistColor,
    memberName: theme.bandNameColor,
    chipBg: theme.syncBadge.bg,
    chipText: theme.syncBadge.text,
    orderBadgeBg: theme.numberBadgeBackground,
    orderBadgeText: theme.numberBadgeText,
    watermarkPattern: theme.watermarkPattern,
    pageFillSolid: dark ? "#111112" : "#ffffff",
  };
}
