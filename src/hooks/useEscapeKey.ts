import { useEffect } from "react";

// Every full-screen overlay in this app (SharePreviewModal, HistoryPanel,
// PlacedBandDetailModal, ...) calls this with its own dismiss callback, so
// each mounted overlay owns exactly one listener — attached on mount, torn
// down on unmount — and Escape closes whichever of them are actually open
// with no shared "which modal is active" state to keep in sync. A ref-free
// callback dependency is intentional: callers pass an inline arrow most of
// the time, so the effect re-subscribing on every render (cheap for a
// single keydown listener) is preferable to demanding every caller wrap
// their callback in useCallback just to satisfy this hook.
export function useEscapeKey(onEscape: () => void) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onEscape();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onEscape]);
}
