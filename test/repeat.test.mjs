/**
 * Repeating items.
 *
 * Discussion #5, answered with a tag convention rather than new syntax:
 * `#repeat=weekly` is already a valid tag with a valid value, so a file using
 * it still reads correctly in every other xit tool.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { parseInterval, advance, nextOccurrence } = require_('../out/repeat.js');
const { dueDatesOn, renderDueDate } = require_('../out/dueDate.js');
const { tagsOn } = require_('../out/tag.js');

/** The next occurrence of a whole item line. */
function next(line, today) {
	const [due] = dueDatesOn(line);
	return nextOccurrence(line, 'repeat', due ?? null, today);
}

/** Advance just the date part of `text`, for the arithmetic tests. */
function moved(text, interval) {
	const [due] = dueDatesOn(`[ ] x ${text}`);
	return renderDueDate(advance(due.parts, parseInterval(interval)));
}

describe('parsing an interval', () => {
	it('takes the plain words', () => {
		assert.deepEqual(parseInterval('daily'), { unit: 'day', count: 1, fromCompletion: false });
		assert.deepEqual(parseInterval('weekly'), { unit: 'week', count: 1, fromCompletion: false });
		assert.deepEqual(parseInterval('monthly'), { unit: 'month', count: 1, fromCompletion: false });
		assert.deepEqual(parseInterval('quarterly'), { unit: 'quarter', count: 1, fromCompletion: false });
		assert.deepEqual(parseInterval('yearly'), { unit: 'year', count: 1, fromCompletion: false });
	});

	it('takes a count and a letter', () => {
		assert.deepEqual(parseInterval('3d'), { unit: 'day', count: 3, fromCompletion: false });
		assert.deepEqual(parseInterval('2w'), { unit: 'week', count: 2, fromCompletion: false });
		assert.deepEqual(parseInterval('6m'), { unit: 'month', count: 6, fromCompletion: false });
	});

	it('is not case sensitive about the word', () => {
		assert.deepEqual(parseInterval('Weekly'), { unit: 'week', count: 1, fromCompletion: false });
		assert.deepEqual(parseInterval('2W'), { unit: 'week', count: 2, fromCompletion: false });
	});

	it('refuses anything else rather than guessing', () => {
		// A mistyped interval must do nothing. Scheduling something on a date
		// nobody asked for is worse than not scheduling it.
		for (const value of ['sometimes', 'fortnightly', '0d', '-1w', 'w', '3', '3x', '', null]) {
			assert.equal(parseInterval(value), null, JSON.stringify(value));
		}
	});
});

describe('the new interval forms', () => {
	it('takes an -after suffix, meaning from the day it was checked', () => {
		// A leading `+` would read better and is not available: spec §Tag
		// allows only letters, digits, `_` and `-` in an unquoted value, so
		// `#repeat=+7d` parses as `#repeat=` with no value at all, silently.
		assert.deepEqual(parseInterval('7d-after'), { unit: 'day', count: 7, fromCompletion: true });
		assert.deepEqual(parseInterval('weekly-after'), { unit: 'week', count: 1, fromCompletion: true });
		assert.deepEqual(parseInterval('monday-after'), { unit: 'week', count: 1, fromCompletion: true, weekday: 1 });
	});

	it('is a legal unquoted tag value, which a plus is not', () => {
		// The reason for the suffix, asserted rather than trusted.
		assert.equal(tagsOn('[x] W #repeat=7d-after')[0].value, '7d-after');
		assert.equal(tagsOn('[x] W #repeat=+7d')[0].value, null, 'a plus is silently dropped');
	});

	it('takes every weekday', () => {
		assert.deepEqual(parseInterval('weekdays'), { unit: 'weekday', count: 1, fromCompletion: false });
	});

	it('takes a named day', () => {
		assert.deepEqual(parseInterval('monday'), { unit: 'week', count: 1, fromCompletion: false, weekday: 1 });
		assert.deepEqual(parseInterval('Sunday'), { unit: 'week', count: 1, fromCompletion: false, weekday: 7 });
	});

	it('still refuses what it does not understand', () => {
		for (const value of ['-after', 'sometimes-after', 'someday', 'weekday', '0d-after']) {
			assert.equal(parseInterval(value), null, JSON.stringify(value));
		}
	});
});

