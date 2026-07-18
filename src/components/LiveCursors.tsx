import { useAppStore } from "../store/useAppStore";
import { useCollabStore } from "../store/useCollabStore";

// A small fixed palette keyed by a cheap hash of clientId — not
// meaningful identity, just enough visual variety that two simultaneous
// cursors don't look identical.
const CURSOR_COLORS = ["#f43f5e", "#f59e0b", "#22c55e", "#06b6d4", "#8b5cf6", "#ec4899"];

function colorForClientId(clientId: string): string {
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) hash = (hash * 31 + clientId.charCodeAt(i)) >>> 0;
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}

// Renders every other connected collaborator's live cursor as a
// fixed-position overlay (coordinates are viewport-relative — see
// useLivePresence's use of clientX/clientY — so this intentionally
// doesn't try to reconcile different collaborators' scroll positions or
// window sizes; it's "where their pointer is on their screen," a
// reasonable approximation for a small team on similar-sized laptops,
// not a pixel-perfect shared canvas). pointer-events-none throughout so
// this overlay never intercepts the local user's own clicks/drags.
export function LiveCursors() {
  const others = useCollabStore((s) => s.others);
  const bands = useAppStore((s) => s.bands);

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      {others
        .filter((o) => o.cursor !== null)
        .map((o) => {
          const color = colorForClientId(o.clientId);
          // "Attached to their cursor" — while o is dragging a band, its
          // name rides along with their pointer, the closest a
          // viewport-relative cursor overlay (see the module comment)
          // can get to a literal shared drag ghost.
          const draggedBandName = o.isDragging
            ? bands.find((b) => b.id === o.draggedBandId)?.name
            : null;
          return (
            <div
              key={o.clientId}
              className="absolute transition-[left,top] duration-100 ease-out"
              style={{ left: o.cursor!.x, top: o.cursor!.y }}
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
  );
}
