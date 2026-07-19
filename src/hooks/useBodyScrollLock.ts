import { useEffect } from "react";

// Every full-screen modal in this app already traps focus visually via
// its own `fixed inset-0` backdrop, but nothing stopped the page
// *underneath* it from still scrolling. index.css sets `overflow-y:
// auto` on `html`, `body`, AND `#root` together below the md: breakpoint
// (the mobile "let the page scroll" override of the desktop no-scroll
// app shell) — but `html`/`body` themselves never actually grow taller
// than the viewport in this app (only `#root`'s content does), so
// `#root` is the element that's ACTUALLY scrolling on mobile, not
// `body`. Locking only `body.style.overflow` (an earlier version of
// this hook did exactly that) has no visible effect for that reason —
// confirmed by comparing `document.documentElement.scrollHeight`
// (equals viewport height) against `#root`'s (taller) with enough
// seeded content to overflow. Locking all three, matching the exact
// trio index.css already targets together, is what actually stops the
// scroll regardless of which of them happens to be the real container
// at a given breakpoint.
//
// Setting these as *inline* styles (not classes) is deliberate: an
// inline `style.overflow` always wins over index.css's media-query rule
// regardless of viewport width, and capturing+restoring whatever was
// there before means closing this modal hands control back to that rule
// exactly as it was — including the case where a second modal is
// already open underneath this one (each mount captures its own
// snapshot, so as long as modals close in the reverse order they opened
// — the normal case — restoring is correctly nested).
export function useBodyScrollLock() {
  useEffect(() => {
    const targets = [document.documentElement, document.body, document.getElementById("root")].filter(
      (el): el is HTMLElement => el !== null,
    );
    const previousOverflow = targets.map((el) => el.style.overflow);
    targets.forEach((el) => {
      el.style.overflow = "hidden";
    });
    return () => {
      targets.forEach((el, i) => {
        el.style.overflow = previousOverflow[i];
      });
    };
  }, []);
}