describe('every weekday', () => {
	it('skips the weekend', () => {
		// 2026-08-07 is a Friday, so the next weekday is Monday the 10th.
		assert.equal(moved('-> 2026-08-07', 'weekdays'), '-> 2026-08-10');
		assert.equal(moved('-> 2026-08-10', 'weekdays'), '-> 2026-08-11', 'Monday to Tuesday');
	});

	it('steps off a weekend onto the next working day', () => {
		// 2026-08-08 is a Saturday.
		assert.equal(moved('-> 2026-08-08', 'weekdays'), '-> 2026-08-10');
		assert.equal(moved('-> 2026-08-09', 'weekdays'), '-> 2026-08-10', 'Sunday');
	});
});

describe('a named day', () => {
	it('lands on that weekday', () => {
		// 2026-08-03 is a Monday; a week on is the 10th, also a Monday.
		assert.equal(moved('-> 2026-08-03', 'monday'), '-> 2026-08-10');
	});

	it('corrects a date that has drifted off the day', () => {
		// Checked late on Wednesday the 5th: a week on is the 12th, and the
		// Monday of that week is the 10th. Self-correcting rather than
		// drifting a day further every time.
		assert.equal(moved('-> 2026-08-05', 'monday'), '-> 2026-08-10');
	});

	it('leaves a date with no weekday alone', () => {
		// A month has no weekday to land on, and forcing one would change
		// what the date says.
		assert.equal(moved('-> 2026-08', 'monday'), '-> 2026-09');
	});
});

describe('repeating from completion', () => {
	it('counts from the day it was checked, not from the due date', () => {
		// Watering the plants three days late: the next watering is seven days
		// from now, not four days away.
		assert.equal(
			next('[x] Water the plants -> 2026-08-03 #repeat=7d-after', 20260806),
			'[ ] Water the plants -> 2026-08-13 #repeat=7d-after',
		);
	});

	it('still counts from the due date without the suffix', () => {
		// Rent. Late payment does not move the next rent day.
		assert.equal(
			next('[x] Pay rent -> 2026-08-03 #repeat=7d', 20260806),
			'[ ] Pay rent -> 2026-08-10 #repeat=7d',
		);
	});

	it('keeps the written pattern, so a month stays a month', () => {
		assert.equal(
			next('[x] Review -> 2026-01 #repeat=1m-after', 20260615),
			'[ ] Review -> 2026-07 #repeat=1m-after',
		);
	});

	it('keeps a week-precision date a week', () => {
		// 6 August 2026 is in ISO week 32.
		assert.equal(
			next('[x] Standup -> 2026-W05 #repeat=1w-after', 20260806),
			'[ ] Standup -> 2026-W33 #repeat=1w-after',
		);
	});

	it('falls back to the due date when no today is given', () => {
		// The unit tests that do not care about completion pass nothing, and
		// must keep the old behaviour rather than silently doing nothing.
		assert.equal(
			next('[x] Water -> 2026-08-03 #repeat=7d-after'),
			'[ ] Water -> 2026-08-10 #repeat=7d-after',
		);
	});
});

describe('advancing a date', () => {
	it('keeps the pattern it was written in', () => {
		// The whole reason the parsed parts are kept: a month stays a month.
		assert.equal(moved('-> 2026-01', 'monthly'), '-> 2026-02');
		assert.equal(moved('-> 2026-Q1', 'quarterly'), '-> 2026-Q2');
		assert.equal(moved('-> 2026', 'yearly'), '-> 2027');
		assert.equal(moved('-> 2026-W05', 'weekly'), '-> 2026-W06');
		assert.equal(moved('-> 2026-01-31', 'daily'), '-> 2026-02-01');
	});

	it('keeps the separator it was written with', () => {
		assert.equal(moved('-> 2026/01/31', 'daily'), '-> 2026/02/01');
		assert.equal(moved('-> 2026/W05', 'weekly'), '-> 2026/W06');
	});

	it('clamps a month that is too short', () => {
		// 31 January plus one month is the end of February, not 3 March.
		assert.equal(moved('-> 2026-01-31', 'monthly'), '-> 2026-02-28');
		assert.equal(moved('-> 2024-01-31', 'monthly'), '-> 2024-02-29', 'leap year');
		assert.equal(moved('-> 2026-03-31', 'monthly'), '-> 2026-04-30');
	});

	it('rolls over the year', () => {
		assert.equal(moved('-> 2026-12-31', 'daily'), '-> 2027-01-01');
		assert.equal(moved('-> 2026-12', 'monthly'), '-> 2027-01');
		assert.equal(moved('-> 2026-Q4', 'quarterly'), '-> 2027-Q1');
	});

	it('rolls over the year in weeks, allowing for 53-week years', () => {
		// 2026 starts on a Thursday, so it has 53 ISO weeks, not 52. Assuming
		// 52 would skip a week every few years; the years with 53 are 2009,
		// 2015, 2020 and 2026, which is what this is checked against.
		assert.equal(moved('-> 2026-W52', 'weekly'), '-> 2026-W53');
		assert.equal(moved('-> 2026-W53', 'weekly'), '-> 2027-W01');

		// 2025 has 52, so W52 does roll over there.
		assert.equal(moved('-> 2025-W52', 'weekly'), '-> 2026-W01');
	});

	it('counts more than one at a time', () => {
		assert.equal(moved('-> 2026-01-01', '3d'), '-> 2026-01-04');
		assert.equal(moved('-> 2026-01-01', '2w'), '-> 2026-01-15');
		assert.equal(moved('-> 2026-01-01', '6m'), '-> 2026-07-01');
	});

	it('always moves, even where the interval and the pattern do not line up', () => {
		// A month-precision date cannot express a week. Advancing by its own
		// unit is the only answer that terminates: anything else renders the
		// same text and repeats for ever on the same date.
		assert.equal(moved('-> 2026-01', 'weekly'), '-> 2026-02');
		assert.equal(moved('-> 2026', 'daily'), '-> 2027');
		assert.notEqual(moved('-> 2026-Q1', 'daily'), '-> 2026-Q1');
	});
});

