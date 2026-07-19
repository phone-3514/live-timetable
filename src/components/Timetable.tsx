import { useIsMobile } from "../hooks/useViewport";
import { DesktopTimetable } from "./DesktopTimetable";
import { MobileTimetable } from "./MobileTimetable";
import { StageControlPanel } from "./StageControlPanel";

// Pure presentation switch — no state, no Firebase, no store reads of its
// own. All of that (bands/days/eventInfo via useAppStore, applications via
// useApplicationStore, live cursors/locks via useCollabStore, and the
// actual Firestore/RTDB wiring in useCollabRoom/useLivePresence) lives
// either directly in the two view components below or, for collaboration,
// entirely outside this tree in CollabRoot (mounted separately in
// App.tsx). That's what lets DesktopTimetable and MobileTimetable render
// the exact same real-time data without either duplicating how it's
// fetched or synced.
export function Timetable() {
  const isMobile = useIsMobile();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <StageControlPanel />
      {isMobile ? <MobileTimetable /> : <DesktopTimetable />}
    </div>
  );
}
