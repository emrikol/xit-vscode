/**
 * Due dates, and whether they have passed.
 *
 * Kept free of the `vscode` module so it can be unit tested, like checkbox.ts.
 *
 * This is the one part of highlighting a grammar cannot do, because it needs
 * to know what today is. Everything structural stays in the TextMate grammar;
 * this exists only to answer "has that date gone by".
 *
 * The regular expression below is a second implementation of a rule the
 * grammar already has, and VS Code offers no way to read TextMate tokens from
 * an extension, so there is no shared source to be had. The duplication is
 * therefore not avoided but detected: test/dueDate.test.mjs runs the
 * conformance corpus through both this and the grammar and fails if they
 * disagree about a single character.
 */

import { STATUS_CLASS } from './checkbox';

/** A local calendar day, as YYYYMMDD, which compares correctly as a number. */
export type Day = number;

export interface DueDate {
	/** Offset of the whole `-> …` token on its line. */
	start: number;
	end: number;
	/** The text matched, including the `-> ` prefix. */
	text: string;
	/**
	 * The last day of the period the date names.
	 *
	 * Spec §Due Date allows a day, a month, a week, a quarter or a year. Only
	 * one of those is a single day, so "overdue" cannot mean "before today"
	 * without deciding when each period ends first. `-> 2026` is not overdue
	 * in March 2026; it is overdue on 1 January 2027.
	 */
	endOfPeriod: Day;
	/**
	 * The date as written, in pieces.
	 *
	 * Kept because a repeating item has to advance the date without changing
	 * what kind of date it is: `-> 2026-01` repeated monthly is `-> 2026-02`,
	 * a month, not some day in February. endOfPeriod cannot answer that - it
	 * flattens every pattern to a single day on purpose.
	 */
	parts: Parts;
}

/** A due date as written: whichever of the five patterns it used. */
export interface Parts {
	year: number;
	month?: number;
	date?: number;
	week?: number;
	quarter?: number;
	/** `-` or `/`, whichever the date used. The spec allows either, not both. */
	separator: string;
}

/** A due date written back out, `-> ` included. */
export function renderDueDate(parts: Parts): string {
	const gap = parts.separator;
	const pad = (value: number) => String(value).padStart(2, '0');

	if (parts.date !== undefined) return `-> ${parts.year}${gap}${pad(parts.month!)}${gap}${pad(parts.date)}`;
	if (parts.month !== undefined) return `-> ${parts.year}${gap}${pad(parts.month)}`;
	if (parts.week !== undefined) return `-> ${parts.year}${gap}W${pad(parts.week)}`;
	if (parts.quarter !== undefined) return `-> ${parts.year}${gap}Q${parts.quarter}`;
	return `-> ${parts.year}`;
}

/**
 * Mirrors the `due-date` rule in syntaxes/xit.tmLanguage.json.
 *
 * It matches the same language, not the same characters. The grammar numbers
 * its groups and refers back to the separator as `\5`; this names them, which
 * is worth the divergence in shape because the numbering there is a trap —
 * the group around the day captures `-31`, separator included, so reading the
 * day out of it by index gives the wrong answer in a way that still looks
 * plausible. That the two accept exactly the same text is not asserted by
 * eye: test/dueDate.test.mjs runs the whole conformance corpus through both.
 *
 * The parts that must not drift are the two lookbehinds, which reject
 * `Due-> 2026-01-31` and `---> 2026-01-31`, and the back-reference, which
 * stops a date mixing `-` and `/` separators.
 */
const DUE_DATE = new RegExp(
	'(?<![^\\s\\p{P}])(?<![-/])'
	+ '-> (?<year>\\d{4})'
	+ '(?:(?<sep>[-/])(?:'
	+ '(?<month>0[1-9]|1[0-2])(?:\\k<sep>(?<date>0[1-9]|[1-2]\\d|3[0-1]))?'
	+ '|W(?<week>0[1-9]|[1-4]\\d|5[0-3])'
	+ '|Q(?<quarter>[1-4])'
	+ '))?'
	+ '(?![-/])(?=[\\p{P} ]|$)',
	'gu',
);

/**
 * A line that continues the item above it.
 *
 * Spec §Description says four spaces. Any indentation is accepted here,
 * because with subtasks the depth varies and what this needs to know is only
 * which item a date belongs to - the nearest checkbox above it. A blank line
 * still ends the item, as the spec requires.
 */
const CONTINUATION = /^[^\S\n]+(?=.*\S)/;

/**
 * A checkbox, indented or not. A subtask starts an item of its own, which is
 * what stops its due date being read as a second date belonging to its parent
 * and disregarded.
 *
 * The status set comes from checkbox.ts rather than being written out again.
 * It was repeated here to keep the module standalone, and standalone was not
 * worth what it cost: the set was spelled out in eleven places with nothing
 * checking they agreed.
 */
const CHECKBOX = new RegExp(`^[^\\S\\n]*\\[[${STATUS_CLASS}]\\](?=[^\\S\\n]|$)`);

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function lastDayOfMonth(year: number, month: number): number {
	return month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
}

