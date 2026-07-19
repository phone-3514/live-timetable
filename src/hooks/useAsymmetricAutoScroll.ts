import { useCallback, useEffect, useRef } from "react";
import type { DragMoveEvent, DragStartEvent } from "@dnd-kit/core";

const INTERVAL_MS = 16;

type Options = {
  enabled: boolean;
  activeZoneRatio?: number;
  scrollStep?: number;
};

type ScrollDirection = -1 | 0 | 1;

function getDraggedItemCenterY(event: DragMoveEvent): number | null {
  const rect = event.active.rect.current.translated;
  return rect ? rect.top + rect.height / 2 : null;
}

/** Mobile auto-scroll driven only by the dragged item's viewport position. */
export function useAsymmetricAutoScroll({
  enabled,
  activeZoneRatio = 0.2,
  scrollStep = 4,
}: Options) {
  const directionRef = useRef<ScrollDirection>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopScrolling = useCallback(() => {
    directionRef.current = 0;
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startScrolling = useCallback(
    (direction: Exclude<ScrollDirection, 0>) => {
      if (directionRef.current === direction && intervalRef.current !== null) return;

      stopScrolling();
      directionRef.current = direction;
      intervalRef.current = setInterval(() => {
        const container = document.getElementById("root");
        if (!container) {
          stopScrolling();
          return;
        }

        const previousScrollTop = container.scrollTop;
        container.scrollBy({ top: directionRef.current * scrollStep, behavior: "auto" });

        // Do not leave an interval running when the viewport edge is reached.
        if (container.scrollTop === previousScrollTop) stopScrolling();
      }, INTERVAL_MS);
    },
    [scrollStep, stopScrolling],
  );

  const onDragStart = useCallback(
    (_event: DragStartEvent) => {
      if (enabled) stopScrolling();
    },
    [enabled, stopScrolling],
  );

  const onDragMove = useCallback(
    (event: DragMoveEvent) => {
      if (!enabled) return;

      const itemCenterY = getDraggedItemCenterY(event);
      const container = document.getElementById("root");
      if (itemCenterY === null || !container) {
        stopScrolling();
        return;
      }

      const viewport = container.getBoundingClientRect();
      const zoneHeight = viewport.height * activeZoneRatio;
      const topBoundary = viewport.top + zoneHeight;
      const bottomBoundary = viewport.bottom - zoneHeight;

      if (itemCenterY < topBoundary) {
        startScrolling(-1);
      } else if (itemCenterY > bottomBoundary) {
        startScrolling(1);
      } else {
        // The centre 60% is the dead zone: tear down the timer immediately.
        stopScrolling();
      }
    },
    [activeZoneRatio, enabled, startScrolling, stopScrolling],
  );

  const onDragEnd = useCallback(() => {
    stopScrolling();
  }, [stopScrolling]);

  useEffect(() => stopScrolling, [stopScrolling]);

  return { onDragStart, onDragMove, onDragEnd, onDragCancel: onDragEnd };
}
