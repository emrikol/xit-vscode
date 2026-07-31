/**
 * Calendar arithmetic, in one place.
 *
 * These two functions existed three times over - byte-identical copies in
 * dueDate.ts, diagnostics.ts and repeat.ts - each with its own `DAYS_IN_MONTH`
 * table beside it. Nothing detected that. This repo's rule is that duplication
 * which can be removed is removed, and duplication which cannot is detected;
 * this was the first kind, sitting in plain sight, and it was found by turning
 * on a compiler flag that reported the same array index three times in three
 * files.
 *
 * It matters more than tidiness. `lastDayOfMonth` is what enforces the one
 * specification MUST the grammar can never express - that `-> 2026-02-31` is
 * not a date - and three copies of a leap-year rule is three chances for one
 * of them to be wrong about the year 2100.
 *
 * Kept free of the `vscode` module, like everything else it is called from.
 */

/** Whether a year has 29 days in February. Gregorian, so 1900 is not a leap year and 2000 is. */
export function isLeapYear(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * The last day a month has.
 *
 * Written as tests rather than as a lookup table, which reads no worse and
 * removes the only part that could be indexed out of range. A month outside
 * 1-12 answers 31; every caller validates the range first, and the two that
 * parse a date reject the month before the day is ever compared.
 */
export function lastDayOfMonth(year: number, month: number): number {
	if (month === 2) return isLeapYear(year) ? 29 : 28;
	return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}
