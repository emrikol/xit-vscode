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
import { Day, Parts, dueDatesOn, renderDueDate, startDatesOn } from './dueDate';
import { tagsOn } from './tag';

export type Unit = 'day' | 'weekday' | 'week' | 'month' | 'quarter' | 'year';

export interface Interval {
	unit: Unit;
	count: number;
	/**
	 * Advance from the day the item was checked rather than from its due date.
	 *
	 * The difference between rent and watering the plants. `7d` means seven
	 * days after it was due, which is right for rent and wrong for the plants:
	 * water them three days late and the next watering should be seven days
	 * from then, not four days away.
	 *
	 * Written with a leading `+`: `+7d`, `+weekly`, `+monday`.
	 *
	 * That needed a fork of its own. Spec §Tag allows only letters, digits, `_`
	 * and `-` in an unquoted value, so `#repeat=+7d` parsed as `#repeat=` with
	 * no value at all - silently, which is the format doing the very thing the
	 * Problems panel now reports elsewhere. `+` is a legal value character in
	 * this fork, and it costs nothing: no example in the conformance corpus has
	 * an unquoted `+`.
	 */
	fromCompletion: boolean;
	/** ISO weekday, 1 Monday to 7 Sunday, when the interval names a day. */
	weekday?: number;
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

/** ISO weekday numbers, for `#repeat=monday`. */
const WEEKDAYS: Record<string, number> = {
	monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7,
};

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

	// A leading `+` means "from when it was checked". Stripped first so every
	// form below can carry it: `+weekly`, `+7d`, `+monday`.
	const fromCompletion = value.startsWith('+');
	const rest = fromCompletion ? value.slice(1) : value;
	const lower = rest.toLowerCase();

	// Every weekday, skipping Saturday and Sunday. The one interval a plain
	// count cannot express, and the most common one in a working week.
	if (lower === 'weekdays') return { unit: 'weekday', count: 1, fromCompletion };

	// A named day. Advancing by a week and then landing on that weekday is
	// what "every Monday" means, and it self-corrects if the date drifts.
	const weekday = WEEKDAYS[lower];
	if (weekday) return { unit: 'week', count: 1, fromCompletion, weekday };

	const word = WORDS[lower];
	if (word) return { unit: word, count: 1, fromCompletion };

	const match = /^(\d+)([dwmqy])$/i.exec(rest);
	if (!match) return null;

	const count = Number(match[1]);
	if (count < 1) return null;

	return { unit: LETTERS[match[2].toLowerCase()], count, fromCompletion };
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
	// A named day is the next one of that name, strictly after this date -
	// not a week on and then the nearest one, which would skip a week
	// whenever the date had drifted off the named day. From a Wednesday,
	// "every Monday" means the Monday five days away, not twelve.
	if (interval.weekday !== undefined && parts.date !== undefined) {
		const shift = (interval.weekday - weekdayOf(parts) + 7) % 7;
		return addDays(parts, shift === 0 ? 7 : shift);
	}

	const next = step(parts, interval);
	return renderDueDate(next) === renderDueDate(parts)
		? step(parts, { unit: ownUnit(parts), count: 1, fromCompletion: interval.fromCompletion })
		: next;
}