describe('the next occurrence of an item', () => {
	it('reopens the item and advances its date', () => {
		assert.equal(
			next('[x] Water the plants -> 2026-08-03 #repeat=weekly'),
			'[ ] Water the plants -> 2026-08-10 #repeat=weekly',
		);
	});

	it('keeps the indentation, so a repeating subtask stays a subtask', () => {
		assert.equal(
			next('\t[x] Sub -> 2026-08-03 #repeat=weekly'),
			'\t[ ] Sub -> 2026-08-10 #repeat=weekly',
		);
	});

	it('repeats an item with no due date, unchanged but reopened', () => {
		assert.equal(next('[x] Something #repeat=weekly'), '[ ] Something #repeat=weekly');
	});

	it('does nothing without the tag', () => {
		assert.equal(next('[x] Do this -> 2026-08-03'), null);
	});

	it('does nothing for an interval it does not understand', () => {
		assert.equal(next('[x] Do this -> 2026-08-03 #repeat=sometimes'), null);
		assert.equal(next('[x] Do this -> 2026-08-03 #repeat'), null);
	});

	it('leaves the rest of the description alone', () => {
		assert.equal(
			next('[x] ! Pay rent -> 2026-01-31 #repeat=monthly #home'),
			'[ ] ! Pay rent -> 2026-02-28 #repeat=monthly #home',
		);
	});
});

describe('postponing', () => {
	const { postpone } = require_('../out/repeat.js');
	const later = (line, interval, today = 20260731) => postpone(line, parseInterval(interval), today);

	it('counts from today, not from the due date', () => {
		// "Not until next week" means next week from now, not a week after a
		// deadline that has already gone by.
		assert.equal(later('[ ] Do it -> 2020-01-01', '1w'), '[ ] Do it -> 2026-08-07');
		assert.equal(later('[ ] Do it -> 2026-12-25', '1d'), '[ ] Do it -> 2026-08-01');
	});

	it('keeps the pattern the date was written in', () => {
		assert.equal(later('[ ] Do it -> 2026-01', '1w'), '[ ] Do it -> 2026-08');
		assert.equal(later('[ ] Do it -> 2026-Q1', '1m'), '[ ] Do it -> 2026-Q4');
		assert.equal(later('[ ] Do it -> 2026', '1d'), '[ ] Do it -> 2027');
	});

	it('takes a named day', () => {
		// 31 July 2026 is a Friday, so the next Monday is 3 August.
		assert.equal(later('[ ] Do it -> 2026-01-01', 'monday'), '[ ] Do it -> 2026-08-03');
	});

	it('leaves an item with no due date alone', () => {
		// Adding one is a bigger edit than was asked for, and the same
		// restraint an unrecognised repeat interval already shows.
		assert.equal(later('[ ] Do it', '1w'), null);
	});

	it('leaves the rest of the line alone', () => {
		assert.equal(
			later('\t[@] ! Ship it -> 2026-01-01 #release', '1d'),
			'\t[@] ! Ship it -> 2026-08-01 #release',
		);
	});

	it('touches only the first due date, which is the one that counts', () => {
		assert.equal(
			later('[ ] Do it -> 2026-01-01 -> 2026-02-02', '1d'),
			'[ ] Do it -> 2026-08-01 -> 2026-02-02',
		);
	});
});
