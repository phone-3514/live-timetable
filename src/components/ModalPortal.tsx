import { createPortal } from "react-dom";
import type { ReactNode } from "react";

// Every modal in this app is `position: fixed`, which normally sizes and
// positions itself against the viewport — but `backdrop-filter` (along
// with `filter`, `transform`, `will-change`, and `contain`) on ANY
// ancestor element creates a NEW containing block for fixed-position
// descendants in modern browsers. This app's own <header> carries
// `backdrop-blur-md` for its glassmorphism look, and <CollabRoot/> (which
// renders PasswordGate/NicknameEntryModal/the kick-confirm dialog) is
// mounted inside that header — so those modals' `fixed inset-0` was
// sizing against the ~60px-tall header box instead of the actual
// viewport, which is the literal, confirmed cause of "the nickname modal
// is stuck at the top of the screen" (reproduced directly: outer dialog
// box height 52px, form rendered at y=-156, at a completely ordinary
// 1440×900 viewport — not an edge case).
//
// Rendering every modal through this portal into document.body fixes the
// whole bug CLASS permanently, not just this one instance: no matter
// what CSS property some future change adds to some ancestor (this
// header, or any other container), a portaled modal's containing block
// stays the true viewport, because it's no longer a DOM descendant of
// that ancestor at all. `document.body` itself carries no
// transform/filter/backdrop-filter (confirmed via index.css), so it's a
// safe, stable portal target.
export function ModalPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
