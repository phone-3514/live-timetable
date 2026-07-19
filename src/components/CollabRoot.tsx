import { useEffect, useState } from "react";
import { useCollabRoom } from "../hooks/useCollabRoom";
import { useLivePresence } from "../hooks/useLivePresence";
import { useCollabStore } from "../store/useCollabStore";
import { useIsMobile } from "../hooks/useViewport";
import { useToastStore } from "../store/useToastStore";
import { CollabControls } from "./CollabControls";
import { LiveCursors } from "./LiveCursors";
import { NicknameEntryModal } from "./NicknameEntryModal";
import { PasswordGate } from "./PasswordGate";
import { readStoredNickname, clearStoredNickname } from "../utils/nickname";
import { readRoomAuthFlag, clearRoomAuthFlag } from "../utils/roomAuth";
import { readAdminAuthFlag, clearAdminAuthFlag } from "../utils/adminAuth";
import { saveKickedBackupAndWipe } from "../utils/backup";

// The single lazy-loaded entry point for every part of the real-time
// collaboration feature (Firestore room sync + RTDB presence/cursors) —
// see App.tsx, which React.lazy()-imports this whole module so the
// firebase SDK it pulls in never reaches the main bundle for visitors
// who never touch collaboration. Owns the one useCollabRoom instance
// (CollabControls takes its result as props rather than calling the hook
// itself, to avoid a second redundant Firestore subscription).
export function CollabRoot() {
  console.log("[CollabRoot] 4. Mounting collaboration UI");

  // No VITE_ROOM_PASSWORD configured at all means the gate is disabled
  // outright — collaboration behaves exactly as it did before this
  // feature existed, so deploying without setting this new env var
  // doesn't lock anyone out (see the last two rounds' "a new required env
  // var silently broke production" incidents — same trap, avoided here).
  const isPasswordRequired = Boolean(import.meta.env.VITE_ROOM_PASSWORD);
  const [passwordVerified, setPasswordVerified] = useState(() => readRoomAuthFlag());
  const isAuthenticated = !isPasswordRequired || passwordVerified;

  const { roomId, status, startRoom, leaveRoom } = useCollabRoom(isAuthenticated);
  const [nickname, setNickname] = useState<string | null>(() => readStoredNickname());
  // Same sessionStorage-flag pattern as passwordVerified above — see
  // adminAuth.ts for the security caveat (this is a UI-only courtesy
  // gate, not enforced access control).
  const [isAdmin, setIsAdminState] = useState(() => readAdminAuthFlag());
  // Own viewport, not any other collaborator's — a floating cursor
  // reproduces a POSITION on the sender's screen, which has no meaning on
  // a layout shaped completely differently (mobile's accordion list vs.
  // desktop's grid). SlotCard's element-id-based hover badge (see
  // useHoveringUsers) is what mobile viewers get instead.
  const isMobile = useIsMobile();

  useEffect(() => {
    console.log("[CollabRoot] 5. Nickname check — roomId:", roomId, "authenticated:", isAuthenticated, "nickname:", nickname);
    useCollabStore.getState().setNickname(isAuthenticated ? nickname : null);
  }, [nickname, roomId, isAuthenticated]);

  useEffect(() => {
    useCollabStore.getState().setIsAdmin(isAuthenticated ? isAdmin : false);
  }, [isAdmin, isAuthenticated]);

  // Withholding the nickname (rather than roomId) while ungated is what
  // keeps useLivePresence's own internal guard (`!roomId || !nickname ||
  // !rtdb`) from ever connecting to RTDB before the password succeeds —
  // roomId itself is allowed to be set the moment "共同編集を開始" is
  // clicked (see startRoom below), same reasoning as useCollabRoom's own
  // `path` gate.
  const { kickUser } = useLivePresence(roomId, isAuthenticated ? nickname : null);

  // Subscribed reactively (not read via .getState() inside the effect
  // below) specifically so this effect's dependency array actually fires
  // the instant useLivePresence flips the flag, rather than only
  // happening to run on whatever render occurs next for some unrelated
  // reason.
  const kicked = useCollabStore((s) => s.kicked);

  // Reacts to useLivePresence noticing `forceKick: true` on this exact
  // client's own presence node (see useCollabStore.ts's `kicked` flag
  // comment for why the detection and the reaction live in different
  // files). Runs once per kick: back up + wipe the local app state,
  // leave the room, and clear every session flag (nickname, room auth,
  // admin auth) so rejoining ANY room — this one or a different one —
  // starts completely fresh rather than silently reusing the identity
  // that was just removed. The `kicked` flag itself is reset at the end
  // so this effect doesn't re-fire until the NEXT kick.
  useEffect(() => {
    if (!kicked) return;
    console.log("[CollabRoot] Kicked by an admin — wiping state and returning to the entry form");
    saveKickedBackupAndWipe();
    leaveRoom();
    clearStoredNickname();
    clearRoomAuthFlag();
    clearAdminAuthFlag();
    setNickname(null);
    setPasswordVerified(false);
    setIsAdminState(false);
    useCollabStore.getState().setKicked(false);
    useToastStore
      .getState()
      .show("管理者によってルームから退出させられました。作業内容はバックアップファイルとして保存されています", "info");
  }, [kicked, leaveRoom]);

  // roomId becomes non-null the instant a room is requested — either
  // ?room=<id> was already in the URL on load, or startRoom() below just
  // set it — and neither of those paths touches Firebase by itself (see
  // useCollabRoom's `path` gate). So "a room is requested but not
  // authenticated yet" is exactly the signal to show the gate instead of
  // any collaboration UI, covering both starting and joining uniformly.
  const needsPasswordGate = roomId !== null && !isAuthenticated;
  if (needsPasswordGate) {
    return (
      <PasswordGate
        onSuccess={(enteredNickname, enteredIsAdmin) => {
          setPasswordVerified(true);
          setNickname(enteredNickname);
          setIsAdminState(enteredIsAdmin);
        }}
        onCancel={leaveRoom}
      />
    );
  }

  // Reachable only once authenticated (or no password was ever required)
  // — this is genuinely the first point where Firestore/RTDB traffic can
  // occur, satisfying "no data fetching before authentication."
  const needsNickname = roomId !== null && nickname === null;

  return (
    <>
      <CollabControls
        roomId={roomId}
        status={status}
        startRoom={startRoom}
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
