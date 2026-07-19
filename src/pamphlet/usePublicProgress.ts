import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import type { StageProgress } from "../store/useProgressStore";

export function usePublicProgress(circleId: string) {
  const [progress, setProgress] = useState<StageProgress | null>(null);
  useEffect(() => {
    if (!db) return;
    return onSnapshot(doc(db, "publicProgress", circleId), (snapshot) => {
      setProgress(snapshot.exists() ? (snapshot.data() as StageProgress) : null);
    }, (error) => console.error("[publicProgress] live update failed", error));
  }, [circleId]);
  return progress;
}