/** ISO weekday of a date-precision `parts`: 1 Monday to 7 Sunday. */
function weekdayOf(parts: Parts): number {
	return new Date(Date.UTC(parts.year, parts.month! - 1, parts.date!)).getUTCDay() || 7;
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

	// Every weekday: step forward `count` days, skipping Saturday and Sunday.
	// Only a date-precision date has weekdays; anything coarser falls through
	// to its own unit below, which is what advance() does for any interval a
	// pattern cannot express.
	if (parts.date !== undefined && unit === 'weekday') {
		let moved = parts;
		for (let taken = 0; taken < count; taken += 1) {
			do {
				moved = addDays(moved, 1);
			} while (weekdayOf(moved) > 5);
		}
		return moved;
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
export function nextOccurrence(
	text: string,
	tagName: string,
	dueDate: { start: number; end: number; parts: Parts } | null,
	today?: Day,
): string | null {
	const interval = intervalOn(text, tagName);
	if (!interval) return null;

	const opened = text.replace(ANY_CHECKBOX, '[ ]');

	// An item may carry a start date and no due date. There is nothing to
	// reschedule, but the window still has to move, or the next occurrence
	// keeps a start date from the past and the tag stops meaning anything.
	if (!dueDate) return withStartMoved(opened, interval);

	// `+7d` counts from the day it was checked rather than from the due date.
	// The written pattern is kept, so a month-precision date advances from
	// this month and not from this day: the interval changes where counting
	// starts, never what the date says.
	const from = interval.fromCompletion && today !== undefined
		? atPrecisionOf(today, dueDate.parts)
		: dueDate.parts;

	const moved = renderDueDate(advance(from, interval));
	const rescheduled = opened.slice(0, dueDate.start) + moved + opened.slice(dueDate.end);

	return withStartMoved(rescheduled, interval);
}

/**
 * The start date moved by the same interval, if the item has one.
 *
 * A new occurrence is a new window. Leaving the start date where it was gave
 * the next occurrence a date from the past, so an item that should not be
 * startable until next month was startable immediately - the start date
 * silently stopped meaning anything the moment the item repeated.
 *
 * Applied after the due date, and read off the rewritten line, because moving
 * the due date changes the offsets of everything after it.
 */
function withStartMoved(text: string, interval: Interval): string {
	const [start] = startDatesOn(text);
	if (!start) return text;

	const moved = renderDueDate(advance(start.parts, interval)).replace(/^-> /, '<- ');
	return text.slice(0, start.start) + moved + text.slice(start.end);
}

/** Whichever of two same-precision dates falls later. */
function laterOf(a: Parts, b: Parts): Parts {
	const rank = (parts: Parts) => [
		parts.year,
		parts.quarter ?? parts.month ?? parts.week ?? 0,
		parts.date ?? 0,
	];

	const [first, second] = [rank(a), rank(b)];
	for (const [at, value] of first.entries()) {
		if (value !== second[at]) return value > second[at] ? a : b;
	}
	return a;
}

/**
 * `day` expressed at the same precision as `like`.
 *
 * A completion-relative repeat starts counting from today, but the date it
 * writes has to look like the one it replaces - a month stays a month.
 */
function atPrecisionOf(day: Day, like: Parts): Parts {
	const year = Math.floor(day / 10000);
	const month = Math.floor(day / 100) % 100;
	const date = day % 100;

	if (like.date !== undefined) return { ...like, year, month, date };
	if (like.month !== undefined) return { ...like, year, month };
	if (like.quarter !== undefined) return { ...like, year, quarter: Math.floor((month - 1) / 3) + 1 };
	if (like.week !== undefined) return { ...like, ...isoWeekOf(year, month, date) };
	return { ...like, year };
}

/** The ISO week-numbering year and week a date falls in. */
function isoWeekOf(year: number, month: number, date: number): { year: number; week: number } {
	// Shift to the Thursday of the same ISO week; its calendar year is the
	// week-numbering year, which is what makes late December and early
	// January come out right.
	const at = new Date(Date.UTC(year, month - 1, date));
	at.setUTCDate(at.getUTCDate() + 4 - (at.getUTCDay() || 7));

	const firstDay = Date.UTC(at.getUTCFullYear(), 0, 1);
	const week = Math.ceil(((at.getTime() - firstDay) / 86400000 + 1) / 7);

	return { year: at.getUTCFullYear(), week };
}

/**
 * `text` with its due date moved forward.
 *
 * Postponing, which is the same arithmetic as repeating pointed at a different
 * starting day. `advance` already knows how to move every pattern the format
 * has and keep the one it was written in, so a month-precision date postponed
 * by a week becomes the next month rather than a day in it.
 *
 * Counted from today rather than from the due date, because that is what
 * postponing means: "not until next week" is next week from now, not a week
 * after a deadline that has already gone by.
 *
 * An item with no due date is returned unchanged. Adding one is a defensible
 * reading of "postpone" and a bigger edit than was asked for, and the same
 * restraint an unrecognised repeat interval already shows: doing nothing beats
 * scheduling something on a date nobody chose.
 */
export function postpone(text: string, interval: Interval, today: Day): string | null {
	const [due] = dueDatesOn(text);
	if (!due) return null;

	// From today, or from the due date if that is later. Counting from today
	// alone was wrong for anything already scheduled ahead: postponing
	// `-> 2026-08-20` by a week on 31 July produced `-> 2026-08-07`, which
	// moved the deadline thirteen days *closer*. Postponing must never make an
	// item more urgent, whatever it was given.
	const from = laterOf(atPrecisionOf(today, due.parts), due.parts);
	const moved = renderDueDate(advance(from, interval));
	if (moved === due.text) return null;

	return text.slice(0, due.start) + moved + text.slice(due.end);
}
