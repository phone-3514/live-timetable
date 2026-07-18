import { useEffect, useState } from "react";

// 767px matches the `md:` breakpoint Tailwind already uses everywhere
// else in this app (DayPanel, SlotCard, App.tsx's shell) — reusing it
// here instead of picking a new number keeps "mobile" meaning the same
// thing across CSS and this JS-driven component split.
const MOBILE_QUERY = "(max-width: 767px)";

/** True below the app's existing md: breakpoint. Drives which of
 * DesktopTimetable/MobileTimetable renders (see Timetable.tsx) — a
 * matchMedia listener rather than a one-time check, so rotating a tablet
 * or resizing a window switches views live, not just on reload. */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const handleChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  return isMobile;
}
