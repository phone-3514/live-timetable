import { useEffect, useState } from "react";
import { useCollabRoom } from "../hooks/useCollabRoom";
import { useLivePresence } from "../hooks/useLivePresence";
import { useCollabStore } from "../store/useCollabStore";
import { CollabControls } from "./CollabControls";
import { LiveCursors } from "./LiveCursors";
import { NicknameEntryModal } from "./NicknameEntryModal";
import { readStoredNickname } from "../utils/nickname";

// The single lazy-loaded entry point for every part of the real-time
// collaboration feature (Firestore room sync + RTDB presence/cursors) —
// see App.tsx, which React.lazy()-imports this whole module so the
// firebase SDK it pulls in never reaches the main bundle for visitors
// who never touch collaboration. Owns the one useCollabRoom instance
// (CollabControls takes its result as props rather than calling the hook
// itself, to avoid a second redundant Firestore subscription) and decides
// when a nickname is actually needed: only once a room is active and this
// browser tab hasn't already picked one (see NicknameEntryModal — the
// modal is scoped to "joining a room," not to every app load, so
// ordinary local-only use is completely unaffected).
export function CollabRoot() {
  console.log("[CollabRoot] 4. Mounting collaboration UI");
  const { roomId, status, startRoom, leaveRoom } = useCollabRoom();
  const [nickname, setNickname] = useState<string | null>(() => readStoredNickname());

  useEffect(() => {
    console.log("[CollabRoot] 5. Nickname check — roomId:", roomId, "nickname:", nickname);
    useCollabStore.getState().setNickname(nickname);
  }, [nickname, roomId]);

  useLivePresence(roomId, nickname);

  const needsNickname = roomId !== null && nickname === null;

  return (
    <>
      <CollabControls roomId={roomId} status={status} startRoom={startRoom} leaveRoom={leaveRoom} />
      {needsNickname && <NicknameEntryModal onSubmit={setNickname} />}
      {roomId && nickname && <LiveCursors />}
    </>
  );
}
