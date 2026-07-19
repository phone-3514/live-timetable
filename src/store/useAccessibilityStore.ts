import { create } from "zustand";
import { persist } from "zustand/middleware";

type AccessibilityState = {
  largeText: boolean;
  highContrast: boolean;
  reduceMotion: boolean;
  largeTargets: boolean;
  toggle: (key: "largeText" | "highContrast" | "reduceMotion" | "largeTargets") => void;
};

export const useAccessibilityStore = create<AccessibilityState>()(persist((set) => ({
  largeText: false,
  highContrast: false,
  reduceMotion: false,
  largeTargets: false,
  toggle: (key) => set((state) => ({ [key]: !state[key] })),
}), { name: "live-timetable-accessibility" }));
