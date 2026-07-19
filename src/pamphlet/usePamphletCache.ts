import { useCallback, useEffect, useRef, useState } from "react";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import type { PublicPamphletDoc } from "./types";

const CACHE_PREFIX = "live-timetable-pamphlet-cache-";

type CacheEntry = { doc: PublicPamphletDoc; cachedAt: number };

function readCache(circleId: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + circleId);
    return raw ? (JSON.parse(raw) as CacheEntry) : null;
  } catch {
    return null;
  }
}

function writeCache(circleId: string, publicDoc: PublicPamphletDoc) {
  try {
    localStorage.setItem(CACHE_PREFIX + circleId, JSON.stringify({ doc: publicDoc, cachedAt: Date.now() }));
  } catch {
    // Storage full or unavailable (private browsing) — the fetched data
    // still renders for this session, it just won't be there next visit.
  }
}

export type PamphletLoadState = "loading" | "loaded" | "not-found" | "error";

// Cached data renders immediately, then one live listener receives only
// published timetable/progress corrections. This changed from a one-shot
// read because stage-control adjustments must reach performer and venue
// screens without asking every viewer to press refresh. Admin typing still
// stays private; only explicit publish/progress actions update this doc.
export function usePamphletCache(circleId: string) {
  const initialCache = useRef(readCache(circleId));
  const [data, setData] = useState<PublicPamphletDoc | null>(initialCache.current?.doc ?? null);
  const [cachedAt, setCachedAt] = useState<number | null>(initialCache.current?.cachedAt ?? null);
  const [state, setState] = useState<PamphletLoadState>(initialCache.current ? "loaded" : "loading");
  const [refreshing, setRefreshing] = useState(false);

  const fetchOnce = useCallback(
    async (isManualRefresh: boolean) => {
      if (!db) {
        setState((prev) => (prev === "loaded" ? prev : "error"));
        return;
      }
      if (isManualRefresh) setRefreshing(true);
      try {
        const snapshot = await getDoc(doc(db, "publicPamphlets", circleId));
        if (!snapshot.exists()) {
          setState((prev) => (prev === "loaded" ? prev : "not-found"));
          return;
        }
        const publicDoc = snapshot.data() as PublicPamphletDoc;
        setData(publicDoc);
        setCachedAt(Date.now());
        writeCache(circleId, publicDoc);
        setState("loaded");
      } catch (err) {
        console.error("[usePamphletCache] fetch failed:", err);
        setState((prev) => (prev === "loaded" ? prev : "error"));
      } finally {
        setRefreshing(false);
      }
    },
    [circleId],
  );

  useEffect(() => {
    if (!db) {
      setState((previous) => previous === "loaded" ? previous : "error");
      return;
    }
    return onSnapshot(doc(db, "publicPamphlets", circleId), (snapshot) => {
      if (!snapshot.exists()) {
        setState((previous) => previous === "loaded" ? previous : "not-found");
        return;
      }
      const publicDoc = snapshot.data() as PublicPamphletDoc;
      setData(publicDoc);
      setCachedAt(Date.now());
      writeCache(circleId, publicDoc);
      setState("loaded");
    }, (error) => {
      console.error("[usePamphletCache] live listener failed:", error);
      setState((previous) => previous === "loaded" ? previous : "error");
    });
  }, [circleId]);

  return { data, state, cachedAt, refreshing, refresh: () => fetchOnce(true) };
}