function day(year: number, month: number, date: number): Day {
	return year * 10000 + month * 100 + date;
}

/**
 * The Sunday that ends ISO week `week` of `year`.
 *
 * ISO 8601 weeks start on Monday, and week 1 is the one holding the first
 * Thursday of the year — which is the same as the one holding 4 January. That
 * is why this counts from 4 January rather than from 1 January: in a year
 * starting on a Friday, 1 January is in the last week of the year before.
 *
 * Arithmetic is done in UTC on purpose. These are calendar days, not
 * instants, and doing it locally would move the answer across a date
 * boundary for anyone east or west of the machine that wrote the file.
 */
function endOfIsoWeek(year: number, week: number): Day {
	const fourth = new Date(Date.UTC(year, 0, 4));
	const weekday = fourth.getUTCDay() || 7; // getUTCDay puts Sunday at 0; ISO puts it at 7
	const sunday = new Date(Date.UTC(year, 0, 4 - weekday + week * 7));

	return day(sunday.getUTCFullYear(), sunday.getUTCMonth() + 1, sunday.getUTCDate());
}

/** The pieces of a matched due date. */
function partsOf(groups: Record<string, string | undefined>): Parts {
	return {
		year: Number(groups.year),
		month: groups.month === undefined ? undefined : Number(groups.month),
		date: groups.date === undefined ? undefined : Number(groups.date),
		week: groups.week === undefined ? undefined : Number(groups.week),
		quarter: groups.quarter === undefined ? undefined : Number(groups.quarter),
		separator: groups.sep ?? '-',
	};
}

/** The last day of the period a matched due date names. */
function endOfPeriod(groups: Record<string, string | undefined>): Day {
	const year = Number(groups.year);

	if (groups.date) {
		// The grammar accepts any day from 01 to 31 in any month, because a
		// regular expression cannot count the days in February. Clamping is
		// the sane reading of `-> 2026-02-31`: it names some day at the end of
		// February, and by the first of March it has certainly passed.
		const month = Number(groups.month);
		return day(year, month, Math.min(Number(groups.date), lastDayOfMonth(year, month)));
	}

	if (groups.month) {
		const month = Number(groups.month);
		return day(year, month, lastDayOfMonth(year, month));
	}

	if (groups.week) return endOfIsoWeek(year, Number(groups.week));

	if (groups.quarter) {
		const last = Number(groups.quarter) * 3;
		return day(year, last, lastDayOfMonth(year, last));
	}

	return day(year, 12, 31);
}

/** Every due date on a line, in order. */
export function dueDatesOn(line: string): DueDate[] {
	const found: DueDate[] = [];

	DUE_DATE.lastIndex = 0;
	for (let match = DUE_DATE.exec(line); match; match = DUE_DATE.exec(line)) {
		found.push({
			start: match.index,
			end: match.index + match[0].length,
			text: match[0],
			endOfPeriod: endOfPeriod(match.groups ?? {}),
			parts: partsOf(match.groups ?? {}),
		});
	}

	return found;
}

export interface DueDateAt extends DueDate {
	line: number;
}

/**
 * The one due date of each item, with the line it sits on.
 *
 * Spec §Description: an item may hold "one due date. (Any additional due
 * dates MUST be disregarded.)" Disregarded means across the whole item, not
 * just its first line, so this walks items rather than lines — the grammar
 * does the same thing with a begin/end rule.
 */
export function dueDates(lines: readonly string[]): DueDateAt[] {
	const found: DueDateAt[] = [];
	let inItem = false;
	let taken = false;

	for (const [index, text] of lines.entries()) {
		if (CHECKBOX.test(text)) {
			inItem = true;
			taken = false;
		} else if (!inItem || !CONTINUATION.test(text)) {
			inItem = false;
			continue;
		}

		if (taken) continue;

		const [first] = dueDatesOn(text);
		if (first) {
			found.push({ ...first, line: index });
			taken = true;
		}
	}

	return found;
}

/** Whole days from `from` to `to`, both local calendar days. */
export function daysBetween(from: Day, to: Day): number {
	const asDate = (value: Day) => Date.UTC(Math.floor(value / 10000), (Math.floor(value / 100) % 100) - 1, value % 100);
	return Math.round((asDate(to) - asDate(from)) / 86400000);
}

export interface OverdueDate extends DueDateAt {
	/** Whole days since the period ended. Always one or more. */
	daysLate: number;
}

/**
 * Due dates whose period ended before `today`, with how late each one is.
 *
 * Strictly before: a date is not overdue on the last day of its period. `->
 * 2026-01-31` is due all of 31 January and late on the first of February.
 */
export function overdue(lines: readonly string[], today: Day): OverdueDate[] {
	return dueDates(lines)
		.filter((date) => date.endOfPeriod < today)
		.map((date) => ({ ...date, daysLate: daysBetween(date.endOfPeriod, today) }));
}

/**
 * Today, as a local calendar day.
 *
 * Local rather than UTC, because a due date in a todo list means the day the
 * person reading it is having, not the day in Greenwich.
 */
export function todayFrom(now: Date): Day {
	return day(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
