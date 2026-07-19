import { useAppStore } from "../store/useAppStore";
import { useCollabStore } from "../store/useCollabStore";
import { ModalPortal } from "./ModalPortal";

// A small fixed palette keyed by a cheap hash of clientId — not
// meaningful identity, just enough visual variety that two simultaneous
// cursors don't look identical.
const CURSOR_COLORS = ["#f43f5e", "#f59e0b", "#22c55e", "#06b6d4", "#8b5cf6", "#ec4899"];

function colorForClientId(clientId: string): string {
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) hash = (hash * 31 + clientId.charCodeAt(i)) >>> 0;
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}

// A cursor at the very edge (xPct/yPct near 0 or 1) would render its
// nickname label partly off-screen — CSS `left`/`top` percentages have no
// concept of the label's own width, so clamp the *displayed* position
// in from the true edge. This is on top of the 0–1 clamp already applied
// at the sender in useLivePresence.ts; that one guarantees the dot itself
// is on-screen, this one keeps the label attached to it readable too.
const EDGE_MARGIN_PCT = 3;

function clampDisplayPct(pct: number): number {
  return Math.min(100 - EDGE_MARGIN_PCT, Math.max(EDGE_MARGIN_PCT, pct * 100));
}

// Renders every other connected collaborator's live cursor as a
// fixed-position overlay. Coordinates arrive as xPct/yPct — fractions of
// the SENDER's own viewport (see useLivePresence.ts) — and are rendered
// here as CSS percentages, so a desktop cursor at 60% across a 1920px
// screen lands at 60% across whatever screen is actually looking (mobile
// included), instead of the raw-pixel value landing off-screen on a
// narrower viewport. `overflow-hidden` on the wrapper is a second line of
// defense alongside the percentage clamps below: even if a value ever
// slipped past [0,1] (e.g. a stale payload from an older client), a
// `position: fixed` descendant can't expand the page's scrollable area,
// but this still stops it from visually bleeding past the viewport edge.
// pointer-events-none throughout so this overlay never intercepts the
// local user's own clicks/drags/taps.
export function LiveCursors() {
  const others = useCollabStore((s) => s.others);
  const bands = useAppStore((s) => s.bands);

  return (
    <ModalPortal>
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {others
        .filter((o) => o.cursor !== null)
        .map((o) => {
          const color = colorForClientId(o.clientId);
          // "Attached to their cursor" — while o is dragging a band, its
          // name rides along with their pointer, the closest a
          // percentage-based cursor overlay (see the module comment)
          // can get to a literal shared drag ghost.
          const draggedBandName = o.isDragging
            ? bands.find((b) => b.id === o.draggedBandId)?.name
            : null;
          const left = `${clampDisplayPct(o.cursor!.xPct)}%`;
          const top = `${clampDisplayPct(o.cursor!.yPct)}%`;
          return (
            <div
              key={o.clientId}
              className="absolute transition-[left,top] duration-100 ease-out"
              style={{ left, top }}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" className="drop-shadow">
                <path d="M2 2 L2 16 L6.5 12.5 L9.5 18.5 L12 17.2 L9 11.2 L15 11 Z" fill={color} />
              </svg>
              <span
                className="ml-3 mt-0.5 inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold text-white shadow"
                style={{ backgroundColor: color }}
              >
                {o.nickname}
              </span>
              {draggedBandName && (
                <span className="ml-3 mt-0.5 block w-max rounded border border-amber-400 bg-amber-950/90 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200 shadow">
                  🔒 {draggedBandName}
                </span>
              )}
            </div>
          );
        })}
    </div>
    </ModalPortal>
  );
}
