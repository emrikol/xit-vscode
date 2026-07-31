/**
 * Repeating items, as a tag convention.
 *
 * Kept free of the `vscode` module so it can be unit tested.
 *
 * Discussion #5 asked for recurring due dates, and jotaen's open question was
 * what the status would be while an item recurs - "Would the item status stay
 * open for the entire time?" A tag answers it without touching the format:
 * the checked one stays checked, and a fresh open one appears for the next
 * occurrence.
 *
 *   [ ] Water the plants -> 2026-08-03 #repeat=weekly
 *
 * `#repeat=weekly` is already a valid tag with a valid value, so a file using
 * this still reads correctly in every other xit tool. It just will not
 * reschedule anything there.
 */

import { STATUS_CLASS } from './checkbox';
import { Parts, renderDueDate } from './dueDate';
import { tagsOn } from './tag';

export type Unit = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface Interval {
	unit: Unit;
	count: number;
}

const WORDS: Record<string, Unit> = {
	daily: 'day',
	weekly: 'week',
	monthly: 'month',
	quarterly: 'quarter',
	yearly: 'year',
	annually: 'year',
};

const LETTERS: Record<string, Unit> = { d: 'day', w: 'week', m: 'month', q: 'quarter', y: 'year' };

/**
 * The first checkbox on a line, whatever its status. Built from the status set
 * in checkbox.ts rather than written out again, so a new status reopens
 * correctly here without anyone remembering this line exists.
 */
const ANY_CHECKBOX = new RegExp(`\\[[${STATUS_CLASS}]\\]`);

/**
 * An interval, or null if the value is not one.
 *
 * Null rather than a guess, deliberately. A mistyped interval should do
 * nothing at all: scheduling something on a date nobody asked for is worse
 * than not scheduling it.
 */
export function parseInterval(value: string | null): Interval | null {
	if (!value) return null;

	const word = WORDS[value.toLowerCase()];
	if (word) return { unit: word, count: 1 };

	const match = /^(\d+)([dwmqy])$/i.exec(value);
	if (!match) return null;

	const count = Number(match[1]);
	if (count < 1) return null;

	return { unit: LETTERS[match[2].toLowerCase()], count };
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function lastDayOfMonth(year: number, month: number): number {
	return month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
}

/**
 * How many ISO weeks a year has: 52, or 53 when it starts on a Thursday, or on
 * a Wednesday in a leap year.
 */
function weeksInYear(year: number): number {
	const first = new Date(Date.UTC(year, 0, 1)).getUTCDay();
	return first === 4 || (isLeapYear(year) && first === 3) ? 53 : 52;
}

function addMonths(parts: Parts, months: number): Parts {
	const total = (parts.year * 12) + (parts.month! - 1) + months;
	const year = Math.floor(total / 12);
	const month = (total % 12) + 1;

	// Clamped, so 31 January plus a month is the end of February rather than
	// spilling into March.
	const date = parts.date === undefined ? undefined : Math.min(parts.date, lastDayOfMonth(year, month));

	return { ...parts, year, month, date };
}

function addDays(parts: Parts, days: number): Parts {
	const moved = new Date(Date.UTC(parts.year, parts.month! - 1, parts.date!) + days * 86400000);
	return {
		...parts,
		year: moved.getUTCFullYear(),
		month: moved.getUTCMonth() + 1,
		date: moved.getUTCDate(),
	};
}

function addWeeks(parts: Parts, weeks: number): Parts {
	let year = parts.year;
	let week = parts.week! + weeks;

	while (week > weeksInYear(year)) {
		week -= weeksInYear(year);
		year += 1;
	}

	return { ...parts, year, week };
}

/**
 * The next occurrence of a due date.
 *
 * The date keeps whichever of the five patterns it was written in, so a month
 * stays a month. Where the interval and the pattern do not line up - a
 * month-precision date repeated weekly - the interval cannot be expressed, so
 * it advances by one unit of its own precision instead. Anything else would
 * render the same text and repeat for ever on the same date.
 */
export function advance(parts: Parts, interval: Interval): Parts {
	const next = step(parts, interval);
	return renderDueDate(next) === renderDueDate(parts) ? step(parts, { unit: ownUnit(parts), count: 1 }) : next;
}

/** The unit a date is written in, which is the smallest step it can take. */
function ownUnit(parts: Parts): Unit {
	if (parts.date !== undefined) return 'day';
	if (parts.month !== undefined) return 'month';
	if (parts.week !== undefined) return 'week';
	if (parts.quarter !== undefined) return 'quarter';
	return 'year';
}

function step(parts: Parts, { unit, count }: Interval): Parts {
	// A week-precision date only moves in weeks; nothing else is expressible.
	if (parts.week !== undefined) {
		const weeks = unit === 'week' ? count
			: unit === 'month' ? count * 4
			: unit === 'quarter' ? count * 13
			: unit === 'year' ? count * 52
			: 0;
		return addWeeks(parts, weeks || Math.max(1, Math.round(count / 7)));
	}

	if (parts.quarter !== undefined) {
		const quarters = unit === 'quarter' ? count
			: unit === 'year' ? count * 4
			: unit === 'month' ? Math.round(count / 3)
			: 0;
		const total = (parts.year * 4) + (parts.quarter - 1) + quarters;
		return { ...parts, year: Math.floor(total / 4), quarter: (total % 4) + 1 };
	}

	if (parts.date !== undefined && (unit === 'day' || unit === 'week')) {
		return addDays(parts, unit === 'day' ? count : count * 7);
	}

	if (parts.month !== undefined) {
		const months = unit === 'month' ? count
			: unit === 'quarter' ? count * 3
			: unit === 'year' ? count * 12
			: 0;
		return addMonths(parts, months);
	}

	// Year only.
	const years = unit === 'year' ? count : 0;
	return { ...parts, year: parts.year + years };
}

/** The repeat interval on a line, if it has one. */
export function intervalOn(text: string, tagName: string): Interval | null {
	const key = tagName.toLowerCase();
	const tag = tagsOn(text).find((found) => found.key === key);
	return tag ? parseInterval(tag.value) : null;
}

/**
 * The line to insert after `text` when a repeating item is checked.
 *
 * The new item is open, keeps the indentation - so a repeating subtask stays a
 * subtask - and carries the description, the tags and the advanced date.
 * Returns null when there is nothing to repeat.
 */
export function nextOccurrence(text: string, tagName: string, dueDate: { start: number; end: number; parts: Parts } | null): string | null {
	const interval = intervalOn(text, tagName);
	if (!interval) return null;

	const opened = text.replace(ANY_CHECKBOX, '[ ]');
	if (!dueDate) return opened;

	const moved = renderDueDate(advance(dueDate.parts, interval));
	return opened.slice(0, dueDate.start) + moved + opened.slice(dueDate.end);
}
