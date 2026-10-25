import { expect, test } from 'bun:test';
import { getStudyDate, getChartDayNumber, getNextStudyRollover } from '../src/utils/studyDay';
for (const [year, month, day] of [[2026, 0, 1], [2026, 2, 8], [2026, 10, 1], [2024, 2, 1]]) {
  test(`04:00 boundary and calendar arithmetic: ${year}-${month+1}-${day}`, () => {
    const before = new Date(year, month, day, 3, 59, 59, 999);
    const cutoff = new Date(year, month, day, 4);
    const calendarDay = getChartDayNumber(cutoff);
    expect(getChartDayNumber(getStudyDate(before))).toBe(calendarDay - 1);
    expect(getChartDayNumber(getStudyDate(cutoff))).toBe(calendarDay);
    expect(getStudyDate(cutoff).getHours()).toBe(0);
    expect(getNextStudyRollover(before).getTime()).toBe(cutoff.getTime());
    const next = getNextStudyRollover(cutoff);
    expect(next.getHours()).toBe(4);
    expect(getChartDayNumber(next)).toBe(calendarDay + 1);
    expect(before.getHours()).toBe(3);
  });
}
