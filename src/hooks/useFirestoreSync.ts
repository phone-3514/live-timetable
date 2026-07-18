import { useCallback, useEffect, useRef, useState } from "react";
import { doc, onSnapshot, setDoc, type DocumentData } from "firebase/firestore";
import { db } from "../firebase";

export type SyncStatus = "offline" | "connecting" | "synced" | "error";

// Debounces trailing writes per document path — a Map (not a single
// timer) so an in-flight drag on "timetable/day-1" doesn't cancel or get
// cancelled by an unrelated pending write to "bands/b3". Collapsing N
// rapid updates (e.g. every pointermove during a drag-and-drop) into one
// write after `delayMs` of quiet is the whole point: on the free tier's
// 20k writes/day cap, undebounced writes are the thing that would
// actually threaten the budget — a single band move firing 30+ writes
// as it crosses slots is 30x the cost of the one write that actually
// matters (the drop).
function useDebouncedWriter(delayMs: number) {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const schedule = useCallback(
    (key: string, run: () => void) => {
      const existing = timers.current.get(key);
      if (existing) clearTimeout(existing);
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          run();
        }, delayMs),
      );
    },
    [delayMs],
  );

  // Bypasses the debounce entirely — for moments that should commit
  // right away (e.g. the pointerup that ends a drag) rather than waiting
  // out the full delay for no reason.
  const flush = useCallback((key: string, run: () => void) => {
    const existing = timers.current.get(key);
    if (existing) {
      clearTimeout(existing);
      timers.current.delete(key);
    }
    run();
  }, []);

  useEffect(() => {
    const timersAtMount = timers.current;
    return () => {
      for (const t of timersAtMount.values()) clearTimeout(t);
      timersAtMount.clear();
    };
  }, []);

  return { schedule, flush };
}

/**
 * Keeps one Firestore document (e.g. rooms/{roomId}/timetable/{dayId})
 * mirrored into local React state, in both directions:
 *
 * - **Real-time sync**: onSnapshot subscribes to the document, so an
 *   edit by any other collaborator in the room appears here within a
 *   couple hundred ms, no polling.
 * - **Optimistic UI**: `update()` applies the change to local state
 *   synchronously — the caller re-renders with the new value before any
 *   network request has even been sent, let alone resolved. There is no
 *   spinner-while-saving state for a normal edit.
 * - **Debounced writes**: the actual `setDoc` call is delayed by
 *   `debounceMs` and reset on every subsequent `update()` to the same
 *   path, so a burst of local changes (dragging a card across ten slots)
 *   produces one write, not ten. Call `updateNow()` instead of `update()`
 *   at the moment a gesture actually ends (e.g. onDragEnd) to commit
 *   immediately rather than waiting out the debounce window.
 *
 * `path` may be null to represent "not in a collaborative room right
 * now" — the hook simply stays on local-only `defaultValue` and never
 * touches the network, so every component using this hook still works
 * with zero Firebase setup (see isFirebaseConfigured in firebase.ts).
 */
export function useFirestoreDocSync<T extends DocumentData>(
  path: string | null,
  defaultValue: T,
  debounceMs = 600,
) {
  const [data, setData] = useState<T>(defaultValue);
  const [status, setStatus] = useState<SyncStatus>(path ? "connecting" : "offline");
  const { schedule, flush } = useDebouncedWriter(debounceMs);
  const defaultValueRef = useRef(defaultValue);
  defaultValueRef.current = defaultValue;

  useEffect(() => {
    if (!path || !db) {
      setStatus("offline");
      return;
    }
    setStatus("connecting");
    const ref = doc(db, path);
    const unsubscribe = onSnapshot(
      ref,
      { includeMetadataChanges: true },
      (snapshot) => {
        // hasPendingWrites means this snapshot is our OWN optimistic
        // write echoing back out of the local cache before the server
        // has confirmed it — local state already reflects it (set
        // synchronously in `update` below), so applying it again here
        // would be redundant at best. What we actually want this
        // branch to skip is overwriting a newer local edit with a
        // pending write that's already stale by the time it echoes.
        if (snapshot.metadata.hasPendingWrites) return;
        setData(snapshot.exists() ? (snapshot.data() as T) : defaultValueRef.current);
        setStatus("synced");
      },
      () => setStatus("error"),
    );
    return unsubscribe;
  }, [path]);

  const commit = useCallback(
    (next: T, immediate: boolean) => {
      if (!path || !db) return;
      const write = () =>
        setDoc(doc(db!, path), next, { merge: true }).catch((err) => {
          // Was a silent catch — a write failure (e.g. the
          // "Unsupported field value: undefined" class of bug; see
          // firebase.ts's ignoreUndefinedProperties comment) looked
          // identical to a successful sync from the UI's perspective:
          // the optimistic local state already showed the change, so
          // nothing appeared wrong until another collaborator asked
          // "where did my edit go." Logging it doesn't fix a write
          // failure, but it turns "silently never synced" into
          // "visibly failed," which is what actually gets bugs like
          // that reported with enough detail to fix.
          console.error(`[useFirestoreDocSync] write to ${path} failed:`, err);
          setStatus("error");
        });
      if (immediate) {
        flush(path, write);
      } else {
        schedule(path, write);
      }
    },
    [path, schedule, flush],
  );

  const update = useCallback(
    (updater: (current: T) => T) => {
      setData((current) => {
        const next = updater(current);
        commit(next, false);
        return next;
      });
    },
    [commit],
  );

  const updateNow = useCallback(
    (updater: (current: T) => T) => {
      setData((current) => {
        const next = updater(current);
        commit(next, true);
        return next;
      });
    },
    [commit],
  );

  return { data, update, updateNow, status };
}
