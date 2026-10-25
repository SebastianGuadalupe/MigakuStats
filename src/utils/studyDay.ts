export const STUDY_ROLLOVER_HOUR = 4;
const DAY_IN_MS = 86400000;
const EPOCH = Date.UTC(2020, 0, 1);

/** Calendar label for the study day containing now (local 04:00 to 04:00). */
export function getStudyDate(now: Date = new Date()): Date {
  const date = new Date(now);
  if (date.getHours() < STUDY_ROLLOVER_HOUR) date.setDate(date.getDate() - 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

/** Convert a calendar label, without applying the rollover a second time. */
export function getChartDayNumber(date: Date): number {
  return Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - EPOCH) / DAY_IN_MS);
}

export function getNextStudyRollover(now: Date = new Date()): Date {
  const next = new Date(now);
  next.setHours(STUDY_ROLLOVER_HOUR, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}
