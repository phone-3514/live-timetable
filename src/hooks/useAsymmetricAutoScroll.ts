import { useCallback, useRef } from "react";
import type { DragMoveEvent, DragStartEvent } from "@dnd-kit/core";

const INTERVAL_MS = 5;

// A drag picked up right at the edge of the visible zone (e.g. the last
// row on screen) starts inside the auto-scroll trigger area with zero
// actual movement yet — without a dead zone, that immediately scrolls
// the moment the drag activates, before the user has expressed any
// intent to move toward that edge at all. dnd-kit's own built-in
// autoScroll has an equivalent guard (`useScrollIntent`, gating on
// `delta` direction) that this custom implementation didn't originally
// replicate — this is that same guard, in the simplest form that fits
// here: net vertical movement since drag start must exceed this many
// pixels, in the matching direction, before that edge's auto-scroll is
// allowed to engage.
const DEAD_ZONE_PX = 12;

type Options = {
  enabled: boolean;
  topThreshold: number;
  bottomThreshold: number;
  acceleration: number;
};

function readClientY(native: Event | undefined): number {
  if (!native) return 0;
  if (native instanceof MouseEvent || native instanceof PointerEvent) return native.clientY;
  if (native instanceof TouchEvent) return native.touches[0]?.clientY ?? 0;
  return 0;
}

// dnd-kit's own `autoScroll` prop only accepts one `threshold.y` fraction
// applied identically to both the top and bottom edges of the scroll
// container (see getScrollDirectionAndSpeed in @dnd-kit/core's source —
// there is no per-edge option). Mobile wants a bigger top zone (so
// scrolling up during a long drag toward an earlier slot kicks in well
// before the finger reaches the very top of the screen) while leaving the
// bottom zone exactly as previously tuned, so this replaces dnd-kit's
// built-in auto-scroll on mobile entirely rather than trying to configure
// around the limitation. The scroll formula and 5ms poll cadence below are
// copied from that same source (`speed = acceleration * depthIntoZone`,
// `setInterval(tick, 5)`) specifically so the bottom zone's feel is
// unchanged — only the top zone (and the dead zone below) are new.
export function useAsymmetricAutoScroll({ enabled, topThreshold, bottomThreshold, acceleration }: Options) {
  const pointerYRef = useRef<number | null>(null);
  const initialPointerYRef = useRef(0);
  const deltaYRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopScrolling = useCallback(() => {
    if (intervalRef.current != null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    if (!enabled || pointerYRef.current == null) return;
    const container = document.getElementById("root");
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const topZoneHeight = rect.height * topThreshold;
    const bottomZoneHeight = rect.height * bottomThreshold;
    const y = pointerYRef.current;

    let speed = 0;
    if (y <= rect.top + topZoneHeight && deltaYRef.current < -DEAD_ZONE_PX) {
      const depth = Math.min(1, Math.max(0, (rect.top + topZoneHeight - y) / topZoneHeight));
      speed = -acceleration * depth;
    } else if (y >= rect.bottom - bottomZoneHeight && deltaYRef.current > DEAD_ZONE_PX) {
      const depth = Math.min(1, Math.max(0, (y - (rect.bottom - bottomZoneHeight)) / bottomZoneHeight));
      speed = acceleration * depth;
    }

    if (speed !== 0) container.scrollBy(0, speed);
  }, [enabled, topThreshold, bottomThreshold, acceleration]);

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      if (!enabled) return;
      const clientY = readClientY(event.activatorEvent);
      initialPointerYRef.current = clientY;
      pointerYRef.current = clientY;
      deltaYRef.current = 0;
      stopScrolling();
      intervalRef.current = setInterval(tick, INTERVAL_MS);
    },
    [enabled, stopScrolling, tick],
  );

  const onDragMove = useCallback(
    (event: DragMoveEvent) => {
      if (!enabled) return;
      deltaYRef.current = event.delta.y;
      pointerYRef.current = initialPointerYRef.current + event.delta.y;
    },
    [enabled],
  );

  const onDragEnd = useCallback(() => {
    pointerYRef.current = null;
    deltaYRef.current = 0;
    stopScrolling();
  }, [stopScrolling]);

  return { onDragStart, onDragMove, onDragEnd, onDragCancel: onDragEnd };
}
