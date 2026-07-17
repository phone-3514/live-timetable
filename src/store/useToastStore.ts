import { create } from "zustand";

export type ToastTone = "success" | "info" | "error";

type ToastState = {
  message: string | null;
  tone: ToastTone;
  show: (message: string, tone?: ToastTone) => void;
  clear: () => void;
};

// Generic one-at-a-time notification, separate from DeleteUndoToast (which
// carries its own undo action and dismiss timer tied to store state) — this
// one is for plain fire-and-forget confirmations like "backup restored" or
// "N applications imported" from anywhere in the app.
export const useToastStore = create<ToastState>((set) => ({
  message: null,
  tone: "info",
  show: (message, tone = "info") => set({ message, tone }),
  clear: () => set({ message: null }),
}));
