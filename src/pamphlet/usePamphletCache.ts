import { useCallback, useEffect, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
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

// Firestore quota discipline for a route with no login/rate-limiting of
// its own: exactly one get() per page load (never an onSnapshot listener
// — a live listener billed a read for every edit an admin makes for as
// long as any audience member's tab stays open, which is the opposite of
// "1 read per user load" on a free-tier project during an hours-long
// live event). Cached data (if any) renders instantly on mount while that
// one fetch resolves in the background — a repeat visitor never sees a
// blank loading state — and the returned `refresh()` is the ONLY other
// way this ever hits the network again, for a tab left open across the
// event that wants to manually pull the latest published snapshot.
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
    void fetchOnce(false);
  }, [fetchOnce]);

  return { data, state, cachedAt, refreshing, refresh: () => fetchOnce(true) };
}
