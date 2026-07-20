import { useEffect, useState } from "react";
import { useCollabRoom } from "../hooks/useCollabRoom";
import { useLivePresence } from "../hooks/useLivePresence";
import { useCollabStore } from "../store/useCollabStore";
import { useIsMobile } from "../hooks/useViewport";
import { CollabControls } from "./CollabControls";
import { LiveCursors } from "./LiveCursors";
import { NicknameEntryModal } from "./NicknameEntryModal";
import { readStoredNickname } from "../utils/nickname";
import { readAdminAuthFlag } from "../utils/adminAuth";
import { hardWipeAndRedirect } from "../utils/hardWipe";
import { useToastStore } from "../store/useToastStore";

// The single lazy-loaded entry point for every part of the real-time
// collaboration feature (Firestore room sync + RTDB presence/cursors) —
// see App.tsx, which React.lazy()-imports this whole module so the
// firebase SDK it pulls in never reaches the main bundle for visitors
// who never touch collaboration. Owns the one useCollabRoom instance
// (CollabControls takes its result as props rather than calling the hook
// itself, to avoid a second redundant Firestore subscription).
export function CollabRoot() {
  console.log("[CollabRoot] 4. Mounting collaboration UI");

  // The organizer room code is the normal entry credential. There is no
  // additional shared room password; only the optional administrator
  // password in NicknameEntryModal remains for owner-only controls.
  const { roomId, status, startRoom, joinRoom, joinError, clearJoinError, leaveRoom } = useCollabRoom(true);
  const showToast = useToastStore((s) => s.show);
  const [nickname, setNickname] = useState<string | null>(() => readStoredNickname());
  // Tab-scoped administrator flag; see adminAuth.ts for the security
  // caveat (this is a UI-only courtesy gate, not enforced access control).
  const [isAdmin, setIsAdminState] = useState(() => readAdminAuthFlag());
  // Own viewport, not any other collaborator's — a floating cursor
  // reproduces a POSITION on the sender's screen, which has no meaning on
  // a layout shaped completely differently (mobile's accordion list vs.
  // desktop's grid). SlotCard's element-id-based hover badge (see
  // useHoveringUsers) is what mobile viewers get instead.
  const isMobile = useIsMobile();

  useEffect(() => {
    console.log("[CollabRoot] 5. Nickname check — roomId:", roomId, "nickname:", nickname);
    useCollabStore.getState().setNickname(nickname);
  }, [nickname, roomId]);

  useEffect(() => {
    useCollabStore.getState().setIsAdmin(isAdmin);
  }, [isAdmin]);

  useEffect(() => {
    if (!joinError) return;
    showToast(joinError, "error");
    clearJoinError();
  }, [joinError, showToast, clearJoinError]);

  // Withholding the nickname (rather than roomId) while ungated is what
  // keeps useLivePresence's own internal guard (`!roomId || !nickname ||
  // !rtdb`) from ever connecting to RTDB before the password succeeds —
  // roomId itself is allowed to be set the moment "共同編集を開始" is
  // clicked (see startRoom below), same reasoning as useCollabRoom's own
  // `path` gate.
  const { kickUser } = useLivePresence(roomId, nickname);

  // Subscribed reactively (not read via .getState() inside the effect
  // below) specifically so this effect's dependency array actually fires
  // the instant useLivePresence flips the flag, rather than only
  // happening to run on whatever render occurs next for some unrelated
  // reason.
  const kicked = useCollabStore((s) => s.kicked);

  // Reacts to useLivePresence noticing `forceKick: true` on this exact
  // client's own presence node (see useCollabStore.ts's `kicked` flag
  // comment for why the detection and the reaction live in different
  // files). hardWipeAndRedirect is a one-way door — it clears every
  // storage mechanism this origin has and hard-reloads the page — so
  // there's nothing left for this effect to do afterward (no leaveRoom(),
  // no individual session-flag clearing, no resetting `kicked` back to
  // false): the reload itself resets literally everything, including
  // this component's own state.
  useEffect(() => {
    if (!kicked) return;
    console.log("[CollabRoot] Kicked by an admin — wiping all local data and hard-reloading");
    void hardWipeAndRedirect();
  }, [kicked]);

  const needsNickname = roomId !== null && nickname === null;

  return (
    <>
      <CollabControls
        roomId={roomId}
        status={status}
        startRoom={startRoom}
        joinRoom={joinRoom}
        leaveRoom={leaveRoom}
        kickUser={kickUser}
      />
      {needsNickname && (
        <NicknameEntryModal
          onSubmit={(enteredNickname, enteredIsAdmin) => {
            setNickname(enteredNickname);
            setIsAdminState(enteredIsAdmin);
          }}
        />
      )}
      {roomId && nickname && !isMobile && <LiveCursors />}
    </>
  );
}
