import { doc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { PublicPamphletDoc } from "./types";

const scheduledTimers = new Map<string, number>();
const writeChains = new Map<string, Promise<void>>();

function enqueueWrite(roomId: string, createDocument: () => PublicPamphletDoc): Promise<void> {
  if (!db) return Promise.reject(new Error("Firestore is unavailable"));
  const firestore = db;
  const previous = writeChains.get(roomId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => setDoc(doc(firestore, "publicPamphlets", roomId), createDocument()));
  writeChains.set(roomId, next);
  void next.then(
    () => { if (writeChains.get(roomId) === next) writeChains.delete(roomId); },
    () => { if (writeChains.get(roomId) === next) writeChains.delete(roomId); },
  );
  return next;
}

export function cancelScheduledPublicPamphletPublish(roomId: string) {
  const timer = scheduledTimers.get(roomId);
  if (timer === undefined) return;
  window.clearTimeout(timer);
  scheduledTimers.delete(roomId);
}

export function schedulePublicPamphletPublish(
  roomId: string,
  createDocument: () => PublicPamphletDoc,
  delayMs = 200,
) {
  cancelScheduledPublicPamphletPublish(roomId);
  const timer = window.setTimeout(() => {
    scheduledTimers.delete(roomId);
    void enqueueWrite(roomId, createDocument).catch((error) =>
      console.error("[publicPamphletPublisher] automatic publish failed", error),
    );
  }, delayMs);
  scheduledTimers.set(roomId, timer);
}

export function publishPublicPamphletNow(
  roomId: string,
  createDocument: () => PublicPamphletDoc,
): Promise<void> {
  cancelScheduledPublicPamphletPublish(roomId);
  return enqueueWrite(roomId, createDocument);
}
