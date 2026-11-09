import { create } from "zustand";
import type { Application, ApplicationMember } from "../types";

// 申請を編集 ダイアログの「いま編集中」の状態。以前はダイアログの開閉と書きかけの
// 内容を、申請一覧の各行(EditApplicationButton)の React state に持っていたため、
// 行が一覧から消える・作り直される(共同編集の同期で applications が丸ごと入れ替
// わる、画面幅の切替、並び替え・絞り込みなど)たびに、ダイアログごと保存前の内容
// が消えていた。ここ(行の外)に持てば、行がどうなってもダイアログと書きかけの内容
// は残る。

export type MemberDraft = { name: string; part: string; grade: string; frameOrdinal: string };

export type ApplicationEditDraft = {
  bandName: string;
  applicantName: string;
  duration: string;
  hasSync: boolean;
  members: MemberDraft[];
  setlist: string;
  desired: string;
  reasonNote: string;
};

function memberToDraft(m: ApplicationMember): MemberDraft {
  return {
    name: m.name,
    part: m.part,
    grade: m.grade,
    frameOrdinal: m.frameOrdinal != null ? String(m.frameOrdinal) : "",
  };
}

export function draftFromApplication(app: Application): ApplicationEditDraft {
  return {
    bandName: app.bandName,
    applicantName: app.applicantName,
    duration: app.durationMinutes != null ? String(app.durationMinutes) : "",
    hasSync: app.hasSync,
    members: app.members.map(memberToDraft),
    setlist: app.setlist.map((s) => (s.artist ? `${s.title} / ${s.artist}` : s.title)).join("\n"),
    desired: app.desiredDateTime,
    reasonNote: app.timeReasonNote ?? "",
  };
}

type EditingState = {
  /** 開いた時点の申請。一覧から消えても、これで書きかけの内容を保てる。 */
  snapshot: Application;
  /** 書きかけの内容。まだ何も触っていなければ null。 */
  draft: ApplicationEditDraft | null;
};

type State = {
  editing: EditingState | null;
  open: (app: Application) => void;
  setDraft: (draft: ApplicationEditDraft) => void;
  close: () => void;
};

export const useApplicationEditStore = create<State>()((set) => ({
  editing: null,
  open: (app) => set({ editing: { snapshot: app, draft: null } }),
  setDraft: (draft) => set((s) => (s.editing ? { editing: { ...s.editing, draft } } : s)),
  close: () => set({ editing: null }),
}));
