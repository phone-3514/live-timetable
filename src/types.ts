export type Band = {
  id: string;
  name: string;
  members: string[];
  desiredTime: string;
  ngTime: string;
  durationMinutes?: number;
  raw: string;
  parseWarning?: string;
};

export type TimetableSlot = {
  id: string;
  bandId: string | null;
  // Non-band rows (休憩・集合・リハーサルなど). null when this slot is a
  // band-performance slot (whether filled or still empty).
  customLabel: string | null;
  customDurationMinutes: number | null;
  startTime: string;
  endTime: string;
};

export type TimetableSettings = {
  startTime: string;
  performanceMinutes: number;
  transitionMinutes: number;
};
