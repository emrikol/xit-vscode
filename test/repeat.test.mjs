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

/** The next occurrence of a whole item line. */
function next(line) {
	const [due] = dueDatesOn(line);
	return nextOccurrence(line, 'repeat', due ?? null);
}

/** Advance just the date part of `text`, for the arithmetic tests. */
function moved(text, interval) {
	const [due] = dueDatesOn(`[ ] x ${text}`);
	return renderDueDate(advance(due.parts, parseInterval(interval)));
}

describe('parsing an interval', () => {
	it('takes the plain words', () => {
		assert.deepEqual(parseInterval('daily'), { unit: 'day', count: 1 });
		assert.deepEqual(parseInterval('weekly'), { unit: 'week', count: 1 });
		assert.deepEqual(parseInterval('monthly'), { unit: 'month', count: 1 });
		assert.deepEqual(parseInterval('quarterly'), { unit: 'quarter', count: 1 });
		assert.deepEqual(parseInterval('yearly'), { unit: 'year', count: 1 });
	});

	it('takes a count and a letter', () => {
		assert.deepEqual(parseInterval('3d'), { unit: 'day', count: 3 });
		assert.deepEqual(parseInterval('2w'), { unit: 'week', count: 2 });
		assert.deepEqual(parseInterval('6m'), { unit: 'month', count: 6 });
	});

	it('is not case sensitive about the word', () => {
		assert.deepEqual(parseInterval('Weekly'), { unit: 'week', count: 1 });
		assert.deepEqual(parseInterval('2W'), { unit: 'week', count: 2 });
	});

	it('refuses anything else rather than guessing', () => {
		// A mistyped interval must do nothing. Scheduling something on a date
		// nobody asked for is worse than not scheduling it.
		for (const value of ['sometimes', 'fortnightly', '0d', '-1w', 'w', '3', '3x', '', null]) {
			assert.equal(parseInterval(value), null, JSON.stringify(value));
		}
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
