import { useEffect, useRef } from "react";

// Native <details> elements do not close when the user clicks elsewhere.
// Header/tool menus use this hook so they behave like familiar popovers:
// interactions inside remain available, while an outside pointer press or
// Escape closes the open menu. Keeping the native element preserves its
// built-in keyboard toggle and accessible expanded/collapsed semantics.
export function useDismissibleDetails() {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function close() {
      const details = detailsRef.current;
      if (details?.open) details.open = false;
    }

    function handlePointerDown(event: PointerEvent) {
      const details = detailsRef.current;
      if (!details?.open || details.contains(event.target as Node)) return;
      close();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || !detailsRef.current?.open) return;
      event.preventDefault();
      close();
      detailsRef.current?.querySelector<HTMLElement>("summary")?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return detailsRef;
}
