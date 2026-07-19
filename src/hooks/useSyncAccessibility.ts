import { useEffect } from "react";
import { useAccessibilityStore } from "../store/useAccessibilityStore";

export function useSyncAccessibility() {
  const settings = useAccessibilityStore();
  useEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute("data-large-text", settings.largeText);
    root.toggleAttribute("data-high-contrast", settings.highContrast);
    root.toggleAttribute("data-reduce-motion", settings.reduceMotion);
    root.toggleAttribute("data-large-targets", settings.largeTargets);
  }, [settings.largeText, settings.highContrast, settings.reduceMotion, settings.largeTargets]);
}
